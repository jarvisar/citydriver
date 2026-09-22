import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CityAutodrive } from '../src/city-autodrive.js';
import { DrivingController } from '../src/vehicle.js';
import { CITY_BLOCK as B, cityStreetProfile, cityStreetAt, citydriverRoute } from '../src/world/city-grid.js';
import { cityLanePose, cityLogical } from '../src/world/city-layout.js';
import { CitydriverWorld } from '../src/world/citydriver-world.js';
import { collideScenery } from '../src/collision.js';

test('autodrive completes left and right turns from every direction on varied and curved streets', () => {
  const player = new DrivingController(citydriverRoute, { s: 0 });
  const world = new CitydriverWorld(new THREE.Scene());
  player.freeDriving = true;
  try {
    for (const axis of ['north', 'east']) for (const direction of [-1, 1]) {
      for (const index of [-3, 0, 1, 2]) for (const crossing of [0, 3]) for (const side of [-1, 1]) {
        const profile = cityStreetProfile(axis, index);
        const lane = index * B + (axis === 'north' ? 1 : -1) * direction * profile.lane;
        Object.assign(player, cityLanePose(axis, lane, crossing * B - direction * 45, direction));
        player.speed = profile.speed; player.update(0, {});
        player.knock.x = player.knock.z = player.knock.spin = 0;
        const impacts = player.audioTelemetry.impactSerial;
        let decisions = 0;
        const pilot = new CityAutodrive({ random: () => decisions++ === 0 ? side < 0 ? .1 : .3 : .9 });
        let completed = 0;
        const label = `${axis}/${direction}, street ${index}, crossing ${crossing}, turn ${side}`;
        for (let tick = 0; tick < 1200 && completed < 150; tick++) {
          world.update(player.s, player.u);
          player.update(1 / 60, pilot.update(player, { enabled: false }));
          collideScenery(player, world.chunks, 1 / 60);
          const street = cityStreetAt(player.s, player.u);
          assert.ok(street.onRoad && !street.median, label);
          assert.equal(player.ground(player.s, player.u).blocked, false, label);
          if (pilot.path.axis !== axis) completed++;
        }
        assert.equal(completed, 150, label);
        assert.equal(player.audioTelemetry.impactSerial, impacts, label);
        assert.equal(pilot.path.direction, direction * side * (axis === 'north' ? 1 : -1), label);
        const p = cityLogical(player.s, player.u);
        assert.ok(Math.abs((pilot.path.axis === 'north' ? p.u : p.s) - pilot.path.lane) < .15, label);
      }
    }
  } finally { player.disposeModel(); world.dispose(); }
});

test('a planned turn waits at red lights without rerolling and reset clears it', () => {
  for (const choice of [.1, .3]) {
    let decisions = 0;
    const pilot = new CityAutodrive({ random: () => { decisions++; return choice; } });
    const player = { ...cityLanePose('north', 3, -45), speed: 0, stats: { topSpeed: 25 } };
    const traffic = { enabled: true, vehicles: [], time: 12 };
    pilot.update(player, traffic);
    Object.assign(player, cityLanePose('north', 3, -15));
    for (let tick = 0; tick < 120; tick++) assert.equal(pilot.update(player, traffic).touchDrive.amount, 0);
    assert.equal(decisions, 1);
    assert.equal(pilot.turn.active, false);
    traffic.time = 0;
    assert.ok(pilot.update(player, traffic).touchDrive.amount > 0);
    pilot.reset();
    assert.equal(pilot.turn, null); assert.equal(pilot.crossing, null);
  }
});

test('left turns yield to oncoming traffic before entering the curve', () => {
  const pilot = new CityAutodrive({ random: () => .1 });
  const player = { ...cityLanePose('north', 3, -45), speed: 0, stats: { topSpeed: 25 } };
  const traffic = { enabled: true, vehicles: [], time: 0 };
  pilot.update(player, traffic);
  Object.assign(player, cityLanePose('north', 3, pilot.turn.start - 3));
  traffic.vehicles = [{ ...cityLanePose('north', -3, 20, -1), axis: 'north', direction: -1, speed: 12 }];
  assert.equal(pilot.update(player, traffic).touchDrive.amount, 0);
  traffic.vehicles = [];
  assert.ok(pilot.update(player, traffic).touchDrive.amount > 0);
});

test('straight decisions and joining inside a junction keep the current street', () => {
  for (const [along, choice] of [[-45, .9], [-5, .1]]) {
    const pilot = new CityAutodrive({ random: () => choice });
    pilot.update({ ...cityLanePose('north', 3, along), stats: { topSpeed: 25 } }, { enabled: false });
    assert.equal(pilot.turn, null);
    assert.equal(pilot.path.axis, 'north');
  }
});
