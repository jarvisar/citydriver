import { roadFrame, positionAt, randomAt, smoothstep, lerp } from './route.js';

export const JUNGLE_STEP = 8;
export const RIVER_STEP = 2;
export const POOL_SPAN = 88;

// Smooth two-dimensional value noise for cohesive groves, litter and moss patches.
export function jungleNoise(s, u, span, salt) {
  const cs = Math.floor(s / span), cu = Math.floor(u / span);
  const ts = smoothstep(0, 1, s / span - cs), tu = smoothstep(0, 1, u / span - cu);
  const at = (i, j) => randomAt(i * 1031 + j, salt);
  return lerp(lerp(at(cs, cu), at(cs + 1, cu), ts), lerp(at(cs, cu + 1), at(cs + 1, cu + 1), ts), tu);
}
export function ribbonNoise(s, span, salt) {
  const cell = Math.floor(s / span), t = smoothstep(0, 1, s / span - cell);
  return lerp(randomAt(cell, salt), randomAt(cell + 1, salt), t);
}

// A river runs below the road on the camera side, wandering closer and
// farther and widening into pools. Its banks are exact terrain columns.
export function riverCenter(s) { return -49 - 9 * Math.sin(s / 171 + .4) - 3 * Math.sin(s / 73) - 2.8 * Math.sin(s / 43 + .9); }
export function riverHalfWidth(s) {
  const pool = poolAt(s), t = (s - pool.start) / (pool.end - pool.start);
  return 7.1 + 1.4 * Math.sin(s / 121 + 1) + .8 * Math.sin(s / 51) + (2.4 + 1.6 * randomAt(pool.index, 2206)) * Math.sin(t * Math.PI) ** 2
    + .28 * Math.sin(s / 4.3) + .22 * Math.sin(s / 9.1 + 2);
}

// Generate the watershed first. A positive grade and bounded level variation
// make EVERY pool lower downstream, including negative indices and arbitrarily
// distant chunks. There are no anchor resets or dams concealing uphill water.
const POOL_RISE = 3.7;
const valleyPhase = randomAt(0, 2202) * Math.PI * 2;
function poolBoundary(index) { return Math.round((index * POOL_SPAN + 22 + randomAt(index, 2201) * 36) / RIVER_STEP) * RIVER_STEP; }
function poolLevel(index) {
  return 12 + index * POOL_RISE + 1.3 * Math.sin(index * 1.83 + valleyPhase) + .25 * randomAt(index, 2203);
}
// The road climbs the same valley smoothly, independent of the coastal hills.
export function jungleRoadHeight(s) {
  return 24 + (s - 40) * POOL_RISE / POOL_SPAN + 1.8 * Math.sin(s / 193 + valleyPhase) + .6 * Math.sin(s / 79);
}
export function poolAt(s) {
  let index = Math.floor((s - 22) / POOL_SPAN);
  if (s < poolBoundary(index)) index--;
  return { index, start: poolBoundary(index), end: poolBoundary(index + 1), level: poolLevel(index), before: poolLevel(index - 1), after: poolLevel(index + 1) };
}
// Broken, shallow chevrons keep the sill from reading as a straight weir.
export function riverLipOffset(index, across) {
  return .85 * (Math.sin(across * 3.7 + index * 2.3) - Math.sin(index * 2.3)) + .45 * across;
}
export function riverLevel(s, across = 0) {
  const pool = poolAt(s);
  for (const [index, at, lower, upper] of [[pool.index, pool.start, pool.before, pool.level], [pool.index + 1, pool.end, pool.level, pool.after]]) {
    if (Math.abs(s - at) > 5) continue;
    const distance = s - at - riverLipOffset(index, across);
    return lerp(lower, upper, Math.max(0, Math.min(1, (distance + RIVER_STEP) / RIVER_STEP)));
  }
  return pool.level;
}
export function riverLips(from, to) {
  const found = [];
  for (let index = Math.floor((from - 22) / POOL_SPAN) - 1; index <= Math.floor((to - 22) / POOL_SPAN) + 1; index++) {
    const s = poolBoundary(index);
    if (s < from || s >= to) continue;
    const below = poolLevel(index - 1), above = poolLevel(index);
    found.push({ index, s, upper: above, lower: below, drop: above - below, direction: -1 });
  }
  return found;
}
// Foam strength: strong below each fall, a light drawing-in above it.
export function riverTurbulence(s) {
  const pool = poolAt(s);
  return Math.max(1 - smoothstep(1.5, 11 + Math.min(8, pool.after - pool.level), pool.end - s),
    .4 * (1 - smoothstep(0, 4, s - pool.start)));
}
// The bed anticipates each drop so the rock never rises through the falling water.
export function riverBedLevel(s) { return Math.min(riverLevel(s - 6), riverLevel(s), riverLevel(s + 6)); }

