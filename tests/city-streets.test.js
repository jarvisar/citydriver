import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CITY_BLOCK as B, ROAD_LEVEL, cityStreetProfile, cityStreetAt, cityMedianAt, cityJunctionControl, citydriverRoute } from '../src/world/city-grid.js';
import { CitydriverWorld } from '../src/world/citydriver-world.js';
import { CityTraffic } from '../src/city-traffic.js';
import { CityAutodrive } from '../src/city-autodrive.js';
import { junctionSpeed } from '../src/city-junctions.js';
import { DrivingController } from '../src/vehicle.js';
import { collideScenery } from '../src/collision.js';
import { leadStop } from '../src/taxi-run.js';
import { cityLayout, cityLanePose } from '../src/world/city-layout.js';

test('side streets, avenues and boulevards share widths, lane positions and intersection controls', () => {
  for (let i = -20; i <= 20; i++) for (const axis of ['north', 'east']) {
    const street = cityStreetProfile(axis, i);
    assert.ok(street.lane - 1.65 > street.median && street.lane + 1.65 < street.halfWidth);
    assert.equal(cityStreetProfile(axis, i + 5), street);
    for (let cross = -4; cross <= 4; cross++) {
      const other = cityStreetProfile(axis === 'north' ? 'east' : 'north', cross);
      assert.equal(cityJunctionControl(axis, i, cross), street.kind === 'side' ? 'stop' : other.kind === 'side' ? 'priority' : 'signal');
    }
  }
  assert.deepEqual([0, 1, 2].map(i => cityStreetProfile('north', i).kind), ['avenue', 'side', 'boulevard']);
});

test('medians stop short of every intersection, leave bridge decks clear, and agree with physical ground height', () => {
  for (let index = -8; index <= 8; index++) {
    const s = index * B;
    for (let offset = -16; offset <= 16; offset++) {
      const a = cityLayout(s + offset, 2 * B), b = cityLayout(2 * B, s + offset);
      assert.equal(cityMedianAt(a.s, a.u), false);
      assert.equal(cityMedianAt(b.s, b.u), false);
    }
  }
  const median = cityLayout(56, 2 * B);
  assert.equal(cityMedianAt(median.s, median.u), true);
  assert.ok(citydriverRoute.height(median.s, median.u) > ROAD_LEVEL);
  assert.equal(citydriverRoute.looseness(median.s, median.u), .55);
  for (let u = 3 * B; u <= 4 * B; u++) { const p = cityLayout(2 * B, u); assert.equal(cityMedianAt(p.s, p.u), false); }
  for (const direction of [-1, 1]) {
    const stop = leadStop({ s: 2 * B - direction * 5.7, u: 25, heading: direction * Math.PI / 2 });
    assert.equal(cityStreetAt(stop.s, stop.u).median, false);
    assert.equal(citydriverRoute.height(stop.s, stop.u), ROAD_LEVEL);
  }
});

test('a cab can drive every street type in both axes and directions without clipping median trees or sidewalks', () => {
  const scene = new THREE.Scene(), world = new CitydriverWorld(scene), car = new DrivingController(citydriverRoute, { s: 0 });
  car.freeDriving = true;
  try {
    for (const axis of ['north', 'east']) for (const index of [-3, 0, 1, 2]) for (const direction of [-1, 1]) {
      const street = cityStreetProfile(axis, index), lane = index * B + (axis === 'north' ? 1 : -1) * direction * street.lane;
      Object.assign(car, cityLanePose(axis, lane, -direction * 80, direction));
      const pilot = new CityAutodrive();
      car.speed = 0; car.knock.x = car.knock.z = car.knock.spin = 0; car.update(0, {});
      world.update(car.s, car.u);
      const from = axis === 'north' ? car.s : car.u;
      for (let tick = 0; tick < 1200; tick++) {
        car.update(1 / 60, pilot.update(car, { enabled: false })); collideScenery(car, world.chunks, 1 / 60); world.update(car.s, car.u);
        assert.equal(citydriverRoute.looseness(car.s, car.u), 0);
        assert.equal(car.ground(car.s, car.u).blocked, false);
      }
      assert.ok(((axis === 'north' ? car.s : car.u) - from) * direction > 140);
    }
  } finally { car.disposeModel(); world.dispose(); }
});

