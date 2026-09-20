import { roadFrame, roadHeight, positionAt, randomAt, smoothstep, lerp } from './route.js';

export const SNOW_STEP = 8;
export const LAMP_SPACING = 52;
export const snowRoadHeight = s => roadHeight(s) + 38 + 5 * Math.sin(s / 270);
export const snowFrame = s => ({ ...roadFrame(s), y: snowRoadHeight(s) });
export const ledgeEdge = s => -23 - 7 * Math.sin(s / 91 + .8) - 4 * Math.sin(s / 31 + .1);

export const LAKE_LEVEL = -4;
export function alpineLake(s) {
  // Sheltered coves reach toward the road; projecting spurs still carry tall
  // cliffs. The shorter descent exposes water in the portrait driving view.
  return { near: ledgeEdge(s) - 38 - 7 * Math.sin(s / 117 + .6) - 3 * Math.sin(s / 39)
      - 30 * smoothstep(-.25, .4, Math.sin(s / 310 - 1)),
    far: -306 + 22 * Math.sin(s / 211 + 1) + 11 * Math.sin(s / 71), y: LAKE_LEVEL };
}
export function onLake(s, u, margin = 0) {
  const lake = alpineLake(s);
  return u > lake.far - margin && u < lake.near + margin;
}

export function summitForCell(index) {
  return { index, s: index * 280 + 76 + (randomAt(index, 618) - .5) * 28,
    u: 60 + randomAt(index, 619) * 12, height: 62 + randomAt(index, 620) * 16,
    rs: 156 + randomAt(index, 621) * 24, ru: 50 + randomAt(index, 622) * 12 };
}

export function alpineRelief(s, u) {
  const outer = u < 0, cell = Math.floor(s / 64);
  const distance = outer ? ledgeEdge(s) - u : u;
  const mask = outer ? smoothstep(3, 24, distance) * (1 - smoothstep(73, 96, distance))
    : smoothstep(13, 24, u) * (1 - smoothstep(53, 68, u));
  if (!mask) return 0;
  let relief = 0;
  for (let i = cell - 1; i <= cell + 1; i++) {
    const seed = i * 2 + (outer ? 0 : 1), center = i * 64 + 12 + randomAt(seed, 641) * 40;
    const across = outer ? 18 + randomAt(seed, 642) * 45 : 26 + randomAt(seed, 642) * 23;
    const along = (s - center) / (22 + randomAt(seed, 643) * 24);
    // Tilt each fracture independently. Pointed lobes overlap at different
    // elevations rather than sharing a contour or quantized height band.
    const cross = (distance - across) / (12 + randomAt(seed, 644) * 14) + along * (randomAt(seed, 645) - .5) * .9;
    const radius = Math.max(Math.abs(along) * .86 + Math.abs(cross) * .38, Math.abs(cross) * .9 + Math.abs(along) * .25);
    const lobe = Math.max(0, 1 - radius);
    relief += lobe * lobe * (8 + randomAt(seed, 646) * 13) * (randomAt(seed, 647) > .24 ? 1 : -.55);
  }
  return relief * mask;
}

export function distantMountainHeight(s, u) {
  if (u <= 130) return 0;
  let mountains = 0;
  // Staggered ranges overlap across deep saddles. Skewed, unequal peak
  // profiles avoid both a flat upland and rows of identical triangular cones.
  for (let band = 0; band < 3; band++) {
    const spacing = 240 + band * 72, cell = Math.floor(s / spacing);
    for (let i = cell - 2; i <= cell + 2; i++) {
      const seed = i * 7 + band * 937;
      const center = i * spacing + 60 + randomAt(seed, 691) * spacing * .55;
      const ridgeU = 174 + band * 165 + (randomAt(seed, 692) - .5) * 60;
      const ds = (s - center) / (155 + band * 55 + randomAt(seed, 693) * 80);
      const du = (u - ridgeU) / (72 + band * 33 + randomAt(seed, 694) * 32);
      const tilted = du + ds * (randomAt(seed, 695) - .5) * .52;
      const radius = Math.max(Math.abs(ds) * .75 + Math.abs(tilted) * .48,
        Math.abs(tilted) + Math.abs(ds) * .18);
      const peak = Math.max(0, 1 - radius);
      const height = 54 + band * 39 + randomAt(seed, 696) * 49;
      mountains = Math.max(mountains, height * peak ** .88);
    }
  }
  const foothills = 14 + 12 * Math.sin(s / 151 + u / 111) ** 2;
  const fractures = 3.3 * Math.sin(s / 23 + u / 17) + 2.1 * Math.sin(s / 39 - u / 26);
  return (mountains + foothills + fractures) * smoothstep(130, 175, u);
}

