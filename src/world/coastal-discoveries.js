import { randomAt, headlandCenter, coastOffset, shorelineOffset, beachWidth, bridgeAt, overlookAt, groundHeight } from './route.js';

// Distances are world meters. Jittered districts give guaranteed breathing
// room, independent of chunk load order, driving direction, and world origin.
// A modest increase for the multi-kilometer landmarks; site suitability and
// the quiet stretches around each encounter still apply.
const FREQUENCY = 1.5625;
export const DISCOVERY_SPACING = { lighthouse: 12288 / FREQUENCY, dock: 7168 / FREQUENCY, whale: 20480 / FREQUENCY };

function clearHeadland(s) {
  const overlook = overlookAt(s);
  return coastOffset(s) < -48 && Math.abs(s - bridgeAt(s).center) > 110
    && (!overlook.enabled || Math.abs(s - overlook.center) > 110);
}
function towerSite(index) {
  const desired = (index + .5) * DISCOVERY_SPACING.lighthouse + (randomAt(index, 2101) - .5) * 3584 / FREQUENCY;
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
function dockSite(index) {
  // Look for a broad beach near the district's own anchor, independently of
  // bridges and tidal inlets. Empty districts still leave long quiet stretches.
  if (randomAt(index, 2111) < .24) return null;
  const desired = (index + .5) * DISCOVERY_SPACING.dock + (randomAt(index, 2112) - .5) * 1536 / FREQUENCY;
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
export function coastalDiscoveries(first, last) {
  const structures = [];
  for (const [kind, create] of [['lighthouse', towerSite], ['dock', dockSite]]) {
    const spacing = DISCOVERY_SPACING[kind];
    for (let i = Math.floor(first / spacing) - 1; i <= Math.floor(last / spacing) + 1; i++) {
      const site = create(i);
      if (site && site.s >= first && site.s < last) structures.push(site);
    }
  }
  // A lighthouse gets a quiet stretch of its own, even if a dock district
  // happens to overlap it. Include neighboring districts in this decision.
  const filtered = structures.filter(site => site.kind !== 'dock' || [-1, 0, 1].every(offset => {
    const tower = towerSite(Math.floor(site.s / DISCOVERY_SPACING.lighthouse) + offset);
    return !tower || Math.abs(tower.s - site.s) > 900;
  }));
  for (let i = Math.floor(first / DISCOVERY_SPACING.whale) - 1; i <= Math.floor(last / DISCOVERY_SPACING.whale) + 1; i++) {
    const s = (i + .5) * DISCOVERY_SPACING.whale + (randomAt(i, 2131) - .5) * 4096 / FREQUENCY;
    if (s < first || s >= last || randomAt(i, 2132) < .15) continue;
    if (coastalStructuresNear(s).some(other => Math.abs(other.s - s) < 700)) continue;
    filtered.push({ kind: 'whale', index: i, s, u: shorelineOffset(s) - 68, radius: 22 });
  }
  return filtered.sort((a, b) => a.s - b.s);
}
function coastalStructuresNear(s) {
  const result = [];
  for (const [kind, create] of [['lighthouse', towerSite], ['dock', dockSite]]) {
    const index = Math.floor(s / DISCOVERY_SPACING[kind]);
    for (const offset of [-1, 0, 1]) { const site = create(index + offset); if (site) result.push(site); }
  }
  return result;
}

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
