import { randomAt } from './route.js';

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
  const northDistance = Math.abs(u - Math.round(u / CITY_BLOCK) * CITY_BLOCK);
  const eastDistance = Math.abs(s - Math.round(s / CITY_BLOCK) * CITY_BLOCK);
  const north = northDistance <= ROAD_HALF_WIDTH, east = eastDistance <= ROAD_HALF_WIDTH;
  return {
    onRoad: north || east, intersection: north && east,
    axis: northDistance <= eastDistance ? 'north' : 'east', northDistance, eastDistance,
    bridge: Boolean(cityRiverAt(u)) && eastDistance <= BRIDGE_HALF_WIDTH,
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
  const kind = positiveModulo(ix, RIVER_PERIOD) === RIVER_COLUMN ? 'river'
    : chance < .13 ? 'park' : chance < .2 ? 'plaza' : 'blocks';
  return { ix, iz, key: `${ix},${iz}`, seed, kind, district: cityDistrict((iz + .5) * CITY_BLOCK, (ix + .5) * CITY_BLOCK) };
}

export function cityHeight(s, u) {
  const street = cityStreetAt(s, u);
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
  looseness: (s, u) => cityStreetAt(s, u).onRoad ? 0 : .3,
  water: (s, u) => Boolean(cityRiverAt(u)) && !cityStreetAt(s, u).bridge,
};
