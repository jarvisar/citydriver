import test from 'node:test';
import assert from 'node:assert/strict';
import { LaneChange } from '../src/lane-change.js';
import { Autodrive } from '../src/autodrive.js';
import { DrivingController } from '../src/vehicle.js';

const route = {
  frame: () => ({ angle: 0, scale: 1 }),
  position: (s, u) => ({ x: u, y: 0, z: -s }),
  height: () => 0, bounds: () => [-4.65, 4.65],
};

test('lane changes enter and leave parallel to the road with continuous curvature', () => {
  const player = new DrivingController(route, { s: 0 }); player.speed = 28;
  const path = new LaneChange(player, -2.4);
  assert.deepEqual(path.sample(0), { u: 2.4, slope: 0, curvature: 0 });
  assert.deepEqual(path.sample(path.length), { u: -2.4, slope: 0, curvature: 0 });
  assert.deepEqual(path.sample(path.length + 100), path.sample(path.length));
  let previous = 2.4;
  for (let i = 0; i <= 100; i++) {
    const { u } = path.sample(path.length * i / 100);
    assert.ok(u <= previous + 1e-9 && u >= -2.4 - 1e-9, 'one smooth crossing with no overshoot');
    previous = u;
  }
  for (const fraction of [.1, .3, .5, .7, .9]) {
    player.distance = path.length * fraction;
    const before = path.sample(player.distance); player.u = before.u;
    const returning = new LaneChange(player, 2.4, path).sample(player.distance);
    for (const key of ['u', 'slope', 'curvature']) assert.ok(Math.abs(returning[key] - before[key]) < 1e-12, `retargeting preserves ${key}`);
  }
  player.disposeModel();
});

test('a stopped car holds its place on the curve and zero-time updates do not advance it', () => {
  const player = new DrivingController(route, { s: 0 }); player.u = 0; player.update(0, {});
  const auto = new Autodrive(), traffic = { enabled: false };
  const position = player.car.position.clone(), heading = player.heading;
  for (let i = 0; i < 60; i++) player.update(1 / 60, auto.update(player, traffic, 0, 1 / 60));
  assert.equal(player.car.position.distanceTo(position), 0);
  assert.equal(player.heading, heading);
  const path = auto.path;
  for (let i = 0; i < 10; i++) auto.update(player, traffic, 0, 0);
  assert.equal(auto.path, path);
  assert.equal(player.distance, 0);
  player.disposeModel();
});
