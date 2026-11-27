import * as THREE from 'three';
import type { SoundEffects } from '../audio/soundEffects';
import type { CameraRig } from '../camera/cameraRig';
import type { Explosions } from '../effects/explosions';
import type { Hud } from '../hud/hud';
import {
  DEFENCE_ZONE,
  atmosphereZone,
  entryDamagePerSecond,
  entryHeat,
  type AtmosphereZone,
} from '../logic/atmosphere';
import { damping, orientationFromForward } from '../math/orientation';
import { EARTH_RADIUS } from '../scene/earth';
import { createConeGradientTexture, getGlowTexture } from '../scene/glowTexture';
import { IDLE_INPUT, type FlightInput, type ShipController } from '../ship/shipController';
import type { CombatResolver } from './combatResolver';

export interface HazardDependencies {
  ship: ShipController;
  combat: CombatResolver;
  sound: SoundEffects;
  hud: Hud;
  cameraRig: CameraRig;
  explosions: Explosions;
}

/**
 * Dangers that come from where the ship flies rather than from asteroids:
 * heating and break-up in the atmosphere, straying out of the defence zone
 * (the autopilot turns the ship back), and a crippled hull.
 */
export class FlightHazards {
  readonly group = new THREE.Group();
  zone: AtmosphereZone = 'space';
  /** True while the autopilot is flying the ship back towards Earth. */
  returning = false;
  private readonly glow: THREE.Sprite;
  private readonly streak: THREE.Mesh;
  private beepTimer = 0;
  private smokeTimer = 0;
  private lastZone: AtmosphereZone = 'space';
  private warnedFar = false;
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(private readonly deps: HazardDependencies) {
    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: new THREE.Color(2.4, 0.9, 0.3),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const cone = new THREE.ConeGeometry(1, 1, 20, 1, true);
    cone.translate(0, 0.5, 0);
    this.streak = new THREE.Mesh(
      cone,
      new THREE.MeshBasicMaterial({
        map: createConeGradientTexture([
          [0, 'rgba(255,240,210,0.9)'],
          [0.25, 'rgba(255,150,60,0.6)'],
          [1, 'rgba(90,20,0,0)'],
        ]),
        color: new THREE.Color(1.6, 0.8, 0.35),
        transparent: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.group.add(this.glow, this.streak);
    this.group.visible = false;
  }

  reset(): void {
    this.zone = 'space';
    this.lastZone = 'space';
    this.returning = false;
    this.warnedFar = false;
    this.group.visible = false;
    this.deps.sound.setAtmosphere(0);
  }

  /** Replaces the pilot's input while the autopilot is returning the ship. */
  filterInput(input: FlightInput, deltaSeconds: number): FlightInput {
    const { ship, hud } = this.deps;
    const distance = ship.position.length();
    if (!this.returning && distance > DEFENCE_ZONE.limit) {
      this.returning = true;
      hud.showMessage('Outside the defence zone. Autopilot returning to Earth', 'danger', 4);
    } else if (this.returning && distance < DEFENCE_ZONE.warning) {
      this.returning = false;
      hud.showMessage('Back in the defence zone. You have the controls', 'success', 3);
    }
    if (!this.returning) {
      if (distance > DEFENCE_ZONE.warning && !this.warnedFar) {
        hud.showMessage('Leaving the defence zone. Turn back towards Earth', 'warning', 4);
      }
      this.warnedFar = distance > DEFENCE_ZONE.warning;
      return input;
    }
    const home = ship.position.clone().negate().normalize();
    const target = orientationFromForward(home, ship.up());
    ship.object.quaternion.slerp(target, damping(2.5, deltaSeconds));
    return { ...IDLE_INPUT, thrust: 1, boost: true };
  }

  update(deltaSeconds: number, active: boolean): void {
    const { ship, combat, sound, hud, cameraRig } = this.deps;
    const altitude = ship.position.length() - EARTH_RADIUS;
    this.zone = active ? atmosphereZone(altitude) : 'space';
    const heat = this.zone === 'space' || this.zone === 'warning' ? 0 : Math.max(0.15, entryHeat(altitude));

    if (this.zone !== this.lastZone) {
      if (this.zone === 'warning' && this.lastZone === 'space') {
        hud.showMessage('Atmosphere ahead. Pull up', 'warning', 3);
      } else if (this.zone === 'atmosphere') {
        hud.showMessage('Entering the atmosphere. Hull heating: pull up now', 'danger', 4);
      }
      this.lastZone = this.zone;
    }

    if (this.zone === 'breakup') {
      combat.destroyShip('The interceptor burned up in the atmosphere');
    } else if (this.zone === 'atmosphere') {
      combat.applyEnvironmentDamage(entryDamagePerSecond(altitude) * deltaSeconds, 'The interceptor burned up in the atmosphere');
      cameraRig.addShake(deltaSeconds * (1.5 + heat * 3));
      // Thick air slows the ship, which makes climbing out harder the deeper it is.
      ship.velocity.multiplyScalar(Math.exp(-(0.4 + heat) * deltaSeconds));
    }

    sound.setAtmosphere(heat);
    this.updateBeeps(deltaSeconds);
    this.updateGlow(heat);
    this.updateHullDistress(deltaSeconds, active);
  }

  private updateBeeps(deltaSeconds: number): void {
    this.beepTimer -= deltaSeconds;
    if (this.beepTimer > 0 || this.zone === 'space') {
      return;
    }
    this.deps.sound.warningBeep(this.zone !== 'warning');
    this.beepTimer = this.zone === 'warning' ? 0.7 : 0.25;
  }

  private updateGlow(heat: number): void {
    const { ship } = this.deps;
    this.group.visible = heat > 0;
    if (heat <= 0) {
      return;
    }
    const speed = ship.velocity.length();
    const direction = speed > 0.1 ? ship.velocity.clone().normalize() : ship.forward();
    const flicker = 0.85 + Math.random() * 0.3;
    this.glow.position.copy(ship.position).addScaledVector(direction, 0.5);
    this.glow.scale.setScalar((1.6 + heat * 2) * flicker);
    this.glow.material.opacity = 0.3 + heat * 0.5;
    this.streak.position.copy(ship.position).addScaledVector(direction, 0.9);
    this.streak.quaternion.setFromUnitVectors(this.up, direction.clone().negate());
    this.streak.scale.set(0.3 + heat * 0.2, (1.4 + heat * 3) * flicker, 0.3 + heat * 0.2);
    (this.streak.material as THREE.MeshBasicMaterial).opacity = 0.15 + heat * 0.35;
  }

  /** Sparks, then smoke, then an alarm as the hull fails. */
  private updateHullDistress(deltaSeconds: number, active: boolean): void {
    const { ship, explosions, sound } = this.deps;
    if (!active || ship.hull >= 50) {
      return;
    }
    this.smokeTimer -= deltaSeconds;
    if (this.smokeTimer > 0) {
      return;
    }
    const point = ship.position.clone().add(new THREE.Vector3(0, 0, 0.5).applyQuaternion(ship.object.quaternion));
    explosions.spawnHitSpark(point);
    if (ship.hull < 25) {
      explosions.spawnRockChips(point, 0.4);
      sound.warningBeep(true);
    }
    this.smokeTimer = ship.hull < 25 ? 0.35 : 0.9;
  }
}
