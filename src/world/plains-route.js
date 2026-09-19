import { roadFrame, positionAt, randomAt, smoothstep, lerp, clamp } from './route.js';

export const PLAINS_STEP = 8;
// The road runs over long, gentle swells rather than the coast's hills, so a
// straight can be held for a while and the fields read as one wide surface.
const swellPhase = [randomAt(0, 2701) * Math.PI * 2, randomAt(1, 2701) * Math.PI * 2];
export const plainsRoadHeight = s => 24 + 5.4 * Math.sin(s / 310 + swellPhase[0]) + 2.4 * Math.sin(s / 127 + swellPhase[1]) + .9 * Math.sin(s / 61 + swellPhase[0]);
export const plainsFrame = s => ({ ...roadFrame(s), y: plainsRoadHeight(s) });

// A creek crosses the road at world-space intervals, independently of the
// streaming chunks, under a short concrete bridge. It leans a little off the
// perpendicular and wanders, so it never reads as a slot cut across the fields.
export const CREEK_SPACING = 896;
export const BRIDGE_HALF_LENGTH = 14;
export function plainsCreekAt(s) {
  const index = Math.round((s - 420) / CREEK_SPACING), center = 420 + index * CREEK_SPACING;
  const lean = (randomAt(index, 2711) - .5) * .4;
  // The water lies below the road embankment, and the floodplain either side
  // of it is pulled down to the same level so the surface stays flat.
  const level = plainsRoadHeight(center) - 2.2;
  return { index, center, lean, level, start: center - BRIDGE_HALF_LENGTH, end: center + BRIDGE_HALF_LENGTH };
}
export function creekCenterS(creek, u) {
  return creek.center + u * creek.lean + 5 * Math.sin(u / 41 + creek.index) + 2.1 * Math.sin(u / 13 - creek.index * .7);
}
export function creekDistance(s, u) {
  const creek = plainsCreekAt(s);
  return Math.abs(s - creekCenterS(creek, u));
}
// The waterline sits where the carved bank crosses the creek level.
export const CREEK_WATER_HALF_WIDTH = 4.6;

