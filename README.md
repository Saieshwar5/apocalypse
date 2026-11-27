# Apocalypse

A realistic 3D browser game. You launch a single interceptor from Earth and
defend the planet from waves of incoming asteroids. Small rocks dent the
planet; giants can end it.

This is the first playable version. The full design (priority sites, the space
base, the orbit with danger and safe zones, other solar systems and online
play) is in the project's game design document and will be built in stages.

## Play it locally

Requires Node.js 20 or newer and a browser with WebGL 2.

```bash
npm install
```

```bash
npm run dev
```

Then open the address Vite prints (usually http://localhost:5173) and click
**Launch interceptor**. The game captures the mouse; press Esc to pause.

## Controls

| Input | Action |
| --- | --- |
| Mouse | Steer (pitch and yaw) |
| Left click or Space | Laser (overheats if held too long) |
| F or right click | Missile at the locked target |
| W / S | Thrust / brake |
| A / D | Strafe |
| Q / E | Roll |
| Shift | Boost |
| Tab | Tactical map (time slows; mouse rotates the view) |
| C | Switch between chase and cockpit camera |
| M | Sound on or off |
| Enter | Skip the launch |
| Esc | Pause |

## What is in this version

- Realistic Earth: day and night sides, city lights, clouds, ocean sun glint,
  terrain relief, an atmosphere halo with orange twilight, and a tilted,
  rotating axis.
- A launch cinematic of about 26 seconds (Enter skips it). At the pad, at real
  scale and at sunrise: countdown, swing arms retracting, ignition with steam
  and smoke, liftoff, strap-on booster separation. Then in orbit: main engine
  cut-off, booster separation and the interceptor lighting its engines.
- The interceptor, booster rocket and launch pad are 3D models built in
  Blender from scripts in `art/blender` (see below).
- Free flight with a chase camera and a cockpit camera.
- Asteroids in four sizes (small, medium, large, giant) and three materials:
  rock, iron (resists lasers) and ice (fast and fragile). Their shapes are
  generated, with craters.
- Damage scaled by size: impacts leave glowing craters, black out city lights
  nearby and report the coordinates.
- Laser with heat and range: full damage within about 32,000 km, weaker
  further out, gone at about 108,000 km; bolts visibly thin out with range.
  Lasers split large rocks into fragments; homing missiles destroy them whole.
- Danger to your own ship: missile blasts hurt you if the target is closer
  than the blast radius ("DANGER CLOSE" warning), destroying a big rock at
  point-blank range throws shrapnel, and ramming rocks hurts. A shield absorbs
  damage first and recharges after 3 seconds without hits; the hull does not
  recharge. A collision alert warns when a rock's path will hit you.
- Hit feedback: hit marker on the reticle, the asteroid flashes, scorch marks
  stay where shots landed, rock chips fly, damage numbers rise (white solid,
  amber weak at range, grey resisted by iron), health bars on damaged rocks,
  a kill confirmation with score, and different sounds for rock, iron and ice.
- Aiming: an aim-ahead marker shows where to shoot a moving target, the
  reticle colour shows range, and it closes into a diamond when on target.
- Threat awareness: speed trails behind asteroids, path lines to their impact
  points, pulsing impact markers with countdowns on the globe, fire and glow
  when they enter the atmosphere, glints so distant rocks stay visible,
  distances and speeds in km and km/s, radar heading ticks, warning beeps,
  and space dust that shows your own speed.
- Radar, threat list ranked by urgency, on-screen target markers, arrows
  pointing to threats outside the view, and a tactical map.
- Priority sites: six cities (Mumbai, New York, São Paulo, Lagos, London,
  Sydney), the Launch Complex and the Deep-Space Radar in Antarctica. Each has
  health, a marker and label on the globe and a row in the HUD. Asteroids
  heading for a site are flagged with the site's name and a countdown, and
  from wave 2 some are aimed at sites. Losing the Launch Complex stops missile
  resupply; losing the radar halves scanner range. Survivors repair a little
  between waves.
- Lasting damage on Earth: every impact leaves a scar, a fire and a smoke
  pall visible from orbit; a destroyed city goes dark.
- 3D scanner in place of the flat radar: contacts sit on stalks above or
  below the ship's wing plane, with Earth shown the same way.
- Atmosphere: a pull-up warning, then heating, shaking, a roar and shield and
  hull damage inside it, and break-up if the ship goes too deep. The HUD shows
  distance from Earth's centre, above the surface and above the atmosphere.
- One ship: if it is destroyed the mission fails. Hits flash red on the side
  of the screen they came from; a failing hull sparks, smokes and sounds an
  alarm. Flying too far out hands control to an autopilot that returns.
- Waves from one to three attack fronts, with a giant every fifth wave.
  A supply rocket delivers 3 missiles after each wave.
- Synthesised sound effects (no audio files yet).

## Checks

```bash
npm run check
```

```bash
npm test
```

```bash
npm run build
```

`npm test` covers the game rules: waves, damage, scoring, threat ranking,
wave timing, laser range, aim-ahead, blasts, shield and hull, units, priority
sites, atmosphere zones and the scanner projection. In development builds the running game is available as
`window.apocalypse` so browser automation can drive it; production builds do
not expose it.

URL options for testing: `?autostart` skips the menu and mouse capture, and
`?skipLaunch` skips the launch sequence.

Distances use 1 world unit = 637 km (Earth's radius is 10 units). Time is
compressed 150 times, so speeds read as realistic impact speeds (about
10 to 30 km/s) while a wave still lasts about a minute.

## 3D models (Blender)

The models in `public/models` are generated by Python scripts, so they can be
changed and rebuilt rather than edited by hand:

| Script | Output |
| --- | --- |
| `art/blender/build_ship.py` | `interceptor.glb`, in two variants: `gunship` (used) and `interceptor` |
| `art/blender/build_launch.py` | `booster.glb` and `launchpad.glb` |
| `art/blender/shipParts.py` | Shared mesh helpers: lofted hulls, armour plating, greebles |

They need Blender's Python module, which can be installed with pip in a
virtual environment:

```bash
python3 -m venv .blender-venv
```

```bash
.blender-venv/bin/pip install bpy==5.3.0
```

```bash
.blender-venv/bin/python art/blender/build_ship.py --variant gunship --out /tmp/models --render art/renders
```

```bash
cp /tmp/models/interceptor-gunship.glb public/models/interceptor.glb
```

```bash
.blender-venv/bin/python art/blender/build_launch.py --out public/models --render art/renders
```

Tested with bpy 5.3.0 on Python 3.13. The export prints Draco and
MeshOptimizer errors; they are harmless because compression is not used.
Models keep named empties (sockets) that the game reads: `gun_L`, `gun_R`,
`engine_*`, `cockpit` on the ship; `payload_mount`, `core_flame_*`,
`strap_flame_*` and `StrapOn_*` on the booster; `rocket_base` and
`SwingArm_*` on the pad. Renaming them breaks loading with a clear error.
Preview renders are in `art/renders`.

## Technology

| Part | Choice |
| --- | --- |
| Language | TypeScript 7 |
| 3D | Three.js 0.187 (WebGL renderer, custom GLSL shaders) |
| Post-processing | Three.js bloom, ACES tone mapping |
| Build and dev server | Vite 8 |
| Tests | Vitest 5 |
| Sound | Web Audio API (Howler.js planned for recorded audio) |
| 3D models | Blender 5.3 (bpy), exported as glTF binary (GLB) |

Collisions use simple sphere tests; there is no physics engine.

## Project layout

```
src/
  logic/      Game rules with no graphics: asteroid classes, waves, damage, scoring,
              threats, ballistics (range, aim-ahead, blasts), ship defence, units
  game/       Game phases, play session, wave timing, targeting, combat, screens
  launch/     Launch cinematic: pad scene, rocket effects, orbit insertion
  scene/      Renderer, Earth and its shaders, stars and sun
  ship/       Interceptor model wrapper, shield and flight controller
  asteroids/  Asteroid shapes and the asteroid field
  weapons/    Laser, missiles, hit tests
  effects/    Explosions, scorch marks, space dust
  hud/        3D scanner, target markers, reticle, hit feedback, status panels
  sites/      Priority sites: health, threats, globe markers
  camera/     Chase and cockpit camera
  input/      Keyboard and mouse
  audio/      Synthesised sound effects
public/textures/  Earth textures
public/models/    Ship, booster and launch pad (GLB, built in Blender)
art/blender/      Scripts that build the models
art/renders/      Preview renders of the models
```

## Credits

The ship, booster and launch pad are original models made for this project.
Earth textures from [Solar System Scope](https://www.solarsystemscope.com/textures/),
based on NASA imagery, used under the
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)
licence. The resized and merged versions come from the Three.js examples.

## Licence

Apache 2.0. See [LICENSE](LICENSE).
