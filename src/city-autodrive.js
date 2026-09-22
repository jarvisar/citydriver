import { CITY_BLOCK, cityStreetAt, cityStreetProfile } from './world/city-grid.js';
import { junctionSpeed } from './city-junctions.js';
import { cityLayout, cityLogical, cityLanePose } from './world/city-layout.js';
export { cityGreen } from './city-junctions.js';

// Cruise on whichever street the driver joins, in their current direction.
// Lane selection is local, so enabling cruise never aims across city blocks.
export class CityAutodrive {
  constructor({ random = Math.random } = {}) { this.random = random; this.enabled = false; this.reset(); }
  reset() { this.path = null; this.stopKey = null; this.crossing = null; this.turn = null; }
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
    let { axis, direction, lane } = this.path;
    let address = cityLogical(player.s, player.u), position = axis === 'north' ? address.s : address.u;
    if (this.turn?.active) {
      const end = this.turn.points.at(-1);
      if (Math.hypot(player.s - end.s, player.u - end.u) < 2) {
        this.path = this.turn.path; this.turn = null; this.crossing = null; this.stopKey = null;
        ({ axis, direction, lane } = this.path);
        position = axis === 'north' ? address.s : address.u;
      }
    }
    if (!this.turn && (this.crossing === null || (position - this.crossing) * direction > 16)) {
      // Decide once per junction, early enough to brake. Joining inside a
      // junction continues straight until the next one.
      this.crossing = (direction > 0 ? Math.ceil(position / CITY_BLOCK) : Math.floor(position / CITY_BLOCK)) * CITY_BLOCK;
      const gap = (this.crossing - position) * direction;
      const choice = this.random();
      if (gap > 25 && choice < .4) this.planTurn(choice < .2 ? -1 : 1);
    }
    const pose = cityLanePose(axis, lane, position, direction);
    const lookahead = Math.max(6, Math.abs(player.speed ?? 0) * .65);
    let aim = cityLanePose(axis, lane, position + direction * lookahead / pose.stretch, direction);
    let turnSpeed = Infinity;
    if (this.turn) {
      const turn = this.turn, remaining = (turn.start - position) * direction;
      turnSpeed = Math.sqrt(36 + 14 * Math.max(0, remaining));
      if (remaining <= 2) turn.active = true;
      if (turn.active) {
        turnSpeed = 6;
        // Follow a mapped curve, including in neighborhoods with bent roads.
        let nearest = turn.progress, distance = Infinity;
        for (let i = turn.progress; i < turn.points.length; i++) {
          const p = turn.points[i], d = Math.hypot(p.s - player.s, p.u - player.u);
          if (d < distance) { nearest = i; distance = d; }
        }
        turn.progress = nearest;
        let target = nearest, ahead = 0;
        while (target < turn.points.length - 1 && ahead < 2) {
          const a = turn.points[target], b = turn.points[++target];
          ahead += Math.hypot(b.s - a.s, b.u - a.u);
        }
        aim = turn.points[target];
      } else if (remaining < lookahead) aim = turn.points[0];
      if (traffic.enabled && turn.side < 0 && !turn.active) {
        const oncoming = traffic.vehicles.some(car => {
          if (car.axis !== axis || car.direction !== -direction) return false;
          const p = cityLogical(car.s, car.u), along = axis === 'north' ? p.s : p.u, across = axis === 'north' ? p.u : p.s;
          const gap = (along - this.crossing) * direction;
          return Math.round(across / CITY_BLOCK) === Math.round(lane / CITY_BLOCK)
            && gap > -12 && gap < Math.max(20, (car.speed ?? 0) * 3);
        });
        if (oncoming) turnSpeed = Math.min(turnSpeed, Math.sqrt(14 * Math.max(0, remaining - 3)));
      }
    }
    const ds = aim.s - player.s, du = aim.u - player.u, length = Math.hypot(ds, du);
    const along = ds / Math.max(.001, length), across = du / Math.max(.001, length);
    const cruiseSpeed = player.carId === 'formula' ? player.stats.topSpeed : this.path.speed;
    let speed = Math.min(cruiseSpeed, speedLimit, player.stats.topSpeed, turnSpeed);
    if (traffic.enabled && !this.turn?.active) speed = Math.min(speed, junctionSpeed(this, traffic, axis, direction, lane, position, player.speed ?? 0, dt));
    for (const car of traffic.enabled ? traffic.vehicles : []) {
      const dx = car.u - player.u, ds = car.s - player.s;
      const heading = this.turn?.active ? Math.atan2(across, along) : pose.heading;
      const ahead = ds * Math.cos(heading) + dx * Math.sin(heading);
      const beside = Math.abs(dx * Math.cos(heading) - ds * Math.sin(heading));
      if (ahead > 0 && beside < 3) speed = Math.min(speed, Math.sqrt(2 * 7 * Math.max(0, ahead - 10)));
    }
    return { touchDrive: { amount: speed / player.stats.topSpeed, along, across, heading: Math.atan2(across, along) } };
  }
  planTurn(side) {
    const { axis, direction, lane } = this.path;
    const nextAxis = axis === 'north' ? 'east' : 'north';
    const nextDirection = direction * side * (axis === 'north' ? 1 : -1);
    const profile = cityStreetProfile(nextAxis, Math.round(this.crossing / CITY_BLOCK));
    const nextLane = this.crossing + (nextAxis === 'north' ? 1 : -1) * profile.lane * nextDirection;
    const radius = side > 0 ? 4.5 : 10;
    const start = nextLane - direction * radius;
    const points = [];
    // Quadratic curve tangent to both right-hand lanes at their intersection.
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, along = nextLane - direction * radius * (1 - t) ** 2;
      const across = lane + nextDirection * radius * t ** 2;
      points.push(cityLayout(axis === 'north' ? along : across, axis === 'north' ? across : along));
    }
    this.turn = { side, start, points, progress: 0, active: false,
      path: { axis: nextAxis, direction: nextDirection, lane: nextLane, speed: profile.speed } };
  }
}
