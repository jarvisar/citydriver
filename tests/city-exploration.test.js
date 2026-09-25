import { blockStreets } from '../src/world/city-streets.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityBlock, cityStreetAt, cityRiverAt, CITY_BLOCK, ROAD_HALF_WIDTH } from '../src/world/city-grid.js';
import { landmarkForBlock, PLACE_TYPES, REPEATING_LANDMARK_TYPES, CITY_HALL_BLOCK, LANDMARK_SPACING, destinationType } from '../src/world/city-places.js';
import { cityRiverAxes } from '../src/world/city-waterways.js';
import { randomAt } from '../src/world/route.js';
import { CitydriverWorld } from '../src/world/citydriver-world.js';
import { CityExploration, placeForBlock, nearbyPlaces, placeRoute, routeDistance } from '../src/city-exploration.js';
import { walkerPose } from '../src/world/city-life.js';
import { cityLayout, cityLogical } from '../src/world/city-layout.js';

test('every four-by-four neighbourhood has one reproducible landmark on dry land', () => {
  const types = new Set();
  for (let rx = -12; rx <= 12; rx++) for (let rz = -12; rz <= 12; rz++) {
    const landmarks = [];
    for (let dx = 0; dx < LANDMARK_SPACING; dx++) for (let dz = 0; dz < LANDMARK_SPACING; dz++) {
      const ix = rx * LANDMARK_SPACING + dx, iz = rz * LANDMARK_SPACING + dz, type = landmarkForBlock(ix, iz), block = cityBlock(ix, iz);
      assert.equal(type, landmarkForBlock(ix, iz));
      if (type) {
        landmarks.push(block); types.add(type);
        assert.equal(block.kind, 'landmark');
        const p = cityLayout((iz + .5) * CITY_BLOCK, (ix + .5) * CITY_BLOCK);
        assert.equal(cityRiverAt(p.u, p.s), null);
      }
    }
    const civicRegion = Math.floor(CITY_HALL_BLOCK.ix / LANDMARK_SPACING) === rx && Math.floor(CITY_HALL_BLOCK.iz / LANDMARK_SPACING) === rz;
    if (civicRegion) assert.ok(landmarks.length === 1 || landmarks.length === 2, 'City Hall may replace a park in the same region');
    else assert.equal(landmarks.length, 1, `neighbourhood ${rx},${rz}`);
  }
  assert.equal([...types].filter(t => t !== 'cityhall').length, REPEATING_LANDMARK_TYPES.length);
});

test('ordinary building blocks increase by roughly 30 percent while parks and plazas remain varied', () => {
  let previousBuildings = 0, buildings = 0, parks = 0, plazas = 0;
  // Baseline: the 3x3 landmark / 20% public-space distribution over the same
  // coordinates, river exclusions and seed.
  for (let ix = -100; ix < 100; ix++) for (let iz = -100; iz < 100; iz++) {
    const river = cityRiverAxes(ix, iz), block = cityBlock(ix, iz);
    if (river.north || river.east) { assert.equal(block.kind, 'river'); continue; }
    const rx = Math.floor(ix / 3), rz = Math.floor(iz / 3);
    let x = Math.floor(randomAt(rx, rz + 7200) * 3), z = Math.floor(randomAt(rx, rz + 7201) * 3);
    if (cityRiverAxes(rx * 3 + x, rz * 3 + z).north) x = (x + 1) % 3;
    if (cityRiverAxes(rx * 3 + x, rz * 3 + z).east) z = (z + 1) % 3;
    const wasLandmark = ((ix % 3 + 3) % 3 === x && (iz % 3 + 3) % 3 === z);
    if (!wasLandmark && randomAt(ix, iz + 7103) >= .2) previousBuildings++;
    if (block.kind === 'blocks') buildings++;
    if (block.kind === 'park') parks++;
    if (block.kind === 'plaza') plazas++;
  }
  assert.ok(buildings / previousBuildings > 1.28 && buildings / previousBuildings < 1.32);
  assert.ok(parks > 100 && plazas > 100);
  assert.ok(parks / (parks + plazas) > .6 && parks / (parks + plazas) < .7);
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
      // Interpolation can differ by a last floating-point bit at the endpoint.
      assert.ok(Math.hypot(points.at(-1).s - place.entrance.s, points.at(-1).u - place.entrance.u) < 1e-9);
    }
  }
});

