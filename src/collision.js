import { CHUNK_LENGTH, clamp } from './world/route.js';
import { trafficContact } from './traffic.js';

// Circle-vs-car contact, returning the car's push-out normal and depth in the
// same shape as trafficContact.
export function postContact(car, post) {
  const cos = Math.cos(car.heading), sin = Math.sin(car.heading), dx = post.x - car.x, dz = post.z - car.z;
  // Post position in the car's frame.
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

// Separating-axis test against a building's convex footprint, which can be
// oblique where a neighborhood bends, rather than its larger bounding box.
export function footprintContact(car, solid) {
  const cos = Math.cos(car.heading), sin = Math.sin(car.heading);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => ({
    x: car.x + x * car.halfWidth * cos + z * car.halfLength * sin,
    z: car.z + x * car.halfWidth * sin - z * car.halfLength * cos,
  }));
  let contact = null;
  for (const polygon of [corners, solid.corners]) for (let i = 0; i < (polygon === corners ? 2 : polygon.length); i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 1e-8) continue;
    const x = -(b.z - a.z) / length, z = (b.x - a.x) / length;
    const carProjection = corners.map(p => p.x * x + p.z * z), solidProjection = solid.corners.map(p => p.x * x + p.z * z);
    const left = Math.max(...solidProjection) - Math.min(...carProjection);
    const right = Math.max(...carProjection) - Math.min(...solidProjection);
    if (left <= 0 || right <= 0) return null;
    const depth = Math.min(left, right), sign = left < right ? 1 : -1;
    if (!contact || depth < contact.depth) contact = { x: x * sign, z: z * sign, depth };
  }
  return contact;
}

// The cheap distance rejects discard nearly every collider, so checking a
// chunk's few hundred costs less than posing one traffic car.
export function collideScenery(player, chunks, dt) {
  const p = player.groundedPosition, halfWidth = player.spec.width / 2, halfLength = player.spec.length / 2;
  const reach = Math.hypot(halfWidth, halfLength), center = Math.floor(player.s / CHUNK_LENGTH);
  const nearby = player.route.grid ? chunks.values() : [chunks.get(center - 1), chunks.get(center), chunks.get(center + 1)];
  for (const chunk of nearby) {
    const bounds = chunk?.collisionBounds;
    if (bounds && (p.x + reach < bounds.minX || p.x - reach > bounds.maxX || p.z + reach < bounds.minZ || p.z - reach > bounds.maxZ)) continue;
    const colliders = chunk?.features?.colliders;
    if (!colliders) continue;
    for (const solid of colliders) {
      if (Math.abs(solid.z - p.z) > reach + solid.reach || Math.abs(solid.x - p.x) > reach + solid.reach) continue;
      const car = { x: p.x, z: p.z, heading: player.heading, halfWidth, halfLength };
      const contact = solid.corners ? footprintContact(car, solid) : solid.heading === undefined ? postContact(car, solid) : trafficContact(car, solid);
      if (contact) player.resolveSceneryCollision(contact.x, contact.z, contact.depth, dt);
    }
  }
}
