import { randomAt } from './route.js';
import { landmarkForBlock, PUBLIC_SPACE_CHANCE } from './city-places.js';
export { PUBLIC_SPACE_CHANCE } from './city-places.js';
import { cityLayout, cityLogical } from './city-layout.js';
import { cityRiverAxes, logicalWaterAt } from './city-waterways.js';
export { RIVER_PERIOD, RIVER_COLUMN, RIVER_MARGIN } from './city-waterways.js';

// s points north; u points east. Integer addresses describe connectivity;
// city-layout maps those addresses to the streets' actual world positions.
export const CITY_BLOCK = 112;
export const DISTANT_CITY_RADIUS = 5;
export const ROAD_HALF_WIDTH = 9;
export const ROAD_LEVEL = 24;
export const PAVEMENT_LEVEL = 24.12;
export const WATER_LEVEL = 17.8;
export const BRIDGE_HALF_WIDTH = 10.8;

export const positiveModulo = (value, divisor) => ((value % divisor) + divisor) % divisor;
const STREET_PROFILES = Object.freeze({
  // One extra unit of asphalt on each edge; lane paths and medians keep their size.
  side: Object.freeze({ kind: 'side', halfWidth: 6.5, lane: 2.7, speed: 10, median: 0 }),
  avenue: Object.freeze({ kind: 'avenue', halfWidth: ROAD_HALF_WIDTH, lane: 3, speed: 16, median: 0 }),
  boulevard: Object.freeze({ kind: 'boulevard', halfWidth: 11, lane: 5.7, speed: 20, median: 1.4 }),
});
export function cityStreetProfile(axis, index) {
  const phase = positiveModulo(index, 5);
  return STREET_PROFILES[phase === 2 ? 'boulevard' : phase === 1 || phase === 3 ? 'side' : 'avenue'];
}
export function cityJunctionControl(axis, streetIndex, crossingIndex) {
  const own = cityStreetProfile(axis, streetIndex), cross = cityStreetProfile(axis === 'north' ? 'east' : 'north', crossingIndex);
  return own.kind === 'side' ? 'stop' : cross.kind === 'side' ? 'priority' : 'signal';
}
export function cityMedianRange(axis, blockIndex) {
  const cross = axis === 'north' ? 'east' : 'north';
  return [cityStreetProfile(cross, blockIndex).halfWidth + 12, CITY_BLOCK - cityStreetProfile(cross, blockIndex + 1).halfWidth - 12];
}
export function cityMedianAt(s, u) {
  const p = cityLogical(s, u);
  return logicalMedianAt(p.s, p.u);
}
function logicalMedianAt(s, u) {
  for (const axis of ['north', 'east']) {
    const across = axis === 'north' ? u : s, along = axis === 'north' ? s : u;
    const index = Math.round(across / CITY_BLOCK), profile = cityStreetProfile(axis, index);
    if (!profile.median || Math.abs(across - index * CITY_BLOCK) > profile.median) continue;
    const block = Math.floor(along / CITY_BLOCK);
    if (axis === 'east' ? cityRiverAxes(block, index).north : cityRiverAxes(index, block).east) continue;
    const [start, end] = cityMedianRange(axis, block), local = along - block * CITY_BLOCK;
    if (local >= start && local <= end) return true;
  }
  return false;
}
export function cityCell(s, u) {
  ({ s, u } = cityLogical(s, u));
  const ix = Math.floor(u / CITY_BLOCK), iz = Math.floor(s / CITY_BLOCK);
  return { ix, iz, key: `${ix},${iz}` };
}
export function cityRiverAt(u, s = 0) {
  const p = cityLogical(s, u), river = logicalWaterAt(p.s, p.u);
  if (!river) return null;
  return { ...river, center: cityLayout((river.iz + .5) * CITY_BLOCK, (river.ix + .5) * CITY_BLOCK) };
}
export function cityStreetAt(s, u) {
  ({ s, u } = cityLogical(s, u));
  const northIndex = Math.round(u / CITY_BLOCK), eastIndex = Math.round(s / CITY_BLOCK);
  const northDistance = Math.abs(u - northIndex * CITY_BLOCK), eastDistance = Math.abs(s - eastIndex * CITY_BLOCK);
  const northProfile = cityStreetProfile('north', northIndex), eastProfile = cityStreetProfile('east', eastIndex);
  const north = northDistance <= northProfile.halfWidth, east = eastDistance <= eastProfile.halfWidth;
  const river = logicalWaterAt(s, u);
  const axis = north && !east ? 'north' : east && !north ? 'east' : northDistance <= eastDistance ? 'north' : 'east';
  return {
    onRoad: north || east, intersection: north && east,
    axis, northDistance, eastDistance, profile: axis === 'north' ? northProfile : eastProfile,
    logicalS: s, logicalU: u, northIndex, eastIndex,
    median: logicalMedianAt(s, u),
    bridge: Boolean(river && ((river.north && eastDistance <= Math.max(BRIDGE_HALF_WIDTH, eastProfile.halfWidth + 2.8))
      || (river.east && northDistance <= Math.max(BRIDGE_HALF_WIDTH, northProfile.halfWidth + 2.8)))),
  };
}
export function cityRoadDistance(s, u) {
  const street = cityStreetAt(s, u);
  return Math.min(street.northDistance, street.eastDistance);
}
export function nearestCityStreet(s, u) {
  const street = cityStreetAt(s, u);
  const north = street.axis === 'north', index = north ? street.northIndex : street.eastIndex;
  const logicalS = north ? street.logicalS : index * CITY_BLOCK;
  const logicalU = north ? index * CITY_BLOCK : street.logicalU;
  return { ...cityLayout(logicalS, logicalU), logicalS, logicalU, index, axis: street.axis };
}

