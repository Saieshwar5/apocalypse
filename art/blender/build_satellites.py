"""Builds the three artificial satellites and exports them as one GLB.

    python art/blender/build_satellites.py --out public/models --render art/renders

The file holds three root nodes: `Sat_Comms`, `Sat_Nav` and `Sat_Weather`,
each 6-12 m across. They are laid out side by side (for the preview render);
the game clones one root at a time and moves it to its own origin.

Axes, shared by all three so the game can orient them the same way:
  * -Z (Blender) is the Earth-facing side: dishes, antennas and sensors.
  * X is the solar wing axis. Every wing is a separate node named `Wing_*`
    whose origin lies on that axis, so the game can turn it towards the sun.
  * Y is the direction of travel.
"""

import argparse
import math
import os
import sys

import bpy  # noqa: I001  (bpy must load before bmesh)
import bmesh
from mathutils import Euler, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shipParts as parts  # noqa: E402

# Spacing between the three roots in the file; only matters for the render.
LAYOUT_STEP = 14.0


def materials():
    # Albedo stays below 0.5: the game renders with bloom, and bright
    # surfaces in direct sunlight blow out to white.
    return {
        'foil': parts.material('SatFoil', (0.36, 0.24, 0.06), metallic=0.55, roughness=0.42),
        'metal': parts.material('SatMetal', (0.3, 0.31, 0.33), metallic=0.5, roughness=0.5),
        'dark': parts.material('SatDark', (0.07, 0.075, 0.08), metallic=0.5, roughness=0.6),
        'white': parts.material('SatRadiator', (0.44, 0.44, 0.42), metallic=0.1, roughness=0.6),
        'solar': parts.material('SatSolar', (0.02, 0.05, 0.16), metallic=0.7, roughness=0.36),
    }


def root(name, index):
    obj = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = ((index - 1) * LAYOUT_STEP, 0, 0)
    return obj


