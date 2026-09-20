import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CHUNK_LENGTH, positionAt } from '../src/world/route.js';
import { CITY_STEP, CITY_COLUMN_COUNT, KERB, cityColumns, cityVertex, cityHeight, cityGroundHeight, cityRoadHeight, pavementHeight, cityDrivingRoute,
  quayOffset, QUAY_NEAR, QUAY_FAR, QUAY_WALL, RIVER_LEVEL, RIVER_BED, FAR_BANK, FAR_BANK_TOP, farBankHeight, blockBoundary, blockAt, crossStreetAt, onCrossStreet,
  STREET_HALF_WIDTH, BANDS, BANK_ROADS, nearStreet, bankStreetRange, cityPosition, cityStreetHeight, bridgeSurfaceHeight } from '../src/world/city-route.js';
import { crossRoadHeight } from '../src/world/city-roads.js';
import { cityParkingForBlock, cityParkingWidth, cityParkingHeight } from '../src/world/city-parking.js';
import { CityWorld, CityChunk, lightning } from '../src/world/city.js';
import { dressSkyline } from '../src/world/city-architecture.js';
import { Rainfall } from '../src/world/rainfall.js';
import { DrivingController } from '../src/vehicle.js';

test('city terrain stays ordered, continuous, level under the road, and lower toward the camera', () => {
  for (let s = -10000; s < 10000; s += 13) {
    const columns = cityColumns(s);
    assert.equal(columns.length, CITY_COLUMN_COUNT);
    for (let col = 1; col < columns.length; col++) assert.ok(columns[col] > columns[col - 1] + .5, `columns cross at ${s}, ${col}`);
    for (const u of [-KERB, 0, KERB]) assert.equal(cityHeight(s, u), cityRoadHeight(s));
    // The quay wanders inside its range, and the wall drops from the promenade to the river bed.
    const q = quayOffset(s);
    assert.ok(q <= -QUAY_NEAR && q >= -QUAY_FAR, `quay out of range at ${s}`);
    assert.equal(cityGroundHeight(s, q), pavementHeight(s)); assert.ok(Math.abs(cityGroundHeight(s, q - QUAY_WALL) - RIVER_BED) < 1e-9);
    assert.equal(cityGroundHeight(s, (q + FAR_BANK) / 2), RIVER_BED);
    assert.ok(RIVER_LEVEL > RIVER_BED && RIVER_LEVEL < pavementHeight(s) - 2, 'the water stays well below the promenade');
    assert.ok(farBankHeight(s) > RIVER_LEVEL + 1.8);
    // Nothing on the near side rises into the line of sight to the road.
    for (const u of [-9, -15, -30, -60, -100, -140, -200, -400]) assert.ok(cityGroundHeight(s, u) - cityRoadHeight(s) < 1 - u * .1, `near side blocks the road at ${s}, ${u}`);
    for (const u of [-300, -135, -128, -60, -8, 9, 30, 120, 300, 520]) assert.ok(Math.abs(cityGroundHeight(s + .001, u) - cityGroundHeight(s - .001, u)) < .05, `height jump at ${s}, ${u}`);
    // The pavements stand one kerb above the road on both sides.
    for (const side of [-1, 1]) assert.ok(Math.abs(cityGroundHeight(s, side * 9) - cityRoadHeight(s) - .15) < 1e-9);
  }
  for (let chunk = -20; chunk < 40; chunk++) {
    const rows = CHUNK_LENGTH / CITY_STEP;
    for (let col = 0; col < CITY_COLUMN_COUNT; col++) assert.deepEqual(cityVertex(chunk * rows, col), cityVertex((chunk - 1) * rows + rows, col));
  }
  assert.deepEqual(cityDrivingRoute.bounds(0), [-5.9, 5.9]);
});

test('city bridge lanes and railings run straight between their existing bank connections', () => {
  for (let index = -120; index < 120; index++) {
    if (!nearStreet(index)) continue;
    for (const ds of [-8, -7.7, -2.7, 0, 2.7, 7.7, 8]) {
      const s = blockBoundary(index) + ds, near = quayOffset(s) + 1.5, far = FAR_BANK_TOP - 2;
      const a = positionAt(s, near, 24), b = positionAt(s, far, 24);
      assert.deepEqual(cityPosition(s, near, 24), a);
      assert.deepEqual(cityPosition(s, far, 24), b);
      for (let step = 1; step < 20; step++) {
        const t = step / 20, p = cityPosition(s, near + (far - near) * t, 24);
        assert.ok(Math.hypot(p.x - (a.x + (b.x - a.x) * t), p.z - (a.z + (b.z - a.z) * t)) < 1e-9,
          `curved bridge at street ${index}, lane ${ds}`);
      }
    }
  }
});

