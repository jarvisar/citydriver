import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityWalker, WALKER_LOOKS, WALKER_STYLES, createWalkerMaterial, walkerAppearance, setWalkerAppearance, pairWalkers, walkerPose, walkerFloat, offsetWalkerPose, taxiGroupAppearance } from '../src/world/city-life.js';
import { TaxiView } from '../src/taxi-view.js';
import { cityBlock, cityStreetAt, citydriverRoute } from '../src/world/city-grid.js';
import { cityLayout } from '../src/world/city-layout.js';
import { riverResidentPose } from '../src/world/city-rivers.js';

function residents(seed, count = 10) {
  return Array.from({ length: count }, (_, i) => ({ phase: i * 31 + 7, speed: .7 + i * .02,
    side: i % 4, direction: i % 2 ? -1 : 1, appearance: walkerAppearance(seed + i * 719) }));
}

test('expanded cast stays within the shared mesh budget and has finite, bounded silhouettes', () => {
  assert.equal(WALKER_LOOKS.length, 24);
  assert.equal(WALKER_STYLES.length, 12);
  assert.ok(cityWalker.index.count / 3 <= 400);
  assert.ok(cityWalker.attributes.position.count <= 360);
  assert.equal(cityWalker.groups.length, 0, 'no extra material draws');
  const point = new THREE.Vector3();
  for (const attributes of Object.values(cityWalker.morphAttributes)) for (const attribute of attributes) {
    assert.ok(attribute.array.every(Number.isFinite), 'including collapsed optional accessories');
  }
  for (const shape of cityWalker.morphAttributes.position) for (let i = 0; i < shape.count; i++) {
    point.fromBufferAttribute(shape, i);
    assert.ok(cityWalker.boundingSphere.containsPoint(point));
    assert.ok(Math.abs(point.x) < .4 && Math.abs(point.z) < .4 && point.y >= .29 && point.y < 2);
  }
});

test('wardrobe, skin and hair vary independently and reproduce after streaming', () => {
  const wardrobes = new Map();
  for (let seed = -2000; seed < 2000; seed++) {
    const appearance = walkerAppearance(seed);
    assert.deepEqual(appearance, walkerAppearance(seed));
    if (!wardrobes.has(appearance.look)) wardrobes.set(appearance.look, { skin: new Set(), hair: new Set() });
    wardrobes.get(appearance.look).skin.add(appearance.skin);
    wardrobes.get(appearance.look).hair.add(appearance.hair);
  }
  assert.equal(wardrobes.size, 24);
  for (const variation of wardrobes.values()) {
    assert.equal(variation.skin.size, 8); assert.equal(variation.hair.size, 8);
  }
});

test('color-pass shape selection agrees with shadow/AO selection and instance textures are released', () => {
  const material = createWalkerMaterial(), mesh = new THREE.InstancedMesh(cityWalker, material, 24);
  const decoded = { morphTargetInfluences: new Array(12).fill(0) }, color = new THREE.Color();
  for (let i = 0; i < 24; i++) {
    // Pairs can choose a silhouette independently of their outfit palette.
    const appearance = { look: i, skin: i % 8, hair: (i + 3) % 8, style: (i + 7) % 12 };
    setWalkerAppearance(mesh, i, appearance);
    mesh.getColorAt(i, color); mesh.getMorphAt(i, decoded);
    assert.equal(Math.floor(color.r), appearance.look);
    assert.equal(Math.round((color.r % 1) * 16), appearance.style);
    assert.equal(color.g, appearance.skin); assert.equal(color.b, appearance.hair);
    assert.equal(decoded.morphTargetInfluences.filter(Boolean).length, 1);
    assert.equal(decoded.morphTargetInfluences[appearance.style], 1);
  }
  let released = false;
  mesh.morphTexture.addEventListener('dispose', () => { released = true; });
  assert.ok(mesh.morphTexture.source.data.data.byteLength <= 24 * 13 * 4);
  mesh.dispose(); material.dispose(); assert.ok(released);
});

