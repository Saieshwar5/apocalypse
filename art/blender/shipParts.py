"""Mesh-building helpers shared by the Apocalypse ship and launch-pad scripts.

Blender axes: +Y is the nose, +Z is up. The glTF exporter converts this to the
game's frame (forward -Z, up +Y).
"""

import math
import random

import bpy  # noqa: I001  (bpy must load before bmesh)
import bmesh
from mathutils import Vector


def material(name, color, metallic=0.0, roughness=0.5, emission=None, strength=0.0, alpha=1.0):
    """Principled BSDF material. Only exporter-safe settings are used."""
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if emission is not None:
        bsdf.inputs['Emission Color'].default_value = (*emission, 1.0)
        bsdf.inputs['Emission Strength'].default_value = strength
    if alpha < 1.0:
        bsdf.inputs['Alpha'].default_value = alpha
        mat.surface_render_method = 'BLENDED'
    return mat


def link_mesh(name, bm, mat, parent=None, smooth=False):
    mesh = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = smooth
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    if parent is not None:
        obj.parent = parent
    return obj


def ring_points(half_width, top, bottom, flat_top=0.55, flat_bottom=0.5):
    """Flattened octagon cross-section in the XZ plane, listed counter-clockwise."""
    mid_high = bottom + (top - bottom) * 0.72
    mid_low = bottom + (top - bottom) * 0.3
    return [
        (-half_width * flat_top, top),
        (half_width * flat_top, top),
        (half_width, mid_high),
        (half_width, mid_low),
        (half_width * flat_bottom, bottom),
        (-half_width * flat_bottom, bottom),
        (-half_width, mid_low),
        (-half_width, mid_high),
    ]


def densify(stations, factor=2):
    """Adds interpolated cross-sections so armour plates come out smaller."""
    result = []
    for a, b in zip(stations, stations[1:]):
        for step in range(factor):
            t = step / factor
            result.append(tuple(av + (bv - av) * t for av, bv in zip(a, b)))
    result.append(stations[-1])
    return result


def loft(stations, x_offset=0.0, flat_top=0.55, flat_bottom=0.5):
    """Builds a closed hull from cross-sections.

    stations: list of (y, half_width, top_z, bottom_z) from tail to nose.
    Returns a bmesh whose side faces are quads that can be armour-plated.
    """
    bm = bmesh.new()
    rings = []
    for y, half_width, top, bottom in stations:
        ring = [bm.verts.new((x_offset + x, y, z)) for x, z in ring_points(half_width, top, bottom, flat_top, flat_bottom)]
        rings.append(ring)
    count = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(count):
            j = (i + 1) % count
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def armour_plates(source_bm, name, mat, parent, rng, gap=0.06, lift=0.035, thickness=0.07, skip=0.12, min_area=0.02):
    """Copies each face of a hull as a separate raised plate.

    Plates are shrunk towards their centre so dark seams show between them,
    and lifted by slightly different amounts so the armour looks layered.
    """
    plates = bmesh.new()
    for face in source_bm.faces:
        if face.calc_area() < min_area or rng.random() < skip:
            continue
        centre = face.calc_center_median()
        normal = face.normal.copy()
        shrink = 1.0 - gap / max(math.sqrt(face.calc_area()), 0.05)
        layer = lift + rng.choice((0.0, 0.0, 0.025, 0.05))
        bottom_verts = []
        for loop in face.loops:
            point = centre + (loop.vert.co - centre) * shrink + normal * layer
            bottom_verts.append(plates.verts.new(point))
        top_verts = [plates.verts.new(v.co + normal * thickness) for v in bottom_verts]
        plates.faces.new(top_verts)
        plates.faces.new(list(reversed(bottom_verts)))
        count = len(bottom_verts)
        for i in range(count):
            j = (i + 1) % count
            plates.faces.new((bottom_verts[i], bottom_verts[j], top_verts[j], top_verts[i]))
    bmesh.ops.recalc_face_normals(plates, faces=plates.faces)
    return link_mesh(name, plates, mat, parent)


def box(name, centre, size, mat, parent=None, rotation=(0.0, 0.0, 0.0), bevel=0.02):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=1, affect='EDGES', profile=0.5)
    obj = link_mesh(name, bm, mat, parent)
    obj.location = centre
    obj.rotation_euler = rotation
    return obj


def cylinder(name, centre, radius, depth, mat, parent=None, rotation=(math.pi / 2, 0.0, 0.0), segments=20, radius_end=None, cap=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm,
        cap_ends=cap,
        segments=segments,
        radius1=radius,
        radius2=radius if radius_end is None else radius_end,
        depth=depth,
    )
    obj = link_mesh(name, bm, mat, parent, smooth=True)
    obj.location = centre
    obj.rotation_euler = rotation
    return obj


def prism(name, outline, height, mat, parent=None, z=0.0):
    """Extrudes a flat XY outline upwards: wings, fins and fairings."""
    bm = bmesh.new()
    bottom = [bm.verts.new((x, y, z)) for x, y in outline]
    top = [bm.verts.new((x, y, z + height)) for x, y in outline]
    bm.faces.new(list(reversed(bottom)))
    bm.faces.new(top)
    count = len(outline)
    for i in range(count):
        j = (i + 1) % count
        bm.faces.new((bottom[i], bottom[j], top[j], top[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=0.015, segments=1, affect='EDGES', profile=0.5)
    return link_mesh(name, bm, mat, parent)


def socket(name, location, parent):
    """Empty used by the game to find gun ports, engines and the cockpit."""
    empty = bpy.data.objects.new(name, None)
    empty.empty_display_size = 0.2
    empty.location = location
    empty.parent = parent
    bpy.context.scene.collection.objects.link(empty)
    return empty


def greebles(name, area_min, area_max, z, count, mat, parent, rng, scale=0.12):
    """Small machinery blocks scattered over a rectangle at height z."""
    bm = bmesh.new()
    for _ in range(count):
        cx = rng.uniform(area_min[0], area_max[0])
        cy = rng.uniform(area_min[1], area_max[1])
        sx = rng.uniform(0.3, 1.0) * scale
        sy = rng.uniform(0.4, 1.6) * scale
        sz = rng.uniform(0.15, 0.6) * scale
        result = bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=result['verts'])
        bmesh.ops.translate(bm, vec=(cx, cy, z + sz / 2), verts=result['verts'])
    return link_mesh(name, bm, mat, parent)


def vents(name, origin, axis_step, slats, slat_size, mat, parent):
    """A row of thin slats, like cooling vents."""
    bm = bmesh.new()
    for i in range(slats):
        result = bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=slat_size, verts=result['verts'])
        offset = Vector(origin) + Vector(axis_step) * i
        bmesh.ops.translate(bm, vec=offset, verts=result['verts'])
    return link_mesh(name, bm, mat, parent)


def mirror_x(points):
    return [(-x, y) for x, y in reversed(points)]


def seeded(seed):
    return random.Random(seed)
