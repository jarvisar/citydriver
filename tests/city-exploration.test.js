import { blockStreets } from '../src/world/city-streets.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityBlock, cityStreetAt, cityRiverAt, CITY_BLOCK, ROAD_HALF_WIDTH } from '../src/world/city-grid.js';
import { landmarkForBlock, PLACE_TYPES } from '../src/world/city-places.js';
import { CitydriverWorld } from '../src/world/citydriver-world.js';
import { CityExploration, nearbyPlaces, placeRoute, routeDistance } from '../src/city-exploration.js';
import { walkerPose } from '../src/world/city-life.js';
import { cityLayout, cityLogical } from '../src/world/city-layout.js';

test('every three-by-three neighbourhood has one reproducible landmark on dry land', () => {
  const types = new Set();
  for (let rx = -12; rx <= 12; rx++) for (let rz = -12; rz <= 12; rz++) {
    const landmarks = [];
    for (let dx = 0; dx < 3; dx++) for (let dz = 0; dz < 3; dz++) {
      const ix = rx * 3 + dx, iz = rz * 3 + dz, type = landmarkForBlock(ix, iz), block = cityBlock(ix, iz);
      assert.equal(type, landmarkForBlock(ix, iz));
      if (type) {
        landmarks.push(block); types.add(type);
        assert.equal(block.kind, 'landmark');
        const p = cityLayout((iz + .5) * CITY_BLOCK, (ix + .5) * CITY_BLOCK);
        assert.equal(cityRiverAt(p.u, p.s), null);
      }
    }
    assert.equal(landmarks.length, 1, `neighbourhood ${rx},${rz}`);
  }
  assert.equal(types.size, PLACE_TYPES.length);
});

test('suggested routes stay on connected streets and bridge decks across all quadrants', () => {
  const direct = placeRoute(-3, 21, { s: 56, u: 56 });
  assert.equal(routeDistance(direct), 38, 'the destination street needs no detour back to an intersection');
  for (const [s, u] of [[35, 3], [-305, -3], [-3, 394], [-224 + 3, -678]]) {
    for (const place of nearbyPlaces(s, u, 6)) {
      const points = placeRoute(s, u, place);
      assert.ok(routeDistance(points) >= Math.hypot(points.at(-1).s - s, points.at(-1).u - u));
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        assert.ok(Math.hypot(b.s - a.s, b.u - a.u) <= 12, 'route legs sample bends closely');
        for (let n = 0; n <= 50; n++) {
          const s = a.s + (b.s - a.s) * n / 50, u = a.u + (b.u - a.u) * n / 50;
          const road = cityStreetAt(s, u);
          assert.ok(road.onRoad); assert.ok(!cityRiverAt(u, s) || road.bridge);
        }
      }
      assert.deepEqual(points.at(-1), place.entrance);
    }
  }
});

test('landmark stamps require an active drive near the road and persist once per type', () => {
  const memory = new Map(), storage = { getItem: k => memory.get(k), setItem: (k, v) => memory.set(k, v) };
  const guide = new CityExploration(storage), places = nearbyPlaces(0, 0, 20);
  for (const type of PLACE_TYPES) {
    const place = places.find(p => p.type === type); assert.ok(place);
    const { s, u } = cityLayout(place.logicalS - 59, place.logicalU);
    assert.deepEqual(guide.update(s, u, false), [], 'menus and attract mode cannot collect stamps');
    assert.deepEqual(guide.update(place.s, place.u), [], 'cutting through a courtyard is not a drive-by');
    assert.equal(guide.update(s, u).length, 1);
    assert.deepEqual(guide.update(s, u), []);
  }
  assert.deepEqual([...new CityExploration(storage).found].sort(), [...PLACE_TYPES].sort());
  for (const value of ['not-json', '{}', '["unknown","clock","clock"]']) {
    const loaded = new CityExploration({ getItem: () => value, setItem: () => { throw new Error('unavailable'); } });
    assert.ok(loaded.found.size <= 1);
    const place = places.find(p => p.type === 'garden');
    assert.doesNotThrow(() => loaded.update(place.s - 59, place.u));
  }
});

test('destinations can be cycled, selected by type, and refreshed after resetting far away', () => {
  const guide = new CityExploration(); guide.update(0, 3, false);
  const first = guide.target; guide.next(0, 3); assert.notEqual(guide.target.id, first.id);
  const type = guide.places.at(-1).type; guide.next(0, 3, type); assert.equal(guide.target.type, type);
  const target = guide.target;
  assert.equal(guide.next(0, 3, 'missing-type'), null); assert.equal(guide.target, target);
  guide.update(-42000, 19000, false);
  assert.ok(Math.hypot(guide.target.s + 42000, guide.target.u - 19000) < 2000);
  const entrance = cityLayout(guide.target.logicalS - 59, guide.target.logicalU);
  guide.update(entrance.s, entrance.u);
  assert.ok(guide.justArrived);
  const arrived = guide.justArrived.id;
  guide.update(guide.target.s - 200, guide.target.u);
  assert.equal(guide.justArrived, null); assert.notEqual(guide.target.id, arrived);
});

test('all landmark geometry streams with colliders clear of roads and stable distant silhouettes', () => {
  const world = new CitydriverWorld(new THREE.Scene()), places = nearbyPlaces(0, 0, 20);
  try {
    for (const type of PLACE_TYPES) {
      const place = places.find(p => p.type === type);
      world.update(place.s, place.u);
      const chunk = world.chunks.get(place.id);
      assert.equal(chunk.features.discoveries[0].type, type);
      assert.ok(chunk.group.getObjectByName(`citydriver-sign-${type}`));
      const { west, east, south, north } = blockStreets(chunk.ix, chunk.iz);
      for (const collider of chunk.features.colliders) {
        if (collider.kind === 'median-tree') continue;
        const corners = collider.corners ?? [{ x: collider.x, z: collider.z }];
        for (const corner of corners) {
          const p = cityLogical(-corner.z, corner.x), x = p.u - chunk.east, s = p.s - chunk.start;
          const margin = collider.corners ? 0 : collider.reach;
          assert.ok(x - margin > west.halfWidth && x + margin < CITY_BLOCK - east.halfWidth);
          assert.ok(s - margin > south.halfWidth && s + margin < CITY_BLOCK - north.halfWidth);
        }
      }
      world.animate(0);
      const positions = chunk.peopleMesh.instanceMatrix.array.slice();
      world.animate(15); assert.notDeepEqual(chunk.peopleMesh.instanceMatrix.array, positions);
      assert.ok(world.distantGroup.children.length <= 36);
      world.update(place.s + CITY_BLOCK * 4, place.u);
      assert.equal(world.distantChunks.get(place.id).plan.landmark, type);
    }
  } finally { world.dispose(); }
  assert.equal(world.scene.children.length, 0);
});

test('animated residents remain on dry pavements through loops and large times', () => {
  for (const river of [true, false]) for (const side of [0, 1]) for (let time = 0; time < 3000; time += 13) {
    const pose = walkerPose({ side, phase: 67, speed: .93 }, time, river);
    assert.ok(pose.x > ROAD_HALF_WIDTH && pose.x < CITY_BLOCK - ROAD_HALF_WIDTH);
    assert.ok(pose.s > ROAD_HALF_WIDTH && pose.s < CITY_BLOCK - ROAD_HALF_WIDTH);
    if (river) assert.ok(pose.x < 28 || pose.x > 84);
  }
});
