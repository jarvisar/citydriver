import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { resolveWorldSeed, freshSceneStart } from '../src/world/generation.js';
import { journeyStart } from '../src/world/route.js';
import { citydriverRoute } from '../src/world/city-grid.js';
import { DrivingController } from '../src/vehicle.js';

test('world seeds use fresh entropy and accept reproducible unsigned URL seeds', () => {
  let next = 80;
  const entropy = () => next++;
  assert.equal(resolveWorldSeed('', entropy), 80);
  assert.equal(resolveWorldSeed('', entropy), 81);
  for (const seed of [0, 1, 4817, 0xffffffff]) assert.equal(resolveWorldSeed(`?seed=${seed}`, entropy), seed);
  assert.equal(next, 82);
  for (const value of ['', '-1', '1.5', 'abc', '4294967296', 'Infinity', ' 12']) {
    const before = next;
    assert.equal(resolveWorldSeed(`?seed=${encodeURIComponent(value)}`, entropy), before);
    assert.equal(next, before + 1);
  }
  const fresh = resolveWorldSeed();
  assert.ok(Number.isInteger(fresh) && fresh >= 0 && fresh <= 0xffffffff);
});

test('reset picks a fresh district beyond resident blocks with zero mileage', () => {
  for (const currentS of [-100000, -20000, -1, 0, 1, 20000, 100000]) {
    for (const random of [0, .00001, .25, .49999, .5, .50001, .75, .99999]) {
      const state = freshSceneStart(currentS, () => random);
      assert.equal(state.distance, 0);
      assert.ok(Number.isInteger(state.s) && state.s >= -20000 && state.s < 20000);
      assert.ok(Math.abs(state.s - currentS) >= 2048);
    }
  }
});

test('city starts grounded and reset preserves the chosen area', () => {
  const state = journeyStart(1);
  assert.deepEqual(state, journeyStart(1));
  const car = new DrivingController(citydriverRoute, state);
  try {
    assert.equal(car.s, state.s); assert.equal(car.distance, 0); assert.equal(car.speed, 0);
    assert.ok(Math.abs(car.car.position.y - citydriverRoute.height(car.s, car.u) - .13) < 1e-8);
    for (let i = 0; i < 600; i++) car.update(1 / 60, { forward: true });
    assert.ok(car.distance > 100);
    const saved = { s: car.s, distance: car.distance };
    car.setRoute(citydriverRoute, freshSceneStart(car.s));
    car.setRoute(citydriverRoute, saved);
    assert.equal(car.s, saved.s); assert.equal(car.distance, saved.distance); assert.equal(car.speed, 0);
  } finally { car.disposeModel(); }
});

function sampleWorld(seed) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      globalThis.location = { search: '?seed=' + workerData.seed };
      (async () => {
        const route = await import(workerData.routeUrl);
        const city = await import(workerData.cityUrl);
        const plans = [];
        for (const ix of [-100, -9, -1, 0, 1, 3, 9, 100]) for (const iz of [-100, -1, 0, 1, 100]) plans.push(city.cityBlock(ix, iz));
        parentPort.postMessage({ seed: route.SEED, start: route.journeyStart(), plans });
      })().catch(error => { throw error; });
    `, { eval: true, execArgv: [], workerData: { seed,
      routeUrl: new URL('../src/world/route.js', import.meta.url).href,
      cityUrl: new URL('../src/world/city-grid.js', import.meta.url).href } });
    worker.once('message', resolve); worker.once('error', reject);
    worker.once('exit', code => { if (code !== 0) reject(new Error(`World sampler exited with ${code}`)); });
  });
}

test('reloading a seed reproduces the city; different seeds change districts and lots', async () => {
  let previous;
  for (const seed of [0, 1, 4817, 8675309, 0xffffffff]) {
    const world = await sampleWorld(seed);
    assert.equal(world.seed, seed);
    assert.deepEqual(world, await sampleWorld(seed));
    if (previous) { assert.notDeepEqual(world.plans, previous.plans); assert.notDeepEqual(world.start, previous.start); }
    previous = world;
  }
});