test('blocks tile the boulevard with cross streets on terrain rows', () => {
  for (let s = -6000; s < 6000; s += 5) {
    const block = blockAt(s);
    assert.ok(s >= blockBoundary(block) && s < blockBoundary(block + 1), `wrong block at ${s}`);
    assert.ok(blockBoundary(block) % CITY_STEP === 0, 'boundaries sit on terrain rows');
    assert.ok(blockBoundary(block + 1) - blockBoundary(block) >= 56 && blockBoundary(block + 1) - blockBoundary(block) <= 160);
    const street = crossStreetAt(s);
    assert.ok(street.center === blockBoundary(block) || street.center === blockBoundary(block + 1));
    const onStreet = Math.abs(s - street.center) < STREET_HALF_WIDTH;
    assert.equal(onCrossStreet(s, 30), onStreet);
    assert.equal(onCrossStreet(s, 3), false);
    if (!onStreet) assert.equal(onCrossStreet(s, -12), false);
  }
  assert.ok(BANDS.every((band, k) => band.back > band.front + 10 && (!k || band.front > BANDS[k - 1].back)));
});

test('city driving stays between the kerbs and a route swap restores the saved place', () => {
  const car = new DrivingController(cityDrivingRoute);
  for (let i = 0; i < 7200; i++) {
    car.update(1 / 60, { forward: true });
    assert.ok(Math.abs(car.u) < 5.91);
    assert.ok(Math.abs(car.car.position.y - cityHeight(car.s, car.u) - .13) < .0001);
  }
  assert.ok(car.distance > 3000);
  for (const side of ['left', 'right']) {
    const wanderer = new DrivingController(cityDrivingRoute);
    for (let i = 0; i < 3600; i++) {
      wanderer.update(1 / 60, { forward: true, [side]: true });
      assert.ok(Math.abs(wanderer.u) <= 5.9001 && Number.isFinite(wanderer.car.position.y));
    }
  }
  const saved = { s: car.s, distance: car.distance };
  car.setRoute(cityDrivingRoute, saved);
  assert.equal(car.s, saved.s); assert.equal(car.distance, saved.distance); assert.equal(car.speed, 0);
});

test('city chunks carry buildings, a river and street furniture, and the world streams and releases cleanly', () => {
  const scene = new THREE.Scene(), world = new CityWorld(scene);
  world.update(420); scene.updateMatrixWorld(true);
  assert.equal(scene.getObjectByName('city-storm-effects').children.length, 2);
  const names = new Set();
  for (const chunk of world.chunks.values()) {
    chunk.group.traverse(object => { if (object.name) names.add(object.name); });
    const blocks = chunk.group.getObjectByName('city-blocks'), river = chunk.group.getObjectByName('city-river'), skyline = chunk.group.getObjectByName('city-skyline');
    assert.ok(blocks && river && skyline, `chunk ${chunk.index} is missing its buildings, river or skyline`);
    // Nothing in the skyline stands on the camera's side of the road.
    const towers = skyline.geometry.attributes.position;
    for (let i = 0; i < towers.count; i++) assert.ok(towers.getX(i) - cityDrivingRoute.position(-(towers.getZ(i) - chunk.start), 0).x > 150);
    assert.ok(blocks.castShadow && !skyline.castShadow && skyline.userData.ambientOcclusion === false);
    // Every building stands on its footing and no building reaches the road.
    const positions = blocks.geometry.attributes.position, lowest = Math.min(...Array.from({ length: positions.count }, (_, i) => positions.getY(i)));
    assert.ok(lowest > RIVER_LEVEL, 'a building sank into the river');
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), z = positions.getZ(i) - chunk.start;
      const s = -z, roadX = cityDrivingRoute.position(s, 0).x;
      assert.ok(Math.abs(x - roadX) > KERB + .5, `building on the road at ${s}`);
    }
    // The river lies on its level plane.
    const water = river.geometry.attributes.position;
    for (let i = 0; i < water.count; i++) assert.ok(Math.abs(water.getY(i) - RIVER_LEVEL) < 1e-6);
    for (const name of ['street-lamps', 'quay-railings', 'parked-cars', 'city-trunks']) {
      const mesh = chunk.group.getObjectByName(name);
      assert.ok(mesh?.isInstancedMesh && mesh.count > 0, `${name} missing from chunk ${chunk.index}`);
    }
  }
  for (const name of ['city-ground', 'city-road', 'city-side-roads', 'kerbs', 'lit-windows', 'city-promenade', 'traffic-signals', 'benches', 'city-boxes', 'manholes', 'city-crowns']) assert.ok(names.has(name), `${name} never appears`);
  assert.ok(!names.has('puddles'), 'the city has no puddle overlays');
  // Streaming keeps the resident window and disposes what leaves it.
  const before = world.chunks.size;
  world.update(420 + CHUNK_LENGTH * 3);
  assert.equal(world.chunks.size, before);
  assert.ok(![...world.chunks.keys()].includes(Math.floor(420 / CHUNK_LENGTH) - 3));
  world.update(-8200); assert.equal(world.chunks.size, before);
  world.dispose();
  assert.equal(scene.children.length, 0);
});

