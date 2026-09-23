import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityBlock, PAVEMENT_LEVEL } from '../src/world/city-grid.js';
import { planBuildings, BUILDING_TYPES } from '../src/world/city-buildings.js';
import { CitydriverChunk, CitydriverWorld, blockBatches } from '../src/world/citydriver-world.js';

test('city lots vary their street widths, heights, roofs and layouts without overlapping or obstructing pavements', () => {
  const layouts = new Set(), types = new Set(), roofs = new Set(), counts = new Set(), heights = new Set(), widths = new Set();
  for (let ix = -18; ix <= 18; ix++) for (let iz = -18; iz <= 18; iz++) {
    const block = cityBlock(ix, iz); if (block.kind !== 'blocks') continue;
    const plan = planBuildings(block); assert.deepEqual(plan, planBuildings(block));
    layouts.add(plan.layout); counts.add(plan.buildings.length);
    for (const b of plan.buildings) {
      types.add(b.type); roofs.add(b.roofType); heights.add(b.floors); widths.add(Math.round(b.width));
      assert.ok(b.x - b.width / 2 >= 15.99 && b.x + b.width / 2 <= 96.01);
      assert.ok(b.s - b.depth / 2 >= 15.99 && b.s + b.depth / 2 <= 96.01);
      assert.ok(b.floors >= b.setbackFloors && b.setbackFloors >= 1);
      for (const other of plan.buildings) {
        if (other === b) continue;
        assert.ok(Math.abs(b.x - other.x) >= (b.width + other.width) / 2 + 1.39 || Math.abs(b.s - other.s) >= (b.depth + other.depth) / 2 + 1.39, `overlapping lots in ${block.key}`);
      }
    }
  }
  assert.equal(layouts.size, 5); assert.deepEqual([...types].sort(), [...BUILDING_TYPES].sort()); assert.equal(roofs.size, 8);
  assert.ok(counts.size >= 4); assert.ok(heights.size >= 12); assert.ok(widths.size >= 30);
});

test('each architecture keeps its silhouette, facade layout and materials when streamed into full detail', () => {
  const world = new CitydriverWorld(new THREE.Scene()), found = new Set();
  try {
    for (let ix = -12; ix <= 12 && found.size < BUILDING_TYPES.length; ix++) for (let iz = -12; iz <= 12 && found.size < BUILDING_TYPES.length; iz++) {
      const block = cityBlock(ix, iz); if (block.kind !== 'blocks') continue;
      const types = planBuildings(block).buildings.map(b => b.type);
      if (types.every(type => found.has(type))) continue;
      const near = new CitydriverChunk(ix, iz, world.materials), far = new CitydriverChunk(ix, iz, world.materials, true);
      assert.deepEqual(near.features.buildings, far.features.buildings);
      for (const b of near.features.buildings) {
        found.add(b.type); assert.equal(b.facadeSides, 4); assert.ok(b.windows >= 8);
        assert.ok(near.features.colliders.some(c => c.x === b.x && c.z === -b.s && c.halfWidth === b.width / 2 && c.halfLength === b.depth / 2));
      }
      const matrix = new THREE.Matrix4(), p = new THREE.Vector3(), scale = new THREE.Vector3(), q = new THREE.Quaternion();
      for (const batch of blockBatches(near.group)) for (let i = 0; i < batch.count; i++) {
        batch.matrixAt(i, matrix); matrix.decompose(p, q, scale);
        assert.ok([...p, ...scale].every(Number.isFinite)); assert.ok(scale.x > 0 && scale.y > 0 && scale.z > 0);
        if (batch.name.startsWith('shop-')) assert.ok(p.y > PAVEMENT_LEVEL + 3);
      }
      near.dispose(); far.dispose();
    }
    assert.equal(found.size, BUILDING_TYPES.length);
  } finally { world.dispose(); }
});
