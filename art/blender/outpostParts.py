"""Batched mesh helpers for the orbital outposts (see build_outposts.py).

The outposts are made of hundreds of struts, panels and pipes. Giving each
its own object would bloat the GLB with nodes and accessors, so a `Mesher`
collects many primitives into one bmesh with one material slot per
material, and `finish` turns it into a single object.
"""

import math

import bpy  # noqa: I001  (bpy must load before bmesh)
import bmesh
from mathutils import Euler, Matrix, Vector


def place(centre=(0.0, 0.0, 0.0), rotation=(0.0, 0.0, 0.0)):
    return Matrix.Translation(Vector(centre)) @ Euler(rotation).to_matrix().to_4x4()


def aim(start, end):
    """Matrix whose local +Z runs from `start` to `end`, origin at `start`."""
    start, end = Vector(start), Vector(end)
    quat = (end - start).to_track_quat('Z', 'Y')
    return Matrix.Translation(start) @ quat.to_matrix().to_4x4()


class Mesher:
    def __init__(self):
        self.bm = bmesh.new()
        self.mats = []

    def _slot(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def _tag(self, faces, mat, smooth=False):
        slot = self._slot(mat)
        for face in faces:
            face.material_index = slot
            face.smooth = smooth

    def box(self, mat, centre, size, rotation=(0.0, 0.0, 0.0), bevel=0.0, matrix=None):
        bm = bmesh.new() if bevel > 0 else self.bm
        verts = bmesh.ops.create_cube(bm, size=1.0)['verts']
        base = matrix if matrix is not None else place(centre, rotation)
        bmesh.ops.transform(bm, matrix=base @ Matrix.Diagonal((*size, 1.0)), verts=verts)
        if bevel <= 0:
            self._tag({f for v in verts for f in v.link_faces}, mat)
            return
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=1, affect='EDGES', profile=0.5)
        copies = {v: self.bm.verts.new(v.co) for v in bm.verts}
        self._tag([self.bm.faces.new([copies[v] for v in f.verts]) for f in bm.faces], mat)
        bm.free()

    def strut(self, mat, start, end, thick, sides=3):
        """Thin rod; a smooth-shaded square section reads as a round tube."""
        length = (Vector(end) - Vector(start)).length
        if length < 1e-4:
            return
        self.lathe(mat, [(thick / 2, 0.0), (thick / 2, length)], aim(start, end), segments=sides, offset=math.pi / sides)

    def lathe(self, mat, profile, matrix, segments=16, smooth=True, offset=0.0):
        """Revolves (radius, z) points about local Z. r=0 at an end closes it.

        Nearly flat bands (caps, flanges) are flat shaded so the smooth
        sides keep a crisp rim.
        """
        bm = self.bm
        rings = []
        for r, z in profile:
            if r < 1e-6:
                rings.append([bm.verts.new((0.0, 0.0, z))] * segments)
            else:
                rings.append([bm.verts.new((math.cos(offset + 2 * math.pi * i / segments) * r,
                                            math.sin(offset + 2 * math.pi * i / segments) * r, z)) for i in range(segments)])
        flat, round_ = [], []
        for (ra, za), (rb, zb), a, b in zip(profile, profile[1:], rings, rings[1:]):
            for i in range(segments):
                j = (i + 1) % segments
                quad = []
                for v in (a[i], a[j], b[j], b[i]):
                    if v not in quad:
                        quad.append(v)
                if len(quad) < 3:
                    continue
                face = bm.faces.new(quad)
                (flat if abs(rb - ra) > 3 * abs(zb - za) else round_).append(face)
        verts = list({v for ring in rings for v in ring})
        bmesh.ops.transform(bm, matrix=matrix, verts=verts)
        self._tag(flat, mat)
        self._tag(round_, mat, smooth=smooth)
        return flat + round_

    def cylinder(self, mat, centre, radius, depth, rotation=(0.0, 0.0, 0.0), segments=16, radius_end=None, matrix=None):
        r2 = radius if radius_end is None else radius_end
        profile = [(0, -depth / 2), (radius, -depth / 2), (r2, depth / 2), (0, depth / 2)]
        self.lathe(mat, profile, matrix if matrix is not None else place(centre, rotation), segments)

    def tube(self, mat, start, end, radius, segments=10):
        """Capped cylinder between two points: pipes, booms, spokes."""
        length = (Vector(end) - Vector(start)).length
        self.lathe(mat, [(0, 0), (radius, 0), (radius, length), (0, length)], aim(start, end), segments)

    def capsule(self, mat, centre, radius, length, rotation=(0.0, 0.0, 0.0), segments=14):
        """Pressure tank: a cylinder with rounded ends, along local Z."""
        h = length / 2 - radius
        profile = [(0, -h - radius)]
        profile += [(radius * math.sin(a), -h - radius * math.cos(a)) for a in (0.6, 1.1, math.pi / 2)]
        profile += [(radius * math.sin(a), h + radius * math.cos(a)) for a in (math.pi / 2, 1.1, 0.6)]
        profile.append((0, h + radius))
        self.lathe(mat, profile, place(centre, rotation), segments)

    def ring(self, mat, matrix, major, section, segments=48, smooth=True):
        """Sweeps a closed (radial, axial) section around a circle in local XZ.

        The axis of the ring is local Y, matching the Aegis ring.
        """
        bm = self.bm
        loops = []
        for i in range(segments):
            angle = 2 * math.pi * i / segments
            out = Vector((math.cos(angle), 0, math.sin(angle)))
            loops.append([bm.verts.new(out * (major + dr) + Vector((0, dy, 0))) for dr, dy in section])
        faces = []
        count = len(section)
        for i in range(segments):
            a, b = loops[i], loops[(i + 1) % segments]
            for j in range(count):
                k = (j + 1) % count
                faces.append(bm.faces.new((a[j], a[k], b[k], b[j])))
        bmesh.ops.transform(bm, matrix=matrix, verts=[v for loop in loops for v in loop])
        bmesh.ops.recalc_face_normals(bm, faces=faces)
        self._tag(faces, mat, smooth)

    def panel(self, mat, centre, u, v):
        """Flat quad spanned by vectors u and v: windows, decals, cells."""
        c, u, v = Vector(centre), Vector(u) / 2, Vector(v) / 2
        face = self.bm.faces.new([self.bm.verts.new(p) for p in (c - u - v, c + u - v, c + u + v, c - u + v)])
        self._tag([face], mat)

    def truss(self, mat, start, end, width, bays, thick, up=(0, 0, 1), faces=(0, 1, 2, 3), battens=2):
        """Square lattice beam: four longerons, diagonal bracing and a batten
        frame every `battens` bays (and at both ends)."""
        start, end = Vector(start), Vector(end)
        axis = (end - start).normalized()
        u = axis.cross(Vector(up))
        if u.length < 1e-4:
            u = axis.cross(Vector((1, 0, 0)))
        u.normalize()
        v = axis.cross(u)
        h = width / 2
        corners = [(u + v) * h, (v - u) * h, (-u - v) * h, (u - v) * h]
        for c in corners:
            self.strut(mat, start + c, end + c, thick, sides=4)
        for i in range(bays + 1):
            p = start + (end - start) * (i / bays)
            for k in range(4 if i % battens == 0 or i == bays else 0):
                self.strut(mat, p + corners[k], p + corners[(k + 1) % 4], thick * 0.8)
            if i == bays:
                break
            q = start + (end - start) * ((i + 1) / bays)
            for k in faces:
                c1, c2 = corners[k], corners[(k + 1) % 4]
                if (i + k) % 2:
                    c1, c2 = c2, c1
                self.strut(mat, p + c1, q + c2, thick * 0.7)

    def finish(self, name, parent=None):
        mesh = bpy.data.meshes.new(name)
        self.bm.normal_update()
        self.bm.to_mesh(mesh)
        self.bm.free()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        for mat in self.mats:
            obj.data.materials.append(mat)
        obj.parent = parent
        return obj


