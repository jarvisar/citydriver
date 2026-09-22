import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { compactGeometry } from '../src/world/compact-geometry.js';
import { CityMapCache, buildMapBlock } from '../src/city-map.js';
import { CitydriverWorld } from '../src/world/citydriver-world.js';
import { residentWindow, setResidentWindow } from '../src/world/resident.js';
import { cityLayout, cityLanePose } from '../src/world/city-layout.js';
import { citydriverRoute } from '../src/world/city-grid.js';
import { CityTraffic } from '../src/city-traffic.js';
import { TaxiView } from '../src/taxi-view.js';

const bytes = geometry => Object.values(geometry.attributes).reduce((sum, a) => sum + a.array.byteLength, geometry.index?.array.byteLength ?? 0);
test('geometry compaction preserves every triangle attribute, hard edge, UV seam and colour', () => {
  for (const input of [new THREE.BoxGeometry(), new THREE.SphereGeometry(1, 12, 6), new THREE.CylinderGeometry(.09, .15, 7.2, 6)]) {
    const g = input.toNonIndexed(), original = g.clone();
    const colors = new Float32Array(g.attributes.position.count * 3);
    // Distinct per-face colours must prevent otherwise legal vertex sharing.
    for (let i = 0; i < colors.length; i++) colors[i] = Math.floor(i / 18) % 2;
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    original.setAttribute('color', g.attributes.color.clone());
    const before = bytes(g); compactGeometry(g);
    assert.ok(g.index && bytes(g) < before);
    const expanded = g.toNonIndexed();
    for (const [name, a] of Object.entries(original.attributes)) assert.deepEqual(expanded.attributes[name].array, a.array, name);
    assert.deepEqual(g.groups, original.groups);
    const index = g.index; compactGeometry(g); assert.equal(g.index, index, 'already indexed geometry is retained');
    for (const geometry of [input, g, original, expanded]) geometry.dispose();
  }
});

test('minimap reuses paths, evicts old blocks and preserves painter order across turns and teleports', () => {
  let builds = 0;
  const cache = new CityMapCache((x, z) => { builds++; return buildMapBlock(x, z); }, () => ({
    points: [], moveTo(x, y) { this.points.push([x, y]); }, lineTo(x, y) { this.points.push([x, y]); }, closePath() {},
  }));
  cache.update(0, 0); assert.equal(builds, 63);
  const block = cache.blocks.get('0,0'), source = buildMapBlock(0, 0);
  block.shapes.forEach((shape, i) => {
    assert.equal(shape.color, source.shapes[i].color);
    assert.deepEqual(shape.path.points, source.shapes[i].points.map(p => [p.u - block.u, p.s - block.s]));
  });
  cache.update(0, 0); assert.equal(builds, 63);
  cache.update(1, 0); assert.equal(builds, 70); assert.equal(cache.blocks.get('0,0'), block);
  cache.update(1, 1); assert.equal(builds, 79);
  for (const [x, z] of [[-1, -1], [-400, 500], [400, -500], [0, 0]]) {
    cache.update(x, z); assert.equal(cache.blocks.size, 63);
    const expected = [];
    for (let ix = x - 4; ix <= x + 4; ix++) for (let iz = z - 3; iz <= z + 3; iz++) expected.push(`${ix},${iz}`);
    assert.deepEqual([...cache.blocks.keys()], expected);
  }
});

test('Basic preloads collision strips in every direction, reuses them and disposes abandoned buffers', () => {
  const previous = residentWindow(); setResidentWindow({ behind: 1, ahead: 3 });
  try {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
      const world = new CitydriverWorld(new THREE.Scene());
      try {
        const at = (x, z, budgetMs = Infinity) => { const p = cityLayout(z, x); world.update(p.s, p.u, { budgetMs }); };
        at(56, 56);
        for (let i = 1; i <= 30; i++) at(56 + dx * (12 + i), 56 + dz * (12 + i), 1000);
        const cached = new Map(world.prefetchedDetails);
        assert.equal(cached.size, dx && dz ? 5 : 3);
        assert.equal(world.chunks.size, 9); assert.equal(world.prefetched.size, dx && dz ? 21 : 11);
        const disposed = new Set();
        for (const chunk of cached.values()) for (const mesh of chunk.group.children) mesh.addEventListener('dispose', () => disposed.add(mesh));
        at(56 + dx * 58, 56 + dz * 58, 0);
        for (const [key, chunk] of cached) assert.equal(world.chunks.get(key), chunk, 'crossing uses prebuilt detail');
        assert.equal(world.prefetchedDetails.size, 0);
        assert.equal([...world.collisionChunks(world.s, world.u)].length, 9);
        world.dispose();
        for (const chunk of cached.values()) for (const mesh of chunk.group.children) assert.ok(disposed.has(mesh));
      } finally { world.dispose(); }
    }
    const world = new CitydriverWorld(new THREE.Scene());
    try {
      const start = cityLayout(56, 56); world.update(start.s, start.u);
      const next = cityLayout(90, 56); world.update(next.s, next.u, { budgetMs: 1000 });
      assert.equal(world.prefetchedDetails.size, 1);
      const mesh = world.prefetchedDetails.values().next().value.group.children[0]; let disposed = false;
      mesh.addEventListener('dispose', () => { disposed = true; });
      world.update(start.s, start.u, { budgetMs: 1000 });
      assert.ok(disposed, 'turning away releases unused prebuilt meshes');
      assert.equal(world.prefetchedDetails.size, 0);
    } finally { world.dispose(); }
  } finally { setResidentWindow(previous); }
});

