"""Builds the three orbital outposts and exports one GLB each.

    python art/blender/build_outposts.py --out public/models --render art/renders

  * Vulcan Yard (`vulcan.glb`, root `Vulcan`): satellite repair yard. An open
    truss cradle with robot arms, floodlights, catwalks and parts racks.
    Empty `drop_zone` is the centre of the cradle, where a towed satellite
    is left.
  * Ceres Works (`ceres.glb`, root `Ceres`): asteroid refinery. Armoured
    body, intake funnel with capture claws at +Y, fuel tanks, radiators and
    a glowing smelter. Empty `intake` is where hauled rocks are delivered.
  * Halo (`halo.glb`, root `Halo`): crew habitat and control centre. A
    spine with a control deck and a crew port at +Y; `HaloRing` is a
    separate mesh node the game can spin about its local Y axis (the
    spine). Empty `crew_port` is in front of the docking collar.

Every outpost opens along +Y (-Z in the game), is 30-45 m across and has red
beacon meshes named Beacon_* using the StationBeacon material, like Aegis.
"""

import argparse
import math
import os
import sys

import bpy  # noqa: I001  (bpy must load before bmesh)
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shipParts as parts  # noqa: E402
import outpostParts as op  # noqa: E402

ALONG_Y = (-math.pi / 2, 0.0, 0.0)  # turns local +Z (lathe axis) onto +Y


def materials(accent, hull=(0.15, 0.16, 0.17), plate=(0.26, 0.27, 0.28)):
    # Albedo stays below 0.5: the game renders with bloom.
    return {
        'hull': parts.material('OutpostHull', hull, metallic=0.6, roughness=0.5),
        'plate': parts.material('OutpostPlate', plate, metallic=0.5, roughness=0.45),
        'dark': parts.material('OutpostDark', (0.05, 0.055, 0.06), metallic=0.6, roughness=0.6),
        'frame': parts.material('OutpostFrame', (0.2, 0.2, 0.21), metallic=0.7, roughness=0.45),
        'light': parts.material('OutpostRadiator', (0.42, 0.43, 0.44), metallic=0.15, roughness=0.55),
        'tank': parts.material('OutpostTank', (0.33, 0.34, 0.34), metallic=0.3, roughness=0.4),
        'accent': parts.material('OutpostAccent', accent, metallic=0.3, roughness=0.5),
        'solar': parts.material('SolarPanel', (0.02, 0.05, 0.16), metallic=0.8, roughness=0.25),
        'window': parts.material('OutpostWindow', (0.9, 0.8, 0.5), emission=(1.0, 0.82, 0.5), strength=2.5),
        'flood': parts.material('Floodlight', (1.0, 0.93, 0.8), emission=(1.0, 0.93, 0.8), strength=14.0),
        'glow': parts.material('SmelterGlow', (1.0, 0.4, 0.08), emission=(1.0, 0.38, 0.06), strength=4.0),
        'blue': parts.material('BlueLight', (0.3, 0.6, 1.0), emission=(0.35, 0.65, 1.0), strength=6.0),
        'beacon': parts.material('StationBeacon', (1.0, 0.1, 0.05), emission=(1.0, 0.1, 0.05), strength=20.0),
    }


