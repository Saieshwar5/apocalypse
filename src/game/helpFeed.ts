import { MATERIAL_TRAITS } from '../logic/asteroidClasses';
import { OBJECTIVE_NAME } from '../logic/navigation';
import { inPlanetShadow } from '../logic/spaceWeather';
import { whatNow } from '../logic/whatNow';
import { EARTH_RADIUS } from '../scene/earth';
import { SUN_DIRECTION } from '../scene/sunDirection';
import type { ShipController } from '../ship/shipController';
import type { Navigation } from './navigation';
import type { PlaySession } from './playSession';

/** "What now?" advice for the help screen, from the state of the run. */
export function adviceFor(play: PlaySession, ship: ShipController, navigation: Navigation): string[] {
  const priority = play.guidance.priority;
  const rock = priority?.item ?? null;
  const job = play.services.jobRows()[0] ?? null;
  const delivery = play.services.delivery();
  const berthedAt = play.services.berths.berthedAt;
  const docked = play.stationOps.docking.state === 'docked';
  return whatNow({
    calm: play.campaign.director.phase !== 'field',
    threat:
      rock && priority
        ? {
            name: `A ${rock.size} ${rock.identified ? MATERIAL_TRAITS[rock.material].label.toLowerCase() : 'unidentified'} rock`,
            site: rock.targetSite ? rock.targetSite.toUpperCase() : null,
            seconds: rock.timeToImpact,
            verdict: priority.verdict,
            distance: priority.distance,
            needsMissiles: rock.material === 'iron' || rock.size === 'giant',
          }
        : null,
    job: job ? { title: job.title, detail: job.detail } : null,
    fuel: (ship.fuel / ship.fuelCapacity) * 100,
    hull: ship.hull,
    missiles: play.missiles.ammunition,
    docked,
    berthedAt: berthedAt ? play.services.outposts.get(berthedAt).name : null,
    towing: delivery ? { load: delivery.load, place: delivery.place, step: delivery.step.text } : null,
    storm: play.services.weather.phase,
    sheltered: docked || berthedAt !== null || inPlanetShadow(ship.position.toArray(), SUN_DIRECTION.toArray(), EARTH_RADIUS),
    licenceGood: play.licence.stage === 'good',
    orbitHealth: play.services.debris.health,
    objective: navigation.objective ? `${OBJECTIVE_NAME[navigation.objective.kind]} (${navigation.objective.label})` : null,
  });
}
