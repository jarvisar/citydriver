import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CitydriverChunk, CitydriverWorld } from '../src/world/citydriver-world.js';
import { packDistantChunk } from '../src/world/distant-city.js';
import { cityBlock } from '../src/world/city-grid.js';
import { cityLayout } from '../src/world/city-layout.js';
import { residentWindow, setResidentWindow } from '../src/world/resident.js';

test('interleaved incremental construction preserves scenery, collision and packed skyline data', t => {
  const world = new CitydriverWorld(new THREE.Scene()), addresses = new Map(), chunks = [];
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) {
    const plan = cityBlock(x, z), type = plan.landmark ? 'landmark' : plan.kind;
    if (!addresses.has(type)) addresses.set(type, [x, z]);
  }
  try {
    for (const [x, z] of addresses.values()) for (const distant of [false, true]) {
      chunks.push({ expected: new CitydriverChunk(x, z, world.materials, distant),
        actual: new CitydriverChunk(x, z, world.materials, distant, true) });
    }
    let now = 0, passes = 0;
    t.mock.method(performance, 'now', () => ++now);
    while (chunks.some(({ actual }) => actual.construction)) {
      for (const { actual } of chunks) actual.buildUntil(now + 2);
      assert.ok(++passes < 200, 'all recipes eventually finish');
      if (passes === 1) assert.ok(chunks.every(({ actual }) => actual.construction), 'a budgeted call leaves work for another frame');
    }
    assert.ok(passes > 10);
    for (const { actual, expected } of chunks) {
      assert.deepEqual(actual.features, expected.features);
      assert.deepEqual(actual.collisionBounds, expected.collisionBounds);
      assert.deepEqual(actual.walkers, expected.walkers);
      if (actual.distant) {
        packDistantChunk(actual); packDistantChunk(expected);
        assert.deepEqual([...actual.batches.keys()], [...expected.batches.keys()]);
        for (const [key, batch] of actual.batches) {
          const reference = expected.batches.get(key);
          for (const name of ['matrices', 'colors', 'riverAddress']) assert.deepEqual(batch[name], reference[name]);
          assert.equal(batch.geometry, reference.geometry); assert.equal(batch.material, reference.material);
        }
      } else {
        assert.equal(actual.group.children.length, expected.group.children.length);
        actual.group.children.forEach((mesh, i) => {
          const reference = expected.group.children[i];
          assert.equal(mesh.name, reference.name);
          if (mesh.isInstancedMesh) {
            assert.deepEqual(mesh.instanceMatrix.array, reference.instanceMatrix.array);
            assert.deepEqual(mesh.instanceColor.array, reference.instanceColor.array);
            assert.deepEqual(mesh.boundingSphere, reference.boundingSphere);
          } else {
            // Small furniture batches merge into one mesh with baked vertices.
            for (const name of ['position', 'normal', 'color']) assert.deepEqual(mesh.geometry.attributes[name].array, reference.geometry.attributes[name].array);
            assert.deepEqual(mesh.geometry.index.array, reference.geometry.index.array);
            assert.deepEqual(mesh.geometry.boundingSphere, reference.geometry.boundingSphere);
            assert.deepEqual(mesh.userData.batches, reference.userData.batches);
          }
          assert.equal(mesh.material, reference.material);
        });
      }
    }
  } finally {
    for (const { expected, actual } of chunks) { expected.dispose(); actual.dispose(); }
    world.dispose();
  }
});

test('prepared crossings generate no new blocks in either direction at every quality', t => {
  const previous = residentWindow();
  try {
    for (const ahead of [3, 4, 5]) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      setResidentWindow({ behind: 1, ahead });
      const world = new CitydriverWorld(new THREE.Scene());
      const at = (x, z, budgetMs = Infinity) => { const p = cityLayout(z, x); world.update(p.s, p.u, { budgetMs }); };
      try {
        // Negative addresses also exercise tile boundaries and origin rebasing.
        at(-56, -56);
        for (let frame = 0; frame < 64; frame++) at(-56 + dx * 35, -56 + dz * 35, 1000);
        const radius = ahead - 2, count = dx && dz ? 4 * radius + 1 : 2 * radius + 1;
        const demotions = new Map(world.prefetchedDemotions);
        assert.equal(demotions.size, count);
        assert.equal(world.prefetchedDetails.size, count);
        assert.equal(world.prefetched.size, dx && dz ? 21 : 11);
        assert.equal(world.prefetchBuild, null);
        const ground = t.mock.method(CitydriverChunk.prototype, 'buildGround');
        at(-56 + dx * 58, -56 + dz * 58, 0);
        assert.equal(ground.mock.callCount(), 0, 'crossing reuses incoming, outgoing and skyline blocks');
        ground.mock.restore();
        for (const [key, chunk] of demotions) assert.equal(world.distantChunks.get(key), chunk);
        assert.equal(world.prefetchedDemotions.size, 0);
        assert.equal([...world.collisionChunks(world.s, world.u)].length, 9);
        assert.equal(world.chunks.size + world.distantChunks.size, 121);
      } finally { world.dispose(); }
    }
  } finally { setResidentWindow(previous); }
});

test('turning away and disposing cancel partial construction and release its instance buffers', t => {
  const previous = residentWindow(); setResidentWindow({ behind: 1, ahead: 3 });
  const world = new CitydriverWorld(new THREE.Scene());
  const at = (s, budgetMs = Infinity) => { const p = cityLayout(s, 56); world.update(p.s, p.u, { budgetMs }); };
  try {
    at(56);
    let now = 0;
    t.mock.method(performance, 'now', () => ++now);
    for (const cancel of ['turn', 'dispose']) {
      let frames = 0;
      do { at(90, 5); assert.ok(++frames < 200); } while (!world.prefetchBuild?.chunk.group.children.length);
      const chunk = world.prefetchBuild.chunk;
      assert.ok(chunk.construction, 'mesh creation itself yields before completion');
      assert.equal(chunk.group.parent, null, 'unfinished blocks never enter the scene');
      const disposed = new Set();
      for (const mesh of chunk.group.children) mesh.addEventListener('dispose', () => disposed.add(mesh));
      if (cancel === 'turn') at(56, 5);
      else world.dispose();
      assert.equal(chunk.construction, null);
      assert.equal(world.prefetchBuild, null);
      assert.ok(chunk.group.children.every(mesh => disposed.has(mesh)));
      assert.equal(world.prefetchedDemotions.size, 0);
    }
  } finally { world.dispose(); setResidentWindow(previous); }
});

test('a crossing finishes an urgent partial collision block without starting it again', t => {
  const previous = residentWindow(); setResidentWindow({ behind: 1, ahead: 3 });
  const world = new CitydriverWorld(new THREE.Scene());
  const at = (s, budgetMs = Infinity) => { const p = cityLayout(s, 56); world.update(p.s, p.u, { budgetMs }); };
  try {
    at(56);
    let now = 0;
    const clock = t.mock.method(performance, 'now', () => ++now);
    at(90, 5);
    const chunk = world.prefetchBuild.chunk;
    assert.ok(chunk.construction);
    assert.ok(chunk.batches.size, 'some ground construction has already run');
    clock.mock.restore();
    const ground = t.mock.method(chunk, 'buildGround');
    at(114, 0);
    assert.equal(world.chunks.get(chunk.index), chunk);
    assert.equal(chunk.construction, null);
    assert.equal(ground.mock.callCount(), 0);
    assert.equal([...world.collisionChunks(world.s, world.u)].length, 9);
    assert.equal(world.chunks.size + world.distantChunks.size, 121);
  } finally { world.dispose(); setResidentWindow(previous); }
});
