import { cityLayout, cityLogical, cityLayoutFrame, cityRigidFrame } from './city-layout.js';
import { cityStreetProfile, CITY_BLOCK as B } from './city-grid.js';

export function rectangleCorners(frame, width, depth, margin = 0) {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => ({
    u: frame.u + x * (width / 2 + margin) * frame.eu + z * (depth / 2 + margin) * frame.nu,
    s: frame.s + x * (width / 2 + margin) * frame.es + z * (depth / 2 + margin) * frame.ns,
  }));
}

export function parcelsOverlap(a, b, gap = .8) {
  for (const polygon of [a, b]) for (let i = 0; i < 2; i++) {
    const p = polygon[i], q = polygon[i + 1], length = Math.hypot(q.u - p.u, q.s - p.s);
    const u = -(q.s - p.s) / length, s = (q.u - p.u) / length;
    const aa = a.map(v => v.u * u + v.s * s), bb = b.map(v => v.u * u + v.s * s);
    if (Math.max(...aa) + gap <= Math.min(...bb) || Math.max(...bb) + gap <= Math.min(...aa)) return false;
  }
  return true;
}

export function footprintFitsBlock(plan, corners, setback = 3) {
  const minX = cityStreetProfile('north', plan.ix).halfWidth + setback;
  const maxX = B - cityStreetProfile('north', plan.ix + 1).halfWidth - setback;
  const minS = cityStreetProfile('east', plan.iz).halfWidth + setback;
  const maxS = B - cityStreetProfile('east', plan.iz + 1).halfWidth - setback;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length];
    for (const t of [0, .5]) {
      const p = cityLogical(a.s + (b.s - a.s) * t, a.u + (b.u - a.u) * t);
      const x = p.u - plan.ix * B, s = p.s - plan.iz * B;
      if (x < minX || x > maxX || s < minS || s > maxS) return false;
    }
  }
  return true;
}

// Preserve the selected architecture's dimensions. A finite search fits whole
// rectangles, and leaves awkward lots open instead of shearing their buildings.
export function placeCityBuildings(plan, buildings) {
  const placed = [], open = [], center = cityLayout((plan.iz + .5) * B, (plan.ix + .5) * B);
  for (const b of buildings) {
    const s = plan.iz * B + b.s, u = plan.ix * B + b.x;
    const northFacing = Math.min(b.x, B - b.x) < Math.min(b.s, B - b.s);
    const tangent = cityLayoutFrame(northFacing ? s : (plan.iz + (b.s > B / 2 ? 1 : 0)) * B,
      northFacing ? (plan.ix + (b.x > B / 2 ? 1 : 0)) * B : u);
    const heading = northFacing ? Math.atan2(tangent.nu, tangent.ns) : Math.atan2(-tangent.es, tangent.eu);
    const base = cityRigidFrame(s, u, heading), distance = Math.max(1, Math.hypot(center.s - base.s, center.u - base.u));
    const ds = (center.s - base.s) / distance, du = (center.u - base.u) / distance;
    let fitted = null;
    for (const inward of [0, 2, 5, 8, 12]) {
      for (const sideways of [0, -3, 3]) {
        const frame = { ...base, s: base.s + ds * inward + du * sideways, u: base.u + du * inward - ds * sideways };
        const corners = rectangleCorners(frame, b.width, b.depth);
        if (!footprintFitsBlock(plan, rectangleCorners(frame, b.width, b.depth, 1.2))) continue;
        if (placed.some(other => parcelsOverlap(corners, other.corners))) continue;
        fitted = { ...b, frame, corners }; break;
      }
      if (fitted) break;
    }
    if (fitted) placed.push(fitted); else open.push(b);
  }
  return { buildings: placed, open };
}
