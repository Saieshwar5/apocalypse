import { speedToKmPerSecond } from '../logic/units';
import type { CockpitReadings } from '../ship/cockpitInterior';
import type { ShipController } from '../ship/shipController';
import type { PlaySession } from './playSession';

/** What the cockpit screens show, read from the ship and the play session. */
export function cockpitReadings(ship: ShipController, play: PlaySession, shipName: string): CockpitReadings {
  const job = play.services.jobRows()[0];
  const berthed = play.services.berths.holding || play.stationOps.holdingShip;
  return {
    name: shipName,
    speedKmS: speedToKmPerSecond(ship.velocity.length()),
    fuel: (ship.fuel / ship.fuelCapacity) * 100,
    hull: ship.hull,
    shield: (ship.shield / ship.shieldCapacity) * 100,
    missiles: `${play.missiles.ammunition}/${play.missiles.capacity}`,
    status: berthed ? 'BERTHED' : ship.boosting ? 'BOOST' : ship.throttle > 0.5 ? 'THRUST' : 'COASTING',
    job: job ? `${job.title} ${job.detail}` : 'No work posted',
    alert: ship.hull < 30 || ship.fuel < ship.fuelCapacity * 0.15 || play.services.weather.phase === 'storm',
  };
}