test('rain wraps around the car, pauses with the clock, and lightning is rare and brief', () => {
  const rain = new Rainfall(), anchor = { x: 12, y: 24, z: -400 };
  rain.update(1, anchor, 0);
  const first = Array.from(rain.geometry.attributes.position.array.slice(0, 300));
  rain.update(1, anchor, 0);
  assert.deepEqual(Array.from(rain.geometry.attributes.position.array.slice(0, 300)), first, 'the same clock gives the same rain');
  rain.update(1.5, anchor, 0);
  const later = rain.geometry.attributes.position.array;
  assert.notDeepEqual(Array.from(later.slice(0, 30)), first);
  for (let i = 0; i < later.length; i += 3) {
    assert.ok(Math.abs(later[i]) <= 150 && Math.abs(later[i + 1]) <= 100 && Math.abs(later[i + 2]) <= 180, 'a drop left the volume');
  }
  // Drops fall: the same drop is lower half a second later, unless it wrapped.
  let fell = 0;
  for (let i = 1; i < 300; i += 3) if (later[i] < first[i]) fell++;
  assert.ok(fell > 80);
  assert.equal(rain.points.position.z, anchor.z + 1024 - 1024);
  // Rain keeps falling vertically even after a long drive; horizontal wind
  // must not accumulate or oscillate faster as the scene clock grows.
  for (const time of [1.5, 300, 3600]) {
    rain.update(time, anchor, 0);
    for (let i = 0; i < first.length; i += 3) {
      assert.equal(rain.geometry.attributes.position.array[i], first[i], 'rain drifts sideways');
      assert.equal(rain.geometry.attributes.position.array[i + 2], first[i + 2], 'rain drifts along the road');
    }
  }
  rain.dispose();
  let lit = 0, peak = 0;
  for (let t = 0; t < 600; t += .05) { const f = lightning(t); if (f > .05) lit++; peak = Math.max(peak, f); }
  assert.ok(lit > 0 && lit < 600 / .05 * .02, `lightning lit ${lit} samples`);
  assert.ok(peak <= 1.5);
});

test('a city chunk keeps its draw calls and triangles within the budget of the other routes', () => {
  let calls = 0, triangles = 0;
  for (const index of [0, 1, 2]) {
    const chunk = new CityChunk(index);
    chunk.group.traverse(object => {
      if (!object.isMesh) return;
      calls++;
      triangles += object.geometry.attributes.position.count / 3 * (object.isInstancedMesh ? object.count : 1);
    });
    chunk.dispose();
  }
  assert.ok(calls / 3 < 40, `${calls / 3} draw calls per chunk`);
  assert.ok(triangles / 3 < 40000, `${triangles / 3} triangles per chunk`);
});

