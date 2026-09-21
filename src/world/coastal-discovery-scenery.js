import * as THREE from 'three';
import { positionAt, groundHeight, roadFrame, CHUNK_LENGTH } from './route.js';
import { discoveryAssets as assets, discoveryMaterial, timberMaterial, footingMaterial, pathMaterial, boatMaterial, whaleMaterial } from './coastal-discovery-assets.js';
import { createRockWashMaterial } from './water.js';
import { registerChunkResources } from './chunk-resources.js';
import { solidModel } from './colliders.js';

const washMaterial = createRockWashMaterial();
registerChunkResources('coastal-discovery-wash', {washMaterial});
const transform = new THREE.Object3D();

export function buildCoastalDiscoveries(chunk, sites) {
  chunk.features.discoveries = [];
  const batches = new Map(), paths = [], wash = [], washCoords = [];
  function add(name, geometry, material, p, scale = [1, 1, 1], rotation = [0, 0, 0]) {
    if (!batches.has(name)) batches.set(name, {geometry, material, items: []});
    batches.get(name).items.push({p, scale, rotation});
  }
  function point(s, u, y) {
    const p = positionAt(s, u, y);
    if (y === undefined) p.y = chunk.sampleGround(p.x, p.z + chunk.start) ?? groundHeight(s, u);
    return [p.x, p.y, p.z + chunk.start];
  }
  function base(s, u, halfWidth, halfLength, round = false) {
    const samples = [-halfLength, 0, halfLength].flatMap(ds => [-halfWidth, 0, halfWidth].map(du => point(s + ds, u + du)[1]));
    const low = Math.min(...samples) - .65, high = Math.max(...samples) + .15;
    const p = point(s, u, (low + high) / 2);
    add(round ? 'lighthouse-footing' : 'cottage-footing', round ? assets.foundation : assets.box, footingMaterial, p,
      round ? [halfWidth, high - low, halfLength] : [halfWidth * 2, high - low, halfLength * 2], [0, -roadFrame(s).angle, 0]);
    return high;
  }
  function path(s, firstU, lastU) {
    const count = Math.ceil(Math.abs(lastU - firstU) / 1.5);
    for (let i = 0; i < count; i++) {
      const u = firstU + (lastU - firstU) * i / count, v = firstU + (lastU - firstU) * (i + 1) / count;
      const corners = [point(s - 1, u), point(s + 1, u), point(s - 1, v), point(s + 1, v)];
      for (const j of [0, 1, 2, 1, 3, 2]) { const p = corners[j]; paths.push(p[0], p[1] + .09, p[2]); }
    }
  }
  function foam(p, rx, rz, phase, thin = false) {
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2, b = (i + 1) / 24 * Math.PI * 2;
      const at = (angle, outer) => [p[0] + Math.cos(angle) * (rx + (outer ? 1.3 : 0)), .14,
        p[2] + Math.sin(angle) * (rz + (outer ? 1.1 : 0))];
      for (const [angle, edge] of [[a, 0], [b, 0], [a, 1], [b, 0], [b, 1], [a, 1]]) {
        wash.push(...at(angle, edge)); washCoords.push(thin ? .35 + edge * .65 : edge, phase);
      }
    }
  }

  for (const site of sites) {
    if (site.s < chunk.start || site.s >= chunk.start + CHUNK_LENGTH) continue;
    const {s, u, kind, index} = site, angle = -roadFrame(s).angle;
    const record = {...site};
    if (kind === 'lighthouse') {
      const y = base(s, u, 3.5, 3.5, true);
      add('coastal-lighthouse', assets.lighthouse, discoveryMaterial, point(s, u, y), undefined, [0, angle, 0]);
      solidModel(chunk, assets.lighthouse, point(s, u, y), angle, 1, true);
      const cottageS = s - 8.5, cottageU = u + 8;
      const cottageY = base(cottageS, cottageU, 2.9, 3.8);
      add('lighthouse-keeper-cottage', assets.cottage, discoveryMaterial, point(cottageS, cottageU, cottageY), undefined, [0, angle, 0]);
      solidModel(chunk, assets.cottage, point(cottageS, cottageU, cottageY), angle);
      path(s, -6.1, u + 3.2);
      record.ground = y;
    } else if (kind === 'dock') {
      const deck = Math.max(2.05, point(s, u + 2)[1] + .25);
      for (let i = 0; i <= 30; i++) {
        const v = u + 3 - i * .7;
        add('cove-dock-planks', assets.box, timberMaterial, point(s, v, deck), [.64, .2, 3.8], [0, angle, 0]);
      }
      for (const ds of [-1.55, 1.55]) {
        for (let i = 0; i < 5; i++) {
          const v = u + 2 - i * 5;
          add('cove-dock-pilings', assets.box, timberMaterial, point(s + ds, v, .25), [.28, deck * 2 + .8, .28], [0, angle, 0]);
        }
      }
      // A short crosshead and one small rowboat keep this a landing, not a marina.
      for (let i = 0; i < 5; i++) add('cove-dock-planks', assets.box, timberMaterial,
        point(s, u - 18.5 - i * .65, deck), [.6, .2, 6.6], [0, angle, 0]);
      add('moored-rowboat', assets.boat, boatMaterial, point(s + 4.9, u - 15, .1), undefined, [0, angle + .12, 0]);
      record.ground = deck;
    } else if (kind === 'whale') {
      const p = point(s, u, -.35);
      add('offshore-whale', assets.whale, whaleMaterial, p, undefined, [0, -.22, 0]);
      foam(p, 1.8, 6, index, true);
      record.count = 1;
    }
    chunk.features.discoveries.push(record);
  }
  for (const [name, {geometry, material, items}] of batches) {
    const mesh = new THREE.InstancedMesh(geometry, material, items.length); mesh.name = name;
    for (let i = 0; i < items.length; i++) {
      const item = items[i]; transform.position.set(...item.p); transform.scale.set(...item.scale);
      transform.rotation.set(...item.rotation); transform.updateMatrix(); mesh.setMatrixAt(i, transform.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true; mesh.castShadow = name !== 'offshore-whale' && name !== 'moored-rowboat'; mesh.receiveShadow = true;
    mesh.computeBoundingSphere(); mesh.boundingSphere.radius += name === 'offshore-whale' ? 4 : .3;
    chunk.group.add(mesh);
  }
  if (paths.length) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(paths, 3));
    g.computeVertexNormals(); g.computeBoundingSphere(); chunk.addMesh(g, pathMaterial).name = 'lighthouse-paved-walk';
  }
  if (wash.length) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(wash, 3));
    g.setAttribute('rockWash', new THREE.Float32BufferAttribute(washCoords, 2));
    g.computeVertexNormals(); g.computeBoundingSphere(); g.boundingSphere.radius += .5;
    chunk.addMesh(g, washMaterial).name = 'marine-wildlife-wash';
  }
}