// A few partly submerged stones split the current. Shared placement lets foam
// wakes and instanced rock use the same position, including at chunk borders.
export function riverRocks(from, to) {
  const rocks = [];
  for (let cell = Math.floor(from / 23) - 1; cell <= Math.floor(to / 23); cell++) {
    const s = cell * 23 + 3 + randomAt(cell, 2511) * 16, pool = poolAt(s);
    if (s < from || s >= to || Math.min(s - pool.start, pool.end - s) < 14 || randomAt(cell, 2512) < .2) continue;
    rocks.push({ s, u: riverCenter(s) + (randomAt(cell, 2513) < .5 ? -1 : 1) * riverHalfWidth(s) * (.5 + randomAt(cell, 2514) * .3),
      size: .8 + randomAt(cell, 2515) * 1.3, seed: cell });
  }
  return rocks;
}

// Resolve the sill and the plunge basin in the ground mesh. Use a short band
// of fine rows around each fall and retain coarse rows between falls.
export function jungleRows(from, to) {
  const rows = new Set([from, to]);
  for (let s = Math.ceil(from / JUNGLE_STEP) * JUNGLE_STEP; s < to; s += JUNGLE_STEP) rows.add(s);
  for (const lip of riverLips(from - 8, to + 8)) for (let d = -8; d <= 8; d += RIVER_STEP) {
    const s = lip.s + d;
    if (s > from && s < to) rows.add(s);
  }
  return [...rows].sort((a, b) => a - b);
}
// A sheer rock wall drops from a mossy terrace into the river along parts of
// the gorge, opening out into lower banks between the taller falls.
export function gorgeWall(s) {
  const pool = poolAt(s);
  let wall = smoothstep(.52, .82, ribbonNoise(s, 87, 2217));
  const near = (at, tall) => { if (tall) wall = Math.max(wall, 1 - smoothstep(6, 18, Math.abs(s - at))); };
  near(pool.start, pool.level - pool.before > 4.7);
  near(pool.end, pool.after - pool.level > 4.7);
  return wall;
}

// Only protect exposed road edges: a tall gorge across a broad planted
// terrace does not require a roadside rail.
export function jungleGuardrail(s) {
  const rim = riverCenter(s) + riverHalfWidth(s) + 7;
  return rim > -25 && gorgeWall(s) > .65 && jungleHeight(s, rim) - riverLevel(s) > 6;
}

// Side streams come down the far hillside, pass under the road through a
// culvert, cross the terrace and pour down the gorge wall, where it is sheer and
// tall, clear of the river's own lips, at most one per cell.
export const SIDE_FALL_CELL = 240;
export function sideFalls(from, to) {
  const falls = [];
  for (let cell = Math.floor(from / SIDE_FALL_CELL) - 1; cell <= Math.floor(to / SIDE_FALL_CELL); cell++) {
    if (randomAt(cell, 2501) > .6) continue;
    const base = cell * SIDE_FALL_CELL, offset = Math.floor(randomAt(cell, 2502) * 26);
    for (let k = 0; k < 26; k++) {
      const s = base + 20 + ((offset + k) % 26) * 8, pool = poolAt(s);
      if (Math.min(Math.abs(s - pool.start), Math.abs(s - pool.end)) < 22) continue;
      if (gorgeWall(s - 6) < .9 || gorgeWall(s + 6) < .9 || jungleRoadHeight(s) - pool.level < 9.5) continue;
      if (s >= from && s < to) falls.push({ s, width: 3.5 + randomAt(cell, 2503) * 2.5 });
      break;
    }
  }
  return falls;
}

// Stretches of the route lean toward one character or another: palm groves,
// bamboo thickets and tunnels of giant trees. Each weight
// eases in and out over a few hundred metres and most of the route has none.
export function jungleZones(s) {
  const zone = (span, salt, from, to) => smoothstep(from, to, ribbonNoise(s, span, salt));
  return { palms: zone(173, 2601, .6, .76), bamboo: zone(149, 2602, .64, .8), giants: zone(211, 2603, .6, .76) };
}

export function cutHeight(s) { return .5 + 4 * smoothstep(.35, .8, ribbonNoise(s, 97, 2222)); }