// Stock ponds: a basin dug in a pasture, one to a stretch of road on either
// side, kept away from the creek and the road reserve.
export const POND_SPACING = 512;
const ponds = new Map();
export function stockPondAt(index, side) {
  const key = `${index},${side}`;
  if (ponds.has(key)) return ponds.get(key);
  const pond = digPond(index, side);
  if (ponds.size > 512) ponds.clear();
  ponds.set(key, pond);
  return pond;
}
function digPond(index, side) {
  const salt = side > 0 ? 2861 : 2862;
  if (randomAt(index, salt) > .54) return null;
  // Dug in the near fields rather than out in the far ones, on the flattest
  // ground of a handful of spots along the stretch: a pond dug on a slope
  // has a dam the height of a house on one side and a cut as deep on the
  // other. The terrain's columns are eight to eleven metres apart in close
  // and better than twenty out where the ponds used to lie.
  let best = null;
  for (let k = 0; k < 6; k++) {
    const rough = index * POND_SPACING + 60 + randomAt(index * 8 + k, salt + 1) * 390, cross = 46 + randomAt(index * 8 + k, salt + 2) * 54;
    // Kept whole inside one chunk, bank and all: a pond is built by the chunk
    // it stands in, on that chunk's own facets, and past the seam it would be
    // standing on the neighbour's, which it cannot see.
    const chunk = Math.floor(rough / 128), s = chunk * 128 + 32 + (rough - chunk * 128) / 128 * 64;
    const radius = 11 + randomAt(index, salt + 3) * 4.5, u = side * cross;
    // Well clear of the creek: a pond's bank reaches better than a third as far
    // again as its water, and the creek carries a floodplain and a line of
    // willows of its own, so the two must not be digging into one another.
    if (Math.abs(s - creekCenterS(plainsCreekAt(s), u)) < radius * 1.7 + 42) continue;
    const rim = plainsBaseHeight(s, u, true), pick = j => randomAt(index, (side > 0 ? 2891 : 2892) + j);
    // A dug pond is longer than it is wide, lying whichever way the digger
    // worked, and pushed in and out on the way round.
    const pond = { index, side, s, u, radius, rim, level: rim - .25,
      stretch: 1.18 + pick(0) * .34, tilt: pick(1) * Math.PI, lobes: [pick(2), pick(3)].map(r => r * Math.PI * 2) };
    // The spoil is banked highest on the side the ground falls away, which is
    // the side the water would otherwise spill over, and the cattle come down
    // to drink on the gentle side opposite it.
    let low = 0, lowest = Infinity, highest = -Infinity;
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2, r = pondEdge(pond, a) * 1.4;
      const h = plainsBaseHeight(s + Math.cos(a) * r, u + Math.sin(a) * r, true);
      if (h < lowest) { lowest = h; low = a; }
      highest = Math.max(highest, h);
    }
    pond.dam = low;
    pond.drink = low + Math.PI + (pick(4) - .5) * 1.8;
    pond.spread = highest - lowest;
    if (!best || pond.spread < best.spread) best = pond;
  }
  return best;
}
// How far a pond reaches in a given direction: an oval, held to the area of
// the round pond it stands for, bent into a bean by a three-fold lobe and
// roughened by a five-fold one. Both are odd, so neither can flatten the
// oval back into a disc the way a two-fold lobe could. One outline carries
// the water, the bank and everything standing on it.
export function pondEdge(pond, angle) {
  const a = angle - pond.tilt, [p, q] = pond.lobes;
  const oval = 1 / Math.sqrt(Math.cos(a) ** 2 / pond.stretch + Math.sin(a) ** 2 * pond.stretch);
  return pond.radius * oval * (1 + .09 * Math.sin(angle * 3 + p) + .05 * Math.sin(angle * 5 + q));
}
// The ground a pond makes of the field, at a share of the pond's reach in a
// given direction: a flat floor under the water with a steep bank up to a hand
// under the waterline, a shelf of trodden mud just above it, the spoil dug
// out of the basin heaped in a crest round the rim, and the outer slope let
// down onto the field. The crest stands highest on the low side, where it
// holds the water in; on the high side the field stands over it and the pond
// is cut into the ground. The terrain is refined to a few metres under a pond
// so its facets can follow this, and the pond's own cover then lies on them.
export function pondCrest(pond, angle) { return .3 + .4 * (.5 + .5 * Math.cos(angle - pond.dam)); }
export function pondProfile(pond, angle, d, ground) {
  const L = pond.level;
  if (d < 1) return L - .45 - 1.1 * (1 - smoothstep(.86, 1, d));
  const shelf = L - .45 + .58 * smoothstep(1, 1.07, d);
  const top = shelf + pondCrest(pond, angle) * smoothstep(1.06, 1.16, d);
  // Where the field stands above the crest the bank climbs to it from the
  // shelf, as one cut face, instead of stepping up over a heap and then again.
  const cut = smoothstep(-.3, .4, ground - (L + .13 + pondCrest(pond, angle)));
  return lerp(top, ground, lerp(smoothstep(1.16, 1.36, d), smoothstep(1.05, 1.36, d), cut));
}
export function pondsNear(s) {
  const index = Math.floor(s / POND_SPACING), result = [];
  for (let i = index - 1; i <= index + 1; i++) for (const side of [-1, 1]) { const pond = stockPondAt(i, side); if (pond) result.push(pond); }
  return result;
}
export function pondDistance(s, u) {
  let best = { pond: null, d: Infinity };
  for (const pond of pondsNear(s)) {
    const d = Math.hypot(s - pond.s, u - pond.u) / pondEdge(pond, Math.atan2(u - pond.u, s - pond.s));
    if (d < best.d) best = { pond, d };
  }
  return best;
}

