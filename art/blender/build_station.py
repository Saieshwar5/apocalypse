"""Builds the Aegis space station and exports it as GLB.

    python art/blender/build_station.py --out public/models --render art/renders

About 42 m across. The docking bay opens along +Y (which becomes -Z in the
game). `dock_port` marks where the interceptor parks and `Ring` is a
separate node the game spins. Guide lights along the bay are named
GuideLight_* so the game can blink them.
"""

import argparse
import math
import os
import sys

import bpy  # noqa: I001  (bpy must load before bmesh)
import bmesh
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shipParts as parts  # noqa: E402


def materials():
    return {
        'hull': parts.material('StationHull', (0.17, 0.18, 0.2), metallic=0.6, roughness=0.5),
        'plate': parts.material('StationPlate', (0.27, 0.28, 0.3), metallic=0.5, roughness=0.45),
        'dark': parts.material('StationDark', (0.06, 0.065, 0.07), metallic=0.6, roughness=0.6),
        'accent': parts.material('StationAccent', (0.75, 0.22, 0.04), metallic=0.3, roughness=0.5),
        'tank': parts.material('StationTank', (0.4, 0.41, 0.42), metallic=0.3, roughness=0.4),
        'solar': parts.material('SolarPanel', (0.02, 0.05, 0.16), metallic=0.8, roughness=0.25),
        'window': parts.material('StationWindow', (0.9, 0.8, 0.5), emission=(1.0, 0.82, 0.5), strength=2.5),
        'guide': parts.material('GuideLight', (0.2, 1.0, 0.5), emission=(0.2, 1.0, 0.5), strength=12.0),
        'beacon': parts.material('StationBeacon', (1.0, 0.1, 0.05), emission=(1.0, 0.1, 0.05), strength=20.0),
    }


