import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CitydriverChunk, CitydriverWorld, DISTANT_CITY_RADIUS } from '../src/world/citydriver-world.js';
import { cityCell } from '../src/world/city-grid.js';
import { cityLayout } from '../src/world/city-layout.js';
import { cityItemMatrix } from '../src/world/city-layout-render.js';
import { residentWindow, setResidentWindow } from '../src/world/resident.js';
import { collideScenery } from '../src/collision.js';
import { Graphics, QUALITY_LEVELS, PIXEL_BUDGETS, drawingPixelRatio } from '../src/graphics.js';
import { AmbientOcclusion } from '../src/ambient-occlusion.js';

function coverage(world, s, u) {
  const cell = cityCell(s, u);
  assert.equal([...world.collisionChunks(s, u)].length, 9, 'all nearby collisions are available immediately');
  assert.equal(world.chunks.size + world.distantChunks.size, (2 * DISTANT_CITY_RADIUS + 1) ** 2);
  for (let ix = cell.ix - DISTANT_CITY_RADIUS; ix <= cell.ix + DISTANT_CITY_RADIUS; ix++) {
    for (let iz = cell.iz - DISTANT_CITY_RADIUS; iz <= cell.iz + DISTANT_CITY_RADIUS; iz++) {
      const key = `${ix},${iz}`;
      assert.notEqual(world.chunks.has(key), world.distantChunks.has(key), `${key} must have exactly one level of detail`);
    }
  }
}

test('budgeted streaming preserves continuous coverage and collisions through teleports, turns and quality changes', () => {
  const previous = residentWindow(), world = new CitydriverWorld(new THREE.Scene());
  try {
    for (const [s, u, ahead] of [[24, 3, 3], [145, 3, 5], [-4200, -3100, 3], [2130, 980, 5]]) {
      setResidentWindow({ ahead, behind: 1 });
      world.update(s, u, { budgetMs: 0 }); coverage(world, s, u);
      assert.ok(world.pending.length, 'optional detail is deferred');
      let frames = 0;
      while (world.pending.length) {
        const pending = world.pending.length;
        world.update(s, u, { budgetMs: 0 }); coverage(world, s, u);
        assert.ok(world.pending.length < pending, 'even a zero budget makes progress');
        assert.ok(++frames < 50);
      }
      assert.equal(world.chunks.size, ahead === 5 ? 49 : 25);
      world.scene.updateMatrixWorld();
      for (const chunk of world.chunks.values()) {
        assert.equal(chunk.group.matrixWorld.elements[12], chunk.east);
        assert.equal(chunk.group.matrixWorld.elements[14], world.origin - chunk.start);
      }
    }
  } finally { world.dispose(); setResidentWindow(previous); }
});

test('unchanged distant tiles retain GPU buffers and retired tiles dispose their instances', () => {
  const world = new CitydriverWorld(new THREE.Scene());
  try {
    world.update(24, 3);
    const tiles = new Map([...world.distantCity.tiles].map(([key, tile]) => [key, {
      members: [...tile.chunks.keys()].sort().join('/'), meshes: [...tile.group.children],
    }]));
    const disposed = new Set();
    for (const { meshes } of tiles.values()) for (const mesh of meshes) mesh.addEventListener('dispose', () => disposed.add(mesh));
    world.update(145, 3);
    let retained = 0, retired = 0;
    for (const [key, old] of tiles) {
      const tile = world.distantCity.tiles.get(key);
      if (tile && [...tile.chunks.keys()].sort().join('/') === old.members) {
        assert.deepEqual(tile.group.children, old.meshes); retained++;
      } else {
        for (const mesh of old.meshes) assert.ok(disposed.has(mesh));
        retired++;
      }
    }
    assert.ok(retained > 0 && retired > 0);
    const live = [];
    world.distantGroup.traverse(mesh => { if (mesh.isInstancedMesh) {
      live.push(mesh); mesh.addEventListener('dispose', () => disposed.add(mesh));
    } });
    world.dispose();
    assert.ok(live.every(mesh => disposed.has(mesh)));
    assert.equal(world.scene.children.length, 0);
  } finally { world.dispose(); }
});