const DISTRICTS = ['Old town', 'Garden quarter', 'Midtown', 'Warehouse district', 'Market district', 'Civic quarter'];
// Public-space blocks split 65/35 between parks and plazas.
const PARK_CHANCE = PUBLIC_SPACE_CHANCE * .65;
export function cityDistrict(s, u) {
  const { ix, iz } = cityCell(s, u);
  return blockDistrict(ix, iz);
}
function blockDistrict(ix, iz) {
  const river = cityRiverAxes(ix, iz);
  if (river.north || river.east) return 'Riverfront';
  return DISTRICTS[Math.floor(randomAt(Math.floor(ix / 4), Math.floor(iz / 4) + 7101) * DISTRICTS.length)];
}
export function cityBlock(ix, iz) {
  const seed = Math.floor(randomAt(ix, iz + 7102) * 0xffffffff);
  const chance = randomAt(ix, iz + 7103);
  const landmark = landmarkForBlock(ix, iz);
  const rivers = cityRiverAxes(ix, iz);
  const kind = rivers.north || rivers.east ? 'river' : landmark ? 'landmark'
    : chance < PARK_CHANCE ? 'park' : chance < PUBLIC_SPACE_CHANCE ? 'plaza' : 'blocks';
  return { ix, iz, key: `${ix},${iz}`, seed, kind, rivers, landmark, district: blockDistrict(ix, iz) };
}

export function cityHeight(s, u) {
  const street = cityStreetAt(s, u);
  if (street.median) return PAVEMENT_LEVEL + .16;
  if (street.onRoad) return ROAD_LEVEL;
  if (logicalWaterAt(street.logicalS, street.logicalU) && !street.bridge) return WATER_LEVEL;
  return PAVEMENT_LEVEL;
}
export const citydriverRoute = {
  grid: true, laneAssist: false,
  frame: s => ({ x: 0, y: ROAD_LEVEL, z: -s, angle: 0, scale: 1 }),
  position: (s, u, y = cityHeight(s, u)) => ({ x: u, y, z: -s }),
  height: cityHeight,
  bounds: () => [-Infinity, Infinity],
  looseness: (s, u) => { const street = cityStreetAt(s, u); return street.median ? .55 : street.onRoad ? 0 : .3; },
  water: (s, u) => { const street = cityStreetAt(s, u); return Boolean(logicalWaterAt(street.logicalS, street.logicalU)) && !street.bridge; },
};
