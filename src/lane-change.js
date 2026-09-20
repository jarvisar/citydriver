import { clamp } from './world/route.js';

// A lane change follows distance travelled, so braking slows progress along the
// curve and stopping never slides the car sideways. Faster cars use a tighter
// 1.7-second maneuver; ordinary cruising takes 2.15 seconds, including both
// rounded ends (no long settling tail).

export class LaneChange {
  constructor(player, lane, previous = null, speedLimit = player.stats.topSpeed) {
    this.start = player.distance;
    // Include the run-up to cruise speed. Otherwise a powerful car beginning
    // behind slow traffic would accelerate through a short curve too quickly.
    const speed = Math.abs(player.speed);
    const cruise = Math.max(speed, Math.min(speedLimit, speed + player.stats.acceleration * 2.15));
    const referenceSpeed = (speed + cruise) / 2;
    const duration = 2.15 - .45 * clamp((referenceSpeed - 25) / 25, 0, 1);
    this.length = Math.max(16, referenceSpeed * duration);
    this.lane = lane;
    const pose = previous?.sample(this.start);
    const slope = pose?.slope ?? Math.sin(player.heading - player.route.frame(player.s).angle);
    const v = slope * this.length, a = (pose?.curvature ?? 0) * this.length ** 2;
    const change = lane - player.u;
    // Quintic Hermite: preserve position, tangent and curvature when a target
    // changes mid-pass, and finish parallel to the lane with zero curvature.
    this.coefficients = [player.u, v, a / 2,
      10 * change - 6 * v - 1.5 * a,
      -15 * change + 8 * v + 1.5 * a,
      6 * change - 3 * v - .5 * a];
  }
  sample(distance) {
    const t = clamp((distance - this.start) / this.length, 0, 1);
    if (t === 1) return { u: this.lane, slope: 0, curvature: 0 };
    const [c0, c1, c2, c3, c4, c5] = this.coefficients;
    return {
      u: c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * c5)))),
      slope: (c1 + t * (2 * c2 + t * (3 * c3 + t * (4 * c4 + t * 5 * c5)))) / this.length,
      curvature: (2 * c2 + t * (6 * c3 + t * (12 * c4 + t * 20 * c5))) / this.length ** 2,
    };
  }
}
