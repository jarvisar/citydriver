import { CHUNK_LENGTH, randomAt, roadDerivative, lerp, clamp } from './route.js';
import { snowGroundHeight, snowRoadHeight, snowBridgeAt, ledgeEdge, lampAt, LAMP_SPACING, summitForCell, alpineLake, LAKE_LEVEL } from './snow-route.js';
import { nearCabin } from './alpine-cabins.js';

export const SNOW_DISCOVERY_SPACING = 6144;
// Populate a third more districts; terrain checks still make these the rarest
// encounters. Keep existing sites and the long gaps between districts.
const DISTRICT_CHANCE = .75;
// Track ropes run this far either side of the line; each carries one cabin.
export const CABLE_ROPE_OFFSET = 3;
// Cabin floor below the rope, and the clearance kept beneath it.
export const CABIN_DROP = 5.2;
const ROPE_CLEARANCE = 6.5;
// The bench between the road's guardrail and the bluff rim carries the pylon.
const LOWER_STATION_U = -15.5;
const sites = new Map();

// Rope height above the line at u, following each span's sag.
function ropeHeight(points, u) {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    if (u < a.u || u > b.u) continue;
    const t = (u - a.u) / (b.u - a.u);
    return lerp(a.y, b.y, t) - 4 * spanSag(a, b) * t * (1 - t);
  }
  return -Infinity;
}
export const spanSag = (a, b) => Math.hypot(b.u - a.u, b.y - a.y) * .018;

function worstClearance(s, points) {
  let worst = { u: 0, clearance: Infinity };
  const first = points[0].u, last = points.at(-1).u;
  // Cabins may sit low only beside the station platforms.
  for (let u = first + 3; u < last - 3; u += 1) {
    const rope = ropeHeight(points, u), road = snowRoadHeight(s);
    // Cabins must clear traffic on the road and the lamp heads on its inner shoulder.
    const fixtures = Math.abs(u) < 5 ? road + 2.5 : u >= 5 && u < 10.5 ? road + 6.5 : -Infinity;
    const floor = Math.max(...[-4, 0, 4].map(ds => snowGroundHeight(s + ds, u)), fixtures);
    const clearance = rope - floor - ROPE_CLEARANCE;
    if (clearance < worst.clearance) worst = { u, clearance };
  }
  return worst;
}

function footingRange(s, u, reach) {
  const heights = [-reach, 0, reach].flatMap(ds => [-reach, 0, reach].map(du => snowGroundHeight(s + ds, u + du)));
  return { low: Math.min(...heights), high: Math.max(...heights) };
}

function nearFixtures(s, reach) {
  if (Math.abs(s - snowBridgeAt(s).center) < 32 + 40 + reach) return true;
  for (let i = Math.floor((s - reach - 60) / LAMP_SPACING); i * LAMP_SPACING < s + reach + 60; i++) {
    const lamp = lampAt(i);
    if (!lamp.hidden && Math.abs(lamp.s - s) < reach + 1.5) return true;
  }
  const cell = Math.floor((s - 76) / 280);
  for (let i = cell - 1; i <= cell + 1; i++) if ((i % 3 + 3) % 3 === 0 && Math.abs(summitForCell(i).s - s) < reach + 16) return true;
  const inChunk = ((s % CHUNK_LENGTH) + CHUNK_LENGTH) % CHUNK_LENGTH;
  return inChunk < reach + 4 || inChunk > CHUNK_LENGTH - reach - 4;
}

