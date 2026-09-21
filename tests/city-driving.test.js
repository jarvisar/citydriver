import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CityTraffic } from '../src/city-traffic.js';
import { CityAutodrive, cityGreen } from '../src/city-autodrive.js';
import { DrivingController } from '../src/vehicle.js';
import { CITY_BLOCK, ROAD_LEVEL, citydriverRoute, cityStreetAt, cityRiverAt } from '../src/world/city-grid.js';

function setup(t, s = 70, u = 70) {
  const scene = new THREE.Scene();
  const player = new DrivingController(citydriverRoute, { s });
  player.u = u; player.freeDriving = true; player.update(0, {});
  const traffic = new CityTraffic(scene, citydriverRoute, s);
  traffic.reset(citydriverRoute, s, 'city', u);
  t.after(() => { traffic.dispose(); player.disposeModel(); });
  return { scene, player, traffic };
}

function place(traffic, car, axis, direction, along, center = 0) {
  car.axis = axis; car.direction = direction;
  car.lane = center + (axis === 'north' ? 3 : -3) * direction;
  car.s = axis === 'north' ? along : car.lane;
  car.u = axis === 'north' ? car.lane : along;
  car.speed = car.cruiseSpeed = 14;
  traffic.pose(car);
  car.previousPosition.copy(car.position); car.previousQuaternion.copy(car.quaternion);
}

test('traffic initially occupies both axes and all four directions without spawn overlaps', t => {
  const { player, traffic } = setup(t);
  assert.equal(traffic.vehicles.length, 24);
  for (let reset = 0; reset < 25; reset++) {
    player.s = reset * 193 - 2600; player.u = reset * 149 - 2200;
    traffic.reset(citydriverRoute, player.s, 'city', player.u);
    assert.equal(new Set(traffic.vehicles.map(car => `${car.axis}:${car.direction}`)).size, 4);
    for (const car of traffic.vehicles) {
      assert.equal(cityStreetAt(car.s, car.u).onRoad, true);
      assert.ok(Math.hypot(car.s - player.s, car.u - player.u) >= 25);
      assert.ok(Math.hypot(car.s - player.s, car.u - player.u) < 430);
      for (const other of traffic.vehicles) if (car !== other) assert.ok(Math.hypot(car.s - other.s, car.u - other.u) >= 13);
    }
  }
});

test('traffic moves along each axis with matching poses, and rendering rebases only its display', t => {
  const { player, traffic } = setup(t);
  traffic.vehicles = traffic.vehicles.slice(0, 4);
  const placements = [['north', 1, 30, CITY_BLOCK], ['north', -1, -30, -CITY_BLOCK], ['east', 1, 30, -CITY_BLOCK], ['east', -1, -30, CITY_BLOCK]];
  traffic.vehicles.forEach((car, i) => place(traffic, car, ...placements[i]));
  const before = traffic.vehicles.map(car => ({ s: car.s, u: car.u }));
  traffic.update(1 / 60, player); traffic.render(1, 2048);
  traffic.vehicles.forEach((car, i) => {
    const ds = car.s - before[i].s, du = car.u - before[i].u;
    assert.ok((car.axis === 'north' ? ds : du) * car.direction > 0);
    assert.equal(car.axis === 'north' ? du : ds, 0);
    assert.equal(car.position.x, car.u); assert.equal(car.position.z, -car.s);
    assert.equal(car.car.position.x, car.position.x);
    assert.equal(car.car.position.z, car.position.z);
  });
  assert.equal(traffic.group.position.z, 2048);
});

test('each direction stops before a red junction and resumes on green', t => {
  const { player, traffic } = setup(t);
  traffic.vehicles = [traffic.vehicles[0]];
  const car = traffic.vehicles[0];
  for (const axis of ['north', 'east']) for (const direction of [-1, 1]) {
    place(traffic, car, axis, direction, direction * (CITY_BLOCK - 40));
    traffic.time = axis === 'north' ? 12 : 0;
    for (let tick = 0; tick < 300; tick++) traffic.update(1 / 60, player);
    const stoppedAt = axis === 'north' ? car.s : car.u;
    assert.ok(stoppedAt * direction <= CITY_BLOCK - 14.9, `${axis}/${direction} crossed its stop line`);
    assert.ok(car.speed < .05, `${axis}/${direction} did not stop`);
    traffic.time = axis === 'north' ? 0 : 12;
    for (let tick = 0; tick < 60; tick++) traffic.update(1 / 60, player);
    assert.ok(((axis === 'north' ? car.s : car.u) - stoppedAt) * direction > 1);
  }
});

test('a following car queues behind stopped traffic and gives a stopped player space', t => {
  const { player, traffic } = setup(t);
  traffic.vehicles = traffic.vehicles.slice(0, 2);
  const [follower, leader] = traffic.vehicles;
  place(traffic, follower, 'north', 1, 20);
  place(traffic, leader, 'north', 1, 47); leader.speed = leader.cruiseSpeed = 0;
  for (let tick = 0; tick < 240; tick++) traffic.update(1 / 60, player);
  assert.ok(leader.s - follower.s >= 8.9); assert.ok(follower.speed < .1);
  traffic.vehicles = [follower];
  place(traffic, follower, 'east', 1, 20);
  player.s = -3; player.u = 47; player.update(0, {});
  traffic.lastS = player.s; traffic.lastU = player.u;
  traffic.time = 12;
  for (let tick = 0; tick < 240; tick++) traffic.update(1 / 60, player);
  assert.ok(player.u - follower.u >= 8.9); assert.ok(follower.speed < .1);
  assert.equal(player.audioTelemetry.impactSerial, 0);
});

