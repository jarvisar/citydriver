import { clamp } from './world/route.js';

const LANE = 2.4;
const CLEARANCE = 12;
const LATERAL = 2.8;   // metres per second of lane change
const STEERING_RATE = 6; // ease into a new direction over about half a second
const TURN_RATE = .6; // radians per second relative to the road, including aborted passes
const STEERING_DELAY = 2 / STEERING_RATE; // allow for turn-in when predicting clearance
const MARGIN = 1.8;    // seconds still to spare once the pass ends; lower passes more often

// Two lanes, one passing target. Wait behind traffic until the whole pass fits.
export class Autodrive {
  constructor() { this.enabled = false; this.reset(); }
  reset() { this.passing = null; this.across = null; }
  toggle() { this.enabled = !this.enabled; this.reset(); return this.enabled; }

  update(player, traffic, speedLimit = player.stats.topSpeed, dt = 1 / 60) {
    const cars = traffic.enabled ? traffic.vehicles : [];
    const { acceleration, touchBraking } = player.stats;
    const topSpeed = Math.min(player.stats.topSpeed, speedLimit);
    const frame = player.route.frame(player.s);
    const ahead = car => (car.s - player.s) * frame.scale;
    const halfLength = car => (player.spec.length + car.spec.length) / 2;
    const rightClear = () => cars.every(car => car.u < 0 || Math.abs(ahead(car)) > halfLength(car) + CLEARANCE);
    if (this.passing && (!cars.includes(this.passing) ||
      (ahead(this.passing) < -halfLength(this.passing) - CLEARANCE && rightClear()))) this.passing = null;

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
        // Time to draw level and pull back in, plus half the run-up to top
        // speed -- the car covers ground while it accelerates, so charging the
        // whole ramp on top of the overtake refuses passes that comfortably fit.
        const time = (ahead(last) + halfLength(last) + CLEARANCE) / Math.max(1, topSpeed - last.speed)
          + Math.max(0, topSpeed - player.speed) / (2 * acceleration) + MARGIN + 2 * STEERING_DELAY;
        const clear = cars.every(car => car.u > 0 || ahead(car) < -halfLength(car) - CLEARANCE ||
          ahead(car) > (topSpeed + Math.max(car.speed, car.cruiseSpeed)) * time + halfLength(car) + CLEARANCE);
        if (clear && topSpeed > last.speed + 2) this.passing = last;
      }
    }

    const lane = this.passing ? -LANE : LANE;
    let speed = topSpeed;
    // Brake only for cars we would still be sharing a lane with on arrival, not
    // for ones the lane change clears first -- otherwise pulling out behind the
    // car being passed brakes hard at the exact moment the pass needs the speed.
    // Following uses relative stopping distance, allowing a steady matching speed.
    for (const car of cars) {
      const gap = ahead(car) - halfLength(car);
      if (gap < -halfLength(car) * 2) continue;
      const moving = car.direction > 0 ? car.speed : 0;
      const reach = Math.max(0, gap) / Math.max(.5, player.speed - car.direction * car.speed);
      const lateralReach = LATERAL * Math.max(0, reach - STEERING_DELAY);
      const u = player.u + clamp(lane - player.u, -lateralReach, lateralReach);
      if (Math.abs(car.u - u) > (car.spec.width + player.spec.width) / 2 + .35) continue;
      speed = Math.min(speed, Math.sqrt(moving * moving + 2 * touchBraking * Math.max(0, gap - CLEARANCE)));
      if (gap < CLEARANCE) speed = Math.min(speed, moving * Math.max(0, gap) / CLEARANCE);
    }
    // Ease the actual travel direction, not just the camera. Keep this state
    // when a pass ends so merging back also turns in gently. A slightly softer
    // lane correction lets the steering settle without overshooting the lane.
    const targetAcross = clamp((lane - player.u) * 1.4, -LATERAL, LATERAL) / Math.max(4, player.speed);
    if (this.across === null) this.across = clamp(Math.sin(player.heading - frame.angle), -.7, .7);
    const angle = Math.asin(this.across);
    const turn = (Math.asin(targetAcross) - angle) * (1 - Math.exp(-STEERING_RATE * dt));
    this.across = Math.sin(angle + clamp(turn, -TURN_RATE * dt, TURN_RATE * dt));
    const across = this.across;
    return { touchDrive: {
      amount: speed / player.stats.topSpeed,
      along: Math.sqrt(1 - across * across) / frame.scale,
      across,
      heading: frame.angle + Math.asin(across),
    } };
  }
}
