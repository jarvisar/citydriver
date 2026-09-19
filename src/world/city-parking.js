import * as THREE from 'three';
import { CHUNK_LENGTH, randomAt, roadFrame, smoothstep } from './route.js';
import { blockAt, blockBoundary, quayOffset, cityGroundHeight, pavementHeight } from './city-route.js';

const sites = new Map();
const EDGE = 15.2, TAPER = 9, SPACING = 4.2, ANGLE = Math.PI / 4;
const FRONT = -8.8, BACK = -14.4, SKEW = (FRONT - BACK) / Math.tan(ANGLE);
const ASPHALT = new THREE.Color('#4d5155'), PAINT = new THREE.Color('#bfc2b8'), KERB = new THREE.Color('#a4a7a9');

export function cityParkingForBlock(block) {
  if (!sites.has(block)) {
    const from = blockBoundary(block) + 18, to = blockBoundary(block + 1) - 18;
    // The same broad embankments that held the old parking rows. Keep the
    // ends clear of crossings, and enough land behind for the riverside walk.
    const wide = quayOffset((from + to) / 2) < -35 && Math.max(quayOffset(from), quayOffset(to)) < -31.5;
    sites.set(block, wide && to - from >= 36 ? { block, from, to } : null);
    if (sites.size > 128) sites.delete(sites.keys().next().value);
  }
  return sites.get(block);
}

export function cityParkingAt(s, margin = 0) {
  const site = cityParkingForBlock(blockAt(s));
  return site && s >= site.from - margin && s <= site.to + margin ? site : null;
}

export function cityParkingWidth(s, site = cityParkingAt(s)) {
  return site ? 6.05 + (EDGE - 6.05) * smoothstep(site.from, site.from + TAPER, s) *
    (1 - smoothstep(site.to - TAPER, site.to, s)) : 6.05;
}

// Retain the existing pavement level, with a dropped-curb ramp at the road.
export const cityParkingHeight = (s, u) => cityGroundHeight(s, u) + .04 + .035 * (1 - smoothstep(6, 6.6, Math.abs(u)));

export function buildCityParking(chunk) {
  const { streets, details } = chunk.scenery, end = chunk.start + CHUNK_LENGTH;
  // Clip strips by their longitudinal coordinates, so angled markings and
  // asphalt have a single owner even where a pull-off crosses a chunk seam.
  const strip = (target, a, b, color, height, lift = 0) => {
    const from = Math.max(a.s, chunk.start), to = Math.min(b.s, end);
    if (to <= from) return;
    const point = (s, edge) => {
      const t = (s - a.s) / (b.s - a.s), u = a[edge] + (b[edge] - a[edge]) * t;
      return chunk.at(s, u, height(s, u) + lift);
    };
    chunk.quad(target, [point(from, 'near'), point(to, 'near'), point(to, 'far'), point(from, 'far')], color, [0, 1, 0]);
  };
  for (let block = blockAt(chunk.start - 80); block <= blockAt(end + 80); block++) {
    const site = cityParkingForBlock(block);
    if (!site || site.to <= chunk.start || site.from >= end) continue;
    for (let s = Math.max(site.from, chunk.start); s < Math.min(site.to, end); s += 2) {
      const t = Math.min(s + 2, site.to, end), a = -cityParkingWidth(s, site), b = -cityParkingWidth(t, site);
      for (const [near, far] of [[-5.5, -6], [-6, -6.6], [-6.6, null]]) {
        // At the narrow tip, the outer edge can end inside the curb ramp.
        const aNear = Math.max(near, a), bNear = Math.max(near, b);
        const aFar = Math.max(far ?? a, a), bFar = Math.max(far ?? b, b);
        if (aNear === aFar && bNear === bFar) continue;
        strip(streets, { s, near: aNear, far: aFar }, { s: t, near: bNear, far: bFar }, ASPHALT, cityParkingHeight);
      }
      strip(details, { s, near: a, far: a - .45 }, { s: t, near: b, far: b - .45 }, KERB, t => pavementHeight(t), .055);
      chunk.quad(details, [chunk.at(s, a, cityParkingHeight(s, a)), chunk.at(t, b, cityParkingHeight(t, b)),
        chunk.at(t, b, pavementHeight(t) + .055), chunk.at(s, a, pavementHeight(s) + .055)], KERB, [1, 0, 0]);
    }
    const first = site.from + TAPER + 1.5;
    const count = Math.floor((site.to - TAPER - 1.5 - SKEW - first) / SPACING);
    for (let k = 0; k <= count; k++) {
      const s = first + k * SPACING;
      // The waterfront lane travels toward decreasing s. Bay noses point
      // that way too, at a gentle 45 degrees into the pull-off.
      strip(streets, { s, near: BACK + .13, far: BACK }, { s: s + SKEW, near: FRONT, far: FRONT - .13 }, PAINT, cityParkingHeight, .012);
      if (k === count) continue;
      const center = s + (SPACING + SKEW) / 2, u = (FRONT + BACK) / 2;
      strip(streets, { s, near: BACK + .11, far: BACK },
        { s: s + SPACING, near: BACK + .11, far: BACK }, PAINT, cityParkingHeight, .012);
      if (!chunk.inChunk(center) || randomAt(block * 53 + k, 3251) > .6) continue;
      chunk.parkedCar(center, u, -roadFrame(center).angle + Math.PI - ANGLE, block * 53 + k,
        cityParkingHeight(center, u) - chunk.ground(center, u).y);
    }
  }
}
