import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityDiscoveries, cityDiscoveryClears, cityLotClears, CITY_DISCOVERY_SPACING } from '../src/world/city-discoveries.js';
import { blockBoundary, nearStreet, quayOffset, BANDS, cityPosition } from '../src/world/city-route.js';
import { CityChunk } from '../src/world/city.js';
import { packChunk, unpackChunk } from '../src/world/chunk-transfer.js';
import { drapeCityLawn } from '../src/world/city-surfaces.js';

test('city discoveries are sparse, varied, on the street grid, and stable across reversed chunk queries', () => {
  const sites = cityDiscoveries(-100000, 100000);
  assert.deepEqual(cityDiscoveries(-100000, 0).concat(cityDiscoveries(0, 100000)), sites);
  assert.ok(sites.length > 35 && sites.length < 65, 'roughly one special encounter per 2.5 miles');
  assert.deepEqual([...new Set(sites.map(site => site.kind))].sort(), ['clock-tower', 'river-bridge', 'square']);
  for (let i = 1; i < sites.length; i++) assert.ok(sites[i].s - sites[i - 1].s > 900, 'leave breathing room between discoveries');
  for (const site of [...sites].reverse()) {
    assert.ok(Math.abs(site.s - (site.index + .5) * CITY_DISCOVERY_SPACING) < 1400);
    const start = Math.floor(site.s / 128) * 128;
    assert.deepEqual(cityDiscoveries(start, start + 128), sites.filter(other => other.s >= start && other.s < start + 128));
    assert.ok(!cityDiscoveryClears(site.s, site.u, [site]));
    assert.ok(cityDiscoveryClears(site.s + site.halfS + 5, site.u, [site]));
    assert.ok(!cityLotClears(site.s - 2, site.s + 2, site.u - 1, site.u + 1, [site]));
    assert.ok(cityLotClears(site.s + site.halfS + 1, site.s + site.halfS + 10, site.u0, site.u1, [site]));
    if (site.kind === 'river-bridge') {
      assert.equal(site.s, blockBoundary(site.street)); assert.ok(nearStreet(site.street), 'the bridge continues a street that reaches the quay');
      assert.ok(site.u < quayOffset(site.s) && site.side === -1);
    } else {
      assert.equal(site.side, 1);
      assert.ok(site.s - site.halfS >= blockBoundary(site.block) + 8 && site.s + site.halfS <= blockBoundary(site.block + 1) - 8, `${site.kind} spills into the cross street`);
      assert.ok(site.u0 >= BANDS[0].front - 1);
      if (site.kind === 'square') assert.ok(site.halfS >= 38 && site.u1 > BANDS[1].front);
    }
  }
});

test('city discovery meshes survive worker transfer with their sites', () => {
  const sites = cityDiscoveries(-100000, 100000);
  for (const [kind, name] of [['river-bridge', 'city-boxes'], ['square', 'city-fountains'], ['clock-tower', 'city-clock-towers']]) {
    const site = sites.find(site => site.kind === kind), original = new CityChunk(Math.floor(site.s / 128));
    const before = original.group.getObjectByName(name);
    assert.ok(before, `${name} missing from the chunk`);
    const matrices = before.instanceMatrix.array.slice();
    const { data, transfers } = packChunk(original), restored = unpackChunk(structuredClone(data, { transfer: transfers }));
    try {
      const after = restored.group.getObjectByName(name);
      assert.deepEqual(restored.features, original.features);
      assert.equal(after.geometry, before.geometry); assert.equal(after.material, before.material);
      assert.deepEqual(after.instanceMatrix.array, matrices);
      assert.equal(restored.features.discoveries.filter(other => other.index === site.index).length, 1);
      if (kind === 'river-bridge') {
        // The deck spans the water from the quay to the far bank, and no
        // building stands on the landing.
        const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
        let nearest = Infinity, farthest = -Infinity;
        for (let i = 0; i < after.count; i++) {
          after.getMatrixAt(i, matrix); position.setFromMatrixPosition(matrix);
          const u = position.x - original.at(site.s, 0, 0).x;
          if (position.y > 22) { nearest = Math.min(nearest, u); farthest = Math.max(farthest, u); }
        }
        assert.ok(farthest > quayOffset(site.s) - 4 && nearest < -130, `deck spans ${nearest} to ${farthest}`);
      }
    } finally { original.dispose(); restored.dispose(); }
  }
});

test('park paths and lawn edges stay clean on both sides of terrain and chunk boundaries', () => {
  const sites = cityDiscoveries(-150000, 150000).filter(site => site.kind === 'square');
  const selected = [sites.find(site => site.s < 0), sites.find(site => site.s > 0)];
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
  for (const site of selected) {
    const first = Math.floor((site.s - site.halfS - 1) / 128), last = Math.floor((site.s + site.halfS + 1) / 128);
    const chunks = Array.from({ length: last - first + 1 }, (_, i) => new CityChunk(first + i));
    for (const chunk of chunks) { chunk.group.position.z = -chunk.start; chunk.group.updateMatrixWorld(true); }
    const terrain = chunks.map(chunk => chunk.terrain), samples = [];
    for (let s = site.s - site.halfS + 1; s < site.s + site.halfS - 1; s += 3.7) {
      if (Math.abs(s - site.s) < 14) continue;
      for (const du of [-2.8, -2.2, 0, 2.2, 2.8]) samples.push([s, site.u + du, Math.abs(du) < 2.5]);
    }
    for (let u = site.u0 + 1; u < site.u1 - 1; u += 3.3) {
      if (Math.abs(u - site.u) < 14) continue;
      for (const ds of [-2.8, -2.2, 0, 2.2, 2.8]) samples.push([site.s + ds, u, Math.abs(ds) < 2.5]);
      for (const side of [-1, 1]) for (const inset of [-.3, .3]) samples.push([site.s + side * (site.halfS + inset), u, inset > 0]);
    }
    try {
      for (const [s, u, paved] of samples) {
        const p = cityPosition(s, u, 150); ray.set(new THREE.Vector3(p.x, p.y, p.z), down);
        const hit = ray.intersectObjects(terrain)[0];
        assert.ok(hit, `park terrain has a hole at ${s}, ${u}`);
        const colors = hit.object.geometry.attributes.color, ratio = colors.getX(hit.face.a) / colors.getY(hit.face.a);
        assert.equal(ratio > .85, paved, `ragged grass/path boundary at ${s}, ${u}`);
      }
    } finally { chunks.forEach(chunk => chunk.dispose()); }
  }
});

test('courtyard grass follows the rendered terrain without intersecting its facets', () => {
  const chunk = new CityChunk(0), target = { vertices: [], colors: [] };
  drapeCityLawn(chunk, target, [[18, -230], [80, -230], [80, -204], [18, -204]], new THREE.Color('#65745b'));
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(target.vertices, 3));
  const material = new THREE.MeshBasicMaterial(), lawn = new THREE.Mesh(geometry, material);
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
  try {
    for (let s = 22; s < 76; s += 3.7) for (let u = -227; u < -207; u += 2.9) {
      const p = chunk.at(s, u, 150); ray.set(new THREE.Vector3(p.x, p.y, p.z), down);
      const ground = ray.intersectObject(chunk.terrain)[0], grass = ray.intersectObject(lawn)[0];
      assert.ok(ground && grass, 'the lawn covers its interior');
      assert.ok(Math.abs(grass.point.y - ground.point.y - .035) < .001, 'terrain cannot poke through a lawn triangle');
    }
  } finally { chunk.dispose(); geometry.dispose(); material.dispose(); }
});
