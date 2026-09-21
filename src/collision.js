import { CHUNK_LENGTH, clamp } from './world/route.js';
import { trafficContact } from './traffic.js';

// A round footprint against the car's rectangle, answering as trafficContact
// does: the way out for the car, and how far.
export function postContact(car, post) {
  const cos = Math.cos(car.heading), sin = Math.sin(car.heading), dx = post.x - car.x, dz = post.z - car.z;
  // The post in the car's own frame, across it and then along it.
  const across = dx * cos + dz * sin, along = dx * sin - dz * cos;
  let x = across - clamp(across, -car.halfWidth, car.halfWidth), z = along - clamp(along, -car.halfLength, car.halfLength);
  const distance = Math.hypot(x, z);
  let depth = post.reach - distance;
  if (depth <= 0) return null;
  if (distance > 1e-6) { x /= distance; z /= distance; }
  else {
    // The post's centre is already under the car: leave by the nearer side.
    const side = car.halfWidth - Math.abs(across), end = car.halfLength - Math.abs(along);
    x = side < end ? Math.sign(across) || 1 : 0; z = side < end ? 0 : Math.sign(along) || 1;
    depth = post.reach + Math.min(side, end);
  }
  return { x: -(x * cos + z * sin), z: -(x * sin - z * cos), depth };
}

// The car against whatever stands in the chunks around it. Nearly every
// footprint is turned away by two subtractions, so a chunk's few hundred cost
// less than posing one traffic car.
export function collideScenery(player, chunks, dt) {
  const p = player.groundedPosition, halfWidth = player.spec.width / 2, halfLength = player.spec.length / 2;
  const reach = Math.hypot(halfWidth, halfLength), center = Math.floor(player.s / CHUNK_LENGTH);
  for (let index = center - 1; index <= center + 1; index++) {
    const colliders = chunks.get(index)?.features?.colliders;
    if (!colliders) continue;
    for (const solid of colliders) {
      if (Math.abs(solid.z - p.z) > reach + solid.reach || Math.abs(solid.x - p.x) > reach + solid.reach) continue;
      const car = { x: p.x, z: p.z, heading: player.heading, halfWidth, halfLength };
      const contact = solid.heading === undefined ? postContact(car, solid) : trafficContact(car, solid);
      if (contact) player.resolveSceneryCollision(contact.x, contact.z, contact.depth, dt);
    }
  }
}
