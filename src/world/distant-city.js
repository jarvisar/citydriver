import * as THREE from 'three';
import { CITY_BLOCK } from './city-grid.js';
import { cityItemMatrix } from './city-layout-render.js';
import { attachRiverFlow } from './river-water.js';

// Local batches let Three.js cull the skyline behind the camera. Updating one
// edge of the city only replaces the affected tiles, not every distant buffer.
export const DISTANT_TILE_SIZE = 2;
const matrix = new THREE.Matrix4(), color = new THREE.Color();
const sphere = new THREE.Sphere(), offsetVector = new THREE.Vector3();

function streamingAttribute(attribute) {
  // Three clears ranges after partial uploads, but not the first bufferData.
  return attribute.setUsage(THREE.DynamicDrawUsage).onUpload(function () { this.clearUpdateRanges(); });
}

function changedRange(attribute, start, count) {
  // Several updates can land before a draw; upload their union.
  let end = start + count;
  for (const range of attribute.updateRanges) {
    start = Math.min(start, range.start); end = Math.max(end, range.start + range.count);
  }
  attribute.clearUpdateRanges(); attribute.addUpdateRange(start, end - start);
  attribute.needsUpdate = true;
}

export function packDistantChunk(chunk) {
  for (const _ of packDistantSteps(chunk)) { /* synchronous fallback */ }
}

export function* packDistantSteps(chunk) {
  for (const batch of chunk.batches.values()) {
    if (batch.matrices) continue;
    const count = batch.items.length;
    batch.matrices = new Float32Array(count * 16);
    batch.colors = new Float32Array(count * 3);
    if (!batch.geometry.boundingSphere) batch.geometry.computeBoundingSphere();
    batch.boundingSphere = new THREE.Sphere().makeEmpty();
    if (batch.items[0]?.riverAddress) batch.riverAddress = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      const item = batch.items[i];
      cityItemMatrix(item, chunk.east, chunk.start, matrix).toArray(batch.matrices, i * 16);
      color.set(item.color).toArray(batch.colors, i * 3);
      if (batch.riverAddress) batch.riverAddress.set(item.riverAddress, i * 6);
      // Bound the packed transforms once during background construction.
      matrix.fromArray(batch.matrices, i * 16);
      batch.boundingSphere.union(sphere.copy(batch.geometry.boundingSphere).applyMatrix4(matrix));
    }
    // Drop construction data; later tile updates need only the packed arrays.
    delete batch.items;
    yield;
  }
}

export class DistantCity {
  constructor(group) { this.group = group; this.tiles = new Map(); this.dirty = new Set(); }
  key(chunk) { return `${Math.floor(chunk.ix / DISTANT_TILE_SIZE)},${Math.floor(chunk.iz / DISTANT_TILE_SIZE)}`; }
  add(chunk) {
    packDistantChunk(chunk);
    const key = this.key(chunk);
    if (!this.tiles.has(key)) {
      const group = new THREE.Group(); group.name = `citydriver-distant-tile-${key}`;
      group.position.set(Math.floor(chunk.ix / DISTANT_TILE_SIZE) * DISTANT_TILE_SIZE * CITY_BLOCK, 0,
        -Math.floor(chunk.iz / DISTANT_TILE_SIZE) * DISTANT_TILE_SIZE * CITY_BLOCK);
      group.updateMatrix(); group.matrixAutoUpdate = false;
      this.group.add(group); this.tiles.set(key, { group, chunks: new Map(), batches: new Map() });
    }
    this.tiles.get(key).chunks.set(chunk.index, chunk); this.dirty.add(key);
  }
  delete(chunk) {
    const key = this.key(chunk);
    this.tiles.get(key)?.chunks.delete(chunk.index); this.dirty.add(key);
  }
  rebuild() {
    for (const key of this.dirty) {
      const tile = this.tiles.get(key);
      if (!tile) continue;
      if (!tile.chunks.size) {
        for (const mesh of tile.group.children) mesh.dispose();
        tile.group.removeFromParent(); this.tiles.delete(key); continue;
      }
      const batches = new Map();
      for (const chunk of tile.chunks.values()) for (const [key, batch] of chunk.batches) {
        if (!batches.has(key)) batches.set(key, { geometry: batch.geometry, material: batch.material, structure: batch.structure, count: 0, parts: [] });
        const merged = batches.get(key);
        merged.count += batch.colors.length / 3; merged.parts.push({ chunk, batch });
      }
      for (const [key, batch] of batches) {
        if (!batch.count) continue;
        let entry = tile.batches.get(key);
        if (!entry || entry.mesh.instanceMatrix.count < batch.count) {
          const capacity = Math.max(batch.count, Math.ceil((entry?.mesh.instanceMatrix.count ?? 0) * 1.5));
          if (entry) { entry.mesh.removeFromParent(); entry.mesh.dispose(); }
          const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, capacity);
          mesh.name = `citydriver-${key}`;
          mesh.renderOrder = batch.structure ? -2 : 0;
          streamingAttribute(mesh.instanceMatrix);
          mesh.instanceColor = streamingAttribute(new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
          mesh.userData.ambientOcclusion = false;
          if (key === 'water') {
            attachRiverFlow(mesh, new Float32Array(capacity * 6));
            streamingAttribute(mesh.geometry.getAttribute('riverAddress0').data);
          }
          mesh.updateMatrix(); mesh.matrixAutoUpdate = false;
          tile.group.add(mesh);
          entry = { mesh, parts: new Map() }; tile.batches.set(key, entry);
        }
        const mesh = entry.mesh, parts = new Map();
        const riverBuffer = key === 'water' ? mesh.geometry.getAttribute('riverAddress0').data : null;
        mesh.count = batch.count;
        mesh.boundingSphere ??= new THREE.Sphere(); mesh.boundingSphere.makeEmpty();
        let offset = 0;
        for (const { chunk, batch: part } of batch.parts) {
          const count = part.colors.length / 3;
          offsetVector.set(chunk.east - tile.group.position.x, 0, -chunk.start - tile.group.position.z);
          if (count && entry.parts.get(chunk) !== offset) {
            mesh.instanceMatrix.array.set(part.matrices, offset * 16);
            mesh.instanceColor.array.set(part.colors, offset * 3);
            for (let i = offset; i < offset + count; i++) {
              mesh.instanceMatrix.array[i * 16 + 12] += offsetVector.x;
              mesh.instanceMatrix.array[i * 16 + 14] += offsetVector.z;
            }
            changedRange(mesh.instanceMatrix, offset * 16, count * 16);
            changedRange(mesh.instanceColor, offset * 3, count * 3);
            if (riverBuffer) {
              riverBuffer.array.set(part.riverAddress, offset * 6);
              changedRange(riverBuffer, offset * 6, count * 6);
            }
          }
          if (count) mesh.boundingSphere.union(sphere.copy(part.boundingSphere).translate(offsetVector));
          parts.set(chunk, offset);
          offset += count;
        }
        entry.parts = parts;
        // Include rounding from translating Float32 matrices, and river waves.
        mesh.boundingSphere.radius += key === 'water' ? .121 : .001;
      }
      for (const [key, entry] of tile.batches) if (!batches.get(key)?.count) {
        entry.mesh.removeFromParent(); entry.mesh.dispose(); tile.batches.delete(key);
      }
    }
    this.dirty.clear();
  }
  dispose() {
    for (const tile of this.tiles.values()) {
      for (const mesh of tile.group.children) mesh.dispose();
      tile.group.removeFromParent();
    }
    this.tiles.clear(); this.dirty.clear();
  }
}
