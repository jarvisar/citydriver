import { randomAt } from './route.js';
import { plainsGroundHeight, plainsCreekAt, pondsNear, creekDistance } from './plains-route.js';
import { PLAINS_RAIL_REACH, plainsRailPath, plainsRailClears } from './plains-railway.js';
import { createDiscoverySchedule } from './discovery-schedule.js';

// Approximate miles between sightings of EACH kind. Lower = more frequent.
// Edit one number, then reload. Infinity disables a kind. Together: ~2.5 miles.
export const PLAINS_DISCOVERY_MILES = {
  farmstead: 15, // Full farm, including its windmill and tractor.
  farmhouse: 30,
  'barn-silo': 30,
  'grain-elevator': 10, // Includes its railway siding.
  'wind-turbines': 6, // A group of three.
};
// Larger compounds and rail spurs have fewer suitable sites.
const schedule = createDiscoverySchedule(PLAINS_DISCOVERY_MILES,
  { farmstead: .72, farmhouse: .95, 'barn-silo': .90, 'grain-elevator': .68, 'wind-turbines': .86 }, 2901, districtSite);
export const PLAINS_DISCOVERY_SPACING = schedule.spacing;
export const TURBINE_SPACING = 88;

// A compound faces the road across a straight drive; the drive is at one end
// of the yard so the buildings are not hidden behind it from the fixed view.
function districtSite(kind, index, desired) {
  let site = null;
  const farm = ['farmstead', 'farmhouse', 'barn-silo'].includes(kind);
  // The creek wanders a good hundred metres from its crossing out in the
  // fields, and a row of turbines is nearly two hundred metres long.
  const creekRoom = kind === 'wind-turbines' ? 270 : 170;
  // The elevator and the turbines stand on the far side, where their height
  // cannot come between the camera and the road. A farm takes either side,
  // alternating the preferred side in sets of three districts.
  const side = farm ? (Math.floor(index / 3) % 2 ? 1 : -1) : 1;
  // Keep the old 66 m maximum, and never move an existing farm farther
  // away for the same random draw. Smaller yards can fit nearer the road.
  const nearest = kind === 'farmstead' ? 34 : kind === 'farmhouse' ? 26 : 29;
  const cross = farm ? nearest + randomAt(index, 2905) * (66 - nearest) : kind === 'grain-elevator' ? 36 + randomAt(index, 2905) * 12 : 60 + randomAt(index, 2905) * 18;
  const halfS = kind === 'farmstead' ? 30 : kind === 'farmhouse' ? 19 : kind === 'barn-silo' ? 23 : kind === 'grain-elevator' ? 19 : TURBINE_SPACING + 20;
  const halfU = kind === 'farmstead' ? 21 : kind === 'farmhouse' ? 14 : kind === 'barn-silo' ? 16 : kind === 'grain-elevator' ? 13 : 26;
  const offsets = [0, 80, -80, 160, -160, 240, -240, 320, -320];
  // A railway needs a longer dry corridor; try the gaps between the usual
  // sites before giving up its district, without widening the search area.
  if (kind === 'grain-elevator') offsets.push(40, -40, 120, -120, 200, -200, 280, -280);
  for (const offset of offsets) {
    const s = desired + offset, u = side * cross;
    if (Math.abs(s - plainsCreekAt(s).center) < creekRoom) continue;
    const towers = kind === 'wind-turbines'
      ? [-1, 0, 1].map(k => ({ s: s + k * TURBINE_SPACING, u: u + (randomAt(index, 2906 + k) - .5) * 24 })) : null;
    const spots = towers ?? [{ s, u }];
    const drive = (randomAt(index, 2907) > .5 ? 1 : -1) * (halfS - 12);
    // Reserve dry ground before committing to a site. Terrain flatness
    // alone can accept a pond's flat floor or a footing on its bank.
    // Include banks and planting, each tower, yards, drives, and rail spurs.
    const dryRectangle = (centerS, centerU, reachS, reachU) => pondsNear(centerS).every(pond => {
      const ds = Math.max(0, Math.abs(pond.s - centerS) - reachS);
      const du = Math.max(0, Math.abs(pond.u - centerU) - reachU);
      const bank = pond.radius * Math.sqrt(pond.stretch) * 1.14 * 1.65 + 5;
      return Math.hypot(ds, du) > bank;
    });
    if (towers ? !towers.every(tower => dryRectangle(tower.s, tower.u, 9, 9))
      : !dryRectangle(s, u, halfS + 4, halfU + 6)
        || !dryRectangle(s + drive, side * (cross + 6) / 2, 5, (cross - 6) / 2)) continue;
    if (kind === 'grain-elevator') {
      const candidate = { s, u, side, halfU };
      let clear = true;
      for (let ds = -PLAINS_RAIL_REACH; ds < PLAINS_RAIL_REACH; ds += 4) {
        const rail = plainsRailPath(candidate, s + ds), end = plainsRailPath(candidate, s + ds + 4);
        if (!dryRectangle((rail.s + end.s) / 2, (rail.u + end.u) / 2, Math.abs(end.s - rail.s) / 2 + 5, Math.abs(end.u - rail.u) / 2 + 5)
          || creekDistance(rail.s, rail.u) < 20) {
          clear = false; break;
        }
      }
      if (!clear) continue;
    }
    // The ground a site needs level is the ground its buildings stand on,
    // which is not the whole of what it keeps clear: a farm's yard reaches
    // well past its own buildings, and a swell out at the edge of it is
    // nothing to a farm.
    const build = towers ? { s: 6, u: 6 } : { s: Math.min(halfS, 23), u: Math.min(halfU, 18) };
    const level = spots.every(spot => {
      const heights = [-1, 0, 1].flatMap(ds => [-1, 0, 1].map(du =>
        plainsGroundHeight(spot.s + ds * build.s, spot.u + du * build.u)));
      return Math.max(...heights) - Math.min(...heights) < (towers ? 3 : 2.6);
    });
    if (!level) continue;
    site = { kind, index, s, u, side, halfS, halfU, build };
    if (towers) site.towers = towers;
    // The drive comes in toward one end of the yard, but not so near the
    // end that the gap it needs in the fence takes the corner post with it.
    else site.drive = drive;
    break;
  }
  return site;
}

export const plainsDiscoveries = schedule.discoveries;

// Keeps fences, hedges, bales and trees off a compound, its drive, and the
// footing of every turbine; the fields between the turbines stay farmed.
export function plainsDiscoveryClears(s, u, discoveries, radius = 0) {
  return discoveries.every(site => {
    if (site.towers) return site.towers.every(tower => Math.hypot(s - tower.s, u - tower.u) > 9 + radius);
    if (site.kind === 'grain-elevator' && !plainsRailClears(s, u, site, radius)) return false;
    if (Math.abs(s - site.s) < site.halfS + radius + 2 && Math.abs(u - site.u) < site.halfU + radius + 2) return false;
    const onDrive = Math.abs(s - site.s - site.drive) < 3 + radius && u * site.side > 6 - radius && u * site.side < Math.abs(site.u);
    return !onDrive;
  });
}
