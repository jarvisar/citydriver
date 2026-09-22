import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { addSurfacePolygon, rectanglePolygon } from '../src/world/city-surfaces.js';
import { riverWaterGeometry, createRiverWaterMaterial, attachRiverFlow } from '../src/world/river-water.js';
import { DistantCity } from '../src/world/distant-city.js';

test('river flow addresses survive distant packing and release their owned buffers', () => {
  const material = createRiverWaterMaterial(), group = new THREE.Group(), distant = new DistantCity(group);
  const chunks = [], expected = [];
  let near, released = 0;
  try {
    for (const [ix, iz] of [[3, 2], [3, 3], [2, 5], [-4, -3]]) {
      const c = { ix, iz, east: ix * 112, start: iz * 112, index: `${ix},${iz}`, batches: new Map(), materials: { water: material } };
      addSurfacePolygon(c, rectanglePolygon(56, 56, 56, 112), 18, .24, '#ffffff', 'water');
      const items = c.batches.get('water').items;
      const addresses = new Float32Array(items.flatMap(item => item.riverAddress));
      expected.push(...Array.from({ length: items.length }, (_, i) => Array.from(addresses.slice(i * 6, i * 6 + 6)).join(',')));
      for (const item of items) for (let i = 0; i < 6; i += 2) {
        assert.ok(item.riverAddress[i] >= c.east + 28 && item.riverAddress[i] <= c.east + 84);
        assert.ok(item.riverAddress[i + 1] >= c.start && item.riverAddress[i + 1] <= c.start + 112);
      }
      if (!near) {
        near = new THREE.InstancedMesh(riverWaterGeometry, material, items.length);
        attachRiverFlow(near, addresses);
        near.geometry.addEventListener('dispose', () => released++);
        assert.notEqual(near.geometry, riverWaterGeometry);
        assert.deepEqual(near.geometry.getAttribute('riverAddress0').data.array, addresses);
      }
      distant.add(c); chunks.push(c);
      assert.equal(c.batches.get('water').items, undefined, 'flow survives releasing construction objects');
    }
    distant.rebuild();
    const actual = [];
    for (const tile of group.children) for (const mesh of tile.children) {
      mesh.geometry.addEventListener('dispose', () => released++);
      const a = mesh.geometry.getAttribute('riverAddress0'), b = mesh.geometry.getAttribute('riverAddress1'), c = mesh.geometry.getAttribute('riverAddress2');
      assert.equal(a.count, mesh.count);
      for (let i = 0; i < mesh.count; i++) actual.push([a.getX(i), a.getY(i), b.getX(i), b.getY(i), c.getX(i), c.getY(i)].join(','));
    }
    assert.deepEqual(actual.sort(), expected.sort(), 'merged tiles preserve every triangle address');
    const ownedCount = group.children.reduce((n, tile) => n + tile.children.length, 0) + 1;
    for (const c of chunks) distant.delete(c);
    distant.rebuild(); near.dispose(); near = null;
    assert.equal(released, ownedCount, 'streaming out water releases batch-owned geometry');
    assert.equal(group.children.length, 0);
    assert.ok(riverWaterGeometry.getAttribute('position').count > 0, 'shared template remains available');
  } finally { near?.dispose(); distant.dispose(); material.dispose(); }
});
