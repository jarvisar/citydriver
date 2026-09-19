import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Autodrive } from '../src/autodrive.js';
import { DrivingController } from '../src/vehicle.js';
import { Traffic, TRAFFIC_CRUISE_SPEED } from '../src/traffic.js';
import { CAR_IDS } from '../src/cars.js';
import { coastalDrivingRoute } from '../src/world/route.js';
import { JOURNEYS } from '../src/journeys.js';

const straight = {
  frame: s => ({ x: 0, y: 0, z: -s, nx: 1, nz: 0, angle: 0, scale: 1 }),
  position: (s, u) => ({ x: u, y: 0, z: -s }),
  height: () => 0, bounds: () => [-4.65, 4.65],
};
function setup(id = 'auto', route = straight) {
  const player = new DrivingController(route, { s: 0 }, id);
  const traffic = new Traffic(new THREE.Scene(), route, 0);
  const auto = new Autodrive(); auto.toggle();
  let collisions = 0;
  const resolve = player.resolveTrafficCollision.bind(player);
  player.resolveTrafficCollision = (...args) => { collisions++; resolve(...args); };
  return { player, traffic, auto, collisions: () => collisions,
    step(seconds, check = () => {}) {
      for (let i = 0; i < seconds * 60; i++) {
        player.update(1 / 60, auto.update(player, traffic)); traffic.update(1 / 60, player); check();
      }
    },
    dispose() { traffic.dispose(); player.disposeModel(); },
  };
}
function arrange(f, positions) {
  f.traffic.vehicles = f.traffic.vehicles.slice(0, positions.length);
  positions.forEach((s, i) => f.traffic.respawn(f.traffic.vehicles[i], s));
}

test('every car reaches its own top speed and follows a bending road without traffic', () => {
  for (const id of CAR_IDS) {
    const f = setup(id, coastalDrivingRoute);
    f.traffic.setEnabled(false, f.player);
    f.step(30, () => assert.ok(Math.abs(f.player.u - 2.4) < .01, id));
    assert.ok(Math.abs(f.player.speed - f.player.stats.topSpeed) < .01, id);
    f.dispose();
  }
});

test('traffic-speed cruising maintains pace and stays behind matching traffic', () => {
  for (const id of ['auto', 'formula']) {
    const f = setup(id); arrange(f, [40]);
    f.player.speed = TRAFFIC_CRUISE_SPEED;
    for (let i = 0; i < 30 * 60; i++) {
      f.player.update(1 / 60, f.auto.update(f.player, f.traffic, TRAFFIC_CRUISE_SPEED));
      f.traffic.update(1 / 60, f.player);
      assert.ok(Math.abs(f.player.speed - TRAFFIC_CRUISE_SPEED) < .01, id);
      assert.ok(Math.abs(f.player.u - 2.4) < .01, id);
      assert.equal(f.auto.passing, null);
    }
    assert.equal(f.collisions(), 0);
    f.dispose();
  }
});

test('passes a slower car and returns to the right lane without contact', () => {
  const f = setup(); arrange(f, [55]);
  f.player.speed = f.player.stats.topSpeed;
  let passedLeft = false;
  f.step(12, () => { passedLeft ||= f.player.u < -2; });
  assert.ok(passedLeft);
  assert.equal(f.collisions(), 0);
  assert.ok(f.player.u > 2.3);
  assert.equal(f.auto.passing, null);
  f.dispose();
});

test('waits behind a car for oncoming traffic, then passes when clear', () => {
  const f = setup(); arrange(f, [55, 180]);
  f.player.speed = f.player.stats.topSpeed;
  f.step(3, () => assert.ok(f.player.u > 2.3, 'stay in our lane while the pass is blocked'));
  assert.ok(f.player.speed < f.player.stats.topSpeed - 2);
  let passedLeft = false;
  f.step(22, () => { passedLeft ||= f.player.u < -2; });
  assert.ok(passedLeft, 'pass after the oncoming car clears');
  assert.equal(f.collisions(), 0);
  assert.ok(f.player.u > 2.3);
  f.dispose();
});

test('passes a close pair together instead of merging into the second car', () => {
  const f = setup(); arrange(f, [55, -300, 72]);
  f.player.speed = f.player.stats.topSpeed;
  f.step(15);
  assert.equal(f.collisions(), 0);
  assert.ok(f.player.u > 2.3);
  assert.equal(f.auto.passing, null);
  f.dispose();
});

test('stops behind blocked traffic without reversing', () => {
  const f = setup(); arrange(f, [55, 85]);
  for (const car of f.traffic.vehicles) car.speed = car.cruiseSpeed = 0;
  f.player.speed = f.player.stats.topSpeed;
  f.step(15, () => { assert.ok(f.player.u > 2.3); assert.ok(f.player.speed >= 0); });
  assert.equal(f.collisions(), 0);
  assert.ok(f.player.speed < .01);
  f.dispose();
});

test('normal traffic stays collision-free over two minutes on every route, including the fastest car', () => {
  for (const [journey, { route }] of Object.entries(JOURNEYS)) for (const id of ['auto', 'formula']) {
    const f = setup(id, route);
    f.traffic.reset(route, 0, journey);
    f.step(120, () => assert.ok(Math.abs(f.player.u) < 2.41, `${journey}/${id}: stay on the road`));
    assert.equal(f.collisions(), 0, `${journey}/${id}`);
    f.dispose();
  }
});
