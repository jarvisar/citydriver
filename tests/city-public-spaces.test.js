import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CITY_HALL_BLOCK } from '../src/world/city-places.js';
import { cityBlock, CITY_BLOCK, PAVEMENT_LEVEL } from '../src/world/city-grid.js';
import { cityLogical, cityLayout, cityRigidFrame } from '../src/world/city-layout.js';
import { blockStreets } from '../src/world/city-streets.js';
import { CitydriverChunk, CitydriverWorld } from '../src/world/citydriver-world.js';
import { publicSpacePlan, SPACE_NAMES, entrancePath } from '../src/world/city-public-space-kit.js';
import { pathPanels, signedArea, subtractPolygon, distanceToPath, insetPolygon, containsPoint } from '../src/world/city-surfaces.js';
import { ellipsePoints, pondOutline, roundDisk, basinRim, pondRim, basinWater, pondWater, canopy, planet } from '../src/world/city-public-space-geometry.js';
import { grassGeometry, MAX_GRASS_TUFTS } from '../src/world/city-grass.js';
import { donutDough, donutGlaze } from '../src/world/city-donut.js';
import { cityAffinePoint } from '../src/world/city-layout-render.js';

// Retain generated instances so near/far structures can be compared directly.
// Exclude the independent streets and furniture, which already have LOD tests.
class PublicSpaceChunk extends CitydriverChunk {
  buildGround() {}
  buildRoads() {}
  buildFurniture() {}
  buildLife() {}
  *finishSteps() {}
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
  const hall = cityBlock(CITY_HALL_BLOCK.ix, CITY_HALL_BLOCK.iz);
  result.set('cityhall-0', [hall]);
  return result;
}
test('public spaces cover every destination design and neighbouring ordinary spaces never duplicate their layout', () => {
  const found = samples(); assert.equal(found.size, Object.values(SPACE_NAMES).reduce((n, designs) => n + designs.length, 0));
  for (const blocks of found.values()) {
    const ordinary = blocks[0].kind === 'park' || blocks[0].kind === 'plaza';
    assert.equal(blocks.length, blocks[0].landmark === 'cityhall' ? 1 : ordinary ? 4 : 3);
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
        assert.equal(batch.geometry, near.batches.get(batchKey)?.geometry, `${key}: shared geometry across detail levels`);
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
      const grass = near.batches.get('grass-fringe');
      if (block.kind === 'park' || block.landmark === 'garden') assert.ok(grass?.items.length, `${key}: lawns receive a light fringe`);
      assert.ok(!far.batches.has('grass-fringe'), `${key}: grass stays out of the distant city`);
      if (grass) {
        assert.equal(grass.geometry, grassGeometry);
        assert.ok(grass.items.length <= MAX_GRASS_TUFTS && grass.geometry.attributes.position.count / 3 === 12);
        assert.deepEqual(grass.items, again.batches.get('grass-fringe').items, `${key}: grass revisits are deterministic`);
        for (const tuft of grass.items) {
          const p = cityAffinePoint(near.start - tuft.p[2], near.east + tuft.p[0], tuft.anchor, tuft.frame);
          for (const collider of near.features.colliders) {
            if (collider.corners) assert.ok(!containsPoint(collider.corners.map(v => [v.x, -v.z]), p.u, p.s, -.55), `${key}: grass clears structures`);
            else assert.ok(Math.hypot(p.u - collider.x, p.s + collider.z) > collider.reach + .55, `${key}: grass clears posts`);
          }
          for (const walk of walks) for (const panel of pathPanels(walk.points, walk.width, [16, 16, 96, 96], walk.endSection)) {
            const polygon = panel.map(([x, s]) => { const q = cityLayout(near.start + s, near.east + x); return [q.u, q.s]; });
            assert.ok(!containsPoint(polygon, p.u, p.s, -.6), `${key}: grass leaves walking space clear`);
          }
        }
      }
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
        if (bench.p[1] > PAVEMENT_LEVEL + 1) continue; // Rooftop seating is above the entrance walk.
        assert.ok(distanceToPath(bench.p[0], -bench.p[2], walk.points) > walk.width / 2 + .4, `${key}: seating does not block paths`);
      }
      assert.ok([...far.batches.values()].reduce((n, b) => n + b.items.length, 0) < 650, `${key}: bounded geometry`);
      near.dispose(); far.dispose(); again.dispose();
    }
  } finally { world.dispose(); }
});

