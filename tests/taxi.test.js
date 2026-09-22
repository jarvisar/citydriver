import test from 'node:test';
import assert from 'node:assert/strict';
import { TaxiRun, taxiRoute, leadStop, SHIFT_SECONDS } from '../src/taxi-run.js';
import { citydriverRoute, cityStreetAt, cityRiverAt } from '../src/world/city-grid.js';
import { DrivingController, createCar } from '../src/vehicle.js';
import { cityLayout } from '../src/world/city-layout.js';

const player = (s = 25, u = 3, heading = 0) => ({ s, u, heading, speed: 0, drifting: false, spec: { width: 2 }, audioTelemetry: { impactSerial: 0, impact: 0 } });
function pickup(run, car, passenger = run.customers[0]) {
  if (run.blockedPickup?.id === passenger.id) {
    car.s += 20; car.speed = 12; run.update(.1, car);
  }
  Object.assign(car, { s: passenger.s, u: passenger.u, speed: 0 });
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
  Object.assign(car, run.customers[0]); car.speed = 10;
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
  assert.equal(run.target, null, 'payment leaves the next passenger unselected');
  assert.equal(run.hold, 0);
});

test('navigation stays empty at startup, while cruising, and until boarding finishes', () => {
  const car = player(), run = new TaxiRun(); run.start(car);
  for (let trip = 0; trip < 2; trip++) {
    assert.equal(run.target, null);
    Object.assign(car, cityLayout(20025 * (trip + 1), -19997), { speed: 12 }); run.update(1.1, car);
    assert.ok(run.customers.length > 0);
    assert.equal(run.target, null, 'streaming customers must not choose a fare');
    assert.deepEqual(taxiRoute(car, run.target), []);
    const passenger = run.customers[2];
    Object.assign(car, { s: passenger.s, u: passenger.u, speed: 0 }); run.update(.2, car);
    assert.equal(run.target, null, 'partial boarding must not reveal a destination');
    assert.equal(run.boarding, passenger);
    run.update(.25, car);
    assert.equal(run.status, 'driving'); assert.equal(run.fare, passenger);
    assert.equal(run.target, passenger.destination);
    while (run.status === 'driving') {
      Object.assign(car, { s: run.target.s, u: run.target.u }); run.update(.5, car);
    }
    assert.equal(run.target, null);
  }
});

test('a pickup overlapping the drop-off waits for the cab to leave and return', () => {
  const car = player(), run = new TaxiRun(); run.start(car); pickup(run, car);
  const waiting = run.customers[0]; run.fare.stops[0].destination = waiting;
  Object.assign(car, { s: waiting.s, u: waiting.u }); run.update(.5, car);
  run.update(1, car);
  assert.equal(run.delivered, 1); assert.equal(run.status, 'pickup');
  assert.equal(run.target, null); assert.equal(run.hold, 0);
  car.s += 20; car.speed = 12; run.update(.1, car);
  Object.assign(car, { s: waiting.s, u: waiting.u, speed: 0 }); run.update(.5, car);
  assert.equal(run.status, 'driving'); assert.equal(run.fare.id, waiting.id);
});

test('starting inside a pickup ring waits for the driver to leave and return', () => {
  const car = player(), run = new TaxiRun(); run.start(car);
  const passenger = run.customers[0];
  Object.assign(car, { s: passenger.s, u: passenger.u }); run.start(car);
  run.update(1, car);
  assert.equal(run.status, 'pickup'); assert.equal(run.target, null); assert.equal(run.hold, 0);
  car.s += 20; car.speed = 12; run.update(.1, car);
  Object.assign(car, { s: passenger.s, u: passenger.u, speed: 0 }); run.update(.5, car);
  assert.equal(run.status, 'driving'); assert.equal(run.fare.id, passenger.id);
});

