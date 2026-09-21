import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { roadHeight } from '../src/world/route.js';
import { desertBridgeAt, desertCreek, desertGroundHeight, desertHeight, desertDrivingRoute, desertRiverRockEdge, insideMesa, desertCreekDistance, DESERT_VERGE, DESERT_BRIDGE_SPACING } from '../src/world/desert-route.js';
import { DesertChunk, DesertWorld } from '../src/world/desert.js';
import { desertWaterClock } from '../src/world/desert-river.js';
import { DrivingController } from '../src/vehicle.js';
import { packChunk, unpackChunk } from '../src/world/chunk-transfer.js';

test('the valley floor a car may roam is open sand: no water, no channel, no rock', () => {
  let widest = 0;
  for (let s = -20000; s <= 20000; s += 5) {
    const [left, right] = desertDrivingRoute.bounds(s), bridge = desertBridgeAt(s);
    if (s > bridge.start - 6 && s < bridge.end + 6) continue;
    widest = Math.max(widest, right, -left);
    for (let u = left; u <= right; u += .5) {
      assert.equal(desertGroundHeight(s, u), desertHeight(s, u), `the creek channel is within reach at ${s}, ${u}`);
      assert.ok(desertCreekDistance(s, u) > 2, `water within reach at ${s}, ${u}`);
      assert.ok(!insideMesa(s, u), `rock within reach at ${s}, ${u}`);
      assert.ok(Math.abs(desertHeight(s, u + .5) - desertHeight(s, u)) < .45, `steep ground within reach at ${s}, ${u}`);
    }
  }
  assert.equal(widest, DESERT_VERGE);
});

test('the river stays in the valley, crosses beneath bridges, and preserves the canyon terrain', () => {
  for (let s = -20000; s <= 20000; s += 13) {
    const creek = desertCreek(s), bridge = desertBridgeAt(s);
    assert.ok(Math.abs(creek.center) < 29);
    assert.ok(creek.width >= 2.35 && creek.width <= 6.15);
    assert.ok(desertGroundHeight(s, creek.center) < creek.level - .4);
    for (const u of [-330, -200, -80, -40, 40, 80, 200, 330]) assert.equal(desertGroundHeight(s, u), desertHeight(s, u));
    if (Math.abs(creek.center) < creek.width + 6.3) assert.ok(s > bridge.start && s < bridge.end, `unbridged water at ${s}`);
    const [left, right] = desertDrivingRoute.bounds(s);
    assert.ok(left <= -4.7 && right >= 4.7, `pinched driving lanes at ${s}`);
    if (s < bridge.start || s > bridge.end) {
      for (const u of [left, right]) assert.equal(desertGroundHeight(s, u), desertHeight(s, u), `car can enter the creek at ${s}, ${u}`);
    }
  }
  for (let index = -20; index <= 20; index++) {
    const bridge = desertBridgeAt(320 + index * DESERT_BRIDGE_SPACING);
    assert.equal(Math.abs(desertCreek(bridge.center).center), 0);
    assert.ok(desertGroundHeight(bridge.center, 0) < roadHeight(bridge.center) - 3.7);
    // Both river banks and the level join at positive and negative stream edges.
    for (const s of [bridge.center, bridge.start, bridge.end, bridge.center + DESERT_BRIDGE_SPACING / 2]) {
      const a = desertCreek(s - .0001), b = desertCreek(s + .0001);
      for (const key of ['center', 'width', 'level']) assert.ok(Math.abs(a[key] - b[key]) < .001);
    }
  }
});