def light_bar(m, mats, centre, target, length=1.0):
    """Floodlight: dark housing with a glowing lens facing `target`."""
    quat = (Vector(target) - Vector(centre)).to_track_quat('Y', 'Z')
    base = Matrix.Translation(Vector(centre)) @ quat.to_matrix().to_4x4()
    m.box(mats['dark'], None, (length, 0.6, 0.5), matrix=base)
    m.box(mats['flood'], None, (length * 0.85, 0.06, 0.36), matrix=base @ Matrix.Translation((0, 0.31, 0)))
    m.box(mats['dark'], None, (0.15, 0.6, 0.9), matrix=base @ Matrix.Translation((0, -0.3, -0.5)))


def hazard_beam(m, mats, start, end, thick, bands):
    """Solid beam in alternating accent and dark bands: hazard striping."""
    start, end = Vector(start), Vector(end)
    step = (end - start) / bands
    for i in range(bands):
        mat = mats['accent'] if i % 2 == 0 else mats['dark']
        a = start + step * i
        m.lathe(mat, [(thick, 0), (thick, step.length)], aim(a, a + step), segments=4, smooth=False, offset=math.pi / 4)


def dish(m, mat, matrix, radius, depth, segments=16, rings=3):
    """Single-skin parabolic reflector opening towards local +Z."""
    profile = [(0, 0)] + [(radius * k / rings, depth * (k / rings) ** 2) for k in range(1, rings + 1)]
    m.lathe(mat, profile, matrix, segments)