// Mossy crags break through the undergrowth on both sides of the valley.
export function jungleCrags(s, u) {
  const side = u < 0 ? -1 : 1, cross = Math.abs(u);
  if (cross < 24 || cross > 150) return 0;
  const cell = Math.floor(s / 96);
  let relief = 0;
  for (let i = cell - 1; i <= cell + 1; i++) {
    const seed = i * 2 + (side < 0 ? 0 : 1);
    if (randomAt(seed, 2231) < .35) continue;
    const center = i * 96 + 20 + randomAt(seed, 2232) * 56;
    const across = side < 0 ? 105 + randomAt(seed, 2233) * 40 : 40 + randomAt(seed, 2233) * 85;
    const rs = 11 + randomAt(seed, 2234) * 12, ru = 8 + randomAt(seed, 2235) * 8;
    const x = (s - center) / rs, y = (cross - across) / ru, angle = Math.atan2(y, x);
    const radius = Math.hypot(x, y) / (1 + .1 * Math.sin(angle * 3 + i) + .06 * Math.sin(angle * 5 + seed));
    relief += (7 + randomAt(seed, 2236) * 10) * (1 - smoothstep(.5, 1, radius)) ** .75;
  }
  return relief * smoothstep(24, 34, cross) * (1 - smoothstep(135, 150, cross));
}

// Two staggered ranges of forested peaks stand in the haze beyond the hills.
export function jungleMountains(s, u) {
  if (u <= 150) return 0;
  let peaks = 0;
  for (let band = 0; band < 2; band++) {
    const spacing = 250 + band * 90, cell = Math.floor(s / spacing);
    for (let i = cell - 2; i <= cell + 2; i++) {
      const seed = i * 5 + band * 733;
      const center = i * spacing + randomAt(seed, 2241) * spacing * .6;
      const ridgeU = 215 + band * 150 + (randomAt(seed, 2242) - .5) * 70;
      const ds = (s - center) / (130 + band * 60 + randomAt(seed, 2243) * 70);
      const du = (u - ridgeU) / (75 + band * 35 + randomAt(seed, 2244) * 30);
      const tilted = du + ds * (randomAt(seed, 2245) - .5) * .5;
      const radius = Math.max(Math.abs(ds) * .8 + Math.abs(tilted) * .45, Math.abs(tilted) + Math.abs(ds) * .2);
      peaks = Math.max(peaks, (48 + band * 30 + randomAt(seed, 2246) * 40) * Math.max(0, 1 - radius) ** .85);
    }
  }
  const foothills = 10 + 9 * Math.sin(s / 141 + u / 97) ** 2;
  return (peaks + foothills) * smoothstep(150, 200, u);
}

function bankProfile(distance, level, bed) {
  // Water edge below the surface, a mossy rim just above it, then the bank top.
  if (distance < 1.3) return lerp(bed - .7, level + .5, distance / 1.3);
  return lerp(level + .5, level + 1.1, (distance - 1.3) / 2.7);
}
function nearHills(s, u) {
  const rise = smoothstep(-95, -160, u) * (10 + 12 * Math.sin(s / 97 + u / 71) ** 2 + 9 * Math.sin(s / 59 - u / 83) ** 2);
  return rise + jungleCrags(s, u);
}
function farSide(s, u, h) {
  const bank = smoothstep(9.5, 15, u) * cutHeight(s);
  const floor = smoothstep(15, 40, u) * (1 + 1.5 * ribbonNoise(s, 31, 2221));
  const hills = smoothstep(22, 140, u) * (15 + 12 * Math.sin(s / 97 + u / 61) ** 2 + 10 * Math.sin(s / 61 - u / 83) ** 2);
  const knolls = (Math.sin(s / 37 + u / 23) * Math.sin(s / 19 - u / 29) * 3 + Math.sin(s / 11 + u / 13)) * smoothstep(20, 60, u);
  return h + bank + floor + hills + knolls + jungleCrags(s, u) + jungleMountains(s, u);
}
export function jungleHeight(s, u) {
  const h = jungleRoadHeight(s);
  if (Math.abs(u) <= 7) return h;
  if (u > 0) return farSide(s, u, h);
  const rc = riverCenter(s), hw = riverHalfWidth(s), level = riverLevel(s), bed = riverBedLevel(s);
  const bankTop = rc + hw + 4, farTop = rc - hw - 4;
  if (u >= bankTop) {
    const verge = h - .12 * smoothstep(7, 9.5, -u);
    if (u >= -9.5) return verge;
    // A mossy slope from the verge down to the river terrace, with bumps that
    // fade out at both ends so the verge and bank top stay exact.
    const t = (u + 9.5) / (bankTop + 9.5), noise = jungleNoise(s, u, 13, 2212) - .5;
    const slope = lerp(verge, level + 1.1, smoothstep(0, 1, t)) + noise * 2.2 * Math.sin(t * Math.PI);
    const wall = gorgeWall(s);
    if (wall <= 0) return slope;
    // Under a wall the face runs down past the water line, so the river laps the cliff foot.
    const rim = bankTop + 3, top = lerp(verge, level + 1.1, .26 + .22 * ribbonNoise(s, 29, 2218));
    const cliff = u >= rim
      ? lerp(verge, top, smoothstep(0, 1, (u + 9.5) / (rim + 9.5))) + noise * 1.2 * Math.sin((u + 9.5) / (rim + 9.5) * Math.PI)
      : lerp(top, level - .6, (rim - u) / 3);
    return lerp(slope, cliff, wall);
  }
  const near = rc + hw, far = rc - hw;
  let channel;
  if (u >= near) channel = lerp(bankProfile(u - near, level, bed), lerp(bed - .7, level - .6, (u - near) / 4), gorgeWall(s));
  else if (u > far) channel = bed - .7 - 1.7 * Math.cos((u - rc) / hw * Math.PI / 2);
  else if (u >= farTop) channel = bankProfile(far - u, level, bed);
  if (channel !== undefined) return channel;
  const t = (farTop - u) / (farTop + 95);
  const rise = h - 5 + 3 * ribbonNoise(s, 103, 2213);
  if (u > -95) return lerp(level + 1.1, rise, smoothstep(0, 1, t)) + (jungleNoise(s, u, 17, 2214) - .5) * 3 * Math.sin(t * Math.PI);
  return rise + nearHills(s, u);
}
export const junglePosition = (s, u, y = jungleHeight(s, u)) => positionAt(s, u, y);
// Water covers the channel, and under a gorge wall it reaches the cliff foot.
export function onRiver(s, u, margin = 0) {
  const rc = riverCenter(s), hw = riverHalfWidth(s);
  return u > rc - hw - margin && u < rc + hw + margin + 3.2 * gorgeWall(s);
}

