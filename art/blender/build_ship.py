"""Builds the Apocalypse interceptor in Blender and exports it as GLB.

Run with Blender's Python module (pip package `bpy`):

    python art/blender/build_ship.py --variant gunship --out public/models --render previews/

Variants:
  gunship     heavy armoured hull, wide engine pods with forward mandibles
  interceptor slimmer hull, swept wings, compact pods

The model is about 12 m long. The game scales it; nothing here depends on
game units. Empties named gun_L/gun_R, engine_* and cockpit mark positions
the game reads after loading.
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

VARIANTS = {
    'gunship': {
        'width': 1.0,
        'height': 1.0,
        'pod_x': 2.35,
        'pod_width': 0.62,
        'mandibles': True,
        'wings': False,
        'seed': 7,
    },
    'interceptor': {
        'width': 0.82,
        'height': 0.85,
        'pod_x': 2.05,
        'pod_width': 0.46,
        'mandibles': False,
        'wings': True,
        'seed': 11,
    },
}


def build_materials():
    return {
        'hull': parts.material('Hull', (0.055, 0.06, 0.068), metallic=0.85, roughness=0.42),
        'plate': parts.material('ArmourPlate', (0.11, 0.115, 0.125), metallic=0.8, roughness=0.36),
        'dark': parts.material('DarkMachinery', (0.025, 0.027, 0.03), metallic=0.7, roughness=0.55),
        'accent': parts.material('AccentOrange', (0.75, 0.22, 0.04), metallic=0.3, roughness=0.45),
        'marking': parts.material('Marking', (0.6, 0.62, 0.64), metallic=0.2, roughness=0.5),
        'glass': parts.material('CanopyGlass', (0.012, 0.02, 0.03), metallic=0.6, roughness=0.05,
                                emission=(0.05, 0.25, 0.4), strength=0.15),
        'engine': parts.material('EngineGlow', (0.1, 0.4, 1.0), emission=(0.35, 0.75, 1.0), strength=25.0),
        'nav_red': parts.material('NavRed', (1.0, 0.05, 0.02), emission=(1.0, 0.05, 0.02), strength=30.0),
        'nav_green': parts.material('NavGreen', (0.05, 1.0, 0.2), emission=(0.05, 1.0, 0.2), strength=30.0),
        'nav_white': parts.material('NavWhite', (1.0, 1.0, 1.0), emission=(1.0, 1.0, 1.0), strength=20.0),
    }


def hull_stations(w, h):
    """(y, half width, top, bottom) from the tail to the nose."""
    return [
        (-5.0, 1.0 * w, 0.75 * h, -0.55 * h),
        (-4.1, 1.25 * w, 0.95 * h, -0.65 * h),
        (-2.7, 1.4 * w, 1.05 * h, -0.7 * h),
        (-1.2, 1.36 * w, 1.0 * h, -0.66 * h),
        (0.3, 1.22 * w, 0.92 * h, -0.6 * h),
        (1.7, 0.98 * w, 0.72 * h, -0.5 * h),
        (3.0, 0.72 * w, 0.5 * h, -0.4 * h),
        (4.1, 0.46 * w, 0.32 * h, -0.28 * h),
        (5.1, 0.24 * w, 0.16 * h, -0.16 * h),
        (5.9, 0.06 * w, 0.04 * h, -0.05 * h),
    ]


def build_hull(root, mats, cfg, rng):
    w, h = cfg['width'], cfg['height']
    hull_bm = parts.loft(parts.densify(hull_stations(w, h), 2))
    plates_source = hull_bm.copy()
    parts.link_mesh('Hull', hull_bm, mats['hull'], root)
    parts.armour_plates(plates_source, 'HullArmour', mats['plate'], root, rng, skip=0.1)
    plates_source.free()

    # Faceted cockpit canopy on the upper nose.
    canopy = parts.loft([
        (0.9, 0.38 * w, 1.02 * h, 0.78 * h),
        (1.9, 0.34 * w, 0.98 * h, 0.66 * h),
        (2.8, 0.2 * w, 0.76 * h, 0.5 * h),
        (3.35, 0.04 * w, 0.56 * h, 0.46 * h),
    ], flat_top=0.7)
    parts.link_mesh('Canopy', canopy, mats['glass'], root)
    parts.box('CanopyFrame', (0, 0.6, 1.0 * h), (0.86 * w, 0.18, 0.2), mats['dark'], root)
    for index, y in enumerate((1.55, 2.3)):
        parts.box(f'CanopyBar_{index}', (0, y, 0.93 * h - (y - 1.55) * 0.22), (0.72 * w - (y - 1.55) * 0.3, 0.06, 0.08), mats['dark'], root, bevel=0.01)

    # Chin sensor turret and a dorsal antenna.
    parts.box('ChinMount', (0, 2.6, -0.52 * h), (0.5, 0.7, 0.16), mats['plate'], root, bevel=0.03)
    parts.cylinder('ChinSensor', (0, 2.75, -0.66 * h), 0.18, 0.2, mats['dark'], root, rotation=(0, 0, 0), segments=16)
    parts.cylinder('Antenna', (0.3, -3.2, 1.55 * h), 0.015, 0.8, mats['dark'], root, rotation=(0.25, 0, 0), segments=6)

    # Dorsal spine and machinery on the rear deck.
    parts.box('Spine', (0, -2.2, 1.12 * h), (0.5, 3.6, 0.18), mats['plate'], root, bevel=0.04)
    parts.greebles('DeckMachinery', (-0.9 * w, -4.4), (0.9 * w, -0.6), 1.04 * h, 38, mats['dark'], root, rng, scale=0.22)
    parts.box('SpineBand', (0, -0.55, 1.13 * h), (0.52, 0.22, 0.2), mats['accent'], root, bevel=0.02)
    for side in (-1, 1):
        fin = bmesh.new()
        profile = [(-4.9, 0.0), (-3.4, 0.0), (-3.9, 0.85), (-4.7, 0.95)]
        verts = [fin.verts.new((0.0, y, z)) for y, z in profile]
        far = [fin.verts.new((0.07, y, z)) for y, z in profile]
        fin.faces.new(verts)
        fin.faces.new(list(reversed(far)))
        for i in range(len(profile)):
            j = (i + 1) % len(profile)
            fin.faces.new((verts[j], verts[i], far[i], far[j]))
        bmesh.ops.recalc_face_normals(fin, faces=fin.faces)
        fin_obj = parts.link_mesh(f'DorsalFin_{side}', fin, mats['plate'], root)
        fin_obj.location = (side * 0.55 * w, 0, 1.0 * h)
        fin_obj.rotation_euler = (0, side * 0.42, 0)


def build_main_engines(root, mats, cfg):
    w, h = cfg['width'], cfg['height']
    parts.box('EngineBlock', (0, -5.15, 0.08 * h), (1.9 * w, 0.5, 1.15 * h), mats['dark'], root, bevel=0.05)
    for index, side in enumerate((-1, 1)):
        x = side * 0.52 * w
        parts.cylinder(f'MainNozzle_{index}', (x, -5.55, 0.08 * h), 0.36 * h, 0.55, mats['hull'], root, radius_end=0.44 * h, cap=False)
        parts.cylinder(f'MainNozzleGlow_{index}', (x, -5.45, 0.08 * h), 0.31 * h, 0.04, mats['engine'], root)
        parts.socket(f'engine_main_{index}', (x, -5.85, 0.08 * h), root)


def build_pods(root, mats, cfg, rng):
    w, h = cfg['width'], cfg['height']
    pod_w = cfg['pod_width']
    for index, side in enumerate((-1, 1)):
        x = side * cfg['pod_x'] * w
        stations = [
            (-5.3, pod_w * 0.95, 0.5, -0.5),
            (-4.6, pod_w, 0.58, -0.58),
            (-1.0, pod_w, 0.58, -0.58),
            (1.2, pod_w * 0.9, 0.5, -0.5),
            (2.2, pod_w * 0.7, 0.36, -0.38),
        ]
        pod = parts.loft(parts.densify(stations, 2), x_offset=x, flat_top=0.8, flat_bottom=0.8)
        plates = pod.copy()
        parts.link_mesh(f'Pod_{index}', pod, mats['hull'], root)
        parts.armour_plates(plates, f'PodArmour_{index}', mats['plate'], root, rng, gap=0.05, lift=0.03, thickness=0.05, skip=0.15)
        plates.free()

        # Pylon joining the pod to the hull.
        inner = side * 1.1 * w
        outer = x - side * pod_w * 0.8
        pylon = [(inner, -4.0), (outer, -4.4), (outer, -0.8), (inner, 0.2)]
        if side < 0:
            pylon = list(reversed(pylon))
        parts.prism(f'Pylon_{index}', pylon, 0.26, mats['plate'], root, z=-0.18)

        # Angled shoulder armour bridging hull and pod: gives the heavy silhouette.
        shoulder = [(side * 0.9 * w, -3.6), (x, -4.2), (x + side * pod_w * 0.2, -1.4), (x - side * pod_w * 0.3, 0.9), (side * 1.0 * w, 1.4)]
        if side < 0:
            shoulder = list(reversed(shoulder))
        shoulder_obj = parts.prism(f'Shoulder_{index}', shoulder, 0.14, mats['plate'], root, z=0.0)
        shoulder_obj.location = (0, 0, 0.32)
        shoulder_obj.rotation_euler = (0, side * -0.1, 0)
        parts.greebles(f'ShoulderMachinery_{index}', (side * 1.3 * w if side > 0 else x, -3.2), (x if side > 0 else side * 1.3 * w, -1.0), 0.46, 8, mats['dark'], root, rng, scale=0.14)

        parts.cylinder(f'PodNozzle_{index}', (x, -5.6, 0.0), 0.36, 0.5, mats['hull'], root, radius_end=0.42, cap=False)
        parts.cylinder(f'PodNozzleGlow_{index}', (x, -5.5, 0.0), 0.32, 0.04, mats['engine'], root)
        parts.socket(f'engine_pod_{index}', (x, -5.9, 0.0), root)

        parts.vents(f'PodVents_{index}', (x + side * pod_w * 1.01, -3.6, 0.05), (0, 0.22, 0), 9, (0.04, 0.12, 0.6), mats['dark'], root)
        parts.box(f'PodStripe_{index}', (x, 1.3, 0.53), (pod_w * 1.25, 0.28, 0.06), mats['accent'], root, bevel=0.01)
        parts.greebles(f'PodMachinery_{index}', (x - pod_w * 0.6, -4.8), (x + pod_w * 0.6, -2.4), 0.6, 10, mats['dark'], root, rng, scale=0.16)

        nav = mats['nav_red'] if side < 0 else mats['nav_green']
        light = parts.cylinder(f'NavLight_{index}', (x + side * pod_w * 1.05, 0.2, 0.3), 0.06, 0.06, nav, root, segments=10)
        light.rotation_euler = (0, math.pi / 2, 0)

        if cfg['mandibles']:
            mandible = parts.loft([
                (1.6, pod_w * 0.55, 0.3, -0.42),
                (3.4, pod_w * 0.45, 0.22, -0.36),
                (4.6, pod_w * 0.3, 0.14, -0.26),
            ], x_offset=x - side * 0.15, flat_top=0.8, flat_bottom=0.8)
            mandible_plates = mandible.copy()
            parts.link_mesh(f'Mandible_{index}', mandible, mats['hull'], root)
            parts.armour_plates(mandible_plates, f'MandibleArmour_{index}', mats['plate'], root, rng, gap=0.04, lift=0.025, thickness=0.04, skip=0.0)
            mandible_plates.free()
            gun_x, gun_y, gun_z = x - side * 0.15, 4.6, -0.12
        else:
            gun_x, gun_y, gun_z = side * 0.62 * w, 3.0, -0.45 * h

        # Twin cannon barrels with a muzzle socket the game fires from.
        for barrel in (-1, 1):
            parts.cylinder(f'Barrel_{index}_{barrel}', (gun_x + barrel * 0.09, gun_y + 0.55, gun_z), 0.045, 1.3, mats['dark'], root, segments=12)
        parts.box(f'GunHousing_{index}', (gun_x, gun_y - 0.25, gun_z), (0.36, 0.7, 0.22), mats['plate'], root, bevel=0.03)
        parts.socket('gun_L' if side < 0 else 'gun_R', (gun_x, gun_y + 1.25, gun_z), root)


def build_wings(root, mats, cfg):
    if not cfg['wings']:
        return
    w = cfg['width']
    for index, side in enumerate((-1, 1)):
        outline = [(side * 1.1 * w, -3.8), (side * 4.1, -5.0), (side * 4.25, -4.3), (side * 1.15 * w, 0.6)]
        if side < 0:
            outline = list(reversed(outline))
        parts.prism(f'Wing_{index}', outline, 0.12, mats['plate'], root, z=-0.25)
        parts.box(f'WingTip_{index}', (side * 4.15, -4.6, -0.19), (0.12, 0.9, 0.2), mats['dark'], root)


def build_markings(root, mats):
    """Hull number on the left side, as real geometry so it exports."""
    curve = bpy.data.curves.new('HullNumberText', type='FONT')
    curve.body = 'PDW-01'
    curve.size = 0.32
    curve.extrude = 0.004
    text = bpy.data.objects.new('HullNumberText', curve)
    bpy.context.scene.collection.objects.link(text)
    text.location = (-1.43, -2.6, 0.05)
    text.rotation_euler = (math.pi / 2, 0, -math.pi / 2)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(text.evaluated_get(depsgraph))
    bpy.data.objects.remove(text)
    obj = bpy.data.objects.new('HullNumber', mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = (-1.44, -2.6, 0.05)
    obj.rotation_euler = (math.pi / 2, 0, -math.pi / 2)
    obj.data.materials.append(mats['marking'])
    obj.parent = root


def build_ship(variant):
    cfg = VARIANTS[variant]
    rng = parts.seeded(cfg['seed'])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    root = bpy.data.objects.new('Interceptor', None)
    bpy.context.scene.collection.objects.link(root)
    mats = build_materials()
    build_hull(root, mats, cfg, rng)
    build_main_engines(root, mats, cfg)
    build_pods(root, mats, cfg, rng)
    build_wings(root, mats, cfg)
    build_markings(root, mats)
    parts.socket('cockpit', (0, 1.6, 1.15 * cfg['height']), root)
    tail = parts.cylinder('NavLight_tail', (0, -4.6, 1.3), 0.05, 0.05, mats['nav_white'], root, segments=10)
    tail.rotation_euler = (0, 0, 0)
    return root


def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        export_yup=True,
        export_apply=True,
        export_extras=False,
        export_cameras=False,
        export_lights=False,
    )


def setup_render(width, height, samples):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.film_transparent = False
    world = bpy.data.worlds.new('Space')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.004, 0.006, 0.012, 1)
    scene.world = world

    def light(name, kind, location, rotation, energy, color):
        data = bpy.data.lights.new(name, kind)
        data.energy = energy
        data.color = color
        if kind == 'AREA':
            data.size = 6
        obj = bpy.data.objects.new(name, data)
        obj.location = location
        obj.rotation_euler = rotation
        scene.collection.objects.link(obj)

    light('Sun', 'SUN', (0, 0, 10), (0.75, 0.35, 0.9), 4.5, (1.0, 0.95, 0.88))
    light('Rim', 'AREA', (-6, -9, 5), (1.1, 0, -2.6), 2500, (0.55, 0.7, 1.0))
    light('EarthFill', 'AREA', (0, 0, -9), (math.pi, 0, 0), 900, (0.35, 0.55, 1.0))


def render_view(path, location, target):
    scene = bpy.context.scene
    camera = bpy.data.objects.get('PreviewCamera')
    if camera is None:
        camera = bpy.data.objects.new('PreviewCamera', bpy.data.cameras.new('PreviewCamera'))
        scene.collection.objects.link(camera)
        camera.data.lens = 55
    camera.location = location
    direction = Vector(target) - Vector(location)
    camera.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    scene.camera = camera
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    parser = argparse.ArgumentParser()
    parser.add_argument('--variant', choices=sorted(VARIANTS), default='gunship')
    parser.add_argument('--out', help='directory for the GLB')
    parser.add_argument('--render', help='directory for preview renders')
    parser.add_argument('--samples', type=int, default=48)
    args = parser.parse_args(argv)

    build_ship(args.variant)
    if args.out:
        export_glb(os.path.join(args.out, f'interceptor-{args.variant}.glb'))
    if args.render:
        os.makedirs(args.render, exist_ok=True)
        setup_render(1280, 720, args.samples)
        render_view(os.path.join(args.render, f'{args.variant}-front.png'), (9.5, 13, 5.5), (0, 0.5, 0))
        render_view(os.path.join(args.render, f'{args.variant}-rear.png'), (-10, -12, 6), (0, -0.5, 0))
        render_view(os.path.join(args.render, f'{args.variant}-top.png'), (0.01, -1, 30), (0, 0, 0))


if __name__ == '__main__':
    main()
