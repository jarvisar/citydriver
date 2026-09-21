import test from 'node:test';
import assert from 'node:assert/strict';
import { DrivingController, impassable } from '../src/vehicle.js';
import { CAR_IDS } from '../src/cars.js';
import { JOURNEYS } from '../src/journeys.js';

const palette = car => {
  const colors = new Set();
  car.car.traverse(object => { if (object.isMesh) colors.add(object.material.color.getHexString()); });
  return [...colors].sort();
};

test('every car cycles rainbow paint while stationary in free drive and restores its finish', () => {
  for (const id of CAR_IDS) {
    const car = new DrivingController(undefined, {}, id);
    const original = palette(car);
    car.toggleFreeDriving();
    const red = palette(car);
    for (let frame = 0; frame < 60; frame++) car.update(1 / 60, {});
    assert.notDeepEqual(palette(car), red, `${id} should animate at rest`);
    assert.equal(car.speed, 0);
    car.toggleFreeDriving();
    assert.deepEqual(palette(car), original, `${id} restores its factory finish`);
    car.disposeModel();
  }
});

test('rainbow survives garage and route changes and restores the latest chosen paint', () => {
  const car = new DrivingController();
  car.toggleFreeDriving();
  for (const id of CAR_IDS) {
    car.setCar(id, { paint: '#123456' });
    car.setAppearance('desert');
    car.setRoute(JOURNEYS.desert.route);
    assert.ok(palette(car).includes('ff0000'), `${id} keeps rainbow after changes`);
    assert.equal(car.paintColor, '#123456');
  }
  car.setPaint('#654321');
  assert.ok(palette(car).includes('ff0000'));
  car.toggleFreeDriving();
  assert.ok(palette(car).includes('654321'));
  car.setCar('auto'); car.setAppearance('desert');
  const desert = palette(car);
  car.toggleFreeDriving(); car.setAppearance('snow'); car.toggleFreeDriving();
  assert.notDeepEqual(palette(car), desert, 'factory paint follows the latest route');
  const snow = new DrivingController(); snow.setAppearance('snow');
  assert.deepEqual(palette(car), palette(snow));
  snow.disposeModel(); car.disposeModel();
});

function assertGrounded(car) {
  const p = car.route.position(car.s, car.u);
  assert.ok(Math.hypot(car.car.position.x - p.x, car.car.position.y - p.y - .13, car.car.position.z - p.z) < 1e-8);
  assert.ok(car.car.quaternion.toArray().every(Number.isFinite));
}

for (const [id, { route }] of Object.entries(JOURNEYS)) {
  test(`${id}: free driving defaults off and disabling it restores the road limits`, () => {
    const car = new DrivingController(route);
    assert.equal(car.freeDriving, false);
    car.u = 1000; car.update(0, {});
    assert.equal(car.u, route.bounds(car.s)[1]);
    assert.equal(car.toggleFreeDriving(), true);
    car.u = 1000; car.update(0, {});
    assert.equal(car.u, 1000);
    const { s, distance } = car;
    assert.equal(car.toggleFreeDriving(), false);
    assert.equal(car.s, s); assert.equal(car.distance, distance);
    assert.equal(car.u, 2.4); assert.equal(car.speed, 0);
    assertGrounded(car);
    car.u = -1000; car.update(0, {});
    assert.equal(car.u, route.bounds(car.s)[0]);
    car.disposeModel();
  });

  test(`${id}: throttle, reverse and touch drive beyond either roadside until water or a cliff stops them`, () => {
    for (const mode of ['forward', 'reverse', 'touch']) for (const side of [-1, 1]) {
      const car = new DrivingController(route);
      car.toggleFreeDriving();
      const direction = mode === 'reverse' ? -side : side;
      car.heading = route.frame(car.s).angle + direction * Math.PI / 2;
      const input = mode === 'touch'
        ? { touchDrive: { amount: 1, along: 0, across: side, heading: car.heading } }
        : mode === 'reverse' ? { brake: true } : { forward: true };
      for (let i = 0; i < 60 * 24; i++) {
        car.update(1 / 60, input);
        assertGrounded(car);
        assert.ok(!impassable(car.ground(car.s, car.u)), `${mode} drove onto impassable ground at u=${car.u}`);
      }
      assert.ok(side * car.u > route.bounds(car.s)[side < 0 ? 0 : 1] * side - .01, `${mode} never left the road, u=${car.u}`);
      // Only impassable ground just ahead may hold the car up or slow it down.
      if (![.5, 1, 1.5, 2, 3].some(d => impassable(car.ground(car.s, car.u + side * d)))) {
        assert.ok(side * car.u > 150, `${mode} stopped on open ground at u=${car.u}`);
        assert.ok(Math.abs(car.speed) > 5, `${mode} lost speed far from the road`);
      }
      car.disposeModel();
    }
  });

  test(`${id}: off-road headings and traffic displacement do not pull cars back to the road`, () => {
    const car = new DrivingController(route);
    car.toggleFreeDriving();
    for (const side of [-1, 1]) {
      car.s = -1025; car.u = side * 1500; car.speed = 12; car.steer = 0;
      const heading = route.frame(car.s).angle + side * .4;
      car.heading = heading;
      for (let i = 0; i < 120; i++) car.update(1 / 60, { forward: true });
      assert.equal(car.heading, heading);
      assert.ok(side * car.u > 1500);
      assertGrounded(car);

      const before = car.groundedPosition.clone();
      car.resolveTrafficCollision(side * .5, -.2, 3);
      assert.ok(car.groundedPosition.distanceTo(before) < 5, 'collision teleported the car');
      assert.ok(side * car.u > 1500);
      assert.equal(car.speed, 3);
      assertGrounded(car);
    }
    const s = car.s;
    car.reset();
    assert.equal(car.freeDriving, true);
    assert.equal(car.s, s);
    assert.equal(car.u, 2.4);
    assert.equal(car.speed, 0);
    assertGrounded(car);
    car.disposeModel();
  });
}

test('switching cars far off-road preserves the location for every car', () => {
  const car = new DrivingController(JOURNEYS.plains.route);
  car.toggleFreeDriving();
  car.u = 1000; car.update(0, {});
  const before = car.groundedPosition.clone();
  for (const id of CAR_IDS) {
    car.setCar(id);
    assert.equal(car.u, 1000);
    assert.deepEqual(car.groundedPosition, before);
    assertGrounded(car);
  }
  car.disposeModel();
});

test('free driving persists across route changes but starts disabled in a new session', () => {
  const car = new DrivingController();
  car.toggleFreeDriving();
  for (const { route } of Object.values(JOURNEYS)) {
    car.setRoute(route);
    assert.equal(car.freeDriving, true);
    car.u = -1000; car.update(0, {});
    assert.equal(car.u, -1000);
  }
  const nextSession = new DrivingController();
  assert.equal(nextSession.freeDriving, false);
  nextSession.disposeModel(); car.disposeModel();
});
