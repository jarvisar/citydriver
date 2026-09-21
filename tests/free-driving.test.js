import test from 'node:test';
import assert from 'node:assert/strict';
import { DrivingController } from '../src/vehicle.js';
import { CAR_IDS } from '../src/cars.js';
import { CITY_BLOCK, citydriverRoute } from '../src/world/city-grid.js';

const palette = car => {
  const colors = new Set();
  car.car.traverse(object => { if (object.isMesh) colors.add(object.material.color.getHexString()); });
  return [...colors].sort();
};
function assertGrounded(car) {
  const p = car.route.position(car.s, car.u);
  assert.ok(Math.hypot(car.car.position.x - p.x, car.car.position.y - p.y - .13, car.car.position.z - p.z) < 1e-8);
  assert.ok(car.car.quaternion.toArray().every(Number.isFinite));
}

test('every car cycles rainbow paint while stationary and restores its finish', () => {
  for (const id of CAR_IDS) {
    const car = new DrivingController(undefined, {}, id), original = palette(car);
    assert.equal(car.rainbow, false);
    assert.equal(car.toggleRainbow(), true);
    const red = palette(car);
    for (let frame = 0; frame < 60; frame++) car.update(1 / 60, {});
    assert.notDeepEqual(palette(car), red, id + ' should animate at rest');
    assert.equal(car.speed, 0);
    assert.equal(car.toggleRainbow(), false);
    assert.deepEqual(palette(car), original, id + ' restores its factory finish');
    car.disposeModel();
  }
});

test('rainbow paint leaves the driving position and free-driving preference alone', () => {
  const car = new DrivingController(citydriverRoute, { s: CITY_BLOCK * 12 });
  car.toggleFreeDriving();
  car.u = CITY_BLOCK * 10 + 3; car.update(0, {});
  const before = car.groundedPosition.clone();
  car.toggleRainbow(); car.toggleRainbow();
  assert.equal(car.freeDriving, true);
  assert.deepEqual(car.groundedPosition, before);
  car.disposeModel();
});

test('rainbow survives garage changes and restores the latest chosen paint', () => {
  const car = new DrivingController();
  car.toggleRainbow();
  for (const id of CAR_IDS) {
    car.setCar(id, { paint: '#123456' });
    car.setAppearance('city');
    car.setRoute(citydriverRoute);
    assert.ok(palette(car).includes('ff0000'), id + ' keeps rainbow after changes');
    assert.equal(car.paintColor, '#123456');
  }
  car.setPaint('#654321');
  assert.ok(palette(car).includes('ff0000'));
  car.toggleRainbow();
  assert.ok(palette(car).includes('654321'));
  car.disposeModel();
});

test('normal driving has no east or west boundary in any city quadrant', () => {
  for (const side of [-1, 1]) for (const north of [-1, 1]) {
    const car = new DrivingController(citydriverRoute, { s: north * CITY_BLOCK * 80 });
    car.u = side * CITY_BLOCK * 100;
    car.heading = side * Math.PI / 2;
    car.update(0, {});
    const before = car.u;
    for (let frame = 0; frame < 600; frame++) {
      car.update(1 / 60, { forward: true });
      assertGrounded(car);
    }
    assert.equal(car.freeDriving, false, 'ordinary city driving needs no unlock');
    assert.ok(side * (car.u - before) > CITY_BLOCK, 'the car crosses a full city block');
    assert.ok(Math.abs(car.s - north * CITY_BLOCK * 80) < 1e-8, 'no lane assist turns an east-west drive north');
    car.disposeModel();
  }
});

test('traffic displacement far from the origin preserves location and decays smoothly', () => {
  for (const side of [-1, 1]) {
    const car = new DrivingController(citydriverRoute, { s: -CITY_BLOCK * 20 + 24 });
    car.u = side * CITY_BLOCK * 100 + 3;
    car.heading = 0; car.speed = 12; car.update(0, {});
    const before = car.groundedPosition.clone();
    car.resolveTrafficCollision(side * .5, -.2, side * 2, 3, side * .5);
    assert.ok(car.groundedPosition.distanceTo(before) < 1);
    assert.ok(Math.abs(car.speed - 9) < 1e-9);
    assertGrounded(car);
    car.speed = 0;
    for (let frame = 0; frame < 120; frame++) car.update(1 / 60, {});
    assert.deepEqual(car.knock, { x: 0, z: 0, spin: 0 });
    assert.ok(car.groundedPosition.distanceTo(before) < 5);
    assertGrounded(car);
    car.disposeModel();
  }
});

test('switching every garage car preserves a distant city location', () => {
  const car = new DrivingController(citydriverRoute, { s: -CITY_BLOCK * 23 + 4 });
  car.u = CITY_BLOCK * 63 + 3; car.update(0, {});
  const before = car.groundedPosition.clone();
  for (const id of CAR_IDS) {
    car.setCar(id);
    assert.deepEqual(car.groundedPosition, before);
    assertGrounded(car);
  }
  car.disposeModel();
});

test('a new session clears the optional free-driving preference', () => {
  const car = new DrivingController(); car.toggleFreeDriving();
  car.setRoute(citydriverRoute);
  assert.equal(car.freeDriving, true);
  const next = new DrivingController();
  assert.equal(next.freeDriving, false);
  next.disposeModel(); car.disposeModel();
});
