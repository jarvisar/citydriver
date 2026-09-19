import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CoastalChunk, CoastalWorld } from '../src/world/environment.js';
import { coastalDrivingRoute, coastalGuardrail, bridgeAt, terrainCell, terrainVertex, overlookAt, GUARDRAIL_STOP, CHUNK_LENGTH } from '../src/world/route.js';
import { coastalCrags } from '../src/world/coastal-assets.js';

test('crag surfaces are closed and consistently wound, including their broken crowns', () => {
  for (const geometry of coastalCrags) {
    const positions = geometry.attributes.position, edges = new Map();
    const key = i => [positions.getX(i), positions.getY(i), positions.getZ(i)].join(',');
    for (let i = 0; i < positions.count; i += 3) {
      const points = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(positions, i + j));
      assert.ok(points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).length() > .00001);
      for (let j = 0; j < 3; j++) {
        const a = key(i + j), b = key(i + (j + 1) % 3);
        const edge = [a, b].sort().join('|'), count = edges.get(edge) ?? { uses: 0, winding: 0 };
        count.uses++; count.winding += a < b ? 1 : -1; edges.set(edge, count);
      }
    }
    for (const edge of edges.values()) { assert.equal(edge.uses, 2); assert.equal(edge.winding, 0); }
  }
});

test('cliff joints remain connected to coarse beaches and meadows without open seams', () => {
  const key = p => [p.x, p.y, p.z].join(',');
  const edgeKey = (a, b) => [key(a), key(b)].sort().join('|');
  for (const start of [-17, 0, 128]) {
    const edges = new Map(), boundary = new Set();
    for (let row = start; row < start + 4; row++) for (let col = 5; col < 12; col++) {
      for (const tri of terrainCell(row, col)) for (let i = 0; i < 3; i++) {
        const edge = edgeKey(tri[i], tri[(i + 1) % 3]);
        edges.set(edge, (edges.get(edge) ?? 0) + 1);
      }
    }
    for (let col = 5; col < 12; col++) for (const row of [start, start + 4]) {
      const shore = terrainVertex(row, 6), foot = terrainVertex(row, 7);
      const splitBeach = Math.hypot(foot.x - shore.x, foot.z - shore.z) > 14;
      const columns = col === 6 && splitBeach ? [6, 6.5, 7] : col === 9 ? [9, 9.5, 10] : col === 10 ? [10, 10.2, 10.4, 10.6, 10.8, 11] : [col, col + 1];
      for (let i = 0; i < columns.length - 1; i++) {
        boundary.add(edgeKey(terrainVertex(row, columns[i]), terrainVertex(row, columns[i + 1])));
      }
    }
    for (let row = start; row < start + 4; row++) for (const col of [5, 12]) {
      boundary.add(edgeKey(terrainVertex(row, col), terrainVertex(row + 1, col)));
    }
    for (const [edge, count] of edges) assert.equal(count, boundary.has(edge) ? 1 : 2, `open cliff seam at ${start}`);
  }
});

test('sculpted cliff faces do not fold over their neighbors on either side of the origin', () => {
  for (let row = -256; row < 1600; row++) for (let col = 6; col <= 11; col++) {
    for (const [a, b, c] of terrainCell(row, col)) {
      const area = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
      assert.ok(area > .00001, `overlapping cliff faces at row ${row}, column ${col}`);
    }
  }
});

test('reshaping the coastline preserves the original driving limits', () => {
  for (let s = -2000; s < 12000; s += 23) {
    // Headlands changed how the coast looks, never how far the car may go: the
    // open limit still comes from the original curve, not the reshaped one.
    const originalCoast = -28 - 8 * Math.sin(s / 107 + .8) - 4 * Math.sin(s / 43) - 3 * Math.sin(s / 23 + 2);
    const bridge = Math.abs(s - bridgeAt(s).center) < 49;
    const open = Math.max(originalCoast + 6, -15);
    // A guardrail is the one thing that stops the car sooner than the open shoulder.
    const expected = bridge ? [-4.65, 4.65] : [coastalGuardrail(s) ? Math.max(open, GUARDRAIL_STOP) : open, 17];
    assert.deepEqual(coastalDrivingRoute.bounds(s), expected);
  }
});

test('coastal planting heights match raycast terrain, including negative chunks and cliff faces', () => {
  const world = new CoastalWorld(new THREE.Scene());
  world.update(0);
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  try {
    for (const index of [-1, 0, 1]) {
      const chunk = world.chunks.get(index), positions = chunk.terrain.geometry.attributes.position;
      for (let i = 0; i < positions.count; i += 57) {
        const center = new THREE.Vector3();
        for (let j = 0; j < 3; j++) center.add(new THREE.Vector3().fromBufferAttribute(positions, i + j));
        center.multiplyScalar(1 / 3);
        ray.ray.origin.set(center.x, 250, center.z);
        const hit = ray.intersectObject(chunk.terrain, false)[0];
        assert.ok(hit);
        assert.ok(Math.abs(chunk.sampleGround(center.x, center.z) - hit.point.y) < .001);
      }
      assert.equal(chunk.sampleGround(10000, 10000), null);
    }
  } finally { world.dispose(); }
});

test('paved overlooks sit above the rendered terrain through entrances and streaming seams', () => {
  let checked = 0;
  for (let index = -5; index <= 5; index++) {
    const overlook = overlookAt(index * 1936 + 80);
    if (!overlook.enabled) continue;
    for (let chunkIndex = Math.floor((overlook.center - 32) / CHUNK_LENGTH); chunkIndex <= Math.floor((overlook.center + 32) / CHUNK_LENGTH); chunkIndex++) {
      const chunk = new CoastalChunk(chunkIndex);
      const neighbors = [chunk, new CoastalChunk(chunkIndex - 1), new CoastalChunk(chunkIndex + 1)];
      try {
        const mesh = chunk.group.getObjectByName('paved-ocean-overlook');
        assert.ok(mesh, 'each part of a pullout must stream with its terrain');
        const p = mesh.geometry.attributes.position;
        for (let i = 0; i < p.count; i += 3) {
          const center = new THREE.Vector3();
          for (let j = 0; j < 3; j++) center.add(new THREE.Vector3().fromBufferAttribute(p, i + j));
          center.multiplyScalar(1 / 3);
          // The terrain boundary is intentionally jittered; a road triangle
          // near that seam can sit over the neighboring streamed chunk.
          const ground = neighbors.map(c => c.sampleGround(center.x, center.z - chunk.start + c.start)).find(y => y !== null);
          assert.notEqual(ground, undefined);
          assert.ok(center.y > ground + .01, `terrain covers pavement at ${chunkIndex}`);
          assert.ok(center.y - ground < .2, `pavement floats at ${chunkIndex}`);
          checked++;
        }
      } finally { for (const neighbor of neighbors) neighbor.dispose(); }
    }
  }
  assert.ok(checked > 200);
});
