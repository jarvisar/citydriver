import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityBlock, CITY_BLOCK } from '../src/world/city-grid.js';
import { cityLogical } from '../src/world/city-layout.js';
import { blockStreets } from '../src/world/city-streets.js';
import { CitydriverChunk, CitydriverWorld } from '../src/world/citydriver-world.js';
import { publicSpacePlan, SPACE_NAMES } from '../src/world/city-public-space-kit.js';
import { pathPanels, signedArea, subtractPolygon, distanceToPath, insetPolygon } from '../src/world/city-surfaces.js';

// Retain generated instances so near/far structures can be compared directly.
// Exclude the independent streets and furniture, which already have LOD tests.
class PublicSpaceChunk extends CitydriverChunk {
  buildGround() {}
  buildRoads() {}
  buildFurniture() {}
  buildLife() {}
  finish() {}
}
function samples() {
  const result = new Map();
  for (let ix = -48; ix <= 48; ix++) for (let iz = -48; iz <= 48; iz++) {
    const b = cityBlock(ix, iz), type = b.landmark || b.kind;
    if (!SPACE_NAMES[type]) continue;
    const design = publicSpacePlan(b), key = `${type}-${design.variant}`;
    if (!result.has(key)) result.set(key, []);
    const blocks = result.get(key), ordinary = type === 'park' || type === 'plaza';
    if (blocks.length < (ordinary ? 4 : 3) && (!ordinary || blocks.every(other => publicSpacePlan(other).orientation !== design.orientation))) blocks.push(b);
  }
  return result;
}
test('public spaces cover every destination design and neighbouring ordinary spaces never duplicate their layout', () => {
  const found = samples(); assert.equal(found.size, Object.values(SPACE_NAMES).reduce((n, designs) => n + designs.length, 0));
  for (const blocks of found.values()) {
    const ordinary = blocks[0].kind === 'park' || blocks[0].kind === 'plaza';
    assert.equal(blocks.length, ordinary ? 4 : 3);
    if (ordinary) assert.equal(new Set(blocks.map(b => publicSpacePlan(b).orientation)).size, 4);
    for (const block of blocks) {
      const design = publicSpacePlan(block);
      assert.deepEqual(design, publicSpacePlan(block));
      if (block.kind !== 'park' && block.kind !== 'plaza') continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const adjacent = publicSpacePlan({ ...block, ix: block.ix + dx, iz: block.iz + dz });
        assert.notEqual(design.variant, adjacent.variant);
      }
    }
  }
});
test('every public-space design keeps rigid structures, road clearance and stable detail transitions', () => {
  const world = new CitydriverWorld(new THREE.Scene());
  try {
    for (const [key, blocks] of samples()) for (const block of blocks) {
      const near = new PublicSpaceChunk(block.ix, block.iz, world.materials);
      const far = new PublicSpaceChunk(block.ix, block.iz, world.materials, true);
      const again = new PublicSpaceChunk(block.ix, block.iz, world.materials);
      assert.deepEqual(near.features.discoveries, far.features.discoveries, key);
      assert.deepEqual(near.features, again.features, `revisit ${key}`);
      const signature = item => JSON.stringify(item);
      for (const [batchKey, batch] of far.batches) {
        const nearItems = new Set(near.batches.get(batchKey)?.items.map(signature));
        for (const item of batch.items) {
          // Tree trunks use simplified boxes at a distance; crowns stay exact.
          const trunk = batchKey === 'solid' && item.scale[0] === .2 && item.scale[2] === .2;
          if (!trunk) assert.ok(nearItems.has(signature(item)), `${key}: stable ${batchKey}`);
          if (item.p[1] < 25.5) continue;
          const f = item.frame;
          assert.ok(Math.abs(f.ns * f.es + f.nu * f.eu) < 1e-12, `${key}: perpendicular walls`);
          assert.ok(Math.abs(Math.hypot(f.ns, f.nu) - 1) < 1e-12);
          assert.ok(Math.abs(Math.hypot(f.es, f.eu) - 1) < 1e-12);
        }
      }
      const { west, east, south, north } = blockStreets(block.ix, block.iz);
      for (const collider of near.features.colliders) for (const corner of collider.corners ?? [{ x: collider.x, z: collider.z }]) {
        const p = cityLogical(-corner.z, corner.x), x = p.u - near.east, s = p.s - near.start;
        const margin = collider.corners ? 0 : collider.reach;
        assert.ok(x - margin > west.halfWidth && x + margin < CITY_BLOCK - east.halfWidth, `${key}: east/west clearance`);
        assert.ok(s - margin > south.halfWidth && s + margin < CITY_BLOCK - north.halfWidth, `${key}: north/south clearance`);
      }
      assert.equal(far.features.colliders.length, 0);
      const walks = near.features.walkways ?? [];
      const clearOf = (plant, obstacle) => {
        const area = Math.abs(signedArea(plant)), rest = subtractPolygon(plant, obstacle).reduce((n, p) => n + Math.abs(signedArea(p)), 0);
        assert.ok(Math.abs(area - rest) < 1e-5, `${key}: planting leaves paths and structures clear`);
      };
      for (const plant of near.features.planting ?? []) {
        assert.ok(Math.abs(signedArea(insetPolygon(plant, .4))) > .5, `${key}: no thin planting scraps`);
        for (const walk of walks) for (const panel of pathPanels(walk.points, walk.width + 1.4)) clearOf(plant, panel);
        for (const reserved of near.features.plantingExclusions ?? []) clearOf(plant, reserved);
        for (const other of near.features.planting) if (plant !== other) clearOf(plant, other);
      }
      for (const tree of near.features.trees ?? []) if (tree.x > 17 && tree.x < 95 && tree.s > 17 && tree.s < 95) {
        for (const walk of walks) assert.ok(distanceToPath(tree.x, tree.s, walk.points) > walk.width / 2 + 1.5, `${key}: trees stay beside paths`);
      }
      for (const bench of near.batches.get('bench')?.items ?? []) for (const walk of walks) {
        assert.ok(distanceToPath(bench.p[0], -bench.p[2], walk.points) > walk.width / 2 + .4, `${key}: seating does not block paths`);
      }
      assert.ok([...far.batches.values()].reduce((n, b) => n + b.items.length, 0) < 650, `${key}: bounded geometry`);
      near.dispose(); far.dispose(); again.dispose();
    }
  } finally { world.dispose(); }
});
