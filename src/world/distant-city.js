import * as THREE from 'three';
import { CITY_BLOCK } from './city-grid.js';
import { cityItemMatrix } from './city-layout-render.js';
import { attachRiverFlow } from './river-water.js';

// Local batches let Three.js cull the skyline behind the camera. Updating one
// edge of the city only replaces the affected tiles, not every distant buffer.
export const DISTANT_TILE_SIZE = 2;
const matrix = new THREE.Matrix4(), color = new THREE.Color();

export function packDistantChunk(chunk) {
  for (const batch of chunk.batches.values()) {
    if (batch.matrices) continue;
    const count = batch.items.length;
    batch.matrices = new Float32Array(count * 16);
    batch.colors = new Float32Array(count * 3);
    if (batch.items[0]?.riverAddress) batch.riverAddress = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      const item = batch.items[i];
      cityItemMatrix(item, chunk.east, chunk.start, matrix).toArray(batch.matrices, i * 16);
      color.set(item.color).toArray(batch.colors, i * 3);
      if (batch.riverAddress) batch.riverAddress.set(item.riverAddress, i * 6);
    }
    // Construction objects and layout frames are no longer needed. Keep the
    // compact, block-local transforms for the next update to this tile.
    delete batch.items;
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
      this.group.add(group); this.tiles.set(key, { group, chunks: new Map() });
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
      for (const mesh of tile.group.children) mesh.dispose();
      tile.group.clear();
      if (!tile.chunks.size) { tile.group.removeFromParent(); this.tiles.delete(key); continue; }
      const batches = new Map();
      for (const chunk of tile.chunks.values()) for (const [key, batch] of chunk.batches) {
        if (!batches.has(key)) batches.set(key, { geometry: batch.geometry, material: batch.material, structure: batch.structure, count: 0, parts: [] });
        const merged = batches.get(key);
        merged.count += batch.colors.length / 3; merged.parts.push({ chunk, batch });
      }
      for (const [key, batch] of batches) {
        if (!batch.count) continue;
        const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.count);
        mesh.name = `citydriver-${key}`;
        mesh.renderOrder = batch.structure ? -2 : 0;
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(batch.count * 3), 3);
        const riverAddress = key === 'water' ? new Float32Array(batch.count * 6) : null;
        let offset = 0;
        for (const { chunk, batch: part } of batch.parts) {
          mesh.instanceMatrix.array.set(part.matrices, offset * 16);
          mesh.instanceColor.array.set(part.colors, offset * 3);
          if (riverAddress) riverAddress.set(part.riverAddress, offset * 6);
          const count = part.colors.length / 3;
          for (let i = offset; i < offset + count; i++) {
            mesh.instanceMatrix.array[i * 16 + 12] += chunk.east - tile.group.position.x;
            mesh.instanceMatrix.array[i * 16 + 14] += -chunk.start - tile.group.position.z;
          }
          offset += count;
        }
        mesh.userData.ambientOcclusion = false;
        if (riverAddress) attachRiverFlow(mesh, riverAddress);
        // Rebuilt children of an unchanged static tile must inherit its world
        // transform on their first draw, including a quality downgrade at rest.
        mesh.updateMatrix();
        mesh.matrixAutoUpdate = false;
        mesh.computeBoundingSphere();
        if (key === 'water') mesh.boundingSphere.radius += .12;
        tile.group.add(mesh);
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
