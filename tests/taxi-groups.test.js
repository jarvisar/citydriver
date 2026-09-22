import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TaxiRun, STOP_SECONDS, GROUP_MAX_LEG, GROUP_MAX_DETOUR, taxiRoute, deliverySeconds } from '../src/taxi-run.js';
import { TaxiView } from '../src/taxi-view.js';
import { routeDistance } from '../src/city-exploration.js';
import { cityLayout } from '../src/world/city-layout.js';
import { cityStreetAt } from '../src/world/city-grid.js';

const player = () => ({ s: 25, u: 3, heading: 0, speed: 0 });
function groupRun(split = true, storage = null) {
  const run = new TaxiRun(storage), car = player();
  for (let s = -750; s <= 750; s += 250) for (let u = -750; u <= 750; u += 250) {
    Object.assign(car, cityLayout(s, u)); run.start(car);
    const group = run.customers.find(c => c.passengers > 1 && c.stops.length === (split ? 2 : 1) && c.id !== run.blockedPickup?.id);
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

test('seeded groups have compact, forward-moving road routes and a mix of party sizes', () => {
  const run = new TaxiRun(), car = player(), offers = new Map();
  for (const center of [0, -500, 500, -20000, 400000]) {
    for (const offset of [-250, 0, 250]) {
      Object.assign(car, cityLayout(center + offset, center)); run.start(car);
      for (const offer of run.customers) offers.set(offer.id, offer);
    }
  }
  assert.deepEqual(new Set([...offers.values()].map(c => c.passengers)), new Set([1, 2, 3, 4]));
  const groups = [...offers.values()].filter(c => c.passengers > 1);
  assert.ok(groups.some(c => c.stops.length === 2));
  assert.ok(groups.filter(c => c.stops.length === 1).length > groups.length / 2, 'most groups are one quick shared drop-off');
  for (const offer of offers.values()) {
    assert.ok(offer.stops.length >= 1 && offer.stops.length <= 2);
    assert.equal(offer.stops.reduce((sum, s) => sum + s.passengers, 0), offer.passengers);
    assert.equal(offer.stops.reduce((sum, s) => sum + s.fare, 0), offer.fare);
    assert.equal(offer.destination, offer.stops[0].destination);
    assert.ok(offer.length >= 280 && offer.length <= 1100);
    let from = offer, actual = 0;
    for (const stop of offer.stops) {
      assert.ok(stop.passengers > 0);
      const road = cityStreetAt(stop.destination.s, stop.destination.u);
      assert.ok(road.onRoad && !road.median);
      const route = taxiRoute(from, stop.destination);
      actual += routeDistance(route);
      for (const p of route) assert.ok(cityStreetAt(p.s, p.u).onRoad, 'group routes stay on streets');
      from = stop.destination;
    }
    assert.ok(Math.abs(actual - offer.length) < 1e-6);
    if (offer.stops.length === 2) {
      const [first, last] = offer.stops;
      assert.ok(last.length <= GROUP_MAX_LEG, 'short by road, even around rivers');
      assert.ok(offer.length <= routeDistance(taxiRoute(offer, last.destination)) * GROUP_MAX_DETOUR);
      assert.ok((last.destination.s - first.destination.s) * (first.destination.s - offer.s)
        + (last.destination.u - first.destination.u) * (first.destination.u - offer.u) >= 0, 'no doubling back');
    }
  }
});

test('the whole group boards and leaves in the same short hold as one rider', () => {
  for (const hz of [30, 60, 120]) {
    const { run, car, group } = groupRun(false);
    car.speed = 8; run.update(.6, car); assert.equal(run.target, null);
    car.speed = 0;
    for (let i = 0; i < Math.ceil(STOP_SECONDS * hz) + 1; i++) run.update(1 / hz, car);
    assert.equal(run.status, 'driving'); assert.equal(run.onboard, group.passengers);
    run.boost = .1; run.timeLeft = 30; run.drainEvents();
    dropOff(run, car);
    assert.equal(run.status, 'pickup'); assert.equal(run.delivered, 1);
    assert.equal(run.deliveredPassengers, group.passengers); assert.equal(run.onboard, 0);
    const events = run.drainEvents(); assert.equal(events.length, 1);
    assert.equal(events[0].groupComplete, true); assert.equal(events[0].bonus, (group.passengers - 1) * 25);
    assert.equal(events[0].seconds, deliverySeconds(group.length));
    assert.equal(run.boost, .35); assert.ok(run.cash >= group.fare + group.groupBonus);
    run.update(.5, car); assert.equal(run.cash, events[0].paid, 'no repeat payout while parked');
  }
});

test('two stops advance automatically, preserve momentum and pay a bounded time reward', () => {
  const { run, car, group } = groupRun();
  const offer = structuredClone(group); run.update(STOP_SECONDS, car); run.drainEvents();
  run.tips = 17; run.combo = 3; run.comboTime = 3; run.boost = .1; run.timeLeft = 30;
  const limit = run.fareLeft;
  // Going to the future stop first must not cash in or scramble the route.
  Object.assign(car, group.stops[1].destination); run.update(.5, car);
  assert.equal(run.cash, 0); assert.equal(run.stopIndex, 0);
  dropOff(run, car);
  assert.equal(run.status, 'driving'); assert.equal(run.stopIndex, 1);
  assert.equal(run.target, group.stops[1].destination); assert.equal(run.onboard, group.stops[1].passengers);
  assert.equal(run.delivered, 0); assert.equal(run.deliveredPassengers, group.stops[0].passengers);
  assert.equal(run.tips, 0); assert.equal(run.combo, 3); assert.equal(run.comboTime, 4);
  assert.equal(run.hold, 0); assert.ok(run.fareLeft < limit, 'the party timer never resets');
  const first = run.drainEvents()[0]; assert.equal(first.bonus, 0); assert.equal(first.groupComplete, false);
  assert.equal(first.paid, group.stops[0].fare + 17 + Math.round(group.stops[0].fare * .5 * run.fareLeft / group.limit));
  assert.equal(run.remainingFare, group.stops[1].fare + group.groupBonus);
  run.update(.5, car); assert.equal(run.cash, first.paid); assert.equal(run.hold, 0);
  dropOff(run, car);
  const last = run.drainEvents()[0]; assert.equal(last.groupComplete, true); assert.equal(last.bonus, group.groupBonus);
  assert.equal(first.seconds + last.seconds, deliverySeconds(group.length) + 4);
  assert.equal(run.delivered, 1); assert.equal(run.deliveredPassengers, group.passengers);
  assert.equal(run.cash, first.paid + last.paid); assert.equal(run.fleet.balance, run.cash);
  assert.equal(run.target, null); assert.equal(run.onboard, 0);
  assert.deepEqual(group, offer, 'progress never mutates the seeded offer');
});

test('partial group earnings survive failure, shift expiry, restart and reload without a completion bonus', () => {
  for (const ending of ['late', 'expiry', 'restart', 'stop']) {
    const saved = new Map(), storage = { getItem: k => saved.get(k), setItem: (k, v) => saved.set(k, v) };
    const { run, car } = groupRun(true, storage);
    run.update(STOP_SECONDS, car); dropOff(run, car); run.drainEvents();
    const cash = run.cash, riders = run.deliveredPassengers;
    if (ending === 'late') { run.fareLeft = .01; run.update(.02, car); assert.equal(run.failed, 1); assert.equal(run.deliveredPassengers, riders); }
    if (ending === 'expiry') { run.timeLeft = .01; run.update(.02, car); assert.equal(run.status, 'over'); }
    if (ending === 'restart') { run.start(car); assert.equal(run.deliveredPassengers, 0); assert.equal(run.stopIndex, 0); }
    if (ending === 'stop') run.stop();
    assert.equal(run.onboard, 0); assert.equal(run.target, null); assert.equal(run.delivered, 0);
    assert.equal(run.fleet.balance, cash); assert.equal(new TaxiRun(storage).fleet.balance, cash);
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
