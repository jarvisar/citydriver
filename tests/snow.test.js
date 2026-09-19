import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CHUNK_LENGTH, smoothstep } from '../src/world/route.js';
import { snowColumns, snowVertex, snowHeight, snowBaseHeight, snowGroundHeight, snowRoadHeight, snowDrivingRoute, snowBridgeAt, BRIDGE_SPACING, SNOW_STEP, LAMP_SPACING, lampAt, summitForCell, ledgeEdge, terrainPocket, alpineLake, LAKE_LEVEL, distantMountainHeight, snowPosition } from '../src/world/snow-route.js';
import { lakeClock } from '../src/world/alpine-lake.js';
import { alpineCabin, CABIN_SPACING } from '../src/world/alpine-cabins.js';
import { SnowWorld, SnowChunk } from '../src/world/snow.js';
import { Snowfall } from '../src/world/snowfall.js';
import { DrivingController } from '../src/vehicle.js';

test('mountain ledges stay continuous, ordered and clear of the driving corridor', () => {
  for (let s = -10000; s < 10000; s += 13) {
    const columns = snowColumns(s);
    for (let col = 1; col < columns.length; col++) assert.ok(columns[col] > columns[col - 1], `folded snow terrain at ${s}`);
    for (const u of [-7, 0, 7]) assert.equal(snowHeight(s, u), snowRoadHeight(s));
    assert.ok(snowRoadHeight(s) > LAKE_LEVEL + 45);
    const descent = snowHeight(s, ledgeEdge(s)) - LAKE_LEVEL;
    assert.ok(descent > 45 && descent < 95, `missing lake bluff at ${s}`);
    assert.ok(snowHeight(s, 75) > snowRoadHeight(s) + 5);
    for (const u of [-60, -25, 7, 25, 70]) assert.ok(Math.abs(snowHeight(s + .001, u) - snowHeight(s - .001, u)) < .02);
  }
  for (let chunk = -20; chunk < 40; chunk++) {
    const rows = CHUNK_LENGTH / SNOW_STEP;
    for (let col = 0; col < snowColumns(0).length; col++) assert.deepEqual(snowVertex(chunk * rows, col), snowVertex((chunk - 1) * rows + rows, col));
  }
});

test('alpine summits rise inland of the road and descend on the far side', () => {
  for (let i = -40; i < 40; i++) {
    const summit = summitForCell(i), top = snowHeight(summit.s, summit.u);
    assert.ok(top > snowRoadHeight(summit.s) + 60);
    assert.ok(top > snowHeight(summit.s, summit.u - 45) + 35);
    assert.ok(top > snowHeight(summit.s, summit.u + 55) + 40);
    assert.deepEqual(summit, summitForCell(i));
  }
});

test('distant ranges have substantial peaks and saddles without height jumps at generation boundaries', () => {
  for (const s of [-10000, -1024, 0, 256, 1024, 10000]) {
    const heights = Array.from({ length: 31 }, (_, i) => distantMountainHeight(s, 130 + i * 18));
    assert.ok(Math.max(...heights) > 75);
    assert.ok(Math.max(...heights) - Math.min(...heights) > 50);
    assert.deepEqual(heights, Array.from({ length: 31 }, (_, i) => distantMountainHeight(s, 130 + i * 18)));
  }
  for (let cell = -20; cell <= 20; cell++) for (const spacing of [240, 312, 384]) {
    const s = cell * spacing;
    for (const u of [110, 175, 250, 340, 510, 660])
      assert.ok(Math.abs(distantMountainHeight(s - .001, u) - distantMountainHeight(s + .001, u)) < .02);
  }
});

test('the alpine lake has a level open basin and continuous dry shores', () => {
  for (let s = -10000; s < 10000; s += 11) {
    const lake = alpineLake(s);
    assert.equal(lake.y, LAKE_LEVEL); assert.ok(lake.near - lake.far > 160);
    for (const fraction of [.1, .5, .9]) assert.ok(snowHeight(s, lake.far + (lake.near - lake.far) * fraction) < lake.y - 2);
    assert.ok(snowHeight(s, lake.near + 5) > lake.y + .45);
    assert.ok(snowHeight(s, lake.far - 5) > lake.y + .45);
    for (const u of [lake.near, lake.far]) assert.ok(Math.abs(snowHeight(s, u - .001) - snowHeight(s, u + .001)) < .01);
  }
  // Rendered shoreline samples must also remain above the level surface.
  for (let row = -256; row <= 256; row++) {
    const lake = alpineLake(row * SNOW_STEP), columns = snowColumns(row * SNOW_STEP);
    for (const u of [lake.near, lake.far]) {
      const vertex = snowVertex(row, columns.indexOf(u));
      assert.equal(vertex.s, row * SNOW_STEP); assert.ok(Math.abs(vertex.y - lake.y - .45) < .0001);
    }
  }
});

