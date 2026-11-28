# Singularity

A realistic 3D browser game about a working pilot in orbit. You launch a
single interceptor from Earth and fly it, with real coasting and braking, to
the asteroids that threaten the planet. Small rocks dent the planet; giants
can end it.

The game is being rebuilt in stages towards the "contract pilot" design:
jobs and money, several stations, towing and repairs, rival pilots and
reputation. This version is stage 1, the foundation: a large planet,
natural flight, short-range weapons, few asteroids that must be found and
reached, and clear guidance. Stage 2 adds money and defence contracts. The
earlier orbit campaign (fields, calm zones, workshop) still runs on top.

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
| Mouse or arrow keys | Steer (pitch and yaw). Click the game to capture the mouse |
| W | Thrust. The ship keeps its speed when you let go |
| S | Brake to a stop |
| A / D | Slide left / right |
| R / V | Slide up / down |
| Q / E | Roll |
| Shift | Boost |
| T | Connect the tow line to a contract satellite, or release it |
| I (docked) | Insure the ship |
| Z | Flight assist on or off |
| Left click or Space | Laser (short range; overheats if held too long) |
| F or right click | Missile at the locked target |
| Tab | Tactical map (time slows; mouse rotates the view) |
| C | Switch between chase and cockpit camera |
| M | Sound on or off |
| Enter | Skip the launch |
| Esc | Pause |

## Stage 6b: training flight, ranks and Season 1

- **Training flight** (menu button, or `?training` in the address): Capcom
  walks a new pilot through seven steps, one at a time, with the step on the
  hint line and a marker where needed: thrust, coast and brake to a stop,
  steer onto a marker, slide, scan a practice rock, shoot it, and dock at
  Aegis. Debris fields wait until it is done; Enter skips it. The ship starts
  the lesson pointing along the orbit, away from Aegis.
- **Ranks** across runs, kept in this browser: Cadet, Pilot (2,000 cr career
  earnings), Senior Pilot (8,000 cr and a completed season), Commander
  (20,000 cr and three seasons). The menu shows the rank and what the next
  needs; the end screen shows promotions; Capcom greets the pilot by rank.
  A season counts when the orbit is completed in good standing.
- **Season 1, "The Stream"**: story beats on the radio as the orbit passes
  certain sectors: forecasts that keep being wrong, Perihelion Mining's record
  profits, Kestrel's ship payments, rocks on paths no comet makes, and the
  call for every pilot to work together on the giant. The victory screen now
  reads "Season complete".

## Stage 6a: people and voices

- Choose **your call sign** on the menu (letters, digits, spaces and hyphens,
  up to 14); it is saved with the settings and everyone on the radio uses
  it.
- A cast with names: **Capcom Reyes** (mission control, on Halo), **Chief
  Okafor** (Vulcan Yard), **Foreman Patel** (Ceres Works), **Commander Sato**
  (Halo), and the rivals Kestrel and Moth. Each has a colour on the radio
  line and a voice pitch of their own.
- One shared radio channel queues and spaces every line (4 s between any
  two lines, 10 s per speaker) so voices never talk over each other or over
  mission control's urgent calls.
- They speak at the moments that matter: the start of a run, each field and
  calm zone, when Vulcan or Ceres post work, when a haul is delivered, when
  you save a city, when you lose your ship, when your licence goes under
  review or recovers. In calm zones the channel fills with banter (Aegis
  coffee, Moth's thirty years in orbit, Halo's cat in the airlock again).
- Keys typed into the call sign box no longer reach the ship's controls.

## Stage 5c: the station economy

- Every station keeps a store of **fuel** and **parts**. Prices follow
  stock: from 0.7x the station's base price with a full store to 1.6x when
  nearly empty. Ceres Works has the cheapest fuel; on-screen station labels
  show each outpost's fuel price, and Aegis's docking price follows its
  store too.
- Ceres makes fuel and parts: a trickle from its mining drones, and much
  more from hauled rocks (8 fuel and 2 parts per tonne). Automatic shuttles,
  visible as small cargo craft flying arcs around the planet, carry goods
  from Ceres to whichever station's store is emptiest.