export function mountainHeight(s, u) {
  let peak = 0;
  const cell = Math.floor((s - 76) / 280);
  for (let i = cell - 1; i <= cell + 1; i++) {
    const summit = summitForCell(i);
    // Unequal flanks and oblique ridges break the repeated cone silhouette.
    // Each peak keeps its own crown and descends into a broad snowy saddle.
    const along = (s - summit.s) / summit.rs;
    const across = (u - summit.u) / summit.ru;
    const skew = across + along * (.22 + randomAt(i, 623) * .24);
    const distance = Math.max(Math.abs(along) * (.78 + (along > 0 ? .2 : 0)) + Math.abs(skew) * .38,
      Math.abs(skew) + Math.abs(along) * .19);
    peak = Math.max(peak, summit.height * Math.max(0, 1 - distance));
  }
  const apron = (6 + 5 * Math.sin(s / 94 + u / 67) ** 2) * smoothstep(11, 34, u);
  const rockFaces = (3.3 * Math.sin(s / 18 + u / 11) + 2.1 * Math.sin(s / 31 - u / 9))
    * smoothstep(16, 36, u) * (1 - smoothstep(125, 210, u));
  return apron + peak * smoothstep(11, 26, u) + rockFaces + distantMountainHeight(s, u);
}

// Stacked rock strata: flat snow shelves between near-vertical risers, as in
// the reference cliffs. The bands drift and dip with position so no two
// contours share one level, and each shelf renders as a single plane.
export function strata(height, s, u, period, strength) {
  if (strength <= 0) return height;
  const drift = 3.1 * Math.sin(s / 43 + u / 57) + 1.7 * Math.sin(s / 19 - u / 29) + u * .1;
  const t = (height + drift) / period, tier = Math.floor(t), f = t - tier;
  // Shelves sit mid-band, so tiers cut into and build out of the slope equally.
  const stepped = (tier + .29 + smoothstep(.58, 1, f)) * period - drift;
  return lerp(height, stepped, strength);
}

const uplandColumns = [103, 114, 127, 142, 159, 178, 199, 222, 247, 274, 304, 337, 373, 413, 456, 503, 554, 609, 668, 731];
export function snowColumns(s) {
  const edge = ledgeEdge(s), lake = alpineLake(s);
  return [-520, -475, -430, -390, ...[-20, -8, 0, 4, 12].map(d => lake.far + d),
    ...[.2, .4, .6, .8].map(t => lerp(lake.far + 12, lake.near - 12, t)),
    ...[-12, -5, -1.5, 0, 2, 6, 12].map(d => lake.near + d),
    ...[.2, .4, .6, .8, 1].map(t => lerp(lake.near + 12, edge - 10, t)),
    edge - 5, edge, -10, -7, 0, 7, 11,
    16, 22, 28, 35, 43, 51, 60, 70, 80, 91, ...uplandColumns];
}
const initialColumns = snowColumns(0);
export const SNOW_COLUMN_COUNT = initialColumns.length;
export function snowBaseHeight(s, u) {
  const h = snowRoadHeight(s);
  if (Math.abs(u) <= 7) return h;
  if (u < -7) {
    const lake = alpineLake(s);
    if (u <= lake.far) {
      const d = lake.far - u;
      return lake.y + .45 + 20 * smoothstep(0, 75, d)
        + (13 + 14 * Math.sin(s / 113 + u / 72) ** 2) * smoothstep(15, 100, d);
    }
    if (u < lake.near) {
      const bankDistance = Math.min(u - lake.far, lake.near - u);
      return lake.y + .45 - 5 * smoothstep(0, 9, bankDistance) - 6 * smoothstep(9, 65, bankDistance);
    }
    const edge = ledgeEdge(s), distance = edge - u, width = edge - lake.near;
    // A narrow snow bench at the foot of the cliff gives cabins and landings
    // dry approaches while the bluff does most of its descending above them.
    const t = Math.max(0, Math.min(1, distance / (width - 7)));
    const warp = (Math.sin(s / 31 + .5) * .2 + Math.sin(s / 13 - .7) * .08) * Math.sin(t * Math.PI);
    const shoulder = h + smoothstep(-7, -13, u) * (1.1 + .55 * Math.sin(s / 17));
    const shore = lake.y + .45 + .025 * Math.min(7, u - lake.near);
    const slope = lerp(shoulder, shore, smoothstep(0, 1, t + warp));
    const fissure = 2.3 * (.5 + .5 * Math.sin(s / 8.7 + u / 37)) ** 7 * smoothstep(0, 12, distance);
    const bluff = slope + (alpineRelief(s, u) - fissure) * (1 - smoothstep(.45, .78, t));
    // The bluff below the road drops in a few tall tiers, easing off at the
    // ledge and again above the shore so both edges stay exact.
    return strata(bluff, s, u, 19, (.4 + alpineExposure(s, u) * .28)
      * smoothstep(.03, .14, t) * smoothstep(8, 19, u - lake.near));
  }
  const fissure = 2.8 * (.5 + .5 * Math.sin(s / 7.3 + u / 39)) ** 7
    * smoothstep(14, 25, u) * (1 - smoothstep(48, 73, u));
  const rise = h + mountainHeight(s, u) - fissure + alpineRelief(s, u);
  return strata(rise, s, u, 16, (.3 + alpineExposure(s, u) * .55)
    * smoothstep(9, 24, u) * (1 - smoothstep(110, 175, u)));
}