test('disabling traffic freezes the fleet and enabling or teleporting keeps it local', t => {
  const { player, traffic } = setup(t);
  traffic.setEnabled(false, player);
  const before = traffic.vehicles.map(car => [car.s, car.u]);
  traffic.update(10, player);
  assert.deepEqual(traffic.vehicles.map(car => [car.s, car.u]), before);
  assert.equal(traffic.group.visible, false);
  player.s = -3000; player.u = -4000; player.update(0, {});
  traffic.setEnabled(true, player); traffic.update(1 / 60, player);
  assert.equal(traffic.group.visible, true);
  assert.ok(traffic.vehicles.every(car => Math.hypot(car.s - player.s, car.u - player.u) < 430));
  player.s += 2000; player.u += 1800; player.update(0, {});
  traffic.update(1 / 60, player);
  assert.ok(traffic.vehicles.every(car => Math.hypot(car.s - player.s, car.u - player.u) < 430));
});

test('autodrive selects the current street and right lane in all four directions', () => {
  for (const axis of ['north', 'east']) for (const direction of [-1, 1]) {
    const pilot = new CityAutodrive();
    const player = { s: axis === 'north' ? 40 : 0, u: axis === 'north' ? 0 : 40,
      heading: axis === 'north' ? direction > 0 ? 0 : Math.PI : direction * Math.PI / 2, stats: { topSpeed: 25 } };
    assert.equal(pilot.canStart(player), true);
    const input = pilot.update(player, { enabled: false, vehicles: [], time: 0 });
    assert.equal(pilot.path.axis, axis); assert.equal(pilot.path.direction, direction);
    assert.equal(pilot.path.lane, (axis === 'north' ? 3 : -3) * direction);
    assert.ok(input.touchDrive.amount > 0);
    assert.ok((axis === 'north' ? input.touchDrive.along : input.touchDrive.across) * direction > .8);
    assert.ok(Math.abs(Math.hypot(input.touchDrive.along, input.touchDrive.across) - 1) < 1e-10);
  }
  const pilot = new CityAutodrive();
  const courtyard = { s: 40, u: 40, heading: 0, stats: { topSpeed: 25 } };
  assert.equal(pilot.canStart(courtyard), false);
  assert.deepEqual(pilot.update(courtyard, { enabled: false }), { handbrake: true });
});

test('autodrive obeys signal clearance and leaves a following gap', () => {
  for (let time = 0; time < 48; time += .1) assert.equal(cityGreen('north', time) && cityGreen('east', time), false);
  assert.equal(cityGreen('north', 10), false); assert.equal(cityGreen('east', 10), false);
  for (const axis of ['north', 'east']) {
    const pilot = new CityAutodrive();
    const player = { s: axis === 'north' ? CITY_BLOCK - 15 : -3, u: axis === 'north' ? 3 : CITY_BLOCK - 15,
      heading: axis === 'north' ? 0 : Math.PI / 2, stats: { topSpeed: 25 } };
    const traffic = { enabled: true, vehicles: [], time: axis === 'north' ? 12 : 0 };
    assert.equal(pilot.update(player, traffic).touchDrive.amount, 0);
    traffic.time = axis === 'north' ? 0 : 12;
    assert.ok(pilot.update(player, traffic).touchDrive.amount > .5);
    traffic.vehicles = [{ s: player.s + (axis === 'north' ? 9 : 0), u: player.u + (axis === 'east' ? 9 : 0) }];
    assert.equal(pilot.update(player, traffic).touchDrive.amount, 0);
  }
});

test('controller keeps road grip on distant east-west streets and crosses rivers in both directions', t => {
  const player = new DrivingController(citydriverRoute, { s: -CITY_BLOCK * 8 - 3 });
  t.after(() => player.disposeModel());
  player.freeDriving = true;
  for (const direction of [-1, 1]) {
    player.s = -CITY_BLOCK * 8 - direction * 3;
    player.u = direction > 0 ? 348 : 436;
    player.speed = 0; player.heading = direction * Math.PI / 2; player.update(0, {});
    let crossedWater = false;
    for (let tick = 0; tick < 720; tick++) {
      player.update(1 / 60, { touchDrive: { amount: .6, along: 0, across: direction, heading: direction * Math.PI / 2 } });
      crossedWater ||= Boolean(cityRiverAt(player.u));
      assert.equal(player.audioTelemetry.offRoad, 0);
      assert.equal(player.ground(player.s, player.u).blocked, false);
      assert.equal(player.groundedPosition.y, ROAD_LEVEL + .13);
    }
    assert.equal(crossedWater, true);
    assert.ok(direction > 0 ? player.u > 448 : player.u < 336);
    assert.equal(player.heading, direction * Math.PI / 2);
  }
});