// Smooth, seeded variation in two dimensions. The second derivative also
// meets at lattice boundaries, so grazing sunlight never reveals the grid.
export function plainsNoise(s, u, span, salt) {
  const x = s / span, z = u / span, i = Math.floor(x), j = Math.floor(z);
  const ease = t => t * t * t * (t * (t * 6 - 15) + 10);
  const a = ease(x - i), b = ease(z - j);
  return lerp(lerp(randomAt(i, j + salt), randomAt(i + 1, j + salt), a),
    lerp(randomAt(i, j + 1 + salt), randomAt(i + 1, j + 1 + salt), a), b) * 2 - 1;
}

// Overlapping rounded ridges, with different shoulders and saddles. Their
// slopes run gently into the fields instead of ending at a pyramid's edge.
const ridges = new Map();
function plainsRidge(index, band) {
  const key = `${index},${band}`;
  if (ridges.has(key)) return ridges.get(key);
  const seed = index * 5 + band * 733, spacing = 310 + band * 110;
  const ridge = {
    s: index * spacing + randomAt(seed, 2771) * spacing * .6,
    u: 385 + band * 145 + (randomAt(seed, 2772) - .5) * 70,
    along: 225 + band * 65 + randomAt(seed, 2773) * 75,
    across: 110 + band * 30 + randomAt(seed, 2774) * 45,
    lean: (randomAt(seed, 2775) - .5) * .65,
    height: 22 + band * 7 + randomAt(seed, 2776) * 11,
    shoulder: (randomAt(seed, 2777) - .5) * .35,
  };
  if (ridges.size >= 128) ridges.delete(ridges.keys().next().value);
  ridges.set(key, ridge);
  return ridge;
}
export function distantRise(s, u) {
  if (u <= 260) return 0;
  let hills = 0;
  for (let band = 0; band < 2; band++) {
    const spacing = 310 + band * 110, cell = Math.floor(s / spacing);
    for (let i = cell - 2; i <= cell + 2; i++) {
      const ridge = plainsRidge(i, band);
      const ds = (s - ridge.s) / ridge.along;
      const du = (u - ridge.u) / ridge.across + ds * ridge.lean;
      const radius2 = (ds / (1 + ridge.shoulder * Math.tanh(ds * 2))) ** 2 + du * du;
      hills += ridge.height * Math.max(0, 1 - radius2) ** 2;
    }
  }
  const foothills = 7 + 3 * plainsNoise(s, u, 173, 2778);
  return (hills + foothills) * smoothstep(260, 390, u);
}

