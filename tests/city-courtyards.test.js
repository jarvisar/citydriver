import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityBlock, CITY_BLOCK as B } from '../src/world/city-grid.js';
import { cityLayout } from '../src/world/city-layout.js';
import { planBuildings } from '../src/world/city-buildings.js';
import { placeCityBuildings, parcelsOverlap, footprintFitsBlock } from '../src/world/city-parcels.js';
import { planCourtyard } from '../src/world/city-courtyards.js';
import { pathPanels, signedArea, subtractPolygon } from '../src/world/city-surfaces.js';
import { CitydriverChunk, CitydriverWorld, blockBatches } from '../src/world/citydriver-world.js';

test('courtyards keep walks, full planting groups and rejected-lot lawns clear of fitted buildings', () => {
  const layouts = new Set(), turns = new Set();
  let groups = 0, walks = 0, lawns = 0, sites = 0;
  for (let ix = -12; ix <= 12; ix++) for (let iz = -12; iz <= 12; iz++) {
    const block = cityBlock(ix, iz);
    if (block.kind !== 'blocks' || block.landmark) continue;
    const architecture = planBuildings(block), placement = placeCityBuildings(block, architecture.buildings);
    const plan = planCourtyard(block, architecture, placement);
    assert.deepEqual(plan, planCourtyard(block, architecture, placement));
    layouts.add(architecture.layout); turns.add(architecture.rotation); sites++;
    const mapped = ([x, s]) => cityLayout(iz * B + s, ix * B + x);
    const panels = plan.walks.flatMap(walk => pathPanels(walk.points, walk.width + .5).map(p => p.map(mapped)));
    for (const panel of panels) for (const b of placement.buildings) {
      assert.equal(parcelsOverlap(panel, b.corners, .3), false, `${block.key}: walk meets a building`);
    }
    for (const island of plan.islands) {
      assert.ok(footprintFitsBlock(block, island.corners, 3));
      for (const b of placement.buildings) assert.equal(parcelsOverlap(island.corners, b.corners, 1.3), false);
      for (const panel of panels) assert.equal(parcelsOverlap(island.corners, panel, .8), false, `${block.key}: blocked passage`);
      for (const other of plan.islands) if (other !== island) assert.equal(parcelsOverlap(island.corners, other.corners, 1), false);
    }
    for (const lawn of plan.lawns) {
      const polygon = lawn.map(mapped).map(p => [p.u, p.s]);
      for (const b of placement.buildings) {
        const visible = subtractPolygon(polygon, b.corners.map(p => [p.u, p.s]));
        const overlap = Math.abs(signedArea(polygon)) - visible.reduce((sum, p) => sum + Math.abs(signedArea(p)), 0);
        assert.ok(overlap < .01, `${block.key}: lawn overlaps building by ${overlap}`);
      }
    }
    groups += plan.islands.length; walks += plan.walks.length; lawns += plan.lawns.length;
  }
  assert.equal(layouts.size, 5); assert.equal(turns.size, 4);
  assert.ok(groups > sites, 'retain useful courtyard planting');
  assert.ok(walks > sites * .9); assert.ok(lawns > 0);
});

test('courtyard layout survives detail transitions and seating has collision', () => {
  const world = new CitydriverWorld(new THREE.Scene());
  let count = 0;
  try {
    for (let ix = -6; ix <= 6 && count < 8; ix++) for (let iz = -6; iz <= 6 && count < 8; iz++) {
      const block = cityBlock(ix, iz);
      if (block.kind !== 'blocks' || block.landmark) continue;
      const near = new CitydriverChunk(ix, iz, world.materials), far = new CitydriverChunk(ix, iz, world.materials, true);
      assert.deepEqual(near.features.courtyard, far.features.courtyard);
      const islands = near.features.courtyard.islands;
      assert.equal([...blockBatches(near.group)].find(batch => batch.name === 'bench')?.count ?? 0, islands.length);
      const seats = near.features.colliders.filter(c => (c.halfWidth === 1.05 && c.halfLength === .375) || (c.halfWidth === .375 && c.halfLength === 1.05));
      assert.equal(seats.length, islands.length);
      near.dispose(); far.dispose(); count++;
    }
  } finally { world.dispose(); }
  assert.equal(count, 8);
});
