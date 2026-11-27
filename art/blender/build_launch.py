"""Builds the launch booster and launch pad for the Apocalypse launch cinematic.

    python art/blender/build_launch.py --out public/models --render previews/

Outputs booster.glb (the rocket the interceptor rides into orbit) and
launchpad.glb (pad, service tower, lightning masts, tanks). Blender units are
metres; the interceptor is about 12 m long and sits on top of the booster,
nose up, on the adapter ring at `payload_mount`.
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

BOOSTER_RADIUS = 2.1
CORE_HEIGHT = 30.0


def booster_materials():
    return {
        'white': parts.material('BoosterWhite', (0.78, 0.79, 0.8), metallic=0.1, roughness=0.55),
        'band': parts.material('BoosterBand', (0.06, 0.065, 0.07), metallic=0.5, roughness=0.5),
        'orange': parts.material('BoosterOrange', (0.72, 0.24, 0.05), metallic=0.2, roughness=0.5),
        'metal': parts.material('EngineMetal', (0.22, 0.22, 0.23), metallic=0.9, roughness=0.35),
        'soot': parts.material('Soot', (0.03, 0.03, 0.03), metallic=0.3, roughness=0.8),
        'marking': parts.material('BoosterMarking', (0.05, 0.05, 0.06), metallic=0.1, roughness=0.6),
    }


def pad_materials():
    return {
        'concrete': parts.material('Concrete', (0.42, 0.41, 0.39), roughness=0.9),
        'steel': parts.material('TowerSteel', (0.55, 0.16, 0.08), metallic=0.6, roughness=0.55),
        'grey': parts.material('PadGrey', (0.25, 0.26, 0.27), metallic=0.6, roughness=0.5),
        'white': parts.material('TankWhite', (0.75, 0.76, 0.77), metallic=0.2, roughness=0.45),
        'lamp': parts.material('FloodLamp', (1.0, 0.95, 0.85), emission=(1.0, 0.92, 0.78), strength=3.0),
        'warning': parts.material('WarningLight', (1.0, 0.1, 0.05), emission=(1.0, 0.1, 0.05), strength=20.0),
    }


def build_engine_cluster(prefix, z, radius, mats, parent, count=5):
    """Engine bells under a stage. Socket empties mark where flames attach."""
    positions = [(0.0, 0.0)] + [
        (math.cos(i * 2 * math.pi / (count - 1)) * radius * 0.55, math.sin(i * 2 * math.pi / (count - 1)) * radius * 0.55)
        for i in range(count - 1)
    ]
    for index, (x, y) in enumerate(positions):
        parts.cylinder(f'{prefix}Bell_{index}', (x, y, z - 1.0), radius * 0.2, 1.8, mats['metal'], parent,
                       rotation=(0, 0, 0), radius_end=radius * 0.12, cap=False)
        parts.socket(f'{prefix.lower()}_flame_{index}', (x, y, z - 1.95), parent)
    parts.cylinder(f'{prefix}HeatShield', (0, 0, z - 0.05), radius * 0.98, 0.3, mats['soot'], parent, rotation=(0, 0, 0), segments=32)


def build_booster(out_dir):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = booster_materials()
    root = bpy.data.objects.new('Booster', None)
    bpy.context.scene.collection.objects.link(root)

    # Core stage with painted bands.
    parts.cylinder('Core', (0, 0, CORE_HEIGHT / 2), BOOSTER_RADIUS, CORE_HEIGHT, mats['white'], root, rotation=(0, 0, 0), segments=40)
    for index, (z, height, mat) in enumerate([(1.2, 2.4, 'band'), (13.0, 0.6, 'band'), (22.5, 1.2, 'orange'), (29.4, 1.2, 'band')]):
        parts.cylinder(f'Band_{index}', (0, 0, z), BOOSTER_RADIUS + 0.02, height, mats[mat], root, rotation=(0, 0, 0), segments=40)

    # Interstage and payload adapter: a cone narrowing to the ship's tail.
    parts.cylinder('Adapter', (0, 0, CORE_HEIGHT + 1.1), BOOSTER_RADIUS, 2.2, mats['band'], root, rotation=(0, 0, 0),
                   radius_end=1.5, segments=40)
    parts.cylinder('AdapterRing', (0, 0, CORE_HEIGHT + 2.3), 1.55, 0.25, mats['metal'], root, rotation=(0, 0, 0), segments=40)
    parts.socket('payload_mount', (0, 0, CORE_HEIGHT + 2.45), root)

    # Grid fins near the top, tail fins at the bottom.
    for index in range(4):
        angle = index * math.pi / 2 + math.pi / 4
        x, y = math.cos(angle) * (BOOSTER_RADIUS + 0.55), math.sin(angle) * (BOOSTER_RADIUS + 0.55)
        fin = parts.box(f'GridFin_{index}', (x, y, CORE_HEIGHT - 2.0), (1.0, 0.12, 1.2), mats['metal'], root,
                        rotation=(0, 0, angle + math.pi / 2), bevel=0.02)
        tail = bmesh.new()
        profile = [(0.0, 0.0), (2.2, 0.0), (1.6, 3.6), (0.0, 5.2)]
        near = [tail.verts.new((BOOSTER_RADIUS - 0.1 + px, -0.08, pz)) for px, pz in profile]
        far = [tail.verts.new((BOOSTER_RADIUS - 0.1 + px, 0.08, pz)) for px, pz in profile]
        tail.faces.new(near)
        tail.faces.new(list(reversed(far)))
        for i in range(len(profile)):
            j = (i + 1) % len(profile)
            tail.faces.new((near[j], near[i], far[i], far[j]))
        bmesh.ops.recalc_face_normals(tail, faces=tail.faces)
        tail_obj = parts.link_mesh(f'TailFin_{index}', tail, mats['band'], root)
        tail_obj.rotation_euler = (0, 0, angle)
        del fin

    build_engine_cluster('Core', 0.0, BOOSTER_RADIUS, mats, root)

    # Two strap-on boosters that burn out and fall away first.
    for index, side in enumerate((-1, 1)):
        strap = bpy.data.objects.new(f'StrapOn_{index}', None)
        bpy.context.scene.collection.objects.link(strap)
        strap.parent = root
        strap.location = (side * (BOOSTER_RADIUS + 1.25), 0, 0)
        parts.cylinder(f'StrapBody_{index}', (0, 0, 9.5), 1.05, 19, mats['white'], strap, rotation=(0, 0, 0), segments=28)
        parts.cylinder(f'StrapNose_{index}', (0, 0, 20.4), 1.05, 2.8, mats['white'], strap, rotation=(0, 0, 0), radius_end=0.05, segments=28)
        parts.cylinder(f'StrapBand_{index}', (0, 0, 17.5), 1.07, 0.8, mats['orange'], strap, rotation=(0, 0, 0), segments=28)
        parts.cylinder(f'StrapBell_{index}', (0, 0, -1.0), 0.55, 1.8, mats['metal'], strap, rotation=(0, 0, 0), radius_end=0.35, cap=False)
        parts.socket(f'strap_flame_{index}', (0, 0, -1.95), strap)
        for strut_z in (3.0, 16.0):
            parts.box(f'Strut_{index}_{strut_z}', (-side * 0.85, 0, strut_z), (0.7, 0.3, 0.3), mats['band'], strap)

    build_text('PDW', (0, -BOOSTER_RADIUS - 0.03, 17.0), mats['marking'], root, size=1.6, rotation=(math.pi / 2, 0, 0))
    build_text('APOCALYPSE', (0, -BOOSTER_RADIUS - 0.03, 8.0), mats['marking'], root, size=0.9, rotation=(math.pi / 2, math.pi / 2, 0))

    export(os.path.join(out_dir, 'booster.glb'))
    return root


def build_text(body, location, mat, parent, size, rotation):
    curve = bpy.data.curves.new(f'Text_{body}', type='FONT')
    curve.body = body
    curve.size = size
    curve.align_x = 'CENTER'
    curve.extrude = 0.01
    text = bpy.data.objects.new(f'Text_{body}', curve)
    bpy.context.scene.collection.objects.link(text)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(text.evaluated_get(depsgraph))
    bpy.data.objects.remove(text)
    obj = bpy.data.objects.new(f'Marking_{body}', mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = rotation
    obj.data.materials.append(mat)
    obj.parent = parent


def lattice_tower(name, base, width, height, mats, parent, levels):
    """Square truss tower: four legs, horizontal rings and X bracing."""
    bm = bmesh.new()
    half = width / 2
    level_height = height / levels

    def beam(start, end, thickness=0.22):
        start, end = Vector(start), Vector(end)
        direction = end - start
        length = direction.length
        result = bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(thickness, thickness, length), verts=result['verts'])
        rotation = direction.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=rotation, verts=result['verts'])
        bmesh.ops.translate(bm, vec=(start + end) / 2, verts=result['verts'])

    corners = [(-half, -half), (half, -half), (half, half), (-half, half)]
    for x, y in corners:
        beam((base[0] + x, base[1] + y, 0), (base[0] + x, base[1] + y, height), 0.45)
    for level in range(levels + 1):
        z = level * level_height
        for i in range(4):
            (x1, y1), (x2, y2) = corners[i], corners[(i + 1) % 4]
            beam((base[0] + x1, base[1] + y1, z), (base[0] + x2, base[1] + y2, z), 0.3)
            if level < levels:
                beam((base[0] + x1, base[1] + y1, z), (base[0] + x2, base[1] + y2, z + level_height))
                beam((base[0] + x2, base[1] + y2, z), (base[0] + x1, base[1] + y1, z + level_height))
    return parts.link_mesh(name, bm, mats['steel'], parent)


def build_pad(out_dir):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = pad_materials()
    root = bpy.data.objects.new('LaunchPad', None)
    bpy.context.scene.collection.objects.link(root)

    # Concrete pad with a flame trench under the rocket.
    # Deck top sits 0.2 m above the ground so the two surfaces never overlap.
    parts.box('PadDeck', (0, 0, -0.4), (44, 44, 1.2), mats['concrete'], root, bevel=0.1)
    parts.box('LaunchMount', (0, 0, 1.1), (10, 10, 1.8), mats['grey'], root, bevel=0.08)
    parts.box('FlameTrench', (0, 16, 0.25), (8, 22, 0.2), parts.material('TrenchSoot', (0.06, 0.06, 0.06), roughness=0.9), root)
    parts.socket('rocket_base', (0, 0, 2.0), root)

    # Service tower beside the rocket, with swing arms reaching across.
    tower_x = -10.0
    lattice_tower('ServiceTower', (tower_x, 0), 6.0, 46.0, mats, root, levels=12)
    for index, z in enumerate((14.0, 26.0, 33.5)):
        arm = parts.box(f'SwingArm_{index}', (tower_x + 5.2, 0, z), (5.2, 1.4, 1.0), mats['grey'], root, bevel=0.05)
        arm.name = f'SwingArm_{index}'
        parts.socket(f'swing_arm_{index}', (tower_x + 3.0, 0, z), root)
    parts.box('TowerTop', (tower_x, 0, 46.8), (7, 7, 1.6), mats['grey'], root)
    for index, z in enumerate((47.8, 30.0, 12.0)):
        parts.cylinder(f'TowerWarning_{index}', (tower_x + 3.2, 3.2, z), 0.25, 0.4, mats['warning'], root, rotation=(0, 0, 0), segments=10)

    # Lightning masts at the corners of the pad.
    for index, (x, y) in enumerate(((18, 18), (-18, 18), (18, -18), (-18, -18))):
        parts.cylinder(f'LightningMast_{index}', (x, y, 30), 0.35, 60, mats['grey'], root, rotation=(0, 0, 0), segments=10, radius_end=0.12)
        parts.cylinder(f'MastLight_{index}', (x, y, 60.3), 0.3, 0.4, mats['warning'], root, rotation=(0, 0, 0), segments=10)

    # Floodlight banks facing the rocket.
    for index, (x, y) in enumerate(((20, -6), (16, 14), (-4, -20))):
        parts.cylinder(f'FloodPole_{index}', (x, y, 6), 0.2, 12, mats['grey'], root, rotation=(0, 0, 0), segments=8)
        lamp = parts.box(f'FloodLamp_{index}', (x, y, 12.2), (2.4, 0.3, 1.2), mats['lamp'], root, bevel=0.02)
        lamp.rotation_euler = (0.3, 0, math.atan2(-y, -x) + math.pi / 2)

    # Propellant tanks off to one side.
    for index, (x, y, radius) in enumerate(((-26, -18, 4.0), (-34, -10, 3.2), (-30, 6, 3.6))):
        sphere = bmesh.new()
        bmesh.ops.create_uvsphere(sphere, u_segments=24, v_segments=12, radius=radius)
        tank = parts.link_mesh(f'Tank_{index}', sphere, mats['white'], root, smooth=True)
        tank.location = (x, y, radius + 1.2)
        parts.box(f'TankStand_{index}', (x, y, 0.6), (radius * 1.2, radius * 1.2, 1.2), mats['grey'], root)

    export(os.path.join(out_dir, 'launchpad.glb'))
    return root


def export(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True,
                              export_cameras=False, export_lights=False)


def render_preview(out_dir, render_dir):
    """Loads both exports with the ship on top and renders a check image."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for name in ('launchpad.glb', 'booster.glb'):
        bpy.ops.import_scene.gltf(filepath=os.path.join(out_dir, name))
    booster = bpy.data.objects['Booster']
    booster.location = (0, 0, 2.0)
    ship_path = os.path.join(out_dir, 'interceptor.glb')
    if os.path.exists(ship_path):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=ship_path)
        imported = [obj for obj in bpy.data.objects if obj not in before]
        holder = bpy.data.objects.new('ShipHolder', None)
        bpy.context.scene.collection.objects.link(holder)
        for obj in imported:
            if obj.parent is None:
                obj.parent = holder
        # Nose up: the ship's +Y (nose) turns to +Z; its tail (y = -5.9) rests on the adapter.
        holder.rotation_euler = (math.pi / 2, 0, 0)
        holder.location = (0, 0, 2.0 + CORE_HEIGHT + 2.45 + 5.9)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 960
    scene.render.resolution_y = 1080
    world = bpy.data.worlds.new('Dawn')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.35, 0.45, 0.6, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
    scene.world = world
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 4
    sun.data.color = (1.0, 0.8, 0.6)
    sun.rotation_euler = (1.1, 0, 2.4)
    scene.collection.objects.link(sun)
    ground = bmesh.new()
    bmesh.ops.create_grid(ground, x_segments=1, y_segments=1, size=400)
    parts.link_mesh('Ground', ground, parts.material('Ground', (0.32, 0.3, 0.24), roughness=1.0))
    camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
    camera.data.lens = 28
    scene.collection.objects.link(camera)
    camera.location = (48, -62, 14)
    camera.rotation_euler = (Vector((0, 0, 22)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = camera
    os.makedirs(render_dir, exist_ok=True)
    scene.render.filepath = os.path.join(render_dir, 'launch-pad.png')
    bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    parser.add_argument('--render')
    args = parser.parse_args(argv)
    build_booster(args.out)
    build_pad(args.out)
    if args.render:
        render_preview(args.out, args.render)


if __name__ == '__main__':
    main()
