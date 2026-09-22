import { randomAt } from './route.js';
import { cityRiverAxes } from './city-waterways.js';

export const CITY_PLACES = Object.freeze({
  clock: { name: 'Clocktower', short: 'Clocktower', color: '#eac482', symbol: 'I', description: 'Clocktower and fountains.' },
  market: { name: 'Market', short: 'Market hall', color: '#ee9a78', symbol: 'II', description: 'Market hall and stalls.' },
  garden: { name: 'Gardens', short: 'Botanical garden', color: '#a7cfaa', symbol: 'III', description: 'Glasshouse and gardens.' },
  depot: { name: 'Tram Depot', short: 'Tram depot', color: '#8fbfce', symbol: 'IV', description: 'Trams and workshops.' },
  art: { name: 'Sculpture Park', short: 'Sculpture garden', color: '#c6ade0', symbol: 'V', description: 'Sculptures and pools.' },
  cinema: { name: 'Rivoli Cinema', short: 'Movies & matinees', color: '#ef997e', symbol: 'VI', description: 'A glowing marquee, poster walls and a little ticket booth.' },
  hotel: { name: 'Grand Hotel', short: 'Hotel & roof terrace', color: '#e8c477', symbol: 'VII', description: 'A copper crown above a grand entrance and garden terrace.' },
  museum: { name: 'City Museum', short: 'Art & architecture', color: '#e1b18b', symbol: 'VIII', description: 'A colonnaded museum with a sculpture forecourt.' },
  station: { name: 'Union Station', short: 'Railway terminal', color: '#94c9c7', symbol: 'IX', description: 'A vaulted train shed, platforms and a station clock.' },
  library: { name: 'Central Library', short: 'Books & reading garden', color: '#b5c798', symbol: 'X', description: 'A lantern of glass above a quiet, planted reading court.' },
  hospital: { name: 'City Hospital', short: 'Hospital & healing garden', color: '#a4d8d0', symbol: 'XI', description: 'Pale wings, a red cross and a sheltered patient entrance.' },
  observatory: { name: 'Star Observatory', short: 'Planetarium & stargazing', color: '#a7b5e5', symbol: 'XII', description: 'A copper dome and telescope in a celestial garden.' },
  music: { name: 'Blue Note Club', short: 'Live music & courtyard', color: '#d5a3cb', symbol: 'XIII', description: 'A neon jazz club with a piano facade and courtyard stage.' },
  sports: { name: 'Athletic Club', short: 'Courts & clubhouse', color: '#b9cf85', symbol: 'XIV', description: 'Colorful courts, a grandstand and a neighborhood clubhouse.' },
  firehouse: { name: 'Engine House', short: 'Historic fire station', color: '#e99883', symbol: 'XV', description: 'Red engine doors, a hose tower and a heritage fire engine.' },
  park: { name: 'Neighborhood Gardens', short: 'Ponds, orchards & walks', color: '#aac793', symbol: 'XVI', description: 'A green retreat, with a different garden around each corner.' },
  plaza: { name: 'City Squares', short: 'Fountains & terraces', color: '#dfc6a0', symbol: 'XVII', description: 'Meet at a fountain, an outdoor cafe or a mosaic promenade.' },
});
export const PLACE_TYPES = Object.keys(CITY_PLACES);
export const LANDMARK_TYPES = PLACE_TYPES.filter(type => type !== 'park' && type !== 'plaza');
export const destinationType = block => block.landmark || (block.kind === 'park' || block.kind === 'plaza' ? block.kind : null);
const mod = (n, d) => ((n % d) + d) % d;

export const LANDMARK_SPACING = 4;

// One landmark in each four-by-four neighbourhood. Move a river selection
// to dry land so every neighbourhood has a destination, including negatives.
export function landmarkForBlock(ix, iz) {
  const span = LANDMARK_SPACING, rx = Math.floor(ix / span), rz = Math.floor(iz / span);
  let localX = Math.floor(randomAt(rx, rz + 7200) * span);
  let localZ = Math.floor(randomAt(rx, rz + 7201) * span);
  if (cityRiverAxes(rx * span + localX, rz * span + localZ).north) localX = (localX + 1) % span;
  if (cityRiverAxes(rx * span + localX, rz * span + localZ).east) localZ = (localZ + 1) % span;
  if (mod(ix, span) !== localX || mod(iz, span) !== localZ) return null;
  return LANDMARK_TYPES[Math.floor(randomAt(rx, rz + 7202) * LANDMARK_TYPES.length)];
}