test('building walls face outward and follow facade details through road bends', () => {
  const chunk = Object.create(CityChunk.prototype); chunk.start = 0;
  const material = new THREE.MeshBasicMaterial();
  for (const s0 of [-840, -320, 180, 498, 1025, 8390]) for (const u0 of [14, 44]) {
    const s1 = s0 + 23, u1 = u0 + 22, target = { vertices: [], colors: [] };
    chunk.prism(target, s0, s1, u0, u1, 20, 40, new THREE.Color('#ffffff'));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(target.vertices, 3));
    const mesh = new THREE.Mesh(geometry, material);
    // A ray from outside must meet the expected facade first, within the
    // window offset. Inward faces and a chord burying the windows both fail.
    for (const fraction of [.1, .3, .5, .7, .9]) for (const [s, u, outward] of [
      [s0, u0 + 22 * fraction, new THREE.Vector3(0, 0, 1)],
      [s1, u0 + 22 * fraction, new THREE.Vector3(0, 0, -1)],
      [s0 + 23 * fraction, u0, new THREE.Vector3(-1, 0, 0)],
    ]) {
      const p = chunk.at(s, u, 30), origin = new THREE.Vector3(p.x, p.y, p.z).addScaledVector(outward, 5);
      const hits = new THREE.Raycaster(origin, outward.clone().negate()).intersectObject(mesh);
      assert.ok(hits.length && Math.abs(hits[0].distance - 5) < .045, `facade at ${s}, ${u} hides its windows or faces inward (${hits[0]?.distance})`);
    }
    geometry.dispose();
  }
  material.dispose();
});

test('window facades face the road on both banks and remain visible from either end', () => {
  const material = new THREE.MeshBasicMaterial();
  for (const s0 of [-320, 180, 1025]) for (const u0 of [-222, 44]) for (const kind of ['punched', 'ribbon']) {
    const chunk = Object.create(CityChunk.prototype); chunk.start = 0;
    chunk.scenery = { blocks: { vertices: [], colors: [] }, lit: { vertices: [], colors: [] } };
    const b = { s0, s1: s0 + 23, u0, u1: u0 + 22, height: 30, wall: '#888888', lit: .05 };
    const walls = { vertices: [], colors: [] };
    chunk.prism(walls, b.s0, b.s1, b.u0, b.u1, 20, 50, new THREE.Color('#888888'));
    const wallGeometry = new THREE.BufferGeometry();
    wallGeometry.setAttribute('position', new THREE.Float32BufferAttribute(walls.vertices, 3));
    const wallMesh = new THREE.Mesh(wallGeometry, material), faces = new Map();
    chunk.quad = (target, points, color, outward) => {
      faces.set(outward.join(','), { points, outward });
      CityChunk.prototype.quad.call(chunk, target, points, color, outward);
    };
    chunk.windows(b, 20, 123, kind);
    const roadNormal = u0 < 0 ? '1,0,0' : '-1,0,0';
    assert.deepEqual([...faces.keys()].sort(), [roadNormal, '0,0,1', '0,0,-1'].sort());
    for (const { points, outward } of faces.values()) {
      const center = points.reduce((sum, p) => sum.add(new THREE.Vector3(p.x, p.y, p.z)), new THREE.Vector3()).multiplyScalar(.25);
      const normal = new THREE.Vector3(...outward), ray = new THREE.Raycaster(center.clone().addScaledVector(normal, 2), normal.clone().negate());
      const vertices = { vertices: [], colors: [] };
      CityChunk.prototype.quad.call(chunk, vertices, points, new THREE.Color('#ffffff'), outward);
      const paneGeometry = new THREE.BufferGeometry();
      paneGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices.vertices, 3));
      const paneHit = ray.intersectObject(new THREE.Mesh(paneGeometry, material))[0], wallHit = ray.intersectObject(wallMesh)[0];
      assert.ok(paneHit && wallHit && paneHit.distance < wallHit.distance, `${kind} facade ${outward} buried or facing away at ${s0}, ${u0}`);
      paneGeometry.dispose();
    }
    wallGeometry.dispose();
  }
  material.dispose();
});

test('skyline bands have a fixed geometry budget and use the existing unshadowed batch', () => {
  const chunk = Object.create(CityChunk.prototype); chunk.start = 0;
  for (const lane of [0, 1, 2, 3]) {
    const skyline = { vertices: [], colors: [] }; chunk.scenery = { skyline };
    dressSkyline(chunk, { s0: 498, s1: 524, u0: 260 + lane * 70, u1: 285 + lane * 70 }, 20, 155, new THREE.Color('#808a95'), lane);
    assert.ok(skyline.vertices.length > 0 && skyline.vertices.length / 9 <= 102, 'at most 16 bands and a cap on three faces');
    assert.ok(skyline.vertices.every(Number.isFinite));
    assert.equal(skyline.colors.length, skyline.vertices.length);
    assert.deepEqual(Object.keys(chunk.scenery), ['skyline']);
  }
});

