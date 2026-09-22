import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DistantCity } from '../src/world/distant-city.js';
import { addSurfacePolygon, rectanglePolygon } from '../src/world/city-surfaces.js';
import { createRiverWaterMaterial } from '../src/world/river-water.js';
import { fitFogDistance } from '../src/rendering.js';

test('skyline buffers retain unchanged ranges and preserve pending uploads through shrink, growth and rebasing', () => {
  const group = new THREE.Group(), city = new DistantCity(group), material = createRiverWaterMaterial();
  const make = (ix, iz, width) => {
    const chunk = { ix, iz, index: `${ix},${iz}`, east: ix * 112, start: iz * 112, materials: { water: material }, batches: new Map() };
    addSurfacePolygon(chunk, rectanglePolygon(56, 56, width, 80), 18, .24, '#ffffff', 'water');
    return chunk;
  };
  const a = make(-2, -2, 56), b = make(-2, -1, 56), c = make(-1, -2, 30), d = make(-1, -1, 80);
  const mesh = () => group.children[0].children[0];
  const assertData = () => {
    group.position.z = 2048; group.updateMatrixWorld(true);
    const tile = [...city.tiles.values()][0], m = mesh(), river = m.geometry.getAttribute('riverAddress0').data.array;
    const matrix = new THREE.Matrix4(), vertex = new THREE.Vector3();
    let offset = 0;
    for (const chunk of tile.chunks.values()) {
      const part = chunk.batches.get('water'), count = part.colors.length / 3;
      assert.deepEqual(river.slice(offset * 6, (offset + count) * 6), part.riverAddress);
      assert.deepEqual(m.instanceColor.array.slice(offset * 3, (offset + count) * 3), part.colors);
      for (let i = 0; i < count; i++) {
        m.getMatrixAt(offset + i, matrix);
        for (let j = 0; j < 16; j++) {
          const shift = j === 12 ? chunk.east - tile.group.position.x : j === 14 ? -chunk.start - tile.group.position.z : 0;
          assert.ok(Math.abs(matrix.elements[j] - part.matrices[i * 16 + j] - shift) < .0001);
        }
        for (let v = 0; v < m.geometry.attributes.position.count; v++) {
          vertex.fromBufferAttribute(m.geometry.attributes.position, v).applyMatrix4(matrix);
          assert.ok(m.boundingSphere.containsPoint(vertex), 'cached bounds enclose rendered river geometry');
          vertex.y += .12; assert.ok(m.boundingSphere.containsPoint(vertex), 'wave crest stays inside culling bounds');
        }
      }
      offset += count;
    }
    assert.equal(m.count, offset, 'capacity never becomes the visible instance count');
  };
  try {
    city.add(a); city.add(b); city.rebuild(); assertData();
    const first = mesh(), buffer = first.instanceMatrix, river = first.geometry.getAttribute('riverAddress0').data;
    buffer.onUploadCallback(); first.instanceColor.onUploadCallback(); river.onUploadCallback();
    assert.equal(buffer.updateRanges.length + river.updateRanges.length, 0, 'first upload clears its ranges too');
    const version = buffer.version;
    city.delete(b); city.rebuild(); assertData();
    assert.equal(mesh(), first);
    assert.equal(buffer.version, version, 'removing the tail needs no transform upload');
    city.add(c); city.rebuild(); assertData();
    assert.equal(mesh(), first, 'the replacement fits existing capacity');
    const countA = a.batches.get('water').colors.length / 3;
    assert.equal(buffer.updateRanges[0].start, countA * 16, 'unchanged prefix is not uploaded');
    city.delete(a); city.rebuild(); assertData();
    assert.equal(mesh(), first);
    assert.equal(buffer.updateRanges.length, 1);
    assert.equal(buffer.updateRanges[0].start, 0, 'a second update merges with the pending upload');
    assert.ok(buffer.updateRanges[0].count > mesh().count * 16, 'the prior unflushed range survives');
    let released = 0;
    first.addEventListener('dispose', () => released++);
    city.add(a); city.add(b); city.add(d); city.rebuild(); assertData();
    assert.notEqual(mesh(), first, 'growth replaces a buffer that cannot hold the new data');
    assert.equal(released, 1);
    const last = mesh(); last.addEventListener('dispose', () => released++);
    city.dispose(); assert.equal(released, 2); assert.equal(group.children.length, 0);
  } finally { city.dispose(); material.dispose(); }
});

test('fog clipping follows the fully hidden depth and preserves overhead cameras', () => {
  const camera = new THREE.PerspectiveCamera(60, 1.5, .1, 1200), fog = new THREE.Fog('#fff', 80, 205.2);
  fitFogDistance(camera, fog); assert.equal(camera.far, 207);
  const projection = camera.projectionMatrix.clone();
  fitFogDistance(camera, fog); assert.deepEqual(camera.projectionMatrix, projection);
  fog.far = 310; fitFogDistance(camera, fog); assert.equal(camera.far, 311);
  assert.notDeepEqual(camera.projectionMatrix, projection);
  const overhead = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 1200);
  fitFogDistance(overhead, fog); assert.equal(overhead.far, 1200);
  fitFogDistance(camera, null); assert.equal(camera.far, 311);
});
