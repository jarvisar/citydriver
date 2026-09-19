// Run after editing a scene's *_DISCOVERY_MILES table:
// node scripts/discovery-frequency.mjs [route miles, default 2000]
// TEST_WORLD_SEED selects a different reproducible world (default 4817).
const seed = process.env.TEST_WORLD_SEED ?? '4817';
globalThis.location = new URL(`http://localhost/?seed=${seed}`);
const miles = Number(process.argv[2] ?? 2000);
if (!Number.isFinite(miles) || miles <= 0) throw new RangeError('Route miles must be positive');
const { METERS_PER_MILE } = await import('../src/world/discovery-schedule.js');
const { roadFrame } = await import('../src/world/route.js');
const length = miles * METERS_PER_MILE;
// Match the odometer: the road's gentle bends make driving distance slightly
// longer than the longitudinal coordinates used by the placement functions.
let driven = 0;
for (let s = -length / 2; s < length / 2; s += 32) {
  const step = Math.min(32, length / 2 - s);
  driven += roadFrame(s + step / 2).scale * step / METERS_PER_MILE;
}
const rows = [];
for (const scene of ['coastal', 'desert', 'snow', 'jungle', 'plains', 'city']) {
  const mod = await import(`../src/world/${scene}-discoveries.js`);
  const targets = mod[`${scene.toUpperCase()}_DISCOVERY_MILES`];
  const sites = mod[`${scene}Discoveries`](-length / 2, length / 2).filter(site => site.kind !== 'parrots');
  for (const [kind, target] of Object.entries(targets)) {
    const count = sites.filter(site => site.kind === kind).length;
    rows.push({ scene, discovery: kind, target, count, 'average miles': +(driven / count).toFixed(2) });
  }
  rows.push({ scene, discovery: 'ANY (birds excluded)', target: +(1 / Object.values(targets).reduce((sum, gap) => sum + 1 / gap, 0)).toFixed(2), count: sites.length, 'average miles': +(driven / sites.length).toFixed(2) });
}
if (process.argv.includes('--json')) console.log(JSON.stringify({ seed, drivenMiles: driven, rows }));
else {
  console.log(`Seed ${seed}; ${Math.round(driven)} driven miles per scene. Averages, not guaranteed gaps.`);
  console.table(rows);
}