test('expanded destinations offer distinct customers, reachable stops and varied successive fares', () => {
  const car = player(), run = new TaxiRun(), visited = new Set(); run.start(car);
  for (let trip = 0; trip < 24; trip++) {
    assert.ok(run.customers.length > 3 && run.customers.length <= 26);
    assert.ok(new Set(run.customers.map(c => c.destination.type)).size >= 3);
    for (const customer of run.customers) {
      assert.notEqual(customer.name, 'Passenger');
      assert.ok(customer.length >= 280 && customer.length <= 1100);
      assert.equal(cityStreetAt(customer.s, customer.u).median, false);
      assert.equal(cityStreetAt(customer.destination.s, customer.destination.u).median, false);
      for (const other of run.customers) if (other !== customer) assert.ok(Math.hypot(other.s - customer.s, other.u - customer.u) > 24);
    }
    assert.ok(run.customers.some(c => !run.recentDestinations.includes(c.destination.type)), 'fresh destinations remain available alongside persistent offers');
    pickup(run, car, run.customers.find(c => !run.recentDestinations.includes(c.destination.type))); visited.add(run.target.type);
    while (run.status === 'driving') {
      Object.assign(car, { s: run.target.s, u: run.target.u, speed: 0 });
      run.update(.5, car);
    }
    assert.equal(run.delivered, trip + 1);
  }
  assert.ok(visited.size >= 10, `a shift explores many different destinations: ${[...visited]}`);
});

test('customers keep appearing across an unbounded city with a bounded nearby population', () => {
  const car = player(), run = new TaxiRun(), seen = new Set(), counts = new Set(); run.start(car);
  for (const [s, u] of [[25, 3], [137, 3], [249, 3], [10025, -10077], [-25063, 32003], [-120000, -139997], [400025, 550003]]) {
    Object.assign(car, cityLayout(s, u), { speed: 12 });
    run.update(1.1, car);
    assert.equal(run.status, 'pickup');
    assert.ok(run.customers.length > 3 && run.customers.length <= 26, 'only the spatial neighborhood is loaded');
    counts.add(run.customers.length);
    assert.equal(run.target, null);
    assert.equal(new Set(run.customers.map(c => c.id)).size, run.customers.length);
    assert.ok(run.customers.filter(c => Math.hypot(c.s - car.s, c.u - car.u) < 224).length >= 3, 'several choices stay within a couple of blocks');
    for (const customer of run.customers) {
      seen.add(customer.id);
      assert.ok(Math.hypot(customer.s - car.s, customer.u - car.u) <= 504);
      const street = cityStreetAt(customer.s, customer.u);
      assert.ok(street.onRoad && !street.median && !street.bridge);
    }
  }
  assert.ok(seen.size > 40, 'exploration generates new offers instead of moving the original three');
  assert.ok(counts.size > 1, 'the available population follows the streets, not a fixed offer count');
});

test('nearby offers survive streaming without selecting a passenger or rebuilding while stationary', () => {
  const car = player(), run = new TaxiRun(); run.start(car);
  const before = new Map(run.customers.map(c => [c.id, c]));
  car.speed = 12; run.update(1.1, car);
  const revision = run.revision;
  for (let i = 0; i < 120; i++) run.update(1 / 60, car);
  assert.equal(run.revision, revision, 'standing still does not regenerate routes or rebuild markers');
  Object.assign(car, cityLayout(90, 3)); run.update(1.1, car);
  assert.equal(run.target, null);
  for (const customer of run.customers) if (before.has(customer.id)) assert.equal(customer, before.get(customer.id));
  assert.ok(run.customers.filter(c => before.has(c.id)).length >= 6, 'nearby waiting passengers remain in place');
});

