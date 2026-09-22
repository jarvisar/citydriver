export const RIVER_PERIOD = 7;
export const RIVER_COLUMN = 3;
export const CROSS_RIVER_PERIOD = 13;
export const CROSS_RIVER_ROW = 5;
export const RIVER_MARGIN = 28;
const mod = (n, d) => ((n % d) + d) % d;

export function cityRiverAxes(ix, iz) {
  return { north: mod(ix, RIVER_PERIOD) === RIVER_COLUMN, east: mod(iz, CROSS_RIVER_PERIOD) === CROSS_RIVER_ROW };
}

export function logicalWaterAt(s, u) {
  const ix = Math.floor(u / 112), iz = Math.floor(s / 112), axes = cityRiverAxes(ix, iz);
  const x = u - ix * 112, z = s - iz * 112;
  const north = axes.north && x >= RIVER_MARGIN && x <= 112 - RIVER_MARGIN;
  const east = axes.east && z >= RIVER_MARGIN && z <= 112 - RIVER_MARGIN;
  return north || east ? { ix, iz, north, east, axis: north && east ? 'confluence' : north ? 'north' : 'east' } : null;
}
