import { clamp } from './world/route.js';

const LANE = 2.4;
const CLEARANCE = 12;

// Two lanes, one passing target. Wait behind traffic until the whole pass fits.
export class Autodrive {
  constructor() { this.enabled = false; this.passing = null; }
  reset() { this.passing = null; }
  toggle() { this.enabled = !this.enabled; this.reset(); return this.enabled; }

  update(player, traffic) {
    const cars = traffic.enabled ? traffic.vehicles : [];
    const { topSpeed, acceleration, touchBraking } = player.stats;
    const frame = player.route.frame(player.s);
    const ahead = car => (car.s - player.s) * frame.scale;
    const halfLength = car => (player.spec.length + car.spec.length) / 2;
    const rightClear = () => cars.every(car => car.u < 0 || Math.abs(ahead(car)) > halfLength(car) + CLEARANCE);
    if (this.passing && (!cars.includes(this.passing) ||
      (ahead(this.passing) < -halfLength(this.passing) - CLEARANCE && rightClear()))) this.reset();

    let lead = null;
    for (const car of cars) {
      if (car.direction > 0 && car.u > 0 && ahead(car) > -halfLength(car) && (!lead || car.s < lead.s)) lead = car;
    }
    if (!this.passing && lead) {
      const gap = ahead(lead) - halfLength(lead);
      const closing = Math.max(0, player.speed - lead.speed);
      if (gap < CLEARANCE + player.speed * 1.5 + closing * closing / (2 * touchBraking)) {
        // Close groups need one pass; don't aim for a gap too small to merge into.
        let last = lead;
        for (let i = 0; i < cars.length; i++) {
          for (const car of cars) {
            if (car.direction > 0 && car.s > last.s &&
              (car.s - last.s) * frame.scale < (car.spec.length + last.spec.length) / 2 + CLEARANCE * 2) last = car;
          }
        }
        const time = (ahead(last) + halfLength(last) + CLEARANCE) / Math.max(1, topSpeed - last.speed)
          + Math.max(0, topSpeed - player.speed) / acceleration + 3;
        const clear = cars.every(car => car.u > 0 || ahead(car) < -halfLength(car) - CLEARANCE ||
          ahead(car) > (topSpeed + Math.max(car.speed, car.cruiseSpeed)) * time + halfLength(car) + CLEARANCE);
        if (clear && topSpeed > last.speed + 2) this.passing = last;
      }
    }

    const lane = this.passing ? -LANE : LANE;
    let speed = topSpeed;
    // While changing lanes, keep braking for anything still in our footprint.
    // Following uses relative stopping distance, allowing a steady matching speed.
    for (const car of cars) {
      if (Math.abs(car.u - player.u) > (car.spec.width + player.spec.width) / 2 + .35) continue;
      const gap = ahead(car) - halfLength(car);
      if (gap < -halfLength(car) * 2) continue;
      const moving = car.direction > 0 ? car.speed : 0;
      speed = Math.min(speed, Math.sqrt(moving * moving + 2 * touchBraking * Math.max(0, gap - CLEARANCE)));
      if (gap < CLEARANCE) speed = Math.min(speed, moving * Math.max(0, gap) / CLEARANCE);
    }
    // Reuse the existing assisted driving input for acceleration, braking and
    // road-relative steering. Lateral speed is bounded for smooth lane changes.
    const across = clamp((lane - player.u) * 1.6, -2.8, 2.8) / Math.max(4, player.speed);
    return { touchDrive: {
      amount: speed / topSpeed,
      along: Math.sqrt(1 - across * across) / frame.scale,
      across,
      heading: frame.angle + Math.asin(across),
    } };
  }
}
