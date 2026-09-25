import test from 'node:test';
import assert from 'node:assert/strict';
import { CAR_IDS, carStats, DRAG } from '../src/cars.js';
import { steerCurve, turningRadius, turnRate } from '../src/handling.js';
import { DrivingController } from '../src/vehicle.js';
import { citydriverRoute, cityStreetAt, cityStreetProfile, CITY_BLOCK } from '../src/world/city-grid.js';
import { cityLanePose } from '../src/world/city-layout.js';

test('all radius curves widen smoothly, preserve reverse symmetry and retain fine high-speed control', () => {
  for (const id of CAR_IDS) {
    const stats = carStats(id);
    let previous = stats.turnRadius;
    for (let speed = .1; speed <= stats.topSpeed + 10; speed += .1) {
      const radius = turningRadius(speed, stats);
      assert.ok(radius >= previous && radius - previous < .5, `${id}: discontinuity at ${speed}`);
      assert.equal(radius, turningRadius(-speed, stats));
      assert.ok(turningRadius(speed, stats, 1) > radius, `${id}: loose surface still costs grip`);
      assert.ok(turningRadius(speed, stats, 0, 1) <= radius, `${id}: weight over the nose never widens the line`);
      previous = radius;
    }
  }
});

// Fine corrections live in the request curve, not the radius, so a small stick
// movement is a small steering angle at every speed.
test('a small analog movement stays a fine correction', () => {
  assert.ok(steerCurve(.15) < .11 && steerCurve(.15) > .09);
  assert.equal(steerCurve(1), 1);
  assert.equal(steerCurve(0), 0);
  assert.equal(steerCurve(-.5), -steerCurve(.5));
  for (let input = 0; input < 1; input += .01) assert.ok(steerCurve(input + .01) > steerCurve(input));
});

test('Formula slicks hold significantly tighter city-speed lines than the rest of the fleet', () => {
  const formula = carStats('formula'), taxiFormula = carStats('taxiFormula');
  for (const stats of [formula, taxiFormula]) {
    assert.ok(turningRadius(20, stats) < 7.1, '45 mph corner should fit a city intersection');
    assert.ok(turningRadius(25, stats) < 10, '56 mph is still a usable tight arc');
    for (const id of CAR_IDS.filter(id => !['formula', 'taxiFormula'].includes(id))) {
      assert.ok(turningRadius(20, stats) < turningRadius(20, carStats(id)) * .8, `${id}: slicks need a clear advantage`);
    }
  }
  assert.ok(carStats('micro').turnRadius < formula.turnRadius, 'short microcar retains its parking advantage');
});

test('Formula grip tracks the nose without sideways washout in ordinary fast turns', () => {
  const flat = { ...citydriverRoute, frame: () => ({ angle: 0, scale: 1 }),
    position: (s, u) => ({ x: u, y: 0, z: -s }), height: () => 0, looseness: () => 0 };
  for (const id of ['formula', 'taxiFormula']) for (const speed of [10, 15, 20, 25, 35, 50]) {
    const car = new DrivingController(flat, {}, id);
    try {
      car.freeDriving = true;
      for (let tick = 0; tick < 120; tick++) {
        car.speed = speed; car.update(1 / 120, { right: 1 });
        assert.ok(Math.abs(car.slip) < Math.PI / 180, `${id} at ${speed}: more than 1 degree of grip slip`);
        assert.equal(car.drifting, false);
      }
    } finally { car.disposeModel(); }
  }
});

// A constant-speed trial isolates turning ability from how hard each engine
// accelerates. Check all corners AND edge midpoints against the real street
// footprint: a center point alone can miss a wing or a truck cutting the curb.
test('every body fits 90-degree left and right turns on all city street widths', () => {
  for (const id of CAR_IDS) for (const index of [1, 0, 2]) for (const direction of [-1, 1])
    for (const axis of ['north', 'east']) for (const travelSign of [-1, 1]) for (const slow of [false, true]) {
    const profile = cityStreetProfile('north', index), center = index * CITY_BLOCK;
    const formula = id === 'formula' || id === 'taxiFormula';
    const heavy = id === 'rig' || id === 'monster';
    const speed = slow ? 6 : formula ? (index === 1 ? 25 : 30) : heavy ? (index === 1 ? 14 : 18) : index === 1 ? 15 : 20;
    const car = new DrivingController(citydriverRoute, {}, id);
    try {
      const radius = turningRadius(speed, car.stats);
      car.freeDriving = true;
      Object.assign(car, cityLanePose(axis, center + (axis === 'north' ? 1 : -1) * travelSign * profile.lane,
        center - travelSign * direction * profile.lane, travelSign));
      // Radius is measured in world metres, not stretched logical addresses.
      car.s -= Math.cos(car.heading) * (radius + speed * .04);
      car.u -= Math.sin(car.heading) * (radius + speed * .04);
      car.update(0, {});
      const initial = car.heading;
      const launch = 1 + .22 * Math.max(0, 1 - speed / 12);
      const forward = (DRAG.rolling + DRAG.air * speed * speed) / (car.stats.acceleration * launch);
      let ticks = 0;
      const step = steering => {
        car.speed = speed;
        car.update(1 / 120, { forward, left: Math.max(0, -steering), right: Math.max(0, steering) });
        const sin = Math.sin(car.heading), cos = Math.cos(car.heading);
        for (const across of [-.5, 0, .5]) for (const along of [-.5, 0, .5]) {
          const s = car.s + cos * along * car.spec.length - sin * across * car.spec.width;
          const u = car.u + sin * along * car.spec.length + cos * across * car.spec.width;
          const street = cityStreetAt(s, u);
          assert.ok(street.onRoad && !street.median,
            `${id}, ${profile.kind}, ${axis} ${travelSign}, ${speed} m/s, turn ${direction}, tick ${ticks}: body left asphalt at ${s.toFixed(2)},${u.toFixed(2)}`);
        }
      };
      while (Math.abs(car.heading - initial) < Math.PI / 2 && ticks++ < 600) step(direction);
      assert.ok(ticks < 600, `${id}: failed to complete turn`);
      for (let tick = 0; tick < Math.ceil(18 / speed * 120); tick++) step(0);
    } finally { car.disposeModel(); }
  }
});
