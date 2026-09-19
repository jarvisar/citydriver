import { randomAt } from './route.js';
import { blockBoundary, blockAt, crossStreetAt, nearStreet, quayOffset, STREET_HALF_WIDTH, FAR_BANK_TOP, BANDS, BANK_BANDS } from './city-route.js';

// Three landmarks in shuffled districts, as on the plains: a road bridge
// carrying a side street over the river to the far bank, a park square that
// takes the place of two rows of buildings, and a clock tower church on the
// building line. Each site is a rectangle in (s, u) that the ordinary blocks,
// trees and furniture keep out of.
export const CITY_DISCOVERY_SPACING = 5120;
const sites = new Map();

function districtSite(index) {
  if (sites.has(index)) return sites.get(index);
  let site = null;
  if (randomAt(index, 3101) > .18) {
    const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    const order = orders[Math.floor(randomAt(Math.floor(index / 3), 3102) * orders.length)];
    const kind = ['river-bridge', 'square', 'clock-tower'][order[((index % 3) + 3) % 3]];
    const desired = index * CITY_DISCOVERY_SPACING + 2560 + (randomAt(index, 3103) - .5) * 1536;
    if (kind === 'river-bridge') {
      // The bridge continues a side street that already runs down to the quay.
      const nearest = crossStreetAt(desired).index;
      for (const offset of [0, 1, -1, 2, -2, 3, -3]) {
        const street = nearest + offset;
        if (!nearStreet(street)) continue;
        const s = blockBoundary(street);
        site = { kind, index, street, s, u: (quayOffset(s) + FAR_BANK_TOP) / 2, side: -1, halfS: STREET_HALF_WIDTH, u0: BANK_BANDS[1].back - 4, u1: -6.6 };
        break;
      }
    } else if (kind === 'square') {
      // A square needs a long block: two rows of buildings give way to lawn.
      for (const offset of [0, 1, -1, 2, -2]) {
        const block = blockAt(desired) + offset, start = blockBoundary(block), end = blockBoundary(block + 1);
        if (end - start < 96) continue;
        const s = (start + end) / 2;
        site = { kind, index, block, s, u: (BANDS[0].front + BANDS[1].back) / 2, side: 1, halfS: (end - start) / 2 - STREET_HALF_WIDTH - 2, u0: BANDS[0].front - 1, u1: BANDS[1].back + 2 };
        break;
      }
    } else {
      // The church takes the first lot of a block, on the corner by the side street.
      const block = blockAt(desired), start = blockBoundary(block);
      const s = start + STREET_HALF_WIDTH + 3 + 14;
      site = { kind, index, block, s, u: BANDS[0].front + 13, side: 1, halfS: 10, u0: BANDS[0].front - 1, u1: BANDS[0].front + 27 };
    }
  }
  sites.set(index, site);
  if (sites.size > 128) sites.delete(sites.keys().next().value);
  return site;
}

export function cityDiscoveries(first, last) {
  const result = [];
  for (let index = Math.floor(first / CITY_DISCOVERY_SPACING) - 1; index <= Math.floor(last / CITY_DISCOVERY_SPACING) + 1; index++) {
    const site = districtSite(index);
    if (site && site.s >= first && site.s < last) result.push(site);
  }
  return result;
}

// Whether a point, or a lot, stays out of every site's rectangle.
export function cityDiscoveryClears(s, u, discoveries, radius = 0) {
  return discoveries.every(site => !(Math.abs(s - site.s) < site.halfS + radius && u > site.u0 - radius && u < site.u1 + radius));
}
export function cityLotClears(s0, s1, u0, u1, discoveries) {
  return discoveries.every(site => s1 <= site.s - site.halfS || s0 >= site.s + site.halfS || u1 <= site.u0 || u0 >= site.u1);
}

// Divide the available frontage before laying out lots. Rejecting an entire
// overlapping lot leaves unnecessary empty ground beside a small landmark.
export function cityBuildingSpans(s0, s1, u0, u1, discoveries) {
  let spans = [{ s0, s1 }];
  for (const site of discoveries) {
    if (u1 <= site.u0 || u0 >= site.u1) continue;
    const from = site.s - site.halfS - .7, to = site.s + site.halfS + .7;
    spans = spans.flatMap(span => {
      if (span.s1 <= from || span.s0 >= to) return [span];
      return [{ s0: span.s0, s1: Math.min(span.s1, from) }, { s0: Math.max(span.s0, to), s1: span.s1 }]
        .filter(part => part.s1 - part.s0 > 9);
    });
  }
  return spans;
}