def dish(name, centre, radius, depth, mat, parent, rotation=(0.0, 0.0, 0.0), segments=16, rings=4):
    """Shallow parabolic reflector opening towards local +Z.

    A single skin, drawn double-sided by the game, keeps the triangle count
    low; a thick dish would double it for an edge nobody sees.
    """
    bm = bmesh.new()
    centre_vert = bm.verts.new((0, 0, 0))
    loops = []
    for ring in range(1, rings + 1):
        r = radius * ring / rings
        z = depth * (ring / rings) ** 2
        loops.append([bm.verts.new((math.cos(2 * math.pi * i / segments) * r, math.sin(2 * math.pi * i / segments) * r, z))
                      for i in range(segments)])
    for i in range(segments):
        j = (i + 1) % segments
        bm.faces.new((centre_vert, loops[0][i], loops[0][j]))
        for a, b in zip(loops, loops[1:]):
            bm.faces.new((a[i], b[i], b[j], a[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = parts.link_mesh(name, bm, mat, parent, smooth=True)
    obj.location = centre
    obj.rotation_euler = rotation
    return obj


def solar_wing(name, side, attach_x, panels, panel_length, panel_width, mats, parent, tilt=0.0):
    """A wing of `panels` hinged panels reaching out along X from `attach_x`.

    Returns the wing's pivot node. Blue cells face +Z; the back is bare
    structure, which is what you see on a real array.
    """
    pivot = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(pivot)
    pivot.parent = parent
    pivot.location = (side * attach_x, 0, 0)
    pivot.rotation_euler = (tilt, 0, 0)
    yoke = 0.9
    parts.box(f'{name}_Yoke', (side * yoke / 2, 0, 0), (yoke, 0.09, 0.09), mats['metal'], pivot, bevel=0.0)
    gap = 0.12
    for index in range(panels):
        x = side * (yoke + panel_length / 2 + index * (panel_length + gap))
        parts.box(f'{name}_Cells_{index}', (x, 0, 0.02), (panel_length, panel_width, 0.04), mats['solar'], pivot, bevel=0.0)
        parts.box(f'{name}_Back_{index}', (x, 0, -0.02), (panel_length + 0.08, panel_width + 0.08, 0.04), mats['metal'], pivot, bevel=0.0)
        # Cell rows: thin dark strips break the blue into a believable grid.
        for row in (-1, 0, 1):
            parts.box(f'{name}_Grid_{index}_{row}', (x, row * panel_width / 4, 0.042), (panel_length, 0.03, 0.006), mats['dark'], pivot, bevel=0.0)
    return pivot


def build_comms(mats):
    """Geostationary-style relay: foil bus, big dish, two wings. About 11 m span."""
    sat = root('Sat_Comms', 0)
    parts.box('Comms_Bus', (0, 0, 0), (1.8, 2.0, 2.2), mats['foil'], sat, bevel=0.06)
    parts.box('Comms_Radiator_N', (0, 1.02, 0), (1.5, 0.05, 1.8), mats['white'], sat, bevel=0.0)
    parts.box('Comms_Radiator_S', (0, -1.02, 0), (1.5, 0.05, 1.8), mats['white'], sat, bevel=0.0)
    parts.box('Comms_Deck', (0, 0, -1.14), (1.9, 2.1, 0.08), mats['metal'], sat, bevel=0.0)
    # Main dish on the Earth face, tipped a little as if aimed at a ground station.
    aim = (math.pi + 0.22, 0.12, 0)
    parts.cylinder('Comms_DishMount', (0.05, 0, -1.45), 0.14, 0.6, mats['dark'], sat, rotation=(0, 0, 0), segments=8)
    dish('Comms_Dish', (0.1, 0.1, -1.72), 1.45, 0.42, mats['white'], sat, rotation=aim)
    feed_direction = Vector((0, 0, 1))
    feed_direction.rotate(Euler(aim))
    feed = Vector((0.1, 0.1, -1.72)) + feed_direction * 1.1
    parts.box('Comms_Feed', tuple(feed), (0.22, 0.22, 0.3), mats['dark'], sat, rotation=aim, bevel=0.0)
    for index in range(3):
        angle = index * 2 * math.pi / 3
        rim = Vector((math.cos(angle) * 1.3, math.sin(angle) * 1.3, 0.34))
        rim.rotate(Euler(aim))
        start = Vector((0.1, 0.1, -1.72)) + rim
        strut(f'Comms_FeedStrut_{index}', start, feed, 0.025, mats['dark'], sat)
    # Two small side reflectors and a thruster on the space-facing side.
    for side in (-1, 1):
        dish(f'Comms_SideDish_{side}', (0, side * 1.25, -0.7), 0.5, 0.14, mats['white'], sat,
             rotation=(math.pi + side * 0.9, 0, 0), segments=10, rings=2)
    parts.cylinder('Comms_Engine', (0, 0, 1.25), 0.22, 0.35, mats['dark'], sat, rotation=(0, 0, 0), segments=10, radius_end=0.38)
    for side in (-1, 1):
        solar_wing(f'Wing_Comms_{"L" if side < 0 else "R"}', side, 0.9, 2, 1.75, 1.9, mats, sat)
    return sat


def strut(name, start, end, radius, mat, parent):
    """Thin rod between two points."""
    start, end = Vector(start), Vector(end)
    direction = end - start
    obj = parts.cylinder(name, tuple((start + end) / 2), radius, direction.length, mat, parent, rotation=(0, 0, 0), segments=5)
    obj.rotation_euler = direction.to_track_quat('Z', 'Y').to_euler()
    return obj


def build_nav(mats):
    """Navigation satellite: boxy bus, long wings, a field of antennas. About 12 m span."""
    sat = root('Sat_Nav', 1)
    parts.box('Nav_Bus', (0, 0, 0.1), (1.6, 1.9, 2.4), mats['foil'], sat, bevel=0.05)
    parts.box('Nav_Panel_Front', (0, 0.97, 0.1), (1.3, 0.05, 2.0), mats['metal'], sat, bevel=0.0)
    parts.box('Nav_Panel_Back', (0, -0.97, 0.1), (1.3, 0.05, 2.0), mats['white'], sat, bevel=0.0)
    # Antenna deck facing Earth: a ring of helix elements round a centre mast.
    parts.box('Nav_AntennaDeck', (0, 0, -1.18), (2.1, 2.4, 0.12), mats['metal'], sat, bevel=0.03)
    for index in range(8):
        angle = index * math.pi / 4
        x, y = math.cos(angle) * 0.78, math.sin(angle) * 0.92
        parts.cylinder(f'Nav_Helix_{index}', (x, y, -1.62), 0.11, 0.8, mats['dark'], sat, rotation=(0, 0, 0), segments=6, radius_end=0.05)
    for index in range(4):
        angle = index * math.pi / 2 + math.pi / 4
        x, y = math.cos(angle) * 0.3, math.sin(angle) * 0.3
        parts.cylinder(f'Nav_HelixInner_{index}', (x, y, -1.74), 0.1, 1.0, mats['white'], sat, rotation=(0, 0, 0), segments=6, radius_end=0.05)
    parts.cylinder('Nav_Mast', (0.75, -0.95, -2.1), 0.03, 1.8, mats['metal'], sat, rotation=(0, 0, 0), segments=5)
    parts.box('Nav_MastTip', (0.75, -0.95, -3.0), (0.14, 0.14, 0.14), mats['dark'], sat, bevel=0.0)
    parts.cylinder('Nav_Engine', (0, 0, 1.42), 0.2, 0.3, mats['dark'], sat, rotation=(0, 0, 0), segments=10, radius_end=0.34)
    for side in (-1, 1):
        solar_wing(f'Wing_Nav_{"L" if side < 0 else "R"}', side, 0.8, 3, 1.35, 1.5, mats, sat)
    return sat


def build_weather(mats):
    """Small weather satellite: one panel, an instrument boom, a camera. About 7 m across."""
    sat = root('Sat_Weather', 2)
    parts.box('Weather_Bus', (0, 0, 0), (1.2, 1.3, 1.6), mats['foil'], sat, bevel=0.05)
    parts.box('Weather_Top', (0, 0, 0.83), (1.25, 1.35, 0.06), mats['white'], sat, bevel=0.0)
    parts.box('Weather_Deck', (0, 0, -0.83), (1.3, 1.4, 0.08), mats['metal'], sat, bevel=0.0)
    # Imager: a short telescope with a sun shade, looking down.
    parts.cylinder('Weather_Imager', (0.15, 0.2, -1.3), 0.32, 0.9, mats['white'], sat, rotation=(0, 0, 0), segments=12)
    parts.cylinder('Weather_Shade', (0.15, 0.2, -1.85), 0.34, 0.25, mats['dark'], sat, rotation=(0, 0, 0), segments=12, radius_end=0.44)
    parts.box('Weather_Sounder', (-0.3, -0.35, -1.05), (0.4, 0.4, 0.4), mats['dark'], sat, bevel=0.03)
    # Sensor boom on the side opposite the panel, braced like a light truss.
    boom_length = 3.4
    for offset in (-0.09, 0.09):
        parts.box(f'Weather_Boom_{offset > 0}', (-0.6 - boom_length / 2, offset, 0.3), (boom_length, 0.04, 0.04), mats['metal'], sat, bevel=0.0)
    for index in range(6):
        x = -0.75 - index * (boom_length - 0.3) / 5
        parts.box(f'Weather_BoomBrace_{index}', (x, 0, 0.3), (0.04, 0.22, 0.04), mats['metal'], sat, bevel=0.0)
    parts.box('Weather_Sensor', (-0.6 - boom_length - 0.2, 0, 0.3), (0.45, 0.32, 0.32), mats['white'], sat, bevel=0.03)
    parts.cylinder('Weather_SensorProbe', (-0.6 - boom_length - 0.75, 0, 0.3), 0.03, 0.7, mats['dark'], sat, rotation=(0, math.pi / 2, 0), segments=5)
    # Small dish for the downlink and a whip antenna.
    dish('Weather_Downlink', (-0.2, -0.85, -0.3), 0.4, 0.12, mats['white'], sat, rotation=(math.pi - 0.9, 0, 0), segments=10, rings=2)
    parts.cylinder('Weather_Whip', (0.4, -0.4, 1.5), 0.02, 1.3, mats['metal'], sat, rotation=(0, 0, 0), segments=5)
    solar_wing('Wing_Weather', 1, 0.6, 2, 1.3, 1.4, mats, sat, tilt=0.35)
    return sat


def build_satellites():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = materials()
    roots = [build_comms(mats), build_nav(mats), build_weather(mats)]
    bpy.context.view_layer.update()
    for sat in roots:
        triangles = 0
        low, high = Vector((1e9,) * 3), Vector((-1e9,) * 3)
        for obj in sat.children_recursive:
            if obj.type != 'MESH':
                continue
            triangles += sum(len(poly.vertices) - 2 for poly in obj.data.polygons)
            for vert in obj.data.vertices:
                point = sat.matrix_world.inverted() @ obj.matrix_world @ vert.co
                low = Vector(map(min, low, point))
                high = Vector(map(max, high, point))
        size = high - low
        print(f'{sat.name}: {triangles} triangles, {size.x:.1f} x {size.y:.1f} x {size.z:.1f} m')
    return roots


def render(path):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 600
    world = bpy.data.worlds.new('Space')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.004, 0.006, 0.012, 1)
    scene.world = world
    for name, kind, rotation, energy, color in (
        ('Sun', 'SUN', (-1.95, 0.0, 0.45), 4.5, (1.0, 0.95, 0.88)),
        ('Fill', 'SUN', (-0.9, 0.3, -1.0), 1.0, (0.4, 0.6, 1.0)),
    ):
        light = bpy.data.objects.new(name, bpy.data.lights.new(name, kind))
        light.data.energy = energy
        light.data.color = color
        light.rotation_euler = rotation
        scene.collection.objects.link(light)
    camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
    camera.data.lens = 50
    scene.collection.objects.link(camera)
    # From below the wing plane, so the Earth-facing instruments show. The
    # wings are turned to the sun (as the game does), which is on this side.
    for obj in bpy.data.objects:
        if obj.name.startswith('Wing_') and obj.type == 'EMPTY':
            obj.rotation_euler = (-2.2, 0, 0)
    camera.location = (-4, 53, -18)
    camera.rotation_euler = (Vector((0, 0, -0.6)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = camera
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    parser.add_argument('--render')
    args = parser.parse_args(argv)
    build_satellites()
    os.makedirs(args.out, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(args.out, 'satellites.glb'), export_format='GLB', export_yup=True,
                              export_apply=True, export_cameras=False, export_lights=False)
    if args.render:
        os.makedirs(args.render, exist_ok=True)
        render(os.path.join(args.render, 'satellites.png'))


if __name__ == '__main__':
    main()
