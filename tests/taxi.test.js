import test from 'node:test';
import assert from 'node:assert/strict';
import { TaxiRun, taxiRoute, leadStop, SHIFT_SECONDS } from '../src/taxi-run.js';
import { citydriverRoute, cityStreetAt, cityRiverAt } from '../src/world/city-grid.js';
import { DrivingController, createCar } from '../src/vehicle.js';
import { cityLayout } from '../src/world/city-layout.js';

const player = (s = 25, u = 3, heading = 0) => ({ s, u, heading, speed: 0, drifting: false, spec: { width: 2 }, audioTelemetry: { impactSerial: 0, impact: 0 } });
function pickup(run, car) {
  Object.assign(car, { s: run.target.s, u: run.target.u, speed: 0 });
  for (let i = 0; i < 29; i++) run.update(1 / 60, car);
  assert.equal(run.status, 'driving');
}

test('taxi stops and routes use streets and bridges in every direction', () => {
  for (const [s, u, heading] of [[25, 3, 0], [-400, -3, Math.PI], [-3, 380, Math.PI / 2], [-221, -890, -Math.PI / 2]]) {
    const p = cityLayout(s, u), car = player(p.s, p.u, heading), run = new TaxiRun(); run.start(car);
    const lead = leadStop(car), ds = lead.s - p.s, du = lead.u - p.u;
    assert.ok(ds * Math.cos(heading) + du * Math.sin(heading) >= 30);
    for (const customer of run.customers) for (const [a, b] of [[car, customer], [customer, customer.destination]]) {
      const route = taxiRoute(a, b);
      for (let i = 1; i < route.length; i++) {
        const from = route[i - 1], to = route[i]; assert.ok(Math.hypot(to.s - from.s, to.u - from.u) <= 12);
        for (let step = 0; step <= 50; step++) {
          const s = from.s + (to.s - from.s) * step / 50, u = from.u + (to.u - from.u) * step / 50;
          const street = cityStreetAt(s, u); assert.ok(street.onRoad); assert.ok(!cityRiverAt(u, s) || street.bridge);
        }
      }
    }
  }
});

test('pickup and payment require stopping; successful fares add cash and time once', () => {
  const car = player(), run = new TaxiRun(); run.start(car);
  Object.assign(car, run.target); car.speed = 10;
  run.update(1, car); assert.equal(run.status, 'pickup');
  car.speed = 0; run.update(.2, car); car.speed = 8; run.update(.1, car); car.speed = 0; run.update(.2, car);
  assert.equal(run.status, 'pickup', 'moving resets boarding progress');
  pickup(run, car);
  const fare = run.fare.fare;
  Object.assign(car, { s: run.target.s, u: run.target.u, speed: 15 }); run.update(.5, car);
  assert.equal(run.delivered, 0);
  car.speed = 0; const before = run.timeLeft;
  for (let i = 0; i < 29; i++) run.update(1 / 60, car);
  assert.equal(run.status, 'pickup'); assert.equal(run.delivered, 1); assert.ok(run.cash >= fare);
  assert.ok(run.timeLeft > before + 17); assert.equal(run.drainEvents().filter(e => e.kind === 'paid').length, 1);
  assert.equal(run.drainEvents().length, 0);
});

test('late fares fail, shift expiry ends the run, and restart clears state but retains best', () => {
  const saved = new Map(), storage = { getItem: k => saved.get(k), setItem: (k, v) => saved.set(k, v) };
  const car = player(), run = new TaxiRun(storage); run.start(car); pickup(run, car);
  run.fareLeft = .1; run.update(.2, car); assert.equal(run.failed, 1); assert.equal(run.cash, 0); assert.equal(run.status, 'pickup');
  run.cash = 321; run.timeLeft = .01; run.update(.02, car);
  assert.equal(run.status, 'over'); assert.equal(run.timeLeft, 0); assert.equal(run.best, 321);
  run.update(5, car); assert.equal(run.cash, 321); assert.equal(run.drainEvents().filter(e => e.kind === 'over').length, 1);
  assert.equal(new TaxiRun(storage).best, 321);
  run.start(car); assert.equal(run.cash, 0); assert.equal(run.delivered, 0); assert.equal(run.timeLeft, SHIFT_SECONDS); assert.equal(run.best, 321);
  run.stop(); run.update(10, car); assert.equal(run.status, 'idle');
});

test('boost drains, requires throttle, recharges on release, and stops when the run ends', () => {
  const run = new TaxiRun(), car = player(); run.start(car);
  assert.equal(run.controls(.1, { boost: true }).boost, false);
  assert.equal(run.controls(1, { boost: true, forward: 1 }).boost, true); assert.ok(run.boost < .6);
  const depleted = run.boost; run.controls(1, { forward: 1 }); assert.ok(run.boost > depleted);
  for (let i = 0; i < 300; i++) run.controls(1 / 60, { boost: true, forward: 1 });
  assert.equal(run.boostActive, false); assert.ok(run.boost <= .01);
  run.controls(10, {}); assert.equal(run.boost, 1);
  run.finish(); assert.equal(run.controls(.1, { boost: true, forward: 1 }).boost, false);
});

test('near misses score once per car; drifts build tips and crashes break the combo', () => {
  const run = new TaxiRun(), car = player(); run.start(car); pickup(run, car);
  car.speed = 25; const other = { s: car.s, u: car.u + 3.5, speed: 10, direction: 1, axis: 'north' };
  run.update(1 / 60, car, [other]); assert.equal(run.tips, 10); assert.equal(run.combo, 2);
  run.update(1 / 60, car, [other]); assert.equal(run.tips, 10);
  car.drifting = true; run.update(1, car); assert.equal(run.tips, 20); assert.equal(run.combo, 3);
  car.audioTelemetry.impactSerial++; car.audioTelemetry.impact = 15; car.drifting = false;
  run.update(1 / 60, car, [{ ...other }]); assert.equal(run.tips, 10); assert.equal(run.combo, 1);
  run.combo = 3; run.comboTime = .1; run.update(.2, car); assert.equal(run.combo, 1);
});

test('the cab has a roof sign, boost adds speed, and drifting creates recoverable slip', () => {
  const model = createCar('taxi'); assert.ok(model.car.getObjectByName('taxi-sign')); model.disposeModel();
  const car = new DrivingController(citydriverRoute, { s: 25 }, 'taxi'); car.arcade = true; car.freeDriving = true;
  try {
    for (let i = 0; i < 300; i++) car.update(1 / 60, { forward: true, boost: true });
    assert.ok(car.speed > 48);
    const boosted = car.speed; car.update(1 / 60, { forward: true }); assert.ok(car.speed > boosted - 1);
    car.speed = 25;
    for (let i = 0; i < 30; i++) car.update(1 / 60, { forward: true, right: true, handbrake: true });
    assert.ok(car.drifting); assert.ok(Math.abs(car.heading - car.slideHeading) > .1); assert.ok(car.speed > 10);
    const slip = Math.abs(car.heading - car.slideHeading);
    for (let i = 0; i < 60; i++) car.update(1 / 60, { forward: true });
    assert.equal(car.drifting, false); assert.ok(Math.abs(car.heading - car.slideHeading) < slip / 2);
  } finally { car.disposeModel(); }
});