test('river water fits the rendered channel and joins adjacent streaming chunks', () => {
  const world = new DesertWorld(new THREE.Scene()); world.update(320); world.scene.updateMatrixWorld(true);
  const ground = [...world.chunks.values()].map(chunk => chunk.group.getObjectByName('desert-floor'));
  const water = [...world.chunks.values()].map(chunk => chunk.group.getObjectByName('desert-creek-water'));
  assert.equal(world.scene.getObjectByName('desert-cottonwood-canopies'), undefined);
  assert.ok(world.scene.getObjectByName('desert-river-scrub'));
  const ray = new THREE.Raycaster();
  for (let s = 40; s < 630; s += 3.7) {
    const chunk = world.chunks.get(Math.floor(s / 128)), creek = desertCreek(s);
    const p = chunk.groundPosition(s, creek.center);
    ray.set(new THREE.Vector3(p.x, 90, p.z), new THREE.Vector3(0, -1, 0));
    const bankHit = ray.intersectObjects(ground, false)[0], waterHit = ray.intersectObjects(water, false)[0];
    assert.ok(bankHit && waterHit, `missing water at ${s}`);
    assert.ok(waterHit.point.y > bankHit.point.y + .15, `terrain blocks the stream at ${s}`);
    assert.ok(Math.abs(waterHit.point.y - creek.level) < .2, `water drifts off its channel at ${s}`);
  }
  world.animate(31); assert.equal(desertWaterClock.value, 31);
  world.dispose(); assert.equal(world.scene.children.length, 0);
});

test('wide pools stay within their banks instead of flooding hollows behind mesas', () => {
  // These chunks previously extended water 20–37 meters beyond the intended
  // bank because one corner of a broad cliff triangle touched the channel.
  for (const index of [-16, -11, 0, 9, 15]) {
    const chunk = new DesertChunk(index);
    const water = chunk.group.getObjectByName('desert-creek-water').geometry;
    const coords = water.attributes.riverCoord;
    for (let i = 0; i < coords.count; i++) {
      const s = coords.getX(i), creek = desertCreek(s);
      assert.ok(Math.abs(coords.getY(i)) <= creek.width + 3.95, `flooded hollow in chunk ${index} at ${s}`);
    }
    const shore = chunk.group.getObjectByName('desert-wet-shoreline');
    assert.ok(shore.geometry.attributes.position.count > 0, `missing shoreline in chunk ${index}`);
    assert.ok(chunk.owned.includes(shore.geometry));
    chunk.dispose();
  }
});

test('free river meanders leave a sandy buffer beside the left rock ledges', () => {
  let closest = Infinity, widest = 0;
  for (let s = -16000; s <= 16000; s += 7) {
    const creek = desertCreek(s), bridge = desertBridgeAt(s);
    if (creek.center >= 0 || Math.abs(s - bridge.center) < 112) continue;
    const outer = -creek.center + creek.width + 3.8;
    const clearance = desertRiverRockEdge(s) - outer;
    assert.ok(clearance >= 3.79, `river hugs the left ledge at ${s}`);
    assert.ok(-creek.center - creek.width - 3.8 >= 8.29, `river crowds the road at ${s}`);
    closest = Math.min(closest, clearance); widest = Math.max(widest, clearance);
    const a = desertCreek(s - .001), b = desertCreek(s + .001);
    assert.ok(Math.abs(a.center - b.center) < .004, `sharp meander at ${s}`);
  }
  assert.ok(widest - closest > 12, 'bank spacing should vary with the surrounding rock');
});

test('wooden decks carry cars in both directions and transfer with their materials', () => {
  for (const direction of [-1, 1]) {
    const car = new DrivingController(desertDrivingRoute), center = desertBridgeAt(320).center;
    car.s = center - direction * 33; car.reset();
    for (let i = 0; i < 700; i++) {
      car.update(1 / 60, direction > 0 ? { forward: true } : { brake: true });
      assert.ok(Math.abs(car.car.position.y - roadHeight(car.s) - .13) < .001);
    }
    assert.ok(direction * (car.s - center) > 20);
  }
  for (const index of [-5, 2, 9]) {
    const original = new DesertChunk(index), restored = unpackChunk(packChunk(original).data);
    const deck = original.group.getObjectByName('desert-timber-bridge');
    assert.ok(deck && deck.count > 150);
    assert.equal(restored.group.getObjectByName('desert-timber-bridge').material, deck.material);
    assert.equal(restored.group.getObjectByName('desert-creek-water').material, original.group.getObjectByName('desert-creek-water').material);
    original.dispose(); restored.dispose();
  }
});
