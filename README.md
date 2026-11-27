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
- Launch at sunrise from Sriharikota, with a curving climb to orbit.
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
wave timing, laser range, aim-ahead, blasts, shield and hull, and units. In development builds the running game is available as
`window.apocalypse` so browser automation can drive it; production builds do
not expose it.

URL options for testing: `?autostart` skips the menu and mouse capture, and
`?skipLaunch` skips the launch sequence.

Distances use 1 world unit = 637 km (Earth's radius is 10 units). Time is
compressed 150 times, so speeds read as realistic impact speeds (about
10 to 30 km/s) while a wave still lasts about a minute.

## Technology

| Part | Choice |
| --- | --- |
| Language | TypeScript 7 |
| 3D | Three.js 0.187 (WebGL renderer, custom GLSL shaders) |
| Post-processing | Three.js bloom, ACES tone mapping |
| Build and dev server | Vite 8 |
| Tests | Vitest 5 |
| Sound | Web Audio API (Howler.js planned for recorded audio) |

Collisions use simple sphere tests; there is no physics engine.

## Project layout

```
src/
  logic/      Game rules with no graphics: asteroid classes, waves, damage, scoring,
              threats, ballistics (range, aim-ahead, blasts), ship defence, units
  game/       Game phases, play session, launch, wave timing, targeting, combat, screens
  scene/      Renderer, Earth and its shaders, stars and sun
  ship/       Interceptor model and flight controller
  asteroids/  Asteroid shapes and the asteroid field
  weapons/    Laser, missiles, hit tests
  effects/    Explosions, scorch marks, space dust
  hud/        Radar, target markers, reticle, hit feedback, status panels
  camera/     Chase and cockpit camera
  input/      Keyboard and mouse
  audio/      Synthesised sound effects
public/textures/  Earth textures
```

## Credits

Earth textures from [Solar System Scope](https://www.solarsystemscope.com/textures/),
based on NASA imagery, used under the
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)
licence. The resized and merged versions come from the Three.js examples.

## Licence

Apache 2.0. See [LICENSE](LICENSE).