function fieldSwell(s, u) {
  // Bend the sampling coordinates before layering broad landforms. Crests
  // wander and spread independently of the highway and the field boundaries.
  const along = s + 48 * Math.sin(u / 157 + swellPhase[0]) + 22 * Math.sin(s / 253);
  const across = u + 39 * Math.sin(s / 183 + swellPhase[1]);
  return 9.5 * plainsNoise(along, across, 190, 2703) + 4.5 * plainsNoise(along + 143, across - 87, 93, 2704)
    + .6 * plainsNoise(along, across, 42, 2705) + 2.5 * Math.sin(s / 347 - u / 263 + swellPhase[1]);
}
// The plain without its creek: a flat road reserve with a drainage ditch on
// each side, then rolling fields that ease down toward the camera and up
// behind the road, so the far side presents more ground to the fixed view.
export function plainsBaseHeight(s, u, beforePonds = false) {
  const h = plainsRoadHeight(s), cross = Math.abs(u);
  if (cross <= 7) return h;
  const ditch = .55 * Math.sin(Math.PI * clamp((cross - 8.2) / 5.2, 0, 1)) ** 2;
  // Let the road's elevation carry the adjacent pasture. Removing the local
  // offset avoids a steep bank wherever an independent hill crosses the road;
  // farther out, the land regains its full, independent relief.
  const swell = (fieldSwell(s, u) - fieldSwell(s, 0) * (1 - smoothstep(65, 230, cross))) * smoothstep(9, 42, cross);
  const fall = u < 0 ? 9 * smoothstep(60, 420, cross) : 0;
  const rise = u > 0 ? 6 * smoothstep(60, 300, u) : 0;
  let height = h - ditch + swell - fall + rise + distantRise(s, u);
  if (beforePonds || cross < 14 || cross > 160) return height;
  const { pond, d } = pondDistance(s, u);
  if (pond && d < 1.36) height = pondProfile(pond, Math.atan2(u - pond.u, s - pond.s), d, height);
  return height;
}
export function plainsGroundHeight(s, u) {
  const base = plainsBaseHeight(s, u);
  const creek = plainsCreekAt(s), d = Math.abs(s - creekCenterS(creek, u));
  if (d > 24) return base;
  // The floodplain pulls the fields down to the creek's own level, but the
  // road keeps its embankment, so under the bridge the banks are steeper.
  const bankNoise = .35 * Math.sin(s * .7 + u * .4) + .25 * Math.sin(u * 1.3);
  const plain = lerp(base, creek.level + 1.6 + bankNoise, (1 - smoothstep(8, 24, d)) * smoothstep(7, 12, Math.abs(u)));
  // The bed lies at the creek's own level, the same depth under the water all
  // the way across, rather than a fixed depth under whatever stands above it.
  // Cut from the local ground it followed the road's swell, and where the
  // channel wandered onto a rising part of one the floor came up through the
  // flat water as a bar across the creek.
  return lerp(plain, Math.min(plain, creek.level - 1.8), 1 - smoothstep(3, 8, d));
}
// Driving queries see the bridge deck; the terrain sees the channel beneath it.
export function plainsHeight(s, u) {
  return Math.abs(u) <= 7 ? plainsRoadHeight(s) : plainsGroundHeight(s, u);
}
export const plainsPosition = (s, u, y = plainsHeight(s, u)) => positionAt(s, u, y);

