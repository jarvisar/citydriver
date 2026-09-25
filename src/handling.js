// Arcade handling: steering chases the input directly, the turning radius is
// the tighter of what lock and tires allow, weight shifts with the pedals, and
// tires give a little at their limit and a lot under the handbrake. No
// suspension solver and no per-wheel tire model.

// Fine stick control near centre. Applied to the request rather than the
// smoothed angle, so a keypress never starts inside a dead zone.
export const steerCurve = input => input * (.62 + .38 * input * input);

// Turn-in is faster at low speed, so parking corrections land at once while
// the car stays settled at speed. Release and countersteer are faster still,
// and a reversal starts from centre instead of unwinding the old lock.
export function steeringResponse(current, target, dt, stats, speed = 0) {
  if (dt <= 0) return current;
  if (current * target < 0) current = 0;
  const pace = stats ? Math.min(1, Math.abs(speed) / stats.topSpeed) : 0;
  const rate = Math.abs(target) < Math.abs(current) ? 135 : 115 - 60 * pace;
  return target + (current - target) * Math.exp(-dt * rate);
}

// Lateral grip: less on loose ground, more with weight over the nose. This is
// the whole weight transfer model. Braking gains more (20%) than power costs
// (10%), so braking into a corner pays and running wide on exit is mild.
const lateralLimit = (stats, looseness, bias) =>
  stats.cornering * (1 - .25 * looseness) * (1 + (bias > 0 ? .2 : .1) * bias);

// Steering lock binds at walking pace, tire grip at speed. A quartic blend
// avoids the ~40% inflation a hypotenuse gives at the crossover, which falls
// in the 10-18 m/s band city corners are taken at.
export function turningRadius(speed, stats, looseness = 0, bias = 0) {
  const lock = stats.turnRadius / (1 - .25 * looseness);
  const arc = speed * speed / lateralLimit(stats, looseness, bias);
  const l = lock * lock, a = arc * arc;
  return Math.sqrt(Math.sqrt(l * l + a * a));
}

export function turnRate(speed, steer, stats, looseness = 0, drift = 0, bias = 0) {
  // Sliding tires point the car further into the bend than they carry it.
  return steer * speed / (turningRadius(speed, stats, looseness, bias) * (1 - .36 * drift));
}

// Share (0..1) of available tire grip in use. Body roll and slip both read it.
export function corneringLoad(speed, yaw, stats, looseness = 0, bias = 0) {
  return Math.min(1, Math.abs(yaw * speed) / lateralLimit(stats, looseness, bias));
}

// A slide starts from an armed handbrake tap plus steering. Gas and steering
// carry it; centring, countersteering, lifting or braking ends it. Entry and
// exit speeds differ so a slow slide cannot flicker on and off.
export function driftDirection(previous, speed, steer, input, armed) {
  if (input.brake || speed < 6) return 0;
  if (previous && steer * previous > .1 && (input.forward > .12 || input.handbrake)) return previous;
  if (!previous && armed && speed > 7.5 && Math.abs(steer) > .15) return Math.sign(steer);
  return 0;
}

export function travelHeading(previous, heading, dt, grip, drift, load = 0) {
  const slip = Math.atan2(Math.sin(previous - heading), Math.cos(previous - heading));
  // Tires give near their limit, so a committed corner shows some slip while
  // ordinary driving tracks the nose. A deliberate slide recovers far more
  // slowly, so even slicks can slide.
  const bite = 1 - .45 * load * load;
  const traction = 60 * grip * grip * bite * (1 - drift) + 3.5 * Math.sqrt(grip) * drift;
  // Slip is capped at .55 rad so a slide stays visible but cannot become a spin.
  return heading + Math.max(-.55, Math.min(.55, slip * Math.exp(-dt * traction)));
}
