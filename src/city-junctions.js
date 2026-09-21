import { CITY_BLOCK as B, cityStreetProfile, cityJunctionControl } from './world/city-grid.js';

export function cityGreen(axis, time) {
  const phase = ((time % 24) + 24) % 24;
  return axis === 'north' ? phase < 10 : phase >= 12 && phase < 22;
}

// A stop belongs to an approach, not to an entire road. Minor streets yield
// to avenues; four-way stops reserve the junction until a car has crossed.
export function junctionSpeed(driver, traffic, axis, direction, lane, along, speed, dt) {
  const streetIndex = Math.round(lane / B), crossingIndex = direction > 0 ? Math.ceil(along / B) : Math.floor(along / B);
  const gap = (crossingIndex * B - along) * direction, crossAxis = axis === 'north' ? 'east' : 'north';
  const stopDistance = cityStreetProfile(crossAxis, crossingIndex).halfWidth + 7;
  const control = cityJunctionControl(axis, streetIndex, crossingIndex);
  if (gap <= stopDistance - 2 || control === 'priority') return Infinity;
  if (control === 'signal') return cityGreen(axis, traffic.time) ? Infinity : Math.sqrt(14 * Math.max(0, gap - stopDistance));
  const key = axis === 'north' ? `${streetIndex},${crossingIndex}` : `${crossingIndex},${streetIndex}`;
  if (driver.stopKey !== key) { driver.stopKey = key; driver.stopWait = 0; driver.stopReleased = false; }
  if (driver.stopReleased) return Infinity;
  if (gap < stopDistance + .8 && speed < .4) driver.stopWait += dt;
  else driver.stopWait = 0;
  const reservations = traffic.junctionReservations ??= new Map();
  for (const [id, reservation] of reservations) if (reservation.until <= traffic.time) reservations.delete(id);
  if (driver.stopWait >= .75 && !reservations.has(key)) {
    const crossing = traffic.vehicles.some(other => {
      if (other === driver || other.axis === axis || !other.axis) return false;
      const center = streetIndex * B;
      const otherAlong = other.axis === 'north' ? other.s : other.u;
      const otherAcross = other.axis === 'north' ? other.u : other.s;
      const approaching = (center - otherAlong) * other.direction;
      const occupied = Math.abs(approaching) < cityStreetProfile(axis, streetIndex).halfWidth + 4;
      return Math.abs(otherAcross - crossingIndex * B) < 11 && (occupied || (approaching > -15 && approaching < Math.max(16, other.speed * 3) && other.speed > .5));
    });
    if (!crossing) {
      reservations.set(key, { until: traffic.time + 7 });
      driver.stopReleased = true;
      return Infinity;
    }
  }
  return Math.sqrt(14 * Math.max(0, gap - stopDistance));
}
