// Arcade handling: responsive controls, a speed-dependent turning radius and
// bounded tire slip. No suspension solver or per-wheel tire simulation.
export function steeringResponse(current, target, dt) {
  if (dt <= 0) return current;
  // A direction change takes effect on this tick. Do not spend the first
  // frames unwinding the old input while the player is trying to catch a slide.
  if (current * target < 0) current = 0;
  const releasing = Math.abs(target) < Math.abs(current);
  return target + (current - target) * Math.exp(-dt * (releasing ? 90 : 60));
}

// A handbrake tap initiates a slide. Gas and steering carry it through a bend;
// centering, countersteering, lifting, or braking hands control back to grip.
// Entry/exit speed hysteresis keeps a slow slide from flickering on and off.
export function driftDirection(previous, speed, steer, input, pressed) {
  if (input.brake || speed < 6) return 0;
  if (previous && steer * previous > .12 && (input.forward > .15 || input.handbrake)) return previous;
  if (!previous && pressed && speed > 8 && Math.abs(steer) > .2) return Math.sign(steer);
  return 0;
}

export function turningRadius(speed, stats, looseness = 0) {
  const surfaceGrip = 1 - .25 * looseness;
  // Radius grows continuously with speed. Full lock still fits a junction at
  // low speed, while lateral acceleration stays bounded on a fast straight.
  return Math.hypot(stats.turnRadius / surfaceGrip, speed * speed / (stats.cornering * surfaceGrip));
}

export function turnRate(speed, steer, stats, looseness = 0, drift = 0) {
  const radius = turningRadius(speed, stats, looseness);
  // Give small stick movements (and the start of a keyboard tap) more precision.
  const control = steer * (.65 + .35 * steer * steer);
  return control * speed / (radius * (1 - .36 * drift));
}

export function travelHeading(previous, heading, dt, grip, drift) {
  const slip = Math.atan2(Math.sin(previous - heading), Math.cos(previous - heading));
  // Strong grip must also stop lateral washout, not just turn the chassis.
  // Deliberate drifts keep their own recovery rate so slicks can still slide.
  const traction = 40 * grip * grip * (1 - drift) + 3.5 * Math.sqrt(grip) * drift;
  // Grip driving tracks input closely; slides keep enough sideways motion to
  // be visible, with a hard safety envelope against an uncontrolled spin.
  return heading + Math.max(-.55, Math.min(.55, slip * Math.exp(-dt * traction)));
}