function cableCarAt(s, index) {
  // A nearly straight road keeps each rope span straight in world space.
  if ([-10, 0, 10].some(ds => Math.abs(roadDerivative(s + ds)) > .3) || nearFixtures(s, 9)) return null;
  if ([-7, -3.5, 0, 3.5, 7].some(ds => ledgeEdge(s + ds) > -23)) return null;
  const road = snowRoadHeight(s);
  // The valley station stands on the lake shore, clear of the cabins there.
  const shoreU = alpineLake(s).near + 7;
  if ([-12, 0, 12].some(ds => nearCabin(s + ds, shoreU))) return null;
  const shore = footingRange(s, shoreU, 4.5);
  if (shore.high - shore.low > 2.6 || shore.high > LAKE_LEVEL + 7) return null;
  const shorePoint = { u: shoreU, y: shore.high + 7.6, ground: shore.high, low: shore.low };
  // A tall pylon on the roadside bench lifts the rope off the bluff rim.
  const bench = footingRange(s, LOWER_STATION_U, 3);
  if (bench.high - bench.low > 2.5) return null;
  let best = null;
  for (let u = 44; u <= 66; u += 2) {
    const footing = footingRange(s, u, 4.5);
    if (footing.high - road < 32 || footing.high - footing.low > 6.5) continue;
    if (!best || footing.high - footing.low < best.high - best.low) best = { u, ...footing };
  }
  if (!best) return null;
  const upperPoint = { u: best.u - 5.8, y: best.high + 7.6, ground: best.high };
  const site = points => ({ kind: 'cable-car', index, s, lower: { u: shoreU, ground: shore.high, low: shore.low },
    upper: { u: best.u, ground: best.high, low: best.low }, points });
  const benchPoint = { u: LOWER_STATION_U, y: bench.low + 15, ground: bench.high, low: bench.low };
  const points = [shorePoint, benchPoint, upperPoint];
  // Towers go up near the middle of a span, as an even row up the mountainside.
  const brace = (index, lift) => {
    const a = points[index - 1], b = points[index];
    if (points.length >= 6) return false;
    for (const fraction of [.5, .42, .58, .35, .65]) {
      const u = Math.round(lerp(a.u, b.u, fraction));
      if (points.some(point => Math.abs(point.u - u) < 24)) continue;
      const footing = footingRange(s, u, 2.2);
      const y = Math.max(footing.high + 12, lerp(a.y, b.y, (u - a.u) / (b.u - a.u)) + lift);
      if (footing.high - footing.low > 9 || y - footing.high > 26) continue;
      points.splice(index, 0, { u, y, ground: footing.high, low: footing.low });
      return true;
    }
    return false;
  };
  // Wherever the rope runs too close to the mountain, brace that span or raise
  // the tower beside it; then even out whatever span is left much the longest.
  for (let pass = 0; pass < 7; pass++) {
    const worst = worstClearance(s, points);
    if (worst.clearance >= 0) break;
    const index = points.findIndex(point => point.u > worst.u);
    if (brace(index, 2.5 - worst.clearance)) continue;
    const pylon = points.slice(1, -1).reduce((best, point) =>
      Math.abs(point.u - worst.u) < Math.abs(best.u - worst.u) ? point : best);
    if (!pylon || pylon.y - pylon.ground > 23) return null;
    pylon.y += 3.5;
    if (pass === 6) return null;
  }
  for (let pass = 0; pass < 2; pass++) {
    const spans = points.slice(1).map((point, i) => point.u - points[i].u);
    const longest = spans.indexOf(Math.max(...spans));
    if (spans[longest] < Math.min(...spans) * 1.7 || spans[longest] < 56) break;
    const before = points.length;
    if (!brace(longest + 1, 2.5) || worstClearance(s, points).clearance < 0) {
      if (points.length > before) points.splice(longest + 1, 1);
      break;
    }
  }
  // Adding a tower changes what its neighbours carry. Every pylon must still
  // stand above the line through the two beside it, holding the rope up.
  for (let i = 1; i < points.length - 1; i++) {
    const point = points[i], a = points[i - 1], b = points[i + 1];
    const chord = lerp(a.y, b.y, (point.u - a.u) / (b.u - a.u));
    if (point.y >= chord + .8) continue;
    point.y = chord + 1.4;
    if (point.y - point.ground > 26) return null;
    i = 0;
  }
  return worstClearance(s, points).clearance >= 0 ? site(points) : null;
}

function snowmenAt(s, index) {
  if (nearFixtures(s, 9)) return null;
  const u = 11.5;
  const figures = [-4.5, 0, 4.5].map((ds, i) => ({ s: s + ds, u: u + (i === 1 ? .3 : 0), scale: [.8, 1, .65][i] }));
  if (figures.some(figure => {
    const footing = footingRange(figure.s, figure.u, 1.2 * figure.scale);
    return footing.high - footing.low > 1.3 || nearCabin(figure.s, figure.u);
  })) return null;
  return { kind: 'snowmen', index, s, u, figures };
}

function districtSite(index) {
  if (sites.has(index)) return sites.get(index);
  let site = null;
  // Reuse the established terrain-checked discovery schedule, then give each
  // kind an equal chance. Easier snowman placement must not make discoveries
  // more common than the existing cable-car encounters.
  if (randomAt(index, 3101) > 1 - DISTRICT_CHANCE) {
    const desired = index * SNOW_DISCOVERY_SPACING + 3072 + (randomAt(index, 3103) - .5) * 1200;
    for (let step = 0; step < 96 && !site; step++) {
      const s = Math.round(desired / 2) * 2 + (step % 2 ? -1 : 1) * Math.ceil(step / 2) * 30;
      site = cableCarAt(s, index);
    }
    if (site && randomAt(index, 3102) < .5) site = snowmenAt(site.s, index) ?? site;
  }
  sites.set(index, site);
  if (sites.size > 128) sites.delete(sites.keys().next().value);
  return site;
}

export function snowDiscoveries(first, last) {
  const result = [];
  for (let index = Math.floor(first / SNOW_DISCOVERY_SPACING) - 1; index <= Math.floor(last / SNOW_DISCOVERY_SPACING) + 1; index++) {
    const site = districtSite(index);
    if (site && site.s >= first && site.s < last) result.push(site);
  }
  return result;
}

// Keep trees and boulders away from snowmen, footings and the ropes.
export function snowDiscoveryClears(s, u, discoveries, radius = 0) {
  return discoveries.every(site => site.kind === 'snowmen'
    ? site.figures.every(figure => Math.hypot(s - figure.s, u - figure.u) > 3 + radius)
    : Math.abs(s - site.s) > CABLE_ROPE_OFFSET + 4.5 + radius
      || u < site.lower.u - 5 - radius || u > site.upper.u + 5.5 + radius);
}

// Jig-back operation: both cabins wait at the stations, then pass mid-line.
export const CABLE_CYCLE = 96;
export function cableTravel(time, index) {
  const phase = ((time + index * 17.3) % CABLE_CYCLE + CABLE_CYCLE) % CABLE_CYCLE;
  const dwell = 8, trip = CABLE_CYCLE / 2 - dwell;
  const ease = t => t * t * (3 - 2 * t);
  if (phase < dwell) return 0;
  if (phase < dwell + trip) return ease((phase - dwell) / trip);
  if (phase < 2 * dwell + trip) return 1;
  return 1 - ease((phase - 2 * dwell - trip) / trip);
}