test('packed distant tiles preserve block transforms and colors at negative and rebased coordinates', () => {
  const world = new CitydriverWorld(new THREE.Scene());
  const actual = new THREE.Matrix4(), expected = new THREE.Matrix4(), color = new THREE.Color();
  try {
    for (const [s, u] of [[24, 3], [-2400, -1400]]) {
      world.update(s, u); world.scene.updateMatrixWorld();
      const chunk = world.distantChunks.values().next().value;
      const source = new CitydriverChunk(chunk.ix, chunk.iz, world.materials, true);
      const tile = world.distantCity.tiles.get(world.distantCity.key(chunk));
      for (const [key, batch] of source.batches) {
        if (!batch.items.length) continue;
        const mesh = tile.group.getObjectByName(`citydriver-${key}`);
        let offset = 0;
        for (const part of tile.chunks.values()) {
          if (part === chunk) break;
          offset += (part.batches.get(key)?.colors.length ?? 0) / 3;
        }
        for (const index of new Set([0, Math.floor(batch.items.length / 2), batch.items.length - 1])) {
          const item = batch.items[index];
          cityItemMatrix(item, chunk.east, chunk.start, expected);
          expected.elements[12] += chunk.east; expected.elements[14] += world.origin - chunk.start;
          mesh.getMatrixAt(offset + index, actual); actual.premultiply(mesh.matrixWorld);
          actual.elements.forEach((value, i) => assert.ok(Math.abs(value - expected.elements[i]) < .001, `${key} element ${i}`));
          mesh.getColorAt(offset + index, color);
          const expectedColor = new THREE.Color(item.color);
          assert.ok(Math.abs(color.r - expectedColor.r) + Math.abs(color.g - expectedColor.g) + Math.abs(color.b - expectedColor.b) < 1e-6);
        }
      }
      assert.ok([...chunk.batches.values()].every(batch => !batch.items && batch.matrices instanceof Float32Array));
    }
  } finally { world.dispose(); }
});

test('replacing batches under static parents preserves their world transforms when quality changes at rest', () => {
  const previous = residentWindow(), scene = new THREE.Scene(); scene.matrixAutoUpdate = false;
  const world = new CitydriverWorld(scene);
  try {
    for (const ahead of [5, 3, 5, 3]) {
      setResidentWindow({ ahead, behind: 1 });
      world.update(-150, -240); scene.updateMatrixWorld();
      for (const tile of world.distantCity.tiles.values()) for (const mesh of tile.group.children) {
        assert.deepEqual(mesh.matrixWorld.elements, tile.group.matrixWorld.elements, tile.group.name);
      }
    }
  } finally { world.dispose(); setResidentWindow(previous); }
});

test('prefetch prepares a bounded future strip and reuses it when crossing the boundary', () => {
  const world = new CitydriverWorld(new THREE.Scene());
  try {
    const initial = cityLayout(65, 55); world.update(initial.s, initial.u);
    // Large budget removes machine-speed dependence from this cache test;
    // the production loop uses 3 ms and still builds at most one per frame.
    for (let i = 0; i < 24; i++) {
      const p = cityLayout(66 + i, 55); world.update(p.s, p.u, { budgetMs: 1000 });
      assert.ok(world.prefetched.size <= 21);
    }
    assert.ok(world.prefetched.size >= 11);
    const cached = new Map(world.prefetched);
    const next = cityLayout(114, 55); world.update(next.s, next.u, { budgetMs: 0 });
    let reused = 0;
    for (const [key, chunk] of cached) if (world.distantChunks.get(key) === chunk) reused++;
    assert.ok(reused >= 11, `reused ${reused} prepared blocks`);
    coverage(world, next.s, next.u);
  } finally { world.dispose(); }
  assert.equal(world.prefetched.size, 0);
});

