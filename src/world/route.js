import { resolveWorldSeed, workerSeed } from './generation.js';

export const SEED = workerSeed ?? resolveWorldSeed(globalThis.location?.search);
export const CHUNK_LENGTH = 128;
export const TERRAIN_STEP = 8;
export const ROAD_HALF_WIDTH = 5.5;

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function randomAt(a, b = 0, seed = SEED) {
  let n = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(seed, 144269);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
export function seededRandom(seed) {
  let i = 0;
  return () => randomAt(seed, i++);
}

// Seed the phases and wavelengths as well as the scenery. Keep bends at least
// as gentle as the original road so terrain normals and lane assistance stay safe.
const bends = [130, 60, 260].map((span, i) => ({ span: span * (1 + randomAt(i, 1901) * .35), phase: randomAt(i, 1902) * Math.PI * 2 }));
const hills = [173, 83].map((span, i) => ({ span: span * (1 + randomAt(i, 1903) * .35), phase: randomAt(i, 1904) * Math.PI * 2 }));
export function roadX(s) { return 27 * Math.sin(s / bends[0].span + bends[0].phase) + 24 * Math.sin(s / bends[1].span + bends[1].phase) + 6 * Math.sin(s / bends[2].span + bends[2].phase); }
export function roadDerivative(s) { return 27 / bends[0].span * Math.cos(s / bends[0].span + bends[0].phase) + 24 / bends[1].span * Math.cos(s / bends[1].span + bends[1].phase) + 6 / bends[2].span * Math.cos(s / bends[2].span + bends[2].phase); }
export function roadHeight(s) { return 24 + 6 * Math.sin(s / hills[0].span + hills[0].phase) + 3 * Math.sin(s / hills[1].span + hills[1].phase); }

export function journeyStart(routeNumber) {
  // Each route gets its own stretch, in either direction from the world origin.
  // Mileage tracks driving separately, so even a distant spawn starts at zero.
  return { s: Math.floor((randomAt(routeNumber, 1910) - .5) * 40000), distance: 0 };
}
function drivingCoastOffset(s) { return -28 - 8 * Math.sin(s / 107 + .8) - 4 * Math.sin(s / 43) - 3 * Math.sin(s / 23 + 2); }
function coastNoise(s, span, salt) {
  const cell = Math.floor(s / span), t = smoothstep(0, 1, s / span - cell);
  return lerp(randomAt(cell, salt), randomAt(cell + 1, salt), t);
}
export function headlandCenter(index) { return index * 176 + 50 + randomAt(index, 1601) * 60; }
export function headlandAmount(s) {
  const cell = Math.floor(s / 176);
  let amount = 0;
  for (let i = cell - 1; i <= cell + 1; i++) {
    const center = headlandCenter(i);
    const span = s < center ? 38 + randomAt(i, 1602) * 28 : 45 + randomAt(i, 1603) * 30;
    const profile = 1 - smoothstep(.05, 1, Math.abs(s - center) / span);
    amount = Math.max(amount, profile * (30 + randomAt(i, 1604) * 24));
  }
  return amount;
}
export function coastOffset(s) { return drivingCoastOffset(s) - headlandAmount(s); }
export function overlookAt(s) {
  const index = Math.round((s - 80) / 1936);
  const center = headlandCenter(index * 11 + Math.floor(randomAt(index, 1861) * 3) - 1);
  return { index, center, enabled: randomAt(index, 1862) > .244 && Math.abs(center - bridgeAt(center).center) > 105 };
}
export function overlookWidth(s) {
  const overlook = overlookAt(s);
  return 6.05 + (overlook.enabled ? 10 * (1 - smoothstep(12, 32, Math.abs(s - overlook.center))) : 0);
}
export function beachWidth(s) {
  const cell = Math.floor(s / 176);
  let pocket = 0;
  for (let i = cell - 1; i <= cell + 1; i++) {
    const left = headlandCenter(i), right = headlandCenter(i + 1);
    const center = lerp(left, right, .43 + randomAt(i, 1661) * .14);
    const span = (s < center ? center - left : right - center) * (.83 + randomAt(i, 1662) * .1);
    const profile = 1 - smoothstep(.06, 1, Math.abs(s - center) / span);
    pocket = Math.max(pocket, profile * (19 + randomAt(i, 1663) * 8));
  }
  // Sand accumulates in the recess between neighboring headlands. Unequal
  // sides and widths create coves while leaving the rocky points legible.
  return 5.8 + coastNoise(s, 83, 1664) * 2 + pocket * .86;
}
export function shorelineOffset(s) { return coastOffset(s) - 10 - beachWidth(s) - 2.4; }

function coastalShoulder(s) {
  // A headland can rise above, or dip below, the roadside shelf. This changes
  // the silhouette in broad masses instead of adding small surface noise.
  return (coastNoise(s, 83, 1611) * 14 - 5) * smoothstep(-18, -29, coastOffset(s));
}

export function cliffRib(s, height = 0) {
  // Broad, tilted joints run from the cliff toe to its crown. Sampling one
  // field at different heights creates connected buttresses and recesses.
  const cell = Math.floor(s / 38);
  let rib = 0;
  for (let i = cell - 1; i <= cell + 1; i++) {
    const center = i * 38 + 11 + randomAt(i, 1621) * 16;
    const lean = (randomAt(i, 1622) - .5) * 13;
    const width = 13 + randomAt(i, 1623) * 13;
    const distance = Math.abs(s - center - height * lean) / width;
    rib = Math.max(rib, (1 - smoothstep(.08, 1, distance)) * (.7 + randomAt(i, 1624) * .3));
  }
  return rib;
}

function cliffJoint(s, height) {
  const cell = Math.floor(s / 13);
  let joint = 0;
  for (let i = cell - 2; i <= cell + 2; i++) {
    const center = i * 13 + randomAt(i, 1651) * 7 + height * (randomAt(i, 1652) - .5) * 15;
    const width = 5 + randomAt(i, 1653) * 5;
    // An angular shoulder and a narrow recess, with the same fracture leaning
    // through successive tiers. This relief belongs to the terrain surface.
    joint = Math.max(joint, Math.max(0, 1 - Math.abs(s - center) / width));
  }
  return joint;
}

// Landmarks use world-space intervals, independently of streaming chunk boundaries.
export function bridgeAt(s) {
  const index = Math.round((s - 148) / 896);
  const center = 148 + index * 896;
  return { index, center, start: center - 36, end: center + 36, length: 72 };
}
export function ravineAmount(s, u) {
  const bridge = bridgeAt(s);
  const along = 1 - smoothstep(22, 54, Math.abs(s - bridge.center));
  return along * (1 - smoothstep(24, 112, u));
}
export function pondAt(s) {
  const index = Math.round((s - 246) / 704);
  const center = 246 + index * 704;
  return { index, center, u: 73 + randomAt(index, 370) * 13, rs: 35 + randomAt(index, 371) * 11, ru: 20 + randomAt(index, 372) * 6, level: roadHeight(center) + 7 };
}
export function pondRadius(s, u, pond = pondAt(s)) {
  const x = (s - pond.center) / pond.rs;
  // A bent valley floor gives the water a sheltered bay and an unequal pair
  // of lobes. The warp fades outside the basin, keeping the outer slopes calm.
  const bend = (.16 + randomAt(pond.index, 373) * .16) * Math.sin(x * 2.4) * (1 - smoothstep(1, 2.5, Math.abs(x)));
  const y = (u - pond.u) / pond.ru - bend;
  const angle = Math.atan2(y, x);
  return Math.hypot(x, y) / (1 + .13 * Math.sin(angle * 3 + pond.index) + .055 * Math.sin(angle * 2 + pond.index * .7));
}
function fieldNoise(s, u, span, salt) {
  // Smooth two-dimensional value noise for cohesive patches on the hillsides.
  const cs = Math.floor(s / span), cu = Math.floor(u / span);
  const ts = smoothstep(0, 1, s / span - cs), tu = smoothstep(0, 1, u / span - cu);
  const at = (i, j) => randomAt(i * 1031 + j, salt);
  return lerp(lerp(at(cs, cu), at(cs + 1, cu), ts), lerp(at(cs, cu + 1), at(cs + 1, cu + 1), ts), tu);
}
export function mountainHeight(s, u) {
  // Unequal flanks and offset shoulders make branching ridges, with broad
  // feet that merge into the meadow instead of a row of isolated cones.
  const cell = Math.floor(s / 192);
  let height = 0;
  for (let index = cell - 1; index <= cell + 1; index++) {
    const center = index * 192 + 96 + (randomAt(index, 715) - .5) * 60;
    const cross = 131 + randomAt(index, 716) * 39;
    const along = 92 + randomAt(index, 718) * 38, across = 91 + randomAt(index, 719) * 31;
    const lean = (randomAt(index, 1724) - .5) * .8;
    const du = (u - cross) / across;
    const ds = (s - center) / (along * (s < center ? .86 : 1.14)) + du * lean;
    const ribs = Math.sin(ds * 7 + du * 4 + index) * .07 * smoothstep(.08, .65, Math.abs(du));
    const cone = Math.max(0, 1 - Math.hypot(ds, du * (du < 0 ? .94 : .76)) + ribs);
    height += (48 + randomAt(index, 717) * 35) * Math.pow(cone, 1.48);
    const shoulder = Math.max(0, 1 - Math.hypot(ds - .38, (du + .28) * 1.35));
    height += (12 + randomAt(index, 1725) * 10) * shoulder * shoulder;
  }
  const spine = 155 + 23 * Math.sin(s / 233 + 1.3);
  height += 16 * smoothstep(0, 1, 1 - Math.abs(u - spine) / 123) * (.35 + coastNoise(s, 131, 1723) * .65);
  return height;
}
export function hillsideSteepness(s) {
  // Some stretches of hill rise straight behind the roadside terrace; others
  // open into gradual meadow before the ridge.
  return smoothstep(.35, .8, coastNoise(s, 230, 1721));
}
export function rockCover(s, u) {
  // Bare rock on the summits and in cohesive patches across the hill flanks,
  // rather than on isolated steep facets.
  const shelter = smoothstep(1.1, 3.4, pondRadius(s, u));
  const gorge = 1 - .8 * (1 - smoothstep(46, 125, Math.abs(s - bridgeAt(s).center)));
  const summit = smoothstep(36, 65, mountainHeight(s, u) * shelter * gorge + (fieldNoise(s, u, 42, 1703) - .5) * 17);
  const patches = smoothstep(.6, .8, fieldNoise(s, u, 48, 1701) * .8 + fieldNoise(s, u, 19, 1702) * .2) * smoothstep(35, 75, u) * shelter;
  return clamp(summit + patches, 0, 1);
}
export function coastalGrove(s, u) {
  // A shared habitat field makes tree groups and their darker understory agree.
  // Broad clearings separate sheltered groves; exposed headlands stay open.
  return fieldNoise(s, u, 54, 1751) * .72 + fieldNoise(s, u, 23, 1752) * .28;
}
export function roadFrame(s) {
  const dx = roadDerivative(s);
  const scale = Math.sqrt(1 + dx * dx);
  return { x: roadX(s), y: roadHeight(s), z: -s, nx: 1 / scale, nz: dx / scale, angle: Math.atan(dx), scale };
}
export function positionAt(s, u, height) {
  const f = roadFrame(s);
  // Fade out the normal offset beyond the shoulders so wide hills cannot fold
  // over themselves on the inside of a bend. The road itself uses exact normals.
  const offset = Math.abs(u) <= 7 ? u : Math.sign(u) * (7 + 30 * Math.tanh((Math.abs(u) - 7) / 30));
  return { x: f.x + u + offset * (f.nx - 1), y: height ?? terrainHeight(s, u), z: f.z + offset * f.nz };
}

function baseTerrainHeight(s, u, radius) {
  const h = roadHeight(s);
  const coast = coastOffset(s);
  const ripple = Math.sin(s * .095 + u * .11) * .7 + Math.sin(s * .043 - u * .18) * .6;
  const beach = coast - 10 - beachWidth(s);
  if (u < beach - 7) return -3.2;
  if (u < beach) return lerp(-3.2, 1.2, smoothstep(beach - 7, beach, u));
  if (u < coast - 10) return 1.2;
  if (u < coast) return lerp(1.2, h + 1.2 + ripple + coastalShoulder(s), smoothstep(coast - 10, coast, u));
  if (u < -7) {
    const shelf = h + (1.2 + ripple) * smoothstep(-7, coast, u)
      + (u < -18 ? coastalShoulder(s) * smoothstep(-18, Math.min(-18.01, coast), u) : 0);
    // Paved pullouts lie on the road's shelf; their outer bank rejoins the bluff.
    const overlook = overlookAt(s);
    const apron = overlook.enabled ? 1 - smoothstep(32, 48, Math.abs(s - overlook.center)) : 0;
    return lerp(shelf, h, apron * (1 - smoothstep(20, 25, -u)) * smoothstep(coast, coast + 6, u));
  }
  if (u < 7) return h;
  // Ponds sit on a sheltered shelf: the mountain, steep hillsides, and knolls
  // all ease off around them so the water does not lie in a crater.
  const shelter = smoothstep(1.1, 3.4, radius);
  // The ridge also stands back from each viaduct, so the inlet stays a rocky
  // gorge instead of a chasm between two summits.
  const gorge = 1 - .8 * (1 - smoothstep(46, 125, Math.abs(s - bridgeAt(s).center)));
  const inland = Math.max(smoothstep(12, 110, u), hillsideSteepness(s) * .7 * shelter * smoothstep(20, 88, u));
  const hill = 13 + 23 * fieldNoise(s, u, 115, 1731) + 12 * fieldNoise(s + u * .4, u, 67, 1732);
  const knolls = (fieldNoise(s, u, 29, 1733) - .5) * 7 * smoothstep(16, 50, u) * shelter;
  return h + inland * hill * gorge + ripple * smoothstep(7, 26, u) + knolls + mountainHeight(s, u) * inland * shelter * gorge;
}
export function groundHeight(s, u) {
  const pond = pondAt(s), radius = pondRadius(s, u, pond);
  let height = baseTerrainHeight(s, u, radius);
  if (radius < 2.3) {
    // Shape a broad dry bank on the existing hillside mesh. Its width exceeds
    // a coarse terrain edge, so those faces cannot cut through the rim into
    // low meadow. The outer slope eases back into the surrounding land.
    const basin = pond.level - 3.4 + 5.6 * smoothstep(.3, 1.18, radius);
    // Let the uphill bank rise toward the ridge while the seaward bank stays
    // a low meadow. A broad dry rim still contains every coarse terrain face.
    const bank = smoothstep(.86, 1.5, radius) * smoothstep(pond.u - 8, pond.u + 40, u) * 2.3;
    height = lerp(basin + bank, height, smoothstep(1.35, 2.3, radius));
  }
  const ravine = ravineAmount(s, u) * smoothstep(1.65, 2.3, radius);
  height = lerp(height, Math.min(height, -1.5 + smoothstep(20, 100, u) * 49), ravine);
  return height;
}
export function terrainHeight(s, u) {
  // Driving queries see the bridge deck; scenery queries see the inlet beneath it.
  if (Math.abs(u) <= 7) return roadHeight(s);
  return groundHeight(s, u);
}

// All chunk boundaries sample the same global rows, including their vertex jitter.
export function terrainColumns(s) {
  const c = coastOffset(s);
  const b = c - 10 - beachWidth(s);
  // Keep the established rock-foot shape independent of the wider sand coves.
  const toeSpread = Math.min(4.5, 1.2 + 8 * smoothstep(-.15, .85, Math.sin(s / 137 + 1.1)) * (1 - headlandAmount(s) / 44));
  const foot = c - 10 - toeSpread * cliffRib(s);
  const crown = c - cliffRib(s, 1) * 3.6;
  const lower = lerp(foot, crown, .16 + (1 - cliffJoint(s, .3)) * .22);
  const upper = lerp(foot, crown, .56 + (1 - cliffJoint(s, .75)) * .24);
  // A stable roadside row resolves the flat turnout apron without rapidly
  // moving vertices across neighboring rows at either tapered entrance.
  const shelf = (Math.max(crown, -31) - 7) / 2;
  return [-420, -300, b - 90, b - 35, b - 17, b - 7, b, foot, lower, upper, crown, shelf, -7, 0, 7, ...Array.from({ length: 23 }, (_, i) => 14 + i * 12)];
}
export function terrainVertex(row, column) {
  if (column === 6.5) {
    // One broad intermediate beach row breaks the long shore-to-cliff strips.
    // Reuse the existing edges so sand stays joined to the water and rock toe.
    const shore = terrainVertex(row, 6), foot = terrainVertex(row, 7);
    const t = .5 + (randomAt(row, 2241) - .5) * .16;
    const p = {column};
    for (const axis of ['x', 'z', 's', 'u']) p[axis] = lerp(shore[axis], foot[axis], t);
    p.y = groundHeight(p.s, p.u);
    return p;
  }
  if (column > 10 && column < 11) {
    // Broad bluff tops need two-dimensional facets, rather than long triangles
    // stretched all the way from the cliff crown to the roadside apron.
    const left = terrainVertex(row, 10), right = {};
    const low = terrainVertex(Math.floor(row), 11), high = terrainVertex(Math.ceil(row), 11);
    for (const axis of ['x', 'y', 'z', 's', 'u']) right[axis] = lerp(low[axis], high[axis], row - Math.floor(row));
    const t = column - 10;
    const blend = t + (randomAt(row, Math.round(column * 10) + 1841) - .5) * .055 * Math.sin(t * Math.PI);
    const s = lerp(left.s, right.s, blend), u = lerp(left.u, right.u, blend);
    // Interpolate the projected edge positions too. Independent along-road
    // jitter can invert narrow cells where a headland rapidly recedes.
    const p = { x: lerp(left.x, right.x, blend), z: lerp(left.z, right.z, blend), y: groundHeight(s, u) };
    // The turf follows the sculpted crown, easing into the meadow well before
    // the flat paved apron. All rows are global, including chunk boundaries.
    const crownRelief = left.y - groundHeight(left.s, coastOffset(left.s));
    p.y += crownRelief * (1 - smoothstep(0, .7, t));
    return { ...p, s, u, column };
  }
  if (column === 9.5) {
    const face = terrainVertex(row, 9), rim = terrainVertex(row, 10);
    // A narrow rolling shoulder lets turf wrap over the crest. Sheltered
    // recesses carry a wider lip; exposed ribs keep a thinner, steeper cap.
    const exposure = cliffRib(rim.s, 1);
    const t = .18 + exposure * .46 + coastNoise(rim.s, 17, 1691) * .12;
    const drop = .4 + exposure * 1.2 + coastNoise(rim.s, 23, 1692) * .9;
    const p = { column };
    for (const axis of ['x', 'y', 'z', 's', 'u']) p[axis] = lerp(face[axis], rim[axis], t);
    const detail = (1 - ravineAmount(p.s, p.u)) * smoothstep(1.05, 1.65, pondRadius(p.s, p.u));
    p.y = lerp(p.y, Math.max(p.y, rim.y - drop), detail);
    return p;
  }
  const baseS = row * TERRAIN_STEP;
  const seedRow = Number.isInteger(row) ? row : row * 2 + 1048576;
  // The extra cliff shoulder does not reseed or move the road and inland hills.
  const seedColumn = column > 8 ? column - 1 : column;
  const cliff = column >= 6 && column <= 10;
  const along = lerp(randomAt(Math.floor(row), 7), randomAt(Math.ceil(row), 7), row - Math.floor(row));
  const jitter = cliff ? (along - .5) * 4.2
    : (randomAt(seedRow, seedColumn) - .5) * 5.6;
  const pondJitter = column >= 15 ? lerp(.55, 1, smoothstep(1.2, 2.2, pondRadius(baseS, terrainColumns(baseS)[column]))) : 1;
  const s = baseS + pondJitter * ((column > 2 && (column < 12 || column > 14)) ? jitter : 0);
  const columns = terrainColumns(s);
  let u = columns[column];
  if (column >= 7 && column <= 10) u += (randomAt(seedRow + 218, seedColumn) - .5) * (column === 10 ? .8 : column === 7 ? .4 : .9);
  if (column >= 15) u += (randomAt(seedRow + 991, seedColumn) - .5) * Math.min(8, (u - 7) * .26) * pondJitter;
  const p = positionAt(s, u, groundHeight(s, u));
  const detail = smoothstep(1.05, 1.65, pondRadius(s, u)) * (1 - ravineAmount(s, u));
  if (column >= 7 && column <= 10) {
    const height = (column - 7) / 3, rib = cliffRib(s, height);
    const top = groundHeight(s, coastOffset(s));
    const crown = top + (cliffRib(s, 1) * 5.5 - 2 + (coastNoise(s, 19, 1631) - .5) * 3) * smoothstep(-18, -29, coastOffset(s));
    const fracture = coastNoise(s, 23, 1632);
    // Stagger the breaks in height as well as depth. A high shoulder can meet
    // a low neighboring slab, so no seam runs continuously along the wall.
    const lower = .24 + fracture * .2 + rib * .07;
    const upper = .65 + coastNoise(s, 29, 1633) * .18;
    const fraction = column === 7 ? 0 : column === 8 ? lower : column === 9 ? upper : 1;
    p.y = lerp(p.y, lerp(1.2, crown, fraction), detail);
    p.y += (randomAt(seedRow, seedColumn + 500) - .5) * (column === 7 ? .6 : 1.4) * detail;
    if (column === 10) {
      const hollow = (1 - rib) * smoothstep(.2, .8, coastNoise(s, 29, 1693));
      p.y -= hollow * 2.6 * detail;
    }
  }
  if (column >= 17) p.y += (randomAt(seedRow, seedColumn + 700) - .5) * (column > 19 ? 2.2 : 1.2) * detail;
  return { ...p, s, u, column };
}

export function terrainCell(row, col, vertex = terrainVertex) {
  const a = vertex(row, col), b = vertex(row + 1, col);
  const c = vertex(row, col + 1), d = vertex(row + 1, col + 1);
  // Spend the extra faces on cliff joints. Transition triangles stitch those
  // joints into the original coarse beach and meadow, with no open T-junctions.
  if (col === 6) {
    const m = vertex(row + .5, 7);
    const splitA = Math.hypot(c.x - a.x, c.z - a.z) > 14;
    const splitB = Math.hypot(d.x - b.x, d.z - b.z) > 14;
    const e = splitA && vertex(row, 6.5), f = splitB && vertex(row + 1, 6.5);
    if (e && f) {
      const beach = randomAt(row, 2242) > .5 ? [[a, b, e], [b, f, e]] : [[a, b, f], [a, f, e]];
      return [...beach, [e, f, m], [e, m, c], [f, d, m]];
    }
    if (e) return [[a, b, e], [b, m, e], [e, m, c], [b, d, m]];
    if (f) return [[a, b, f], [a, f, m], [a, m, c], [f, d, m]];
    return [[a, b, m], [a, m, c], [b, d, m]];
  }
  if (col === 10) {
    const columns = [10, 10.2, 10.4, 10.6, 10.8, 11];
    const triangles = [];
    // Carry the cliff's half-row joints across the bluff, then stitch them
    // into the coarse roadside row. This also resolves sharply turning coves.
    for (let i = 0; i < columns.length - 2; i++) for (const offset of [0, .5]) {
      const p = vertex(row + offset, columns[i]), q = vertex(row + offset + .5, columns[i]);
      const r = vertex(row + offset, columns[i + 1]), t = vertex(row + offset + .5, columns[i + 1]);
      triangles.push(...(randomAt(row * 2 + offset * 2, i + 1851) > .5 ? [[p, q, r], [q, t, r]] : [[p, q, t], [p, t, r]]));
    }
    const p = vertex(row, 10.8), q = vertex(row + .5, 10.8), r = vertex(row + 1, 10.8);
    triangles.push([p, q, c], [q, d, c], [q, r, d]);
    return triangles;
  }
  if (col >= 7 && col <= 9) {
    const e = vertex(row + .5, col), f = vertex(row + .5, col + 1);
    if (col === 9) {
      const lipA = vertex(row, 9.5), lipB = vertex(row + .5, 9.5), lipC = vertex(row + 1, 9.5);
      const stone = [[a, e, lipA], [e, lipB, lipA], [e, b, lipC], [e, lipC, lipB]];
      const turf = [[lipA, lipB, c], [lipB, f, c], [lipB, lipC, d], [lipB, d, f]];
      for (const tri of turf) tri.rimTurf = true;
      return [...stone, ...turf];
    }
    return (row + col) % 2 ? [[a, e, c], [e, f, c], [e, b, d], [e, d, f]]
      : [[a, e, f], [a, f, c], [e, b, f], [b, d, f]];
  }
  const seedCol = col > 8 ? col - 1 : col;
  const triangles = (row + seedCol) % 2 ? [[a, b, c], [b, d, c]] : [[a, b, d], [a, d, c]];
  return triangles;
}

// Where a galvanized guardrail stands on the ocean side: along bends where the
// ground falls away close to the road, and on the short approaches to a
// viaduct. Scenery and driving both read this, so the car is stopped by exactly
// the rails it can see. `coastOffset` is the cliff edge in closed form, which
// keeps this cheap enough to call from every physics step.
export const GUARDRAIL_OFFSET = -6.65;
// The car's centre stops with its flank against the rail.
export const GUARDRAIL_STOP = GUARDRAIL_OFFSET + 1.05;
export const GUARDRAIL_SEGMENT = 4;
function guardrailBeam(middle) {
  // A beam spans 4 m, so judge both of its ends: half a beam left standing on a
  // viaduct deck or across an overlook apron is still in the wrong place.
  const half = GUARDRAIL_SEGMENT / 2;
  let bridgeDistance = Infinity, apron = 0;
  for (const s of [middle - half, middle + half]) {
    bridgeDistance = Math.min(bridgeDistance, Math.abs(s - bridgeAt(s).center));
    apron = Math.max(apron, overlookWidth(s));
  }
  if (bridgeDistance < 49 || apron > 6.2) return false;
  return bridgeDistance <= 64 || coastOffset(middle) >= -35;
}
export function coastalGuardrail(s) {
  // Rails are built one 4 m beam at a time, so answer for the beam covering s.
  // Scenery and driving then agree metre for metre, with no stretch of rail you
  // can drive through and no invisible wall past its end.
  const middle = Math.floor(s / GUARDRAIL_SEGMENT) * GUARDRAIL_SEGMENT + GUARDRAIL_SEGMENT / 2;
  // A lone 4 m beam in open meadow reads as a stray piece of metal rather than
  // a guardrail, so a beam needs a neighbour to be worth standing up.
  return guardrailBeam(middle)
    && (guardrailBeam(middle - GUARDRAIL_SEGMENT) || guardrailBeam(middle + GUARDRAIL_SEGMENT));
}

export const coastalDrivingRoute = {
  frame: roadFrame,
  position: positionAt,
  height: terrainHeight,
  bounds(s) {
    if (Math.abs(s - bridgeAt(s).center) < 49) return [-4.65, 4.65];
    const open = Math.max(drivingCoastOffset(s) + 6, -15);
    // A rail is solid; without one the roadside limit stays soft.
    return [coastalGuardrail(s) ? Math.max(open, GUARDRAIL_STOP) : open, 17];
  },
};
