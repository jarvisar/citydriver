import { randomAt } from './route.js';

export const CITY_PLACES = Object.freeze({
  clock: { name: 'Founders Square', short: 'Clocktower', color: '#eac482', symbol: 'I', description: 'A copper clocktower above a sunken fountain court.' },
  market: { name: 'Lantern Market', short: 'Market hall', color: '#ee9a78', symbol: 'II', description: 'Striped stalls, warm lights, and a red-roofed market hall.' },
  garden: { name: 'Palm House', short: 'Botanical garden', color: '#a7cfaa', symbol: 'III', description: 'A glass conservatory tucked into a formal garden.' },
  depot: { name: 'Heritage Yard', short: 'Tram depot', color: '#8fbfce', symbol: 'IV', description: 'Retired red trams and the brick sheds of the old city line.' },
  art: { name: 'Prism Court', short: 'Sculpture garden', color: '#c6ade0', symbol: 'V', description: 'Bold sculptures, reflecting pools, and a little open-air gallery.' },
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
