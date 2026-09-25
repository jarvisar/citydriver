import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { CITY_HALL_BLOCK, REPEATING_LANDMARK_TYPES, chooseCityHallBlock, landmarkForBlock, PUBLIC_SPACE_CHANCE } from '../src/world/city-places.js';
import { cityBlock, CITY_BLOCK as B } from '../src/world/city-grid.js';
import { cityLayout } from '../src/world/city-layout.js';
import { cityRiverAxes } from '../src/world/city-waterways.js';
import { journeyStart, randomAt } from '../src/world/route.js';
import { CityExploration, nearbyPlaces } from '../src/city-exploration.js';

test('City Hall replaces one existing POI 4–6 blocks from the actual seeded spawn', () => {
  const { ix, iz } = CITY_HALL_BLOCK, start = { s: journeyStart(1).s, u: 2.4 };
  assert.deepEqual(chooseCityHallBlock(), CITY_HALL_BLOCK);
  assert.ok(!REPEATING_LANDMARK_TYPES.includes('cityhall'));
  const place = nearbyPlaces(start.s, start.u).find(p => p.type === 'cityhall');
  assert.ok(place);
  const distance = Math.hypot(place.s - start.s, place.u - start.u) / B;
  assert.ok(distance >= 4 && distance <= 6, `distance ${distance}`);
  assert.equal(cityBlock(ix, iz).landmark, 'cityhall');
  assert.deepEqual(cityRiverAxes(ix, iz), { north: false, east: false });
  // Recompute the site's original allocation independently of the source.
  const rx = Math.floor(ix / 4), rz = Math.floor(iz / 4);
  let x = Math.floor(randomAt(rx, rz + 7200) * 4), z = Math.floor(randomAt(rx, rz + 7201) * 4);
  if (cityRiverAxes(rx * 4 + x, rz * 4 + z).north) x = (x + 1) % 4;
  if (cityRiverAxes(rx * 4 + x, rz * 4 + z).east) z = (z + 1) % 4;
  assert.ok((rx * 4 + x === ix && rz * 4 + z === iz) || randomAt(ix, iz + 7103) < PUBLIC_SPACE_CHANCE, 'the previous site was a landmark, park or plaza');
  let copies = 0;
  for (let x = ix - 90; x <= ix + 90; x++) for (let z = iz - 90; z <= iz + 90; z++) {
    if (landmarkForBlock(x, z) === 'cityhall') copies++;
  }
  assert.equal(copies, 1);
});

test('City Hall expands its search when the first ring has no POIs', () => {
  const start = cityLayout(0, 0), visited = [];
  const result = chooseCityHallBlock({ start, isPoi: (x, z) => {
    visited.push([x, z]); return x === 0 && z === 7;
  } });
  assert.deepEqual(result, { ix: 0, iz: 7 });
  const p = cityLayout(7.5 * B, .5 * B);
  assert.ok(Math.hypot(p.s - start.s, p.u - start.u) > 6 * B);
  assert.ok(visited.length > 100);
});

test('a distant notebook selection routes back to the same unique City Hall and retains old stamps', () => {
  const guide = new CityExploration({ getItem: () => '["clock","donut","farmersmarket"]' });
  assert.equal(guide.found.size, 3);
  const target = guide.next(45000, -19000, 'cityhall');
  assert.equal(target.id, `${CITY_HALL_BLOCK.ix},${CITY_HALL_BLOCK.iz}`);
  assert.ok(!guide.places.some(p => p.type === 'cityhall'), 'selection works outside the local map');
  guide.update(46000, -18000, false);
  assert.equal(guide.target.id, target.id, 'moving into another distant block does not lose the selected unique destination');
  guide.update(target.entrance.s, target.entrance.u);
  assert.ok(guide.found.has('cityhall'));
});

test('City Hall location varies between world seeds and remains near each seed’s spawn', () => {
  const results = [];
  for (const seed of [0, 1, 42, 2026, 4817, 19381, 8675309, 4294967295]) {
    const code = `globalThis.location = new URL('http://localhost/?seed=${seed}');
      const { CITY_HALL_BLOCK } = await import('./src/world/city-places.js');
      const { journeyStart } = await import('./src/world/route.js');
      const { cityLayout, cityLogical } = await import('./src/world/city-layout.js');
      const { ix, iz } = CITY_HALL_BLOCK, start = journeyStart(1);
      const p = cityLayout((iz + .5) * 112, (ix + .5) * 112), origin = cityLogical(start.s, 2.4);
      console.log(JSON.stringify({ distance: Math.hypot(p.s - start.s, p.u - 2.4) / 112, dx: ix - Math.floor(origin.u / 112), dz: iz - Math.floor(origin.s / 112) }));`;
    results.push(JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', cwd: new URL('..', import.meta.url), windowsHide: true })));
  }
  for (const p of results) assert.ok(p.distance >= 4 && p.distance <= 6);
  assert.ok(new Set(results.map(p => `${p.dx},${p.dz}`)).size >= 5, 'the site is not a fixed offset from spawn');
});
