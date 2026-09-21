import { randomAt } from './route.js';

export const CITY_PLACES = Object.freeze({
  clock: { name: 'Clocktower', short: 'Clocktower', color: '#eac482', symbol: 'I', description: 'Clocktower and fountains.' },
  market: { name: 'Market', short: 'Market hall', color: '#ee9a78', symbol: 'II', description: 'Market hall and stalls.' },
  garden: { name: 'Gardens', short: 'Botanical garden', color: '#a7cfaa', symbol: 'III', description: 'Glasshouse and gardens.' },
  depot: { name: 'Tram Depot', short: 'Tram depot', color: '#8fbfce', symbol: 'IV', description: 'Trams and workshops.' },
  art: { name: 'Sculpture Park', short: 'Sculpture garden', color: '#c6ade0', symbol: 'V', description: 'Sculptures and pools.' },
});
export const PLACE_TYPES = Object.keys(CITY_PLACES);
const mod = (n, d) => ((n % d) + d) % d;

// One landmark in each three-by-three neighbourhood. Move a river selection
// to dry land so every neighbourhood has a destination, including negatives.
export function landmarkForBlock(ix, iz) {
  const rx = Math.floor(ix / 3), rz = Math.floor(iz / 3);
  let localX = Math.floor(randomAt(rx, rz + 7200) * 3);
  const localZ = Math.floor(randomAt(rx, rz + 7201) * 3);
  if (mod(rx * 3 + localX, 7) === 3) localX = (localX + 1) % 3;
  if (mod(ix, 3) !== localX || mod(iz, 3) !== localZ) return null;
  return PLACE_TYPES[Math.floor(randomAt(rx, rz + 7202) * PLACE_TYPES.length)];
}
