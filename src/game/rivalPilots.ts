import * as THREE from 'three';
import type { AsteroidField } from '../asteroids/asteroidField';
import type { SoundEffects } from '../audio/soundEffects';
import type { Hud } from '../hud/hud';
import { RIVAL_HIT_FINE, RIVALS, mayTalk, type RivalId } from '../logic/rivals';
import { segmentSphereHit } from '../logic/satellites';
import { formatCredits } from '../logic/contracts';
import { EARTH_RADIUS } from '../scene/earth';
import type { SatelliteFleet } from '../satellites/satelliteFleet';
import type { ShipController } from '../ship/shipController';
import type { CombatResolver } from './combatResolver';
import type { ContractBook } from './contractBook';
import type { GameSession } from './gameSession';
import { RivalPilot } from './rivalPilot';
import type { SatelliteWork } from './satelliteWork';
import type { StationMarker } from './orbitServices';

export interface RivalPilotsDependencies {
  scene: THREE.Scene;
  shipSource: THREE.Object3D;
  field: AsteroidField;
  fleet: SatelliteFleet;
  contracts: ContractBook;
  work: SatelliteWork;
  combat: CombatResolver;
  session: GameSession;
  ship: ShipController;
  hud: Hud;
  sound: SoundEffects;
  /** The player's bolts and missiles, to notice hits on rival ships. */
  playerProjectiles: THREE.Group[];
  station: () => { position: THREE.Vector3; velocity: THREE.Vector3 } | null;
}

/** Hit sphere of a rival ship, in world units. */
const RIVAL_RADIUS = 1.2;

const LINES: Record<RivalId, Record<'hunt-big' | 'hunt' | 'satellite' | 'refuel' | 'beaten' | 'hit', string[]>> = {
  kestrel: {
    'hunt-big': ["Kestrel here. I've got the big one, stay clear.", 'Kestrel. That heavy rock is mine.'],
    hunt: ['Kestrel, engaging.', 'Kestrel. Taking this one.'],
    satellite: ['Kestrel. Fine, I will move the satellite.'],
    refuel: ['Kestrel, running dry. Heading to Aegis.'],
    beaten: ['Nice shot, Singularity.', 'You beat me to it. Next one is mine.'],
    hit: ['Watch your fire, Singularity!', 'Hey! I am on your side!'],
  },
  moth: {
    'hunt-big': ['Moth. Going for the heavy one, nice and slow.'],
    hunt: ['Moth, on the rock near me.', 'Moth. I will take that one.'],
    satellite: ["Moth here. I'll take the satellite job.", 'Moth, hooking up the satellite.'],
    refuel: ['Moth. Tanks low, back to Aegis.'],
    beaten: ['Moth. Good flying.', 'Moth. All yours then.'],
    hit: ['Moth. That was my hull, pilot.', 'Careful with that laser!'],
  },
};

/**
 * Kestrel and Moth: the rival pilots. Runs their ships and weapons, feeds
 * their hits into combat with their names on them, notices the player's
 * stray shots, and rations their radio chatter.
 */
export class RivalPilots {
  readonly rivals: RivalPilot[];
  private elapsed = 0;
  private lastAnyLine = -Infinity;
  private readonly lastLine = new Map<RivalId, number>();
  private readonly huntTargets = new Map<RivalId, { id: number; earnedBefore: number }>();
  /** Last time each rival was hit by the player, so one burst is one fine. */
  private readonly lastHit = new Map<RivalId, number>();

  constructor(private readonly deps: RivalPilotsDependencies) {
    this.rivals = RIVALS.map((definition) => new RivalPilot(definition, deps.shipSource, deps.fleet));
    for (const rival of this.rivals) {
      deps.scene.add(rival.model.group, rival.laser.group, rival.missiles.group, rival.tow.mesh);
      deps.work.register(rival.definition.id, rival.tow);
    }
  }

  reset(): void {
    this.elapsed = 0;
    this.lastAnyLine = -Infinity;
    this.lastLine.clear();
    this.huntTargets.clear();
    this.lastHit.clear();
    this.rivals.forEach((rival, index) => {
      // Spread around a low orbit, on the far side from where the player starts.
      const angle = Math.PI * (0.7 + index * 0.6);
      const start = new THREE.Vector3(Math.cos(angle), 0.25 * (index ? -1 : 1), Math.sin(angle)).setLength(EARTH_RADIUS + 26);
      const heading = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
      rival.reset(start, heading);
    });
  }

