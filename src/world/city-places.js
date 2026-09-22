import { randomAt, journeyStart } from './route.js';
import { cityRiverAxes } from './city-waterways.js';
import { cityLayout, cityLogical } from './city-layout.js';

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
  postoffice: { name: 'Central Post Office', short: 'Letters & parcels', color: '#e6b284', symbol: 'XVIII', description: 'A proud envelope crest, sorting-hall skylights and little postal vans.' },
  bathhouse: { name: 'Mosaic Baths', short: 'Pools & tiled pavilions', color: '#90c9c8', symbol: 'XIX', description: 'Terracotta vaults, turquoise pools and a quiet colonnaded terrace.' },
  farmersmarket: { name: 'Harvest Market', short: 'Farmers market & bakery', color: '#dfc68a', symbol: 'XX', description: 'Striped produce stalls, flower stands and a neighborhood bakery around a coffee courtyard.' },
  donut: { name: 'Lucky Donut', short: 'Donuts & fresh coffee', color: '#e6a2b3', symbol: 'XXI', description: 'A giant sprinkled donut crowns a pastel diner with display windows and a sunny coffee terrace.' },
  cityhall: { name: 'City Hall', short: 'Civic chambers & clocktower', color: '#d8c59d', symbol: 'XXII', description: 'The city’s one civic landmark: limestone columns, ceremonial steps and a copper clocktower.' },
});
export const PLACE_TYPES = Object.keys(CITY_PLACES);
export const LANDMARK_TYPES = PLACE_TYPES.filter(type => type !== 'park' && type !== 'plaza');
export const REPEATING_LANDMARK_TYPES = LANDMARK_TYPES.filter(type => type !== 'cityhall');
export const destinationType = block => block.landmark || (block.kind === 'park' || block.kind === 'plaza' ? block.kind : null);
const mod = (n, d) => ((n % d) + d) % d;

export const LANDMARK_SPACING = 4;
export const PUBLIC_SPACE_CHANCE = .03;

// One landmark in each four-by-four neighbourhood. Move a river selection
// to dry land so every neighbourhood has a destination, including negatives.
function repeatingLandmarkForBlock(ix, iz) {
  const span = LANDMARK_SPACING, rx = Math.floor(ix / span), rz = Math.floor(iz / span);
  let localX = Math.floor(randomAt(rx, rz + 7200) * span);
  let localZ = Math.floor(randomAt(rx, rz + 7201) * span);
  if (cityRiverAxes(rx * span + localX, rz * span + localZ).north) localX = (localX + 1) % span;
  if (cityRiverAxes(rx * span + localX, rz * span + localZ).east) localZ = (localZ + 1) % span;
  if (mod(ix, span) !== localX || mod(iz, span) !== localZ) return null;
  return REPEATING_LANDMARK_TYPES[Math.floor(randomAt(rx, rz + 7202) * REPEATING_LANDMARK_TYPES.length)];
}

// The car starts at this seeded WORLD position, not at logical block (0, 0).
// Randomly replace an existing POI 4–6 blocks away. If that ring has no POI,
// expand by two blocks until it does. Never consume an ordinary building plot.
export function chooseCityHallBlock({ start = { s: journeyStart(1).s, u: 2.4 },
  isPoi = (ix, iz) => Boolean(repeatingLandmarkForBlock(ix, iz)) || randomAt(ix, iz + 7103) < PUBLIC_SPACE_CHANCE } = {}) {
  const logical = cityLogical(start.s, start.u), B = 112;
  const cx = Math.floor(logical.u / B), cz = Math.floor(logical.s / B);
  for (let radius = 6; ; radius += 2) {
    const choices = [], reach = radius + 2;
    for (let ix = cx - reach; ix <= cx + reach; ix++) for (let iz = cz - reach; iz <= cz + reach; iz++) {
      const river = cityRiverAxes(ix, iz); if (river.north || river.east) continue;
      if (!isPoi(ix, iz)) continue;
      const p = cityLayout((iz + .5) * B, (ix + .5) * B), distance = Math.hypot(p.s - start.s, p.u - start.u);
      if (distance >= B * 4 && distance <= B * radius) choices.push({ ix, iz });
    }
    if (choices.length) return Object.freeze(choices[Math.floor(randomAt(9321, 7419) * choices.length)]);
  }
}
export const CITY_HALL_BLOCK = chooseCityHallBlock();
export function landmarkForBlock(ix, iz) {
  if (ix === CITY_HALL_BLOCK.ix && iz === CITY_HALL_BLOCK.iz) return 'cityhall';
  return repeatingLandmarkForBlock(ix, iz);
}