test('unloaded fares regenerate identically regardless of approach, trip history or run restart', () => {
  for (const [s, u] of [[25, 3], [-221, -890]]) {
    const home = cityLayout(s, u), car = player(home.s, home.u), run = new TaxiRun(); run.start(car);
    const original = new Map(run.customers.map(customer => [customer.id, customer]));
    Object.assign(car, cityLayout(s + 20000, u - 20000), { speed: 12 }); run.update(1.1, car);
    assert.ok(run.customers.every(customer => !original.has(customer.id)), 'the original offers have actually unloaded');
    run.delivered = 7; run.failed = 3;
    run.recentDestinations = [...new Set([...original.values()].map(customer => customer.destination.type))];
    Object.assign(car, cityLayout(s + 65, u - 45), { heading: Math.PI }); run.update(1.1, car);
    const returning = run.customers.filter(customer => original.has(customer.id));
    assert.ok(returning.length >= 5);
    for (const customer of returning) {
      assert.notEqual(customer, original.get(customer.id), 'a new object was generated');
      assert.deepEqual(customer, original.get(customer.id), 'all offer details agree, including destination, price, timer and colour');
    }
    Object.assign(car, home); run.start(car);
    for (const customer of run.customers) assert.deepEqual(customer, original.get(customer.id));
  }
});

test('collected fares keep their cooldown and regenerate the seeded offer after it expires', () => {
  const car = player(), run = new TaxiRun(); run.start(car);
  const original = run.customers[0]; pickup(run, car);
  run.fareLeft = .01; run.update(.02, car);
  assert.ok(!run.customers.some(customer => customer.id === original.id));
  Object.assign(car, cityLayout(20025, -19997), { speed: 12 }); run.update(1.1, car);
  run.update(60, car);
  Object.assign(car, { s: original.s, u: original.u }); run.update(1.1, car);
  assert.deepEqual(run.customers.find(customer => customer.id === original.id), original);
});

test('any waiting customer can board but an active fare cannot be replaced or stacked', () => {
  const car = player(), run = new TaxiRun(); run.start(car);
  const passenger = run.customers[4], others = run.customers.filter(c => c !== passenger);
  Object.assign(car, { s: passenger.s, u: passenger.u, speed: 0 });
  run.update(.5, car);
  assert.equal(run.fare, passenger); assert.equal(run.status, 'driving');
  assert.ok(!run.customers.includes(passenger));
  Object.assign(car, { s: others[0].s, u: others[0].u }); run.update(.5, car);
  assert.equal(run.fare, passenger); assert.equal(run.target, passenger.destination);
  assert.equal(run.drainEvents().filter(e => e.kind === 'pickup').length, 1);
  run.fareLeft = .01; run.update(.02, car);
  assert.equal(run.status, 'pickup'); assert.ok(run.customers.length > 1);
  assert.ok(!run.customers.some(c => c.id === passenger.id), 'a boarded passenger does not immediately respawn');
  run.stop(); assert.equal(run.customers.length, 0); assert.equal(run.servedCustomers.size, 0);
});

test('passing a pickup never creates a target and stopping begins boarding', () => {
  const car = player(), run = new TaxiRun(); run.start(car);
  const passing = run.customers[0];
  Object.assign(car, { s: passing.s, u: passing.u });
  for (const speed of [25, -8, 2.5]) {
    car.speed = speed; run.update(.1, car);
    assert.equal(run.target, null, 'passing a ring must not create a route');
    assert.equal(run.hold, 0);
  }
  car.speed = 0; run.update(.2, car);
  assert.equal(run.target, null);
  assert.equal(run.boarding, passing, 'stopping at any customer starts boarding');
  assert.equal(run.status, 'pickup', 'the normal boarding hold still applies');
  run.update(.25, car);
  assert.equal(run.status, 'driving'); assert.equal(run.fare, passing);
});

test('boarding progress cannot carry to a different passenger', () => {
  const car = player(), run = new TaxiRun(); run.start(car);
  const [first, second] = run.customers;
  Object.assign(car, { s: first.s, u: first.u }); run.update(.3, car);
  Object.assign(car, { s: second.s, u: second.u }); run.update(.2, car);
  assert.equal(run.status, 'pickup'); assert.equal(run.target, null);
  assert.equal(run.boarding, second); assert.equal(run.hold, .2);
  run.update(.25, car);
  assert.equal(run.fare, second); assert.equal(run.target, second.destination);
});

