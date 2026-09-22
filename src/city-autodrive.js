import { CITY_BLOCK, cityStreetAt, cityStreetProfile } from './world/city-grid.js';
import { junctionSpeed } from './city-junctions.js';
import { cityLogical, cityLanePose } from './world/city-layout.js';
export { cityGreen } from './city-junctions.js';

// Cruise on whichever street the driver joins, in their current direction.
// Lane selection is local, so enabling cruise never aims across city blocks.
export class CityAutodrive {
  constructor() { this.enabled = false; this.reset(); }
  reset() { this.path = null; this.stopKey = null; }
  toggle() { this.enabled = !this.enabled; this.reset(); return this.enabled; }
  canStart(player) { const street = cityStreetAt(player.s, player.u); return street.onRoad && !street.median; }
  update(player, traffic, speedLimit = player.stats.topSpeed, dt = 1 / 60) {
    if (!this.path) {
      const street = cityStreetAt(player.s, player.u);
      if (!street.onRoad || street.median) return { handbrake: true };
      const northHeading = cityLanePose('north', street.northIndex * CITY_BLOCK, street.logicalS).heading;
      const eastHeading = cityLanePose('east', street.eastIndex * CITY_BLOCK, street.logicalU).heading;
      const axis = street.intersection ? (Math.abs(Math.cos(player.heading - northHeading)) >= Math.abs(Math.cos(player.heading - eastHeading)) ? 'north' : 'east') : street.axis;
      if (!axis) return { handbrake: true };
      const direction = Math.sign(Math.cos(player.heading - (axis === 'north' ? northHeading : eastHeading))) || 1;
      const center = (axis === 'north' ? street.northIndex : street.eastIndex) * CITY_BLOCK;
      const profile = cityStreetProfile(axis, Math.round(center / CITY_BLOCK));
      this.path = { axis, direction, lane: center + (axis === 'north' ? 1 : -1) * profile.lane * direction, speed: profile.speed };
    }
    const { axis, direction, lane } = this.path;
    const address = cityLogical(player.s, player.u), position = axis === 'north' ? address.s : address.u;
    const pose = cityLanePose(axis, lane, position, direction);
    const lookahead = Math.max(6, Math.abs(player.speed ?? 0) * .65);
    const aim = cityLanePose(axis, lane, position + direction * lookahead / pose.stretch, direction);
    const ds = aim.s - player.s, du = aim.u - player.u, length = Math.hypot(ds, du);
    const along = ds / Math.max(.001, length), across = du / Math.max(.001, length);
    let speed = Math.min(this.path.speed, speedLimit, player.stats.topSpeed);
    if (traffic.enabled) speed = Math.min(speed, junctionSpeed(this, traffic, axis, direction, lane, position, player.speed ?? 0, dt));
    for (const car of traffic.enabled ? traffic.vehicles : []) {
      const dx = car.u - player.u, ds = car.s - player.s;
      const ahead = ds * Math.cos(pose.heading) + dx * Math.sin(pose.heading);
      const beside = Math.abs(dx * Math.cos(pose.heading) - ds * Math.sin(pose.heading));
      if (ahead > 0 && beside < 3) speed = Math.min(speed, Math.sqrt(2 * 7 * Math.max(0, ahead - 10)));
    }
    return { touchDrive: { amount: speed / player.stats.topSpeed, along, across, heading: Math.atan2(across, along) } };
  }
}