test('lakeside cabins stay on dry land through positive and negative route cells', () => {
  for (let i = -40; i < 40; i++) {
    const cabin = alpineCabin(i);
    assert.ok(cabin.y > LAKE_LEVEL + .5);
    for (const ds of [-3, 3]) assert.ok(cabin.u - 2.5 > alpineLake(cabin.s + ds).near);
    // Cabins sit on shore benches, never pitched on the face of the bluff.
    assert.ok(cabin.slope < .9, `cabin ${i} perches on a ${cabin.slope.toFixed(1)} slope`);
    assert.ok(cabin.s > i * CABIN_SPACING && cabin.s < (i + 1) * CABIN_SPACING, 'each cabin keeps to its own stretch');
    assert.deepEqual(alpineCabin(i), cabin);
  }
});

test('snowfall stays in world space while the camera follows and the origin rebases', () => {
  const snowfall = new Snowfall(), anchor = { x: 12, y: 67, z: -1023 };
  snowfall.update(12, anchor, 0);
  const before = Array.from(snowfall.geometry.attributes.position.array);
  const next = { x: 14, y: 67.3, z: -1025 };
  snowfall.update(12, next, 1024);
  const after = snowfall.geometry.attributes.position.array;
  let compared = 0;
  for (let i = 0; i < before.length; i += 3) {
    if (Math.abs(before[i]) > 140 || Math.abs(before[i + 1]) > 90 || Math.abs(before[i + 2]) > 170) continue;
    assert.ok(Math.abs(before[i] + anchor.x - (after[i] + next.x)) < .0001);
    assert.ok(Math.abs(before[i + 1] + anchor.y - (after[i + 1] + next.y)) < .0001);
    assert.ok(Math.abs(before[i + 2] + anchor.z - (after[i + 2] + snowfall.points.position.z - 1024)) < .0001);
    compared++;
  }
  assert.ok(compared > 900);
  snowfall.dispose();
});

test('snow drive stays grounded on slopes and safely within the ledge', () => {
  const car = new DrivingController(snowDrivingRoute);
  for (let i = 0; i < 10200; i++) {
    car.update(1 / 60, { forward: true, left: i >= 7200 && i < 8600, right: i >= 8600 });
    assert.ok(car.u >= -5.85 && car.u <= 6.3);
    assert.ok(Math.abs(car.car.position.y - snowHeight(car.s, car.u) - .13) < .0001);
    if (i === 7199) assert.ok(car.distance > 3000);
  }
  assert.ok(car.distance > 3000);
  car.reset(); for (let i = 0; i < 300; i++) car.update(1 / 60, { brake: true });
  assert.ok(car.speed < -2);
});

test('snow pockets flatten the terrain itself and blend continuously into the slope', () => {
  let reshaped = 0;
  for (let i = -40; i < 40; i++) for (const side of [-1, 1]) {
    const pocket = terrainPocket(i, side), { s, u, ru, rs } = pocket;
    assert.deepEqual(pocket, terrainPocket(i, side));
    const slope = Math.abs(snowHeight(s, u + .2) - snowHeight(s, u - .2));
    const baseSlope = Math.abs(snowBaseHeight(s, u + .2) - snowBaseHeight(s, u - .2));
    assert.ok(slope < baseSlope * .4 + .001);
    if (Math.abs(snowHeight(s, u + ru * .5) - snowBaseHeight(s, u + ru * .5)) > .5) reshaped++;
    for (const t of [s - rs, s + rs]) assert.ok(Math.abs(snowHeight(t - .001, u) - snowHeight(t + .001, u)) < .02);
    for (const v of [u - ru, u + ru]) assert.ok(Math.abs(snowHeight(s, v - .001) - snowHeight(s, v + .001)) < .02);
    for (const v of [-7, 0, 7]) assert.equal(snowHeight(s, v), snowRoadHeight(s));
  }
  assert.ok(reshaped > 100);
});