test('late fares fail, shift expiry ends the run, and restart clears state but retains best', () => {
  const saved = new Map(), storage = { getItem: k => saved.get(k), setItem: (k, v) => saved.set(k, v) };
  const car = player(), run = new TaxiRun(storage); run.start(car); pickup(run, car);
  run.fareLeft = .1; run.update(.2, car); assert.equal(run.target, null); assert.equal(run.hold, 0); assert.equal(run.fare, null); assert.equal(run.failed, 1); assert.equal(run.cash, 0); assert.equal(run.status, 'pickup');
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

// Isolate handling from generated streets, collisions, and surface changes.
const handlingRoute = {
  laneAssist: false, frame: () => ({ angle: 0, scale: 1 }),
  position: (s, u, y = 0) => ({ x: u, y, z: -s }),
  height: () => 0, looseness: () => 0, bounds: () => [-Infinity, Infinity],
};

test('overhead touch boost adds useful speed and releasing the stick still stops the cab', () => {
  for (const hz of [30, 60, 120]) {
    const car = new DrivingController(handlingRoute, {}, 'taxi'), run = new TaxiRun(); car.arcade = true;
    try {
      run.start(car);
      const touchDrive = { amount: 1, along: 1, across: 0, heading: 0 };
      for (let i = 0; i < hz * 5; i++) car.update(1 / hz, run.controls(1 / hz, { touchDrive }));
      assert.equal(car.speed, car.stats.topSpeed);
      for (let i = 0; i < hz * 2; i++) car.update(1 / hz, run.controls(1 / hz, { touchDrive, boost: true }));
      assert.ok(car.speed >= car.stats.topSpeed + 9, `${hz} Hz: boost should accelerate beyond cruise speed`);
      assert.ok(car.speed <= car.stats.topSpeed + 10);
      assert.ok(run.boost < .15, 'the speed increase uses the normal boost supply');
      for (let i = 0; i < hz * 2; i++) car.update(1 / hz, run.controls(1 / hz, { touchDrive: { amount: 0 }, boost: true }));
      assert.equal(run.boostActive, false);
      assert.equal(car.speed, 0, 'releasing the stick stops even if Boost remains held');
    } finally { car.disposeModel(); }
  }
});

test('holding brake settles a moving cab for pickup and drop-off before reversing', () => {
  for (const hz of [30, 60, 120]) {
    const car = new DrivingController(handlingRoute, {}, 'taxi'), run = new TaxiRun(); car.arcade = true;
    try {
      run.start(car);
      for (const stage of ['pickup', 'driving']) {
        assert.equal(run.status, stage);
        const stop = run.target ?? run.customers[0];
        Object.assign(car, { s: stop.s - 9, u: stop.u, heading: 0, speed: 25 }); car.update(0, {});
        const start = car.s;
        for (let i = 0; i < hz * 1.4; i++) {
          car.update(1 / hz, { brake: 1 }); run.update(1 / hz, car);
        }
        assert.notEqual(run.status, stage, `${hz} Hz: holding brake completes ${stage}`);
        assert.ok(car.s - start < 11, 'stopping distance stays short');
      }
      assert.equal(run.delivered, 1);
      for (let i = 0; i < hz; i++) car.update(1 / hz, { brake: 1 });
      assert.ok(car.speed < -2.5, 'continuing to hold brake still reverses');
    } finally { car.disposeModel(); }
  }
});

test('brakes beat throttle, and a fresh press selects reverse without a delay', () => {
  const car = new DrivingController(handlingRoute, {}, 'taxi'); car.arcade = true;
  try {
    car.speed = 25;
    for (let i = 0; i < 60; i++) car.update(1 / 60, { brake: 1, forward: 1 });
    assert.equal(car.speed, 0, 'braking while still holding throttle stops the cab');
    car.update(1 / 60, {}); car.update(1 / 60, { brake: 1 });
    assert.ok(car.speed < 0, 'release and repress bypasses the settling pause');
    car.reset(); car.update(1 / 60, { brake: 1 });
    assert.ok(car.speed < 0, 'reset clears a previous stop delay');
  } finally { car.disposeModel(); }
});

test('arcade steering straightens and countersteers promptly at different tick rates', () => {
  for (const hz of [30, 60, 120]) {
    const car = new DrivingController(handlingRoute, {}, 'taxi'); car.arcade = true;
    try {
      car.speed = 25;
      for (let i = 0; i < hz; i++) car.update(1 / hz, { forward: 1, right: 1 });
      const heading = car.heading;
      for (let i = 0; i < hz / 2; i++) car.update(1 / hz, { forward: 1 });
      assert.ok((car.heading - heading) * 180 / Math.PI < 7, 'release does not carry the cab far into the old turn');
      for (let i = 0; i < hz; i++) car.update(1 / hz, { forward: 1, right: 1 });
      for (let i = 0; i < Math.ceil(hz * .06); i++) car.update(1 / hz, { forward: 1, left: 1 });
      assert.ok(car.steer < 0, 'countersteering responds in time to catch a slide');
      for (let i = 0; i < hz; i++) car.update(1 / hz, { forward: 1, right: .25 });
      assert.ok(Math.abs(car.steer - .25) < .001, 'analog steering retains its range');
    } finally { car.disposeModel(); }
  }
});

test('a short continuous corner drift earns a tip, but separate taps do not accumulate', () => {
  const run = new TaxiRun(), car = player(); run.start(car); pickup(run, car); car.speed = 25;
  for (let turn = 0; turn < 3; turn++) {
    car.drifting = true; run.update(.3, car);
    car.drifting = false; run.update(.1, car);
  }
  assert.equal(run.tips, 0);
  car.drifting = true;
  for (let i = 0; i < 42; i++) run.update(1 / 60, car);
  assert.equal(run.tips, 5); assert.equal(run.combo, 2);
});

test('one prolonged scrape costs tips once and cannot earn stunts until clear', () => {
  const run = new TaxiRun(), car = player(); run.start(car); pickup(run, car);
  run.drainEvents(); run.tips = 100; car.speed = 25; car.drifting = true;
  const other = { s: car.s, u: car.u + 3.5, speed: 10, direction: 1 };
  for (let i = 0; i < 120; i++) {
    car.audioTelemetry.impactSerial++; car.audioTelemetry.impact = 8;
    run.update(1 / 60, car, [other]);
  }
  assert.equal(run.tips, 50); assert.equal(run.combo, 1);
  const events = run.drainEvents();
  assert.equal(events.filter(e => e.kind === 'crash').length, 1);
  assert.equal(events.filter(e => e.kind === 'tip').length, 0);
  car.drifting = false; run.update(1, car);
  car.audioTelemetry.impactSerial++; run.update(1 / 60, car);
  assert.equal(run.tips, 25, 'a later distinct crash still carries a penalty');
  run.start(car); pickup(run, car); car.speed = 25; car.drifting = true; run.update(.7, car);
  assert.equal(run.tips, 5, 'restart clears crash recovery');
});

test('long fares return more time than short fares and the shift still has a ceiling', () => {
  const complete = (length, timeLeft = 30) => {
    const run = new TaxiRun(), car = player(); run.start(car); pickup(run, car);
    run.fare.length = length; run.timeLeft = timeLeft;
    Object.assign(car, { s: run.target.s, u: run.target.u }); run.update(.5, car);
    assert.equal(run.delivered, 1); assert.ok(run.cash > 0);
    return run;
  };
  const short = complete(300), long = complete(1000);
  assert.equal(short.timeLeft, 47.5, 'short fares keep the original time reward');
  assert.ok(long.timeLeft >= short.timeLeft + 8 && long.timeLeft <= short.timeLeft + 12);
  assert.match(long.drainEvents().find(e => e.kind === 'paid').text, /\+28s/);
  assert.equal(complete(1100, 119).timeLeft, 120);
});
