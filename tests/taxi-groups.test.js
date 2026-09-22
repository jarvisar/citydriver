import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TaxiRun, STOP_SECONDS, GROUP_MAX_LEG, GROUP_MAX_DETOUR, GROUP_MAX_ROUTE, GROUP_MIN_TURN, MAX_SHIFT_SECONDS,
  RATINGS, GROUP_FARE_SHARE, taxiRoute, turnCosine, deliverySeconds, partySize } from '../src/taxi-run.js';
import { TaxiView } from '../src/taxi-view.js';
import { routeDistance } from '../src/city-exploration.js';
import { cityLayout } from '../src/world/city-layout.js';
import { cityStreetAt } from '../src/world/city-grid.js';

const player = () => ({ s: 25, u: 3, heading: 0, speed: 0 });
function groupRun(size = 2, storage = null) {
  const run = new TaxiRun(storage), car = player();
  for (let s = -750; s <= 750; s += 250) for (let u = -750; u <= 750; u += 250) {
    Object.assign(car, cityLayout(s, u)); run.start(car);
    const group = run.customers.find(c => c.passengers === size && c.id !== run.blockedPickup?.id);
    if (!group) continue;
    Object.assign(car, { s: group.s, u: group.u });
    return { run, car, group };
  }
  assert.fail('Expected a group offer in the sampled neighborhoods');
}
function dropOff(run, car) {
  Object.assign(car, { s: run.target.s, u: run.target.u, speed: 0 });
  run.update(STOP_SECONDS, car);
}

test('every rider in a seeded party has their own stop along a compact, forward-moving road route', () => {
  const run = new TaxiRun(), car = player(), offers = new Map();
  for (const center of [0, -500, 500, -20000, 400000]) {
    for (const offset of [-250, 0, 250]) {
      Object.assign(car, cityLayout(center + offset, center)); run.start(car);
      for (const offer of run.customers) offers.set(offer.id, offer);
    }
  }
  assert.deepEqual(new Set([...offers.values()].map(c => c.passengers)), new Set([1, 2, 3, 4]));
  const sizes = [...offers.values()].map(c => c.passengers);
  assert.ok(sizes.filter(n => n > 1).length > sizes.length / 4, 'shared rides are a regular choice');
  for (const offer of offers.values()) {
    assert.ok(offer.passengers <= partySize(offer.fareSeed), 'a party only shrinks when a stop will not fit');
    assert.equal(offer.stops.length, offer.passengers, 'one stop per rider');
    assert.equal(new Set(offer.stops.map(s => s.destination.id)).size, offer.passengers, 'no shared destinations');
    assert.equal(offer.stops.reduce((sum, s) => sum + s.fare, 0), offer.fare);
    assert.equal(offer.fare, Math.round((40 + offer.length * .28) * (1 + (offer.passengers - 1) * GROUP_FARE_SHARE)), 'each extra rider adds a fifth');
    assert.equal(offer.destination, offer.stops[0].destination);
    assert.ok(offer.stops[0].length >= 280 && offer.stops[0].length <= 1100);
    assert.ok(offer.length <= GROUP_MAX_ROUTE);
    let from = offer, previous = null, actual = 0;
    for (const stop of offer.stops) {
      assert.equal(stop.passengers, 1);
      const road = cityStreetAt(stop.destination.s, stop.destination.u);
      assert.ok(road.onRoad && !road.median);
      const route = taxiRoute(from, stop.destination);
      actual += routeDistance(route);
      for (const p of route) assert.ok(cityStreetAt(p.s, p.u).onRoad, 'group routes stay on streets');
      if (previous) {
        assert.ok(stop.length <= GROUP_MAX_LEG, 'short by road, even around rivers');
        assert.ok(stop.length <= Math.hypot(stop.destination.s - from.s, stop.destination.u - from.u) * GROUP_MAX_DETOUR);
        assert.ok(turnCosine(previous, from, stop.destination) >= GROUP_MIN_TURN, 'no doubling back');
      }
      previous = from; from = stop.destination;
    }
    assert.ok(Math.abs(actual - offer.length) < 1e-6);
  }
});