test('river-bound streets connect across both banks, including bridges split by a chunk seam', () => {
  const streets = Array.from({ length: 240 }, (_, i) => i - 120).filter(nearStreet);
  const selected = [streets.find(i => blockBoundary(i) % CHUNK_LENGTH === 0), streets.find(i => i >= 0), streets.find(i => i < 0 && blockBoundary(i) % CHUNK_LENGTH !== 0)];
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
  for (const index of selected) {
    assert.ok(index !== undefined, 'include a crossing at a chunk boundary');
    const s = blockBoundary(index), center = Math.floor(s / CHUNK_LENGTH), scene = new THREE.Group();
    const chunks = [-1, 0, 1].map(offset => new CityChunk(center + offset));
    const roadMeshes = [], buildingMeshes = [], terrainMeshes = [], boulevardMeshes = [], pavingMeshes = [];
    for (const chunk of chunks) {
      chunk.group.position.z = -chunk.start; scene.add(chunk.group);
      roadMeshes.push(chunk.group.getObjectByName('city-side-roads'));
      buildingMeshes.push(chunk.group.getObjectByName('city-blocks'));
      terrainMeshes.push(chunk.group.getObjectByName('city-ground'));
      boulevardMeshes.push(chunk.group.getObjectByName('city-road'));
      pavingMeshes.push(chunk.group.getObjectByName('city-promenade'));
      const expected = [];
      for (let i = blockAt(chunk.start) - 1; i <= blockAt(chunk.start + CHUNK_LENGTH) + 1; i++) if (nearStreet(i) && chunk.inChunk(blockBoundary(i))) expected.push(i);
      assert.deepEqual(chunk.features.bridges.map(bridge => bridge.street), expected, 'every street reaching the river has exactly one bridge owner');
    }
    scene.updateMatrixWorld(true);
    // Test real rendered road triangles through both traffic lanes, not just
    // the bridge metadata. Gaps, disconnected landings and blocked far-bank
    // intersections all fail this sweep.
    for (const ds of [-2.7, 2.7]) for (let u = BANK_ROADS.at(-1) + .4; u < -5.6; u += 3.7) {
      const point = cityPosition(s + ds, u, 150), expected = crossRoadHeight(s + ds, u, true);
      ray.set(new THREE.Vector3(point.x, point.y, point.z), down);
      const road = ray.intersectObjects(roadMeshes)[0];
      assert.ok(road && Math.abs(road.point.y - expected) < .06, `street ${index} has a gap or step at ${ds}, ${u}: ${road?.point.y} vs ${expected}`);
      const terrain = ray.intersectObjects(terrainMeshes)[0];
      assert.ok(!terrain || terrain.point.y < road.point.y + .008, `terrain covers the road at ${s + ds}, ${u}`);
      assert.equal(ray.intersectObjects(buildingMeshes).length, 0, `a building blocks street ${index} at ${u}`);
    }
    // The side-road mouths must meet the boulevard without a step or a
    // terrain ridge. The corner pavement must stay at the main kerb level.
    for (const side of [-1, 1]) {
      for (const u of [5.4, 5.6, 6.3, 7.2, 8.2, 11]) {
        const point = cityPosition(s + 1.3, side * u, 150);
        ray.set(new THREE.Vector3(point.x, point.y, point.z), down);
        const surface = ray.intersectObjects([...roadMeshes, ...boulevardMeshes, ...terrainMeshes])[0];
        assert.ok(surface && Math.abs(surface.point.y - cityRoadHeight(s + 1.3) - .075) < .025, 'intersection mouth is flush with the boulevard');
      }
      for (const ds of [7, 8.2, 11, 15]) {
        const point = cityPosition(s + side * ds, 9, 150);
        ray.set(new THREE.Vector3(point.x, point.y, point.z), down);
        const pavement = ray.intersectObjects(pavingMeshes)[0];
        assert.ok(pavement && Math.abs(pavement.point.y - pavementHeight(s + side * ds) - .02) < .025, 'sidewalk meets the boulevard pavement');
      }
    }
    // Probe both sides of the seam: exactly on an edge, Float32 rounding
    // can put a mathematical ray between triangles by less than 0.1 mm.
    for (const u of BANK_ROADS) for (const ds of [-18, -4, -.01, .01, 4, 18]) {
      const point = cityPosition(s + ds, u + 2.2, 150);
      ray.set(new THREE.Vector3(point.x, point.y, point.z), down);
      assert.ok(ray.intersectObjects(roadMeshes).length, `opposite-bank avenues join each bridge intersection at ${s + ds}, ${u + 2.2}`);
      assert.equal(ray.intersectObjects(buildingMeshes).length, 0, 'the avenue stays clear of wharf buildings');
    }
    for (const u of [quayOffset(s) + 1.5, FAR_BANK_TOP - 2]) {
      assert.ok(Math.abs(bridgeSurfaceHeight(s, u) - cityStreetHeight(s, u)) < 1e-8, 'bridge profile meets the bank without a step');
    }
    for (const chunk of chunks) chunk.dispose();
  }
});