test('render frames between physics steps retain and finish the prepared city strip', () => {
  const previous = residentWindow(); setResidentWindow({ behind: 1, ahead: 3 });
  const world = new CitydriverWorld(new THREE.Scene());
  const at = (s, u) => { const p = cityLayout(s, u); world.update(p.s, p.u, { budgetMs: 1000 }); };
  try {
    at(56, 56); at(80, 56);
    const target = world.prefetchTarget, [key, chunk] = world.prefetchedDetails.entries().next().value;
    let disposed = false;
    chunk.group.children[0].addEventListener('dispose', () => { disposed = true; });
    for (let frame = 0; frame < 30; frame++) at(80, 56);
    assert.equal(world.prefetchTarget, target, 'no physics step is not a change of direction');
    assert.equal(world.prefetchedDetails.get(key), chunk);
    assert.equal(disposed, false);
    assert.equal(world.prefetchedDetails.size, 3);
    assert.equal(world.prefetched.size, 11, 'stationary frames finish loading the same skyline');
    at(114, 56);
    assert.equal(world.chunks.get(key), chunk, 'the next block uses the retained buffers');
    assert.equal([...world.collisionChunks(world.s, world.u)].length, 9);
  } finally { world.dispose(); setResidentWindow(previous); }
});

test('curved roads prepare only the logical direction of travel at every detail level', () => {
  const previous = residentWindow();
  try {
    for (const [ahead, radius] of [[3, 1], [4, 2], [5, 3]]) for (const direction of [-1, 1]) {
      setResidentWindow({ behind: 1, ahead });
      const world = new CitydriverWorld(new THREE.Scene());
      const at = (s, budgetMs = 1000) => { const p = cityLayout(s, 3); world.update(p.s, p.u, { budgetMs }); };
      try {
        at(56, Infinity);
        // A road near the cell's west edge curves in world coordinates. That
        // curvature must not queue a spurious diagonal strip to the west.
        for (let step = 0; step < 40; step++) at(56 + direction * (14 + step * .5));
        assert.equal(world.prefetchedDetails.size, radius * 2 + 1);
        assert.equal(world.prefetched.size, 11);
        const cached = new Map(world.prefetchedDetails);
        at(56 + direction * 58);
        for (let frame = 0; frame < 10; frame++) at(56 + direction * 58);
        for (const [key, chunk] of cached) assert.equal(world.chunks.get(key), chunk, 'all detail levels reuse the prepared strip');
        assert.equal([...world.collisionChunks(world.s, world.u)].length, 9);
      } finally { world.dispose(); }
    }
  } finally { setResidentWindow(previous); }
});

test('traffic lane-coordinate fast path agrees with inverse-mapped repositioning on curved roads', () => {
  const traffic = new CityTraffic(new THREE.Scene(), citydriverRoute, 0);
  try {
    const car = traffic.vehicles[0];
    for (const axis of ['north', 'east']) for (const direction of [-1, 1]) for (const along of [-2200, -116, 0, 119, 2100]) {
      Object.assign(car, { axis, direction, lane: 339 }, cityLanePose(axis, 339, along, direction));
      traffic.pose(car); const position = car.position.clone(), quaternion = car.quaternion.clone();
      traffic.pose(car, along);
      assert.ok(position.distanceTo(car.position) < 1e-7);
      assert.ok(1 - Math.abs(quaternion.dot(car.quaternion)) < 1e-10);
    }
  } finally { traffic.dispose(); }
});

test('skid buffers upload only new tracks and retain world placement through rebases and wraparound', () => {
  const view = new TaxiView(new THREE.Scene()), run = { running: true, revision: -1 };
  const vehicle = { drifting: true, u: 3, s: 24, heading: .7 };
  try {
    view.render(run, vehicle, 0, 1);
    assert.equal(view.skids.count, 2);
    const version = view.skids.instanceMatrix.version, first = view.skids.instanceMatrix.array.slice();
    view.skids.instanceMatrix.clearUpdateRanges();
    vehicle.drifting = false;
    view.render(run, vehicle, 1024, 2);
    assert.equal(view.skids.instanceMatrix.version, version);
    assert.deepEqual(view.skids.instanceMatrix.array, first);
    assert.equal(view.group.position.z, 1024);
    vehicle.drifting = true;
    for (let i = 0; i < 81; i++) {
      vehicle.s++; view.render(run, vehicle, 1024, i + 3);
      assert.equal(view.skids.instanceMatrix.updateRanges.reduce((sum, r) => sum + r.count, 0), 32);
      view.skids.instanceMatrix.clearUpdateRanges();
    }
    assert.equal(view.skids.count, 160);
    const actual = new THREE.Matrix4();
    for (let i = 0; i < 160; i++) {
      view.skids.getMatrixAt(i, actual);
      assert.ok(Math.abs(actual.elements[12] - view.trails[i].x) < 1e-5);
      assert.ok(Math.abs(actual.elements[14] - view.trails[i].z) < 1e-5);
    }
    view.reset(); assert.equal(view.skids.count, 0);
  } finally { view.dispose(); }
});