test('the whole party boards in the same short hold as one rider', () => {
  for (const hz of [30, 60, 120]) {
    const { run, car, group } = groupRun(4);
    car.speed = 8; run.update(.6, car); assert.equal(run.target, null);
    car.speed = 0;
    for (let i = 0; i < Math.ceil(STOP_SECONDS * hz) + 1; i++) run.update(1 / hz, car);
    assert.equal(run.status, 'driving'); assert.equal(run.onboard, group.passengers);
    assert.equal(run.target, group.stops[0].destination);
  }
});

test('a solo rider pays out in one stop with no group bonus', () => {
  const { run, car, group } = groupRun(1);
  run.update(STOP_SECONDS, car); run.boost = .1; run.timeLeft = 30; run.drainEvents();
  dropOff(run, car);
  assert.equal(run.status, 'pickup'); assert.equal(run.delivered, 1); assert.equal(run.onboard, 0);
  const events = run.drainEvents(); assert.equal(events.length, 1);
  assert.equal(events[0].groupComplete, false); assert.equal(events[0].bonus, 0);
  assert.equal(events[0].rating, 'speedy'); assert.match(events[0].text, /^Speedy! /);
  assert.equal(events[0].seconds, deliverySeconds(group.length, RATINGS[0]));
  assert.equal(run.boost, .1, 'only shared rides refill boost');
  run.update(.5, car); assert.equal(run.cash, events[0].paid, 'no repeat payout while parked');
});

test('a group shares one clock, is rated at every stop and is paid in full at the last', () => {
  const { run, car, group } = groupRun(4);
  const offer = structuredClone(group); run.update(STOP_SECONDS, car); run.drainEvents();
  run.boost = .1; run.timeLeft = 30; run.tips = 17; run.combo = 3; run.comboTime = 3;
  assert.equal(run.fareLeft, group.stops[0].limit); assert.equal(run.legElapsed, 0);
  // Going to a future stop first must not cash in or scramble the route.
  Object.assign(car, group.stops[2].destination); run.update(.5, car);
  assert.equal(run.cash, 0); assert.equal(run.stopIndex, 0);
  // Arrive with the clock in a different colour each time: green, yellow, red, green.
  const arrivals = [.9, .4, .1, .6], expected = ['speedy', 'normal', 'slow', 'speedy'];
  let held = 0, clock = run.timeLeft;
  for (const [index, stop] of group.stops.entries()) {
    const last = index === group.stops.length - 1;
    run.legElapsed = stop.limit * (1 - arrivals[index]) - STOP_SECONDS;
    const left = run.fareLeft - STOP_SECONDS;
    dropOff(run, car);
    const event = run.drainEvents()[0], rating = RATINGS.find(r => r.id === expected[index]);
    held += stop.fare + Math.round(stop.fare * .5 * arrivals[index]);
    assert.equal(event.rating, rating.id);
    assert.equal(event.seconds, last ? deliverySeconds(group.length, rating) : rating.riderSeconds,
      "riders stepping out early add a rating bonus; the route's time lands at the last stop");
    clock = Math.min(MAX_SHIFT_SECONDS, clock - STOP_SECONDS + event.seconds); assert.ok(Math.abs(run.timeLeft - clock) < 1e-9);
    assert.equal(run.deliveredPassengers, index + 1);
    if (last) {
      assert.equal(event.kind, 'paid'); assert.equal(event.groupComplete, true); assert.equal(event.bonus, group.groupBonus);
      assert.equal(event.paid, held + 17 + group.groupBonus, 'every share, time bonus fare and tip arrives together');
      assert.equal(run.cash, event.paid); assert.match(event.text, new RegExp(`^Group complete · Speedy! · \\+\\$${event.paid} · \\+${event.seconds}s$`));
      break;
    }
    assert.equal(event.kind, 'dropoff'); assert.equal(event.paid, 0); assert.equal(run.cash, 0, 'nothing is paid until everyone arrives');
    assert.equal(run.held, held); assert.match(event.text, new RegExp(`^Rider ${index + 1} of 4 · `));
    assert.equal(run.status, 'driving'); assert.equal(run.stopIndex, index + 1);
    assert.equal(run.target, group.stops[index + 1].destination); assert.equal(run.onboard, group.passengers - index - 1);
    assert.ok(Math.abs(run.fareLeft - (left + group.stops[index + 1].limit)) < 1e-9, 'time left over carries to the next rider');
    assert.equal(run.legElapsed, 0, "the next rider's rating starts fresh");
    assert.equal(run.tips, 17, 'tips ride along until the group pays'); assert.equal(run.combo, 3); assert.equal(run.comboTime, 4);
    assert.equal(run.remainingFare, held + group.stops.slice(index + 1).reduce((sum, s) => sum + s.fare, 0) + group.groupBonus);
    run.update(.5, car); assert.equal(run.cash, 0, 'no payout while parked'); assert.equal(run.hold, 0);
    run.timeLeft = clock; run.comboTime = 3;
  }
  assert.deepEqual(run.ratings, { speedy: 2, normal: 1, slow: 1 });
  assert.equal(run.boost, 1, 'each group drop-off refills a quarter of the boost');
  assert.equal(run.delivered, 1); assert.equal(run.deliveredPassengers, group.passengers); assert.equal(run.held, 0);
  assert.equal(run.fleet.balance, run.cash); assert.equal(run.target, null); assert.equal(run.onboard, 0);
  assert.deepEqual(group, offer, 'progress never mutates the seeded offer');
});