test('the far-bank street plan varies independently and stays continuous without folding lots', () => {
  let varied = 0, short = 0;
  for (let index = -30; index < 30; index++) {
    const range = bankStreetRange(index), boundary = blockBoundary(index);
    if (nearStreet(index)) assert.deepEqual(range, { from: BANK_ROADS.at(-1), to: -5.5 });
    else if (range.from === BANK_ROADS[1]) short++;
    const s = (boundary + blockBoundary(index + 1)) / 2;
    const direction = u => { const a = cityPosition(s - 5, u), b = cityPosition(s + 5, u); return (b.x - a.x) / (b.z - a.z); };
    if (Math.abs(direction(BANK_ROADS[0]) - direction(BANK_ROADS.at(-1))) > .06) varied++;
    for (const u of [-350, -245, -188, -142, -131]) {
      const a = cityPosition(boundary - .0001, u), b = cityPosition(boundary + .0001, u);
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < .001, 'district axes join at block boundaries');
      const p = cityPosition(s, u), across = cityPosition(s, u + .1), along = cityPosition(s + .1, u);
      const area = (across.x - p.x) * (along.z - p.z) - (across.z - p.z) * (along.x - p.x);
      assert.ok(area < -.003, 'street plan does not reverse or collapse a lot');
    }
    for (const u of [-130, -20, 0, 14, 160]) assert.deepEqual(cityPosition(s, u, 24), positionAt(s, u, 24), 'the driving bank and bridge spans keep their established layout');
  }
  assert.ok(varied > 20, 'avenues have different directions, not translated copies of the same curve');
  assert.ok(short > 3, 'the bank contains shorter local streets as well as through streets');
});

test('far-bank T junctions close with a continuous sidewalk instead of opening into the river', () => {
  const indices = Array.from({ length: 20 }, (_, i) => i - 10).filter(i => !nearStreet(i)).slice(0, 4);
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
  for (const index of indices) {
    const center = blockBoundary(index), chunk = new CityChunk(Math.floor((center + .3) / CHUNK_LENGTH));
    chunk.group.position.z = -chunk.start; chunk.group.updateMatrixWorld(true);
    for (const ds of [-4, .3, 4]) {
      if (!chunk.inChunk(center + ds)) continue;
      const point = cityPosition(center + ds, BANK_ROADS[0] + 6.7, 150);
      ray.set(new THREE.Vector3(point.x, point.y, point.z), down);
      const paving = ray.intersectObject(chunk.group.getObjectByName('city-promenade'))[0];
      assert.ok(paving && Math.abs(paving.point.y - cityGroundHeight(center + ds, BANK_ROADS[0] + 6.7) - .02) < .025, 'waterfront footpath crosses the closed arm');
      assert.equal(ray.intersectObject(chunk.group.getObjectByName('city-side-roads')).length, 0, 'asphalt does not continue past the kerb');
    }
    chunk.dispose();
  }
});

test('cross-street terrain meets the outside of the sidewalks without a sunken strip', () => {
  for (const index of [-8, -1, 0, 1, 2, 8]) {
    const center = blockBoundary(index), range = bankStreetRange(index);
    const chunks = [-1, 0, 1].map(offset => new CityChunk(Math.floor(center / CHUNK_LENGTH) + offset));
    try {
      for (const side of [-1, 1]) for (const distance of [8.15, 9, 12]) for (const u of [24, 65, 110, -166, -215]) {
        if (u < 0 && (u < range.from || u > range.to)) continue;
        const s = center + side * distance, chunk = chunks.find(chunk => chunk.inChunk(s));
        assert.ok(Math.abs(chunk.ground(s, u).y - cityGroundHeight(s, u)) < .025,
          `terrain drops outside the sidewalk at ${s}, ${u}`);
      }
    } finally { chunks.forEach(chunk => chunk.dispose()); }
  }
});

