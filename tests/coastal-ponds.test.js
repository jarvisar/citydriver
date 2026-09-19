import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CoastalChunk } from '../src/world/environment.js';
import { pondAt, pondRadius, terrainCell, CHUNK_LENGTH } from '../src/world/route.js';

test('pond banks retain hillside-sized faces instead of a ring of tiny subdivisions', () => {
  const areas = [];
  for (let index = -12; index <= 12; index++) {
    const pond = pondAt(246 + index * 704);
    for (let row = Math.floor((pond.center - pond.rs * 2) / 8); row < Math.ceil((pond.center + pond.rs * 2) / 8); row++) {
      for (let column = 17; column < 25; column++) {
        const triangles = terrainCell(row, column);
        assert.equal(triangles.length, 2, 'ponds must use the same face density as the surrounding hills');
        for (const [a, b, c] of triangles) {
          if (pondRadius((a.s + b.s + c.s) / 3, (a.u + b.u + c.u) / 3) > 1.8) continue;
          const area = ((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2;
          assert.ok(area > 4, 'pond terrain must not fold or collapse into slivers');
          areas.push(area);
        }
      }
    }
  }
  areas.sort((a, b) => a - b);
  assert.ok(areas[Math.floor(areas.length / 2)] > 35, 'typical pond-bank facets must remain broad');
});

test('damp pond margins and shoreline sedges stay grounded on the rendered bank', () => {
  let plants = 0, margins = 0;
  for (const index of [-1, 0, 4]) {
    const pond = pondAt(246 + index * 704);
    for (let i = Math.floor((pond.center - pond.rs * 1.5) / CHUNK_LENGTH); i <= Math.floor((pond.center + pond.rs * 1.5) / CHUNK_LENGTH); i++) {
      const chunk = new CoastalChunk(i);
      try {
        const bank = chunk.group.getObjectByName(`pond-damp-bank-${index}`);
        if (bank) {
          const positions = bank.geometry.attributes.position;
          for (let v = 0; v < positions.count; v += 3) {
            const center = new THREE.Vector3();
            for (let j = 0; j < 3; j++) center.add(new THREE.Vector3().fromBufferAttribute(positions, v + j));
            center.multiplyScalar(1 / 3);
            const height = chunk.sampleGround(center.x, center.z);
            assert.notEqual(height, null);
            assert.ok(Math.abs(center.y - height - .025) < .002, 'damp margin must follow the terrain plane');
            assert.ok(center.y >= pond.level && center.y < pond.level + .52, 'damp earth stays beside the waterline');
            margins++;
          }
        }
        const sedges = chunk.group.getObjectByName('pond-shore-sedges');
        if (!sedges) continue;
        assert.equal(sedges.castShadow, false);
        assert.equal(sedges.userData.ambientOcclusion, false);
        const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
        for (let plant = 0; plant < sedges.count; plant++) {
          sedges.getMatrixAt(plant, matrix); position.setFromMatrixPosition(matrix);
          const height = chunk.sampleGround(position.x, position.z);
          assert.notEqual(height, null);
          assert.ok(Math.abs(position.y - height + .08) < .002, 'sedge roots must touch the rendered ground');
          plants++;
        }
      } finally { chunk.dispose(); }
    }
  }
  assert.ok(plants > 20 && margins > 20, 'several ponds must carry grounded shore detail');
});

test('pond water closes against the rendered bank without detached grid edges or streaming gaps', () => {
  for (const index of [-2, -1, 0, 1, 4, 17]) {
    const pond = pondAt(246 + index * 704), chunks = [];
    for (let i = Math.floor((pond.center - pond.rs * 1.5) / CHUNK_LENGTH); i <= Math.floor((pond.center + pond.rs * 1.5) / CHUNK_LENGTH); i++) chunks.push(new CoastalChunk(i));
    try {
      const edges = new Map();
      let area = 0;
      // Adjacent chunks store z relative to different origins in Float32.
      // Weld within a fraction of a millimetre instead of rounding either
      // side of an arbitrary decimal boundary into two disconnected keys.
      const buckets = new Map(); let nextVertex = 0;
      const key = p => {
        const x = Math.floor(p.x * 1000), z = Math.floor(p.z * 1000);
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          for (const other of buckets.get(`${x + dx},${z + dz}`) ?? []) {
            if (Math.hypot(other.x - p.x, other.z - p.z) < .00015) return other.id;
          }
        }
        const bucket = `${x},${z}`;
        if (!buckets.has(bucket)) buckets.set(bucket, []);
        const id = nextVertex++;
        buckets.get(bucket).push({...p, id}); return id;
      };
      for (const chunk of chunks) {
        const mesh = chunk.group.getObjectByName(`inland-pond-${index}`);
        if (!mesh) continue;
        const positions = mesh.geometry.attributes.position;
        for (let i = 0; i < positions.count; i += 3) {
          const triangle = [0, 1, 2].map(j => ({x: positions.getX(i + j), y: positions.getY(i + j), z: positions.getZ(i + j) - chunk.start}));
          const [a, b, c] = triangle;
          const signed = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
          assert.ok(signed > 0, 'pond faces must point up'); area += signed / 2;
          for (let j = 0; j < 3; j++) {
            const a = triangle[j], b = triangle[(j + 1) % 3];
            assert.ok(Math.abs(a.y - pond.level) < .0001);
            const edgeKey = [key(a), key(b)].sort().join('|');
            const edge = edges.get(edgeKey) ?? {a, b, count: 0}; edge.count++; edges.set(edgeKey, edge);
          }
        }
      }
      assert.ok(area > 500, `pond ${index} must retain a substantial water surface`);
      for (const {a, b, count} of edges.values()) {
        assert.ok(count === 1 || count === 2);
        if (count === 2) continue;
        // Every exposed perimeter segment must touch the bank, including
        // either side of a jittered chunk seam. No square-grid water teeth.
        const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
        const height = chunks.map(chunk => chunk.sampleGround(x, z + chunk.start)).find(y => y !== null);
        assert.notEqual(height, undefined);
        assert.ok(Math.abs(height - pond.level) < .002, `open water edge at pond ${index}: ${height} vs ${pond.level}`);
      }
    } finally { for (const chunk of chunks) chunk.dispose(); }
  }
});

