import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CitydriverChunk, CitydriverWorld } from '../src/world/citydriver-world.js';
import { cityBlock } from '../src/world/city-grid.js';
import { planBuildings } from '../src/world/city-buildings.js';
import { publicSpacePlan, SPACE_NAMES } from '../src/world/city-public-space-kit.js';
import { CITY_HALL_BLOCK } from '../src/world/city-places.js';
import { clockFace } from '../src/world/city-detail-assets.js';
import { exposedOverlaps } from './helpers/exposed-overlaps.js';

class Capture extends CitydriverChunk { *finishSteps() {} }

test('clock dials, hands and hour marks form one continuous front surface', () => {
  const material = new THREE.MeshBasicMaterial(), mesh = new THREE.Mesh(clockFace, material);
  const ray = new THREE.Raycaster(), direction = new THREE.Vector3(0, 0, -1);
  try {
    for (let x = -.96; x < .97; x += .037) for (let y = -.96; y < .97; y += .037) {
      if (Math.hypot(x, y) > .98) continue;
      ray.set(new THREE.Vector3(x, y, 10), direction);
      const hits = ray.intersectObject(mesh);
      assert.ok(hits.length, `no hole in the dial at ${x},${y}`);
      assert.ok(hits.every(hit => Math.abs(hit.point.z - .05) < 1e-6), 'no stacked front faces beneath the markings or rim');
      assert.equal(new Set(hits.map(hit => hit.distance.toFixed(6))).size, 1);
    }
  } finally { material.dispose(); }
});

test('the join audit detects exposed overlap while allowing buried construction joints', () => {
  const geometry = new THREE.BoxGeometry();
  const item = x => ({ p: [x, 30, 0], scale: [2, 2, 2], color: '#ffffff', yaw: 0, roll: 0 });
  const batch = { geometry, items: [item(0), item(1)] };
  const chunk = { east: 0, start: 0, batches: new Map([['solid', batch]]) };
  try {
    assert.ok(exposedOverlaps(chunk).length > 0, 'overlapping coplanar box faces are visible');
    batch.items.push({ ...item(0), scale: [8, 8, 8] });
    assert.deepEqual(exposedOverlaps(chunk), [], 'an enclosing solid hides the inner joints');
    batch.items = [item(0), item(2)];
    assert.deepEqual(exposedOverlaps(chunk), [], 'flush adjoining boxes share no exposed face area');
  } finally { geometry.dispose(); }
});

test('all building combinations and discovery designs have clean exposed joins near and far', () => {
  const world = new CitydriverWorld(new THREE.Scene()), sites = new Map(), variants = new Set(), discoveries = new Set();
  for (let ix = -40; ix <= 40; ix++) for (let iz = -40; iz <= 40; iz++) {
    const block = cityBlock(ix, iz), type = block.landmark || block.kind;
    if (SPACE_NAMES[type]) {
      const plan = publicSpacePlan(block), key = `${plan.type}-${plan.variant}`;
      discoveries.add(key); if (!sites.has(key)) sites.set(key, { ix, iz });
    } else if (block.kind === 'blocks') {
      const signatures = planBuildings(block).buildings.map(b => `${b.type}/${b.roofType}/${b.variation}`);
      if (signatures.some(s => !variants.has(s))) {
        signatures.forEach(s => variants.add(s)); sites.set(`buildings ${ix},${iz}`, { ix, iz });
      }
    }
  }
  discoveries.add('cityhall-0'); sites.set('cityhall-0', CITY_HALL_BLOCK);
  for (const [ix, iz] of [[3, 2], [2, 5], [3, 5], [-4, -3], [-5, -8]]) sites.set(`river ${ix},${iz}`, { ix, iz });
  assert.equal(discoveries.size, 66); assert.equal(variants.size, 48);
  try {
    for (const distant of [false, true]) for (const [name, { ix, iz }] of sites) {
      const chunk = new Capture(ix, iz, world.materials, distant);
      try { assert.deepEqual(exposedOverlaps(chunk), [], `${name}, distant=${distant}`); }
      finally { chunk.dispose(); }
    }
  } finally { world.dispose(); }
});
