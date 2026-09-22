import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SHOP_SIGNS, SIGN_CATALOG, SIGN_ATLAS, shopSignFor, discoverySignFor } from '../src/world/city-signs.js';
import { cityBlock, PAVEMENT_LEVEL as G } from '../src/world/city-grid.js';
import { planBuildings } from '../src/world/city-buildings.js';
import { publicSpacePlan } from '../src/world/city-public-space-kit.js';
import { CitydriverChunk, CitydriverWorld } from '../src/world/citydriver-world.js';
import { venueSignLabel } from '../src/world/city-destinations.js';
import { placeForBlock } from '../src/city-exploration.js';

class CaptureChunk extends CitydriverChunk {
  *finishSteps() { this.capturedBatches = this.batches; yield* super.finishSteps(); }
}

test('business identities vary across the city and survive block regeneration', () => {
  const names = new Set(), shapes = new Set();
  for (let ix = -10; ix <= 10; ix++) for (let iz = -10; iz <= 10; iz++) {
    const block = cityBlock(ix, iz); if (block.kind !== 'blocks') continue;
    const buildings = planBuildings(block).buildings, repeated = planBuildings(block).buildings;
    buildings.forEach((b, i) => {
      const sign = shopSignFor(b);
      assert.equal(sign, shopSignFor(repeated[i]));
      assert.equal(sign.category, b.shop);
      names.add(sign.name); shapes.add(sign.shape);
    });
  }
  assert.equal(names.size, SHOP_SIGNS.length);
  assert.equal(names.size, 120);
  assert.equal(new Set(SHOP_SIGNS.map(sign => sign.subtitle)).size, 120);
  assert.equal(shapes.size, 5);
});

test('discovery boards identify the actual public-space design and fit a bounded shared atlas', () => {
  for (let ix = -15; ix <= 15; ix++) for (let iz = -15; iz <= 15; iz++) {
    const block = cityBlock(ix, iz);
    if (!block.landmark && !['park', 'plaza'].includes(block.kind)) continue;
    const design = publicSpacePlan(block), sign = discoverySignFor(block);
    assert.equal(sign.type, design.type); assert.equal(sign.variant, design.variant);
    assert.ok(sign.name === design.name || sign.subtitle === design.name);
    assert.equal(sign.name, placeForBlock(block).name);
    if (design.type === 'cinema') {
      assert.ok(sign.name.toUpperCase().includes(venueSignLabel('RIVOLI', design.variant)));
      assert.equal(venueSignLabel('RIVOLI TOWER', design.variant), `${venueSignLabel('RIVOLI', design.variant)} TOWER`);
    }
  }
  assert.ok(SIGN_CATALOG.length <= SIGN_ATLAS.columns * SIGN_ATLAS.rows);
  assert.equal(new Set(SIGN_CATALOG.map(sign => sign.tile)).size, SIGN_CATALOG.length);
  assert.ok(SIGN_ATLAS.width * SIGN_ATLAS.height <= 2048 * 3072);
});

test('different business signs share one batch and discovery backs retain their own readable faces', () => {
  const world = new CitydriverWorld(new THREE.Scene());
  let shops = 0, discoveries = 0;
  try {
    for (let ix = -5; ix <= 5 && (!shops || !discoveries); ix++) for (let iz = -5; iz <= 5 && (!shops || !discoveries); iz++) {
      const chunk = new CaptureChunk(ix, iz, world.materials);
      const signs = chunk.group.children.filter(mesh => mesh.material === world.materials.signs);
      assert.ok(signs.length <= 1, 'all shop identities share one draw batch per block');
      for (const mesh of signs) {
        assert.equal(mesh.geometry.index.count, 6);
        assert.equal(mesh.castShadow, false, 'no rectangular shadows from cutout planes');
        const batch = [...chunk.capturedBatches.values()].find(batch => batch.material === world.materials.signs);
        batch.items.forEach((item, i) => assert.equal(mesh.instanceColor.getX(i), item.signTile));
        if (chunk.plan.landmark || ['park', 'plaza'].includes(chunk.plan.kind)) {
          discoveries++;
          assert.equal(mesh.count, 4, 'two boards, each with a front and back in one batch');
          assert.ok(Math.abs(batch.items[1].yaw - batch.items[0].yaw - Math.PI) < 1e-8);
        } else if (new Set(batch.items.map(item => item.signTile)).size > 1) shops++;
      }
      chunk.dispose();
    }
    assert.ok(shops && discoveries);
  } finally { world.dispose(); }
});

test('storefront signs clear awnings, glazing and upper-floor decorations on every facade orientation', () => {
  const world = new CitydriverWorld(new THREE.Scene()), shapes = new Set(), facings = new Set(), types = new Set();
  let checked = 0;
  try {
    for (let ix = -7; ix <= 7; ix++) for (let iz = -7; iz <= 7; iz++) {
      const block = cityBlock(ix, iz); if (block.kind !== 'blocks') continue;
      const chunk = new CaptureChunk(ix, iz, world.materials);
      const batches = [...chunk.capturedBatches.values()];
      const signs = batches.find(batch => batch.material === world.materials.signs)?.items ?? [];
      chunk.features.buildings.forEach(b => types.add(b.type));
      for (const sign of signs) {
        checked++; shapes.add(SIGN_CATALOG[sign.signTile].shape); facings.add(sign.yaw);
        assert.ok(sign.p[1] - sign.scale[1] / 2 >= G + 3.75 - 1e-8, 'clearance above awnings and glazing');
        assert.ok(sign.p[1] + sign.scale[1] / 2 <= G + 5.12 + 1e-8, 'below first-floor trim');
        const nx = Math.sin(sign.yaw), nz = Math.cos(sign.yaw);
        for (const batch of batches) {
          if (batch.geometry.type !== 'BoxGeometry') continue;
          for (const box of batch.items) {
            if (box.anchor.s !== sign.anchor.s || box.anchor.u !== sign.anchor.u) continue;
            const dx = box.p[0] - sign.p[0], dy = box.p[1] - sign.p[1], dz = box.p[2] - sign.p[2];
            const halfAlong = (Math.abs(nz) * box.scale[0] + Math.abs(nx) * box.scale[2]) / 2;
            const halfOut = (Math.abs(nx) * box.scale[0] + Math.abs(nz) * box.scale[2]) / 2;
            const across = Math.abs(dx * nz - dz * nx), outward = dx * nx + dz * nz;
            const overlaps = across < sign.scale[0] / 2 + halfAlong - .001
              && Math.abs(dy) < (sign.scale[1] + box.scale[1]) / 2 - .001
              && outward + halfOut > -.001;
            assert.equal(overlaps, false, `decoration obscures ${SIGN_CATALOG[sign.signTile].name} in ${block.key}`);
          }
        }
      }
      chunk.dispose();
    }
    assert.ok(checked > 200); assert.equal(shapes.size, 5); assert.equal(facings.size, 4); assert.equal(types.size, 10);
  } finally { world.dispose(); }
});
