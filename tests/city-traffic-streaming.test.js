import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CityTraffic } from '../src/city-traffic.js';
import { citydriverRoute } from '../src/world/city-grid.js';
import { cityLanePose } from '../src/world/city-layout.js';

// Move an unobstructed observer along real streets so collisions cannot mask
// streaming gaps by slowing the test drive down.
function observer() {
  return { s: 0, u: 3, groundedPosition: { x: 1e9, z: 1e9 } };
}

test('fast drives keep traffic on the road ahead in all four directions', () => {
  for (const speed of [28, 50, 60]) for (const axis of ['north', 'east']) for (const direction of [-1, 1]) {
    const player = observer(), traffic = new CityTraffic(new THREE.Scene(), citydriverRoute, 0);
    try {
      const lane = (axis === 'north' ? 3 : -3) * direction;
      Object.assign(player, cityLanePose(axis, lane, 0, direction));
      traffic.reset(citydriverRoute, player.s, 'city', player.u);
      const fleet = [...traffic.vehicles];
      let emptyTime = 0, longestEmpty = 0;
      for (let tick = 1; tick <= 90 * 30; tick++) {
        Object.assign(player, cityLanePose(axis, lane, direction * tick * speed / 30, direction));
        traffic.update(1 / 30, player);
        const cos = Math.cos(player.heading), sin = Math.sin(player.heading);
        const ahead = traffic.vehicles.some(car => {
          const ds = car.s - player.s, du = car.u - player.u;
          const forward = ds * cos + du * sin, beside = Math.abs(du * cos - ds * sin);
          return forward > 0 && forward < 220 && beside < 25;
        });
        if (tick > 10 * 30) {
          emptyTime = ahead ? 0 : emptyTime + 1 / 30;
          longestEmpty = Math.max(longestEmpty, emptyTime);
        }
      }
      assert.ok(longestEmpty < 4, `${axis}/${direction} at ${speed} m/s: road ahead empty for ${longestEmpty.toFixed(1)} seconds`);
      assert.deepEqual(traffic.vehicles, fleet, 'streaming reuses the existing fleet');
    } finally { traffic.dispose(); }
  }
});

test('recycling follows turns and reverse travel while preserving nearby cars and safe spawn gaps', () => {
  const player = observer(), traffic = new CityTraffic(new THREE.Scene(), citydriverRoute, 0);
  try {
    let spawns = 0;
    const spawn = traffic.spawn.bind(traffic);
    traffic.spawn = (car, s, u, initial = false) => {
      const previousDistance = Math.hypot(car.s - s, car.u - u);
      const result = spawn(car, s, u, initial);
      if (!initial && result) {
        spawns++;
        assert.ok(previousDistance >= 170, 'nearby cars must remain continuous');
        assert.ok(Math.hypot(car.s - s, car.u - u) >= 170, 'new traffic appears at a distance');
        assert.ok(traffic.vehicles.every(other => other === car || Math.hypot(car.s - other.s, car.u - other.u) >= 13));
        assert.ok((car.s - s) * traffic.travelS + (car.u - u) * traffic.travelU >= 90, 'spawn ahead of actual travel');
        assert.deepEqual(car.previousPosition, car.position, 'recycling snaps interpolation');
      }
      return result;
    };
    // Heading deliberately remains north, including when backing south or
    // sliding sideways. Streaming must use movement rather than the bonnet.
    player.heading = 0;
    for (const [ds, du] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      for (let tick = 0; tick < 30 * 30; tick++) {
        player.s += ds * 45 / 30; player.u += du * 45 / 30;
        traffic.update(1 / 30, player);
      }
      assert.ok(traffic.vehicles.filter(car => (car.s - player.s) * ds + (car.u - player.u) * du > 0).length >= 8);
    }
    assert.ok(spawns > 100, 'the route exercises repeated recycling');
  } finally { traffic.dispose(); }
});