test('side-street traffic comes to a full stop, waits, and then crosses instead of obeying an invisible signal', () => {
  const scene = new THREE.Scene(), traffic = new CityTraffic(scene, citydriverRoute, 0);
  const player = new DrivingController(citydriverRoute, { s: 50 });
  player.u = B + 70; player.update(0, {});
  try {
    traffic.vehicles = [traffic.vehicles[0]];
    const car = traffic.vehicles[0];
    car.axis = 'north'; car.direction = 1; car.lane = B + 2.7; car.u = car.lane; car.s = -40;
    car.speed = car.cruiseSpeed = 10; car.stopKey = null; traffic.pose(car);
    traffic.lastS = player.s; traffic.lastU = player.u;
    let stopped = 0, crossed = false;
    for (let tick = 0; tick < 900; tick++) {
      traffic.update(1 / 60, player);
      if (car.speed < .4 && car.s < 0) stopped += 1 / 60;
      if (car.s > 15) { crossed = true; break; }
    }
    assert.ok(stopped >= .7); assert.equal(crossed, true);
  } finally { traffic.dispose(); player.disposeModel(); }
});

test('stop-sign drivers yield to cross traffic and reserve a four-way stop one at a time', () => {
  const north = {}, east = {}, traffic = { time: 1, vehicles: [], junctionReservations: new Map() };
  const speed = (driver, axis, lane, along) => junctionSpeed(driver, traffic, axis, 1, lane, along, 0, 1 / 60);
  // Both roads at index 1 are minor streets. A moving eastbound car has priority
  // over the stopped northbound car, regardless of the global signal clock.
  traffic.vehicles = [{ axis: 'east', direction: 1, s: B - 2.7, u: B - 20, speed: 10 }];
  for (let i = 0; i < 90; i++) assert.equal(speed(north, 'north', B + 2.7, B - 12.5), 0);
  traffic.vehicles[0].u = B; traffic.vehicles[0].speed = 0;
  assert.equal(speed(north, 'north', B + 2.7, B - 12.5), 0, 'a blocked junction must stay closed');
  traffic.vehicles = [];
  assert.equal(speed(north, 'north', B + 2.7, B - 12.5), Infinity);
  for (let i = 0; i < 90; i++) assert.equal(speed(east, 'east', B - 2.7, B - 12.5), 0);
  traffic.time = 9;
  assert.equal(speed(east, 'east', B - 2.7, B - 12.5), Infinity);
  const pilot = new CityAutodrive();
  pilot.update({ s: 20, u: 2 * B + 5.7, speed: 10, heading: 0, stats: { topSpeed: 30 } }, { enabled: false });
  assert.equal(pilot.path.lane, 2 * B + 5.7);
  assert.equal(pilot.canStart(cityLayout(56, 2 * B)), false, 'cruise cannot start inside a planted median');
});

test('visible traffic lamps follow the same phase as drivers, while minor junctions have stop signs', () => {
  const world = new CitydriverWorld(new THREE.Scene());
  try {
    world.update(24, 3);
    const chunks = [...world.chunks.values()], color = new THREE.Color();
    assert.ok(chunks.some(c => c.group.getObjectByName('citydriver-stop')));
    for (const time of [0, 12]) {
      world.animate(15, time);
      for (const c of chunks) for (const signal of c.features.signals) {
        const green = signal.axis === 'north' ? time === 0 : time === 12;
        c.signalMesh.getColorAt(signal.indices[green ? 2 : 0], color);
        assert.ok(green ? color.g > color.r : color.r > color.g);
      }
    }
  } finally { world.dispose(); }
});