test('taxi parties keep a coordinated wardrobe through marker rebuilds without cloning their faces', () => {
  const looks = new Set(), faces = new Set();
  for (let seed = 0; seed < 100; seed++) {
    const party = Array.from({ length: 4 }, (_, i) => taxiGroupAppearance(seed, i));
    assert.equal(new Set(party.map(p => p.look)).size, 1);
    looks.add(party[0].look);
    party.forEach((p, i) => { faces.add(`${p.skin}/${p.hair}`); assert.deepEqual(p, taxiGroupAppearance(seed, i)); });
  }
  assert.ok(looks.size >= 10 && faces.size >= 50);
  const view = new TaxiView(new THREE.Scene());
  const run = { status: 'pickup', revision: 0, customers: [{ s: 24, u: 3, side: 1, axis: 'north', passengers: 4, color: '#ffffff' }] };
  try {
    view.rebuild(run);
    const first = view.markers[0].person, palette = first.instanceColor.array.slice(), shapes = first.morphTexture.source.data.data.slice();
    assert.equal(first.geometry, cityWalker); assert.equal(first.count, 4);
    let disposed = false; first.morphTexture.addEventListener('dispose', () => { disposed = true; });
    view.rebuild(run);
    assert.ok(disposed);
    assert.deepEqual(view.markers[0].person.instanceColor.array, palette);
    assert.deepEqual(view.markers[0].person.morphTexture.source.data.data, shapes);
  } finally { view.dispose(); }
});

test('simple pairs preserve population, mostly mix presentations, and also include both same-presentation pairings', () => {
  let pairs = 0, mixed = 0, masculine = 0, feminine = 0;
  for (let seed = 0; seed < 400; seed++) {
    const walkers = residents(seed), repeated = residents(seed);
    pairWalkers(walkers, seed); pairWalkers(repeated, seed);
    assert.deepEqual(walkers, repeated); assert.equal(walkers.length, 10);
    for (let i = 0; i < walkers.length; i += 2) {
      const a = walkers[i], b = walkers[i + 1];
      if (!a.pairOffset) continue;
      pairs++;
      if (a.appearance.presentation !== b.appearance.presentation) mixed++;
      else if (a.appearance.presentation === 'masculine') masculine++;
      else feminine++;
      assert.notEqual(a.appearance.look, b.appearance.look);
      assert.notEqual(walkerFloat(a, 8).lift, walkerFloat(b, 8).lift, 'individual bob');
      for (const time of [0, 20, 500, 1000000]) {
        const pa = offsetWalkerPose(walkerPose(a, time), a), pb = offsetWalkerPose(walkerPose(b, time), b);
        assert.ok(Math.abs(Math.hypot(pa.x - pb.x, pa.s - pb.s) - .92) < 1e-8);
        assert.equal(pa.yaw, pb.yaw);
        for (const p of [pa, pb]) assert.ok(p.x > 14 && p.x < 98 && p.s > 14 && p.s < 98);
      }
    }
  }
  assert.ok(pairs > 600 && pairs < 950, 'a minority of residents walk in pairs');
  assert.ok(mixed / pairs > .65 && mixed / pairs < .75);
  assert.ok(masculine > 50 && feminine > 50);
});

test('pairs turn continuously at block corners and stay on dry pavement in every river orientation', () => {
  for (const direction of [-1, 1]) for (const pairOffset of [-.46, .46]) {
    for (const phase of [0, 83, 166, 249, 332]) {
      const walker = { phase, speed: 1, direction, pairOffset };
      const a = offsetWalkerPose(walkerPose(walker, -.0001), walker), b = offsetWalkerPose(walkerPose(walker, .0001), walker);
      assert.ok(Math.hypot(a.x - b.x, a.s - b.s) < .001);
    }
    for (const phase of [0, 72, 144]) {
      const walker = { phase, speed: 1, direction, pairOffset, side: 0 };
      const a = offsetWalkerPose(walkerPose(walker, -.0001, true), walker, true);
      const b = offsetWalkerPose(walkerPose(walker, .0001, true), walker, true);
      assert.ok(Math.hypot(a.x - b.x, a.s - b.s) < .001, 'no swapping sides at river turnarounds');
    }
  }
  const checked = new Set();
  for (let ix = -8; ix <= 8; ix++) for (let iz = -8; iz <= 8; iz++) {
    const plan = cityBlock(ix, iz), kind = `${plan.rivers.north}/${plan.rivers.east}`;
    if (plan.kind !== 'river' || checked.has(kind)) continue;
    checked.add(kind);
    const chunk = { plan };
    for (const pairOffset of [-.46, .46]) for (let side = 0; side < 4; side++) for (let time = 0; time < 400; time += 7) {
      const walker = { side, phase: 67, speed: .93, direction: -1, pairOffset };
      const pose = offsetWalkerPose(riverResidentPose(chunk, walker, time), walker, true);
      const p = cityLayout(iz * 112 + pose.s, ix * 112 + pose.x);
      assert.equal(citydriverRoute.water(p.s, p.u), false); assert.equal(cityStreetAt(p.s, p.u).onRoad, false);
    }
  }
  assert.equal(checked.size, 3);
});