test('landmark stamps require an active drive near the road and persist once per type', () => {
  const memory = new Map(), storage = { getItem: k => memory.get(k), setItem: (k, v) => memory.set(k, v) };
  const guide = new CityExploration(storage), places = nearbyPlaces(0, 0, 20).filter(p => p.type !== 'cityhall').concat(placeForBlock(cityBlock(CITY_HALL_BLOCK.ix, CITY_HALL_BLOCK.iz)));
  for (const type of PLACE_TYPES) {
    const place = places.find(p => p.type === type); assert.ok(place);
    const { s, u } = cityLayout(place.logicalS - 59, place.logicalU);
    assert.deepEqual(guide.update(s, u, false), [], 'menus and attract mode cannot collect stamps');
    assert.deepEqual(guide.update(place.s, place.u), [], 'cutting through a courtyard is not a drive-by');
    const wasFound = guide.found.has(type), discoveries = guide.update(s, u);
    assert.equal(discoveries.filter(p => p.type === type).length, wasFound ? 0 : 1);
    assert.ok(guide.found.has(type), `${type} is discoverable at its entrance`);
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

test('the expanded notebook preserves old stamps and can route to every new destination category', () => {
  const existing = ['clock', 'market', 'garden', 'depot', 'art', 'cinema', 'hotel', 'museum', 'station', 'library', 'hospital', 'observatory', 'music', 'sports', 'firehouse', 'park', 'plaza'];
  const guide = new CityExploration({ getItem: () => JSON.stringify(existing) });
  assert.equal(PLACE_TYPES.length, 22);
  assert.deepEqual([...guide.found], existing, 'all seventeen existing stamps survive');
  for (const type of ['postoffice', 'bathhouse', 'farmersmarket', 'donut', 'cityhall']) assert.ok(!guide.found.has(type), 'new stamps start uncollected');
  const completed = new CityExploration({ getItem: () => JSON.stringify([...existing, 'postoffice', 'bathhouse', 'farmersmarket']) });
  assert.equal(completed.found.size, 20, 'the completed twenty-place notebook survives the donut shop addition');
  assert.ok(!completed.found.has('donut'));
  const beforeCityHall = new CityExploration({ getItem: () => JSON.stringify([...completed.found, 'donut']) });
  assert.equal(beforeCityHall.found.size, 21, 'all twenty-one stamps survive the City Hall addition');
  assert.ok(!beforeCityHall.found.has('cityhall'));
  const destinations = nearbyPlaces(0, 3);
  assert.ok(destinations.some(p => p.type === 'park'));
  assert.ok(destinations.some(p => p.type === 'plaza'));
  for (const type of PLACE_TYPES) {
    const destination = guide.next(0, 3, type);
    assert.equal(destination?.type, type);
    assert.ok(destination.name && destination.district && destination.design);
    const route = placeRoute(0, 3, destination);
    assert.deepEqual(route.at(-1), destination.entrance);
    assert.ok(cityStreetAt(destination.entrance.s, destination.entrance.u).onRoad);
  }
});

test('all landmark geometry streams with colliders clear of roads and stable distant silhouettes', () => {
  const world = new CitydriverWorld(new THREE.Scene()), places = nearbyPlaces(0, 0, 20).filter(p => p.type !== 'cityhall').concat(placeForBlock(cityBlock(CITY_HALL_BLOCK.ix, CITY_HALL_BLOCK.iz)));
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
      assert.equal(destinationType(world.distantChunks.get(place.id).plan), type);
    }
  } finally { world.dispose(); }
  assert.equal(world.scene.children.length, 0);
});

test('animated residents remain on dry pavements through loops and large times', () => {
  for (const direction of [-1, 1]) for (const river of [true, false]) for (const side of [0, 1]) for (let time = 0; time < 3000; time += 13) {
    const pose = walkerPose({ side, phase: 67, speed: .93, direction }, time, river);
    assert.ok(pose.x > ROAD_HALF_WIDTH && pose.x < CITY_BLOCK - ROAD_HALF_WIDTH);
    assert.ok(pose.s > ROAD_HALF_WIDTH && pose.s < CITY_BLOCK - ROAD_HALF_WIDTH);
    if (river) assert.ok(pose.x < 28 || pose.x > 84);
  }
});

test('residents face their travel direction and ease through block corners in both directions', () => {
  for (const direction of [-1, 1]) for (const river of [false, true]) {
    for (const phase of [0, 10, 45, 72, 83, 144, 166, 249, 331.9]) for (const time of [0, 20, 3000]) {
      const walker = { phase, speed: 1, side: 0, direction };
      const a = walkerPose(walker, time, river), b = walkerPose(walker, time + .0001, river);
      const dx = b.x - a.x, ds = b.s - a.s, distance = Math.hypot(dx, ds);
      const facing = (-Math.sin(a.yaw) * dx + Math.cos(a.yaw) * ds) / distance;
      assert.ok(facing > .7, `faces travel through corners and river turnarounds: ${JSON.stringify({ direction, river, phase, time, facing })}`);
    }
    if (!river) for (const phase of [0, 83, 166, 249, 332]) {
      const walker = { phase, speed: 1, side: 0, direction };
      const before = walkerPose(walker, -.001), after = walkerPose(walker, .001);
      assert.ok(Math.cos(after.yaw - before.yaw) > .999, 'corners turn continuously, including the loop seam');
    }
  }
});