  update(deltaSeconds: number, active: boolean): void {
    this.elapsed += deltaSeconds;
    const { field, contracts, work, session, combat, fleet, ship } = this.deps;
    contracts.chasers.clear();
    for (const rival of this.rivals) {
      const id = rival.definition.id;
      rival.update(
        deltaSeconds,
        {
          asteroids: field.all,
          contracts,
          work,
          fleet,
          wallet: session.rivalWallets[id],
          station: this.deps.station(),
          playerPosition: ship.position,
        },
        (line) => this.say(id, line),
      );
      if (rival.task.kind === 'hunt') {
        contracts.chasers.set(rival.task.asteroid.id, id);
      }
      this.watchHunt(rival);
      combat.resolveWeaponHits(rival.laser.update(deltaSeconds, field.all, EARTH_RADIUS), 'laser', id);
      combat.resolveWeaponHits(rival.missiles.update(deltaSeconds, field.all, EARTH_RADIUS), 'missile', id);
    }
    if (active) {
      this.checkFriendlyFire();
    }
  }

  /** On-screen labels: name, distance and what each rival is doing. */
  markers(): StationMarker[] {
    return this.rivals.map((rival) => ({
      world: rival.ship.position,
      name: `${rival.definition.name} ${rival.describe()}`,
      ghost: false,
      color: rival.definition.color,
      edgeArrow: false,
      shape: 'triangle' as const,
    }));
  }

  radarContacts(): { position: THREE.Vector3; color: string; triangle: boolean }[] {
    return this.rivals.map((rival) => ({ position: rival.ship.position, color: rival.definition.color, triangle: true }));
  }

  /** "Nice shot" when the player takes a rock a rival was chasing. */
  private watchHunt(rival: RivalPilot): void {
    const id = rival.definition.id;
    const wallet = this.deps.session.rivalWallets[id];
    const watched = this.huntTargets.get(id);
    if (rival.task.kind === 'hunt') {
      if (!watched || watched.id !== rival.task.asteroid.id) {
        this.huntTargets.set(id, { id: rival.task.asteroid.id, earnedBefore: wallet.earned });
      }
      return;
    }
    if (watched) {
      this.huntTargets.delete(id);
      const lost = !this.deps.field.all.some((asteroid) => asteroid.id === watched.id);
      if (lost && wallet.earned === watched.earnedBefore && this.deps.session.wallet.earned > 0) {
        this.say(id, 'beaten');
      }
    }
  }

  /** The player's bolts and missiles against the rivals' hulls. */
  private checkFriendlyFire(): void {
    const world = new THREE.Vector3();
    for (const group of this.deps.playerProjectiles) {
      for (const projectile of group.children) {
        if (!projectile.visible) {
          projectile.userData.lastRivalCheck = undefined;
          continue;
        }
        projectile.getWorldPosition(world);
        const previous = (projectile.userData.lastRivalCheck as THREE.Vector3 | undefined) ?? world.clone();
        projectile.userData.lastRivalCheck = world.clone();
        if (previous.distanceTo(world) > 30) {
          continue;
        }
        for (const rival of this.rivals) {
          const id = rival.definition.id;
          const recentlyHit = this.elapsed - (this.lastHit.get(id) ?? -Infinity) < 1.5;
          if (!recentlyHit && segmentSphereHit(previous.toArray(), world.toArray(), rival.ship.position.toArray(), RIVAL_RADIUS) !== null) {
            this.lastHit.set(id, this.elapsed);
            const fined = this.deps.session.wallet.fine(RIVAL_HIT_FINE);
            this.deps.hud.showMessage(`You hit ${rival.definition.name}'s ship. Fine: ${formatCredits(fined)}`, 'warning', 3);
            this.say(rival.definition.id, 'hit', true);
          }
        }
      }
    }
  }

  private say(id: RivalId, line: keyof (typeof LINES)['kestrel'], urgent = false): void {
    const last = this.lastLine.get(id) ?? -Infinity;
    if (!urgent && !mayTalk(this.elapsed, last, this.lastAnyLine)) {
      return;
    }
    const options = LINES[id][line];
    const text = options[Math.floor(Math.random() * options.length)];
    const rival = this.rivals.find((candidate) => candidate.definition.id === id);
    if (!rival) {
      return;
    }
    this.lastLine.set(id, this.elapsed);
    this.lastAnyLine = this.elapsed;
    this.deps.hud.showRadio(rival.definition.name, rival.definition.color, text);
    this.deps.sound.chatter(text, rival.definition.pitch);
  }
}