test('night effects remain bounded, animate deterministically and dispose on leaving', () => {
  const scene = new THREE.Scene(), world = new SnowWorld(scene), car = new DrivingController(snowDrivingRoute);
  let disposed = 0;
  world.update(24);
  for (const chunk of world.chunks.values()) for (const g of chunk.owned) g.addEventListener('dispose', () => disposed++);
  world.flakeGeometry.addEventListener('dispose', () => disposed++);
  for (const s of [24, 24.5, 41.99, 42.01, 148, 1023.99, 1024.01, 1025, 10000, -300, -1100, -1099.5]) {
    world.update(s); car.s = s; car.reset(); car.car.position.z += world.origin; world.animate(12, car);
    assert.equal(lakeClock.value, 12);
    assert.equal(world.chunks.size, 9); assert.equal(scene.children.length, 10); assert.equal(world.lights.length, 7);
    for (const light of world.lights) assert.ok(Math.abs(light.position.z) < 1300);
    world.lights.forEach((light, i) => {
      const lamp = lampAt(Math.round((s - 16) / LAMP_SPACING) + i - 3);
      const p = snowPosition(lamp.s, 6.2, lamp.y - .35);
      const strength = lamp.hidden ? 0 : 1 - smoothstep(120, 174, Math.abs(lamp.s - s));
      assert.deepEqual(light.position.toArray(), [p.x, p.y, p.z + world.origin]);
      assert.equal(light.intensity, 340 * strength);
      assert.deepEqual(Array.from(world.glowGeometry.attributes.position.array.slice(i * 3, i * 3 + 3)),
        Array.from(new Float32Array([p.x, p.y + .2, p.z + world.origin])));
      assert.equal(world.glowGeometry.attributes.strength.getX(i), Math.fround(strength));
    });
    world.cabinLights.forEach((light, i) => {
      const cabin = alpineCabin(Math.floor((s - 76) / CABIN_SPACING) + i), p = snowPosition(cabin.s, cabin.u, cabin.y);
      assert.deepEqual(light.position.toArray(), [p.x - 3, p.y + 2, p.z + world.origin]);
      assert.equal(light.intensity, 110 * (1 - smoothstep(210, 340, Math.abs(cabin.s - s))));
    });
    const positionVersion = world.glowGeometry.attributes.position.version;
    world.update(s);
    assert.equal(world.glowGeometry.attributes.position.version, positionVersion, 'stationary halos need no repeated position upload');
    assert.deepEqual(world.headlights.position.toArray(), car.car.position.toArray());
    assert.ok(world.headlights.quaternion.angleTo(car.car.quaternion) < .0001);
    const first = Array.from(world.flakeGeometry.attributes.position.array);
    world.animate(12, car); assert.deepEqual(Array.from(world.flakeGeometry.attributes.position.array), first);
    world.animate(13, car); assert.notDeepEqual(Array.from(world.flakeGeometry.attributes.position.array), first);
  }
  for (let i = -50; i < 50; i++) assert.equal(lampAt(i).y, snowRoadHeight(lampAt(i).s) + 7.6);
  assert.equal(world.headlights.visible, true);
  car.setCar('formula'); world.animate(14, car);
  assert.equal(world.headlights.visible, false, 'the Formula car has no headlight beam');
  car.setCar('auto'); world.animate(15, car);
  assert.equal(world.headlights.visible, true, 'switching back restores road car headlights');
  world.dispose(); assert.equal(scene.children.length, 0); assert.ok(disposed >= 55);
});

test('timber trestles span stream gullies that leave the deck, lake and lamps untouched', () => {
  for (let i = -12; i < 12; i++) {
    const bridge = snowBridgeAt(372 + i * BRIDGE_SPACING), { center, start, end } = bridge;
    assert.equal(bridge.index, i); assert.deepEqual(snowBridgeAt(center + 300), bridge);
    for (const u of [-7, 0, 7]) {
      assert.ok(snowGroundHeight(center, u) < snowRoadHeight(center) - 8, `shallow gully at ${center}`);
      assert.equal(snowHeight(center, u), snowRoadHeight(center));
      for (const s of [start - 42, end + 42]) assert.equal(snowGroundHeight(s, u), snowHeight(s, u));
    }
    const abutment = snowGroundHeight(start, 0) - snowRoadHeight(start);
    assert.ok(abutment < 0 && abutment > -4);
    for (let s = start - 44; s <= end + 44; s += 1.7) for (const u of [-30, -7, 0, 7, 20])
      assert.ok(Math.abs(snowGroundHeight(s + .001, u) - snowGroundHeight(s - .001, u)) < .03);
    const lake = alpineLake(center);
    for (const u of [lake.near, lake.near - 20, lake.far]) assert.equal(snowGroundHeight(center, u), snowHeight(center, u));
    for (let j = Math.floor((start - 60) / LAMP_SPACING); j * LAMP_SPACING < end + 60; j++) {
      const lamp = lampAt(j);
      assert.ok(lamp.hidden || lamp.s <= start - 4 || lamp.s >= end + 4, `lamp on the deck at ${lamp.s}`);
    }
  }
  const visible = Array.from({ length: 400 }, (_, j) => lampAt(j - 200)).filter(lamp => !lamp.hidden);
  for (let j = 1; j < visible.length; j++) assert.ok(visible[j].s - visible[j - 1].s >= 26);
  assert.ok(visible.some((lamp, j) => j && lamp.s - visible[j - 1].s !== LAMP_SPACING));
  const names = index => { const chunk = new SnowChunk(index), found = []; chunk.group.traverse(o => found.push(o)); chunk.dispose(); return found; };
  const trestles = index => names(index).filter(o => o.name === 'timber-trestle').length;
  const roadVertices = index => names(index).find(o => o.name === 'mountain-road').geometry.attributes.position.count;
  // The span straddles a chunk boundary, so both neighbours build their halves.
  assert.equal(trestles(2), 1); assert.equal(trestles(3), 1); assert.equal(trestles(5), 0);
  assert.equal(trestles(-4), 1); assert.equal(trestles(-3), 1);
  assert.equal(roadVertices(5) - roadVertices(2), 22 * 6);
  assert.equal(roadVertices(5) - roadVertices(3), 10 * 6);
});