test('large round silhouettes stay rounded within a small shared geometry budget', () => {
  const circle = ellipsePoints(0, 0, 49, 49);
  // The widest circular paving must deviate by less than 22 cm from a circle.
  // The old octagon missed by almost two metres at this scale.
  for (let i = 0; i < circle.length; i++) {
    const a = circle[i], b = circle[(i + 1) % circle.length];
    assert.ok(24.5 - Math.hypot((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) < .22);
  }
  for (let i = 0; i < pondOutline.length; i++) {
    const a = pondOutline[i], b = pondOutline[(i + 1) % pondOutline.length], c = pondOutline[(i + 2) % pondOutline.length];
    assert.ok((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) > 0, 'pond reservations remain convex');
    assert.ok(Math.hypot((b[0] - a[0]) * 20.5, (b[1] - a[1]) * 16) < 4.2, 'pond shoreline has no long octagonal edges');
  }
  for (const [geometry, budget] of [[roundDisk, 96], [basinRim, 144], [pondRim, 192], [basinWater, 24], [pondWater, 32], [canopy, 24], [planet, 80]]) {
    assert.ok((geometry.index?.count ?? geometry.attributes.position.count) / 3 <= budget);
    assert.ok([...geometry.attributes.position.array, ...geometry.attributes.normal.array].every(Number.isFinite));
  }
});

test('new venues join their actual door thresholds and stay within a small near/far geometry budget', () => {
  const entries = {
    postoffice: { anchor: [56, 70], edge: [56, 50.25], width: 8 },
    bathhouse: { anchor: [56, 79], edge: [56, 67.25], width: 8 },
    farmersmarket: { anchor: [36, 74], edge: [36, 59.75], width: 5 },
    donut: { anchor: [56, 68], edge: [56, 52.25], width: 7 },
    cityhall: { anchor: [56, 71], edge: [56, 42.5], width: 10 },
  };
  const world = new CitydriverWorld(new THREE.Scene());
  try {
    for (const [key, blocks] of samples()) for (const block of blocks) {
      const entry = entries[block.landmark]; if (!entry) continue;
      for (const distant of [false, true]) {
        const c = new PublicSpaceChunk(block.ix, block.iz, world.materials, distant);
        try {
          const triangles = [...c.batches.values()].reduce((n, b) => n + (b.geometry.index?.count ?? b.geometry.attributes.position.count) / 3 * b.items.length, 0);
          assert.ok(triangles < (distant ? 4000 : 6000), `${key}: ${triangles} triangles`);
          assert.ok(!distant || !c.batches.has('structure-market-produce'), 'small produce is omitted at a distance');
          const walk = c.features.walkways.find(p => p.endSection);
          assert.ok(walk, `${key}: a continuous entry walk`);
          const frame = cityRigidFrame(c.start + entry.anchor[1], c.east + entry.anchor[0]);
          const anchor = { s: c.start + entry.anchor[1], u: c.east + entry.anchor[0] };
          for (const [i, sign] of [[0, -1], [1, 1]]) {
            const [x, s] = walk.endSection[i], actual = cityLayout(c.start + s, c.east + x);
            const expected = cityAffinePoint(c.start + entry.edge[1] + .12, c.east + entry.edge[0] + sign * entry.width / 2, anchor, frame);
            assert.ok(Math.hypot(actual.u - expected.u, actual.s - expected.s) < 1e-6, `${key}: paving overlaps the whole door sill`);
          }
        } finally { c.dispose(); }
      }
    }
  } finally { world.dispose(); }
});

test('the rooftop donut has an open hole and continuous frosting within a shared geometry budget', () => {
  const material = new THREE.MeshBasicMaterial();
  try {
    const dough = new THREE.Mesh(donutDough, material), icing = new THREE.Mesh(donutGlaze, material);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1));
    assert.equal(ray.intersectObjects([dough, icing]).length, 0, 'the central hole remains open');
    let triangles = 0;
    for (const geometry of [donutDough, donutGlaze]) {
      triangles += geometry.index.count / 3;
      assert.ok([...geometry.attributes.position.array, ...geometry.attributes.normal.array].every(Number.isFinite));
    }
    assert.ok(triangles <= 1440, 'the entire giant donut shares just two modest meshes');
    for (let i = 0; i < 80; i++) for (const radius of [7, 9, 11]) {
      const a = (i + .3) / 80 * Math.PI * 2;
      ray.ray.origin.set(Math.cos(a) * radius, Math.sin(a) * radius, 10);
      const top = ray.intersectObject(icing)[0], base = ray.intersectObject(dough)[0];
      assert.ok(top && base && top.distance < base.distance, 'icing faces outward and never cuts through the dough');
    }
  } finally { material.dispose(); }
});

