import { randomAt } from './route.js';
import { landmarkForBlock } from './city-places.js';

// s points north; u points east. Streets meet at every integer grid line,
// including negative coordinates. Rendering, traffic and physics share this map.
export const CITY_BLOCK = 112;
export const DISTANT_CITY_RADIUS = 5;
export const ROAD_HALF_WIDTH = 8;
export const ROAD_LEVEL = 24;
export const PAVEMENT_LEVEL = 24.12;
export const WATER_LEVEL = 17.8;
export const BRIDGE_HALF_WIDTH = 10.8;
export const RIVER_PERIOD = 7;
export const RIVER_COLUMN = 3;
export const RIVER_MARGIN = 28;

export const positiveModulo = (value, divisor) => ((value % divisor) + divisor) % divisor;
const STREET_PROFILES = Object.freeze({
  side: Object.freeze({ kind: 'side', halfWidth: 5.5, lane: 2.7, speed: 10, median: 0 }),
  avenue: Object.freeze({ kind: 'avenue', halfWidth: 8, lane: 3, speed: 16, median: 0 }),
  boulevard: Object.freeze({ kind: 'boulevard', halfWidth: 10, lane: 5.7, speed: 20, median: 1.4 }),
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
  for (const axis of ['north', 'east']) {
    const across = axis === 'north' ? u : s, along = axis === 'north' ? s : u;
    const index = Math.round(across / CITY_BLOCK), profile = cityStreetProfile(axis, index);
    if (!profile.median || Math.abs(across - index * CITY_BLOCK) > profile.median) continue;
    const block = Math.floor(along / CITY_BLOCK);
    if (axis === 'east' && positiveModulo(block, RIVER_PERIOD) === RIVER_COLUMN) continue;
    const [start, end] = cityMedianRange(axis, block), local = along - block * CITY_BLOCK;
    if (local >= start && local <= end) return true;
  }
  return false;
}
export function cityCell(s, u) {
  const ix = Math.floor(u / CITY_BLOCK), iz = Math.floor(s / CITY_BLOCK);
  return { ix, iz, key: `${ix},${iz}` };
}
export function cityRiverAt(u) {
  const ix = Math.floor(u / CITY_BLOCK);
  if (positiveModulo(ix, RIVER_PERIOD) !== RIVER_COLUMN) return null;
  const min = ix * CITY_BLOCK + RIVER_MARGIN, max = (ix + 1) * CITY_BLOCK - RIVER_MARGIN;
  return u >= min && u <= max ? { ix, min, max, center: (min + max) / 2 } : null;
}
export function cityStreetAt(s, u) {
  const northIndex = Math.round(u / CITY_BLOCK), eastIndex = Math.round(s / CITY_BLOCK);
  const northDistance = Math.abs(u - northIndex * CITY_BLOCK), eastDistance = Math.abs(s - eastIndex * CITY_BLOCK);
  const northProfile = cityStreetProfile('north', northIndex), eastProfile = cityStreetProfile('east', eastIndex);
  const north = northDistance <= northProfile.halfWidth, east = eastDistance <= eastProfile.halfWidth;
  const axis = north && !east ? 'north' : east && !north ? 'east' : northDistance <= eastDistance ? 'north' : 'east';
  return {
    onRoad: north || east, intersection: north && east,
    axis, northDistance, eastDistance, profile: axis === 'north' ? northProfile : eastProfile,
    median: cityMedianAt(s, u),
    bridge: Boolean(cityRiverAt(u)) && eastDistance <= Math.max(BRIDGE_HALF_WIDTH, eastProfile.halfWidth + 2.8),
  };
}
export function cityRoadDistance(s, u) {
  const street = cityStreetAt(s, u);
  return Math.min(street.northDistance, street.eastDistance);
}
export function nearestCityStreet(s, u) {
  const street = cityStreetAt(s, u);
  return street.axis === 'north'
    ? { s, u: Math.round(u / CITY_BLOCK) * CITY_BLOCK, axis: 'north' }
    : { s: Math.round(s / CITY_BLOCK) * CITY_BLOCK, u, axis: 'east' };
}

const DISTRICTS = ['Old town', 'Garden quarter', 'Midtown', 'Warehouse district', 'Market district', 'Civic quarter'];
export function cityDistrict(s, u) {
  const { ix, iz } = cityCell(s, u);
  if (positiveModulo(ix, RIVER_PERIOD) === RIVER_COLUMN) return 'Riverfront';
  return DISTRICTS[Math.floor(randomAt(Math.floor(ix / 4), Math.floor(iz / 4) + 7101) * DISTRICTS.length)];
}
export function cityBlock(ix, iz) {
  const seed = Math.floor(randomAt(ix, iz + 7102) * 0xffffffff);
  const chance = randomAt(ix, iz + 7103);
  const landmark = landmarkForBlock(ix, iz);
  const kind = positiveModulo(ix, RIVER_PERIOD) === RIVER_COLUMN ? 'river' : landmark ? 'landmark'
    : chance < .13 ? 'park' : chance < .2 ? 'plaza' : 'blocks';
  return { ix, iz, key: `${ix},${iz}`, seed, kind, landmark, district: cityDistrict((iz + .5) * CITY_BLOCK, (ix + .5) * CITY_BLOCK) };
}

export function cityHeight(s, u) {
  const street = cityStreetAt(s, u);
  if (street.median) return PAVEMENT_LEVEL + .16;
  if (street.onRoad) return ROAD_LEVEL;
  if (cityRiverAt(u) && !street.bridge) return WATER_LEVEL;
  return PAVEMENT_LEVEL;
}
export const citydriverRoute = {
  grid: true, laneAssist: false,
  frame: s => ({ x: 0, y: ROAD_LEVEL, z: -s, angle: 0, scale: 1 }),
  position: (s, u, y = cityHeight(s, u)) => ({ x: u, y, z: -s }),
  height: cityHeight,
  bounds: () => [-Infinity, Infinity],
  looseness: (s, u) => { const street = cityStreetAt(s, u); return street.median ? .55 : street.onRoad ? 0 : .3; },
  water: (s, u) => Boolean(cityRiverAt(u)) && !cityStreetAt(s, u).bridge,
};