- Aegis builds missiles from parts (one part every 12 s while it has room);
  Vulcan Yard uses 6 parts per satellite repair and repairs three times
  slower without them. Shortages spread if nobody hauls.
- **Berthing at the outposts**: stop within about 1,100 km of Vulcan, Ceres
  or Halo's port, release the controls and the ship is held there. It buys
  fuel at the local price; Vulcan also repairs hulls at 2 cr a point. W
  launches.
- **Asteroid haul** (Ceres posts it in calm zones): tow a carbon-rich rock of
  several tonnes to Ceres's intake and release it there; 40 cr a tonne. The
  rock is very heavy on the tow line, so plan fuel and brake early. T picks
  the haul rock when it is the nearest thing to tow.
- Working satellites pay 15 cr each when a field is cleared.

## Stage 5b: reputation and the licence

- Reputation (start 60, out of 100) is the pilot's licence to fly. It
  rises with completed contracts (+2, +3 when clean) and satellite jobs
  (+5), and falls when a contracted rock hits the planet (-2, -6 if it hits
  a city or installation), when the pilot destroys a satellite (-8), fails
  a satellite job they took (-5), hits a rival (-2), leaves debris (-0.25 a
  tonne) or loses the ship (-15).
- The licence has stages, announced by mission control and shown under
  Earth's integrity: **good standing** (45 and up); **warning** (rivals no
  longer give way to you on contested work); **probation** below 30 (complete
  two contracts within three minutes, or be recalled; passing restores 38);
  **recalled** (the career ends: "Licence revoked").
- Losing the ship no longer ends the run: a replacement is delivered beside
  Aegis for 900 cr, or 200 cr if insured (I while docked, 250 cr, used up by
  one loss). If you cannot pay, Halo grants one emergency loan of 1,000 cr,
  repaid by 30% of later earnings until 1,250 cr is paid back. With no
  money and the loan spent, the career ends in bankruptcy.
- The end screen shows the licence, reputation and ships lost.

## Stage 5a: the Cascade and Orbit Health

- The game's name now has a meaning. Debris in orbit hits satellites, every
  broken satellite adds more debris, and past a tipping point (the
  Singularity) fragments collide with each other and debris multiplies by
  itself until orbit is closed. **Orbit Health**, under Earth's integrity,
  shows how far orbit is from that point.