test('alley asphalt stays inside its curbs instead of bleeding through the surrounding terrain', () => {
  const down = new THREE.Vector3(0, -1, 0);
  for (const index of [0, 1, 2, 3]) {
    const s = (blockBoundary(index) + blockBoundary(index + 1)) / 2;
    const chunk = new CityChunk(Math.floor(s / CHUNK_LENGTH));
    chunk.group.position.z = -chunk.start; chunk.group.updateMatrixWorld(true);
    try {
      for (const u of [36.1, 43.9, 84.04, 89.96]) {
        const p = cityPosition(s, u, 150), ray = new THREE.Raycaster(new THREE.Vector3(p.x, p.y, p.z), down);
        assert.equal(ray.intersectObject(chunk.group.getObjectByName('city-side-roads')).length, 0, 'asphalt stops at the kerb');
        const hit = ray.intersectObject(chunk.terrain)[0];
        assert.ok(hit, 'terrain continues behind the pavement');
        const colors = chunk.terrain.geometry.attributes.color;
        assert.ok(colors.getY(hit.face.a) > .2, `asphalt-colored terrain beyond the sidewalk at ${s}, ${u}`);
      }
    } finally { chunk.dispose(); }
  }
});

test('waterfront pull-offs meet the road, stay above the terrain, and join across chunk seams', () => {
  const sites = Array.from({ length: 120 }, (_, i) => cityParkingForBlock(i - 60)).filter(Boolean);
  const selected = [-1, 1].map(sign => sites.find(site => Math.sign(site.from) === sign &&
    Math.floor(site.from / CHUNK_LENGTH) !== Math.floor(site.to / CHUNK_LENGTH)));
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
  for (const site of selected) {
    assert.ok(site, 'include pull-offs crossing positive and negative chunk seams');
    const first = Math.floor(site.from / CHUNK_LENGTH), last = Math.floor(site.to / CHUNK_LENGTH);
    const chunks = Array.from({ length: last - first + 1 }, (_, i) => new CityChunk(first + i));
    for (const chunk of chunks) { chunk.group.position.z = -chunk.start; chunk.group.updateMatrixWorld(true); }
    const roads = chunks.map(chunk => chunk.group.getObjectByName('city-side-roads'));
    const terrain = chunks.map(chunk => chunk.terrain), kerbs = chunks.map(chunk => chunk.group.getObjectByName('kerbs'));
    const samples = [site.from + .5, site.from + 3, site.from + 9, site.to - 3, site.to - .5];
    for (let s = site.from + 12; s < site.to - 9; s += 7) samples.push(s);
    for (let index = first + 1; index <= last; index++) samples.push(index * CHUNK_LENGTH - .01, index * CHUNK_LENGTH + .01);
    try {
      for (const s of samples) {
        const width = cityParkingWidth(s, site);
        for (const u of [-5.7, -6.3, -6.9, -10.5, -14.8]) {
          if (-u >= width - .15) continue;
          const p = cityPosition(s, u, 150); ray.set(new THREE.Vector3(p.x, p.y, p.z), down);
          const road = ray.intersectObjects(roads)[0], ground = ray.intersectObjects(terrain)[0];
          assert.ok(road && Math.abs(road.point.y - cityParkingHeight(s, u)) < .035, `parking gap or step at ${s}, ${u}`);
          assert.ok(!ground || ground.point.y < road.point.y, 'terrain does not cover the pull-off');
          assert.equal(ray.intersectObjects(kerbs).length, 0, 'the boulevard kerb does not block the entrance');
        }
        const outside = cityPosition(s, -width - .8, 150);
        ray.set(new THREE.Vector3(outside.x, outside.y, outside.z), down);
        assert.equal(ray.intersectObjects(roads).length, 0, 'parking asphalt stops before the riverside footpath');
      }
    } finally { chunks.forEach(chunk => chunk.dispose()); }
  }
});