test('offscreen residents skip uploads and catch up to the absolute clock when the camera moves', () => {
  const world = new CitydriverWorld(new THREE.Scene());
  const camera = new THREE.OrthographicCamera(-35, 35, 35, -35, 1, 300);
  try {
    world.update(24, 3);
    camera.position.set(0, 180, 0); camera.lookAt(0, 24, 0);
    world.animate(2, 2, camera);
    const offscreen = [...world.chunks.values()].find(c => c.peopleMesh.instanceMatrix.version === 0);
    assert.ok(offscreen);
    world.animate(20, 20, camera);
    assert.equal(offscreen.peopleMesh.instanceMatrix.version, 0);
    const center = offscreen.peopleMesh.boundingSphere.center.clone().add(offscreen.group.position);
    camera.position.copy(center).add(new THREE.Vector3(0, 150, 0)); camera.lookAt(center);
    world.animate(20, 20, camera);
    const caughtUp = offscreen.peopleMesh.instanceMatrix.array.slice();
    assert.ok(offscreen.peopleMesh.instanceMatrix.version > 0);
    world.animate(20, 20);
    assert.deepEqual(offscreen.peopleMesh.instanceMatrix.array, caughtUp);
  } finally { world.dispose(); }
});

test('chunk collision bounds give identical contacts to a full scenery scan', () => {
  const world = new CitydriverWorld(new THREE.Scene());
  try {
    world.update(-150, -240);
    for (const chunk of [...world.chunks.values()].slice(0, 8)) for (const solid of chunk.features.colliders.slice(0, 5)) {
      const hits = [];
      const player = { s: -solid.z, route: { grid: true }, spec: { width: 2, length: 4 }, heading: .6,
        groundedPosition: { x: solid.x, z: solid.z }, resolveSceneryCollision: (...args) => hits.push(args) };
      collideScenery(player, world.chunks, 1 / 60);
      const culled = [...hits]; hits.length = 0;
      collideScenery(player, new Map([...world.chunks].map(([key, chunk]) => [key, { features: chunk.features }])), 1 / 60);
      assert.deepEqual(culled, hits);
    }
  } finally { world.dispose(); }
});

test('presets bound dense and large framebuffers while explicit density choices remain exact', () => {
  for (const [width, height, dpr] of [[390, 844, 3], [844, 390, 3], [3840, 2160, 2], [1280, 800, 1]]) {
    let last = Infinity;
    for (const settings of QUALITY_LEVELS) {
      const ratio = drawingPixelRatio(settings, dpr, width, height), budget = PIXEL_BUDGETS[settings.id];
      assert.ok(ratio < last, `${settings.id} removes pixels`); last = ratio;
      assert.ok(width * height * ratio ** 2 <= budget.pixels + 1e-6);
      assert.ok(ratio <= budget.ratio);
      assert.equal(drawingPixelRatio({ ...settings, customDensity: true }, dpr, width, height), dpr * settings.density);
    }
  }
  const graphics = new Graphics({ storage: null, detect: () => 3 });
  graphics.setDensity(1); assert.equal(drawingPixelRatio(graphics.settings, 3, 390, 844), 3);
  graphics.setMode('basic'); assert.equal(drawingPixelRatio(graphics.settings, 3, 390, 844), 1);
});

test('optional shading loads once on demand, follows camera and quality changes, and releases resources', async () => {
  let loaded = 0, constructed = 0, disposed = 0, drawn = 0, notified = 0, resolve;
  class Effect {
    constructor(renderer, scene, camera) { constructed++; this.camera = camera; }
    setQuality(quality) { this.quality = quality; }
    render(camera) { this.camera = camera; drawn++; }
    dispose() { disposed++; }
  }
  const ao = new AmbientOcclusion({ render() {} }, {}, {}, {
    load: () => { loaded++; return new Promise(done => { resolve = done; }); }, onReady: () => notified++,
  });
  ao.render({}); assert.equal(loaded, 0);
  ao.enabled = true; ao.render({}); ao.render({}); assert.equal(loaded, 1);
  ao.setQuality('low'); const camera = {}; ao.render(camera);
  resolve({ AmbientOcclusion: Effect }); await ao.ready;
  assert.equal(constructed, 1); assert.equal(notified, 1); assert.equal(ao.effect.quality, 'low');
  assert.equal(ao.effect.camera, camera);
  ao.render(camera); assert.equal(drawn, 1);
  ao.enabled = false; assert.equal(disposed, 1); assert.equal(ao.effect, null);
  ao.enabled = true; ao.render(camera); ao.dispose();
  resolve({ AmbientOcclusion: Effect }); await ao.ready;
  assert.equal(constructed, 1, 'a late import cannot resurrect disposed targets');
});
