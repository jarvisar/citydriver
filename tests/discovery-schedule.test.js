import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscoverySchedule, METERS_PER_MILE } from '../src/world/discovery-schedule.js';

const place = (kind, index, s) => ({ kind, index, s });

test('changing one discovery mileage changes its rate without changing another kind\'s approximate rate', () => {
  const distance = 20000 * METERS_PER_MILE;
  const measure = miles => {
    const sites = createDiscoverySchedule(miles, {}, 8001, place).discoveries(-distance / 2, distance / 2);
    return Object.fromEntries(Object.keys(miles).map(kind => [kind, sites.filter(site => site.kind === kind).length]));
  };
  const before = measure({ tower: 10, farm: 10 });
  const after = measure({ tower: 5, farm: 10 });
  assert.ok(after.tower / before.tower > 1.9 && after.tower / before.tower < 2.1);
  assert.ok(after.farm / before.farm > .95 && after.farm / before.farm < 1.05);
});

test('districts are stable across cache eviction, reverse streaming, negative coordinates and exact boundaries', () => {
  const schedule = createDiscoverySchedule({ tower: 5, farm: 10 }, {}, 8011, place);
  const first = -1000000, last = 1000000;
  const whole = schedule.discoveries(first, last);
  const streamed = [];
  for (let end = last; end > first; end -= 2579) streamed.push(...schedule.discoveries(Math.max(first, end - 2579), end));
  assert.deepEqual(streamed.sort((a, b) => a.s - b.s), whole);
  for (const site of whole.filter((_, i) => i % 41 === 0)) {
    assert.deepEqual(schedule.discoveries(site.s, site.s + 1), [site]);
    assert.deepEqual(schedule.discoveries(site.s - 1, site.s), []);
  }
});

test('Infinity disables an individual discovery or the entire list', () => {
  const schedule = createDiscoverySchedule({ tower: Infinity, farm: 10 }, {}, 8021, place);
  const sites = schedule.discoveries(-100000, 100000);
  assert.ok(sites.length > 0 && sites.every(site => site.kind === 'farm'));
  const disabled = createDiscoverySchedule({ tower: Infinity }, {}, 8021, () => assert.fail('must not try to place disabled discoveries'));
  assert.deepEqual(disabled.discoveries(-100000, 100000), []);
  for (const miles of [0, -1, NaN]) assert.throws(() => createDiscoverySchedule({ tower: miles }, {}, 8021, place), RangeError);
});

test('aggressive frequency edits still leave room for structures and reject searches outside their district', () => {
  const schedule = createDiscoverySchedule({ tower: .01, farm: .02 }, {}, 8031,
    (kind, index, s) => place(kind, index, s + (index % 2 ? -1 : 1) * 700));
  const sites = schedule.discoveries(-100000, 100000);
  assert.ok(sites.length > 30);
  for (let i = 1; i < sites.length; i++) assert.ok(sites[i].s - sites[i - 1].s >= 900);
  const escaped = createDiscoverySchedule({ tower: .01 }, {}, 8031, (kind, index, s) => place(kind, index, s + 2000));
  assert.deepEqual(escaped.discoveries(-100000, 100000), []);
});
