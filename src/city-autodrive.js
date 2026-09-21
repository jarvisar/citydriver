import { clamp } from './world/route.js';
import { CITY_BLOCK, cityStreetAt } from './world/city-grid.js';

export function cityGreen(axis, time) {
  const phase = ((time % 24) + 24) % 24;
  return axis === 'north' ? phase < 10 : phase >= 12 && phase < 22;
}

// Cruise on whichever street the driver joins, in their current direction.
// Lane selection is local, so enabling cruise never aims across city blocks.
export class CityAutodrive {
  constructor() { this.enabled = false; this.reset(); }
  reset() { this.path = null; }
  toggle() { this.enabled = !this.enabled; this.reset(); return this.enabled; }
  canStart(player) { return cityStreetAt(player.s, player.u).onRoad; }
  update(player, traffic, speedLimit = player.stats.topSpeed) {
    if (!this.path) {
      const street = cityStreetAt(player.s, player.u);
      if (!street.onRoad) return { handbrake: true };
      const axis = street.intersection ? (Math.abs(Math.cos(player.heading)) >= Math.abs(Math.sin(player.heading)) ? 'north' : 'east') : street.axis;
      if (!axis) return { handbrake: true };
      const direction = Math.sign(axis === 'north' ? Math.cos(player.heading) : Math.sin(player.heading)) || 1;
      const center = Math.round((axis === 'north' ? player.u : player.s) / CITY_BLOCK) * CITY_BLOCK;
      this.path = { axis, direction, lane: center + (axis === 'north' ? 3 : -3) * direction };
    }
    const { axis, direction, lane } = this.path;
    const lateral = axis === 'north' ? player.u : player.s;
    const correction = clamp((lane - lateral) * .16, -.45, .45);
    const forward = Math.sqrt(1 - correction * correction) * direction;
    const along = axis === 'north' ? forward : correction;
    const across = axis === 'north' ? correction : forward;
    let speed = Math.min(19, speedLimit, player.stats.topSpeed);
    const position = axis === 'north' ? player.s : player.u;
    const nextIntersection = direction > 0 ? Math.ceil(position / CITY_BLOCK) * CITY_BLOCK : Math.floor(position / CITY_BLOCK) * CITY_BLOCK;
    const toJunction = (nextIntersection - position) * direction;
    if (traffic.enabled && !cityGreen(axis, traffic.time) && toJunction > 10) speed = Math.min(speed, Math.sqrt(2 * 7 * Math.max(0, toJunction - 15)));
    for (const car of traffic.enabled ? traffic.vehicles : []) {
      const dx = car.u - player.u, ds = car.s - player.s;
      const ahead = (axis === 'north' ? ds : dx) * direction;
      const beside = Math.abs(axis === 'north' ? dx : ds);
      if (ahead > 0 && beside < 3) speed = Math.min(speed, Math.sqrt(2 * 7 * Math.max(0, ahead - 10)));
    }
    return { touchDrive: { amount: speed / player.stats.topSpeed, along, across, heading: Math.atan2(across, along) } };
  }
}
