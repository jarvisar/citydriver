import { randomAt, headlandCenter, coastOffset, shorelineOffset, beachWidth, bridgeAt, overlookAt, groundHeight } from './route.js';
import { createDiscoverySchedule } from './discovery-schedule.js';

// Approximate miles between sightings of EACH kind. Lower = more frequent.
// Edit one number, then reload. Infinity disables a kind. Together: ~2.5 miles.
export const COASTAL_DISCOVERY_MILES = {
  lighthouse: 6, // Includes the keeper's cottage.
  dock: 6, // Includes the moored rowboat.
  whale: 15,
};
const schedule = createDiscoverySchedule(COASTAL_DISCOVERY_MILES,
  { lighthouse: .99, dock: .98, whale: 1 }, 2101, districtSite);
export const COASTAL_DISCOVERY_SPACING = schedule.spacing;
// Gulls retain their original chunk schedule in environment.js / birds.js.

function clearHeadland(s) {
  const overlook = overlookAt(s);
  return coastOffset(s) < -48 && Math.abs(s - bridgeAt(s).center) > 110
    && (!overlook.enabled || Math.abs(s - overlook.center) > 110);
}
function towerSite(index, desired) {
  const first = Math.round((desired - 80) / 176);
  for (const offset of [0, -1, 1, -2, 2]) {
    const s = headlandCenter(first + offset), u = coastOffset(s) + 23;
    if (!clearHeadland(s) || u > -27) continue;
    const heights = [-5, 5].flatMap(ds => [-5, 5].map(du => groundHeight(s + ds, u + du)));
    if (Math.max(...heights) - Math.min(...heights) > 3.4) continue;
    return { kind: 'lighthouse', index, s, u, radius: 18 };
  }
  return null;
}
function dockSite(index, desired) {
  // Look for a broad beach near the district's own anchor, independently of
  // bridges and tidal inlets. Empty districts still leave long quiet stretches.
  const direction = randomAt(index, 2113) > .5 ? 1 : -1;
  for (const offset of [0, 64, -64, 128, -128, 192, -192]) {
    const s = desired + offset * direction;
    if (beachWidth(s) < 16) continue;
    // A landing needs dry sand at its shore end and a reasonably straight
    // waterline across its width. Avoid the submerged floor of a ravine.
    const shore = shorelineOffset(s);
    if ([-4, 0, 4].some(ds => groundHeight(s + ds, shore + 7) < .8
      || Math.abs(shorelineOffset(s + ds) - shore) > 2.5)) continue;
    return { kind: 'dock', index, s, u: shorelineOffset(s) + 3.5, radius: 23 };
  }
  return null;
}
function districtSite(kind, index, desired) {
  if (kind === 'lighthouse') return towerSite(index, desired);
  if (kind === 'dock') return dockSite(index, desired);
  return { kind, index, s: desired, u: shorelineOffset(desired) - 68, radius: 22 };
}

export const coastalDiscoveries = schedule.discoveries;

export function discoveryClearsPlanting(s, u, sites) {
  return sites.every(site => {
    if (site.kind === 'lighthouse') {
      const ds = Math.abs(s - site.s);
      // Protect both the compound and the narrow paved pedestrian approach.
      return !(Math.hypot(s - site.s, u - site.u) < 18 || (ds < 4.5 && u >= site.u && u < -7));
    }
    if (site.kind === 'dock') return Math.hypot(s - site.s, u - site.u) > 24;
    return true;
  });
}