// Fields are a patchwork: rows of fields along the road, each row cut into
// bands away from it at its own offsets, so boundaries stagger from one row
// to the next instead of forming a grid. Every boundary is a line in (s, u),
// which is where the fences, hedges and shelterbelts stand.
// Rows short enough, and the near band wide enough, that a field is a
// squarish block rather than a strip: a row a quarter of a kilometre long
// against a band forty metres deep was a ribbon six times as long as it was wide.
export const FIELD_SPAN = 136;
export const ROAD_RESERVE = 13;
// Boundaries land on terrain rows and columns, so the colour change between
// two fields follows one line of facets instead of sawing across them.
export function fieldBoundary(index) { return Math.round((index * FIELD_SPAN + 40 + randomAt(index, 2721) * 56) / PLAINS_STEP) * PLAINS_STEP; }
export function fieldRowAt(s) {
  let index = Math.floor((s - 40) / FIELD_SPAN);
  if (s < fieldBoundary(index)) index--;
  return index;
}
const BAND_EDGES = [ROAD_RESERVE, 84, 164, 268, 400];
// A row's band edges are read for every clearance test along it, so they are
// worked out once and kept.
const bandRows = new Map();
export function fieldBands(row, side) {
  const key = row * 2 + (side > 0 ? 1 : 0);
  if (bandRows.has(key)) return bandRows.get(key);
  const bands = BAND_EDGES.map((u, k) => {
    if (k === 0) return u;
    const target = u + (randomAt(row * 2 + (side > 0 ? 1 : 0), 2731 + k) - .5) * u * .2;
    // The near side's terrain ends sooner than the far side's.
    const columns = PLAINS_COLUMNS.filter(column => column > ROAD_RESERVE && column <= (side > 0 ? 568 : 400));
    return columns.reduce((best, column) => Math.abs(column - target) < Math.abs(best - target) ? column : best, Infinity);
  });
  bandRows.set(key, bands);
  if (bandRows.size > 512) bandRows.delete(bandRows.keys().next().value);
  return bands;
}
const CROPS = ['wheat', 'stubble', 'ploughed', 'pasture', 'hay'];
export function fieldAt(s, u) {
  const cross = Math.abs(u);
  if (cross < ROAD_RESERVE) return null;
  const row = fieldRowAt(s), side = u < 0 ? -1 : 1, bands = fieldBands(row, side);
  let band = 0;
  while (band < bands.length - 1 && cross >= bands[band + 1]) band++;
  const seed = row * 8 + band, salt = side > 0 ? 2741 : 2751, r = randomAt(seed, salt);
  // Ploughed earth is the one dark patch in a gold country, so it is the
  // rare field: a few to a drive, not a checkerboard of them.
  const kind = band >= 4 ? 'pasture' : CROPS[r < .32 ? 0 : r < .55 ? 1 : r < .62 ? 2 : r < .83 ? 3 : 4];
  return { row, band, side, kind, seed, salt, rows: randomAt(seed, salt + 1) < .5 ? 'along' : 'across',
    from: bands[band], to: bands[band + 1] ?? 600, start: fieldBoundary(row), end: fieldBoundary(row + 1) };
}
// What stands on a boundary. Row boundaries cross the whole view, so they
// are where the tall shelterbelts go; band boundaries run along the road.
export function rowBoundaryKind(row, side) {
  const r = randomAt(row, side > 0 ? 2781 : 2782);
  return r < .14 ? null : r < .44 ? 'fence' : r < .56 ? 'hedge' : r < .84 ? 'treeline' : 'shelterbelt';
}
export function bandBoundaryKind(row, side, band) {
  const r = randomAt(row * 4 + band, side > 0 ? 2783 : 2784);
  // Some band edges are just a change of crop; most carry a post-and-rail
  // fence, a low clipped hedge, or a belt of trees, now that a fence is a
  // pair of rails rather than a row of dots at driving zoom.
  return r < .3 ? null : r < .62 ? 'fence' : r < .74 ? 'hedge' : 'treeline';
}
// A strip of bare headland runs beside every boundary that carries a fence,
// hedge or trees, where the tractor turns: the distance from a point in a
// field to the nearest such line, which the terrain shades as trodden earth.
export const BOUNDARY_LINE = 2.2;
export function headlandDistance(s, u, field) {
  const { row, side, band } = field, bands = fieldBands(row, side), cross = Math.abs(u);
  let d = 99;
  if (band < 4 && cross < 330) {
    if (rowBoundaryKind(row, side)) d = Math.min(d, Math.abs(s - field.start - BOUNDARY_LINE));
    if (rowBoundaryKind(row + 1, side)) d = Math.min(d, Math.abs(s - field.end - BOUNDARY_LINE));
  }
  if (band > 0 && band < 4 && bandBoundaryKind(row, side, band)) d = Math.min(d, Math.abs(cross - bands[band]));
  if (band < 3 && bandBoundaryKind(row, side, band + 1)) d = Math.min(d, Math.abs(cross - bands[band + 1]));
  return d;
}
// Stone piles cleared off the fields, and a stock pond in some pastures.
export function fieldCorner(row, side, band) {
  return randomAt(row * 4 + band, side > 0 ? 2791 : 2792) < .232;
}
export function roadsideFence(row, side) { return randomAt(row, side > 0 ? 2785 : 2786) > .35; }
// A farm track leaves the road through a gate in some rows, with a mailbox.
// Sparingly: a track every few hundred metres reads as farm country, and one
// every other field reads as a road that cannot decide where it is going.
export function farmGate(row, side) {
  // The chance is per row, and a row is now 136 metres rather than 176, so it
  // is cut to match: a shorter field is no reason for more gates in a mile.
  if (randomAt(row, side > 0 ? 2787 : 2788) > .124) return null;
  const start = fieldBoundary(row), end = fieldBoundary(row + 1);
  const s = Math.round(start + 18 + randomAt(row, side > 0 ? 2789 : 2790) * (end - start - 36));
  // Most field gates are only gates: a farmer takes a tractor through one a
  // few times a year and the crop closes over behind it. Only the few that
  // are used week in and week out wear a track across the field behind them,
  // and a track that runs out into a field and stops is worth coming upon.
  const worn = randomAt(row, side > 0 ? 2857 : 2858) < .34;
  // How far it runs. Half stop at the first boundary, which is as short as a
  // track gets; the rest carry on to the second or the third, and one now and
  // again runs out past everything the view holds.
  const far = randomAt(row, side > 0 ? 2871 : 2872), bands = fieldBands(row, side);
  const reach = bands[far < .5 ? 1 : far < .76 ? 2 : far < .92 ? 3 : 4] - 6;
  // And what stands at the end of it: some of these tracks are how a farm
  // reaches the shed it keeps out in the fields.
  return { s, side, worn, reach, shed: randomAt(row, side > 0 ? 2873 : 2874) < .45 };
}
// The corridor a worn track keeps to itself. A boundary fence, a hedge or a
// line of trees that meets one simply stops either side of it, which reads as
// the gateway it is, and nothing is planted in the ruts.
export function farmTrackClears(s, u, radius = 0) {
  const cross = Math.abs(u);
  if (cross < ROAD_RESERVE - 4) return true;
  const gate = farmGate(fieldRowAt(s), u < 0 ? -1 : 1);
  if (!gate || !gate.worn || cross > gate.reach + 2) return true;
  return Math.abs(s - gate.s) > 5 + radius;
}

