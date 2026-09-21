import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { roadX, roadHeight, roadFrame, terrainHeight, groundHeight, terrainVertex, terrainColumns, coastOffset, shorelineOffset, beachWidth, bridgeAt, pondAt, pondRadius, positionAt, COAST_VERGE, CHUNK_LENGTH, randomAt } from '../src/world/route.js';
import { DrivingController } from '../src/vehicle.js';
import { CoastalWorld } from '../src/world/environment.js';

test('road and terrain stay continuous at chunk boundaries, including negative chunks', () => {
  for (let chunk = -20; chunk < 100; chunk++) {
    const s = chunk * CHUNK_LENGTH;
    assert.ok(Math.abs(roadX(s - .001) - roadX(s + .001)) < .002);
    assert.ok(Math.abs(roadHeight(s - .001) - roadHeight(s + .001)) < .001);
    for (const u of [-100, -40, -15, -7, 0, 7, 14, 70, 140]) assert.ok(Math.abs(terrainHeight(s - .001, u) - terrainHeight(s + .001, u)) < .02);
    for (let c = 0; c < terrainColumns(s).length; c++) assert.deepEqual(terrainVertex(s / 8, c), terrainVertex((chunk - 1) * 16 + 16, c));
  }
});

test('terrain cross sections stay ordered and heights meet at profile transitions', () => {
  for (let s = -1000; s <= 20000; s += 19) {
    const columns = terrainColumns(s);
    for (let c = 1; c < columns.length; c++) assert.ok(columns[c] > columns[c - 1], `inverted terrain at ${s}, ${c}`);
    for (const u of [coastOffset(s) - 17 - beachWidth(s), coastOffset(s) - 10 - beachWidth(s), coastOffset(s) - 10, coastOffset(s), -7, 7]) {
      assert.ok(Math.abs(groundHeight(s, u - .00001) - groundHeight(s, u + .00001)) < .001);
    }
    assert.equal(terrainHeight(s, 0), roadHeight(s));
  }
});

test('randomness is stable and global coordinates remain finite on long routes', () => {
  assert.equal(randomAt(42, 17), randomAt(42, 17)); assert.notEqual(randomAt(42, 17), randomAt(42, 18));
  for (const s of [-1e8, -1e5, 0, 1e5, 1e8]) { const f = roadFrame(s); for (const v of Object.values(f)) assert.ok(Number.isFinite(v)); }
});

test('wide terrain does not fold over itself on the inside of road bends', () => {
  for (let s = -2000; s < 5000; s += 11) for (let u = -420; u < 280; u += 15) {
    const a = positionAt(s, u), b = positionAt(s + .01, u), c = positionAt(s, u + .01);
    const normalY = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    assert.ok(normalY < -.000025, `terrain fold at ${s}, ${u}`);
  }
});

test('gentle lane assistance keeps an uninterrupted two-minute drive on the road', () => {
  const car = new DrivingController();
  for (let i = 0; i < 60 * 120; i++) { car.update(1 / 60, { forward: true }); assert.ok(Math.abs(car.u) < 4.9); }
  assert.ok(car.distance > 3000); assert.equal(car.speed, 28);
});

test('car accelerates, brakes through zero into reverse, steers, and resets locally', () => {
  const car = new DrivingController(); const initialS = car.s;
  for (let i = 0; i < 240; i++) car.update(1 / 60, { forward: true });
  assert.ok(car.speed > 15); assert.ok(car.s > initialS + 30);
  const initialU = car.u;
  for (let i = 0; i < 18; i++) car.update(1 / 60, { forward: true, right: true });
  assert.ok(car.u > initialU);
  for (let i = 0; i < 360; i++) car.update(1 / 60, { brake: true });
  assert.ok(car.speed < -1);
  const resetS = car.s; car.reset(); assert.equal(car.s, resetS); assert.equal(car.u, 2.4); assert.equal(car.speed, 0);
  assert.ok(Math.abs(car.car.position.y - terrainHeight(car.s, car.u) - .13) < .001);
});

test('soft roadside limits keep a continuously steered car on safe ground', () => {
  for (const side of ['left', 'right']) {
    const car = new DrivingController();
    for (let i = 0; i < 3600; i++) {
      car.update(1 / 60, { forward: true, [side]: true });
      assert.ok(car.u >= Math.max(coastOffset(car.s) + 6, -COAST_VERGE.ocean) - .0001 && car.u <= COAST_VERGE.inland + .0001);
      assert.ok(Number.isFinite(car.car.position.y));
    }
  }
});

test('streaming stays bounded, releases meshes, and handles origin shifts and reverse travel', () => {
  const scene = new THREE.Scene(); const world = new CoastalWorld(scene);
  for (const s of [0, 130, 270, 1025, 16500, 16400, -130, -1025]) {
    world.update(s);
    assert.equal(world.chunks.size, 9); assert.equal(scene.children.length, 9);
    assert.ok(Math.abs(-s + world.origin) <= 1024);
    for (const chunk of world.chunks.values()) assert.ok(Math.abs(chunk.group.position.z) < 1900);
  }
  world.dispose(); assert.equal(scene.children.length, 0);
});

