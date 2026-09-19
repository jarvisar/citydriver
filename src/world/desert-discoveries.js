import { smoothstep } from './route.js';
import { desertBridgeAt, desertCreek, desertCreekDistance, desertHeight, canyonProfile, insideMesa, dryWashCenter, dryWashWidth } from './desert-route.js';
import { createDiscoverySchedule } from './discovery-schedule.js';

// Approximate miles between sightings of EACH kind. Lower = more frequent.
// Edit one number, then reload. Infinity disables a kind. Together: ~2.5 miles.
export const DESERT_DISCOVERY_MILES = {
  'fuel-stop': 7.5,
  windpump: 7.5,
  'cattle-skull': 7.5,
};
// Placement success measured across seeds; keep the terrain checks below.
const schedule = createDiscoverySchedule(DESERT_DISCOVERY_MILES,
  { 'fuel-stop': .60, windpump: .98, 'cattle-skull': .92 }, 2301, districtSite);
export const DESERT_DISCOVERY_SPACING = schedule.spacing;

export const DESERT_FUEL_APRON_HALF_LENGTH = 26;
export function desertFuelApronWidth(site, s) {
  return 5.5 + (Math.abs(site.u) - 10) * (1 - smoothstep(8, DESERT_FUEL_APRON_HALF_LENGTH, Math.abs(s-site.s)));
}

function districtSite(kind, index, desired) {
  let site = null;
  const halfS = kind === 'fuel-stop' ? 9 : kind === 'cattle-skull' ? 3 : 7, halfU = kind === 'fuel-stop' ? 8 : kind === 'cattle-skull' ? 3 : 6;
  search: for (const offset of [0, 80, -80, 160, -160, 240, -240]) {
    const s = desired + offset;
    if (Math.abs(s - desertBridgeAt(s).center) < 130) continue;
    const firstSide = desertCreek(s).center < 0 ? 1 : -1;
    for (const side of [firstSide, -firstSide]) for (const cross of (kind === 'cattle-skull' ? [22, 26] : [26, 34, 42])) {
      const u = side * cross;
      const samples = [-halfS, 0, halfS].flatMap(ds => [-halfU, 0, halfU].map(du => [s + ds, u + du]));
      if (samples.some(([t, v]) => Math.abs(v) < 18 || Math.abs(v) > canyonProfile(t, side).foot - 10
        || desertCreekDistance(t, v) < 6 || Math.abs(v - dryWashCenter(t)) < dryWashWidth(t) + 1.5
        || insideMesa(t, v, 1.4))) continue;
      const heights = samples.map(([t, v]) => desertHeight(t, v));
      if (Math.max(...heights) - Math.min(...heights) > (kind === 'fuel-stop' ? 1.8 : 2.1)) continue;
      if (kind === 'fuel-stop') {
        let blocked = false;
        for (let ds=-26;ds<=26;ds+=2) for (let cross=7;cross<desertFuelApronWidth({s,u},s+ds)+1;cross+=2) {
          if (desertCreekDistance(s+ds,side*cross)<6 || insideMesa(s+ds,side*cross,1.4)
            || Math.abs(side*cross-dryWashCenter(s+ds))<dryWashWidth(s+ds)+1) blocked=true;
        }
        if (blocked) continue;
      }
      site = {kind, index, s, u, side, halfS, halfU};
      break search;
    }
  }
  return site;
}

export const desertDiscoveries = schedule.discoveries;

export function desertDiscoveryClears(s, u, discoveries, radius = 0) {
  return discoveries.every(site => {
    const along = Math.abs(s - site.s);
    if (along < site.halfS+radius+2 && Math.abs(u-site.u)<site.halfU+radius+2) return false;
    const nearestS=site.s+Math.sign(s-site.s)*Math.max(0,along-radius-2);
    return site.kind!=='fuel-stop' || along>DESERT_FUEL_APRON_HALF_LENGTH+radius+2
      || u*site.side<5.5-radius || u*site.side>desertFuelApronWidth(site,nearestS)+radius+2;
  });
}