// Terrain columns are fixed offsets from the road. Fine rows and columns keep
// the ditch crisp beside the road; the fields coarsen outward. Extra columns
// on the distant hills keep facets broad rather than fifty-metre ribbons.
const PLAINS_COLUMNS = [-400, -376, -352, -330, -308, -288, -268, -252, -232, -200, -172, -148, -127, -109, -93, -79, -67, -56, -46, -37, -29, -22, -16.5, -13, -10.8, -8.6, -7,
  0, 7, 8.6, 10.8, 13, 16.5, 22, 29, 37, 46, 56, 67, 79, 93, 109, 127, 148, 172, 200, 232, 252, 268, 288, 308, 330, 352, 376, 400, 426, 452, 480, 508, 538, 568];
export { PLAINS_COLUMNS };
export const PLAINS_COLUMN_COUNT = PLAINS_COLUMNS.length;
// The creek is only ten metres across, so the rows halve around each crossing.
export function plainsRowStep(row) {
  return Math.abs(row * PLAINS_STEP - plainsCreekAt(row * PLAINS_STEP).center) <= 72 ? .5 : 1;
}
export function plainsVertex(row, column) {
  const base = PLAINS_COLUMNS[column], cross = Math.abs(base);
  const fixed = cross <= ROAD_RESERVE;
  const seedRow = Number.isInteger(row) ? row : row * 2 + 1048576;
  const s = row * PLAINS_STEP + (fixed ? 0 : (randomAt(seedRow, column + 2761) - .5) * 3.6);
  const gap = Math.min(base - (PLAINS_COLUMNS[column - 1] ?? base - 40), (PLAINS_COLUMNS[column + 1] ?? base + 40) - base);
  const u = base + (fixed ? 0 : (randomAt(seedRow, column + 2762) - .5) * Math.min(4.5, gap * .32));
  const p = plainsPosition(s, u, plainsGroundHeight(s, u));
  // A trace of facet relief on the fields, so a worked field lies smooth
  // enough to carry its furrows, without corrugating the hills; none at water.
  const dry = smoothstep(4, 9, creekDistance(s, u));
  p.y += (randomAt(seedRow, column + 2763) - .5) * .09 * smoothstep(13, 30, cross) * dry;
  return { ...p, s, u, column };
}

export const plainsDrivingRoute = {
  frame: plainsFrame, position: plainsPosition, height: plainsHeight,
  bounds: s => {
    const creek = plainsCreekAt(s);
    if (s > creek.start - 8 && s < creek.end + 8) return [-4.8, 4.8];
    return [-11.5, 11.5];
  },
};