def torus(name, major, minor, mat, parent, segments=48, ring_segments=10):
    bm = bmesh.new()
    rings = []
    for i in range(segments):
        angle = 2 * math.pi * i / segments
        centre = Vector((math.cos(angle) * major, 0, math.sin(angle) * major))
        ring = []
        for j in range(ring_segments):
            around = 2 * math.pi * j / ring_segments
            offset = centre.normalized() * math.cos(around) * minor + Vector((0, math.sin(around) * minor, 0))
            ring.append(bm.verts.new(centre + offset))
        rings.append(ring)
    for i in range(segments):
        a, b = rings[i], rings[(i + 1) % segments]
        for j in range(ring_segments):
            k = (j + 1) % ring_segments
            bm.faces.new((a[j], a[k], b[k], b[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return parts.link_mesh(name, bm, mat, parent, smooth=True)


def build_station():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = materials()
    rng = parts.seeded(21)
    root = bpy.data.objects.new('Station', None)
    bpy.context.scene.collection.objects.link(root)

    # Central hub along the Y axis, armour-plated like the interceptor.
    hub_stations = [(-9, 2.6, 2.6, -2.6), (-7, 3.4, 3.4, -3.4), (5, 3.4, 3.4, -3.4), (8, 2.8, 2.8, -2.8)]
    hub = parts.loft(parts.densify(hub_stations, 3), flat_top=0.6, flat_bottom=0.6)
    plates = hub.copy()
    parts.link_mesh('Hub', hub, mats['hull'], root)
    parts.armour_plates(plates, 'HubPlates', mats['plate'], root, rng, gap=0.12, lift=0.05, thickness=0.1, skip=0.12)
    plates.free()
    parts.greebles('HubMachinery', (-2.4, -8), (2.4, 4), 3.45, 40, mats['dark'], root, rng, scale=0.5)
    for index, y in enumerate((-5.5, -2.5, 0.5, 3.5)):
        for side in (-1, 1):
            parts.box(f'Window_{index}_{side}', (side * 3.42, y, 0.6), (0.08, 1.4, 0.35), mats['window'], root, bevel=0.0)

    # Docking bay: an open frame at the front of the hub, sized for the
    # interceptor (about 6 m wide, 3 m tall with fins, 12 m long).
    for side in (-1, 1):
        parts.box(f'BayWall_{side}', (side * 4.4, 14, 0.3), (0.6, 12, 5.4), mats['plate'], root, bevel=0.08)
        parts.box(f'BayRail_{side}', (side * 4.06, 14, -1.9), (0.1, 11.6, 0.12), mats['accent'], root, bevel=0.0)
        for light in range(7):
            parts.box(f'GuideLight_{side}_{light}', (side * 4.05, 9 + light * 1.7, 1.6), (0.08, 0.6, 0.22), mats['guide'], root, bevel=0.0)
    parts.box('BayRoof', (0, 14, 3.0), (9.4, 12, 0.4), mats['plate'], root, bevel=0.08)
    parts.box('BayFloor', (0, 14, -2.4), (9.4, 12, 0.4), mats['dark'], root, bevel=0.08)
    parts.box('BayBack', (0, 8.2, 0.3), (8.8, 0.4, 5.4), mats['dark'], root, bevel=0.05)
    parts.box('DockClamp', (0, 11, -2.1), (2.0, 3.0, 0.3), mats['accent'], root, bevel=0.05)
    parts.socket('dock_port', (0, 14.5, -0.9), root)

    # Propellant tanks under the hub.
    for index, y in enumerate((-6, -1.5, 3)):
        for side in (-1, 1):
            sphere = bmesh.new()
            bmesh.ops.create_uvsphere(sphere, u_segments=20, v_segments=10, radius=1.9)
            tank = parts.link_mesh(f'Tank_{index}_{side}', sphere, mats['tank'], root, smooth=True)
            tank.location = (side * 2.3, y, -4.6)
        parts.box(f'TankStrap_{index}', (0, y, -4.0), (6.4, 0.3, 0.3), mats['accent'], root)

    # Solar wings on long trusses.
    for side in (-1, 1):
        parts.box(f'Truss_{side}', (side * 11, -3, 0), (16, 0.5, 0.5), mats['dark'], root, bevel=0.05)
        for index, x in enumerate((7.5, 11.5, 15.5)):
            parts.box(f'Solar_{side}_{index}', (side * x, -3, 0), (3.4, 9.5, 0.08), mats['solar'], root, bevel=0.0)
            parts.box(f'SolarFrame_{side}_{index}', (side * x, -3, -0.06), (3.6, 0.2, 0.06), mats['plate'], root, bevel=0.0)

    # Habitat ring, a separate node so the game can spin it about the hub axis.
    ring = bpy.data.objects.new('Ring', None)
    bpy.context.scene.collection.objects.link(ring)
    ring.parent = root
    ring.location = (0, -5, 0)
    torus('RingTube', 8.5, 0.9, mats['plate'], ring)
    for index in range(4):
        angle = index * math.pi / 2 + math.pi / 4
        spoke = parts.box(f'Spoke_{index}', (math.cos(angle) * 5.6, 0, math.sin(angle) * 5.6), (5.8, 0.45, 0.45), mats['dark'], ring)
        spoke.rotation_euler = (0, -angle, 0)
    for index in range(12):
        angle = index * math.pi / 6
        light = parts.box(f'RingWindow_{index}', (math.cos(angle) * 9.42, 0, math.sin(angle) * 9.42), (0.08, 0.9, 0.3), mats['window'], ring, bevel=0.0)
        light.rotation_euler = (0, -angle, 0)

    # Antenna mast and beacons.
    parts.cylinder('Mast', (0, -8, 6), 0.12, 6, mats['dark'], root, rotation=(0, 0, 0), segments=8)
    parts.cylinder('Dish', (0, -8, 9.2), 1.6, 0.5, mats['plate'], root, rotation=(0, 0, 0), radius_end=0.2, segments=20)
    parts.box('Beacon_top', (0, -8, 9.8), (0.25, 0.25, 0.25), mats['beacon'], root, bevel=0.0)
    parts.box('Beacon_bottom', (0, 2, -6.7), (0.25, 0.25, 0.25), mats['beacon'], root, bevel=0.0)
    return root


def render(path):
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
    for name, kind, rotation, energy, color in (
        ('Sun', 'SUN', (0.8, 0.3, 0.9), 4.5, (1.0, 0.95, 0.88)),
        ('Fill', 'SUN', (2.6, 0.2, -1.2), 0.8, (0.4, 0.6, 1.0)),
    ):
        light = bpy.data.objects.new(name, bpy.data.lights.new(name, kind))
        light.data.energy = energy
        light.data.color = color
        light.rotation_euler = rotation
        scene.collection.objects.link(light)
    camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
    camera.data.lens = 40
    scene.collection.objects.link(camera)
    camera.location = (34, 44, 20)
    camera.rotation_euler = (Vector((0, 2, 0)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = camera
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    parser.add_argument('--render')
    args = parser.parse_args(argv)
    build_station()
    os.makedirs(args.out, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(args.out, 'station.glb'), export_format='GLB', export_yup=True,
                              export_apply=True, export_cameras=False, export_lights=False)
    if args.render:
        os.makedirs(args.render, exist_ok=True)
        render(os.path.join(args.render, 'station.png'))


if __name__ == '__main__':
    main()