export function jungleColumns(s) {
  const rc = riverCenter(s), hw = riverHalfWidth(s), bankTop = rc + hw + 4, farTop = rc - hw - 4;
  const near = [-9.5, -12.5, lerp(-12.5, bankTop + 3, .4), lerp(-12.5, bankTop + 3, .75), bankTop + 3, bankTop, rc + hw + 1.3, rc + hw, rc + hw * .5, rc, rc - hw * .5, rc - hw, rc - hw - 1.3, farTop,
    lerp(farTop, -95, .33), lerp(farTop, -95, .66), -95];
  // The foreground is close to the camera even far from the road. Keep its
  // facets compact instead of stretching them across ever-wider columns.
  for (let u = -107; u > -436; u -= 12) near.push(u);
  near.push(-436);
  const far = [9.5, 12.5, 15, 17.5, 21, 26, 32, 39, 47, 56, 66, 78, 92, 108, 126, 146, 168, 192, 218, 246, 276, 308, 342, 378, 416, 456, 500];
  return [...near.reverse(), -7, 0, 7, ...far];
}
export const JUNGLE_COLUMN_COUNT = jungleColumns(0).length;
export function jungleVertex(row, column) {
  const baseS = row * JUNGLE_STEP, base = jungleColumns(baseS)[column];
  const road = Math.abs(base) <= 7;
  const river = base > riverCenter(baseS) - riverHalfWidth(baseS) - 4.5 && base < riverCenter(baseS) + riverHalfWidth(baseS) + 4.5;
  // Aligned longitudinal stations also allow fine rows around a waterfall
  // without folding the neighboring terrain; crosswise jitter keeps facets irregular.
  const s = baseS;
  const columns = jungleColumns(s);
  const gap = Math.min(columns[column] - (columns[column - 1] ?? columns[column] - 40), (columns[column + 1] ?? columns[column] + 40) - columns[column]);
  const u = columns[column] + (road || river ? 0 : (randomAt(row, column + 2262) - .5) * Math.min(7, gap * .42));
  const p = junglePosition(s, u);
  const cross = Math.abs(u);
  // Softer ground relief on the camera side; the distant hills retain larger
  // bumps that read as treetops.
  if (!river) p.y += (randomAt(row, column + 2263) - .5) * (.9 * smoothstep(12, 30, cross) * (1 - smoothstep(100, 130, cross)) + (u < 0 ? 1.8 : 4.6) * smoothstep(100, 140, cross));
  return { ...p, s, u, column };
}

// Keep the car on the narrow river-side verge, including unguarded stretches.
export const jungleDrivingRoute = { frame: s => ({ ...roadFrame(s), y: jungleRoadHeight(s) }), position: junglePosition, height: jungleHeight, bounds: () => [-6.9, 8.8],
  water: (s, u) => onRiver(s, u, 1) };