test('bridge decks stay grounded over a real inlet and join across chunks', () => {
  const bridge = bridgeAt(148);
  assert.ok(groundHeight(bridge.center, 0) < 0);
  assert.equal(terrainHeight(bridge.center, 0), roadHeight(bridge.center));
  const scene = new THREE.Scene(), world = new CoastalWorld(scene);
  world.update(bridge.center);
  const boundary = positionAt(128, -6.13, roadHeight(128) - .13);
  for (const index of [0, 1]) {
    const chunk = world.chunks.get(index);
    assert.ok(chunk.features.bridges.includes(bridge.index));
    const mesh = chunk.group.getObjectByName(`coastal-bridge-${bridge.index}`);
    const vertices = mesh.geometry.attributes.position;
    let found = false;
    for (let i = 0; i < vertices.count; i++) {
      if (Math.hypot(vertices.getX(i) - boundary.x, vertices.getY(i) - boundary.y, vertices.getZ(i) - chunk.start - boundary.z) < .0001) found = true;
    }
    assert.ok(found, `bridge does not meet chunk boundary ${index}`);
  }
  const car = new DrivingController(); car.s = bridge.start - 20; car.reset();
  for (let i = 0; i < 600; i++) {
    car.update(1 / 60, { forward: true });
    assert.ok(Math.abs(car.car.position.y - roadHeight(car.s) - .13) < .001);
  }
  assert.ok(car.s > bridge.end);
  for (const side of ['left', 'right']) {
    car.s = bridge.center; car.reset();
    for (let i = 0; i < 90; i++) {
      car.update(1 / 60, { forward: true, [side]: true });
      if (Math.abs(car.s - bridge.center) < 49) assert.ok(Math.abs(car.u) <= 4.65);
    }
  }
  world.dispose();
});

test('pond basins contain their water, including where landmark intervals overlap', () => {
  for (let index = -8; index <= 35; index++) {
    const pond = pondAt(246 + index * 704);
    assert.ok(groundHeight(pond.center, pond.u) < pond.level - 1);
    for (let step = 0; step < 24; step++) {
      const angle = step / 24 * Math.PI * 2;
      // Follow the actual bent basin instead of assuming a symmetric oval.
      // Every ray must reach a dry retaining bank before leaving the basin.
      let low = .4, high = 1.8;
      for (let i = 0; i < 20; i++) {
        const radius = (low + high) / 2;
        const s = pond.center + Math.cos(angle) * pond.rs * radius;
        const u = pond.u + Math.sin(angle) * pond.ru * radius;
        if (pondRadius(s, u, pond) < 1.12) low = radius; else high = radius;
      }
      const s = pond.center + Math.cos(angle) * pond.rs * high;
      const u = pond.u + Math.sin(angle) * pond.ru * high;
      assert.ok(groundHeight(s, u) > pond.level + .5, `pond ${index} leaks through its bank`);
    }
  }
});

test('beach profiles vary smoothly and meet the ocean at a stable waterline', () => {
  let narrow = Infinity, wide = -Infinity;
  for (let s = -1000; s < 1000; s += 3) {
    narrow = Math.min(narrow, beachWidth(s)); wide = Math.max(wide, beachWidth(s));
    if (ravineAtWater(s)) continue;
    assert.ok(Math.abs(groundHeight(s, shorelineOffset(s))) < .6);
  }
  assert.ok(wide - narrow > 18);
  function ravineAtWater(s) { return Math.abs(s - bridgeAt(s).center) < 47; }
});

test('the resident window follows the quality level, and reaches the worker', async () => {
  const { setResidentWindow, residentWindow, prefetchOffsets } = await import('../src/world/resident.js');
  const scene = new THREE.Scene(), world = new CoastalWorld(scene);
  try {
    world.update(0);
    assert.equal(world.chunks.size, 9, 'the top levels keep the whole window');
    const centre = world.center;

    // A cheaper level drops the far chunk in each direction. It takes effect on
    // the next update, without waiting for the car to cross into a new chunk.
    setResidentWindow({ behind: 2, ahead: 4 });
    world.update(0);
    assert.equal(world.center, centre, 'the car has not moved');
    assert.deepEqual([...world.chunks.keys()].sort((a, b) => a - b),
      Array.from({ length: 7 }, (_, i) => centre - 2 + i));
    assert.equal(scene.children.length, 7, 'the dropped chunks leave the scene');

    setResidentWindow({ behind: 1, ahead: 3 });
    world.update(0);
    assert.equal(world.chunks.size, 5);

    // Climbing back builds the window out again rather than leaving a gap.
    setResidentWindow({ behind: 3, ahead: 5 });
    world.update(0);
    assert.equal(world.chunks.size, 9);
    assert.deepEqual(residentWindow(), { behind: 3, ahead: 5 });

    // The worker's queue follows it, so a shorter view is also less building:
    // resident chunks first, forward before back, then one chunk of lead.
    assert.deepEqual(prefetchOffsets(3, 5), [0, 1, -1, 2, -2, 3, -3, 4, 5, 6, -4]);
    assert.deepEqual(prefetchOffsets(1, 3), [0, 1, -1, 2, 3, 4, -2]);
  } finally { world.dispose(); setResidentWindow(); }
});