- Destroying a rock inside the orbital band (below about 17,000 km from the
  planet's centre) leaves debris: 2 t for a small rock up to 20 t for a
  giant, less than half that with a missile, which vaporises most of it.
  Rocks destroyed far out or very low leave none, and deflected rocks leave
  none. Every tonne costs 0.8% of Orbit Health; a destroyed satellite
  leaves 12 t.
- Debris clouds orbit, spread, glint and are labelled on screen ("DEBRIS
  12 t"). Drag slowly clears low debris; high debris lasts for many minutes.
  Satellites passing through a cloud can be torn apart, adding their own
  wreck: the chain reaction. Below 35% health, clouds start to grow.
- Contracts pay 20% more for a **clean** stop: a deflection, or a kill that
  leaves no debris. The kill confirmation says CLEAN, or how much debris it
  left.
- The orbit clean-up job: fly slowly (under about 6 units/s relative to the
  cloud) through debris and the ship's net sweeps it, paying 25 cr a tonne
  from the Orbital Safety Fund. At speed the net does nothing and debris
  hurts the ship. The board lists the job whenever there is debris.
- Warnings at 70%, 50%, 35% and 15%; at 0% the run ends: "The Singularity:
  debris has closed Earth's orbit". The end screen shows Orbit Health and
  tonnes swept.
- The left-hand HUD panels now stack, so a taller panel never covers the
  next.

## Quality pass 1: feel and finish

- Live reflections: metal now reflects the real planet, sun and sky as seen
  from where you are. A small stand-in scene (the sun, and the planet at the
  right size, direction and rotation, lit by the sun) is turned into a
  reflection map and rebuilt as the ship moves, so hulls catch blue
  Earthlight over the day side and go dark over the night side.
- Reaction-control thrusters: small gas jets fire from the nose when
  braking, from the flanks when sliding, and at nose and tail when turning,
  on your ship and on the rivals'. They watch how each ship actually
  accelerates, so flight assist's drift corrections show too. A short hiss
  plays with them.
- Engine plumes have a white-hot inner flame, and bright shock diamonds
  appear in the main engines' exhaust at full boost.
- The tow line groans as the pull nears what a satellite can take.
- Automatic graphics quality (the new default in the pause menu): the game
  measures frame times while flying and, if the computer cannot keep about
  33 frames a second, drops to low quality once and says so. Add `?fps` to
  the address to show a frame-rate readout for testing.

## Stage 4: rival pilots

- Two rival pilots work the same orbit: KESTREL (red), a hunter who goes
  after asteroid contracts and prefers big or iron rocks, and MOTH (yellow),
  a hauler who takes satellite jobs and nearby rocks. They fly the same ship
  (repainted) with the same flight model, top speeds, braking, fuel, laser
  range and missiles as you, steered by an autopilot instead of keys.
- They read the same contract board, skip work they cannot reach before
  impact or that you are clearly about to take, and head to Aegis to
  refuel (and pay for it) when low.
- Pay is shared by damage dealt: whoever damaged a rock is paid a share,
  so a giant fought together pays everyone who helped. A rock a rival took
  alone is reported ("KESTREL took the medium iron").
- A satellite job a rival claims is reserved for them while they work it
  (shown on the board as "claimed by MOTH"); they tow, drop off at Vulcan
  Yard, collect and return just as you do.
- They are competitors, never enemies: they do not shoot you. Your stray
  shots on their hull cost a 100 cr fine and an angry radio call; their
  missile blasts can still hurt you if you fly into them.
- You see them: red and yellow triangles on screen and on the scanner, with
  what each is doing ("KESTREL → medium rock 2,000 km"). You hear them:
  short radio lines in their own voices, rationed so they do not talk over
  mission control. A league table under your earnings ranks all three
  pilots, and the end screen shows it.
- Only your own kills count towards the field-clear bonus.

## Stage 3: stations and towing

- Three new stations on their own orbits, built in Blender like Aegis:
  Vulcan Yard (satellite repair yard, amber), Halo (crew habitat, white)
  and Ceres Works (refinery, green, highest and slowest). They are
  labelled on screen and on the scanner in their colours, and the ship
  bumps off them. Only Aegis docks the ship; Ceres and Halo get their own
  jobs in later stages.
- The tow line (T): fly within about 640 km of a contract satellite and
  match its speed, then press T. The line is a rope that only pulls, and the
  load's mass is shared with the ship, so it speeds up, turns and stops more
  slowly. Pulling too hard wears the satellite down (its condition shows on
  the status line) and can snap the line. T again releases it.
- Satellite dodge: an iron asteroid that will miss Earth but hit a
  satellite. The operator pays 320 cr to keep the satellite safe: tow it out
  of the path and, once the rock has passed, put it back in its orbit slot,
  or destroy the rock and leave the satellite where it is.
- Repair tow, like a mechanic's shop: a satellite develops a fault (a
  blinking red light). Tow it to Vulcan Yard's cradle and release it there;
  the repair runs for a minute while you do other work, mission control
  calls you when it is ready, and you collect it and return it to its orbit
  slot. Pays 480 cr when it is back, less the further from the exact slot
  you leave it. The yard takes one satellite at a time.
- Satellite jobs appear at the top of the contract board with their current
  step, and a cyan JOB marker (an arrow above the reticle when out of view)
  shows where to go next: the satellite, the yard cradle or the orbit slot.
- Operators post work in calm zones; a dodge can also come during a field.

## Stage 2: money and contracts

- Every asteroid on an impact course carries an open contract from the Earth
  Defence Authority. Pay follows danger, not size: 30 cr plus 25 cr per point
  of planet integrity the impact would remove, half as much again if it is
  heading for a city or installation, and a quarter more for stopping it with
  40 seconds or more to spare. A rock that would burn up pays nothing, so
  scanning tells you whether a chase is worth it (unscanned rocks show an
  estimate, marked ~).
- Destroying or deflecting a rock pays the whole contract. A laser that
  splits a big rock pays 40%, and the pieces carry contracts of their own.
  A rock that reaches the planet takes its contract with it.
- The Incoming list is now the contract board: what each rock pays, when it
  lands, how far away it is, and this field's earnings and losses. The
  PRIORITY marker shows the pay too.
- Money buys everything at Aegis: fuel at 2 cr a unit, missiles at 60 cr and
  hull repairs at 3 cr a point (the shield recharges free). Fuel and hull are
  bought before missiles. A pilot who cannot pay still gets enough fuel to
  fly (30%), courtesy of the Authority. Upgrades come from the same balance.
- The pilot starts with 500 cr. Clearing a field pays a bonus; shooting a
  satellite costs a 150 cr fine.
- The end screen shows earnings, spending, balance and contracts completed
  and lost, and the best runs in this browser are ranked by earnings.

## Stage 1: the foundation

- A large planet: Earth's radius is 40 world units and the ship is about 2,
  so the planet fills the view from low orbit. Fine surface detail fades in
  near the ground.
- Natural flight: nothing slows the ship in space, so it coasts until you
  brake (S). With flight assist on (the default) thrusters cancel sideways
  drift, hold the ship against gravity and ease it back to cruise speed
  after a boost. With it off (Z) the ship drifts freely, gravity bends its
  path and it can coast in an orbit; a DRIFT marker shows the true direction
  of travel.
- Short-range weapons: the laser is at full strength within about 2,500 km
  and gone at 7,000 km; missiles lock within about 10,000 km. You have to
  fly to each asteroid.
- Few asteroids, from all sides: a field is 4 to 17 rocks over one to two
  minutes, arriving on two to four fronts plus stragglers from anywhere.
- Guidance: a yellow PRIORITY marker picks the most urgent asteroid you can
  still reach and shows REACH against IMPACT time with a verdict (you can
  make it, hurry, too late). When it is out of view an arrow around the
  reticle says which way to turn.
- A gentler atmosphere: a low-orbit warning from 1,400 km up, mild heating
  at the top of the atmosphere, and an automatic pull-up that brakes and
  climbs before the ship can burn up.
- Clear controls: a status line says whether the mouse is steering, whether
  flight assist is on and what the engines are doing. The run starts with
  the station dead ahead, satellites are labelled on screen, and an alarm
  sounds when one is in your path.

## What is in this version

Some figures below (ranges, counts) date from before stage 1; the list
above is the current one where they differ.

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
  rock, iron (resists lasers) and ice (fast and fragile). Shapes and surfaces
  are generated: cratered grey-brown regolith, dark glinting iron and glossy
  blue-white ice, with no downloaded textures.
- Explosions: a core flash, a fireball that cools into smoke, tumbling rock
  debris that carries the asteroid's momentum, and lingering dust. Ice
  shatters into shards and glitter.
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
- Aegis space station: it orbits Earth, shown on the scanner (cyan square)
  and by an on-screen marker. Fly within about 5,700 km at under 30 km/s and
  release the controls: docking guides back the ship into the bay, clamps
  engage, and the station refuels, rearms and repairs it (the only way the
  hull recovers). W launches. Asteroids keep coming while you are docked.
- Fuel: thrust and boost burn it. An empty tank leaves 25% thrust and no
  boost. The station's stock of fuel and missiles is limited and is topped up
  by a supply rocket after each wave while the Launch Complex stands.
- Priority sites: eleven cities (Mumbai, New York, São Paulo, Lagos, London,
  Sydney, Tokyo, Shanghai, Cairo, Mexico City, Moscow), the Launch Complex
  and the Radar Station in Antarctica. Each has
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
- The orbit: a play-through is one orbit of 14 sectors, with debris fields
  (light, dense, giant) separated by calm zones for docking and repairs. A
  forecast strip at the top shows what is coming; Enter leaves a calm zone
  early. Clearing the final giant completes the orbit, rated one to three
  stars.
- Station workshop: while docked, keys 1 to 8 spend credits on eight
  upgrades (fuel tank, engines, laser power and cooling, missile rack, ship
  shield, station shield, repair crews).
- The station can be damaged and destroyed by asteroids, moved along its
  orbit from the tactical map (Q and E), and is restocked by a supply rocket
  you can watch climb from the Launch Complex.
- Physics: hits push and spin asteroids according to their mass, so missiles
  can deflect a giant into missing the planet; fragments keep their parent's
  momentum; the ship banks into turns.
- Satellites: eight communications, navigation and weather satellites on
  three orbit bands (grey squares on the scanner). Flying into one damages
  the ship and destroys it; asteroids and your own stray shots can destroy
  them too, and a wreck leaves a debris cloud that stays in that orbit and
  hurts the ship. Each working satellite extends scanner range slightly.
- Asteroid types: rubble pile, carbon-rich, stony, iron and ice, with danger
  set by density, not size. Contacts are unidentified until scanned by
  holding the reticle on them; small or loose bodies burn up harmlessly, and
  some asteroids only pass by.
- The Moon as a landmark, a generated score that rises with danger, urgent
  messages read aloud, solar flares that blind the scanner, and settings for
  mouse sensitivity and graphics quality on the pause screen.
- Star systems: after Earth, travel to Tau Ceti to defend the Meridian colony,
  a generated world with its own settlements, harder fields and your score
  and upgrades carried over.
- Best runs are kept in this browser, and a result line can be copied to
  share. There is no online leaderboard yet.
- Asteroids come from one to three attack fronts, with giants in the marked
  sectors.
  Missiles are only reloaded at the station.
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
sites, atmosphere zones and the automatic pull-up, the flight model, guidance,
contract pay, station prices and the wallet, the tow line, placement and
satellite job paths, rival choices, shared pay, radio rationing, the autopilot,
the Cascade (debris, drag, growth, sweeping, orbits through a point), automatic
quality, reputation, probation, insurance and the emergency loan, station prices,
shuttle routes and haul masses, call signs and radio rationing, career ranks and
the season's story beats,
the scanner projection, fuel, docking and station stock. In development builds the running game is available as
`window.singularity` so browser automation can drive it; production builds do
not expose it.

URL options for testing: `?autostart` skips the menu and mouse capture, and
`?skipLaunch` skips the launch sequence.

Distances use 1 world unit = 159 km (Earth's radius is 40 units). Time is
compressed 38 times, so asteroid speeds read as realistic impact speeds
(about 6 to 35 km/s) while a field still lasts a minute or two.

## 3D models (Blender)

The models in `public/models` are generated by Python scripts, so they can be
changed and rebuilt rather than edited by hand:

| Script | Output |
| --- | --- |
| `art/blender/build_ship.py` | `interceptor.glb`, in two variants: `gunship` (used) and `interceptor` |
| `art/blender/build_launch.py` | `booster.glb` and `launchpad.glb` |
| `art/blender/build_satellites.py` | `satellites.glb` (communications, navigation and weather satellites) |
| `art/blender/build_station.py` | `station.glb` (Aegis: hub, spinning ring, docking bay, tanks, solar wings) |
| `art/blender/build_outposts.py` | `vulcan.glb`, `ceres.glb` and `halo.glb` (Vulcan Yard, Ceres Works, Halo) |
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
              threats, ballistics (range, aim-ahead, blasts), ship defence, units,
              the flight model and guidance
  game/       Game phases, play session, campaign (orbit, upgrades), targeting, combat, screens
  launch/     Launch cinematic: pad scene, rocket effects, orbit insertion
  scene/      Renderer, Earth and its shaders, stars and sun
  ship/       Interceptor model wrapper, shield and flight controller
  asteroids/  Asteroid shapes and the asteroid field
  weapons/    Laser, missiles, hit tests
  effects/    Explosions, scorch marks, space dust
  hud/        3D scanner, target markers, reticle, hit feedback, status panels
  sites/      Priority sites: health, threats, globe markers
  station/    Aegis station: orbit, stock, automatic docking
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