// Broad wind-exposed ribs alternate with sheltered, snow-filled bowls. Share
// the field between the landform, snow cover and fir groves, not triangle noise.
export function alpineExposure(s, u) {
  return smoothstep(-.75, .75, Math.sin(s / 83 + u / 59) * .7 + Math.sin(s / 151 - u / 41) * .45);
}

export function terrainPocket(index, side) {
  const seed = index * 2 + (side > 0 ? 1 : 0);
  const s = index * 80 + 14 + randomAt(seed, 730) * 48;
  const slopeWidth = ledgeEdge(s) - alpineLake(s).near;
  return { s, u: side < 0 ? ledgeEdge(s) - 9 - randomAt(seed, 731) * Math.max(1, slopeWidth - 31) : 22 + randomAt(seed, 731) * 25,
    rs: 14 + randomAt(seed, 732) * 10, ru: 9 + randomAt(seed, 733) * 4, side, seed };
}

export function snowHeight(s, u) {
  let height = snowBaseHeight(s, u);
  if (u >= -10 && u <= 11) return height;
  const side = u < 0 ? -1 : 1, cell = Math.floor(s / 80);
  const mask = side < 0 ? smoothstep(7, 17, u - alpineLake(s).near) * smoothstep(4, 8, ledgeEdge(s) - u)
    : 1 - smoothstep(50, 62, u);
  if (!mask) return height;
  for (let i = cell - 1; i <= cell + 1; i++) {
    const pocket = terrainPocket(i, side);
    const radius = Math.hypot((s - pocket.s) / pocket.rs, (u - pocket.u) / pocket.ru);
    if (radius >= 1) continue;
    const shelf = snowBaseHeight(pocket.s, pocket.u) + (s - pocket.s) * .02;
    height += (shelf - height) * .84 * (1 - smoothstep(.3, 1, radius)) * mask;
  }
  return height;
}
// Timber trestles cross stream gullies at world-space intervals, independently
// of streaming chunks. Each span straddles a chunk boundary so both halves are built.
export const BRIDGE_SPACING = 768;
export function snowBridgeAt(s) {
  const index = Math.round((s - 372) / BRIDGE_SPACING), center = 372 + index * BRIDGE_SPACING;
  return { index, center, start: center - 32, end: center + 32 };
}
export function gullyAmount(s, u) {
  const bridge = snowBridgeAt(s);
  // The gully descends diagonally from the peaks towards the lake, so the
  // crossing reads as a mountain stream bed rather than a slot cut across the road.
  const d = Math.abs(s - bridge.center - u * .2 - 2.4 * Math.sin(u / 11 + bridge.index));
  const along = 1 - smoothstep(9, 38, d);
  if (!along) return 0;
  const across = u >= 0 ? 1 - smoothstep(26, 62, u)
    : (1 - smoothstep(16, 50, ledgeEdge(s) - u)) * smoothstep(6, 22, u - alpineLake(s).near);
  return along * across;
}
// Scenery and the terrain mesh see the gully beneath each trestle; the car
// and the road ribbons keep sampling the flat deck through snowHeight.
export function snowGroundHeight(s, u) {
  const height = snowHeight(s, u), gully = gullyAmount(s, u);
  if (!gully) return height;
  return height - (12 + 1.6 * Math.sin(s / 5.7 + u / 3.9) + 1.1 * Math.sin(s / 2.3 - u / 6.1)) * gully;
}
export const snowPosition = (s, u, y = snowHeight(s, u)) => positionAt(s, u, y);
export function snowVertex(row, column) {
  const road = Math.abs(initialColumns[column]) <= 7;
  const baseS = row * SNOW_STEP, lake = alpineLake(baseS);
  const baseU = snowColumns(baseS)[column];
  const bank = baseU > lake.far - 10 && baseU < lake.near + 13;
  const s = baseS + (road || bank ? 0 : (randomAt(row, column + 811) - .5) * 3.3);
  const columns = snowColumns(s);
  const gap = Math.min(columns[column] - (columns[column - 1] ?? columns[column] - 40), (columns[column + 1] ?? columns[column] + 40) - columns[column]);
  const u = columns[column] + (road || bank ? 0 : (randomAt(row, column + 912) - .5) * Math.min(8, gap * .5));
  const p = snowPosition(s, u, snowGroundHeight(s, u));
  const land = smoothstep(2, 15, Math.max(lake.far - u, u - lake.near));
  p.y += (randomAt(row, column + 177) - .5) * smoothstep(10, 35, Math.abs(u)) * .85 * land;
  return { ...p, s, u };
}
export function lampAt(index) {
  let s = index * LAMP_SPACING + 16;
  const u = 8.8, bridge = snowBridgeAt(s), offset = s - bridge.center;
  // Lamps step off the trestle to its nearer abutment, which lights the deck.
  // One right at mid-span would crowd its neighbour, so it is left out instead.
  const hidden = Math.abs(offset) < 12;
  if (Math.abs(offset) < 38) s = bridge.center + (offset >= 0 ? 38 : -38);
  return { s, u, hidden, ...snowPosition(s, u, snowRoadHeight(s) + 7.6) };
}
export const snowDrivingRoute = { frame: snowFrame, position: snowPosition, height: snowHeight, bounds: () => [-5.85, 6.3] };