test('basin water is recessed inside visible coping with no solid cap over the water', () => {
  const material = new THREE.MeshBasicMaterial();
  try {
    for (const [rim, water, outline] of [[basinRim, basinWater, ellipsePoints(0, 0, 2, 2)], [pondRim, pondWater, pondOutline]]) {
      const stone = new THREE.Mesh(rim, material), surface = new THREE.Mesh(water, material);
      stone.position.y = .26; stone.scale.set(20, .52, 16);
      surface.position.y = .34; surface.scale.set(18.8, 1, 15.04);
      stone.updateMatrixWorld(); surface.updateMatrixWorld();
      const ray = new THREE.Raycaster(new THREE.Vector3(0, 3, 0), new THREE.Vector3(0, -1, 0));
      assert.equal(ray.intersectObject(stone).length, 0, 'no hidden cylinder cap at basin center');
      assert.ok(ray.intersectObject(surface).length > 0, 'water faces upwards');
      for (let i = 0; i < outline.length; i++) {
        const a = outline[i], b = outline[(i + 1) % outline.length];
        ray.ray.origin.set((a[0] + b[0]) / 2 * 20 * .97, 3, -(a[1] + b[1]) / 2 * 16 * .97);
        const hit = ray.intersectObject(stone)[0];
        assert.ok(hit && Math.abs(hit.point.y - .52) < 1e-6, 'continuous upward-facing rim');
        assert.equal(ray.intersectObject(surface).length, 0, 'water does not protrude through coping');
      }
    }
  } finally { material.dispose(); }
});

test('entrance walks cover the full rigid threshold width on curved blocks', () => {
  const material = new THREE.MeshBasicMaterial();
  try {
    for (const [ix, iz] of [[0, 0], [2, 4], [-4, -8], [-37, 15], [19, -23]]) {
      const c = Object.assign(Object.create(CitydriverChunk.prototype), {
        east: ix * CITY_BLOCK, start: iz * CITY_BLOCK, features: { colliders: [] }, batches: new Map(), layoutFrames: new Map(),
        group: new THREE.Group(), materials: { solid: material },
      });
      entrancePath(c, [[56, 16], [56, 44]], 8, '#ffffff', [56, 70], [56, 44]);
      const walk = c.features.walkways[0], frame = cityRigidFrame(c.start + 70, c.east + 56);
      for (const [i, dx] of [[0, -4], [1, 4]]) {
        const [x, s] = walk.endSection[i], actual = cityLayout(c.start + s, c.east + x);
        const expected = { u: frame.u + frame.eu * dx - frame.nu * 25.88, s: frame.s + frame.es * dx - frame.ns * 25.88 };
        assert.ok(Math.hypot(actual.u - expected.u, actual.s - expected.s) < 1e-6, 'both corners follow the doorway frame');
      }
      c.finish(); c.group.updateMatrixWorld(true);
      for (const dx of [-3.8, -2, 0, 2, 3.8]) {
        const u = frame.u + frame.eu * dx - frame.nu * 25.96, s = frame.s + frame.es * dx - frame.ns * 25.96;
        const ray = new THREE.Raycaster(new THREE.Vector3(u - c.east, PAVEMENT_LEVEL + 5, c.start - s), new THREE.Vector3(0, -1, 0));
        assert.ok(ray.intersectObjects(c.group.children).length, 'rendered paving reaches the door across its full width');
      }
      c.dispose();
    }
  } finally { material.dispose(); }
});

test('walking routes contrast with their park or plaza floor across palettes', () => {
  const luminance = hex => {
    const c = new THREE.Color(hex); return c.r * .2126 + c.g * .7152 + c.b * .0722;
  };
  for (const blocks of samples().values()) for (const block of blocks) {
    const { type, palette: p } = publicSpacePlan(block);
    const path = luminance(p.path), floor = luminance(type === 'park' || type === 'garden' ? p.green : p.stone);
    assert.ok((Math.max(path, floor) + .05) / (Math.min(path, floor) + .05) > 1.7, `${type}: visible paving contrast`);
  }
});