def new_root(name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    return root


def beacon(name, location, mats, root):
    parts.box(name, location, (0.35, 0.35, 0.35), mats['beacon'], root, bevel=0.0)


def segment(m, mat, a, b, thick):
    """Square beam from a to b (arm links, claw segments)."""
    a, b = Vector(a), Vector(b)
    m.box(mat, None, (thick, thick, (b - a).length), matrix=op.aim(a, b) @ Matrix.Translation((0, 0, (b - a).length / 2)))


def joint(m, mat, centre, a, b, radius):
    """Hinge drum at `centre`, its axis across the two links that meet there."""
    axis = (Vector(a) - Vector(centre)).cross(Vector(b) - Vector(centre))
    if axis.length < 1e-4:
        axis = Vector((1, 0, 0))
    axis = axis.normalized() * radius * 0.9
    m.tube(mat, Vector(centre) - axis, Vector(centre) + axis, radius, segments=8)


def robot_arm(m, mats, base, shoulder, elbow, wrist, tip):
    """Industrial manipulator: turret, two links, wrist and a welding head."""
    up = (Vector(shoulder) - Vector(base)).normalized()
    m.cylinder(mats['dark'], None, 1.0, 0.4, matrix=op.aim(Vector(base) - up * 0.2, Vector(base) + up * 0.2) @ Matrix.Translation((0, 0, 0.2)), segments=12)
    m.cylinder(mats['plate'], None, 0.7, 1.0, matrix=op.aim(base, shoulder) @ Matrix.Translation((0, 0, 0.5)), segments=12)
    segment(m, mats['accent'], shoulder, elbow, 1.0)
    segment(m, mats['accent'], elbow, wrist, 0.8)
    joint(m, mats['dark'], shoulder, base, elbow, 0.6)
    joint(m, mats['dark'], elbow, shoulder, wrist, 0.5)
    joint(m, mats['dark'], wrist, elbow, tip, 0.38)
    # Hydraulic ram along the upper link.
    side = (Vector(elbow) - Vector(shoulder)).cross(up).normalized() * 0.55
    m.strut(mats['frame'], Vector(shoulder) + side + up * 0.3, Vector(elbow) * 0.6 + Vector(shoulder) * 0.4 + side, 0.18)
    m.tube(mats['plate'], wrist, tip, 0.28, segments=8)
    direction = (Vector(tip) - Vector(wrist)).normalized()
    m.tube(mats['blue'], tip, Vector(tip) + direction * 0.25, 0.1, segments=6)
    for k in (-1, 1):
        finger = direction.cross(up).normalized() * 0.3 * k
        m.strut(mats['dark'], Vector(tip) + finger, Vector(tip) + finger * 1.4 + direction * 0.7, 0.12)


def crate_rack(m, mats, rng, x, y0, y1, z0, z1, depth):
    """Open shelving outside the cradle, stocked with crates and spare tanks."""
    side = 1 if x > 0 else -1
    shelves = 3
    for y in (y0, (y0 + y1) / 2, y1):
        for dx in (0, depth):
            m.strut(mats['frame'], (x + side * dx, y, z0), (x + side * dx, y, z1), 0.22)
    for s in range(shelves + 1):
        z = z0 + (z1 - z0) * s / shelves
        m.box(mats['dark'], (x + side * depth / 2, (y0 + y1) / 2, z), (depth + 0.2, y1 - y0 + 0.2, 0.12))
        if s == shelves:
            break
        y = y0 + 0.3
        while y < y1 - 0.8:
            if rng.random() < 0.3:
                length = rng.uniform(1.6, 2.6)
                if y + length > y1 - 0.2:
                    break
                r = min(0.6, (z1 - z0) / shelves / 2 - 0.15)
                m.capsule(mats['light' if rng.random() < 0.5 else 'plate'], (x + side * depth / 2, y + length / 2, z + r + 0.06), r, length, ALONG_Y, segments=8)
                y += length + 0.25
                continue
            w, h = rng.uniform(0.8, 1.4), rng.uniform(0.6, (z1 - z0) / shelves - 0.3)
            mat = rng.choice(('plate', 'plate', 'hull', 'light', 'accent'))
            m.box(mats[mat], (x + side * depth / 2, y + w / 2, z + h / 2 + 0.06), (depth * rng.uniform(0.6, 0.9), w, h))
            y += w + rng.uniform(0.15, 0.4)
    m.strut(mats['frame'], (x, y0, z1), (x - side * 1.2, y0, z1), 0.3)
    m.strut(mats['frame'], (x, y1, z0), (x - side * 1.2, y1, z0), 0.3)


def build_vulcan():
    root = new_root('Vulcan')
    mats = materials((0.8, 0.36, 0.03))
    rng = parts.seeded(31)
    m = op.Mesher()
    X, Z, Y0, Y1 = 8.0, 7.0, -6.0, 14.0
    frame = mats['frame']

    # Open cradle: four lattice longerons, three portal frames.
    for sx in (-1, 1):
        for sz in (-1, 1):
            m.truss(frame, (sx * X, Y0, sz * Z), (sx * X, Y1, sz * Z), 1.2, 5, 0.14)
    for y in (Y0, 4.0, Y1):
        for sz in (-1, 1):
            m.truss(frame, (-X, y, sz * Z), (X, y, sz * Z), 1.2, 5, 0.14)
        if y != 4.0:
            for sx in (-1, 1):
                m.truss(frame, (sx * X, y, -Z), (sx * X, y, Z), 1.2, 4, 0.14)
    for sx in (-1, 1):
        for sz in (-1, 1):
            for y in (Y0, 4.0, Y1):
                m.box(mats['plate'], (sx * X, y, sz * Z), (1.7, 1.7, 1.7))
    # Hazard-striped bumper around the mouth of the cradle.
    F = Y1 + 1.1
    corners = [(-X, F, -Z), (X, F, -Z), (X, F, Z), (-X, F, Z)]
    for a, b in zip(corners, corners[1:] + corners[:1]):
        op.hazard_beam(m, mats, a, b, 0.42, 11)
    for c in corners:
        m.strut(frame, c, (c[0], Y1, c[2]), 0.4)

    # Gantry crane running on rails along the roof.
    for sx in (-1, 1):
        m.box(mats['dark'], (sx * X, 4, Z + 0.85), (0.5, Y1 - Y0, 0.3))
    m.box(mats['accent'], (0, 8.5, Z + 1.3), (2 * X + 1.0, 1.2, 0.9), bevel=0.06)
    for sx in (-1, 1):
        m.box(mats['dark'], (sx * X, 8.5, Z + 1.0), (1.2, 2.0, 0.6))
    m.box(mats['plate'], (2.0, 8.5, Z + 0.55), (1.6, 1.8, 0.8), bevel=0.05)
    m.strut(mats['dark'], (1.8, 8.5, Z), (1.8, 8.5, 3.2), 0.08)
    m.strut(mats['dark'], (2.2, 8.5, Z), (2.2, 8.5, 3.2), 0.08)
    m.box(mats['accent'], (2.0, 8.5, 2.9), (0.9, 0.9, 0.6), bevel=0.05)

    # Catwalks along both inner walls, with handrails.
    for sx in (-1, 1):
        for z in (-2.6, 2.8) if sx < 0 else (-2.6,):
            m.box(mats['dark'], (sx * (X - 1.6), 4, z), (2.2, Y1 - Y0 - 1.4, 0.16))
            for y in range(int(Y0) + 1, int(Y1), 3):
                m.strut(frame, (sx * (X - 2.6), y, z), (sx * (X - 2.6), y, z + 1.1), 0.08)
                m.strut(frame, (sx * (X - 0.5), y, z), (sx * X, y, z), 0.14)
            m.strut(mats['accent'], (sx * (X - 2.6), Y0 + 1, z + 1.1), (sx * (X - 2.6), Y1 - 1, z + 1.1), 0.09)

    # Robot arms on the middle portal, all reaching for the drop zone.
    for sx in (-1, 1):
        for sz in (-1, 1):
            back = 1 if sx * sz > 0 else -1
            robot_arm(m, mats, (sx * 3.5, 4, sz * (Z - 0.6)), (sx * 3.5, 4, sz * (Z - 1.8)),
                      (sx * 6.6, 4 + back * 4.6, sz * 3.4), (sx * 4.6, 4 + back * 3.0, sz * 1.7), (sx * 3.4, 4 + back * 2.0, sz * 1.1))

    # Floodlights at the inner corners of the cradle.
    for sx in (-1, 1):
        for sz in (-1, 1):
            for y in (Y0 + 0.9, Y1 - 0.9):
                op.light_bar(m, mats, (sx * (X - 1.1), y, sz * (Z - 1.1)), (0, 4, 0), 1.2)

    # Parts rack bolted to the outside of the port wall; starboard stays open.
    crate_rack(m, mats, rng, -(X + 1.2), -3.5, 11.5, -5.5, 4.5, 2.2)

    # Workshop and control module behind the cradle.
    hull = parts.loft(parts.densify([(-16, 5.0, 4.4, -4.4), (-14.5, 6.0, 5.2, -5.2), (-8.5, 6.0, 5.2, -5.2), (-7.2, 5.2, 4.4, -4.4)], 2))
    plates = hull.copy()
    parts.link_mesh('VulcanWorkshop', hull, mats['hull'], root)
    parts.armour_plates(plates, 'VulcanWorkshopPlates', mats['plate'], root, rng, gap=0.12, lift=0.05, thickness=0.1, skip=0.15)
    plates.free()
    parts.greebles('VulcanMachinery', (-2.8, -15), (2.8, -9), 5.3, 18, mats['dark'], root, rng, scale=0.6)
    for sx in (-1, 1):
        for y in (-9.4, -15.0):
            m.box(mats['accent'], (sx * 6.22, y, 0.1), (0.08, 0.7, 4.0))
        for k in range(5):
            m.panel(mats['window'], (sx * 6.24, -13.6 + k * 0.85, 1.4), (0, 0.55, 0), (0, 0, 0.35))
        m.box(mats['dark'], (sx * 6.4, -11.8, -2.6), (0.6, 4.0, 1.2), bevel=0.05)
    # Control cab hanging over the cradle, its window band facing the bay.
    m.box(mats['plate'], (0, -4.6, 5.0), (5.4, 2.6, 2.4), bevel=0.1)
    m.box(mats['dark'], (0, -3.25, 5.1), (5.0, 0.2, 1.0))
    for k in range(6):
        m.panel(mats['window'], (-2.0 + k * 0.8, -3.13, 5.1), (0.65, 0, 0), (0, 0, 0.8))
    m.box(mats['accent'], (0, -3.3, 6.25), (5.4, 0.3, 0.25))
    m.box(mats['hull'], (0, -5.6, 3.6), (2.0, 1.2, 1.4))
    # Mast, comms dish and beacon on the module roof.
    m.strut(mats['frame'], (0, -11.5, 5.2), (0, -11.5, 9.2), 0.2)
    op.dish(m, mats['light'], op.place((2.6, -13.5, 6.6), (0.5, 0.6, 0)), 1.5, 0.4)
    m.tube(mats['dark'], (2.6, -13.5, 5.2), (2.6, -13.5, 6.6), 0.15, segments=6)
    beacon('Beacon_top', (0, -11.5, 9.4), mats, root)
    beacon('Beacon_bumper', (X + 0.45, F, -Z - 0.45), mats, root)

    # Service spine with radiators and a solar wing.
    m.truss(frame, (0, -16, 0), (0, -28, 0), 1.6, 4, 0.16)
    for k, y in enumerate((-18.5, -22.0)):
        for sx in (-1, 1):
            m.strut(frame, (sx * 0.8, y, 0), (sx * 2.2, y, 0), 0.3)
            m.box(mats['light'], (sx * 5.6, y, 0), (6.8, 2.8, 0.1))
            for r in (-0.7, 0, 0.7):
                m.box(mats['dark'], (sx * 5.6, y + r, 0.06), (6.8, 0.08, 0.04))
    m.cylinder(mats['hull'], (0, -29.2, 0), 2.0, 2.4, ALONG_Y, segments=16)
    m.cylinder(mats['accent'], (0, -28.0, 0), 2.1, 0.3, ALONG_Y, segments=16)
    for sx in (-1, 1):
        m.truss(frame, (sx * 2.0, -25.5, 0), (sx * 15.0, -25.5, 0), 0.6, 6, 0.08, up=(0, 1, 0), faces=(0, 2))
        for k in range(3):
            x = sx * (5.0 + k * 3.6)
            m.box(mats['solar'], (x, -25.5, 0.45), (3.3, 5.2, 0.06))
            m.box(mats['frame'], (x, -25.5, 0.4), (3.5, 5.4, 0.05))
    m.finish('VulcanYard', root)
    parts.socket('drop_zone', (0, 4, 0), root)
    return root


def build_ceres():
    root = new_root('Ceres')
    mats = materials((0.13, 0.48, 0.16))
    rng = parts.seeded(47)
    m = op.Mesher()

    # Armoured processing body.
    hull = parts.loft(parts.densify([(-13, 4.4, 4.0, -4.0), (-11, 5.2, 4.6, -4.6), (6, 5.2, 4.6, -4.6), (8, 4.6, 4.1, -4.1)], 3))
    plates = hull.copy()
    parts.link_mesh('CeresHull', hull, mats['hull'], root)
    parts.armour_plates(plates, 'CeresHullPlates', mats['plate'], root, rng, gap=0.12, lift=0.05, thickness=0.12, skip=0.12)
    plates.free()
    parts.greebles('CeresMachinery', (-2.6, -2), (2.6, 2), 4.7, 18, mats['dark'], root, rng, scale=0.6)
    for sx in (-1, 1):
        m.box(mats['accent'], (sx * 2.2, -1.5, 4.72), (0.5, 17, 0.06))
        m.box(mats['accent'], (sx * 2.9, -1.5, 4.72), (0.18, 17, 0.06))

    # Intake funnel with a crusher ring in its throat.
    m.lathe(mats['plate'], [(2.4, 0), (3.6, 1.2), (5.6, 4.0), (6.6, 6.0), (7.0, 6.6)], op.place((0, 8, 0), ALONG_Y), segments=16)
    m.lathe(mats['dark'], [(2.3, 0.05), (3.5, 1.25), (5.5, 4.05), (6.5, 6.05)], op.place((0, 8.05, 0), ALONG_Y), segments=16)
    m.cylinder(mats['hull'], (0, 8.6, 0), 3.4, 1.4, ALONG_Y, segments=16)
    m.lathe(mats['glow'], [(0, 0), (2.4, 0)], op.place((0, 8.25, 0), ALONG_Y), segments=16)
    for k in range(10):
        a = 2 * math.pi * k / 10
        out = Vector((math.cos(a), 0, math.sin(a)))
        segment(m, mats['dark'], out * 2.9 + Vector((0, 9.0, 0)), out * 1.6 + Vector((0, 9.6, 0)), 0.45)
    for k in range(16):
        a = 2 * math.pi * k / 16
        out = Vector((math.cos(a), 0, math.sin(a)))
        m.strut(mats['hull'], out * 3.8 + Vector((0, 9.0, 0)), out * 7.2 + Vector((0, 14.6, 0)), 0.45)
        m.box(mats['accent' if k % 2 else 'dark'], tuple(out * 7.1 + Vector((0, 14.7, 0))), (1.0, 0.6, 1.0),
              rotation=(0, -a, 0))
    m.ring(mats['dark'], Matrix.Translation((0, 14.7, 0)), 7.1, [(-0.25, -0.2), (0.25, -0.2), (0.25, 0.2), (-0.25, 0.2)], segments=16, smooth=False)

    # Four capture claws reaching forward from the rim.
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        out = Vector((math.cos(a), 0, math.sin(a)))
        pts = [out * 7.4 + Vector((0, 14.8, 0)), out * 9.0 + Vector((0, 19.0, 0)),
               out * 6.6 + Vector((0, 23.0, 0)), out * 4.2 + Vector((0, 23.8, 0))]
        m.box(mats['hull'], tuple(pts[0]), (1.6, 1.6, 1.6), rotation=(0, -a, 0), bevel=0.1)
        segment(m, mats['plate'], pts[0], pts[1], 0.95)
        segment(m, mats['plate'], pts[1], pts[2], 0.8)
        segment(m, mats['dark'], pts[2], pts[3], 0.55)
        joint(m, mats['accent'], pts[1], pts[0], pts[2], 0.65)
        joint(m, mats['accent'], pts[2], pts[1], pts[3], 0.5)
        m.strut(mats['frame'], out * 6.0 + Vector((0, 12.2, 0)), out * 8.7 + Vector((0, 18.0, 0)), 0.22)
    parts.socket('intake', (0, 18.5, 0), root)

    # Fuel tanks along the flanks, banded in the accent colour.
    for sx in (-1, 1):
        for sz in (-1, 1):
            centre = Vector((sx * 6.6, -4.0, sz * 2.4))
            m.capsule(mats['tank'], centre, 2.0, 13.0, ALONG_Y, segments=16)
            for dy in (-4.5, 0.0, 4.5):
                band = [(2.06, -0.3), (2.06, 0.3)] if dy else [(2.06, -0.7), (2.06, 0.7)]
                m.lathe(mats['accent' if dy == 0 else 'dark'], band, op.place(centre + Vector((0, dy, 0)), ALONG_Y), segments=16)
            m.box(mats['dark'], tuple(centre - Vector((sx * 1.4, 0, 0))), (1.0, 9.0, 0.6))
        m.tube(mats['frame'], (sx * 5.3, -10.5, 0), (sx * 5.3, 7.0, 0), 0.32)
        m.tube(mats['accent'], (sx * 5.5, -10.5, 0.9), (sx * 5.5, 7.0, 0.9), 0.18, segments=8)

    # Smelter slung under the body: louvred vents glowing from inside.
    m.box(mats['hull'], (0, -1, -6.3), (7.0, 11.0, 3.4), bevel=0.12)
    m.box(mats['plate'], (0, -1, -8.1), (5.8, 9.4, 0.4), bevel=0.06)
    for sx in (-1, 1):
        m.box(mats['glow'], (sx * 3.52, -1, -6.3), (0.05, 8.0, 2.0))
        for k in range(10):
            m.box(mats['dark'], (sx * 3.6, -4.6 + k * 0.8, -6.3), (0.12, 0.3, 2.3))
    m.box(mats['dark'], (0, 6.0, -4.9), (2.4, 4.0, 1.6), bevel=0.05)
    for k, y in enumerate((-4.0, 2.0)):
        m.cylinder(mats['dark'], (0, y, -9.0), 0.9, 1.6, segments=12, radius_end=0.6)
        m.lathe(mats['glow'], [(0, 0), (0.55, 0)], op.place((0, y, -9.82)), segments=12)

    # Radiator wings on a pylon over the tanks.
    m.box(mats['plate'], (0, -8.0, 5.8), (1.4, 1.4, 2.6), bevel=0.06)
    m.truss(mats['frame'], (-20.5, -8.0, 7.4), (20.5, -8.0, 7.4), 1.0, 20, 0.12, up=(0, 1, 0))
    for sx in (-1, 1):
        for k in range(3):
            x = sx * (4.2 + k * 5.4)
            m.box(mats['light'], (x, -8.0, 8.3), (5.0, 5.8, 0.12))
            for r in range(-2, 3):
                m.box(mats['dark'], (x, -8.0 + r * 1.1, 8.38), (5.0, 0.1, 0.05))
        beacon(f'Beacon_{"L" if sx < 0 else "R"}', (sx * 21.0, -8.0, 7.4), mats, root)

    # Bridge cab on top, facing the intake.
    m.box(mats['plate'], (0, 4.2, 5.5), (4.2, 3.0, 1.8), bevel=0.1)
    for k in range(5):
        m.panel(mats['window'], (-1.4 + k * 0.7, 5.73, 5.6), (0.55, 0, 0), (0, 0, 0.6))
    m.strut(mats['frame'], (1.4, 3.6, 6.4), (1.4, 3.6, 8.6), 0.08)

    # Stern: spherical tanks, thrusters and parts containers.
    for sx in (-1, 1):
        m.lathe(mats['tank'], [(0, -2.2)] + [(2.2 * math.sin(t), -2.2 * math.cos(t)) for t in (0.7, 1.4, 2.1, 2.6)] + [(0, 2.2)],
                op.place((sx * 3.0, -15.6, 0)), segments=14)
        for sz in (-1, 1):
            m.cylinder(mats['dark'], (sx * 2.6, -13.8, sz * 2.6), 0.5, 1.2, ALONG_Y, segments=10, radius_end=0.8)
    for k in range(6):
        x, z = (k % 3 - 1) * 1.9, (k // 3 - 0.5) * 2.2
        m.box(mats['accent' if k == 4 else 'plate'], (x, -14.2, z - 5.5), (1.7, 2.2, 2.0), bevel=0.06)
    m.finish('CeresWorks', root)
    beacon('Beacon_belly', (0, -1, -8.6), mats, root)
    return root


def build_halo():
    root = new_root('Halo')
    mats = materials((0.1, 0.3, 0.75), hull=(0.46, 0.47, 0.49), plate=(0.33, 0.34, 0.36))
    m = op.Mesher()

    # Spine: modules of different diameters along Y.
    spine = [(0, -19), (1.2, -19), (1.2, -16.5), (2.2, -16), (2.2, -9), (1.4, -8.5), (1.4, -2.2), (2.0, -2.0),
             (2.0, 2.0), (1.4, 2.2), (1.4, 4.5), (2.4, 5.0), (2.4, 7.0), (4.6, 8.4), (4.8, 9.4)]
    m.lathe(mats['hull'], spine, op.place((0, 0, 0), ALONG_Y), segments=20)
    m.lathe(mats['dark'], [(4.8, 9.4), (4.3, 10.6)], op.place((0, 0, 0), ALONG_Y), segments=20)
    for k in range(40):
        a = 2 * math.pi * (k + 0.5) / 40
        out, tangent = Vector((math.cos(a), 0, math.sin(a))), Vector((-math.sin(a), 0, math.cos(a)))
        slope = Vector((0, 1.2, 0)) - out * 0.5
        for t in (-0.22, 0.22):
            m.panel(mats['window'], out * (4.55 - t * 0.4) + Vector((0, 10.0 + t * 1.2, 0)) + slope.cross(tangent).normalized() * 0.03,
                    tangent * 0.45, slope * 0.3)
    m.lathe(mats['hull'], [(4.3, 10.6), (3.2, 11.6), (1.4, 12.2), (1.4, 14.6), (0, 14.6)], op.place((0, 0, 0), ALONG_Y), segments=20)
    for k in range(12):
        a = 2 * math.pi * k / 12
        m.strut(mats['dark'], (4.85 * math.cos(a), 9.4, 4.85 * math.sin(a)), (4.35 * math.cos(a), 10.6, 4.35 * math.sin(a)), 0.12)
    m.ring(mats['accent'], Matrix.Translation((0, 8.9, 0)), 4.6, [(0, -0.2), (0.12, -0.2), (0.12, 0.2), (0, 0.2)], segments=20, smooth=False)
    # Habitat module windows: rows around the two larger spine modules.
    for y0, y1, r in ((-15, -10, 2.22), (5.3, 6.8, 2.42)):
        for k in range(14):
            a = 2 * math.pi * (k + 0.5) / 14
            out, tangent = Vector((math.cos(a), 0, math.sin(a))), Vector((-math.sin(a), 0, math.cos(a)))
            y = y0 + 0.4
            while y < y1:
                m.panel(mats['window'], out * r + Vector((0, y, 0)), tangent * 0.45, (0, 0.5, 0))
                y += 1.1
    for y in (-16.2, -8.8, 4.8):
        m.ring(mats['accent'], Matrix.Translation((0, y, 0)), 2.2 if y < 0 else 2.4, [(0, -0.15), (0.1, -0.15), (0.1, 0.15), (0, 0.15)], segments=20, smooth=False)
    parts.greebles('HaloSpineMachinery', (-0.8, -8), (0.8, -3), 1.3, 10, mats['dark'], root, parts.seeded(5), scale=0.4)

    # Crew shuttle port: docking collar with blue guide lights.
    m.cylinder(mats['plate'], (0, 15.0, 0), 1.9, 0.8, ALONG_Y, segments=16)
    m.cylinder(mats['dark'], (0, 15.45, 0), 1.2, 0.1, ALONG_Y, segments=16)
    for k in range(6):
        a = 2 * math.pi * k / 6
        m.box(mats['blue'], (2.0 * math.cos(a), 15.2, 2.0 * math.sin(a)), (0.25, 0.4, 0.25))
    for sx in (-1, 1):
        m.strut(mats['frame'], (sx * 1.6, 13.0, 0), (sx * 1.6, 18.5, 0), 0.12)
        m.box(mats['blue'], (sx * 1.6, 18.6, 0), (0.2, 0.2, 0.2))
    parts.socket('crew_port', (0, 17.5, 0), root)

    # Fixed bearing collar the ring turns on.
    m.cylinder(mats['dark'], (0, -0.1, 0), 2.6, 4.6, ALONG_Y, segments=20)

    # Solar wings and antennas aft.
    for sx in (-1, 1):
        m.truss(mats['frame'], (sx * 2.2, -12.5, 0), (sx * 16.0, -12.5, 0), 0.6, 7, 0.08, up=(0, 1, 0), faces=(0, 2))
        for k in range(3):
            x = sx * (5.0 + k * 3.9)
            m.box(mats['solar'], (x, -12.5, 0.4), (3.6, 6.0, 0.06))
            m.box(mats['frame'], (x, -12.5, 0.35), (3.8, 6.2, 0.05))
            for r in (-1, 1):
                m.box(mats['plate'], (x, -12.5 + r * 1.5, 0.44), (3.6, 0.06, 0.02))
        m.strut(mats['frame'], (sx * 1.8, -17.5, 0.6), (sx * 4.5, -17.5, 3.5), 0.18)
        op.dish(m, mats['light'], op.place((sx * 4.6, -17.6, 3.6), (0.3, sx * 0.7, 0)), 1.6, 0.42)
    op.dish(m, mats['light'], op.place((0, -19.6, 0), (math.pi / 2, 0, 0)), 2.6, 0.7, segments=20)
    m.tube(mats['dark'], (0, -19, 0), (0, -21.2, 0), 0.12, segments=6)
    m.strut(mats['frame'], (0, -6, 1.4), (0, -6, 5.0), 0.1)
    m.strut(mats['frame'], (0, -14, -2.2), (0, -14, -5.0), 0.1)
    m.finish('HaloSpine', root)
    beacon('Beacon_top', (0, -6, 5.2), mats, root)
    beacon('Beacon_bottom', (0, -14, -5.2), mats, root)

    # The rotating ring: one mesh node, its axis the spine (local Y).
    r = op.Mesher()
    R = 15.0
    section = [(-1.4, -1.4), (-1.0, -1.8), (1.0, -1.8), (1.4, -1.4), (1.4, 1.4), (1.0, 1.8), (-1.0, 1.8), (-1.4, 1.4)]
    r.ring(mats['hull'], Matrix(), R, section, segments=48, smooth=False)
    for side in (-1, 1):
        r.ring(mats['accent'], Matrix(), R, [(-1.25, side * 1.82), (-0.95, side * 1.82), (-0.95, side * 1.86), (-1.25, side * 1.86)], segments=48, smooth=False)
    for k in range(48):
        a = 2 * math.pi * (k + 0.5) / 48
        out, tangent = Vector((math.cos(a), 0, math.sin(a))), Vector((-math.sin(a), 0, math.cos(a)))
        for side in (-1, 1):
            for t in (-0.55, 0, 0.55):
                r.panel(mats['window'], out * (R + 0.35) + tangent * t + Vector((0, side * 1.83, 0)), tangent * 0.38, out * 0.5)
        if k % 6 == 3:
            r.box(mats['plate'], None, (1.2, 4.2, 3.4), matrix=Matrix.Translation(out * (R + 1.8)) @ Matrix.Rotation(-a, 4, 'Y'), bevel=0.08)
            r.box(mats['blue'], None, (0.3, 0.3, 0.3), matrix=Matrix.Translation(out * (R + 2.45)))
            for side in (-1, 1):
                r.box(mats['accent'], None, (0.9, 0.06, 2.0), matrix=Matrix.Translation(out * (R + 1.8) + Vector((0, side * 2.12, 0))) @ Matrix.Rotation(-a, 4, 'Y'))
        elif k % 3 == 0:
            r.box(mats['plate'], None, (0.5, 2.6, 2.2), matrix=Matrix.Translation(out * (R + 1.55)) @ Matrix.Rotation(-a, 4, 'Y'))
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        out = Vector((math.cos(a), 0, math.sin(a)))
        r.tube(mats['plate'], out * 3.2, out * (R - 1.3), 0.6, segments=10)
        for side in (-1, 1):
            r.strut(mats['frame'], out * 3.4 + Vector((0, side * 1.2, 0)), out * (R - 1.3) + Vector((0, side * 1.2, 0)), 0.16)
        r.box(mats['dark'], None, (1.6, 2.2, 1.6), matrix=Matrix.Translation(out * (R - 1.6)) @ Matrix.Rotation(-a, 4, 'Y'))
    r.lathe(mats['plate'], [(2.7, -1.6), (3.4, -1.3), (3.4, 1.3), (2.7, 1.6)], op.place((0, 0, 0), ALONG_Y), segments=20)
    ring = r.finish('HaloRing', root)
    return root, ring


CAMERAS = {
    'vulcan': ((34, 46, 21), (0, -6, -1), 34),
    'ceres': ((40, 36, 20), (0, 2, -1), 34),
    'halo': ((50, 44, 24), (0, -2, 0), 34),
}


def render(path, camera_location, target, lens):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    world = bpy.data.worlds.new('Space')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.004, 0.006, 0.012, 1)
    scene.world = world
    # Key light from above the camera's shoulder, cool fill from below.
    for name, source, energy, color in (
        ('Sun', (0.9, 0.5, 0.8), 4.5, (1.0, 0.95, 0.88)),
        ('Fill', (-0.6, -0.2, -0.8), 0.8, (0.4, 0.6, 1.0)),
    ):
        light = bpy.data.objects.new(name, bpy.data.lights.new(name, 'SUN'))
        light.data.energy = energy
        light.data.color = color
        light.rotation_euler = Vector(source).to_track_quat('Z', 'Y').to_euler()
        scene.collection.objects.link(light)
    camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
    camera.data.lens = lens
    scene.collection.objects.link(camera)
    camera.location = camera_location
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = camera
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    parser.add_argument('--render')
    parser.add_argument('--only', choices=sorted(CAMERAS), help='build a single outpost')
    args = parser.parse_args(argv)
    os.makedirs(args.out, exist_ok=True)
    for name, build in (('vulcan', build_vulcan), ('ceres', build_ceres), ('halo', build_halo)):
        if args.only and args.only != name:
            continue
        build()
        bpy.ops.export_scene.gltf(filepath=os.path.join(args.out, f'{name}.glb'), export_format='GLB', export_yup=True,
                                  export_apply=True, export_cameras=False, export_lights=False)
        if args.render:
            os.makedirs(args.render, exist_ok=True)
            render(os.path.join(os.path.abspath(args.render), f'{name}.png'), *CAMERAS[name])


if __name__ == '__main__':
    main()