test('stunt tips multiply by every rider aboard', () => {
  const { run, car, group } = groupRun(3);
  run.update(STOP_SECONDS, car); run.drainEvents(); run.tips = 0;
  run.combo = 2; run.reward('Drift', 5);
  assert.equal(run.tips, 5 * 2 * group.passengers); assert.equal(run.tipMultiplier, 3 * group.passengers);
  assert.deepEqual(run.drainEvents().map(e => e.text), [`Drift +$${5 * 2 * group.passengers}`]);
  dropOff(run, car); run.drainEvents(); run.combo = 1;
  const before = run.tips; run.reward('Near miss', 10);
  assert.equal(run.tips - before, 10 * (group.passengers - 1), 'fewer riders, smaller tips');
});

test('a group pays nothing unless every rider arrives, whatever ends the ride', () => {
  for (const ending of ['late', 'expiry', 'restart', 'stop']) {
    const saved = new Map(), storage = { getItem: k => saved.get(k), setItem: (k, v) => saved.set(k, v) };
    const { run, car } = groupRun(2, storage);
    run.update(STOP_SECONDS, car); dropOff(run, car); run.drainEvents();
    assert.equal(run.cash, 0); assert.ok(run.held > 0);
    const owed = run.remainingFare + run.tips, riders = run.deliveredPassengers;
    if (ending === 'late') {
      run.fareLeft = .01; run.update(.02, car); assert.equal(run.failed, 1); assert.equal(run.deliveredPassengers, riders);
      assert.deepEqual(run.drainEvents().map(e => e.text), [`Too slow · Rider jumped out · $${owed} lost`]);
    }
    if (ending === 'expiry') { run.timeLeft = .01; run.update(.02, car); assert.equal(run.status, 'over'); }
    if (ending === 'restart') { run.start(car); assert.equal(run.deliveredPassengers, 0); assert.equal(run.stopIndex, 0); }
    if (ending === 'stop') run.stop();
    assert.equal(run.onboard, 0); assert.equal(run.target, null); assert.equal(run.delivered, 0);
    assert.equal(run.cash, 0); assert.equal(run.fleet.balance, 0); assert.equal(new TaxiRun(storage).fleet.balance, 0);
    assert.equal(run.drainEvents().filter(e => e.kind === 'paid').length, 0);
  }
});

test('waiting groups render the right number of riders in one draw and release instance buffers', () => {
  const { run, car } = groupRun(), view = new TaxiView(new THREE.Scene());
  try {
    view.render(run, car, 0, 1);
    assert.equal(view.markers.length, run.customers.length);
    for (const marker of view.markers) {
      assert.equal(marker.person.count, marker.stop.passengers);
      assert.equal(marker.person.isInstancedMesh, true);
      assert.ok(marker.person.instanceMatrix.array.every(Number.isFinite));
    }
    let disposed = 0;
    for (const marker of view.markers) marker.person.addEventListener('dispose', () => disposed++);
    const waitingCount = view.markers.length;
    run.update(STOP_SECONDS, car); view.render(run, car, 1024, 2);
    assert.equal(disposed, waitingCount); assert.equal(view.markers.length, 1);
    assert.equal(view.markers[0].person, null); assert.equal(view.markers[0].stop.id, run.target.id);
    dropOff(run, car); view.render(run, car, 1024, 3);
    assert.equal(view.markers.length, 1); assert.equal(view.markers[0].stop.id, run.target.id);
  } finally { view.dispose(); }
});
