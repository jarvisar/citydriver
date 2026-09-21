import * as THREE from 'three';
import { roadFrame, randomAt } from './route.js';
import { BANDS } from './city-route.js';
import { solidModel } from './colliders.js';
import { cityDiscoveryAssets as assets, cityDiscoveryMaterial as material } from './city-discovery-assets.js';

const transform = new THREE.Object3D();
const TREE_GREENS = ['#3f6a3a', '#476f3d', '#385f35', '#4a7342'];
const CLOCK_SCALE = 1.3;

function clockPlacement(chunk, site) {
  const front = BANDS[0].front + .2;
  return { front, root: chunk.ground(site.s, front + 3.4), yaw: -roadFrame(site.s).angle };
}

export function reserveCityLandmarks(chunk, discoveries) {
  if (!assets.clockTower.boundingBox) assets.clockTower.computeBoundingBox();
  const bounds = assets.clockTower.boundingBox;
  for (const site of discoveries) {
    if (site.kind !== 'clock-tower') continue;
    const { root, yaw } = clockPlacement(chunk, site), c = Math.cos(yaw), s = Math.sin(yaw);
    // Use the asset's scaled, rotated roof footprint, rather than its lot or
    // unscaled wall dimensions. Reserve neighboring chunks' landmarks too.
    chunk.planting.reserve([[bounds.min.x, bounds.min.z], [bounds.max.x, bounds.min.z], [bounds.max.x, bounds.max.z], [bounds.min.x, bounds.max.z]]
      .map(([x, z]) => ({ x: root.x + CLOCK_SCALE * (x * c + z * s), z: root.z + CLOCK_SCALE * (z * c - x * s) })));
  }
}

export function buildCityDiscoveries(chunk, discoveries) {
  const batches = new Map();
  function add(name, geometry, p, rotation = [0, 0, 0], scale = [1, 1, 1]) {
    if (!batches.has(name)) batches.set(name, { geometry, items: [] });
    batches.get(name).items.push({ p, rotation, scale });
  }
  const { boxes } = chunk.scenery;
  for (const site of discoveries) {
    const { s, u, kind } = site, yaw = -roadFrame(s).angle;
    if (kind === 'river-bridge') {
      if (!chunk.inChunk(s)) continue;
      // The street network already builds this crossing, together with every
      // other road reaching the river. Retain the discovery without a second,
      // overlapping deck or a different height at the landing.
      chunk.features.discoveries.push({ ...site });
      continue;
    }
    if (kind === 'square') {
      // Lawn where two rows of buildings would stand, a fountain in the
      // middle, trees round the edges, benches and lamps on the paths.
      if (chunk.inChunk(s)) {
        const p = chunk.ground(s, u);
        add('city-fountains', assets.fountain, [p.x, p.y, p.z], [0, yaw, 0]);
        solidModel(chunk, assets.fountain, [p.x, p.y, p.z], yaw, 1, true);
        for (const [ds, du] of [[-7.5, 0], [7.5, 0], [0, -7.5], [0, 7.5]]) {
          const angle = Math.atan2(ds, du);
          chunk.furniture('bench', s + ds, u + du, yaw + angle + Math.PI, {});
        }
        for (const [ds, du] of [[-9, -9], [9, -9], [-9, 9], [9, 9]]) chunk.furniture('lamp', s + ds, u + du, yaw + Math.atan2(-ds, -du) + Math.PI / 2, {});
      }
      const treeRandom = seeded(site.index + 3401);
      for (let k = 0; k < 14; k++) {
        const t = s + (treeRandom() - .5) * (site.halfS * 2 - 10), v = u + (treeRandom() - .5) * (site.u1 - site.u0 - 8);
        if (!chunk.inChunk(t) || Math.hypot(t - s, v - u) < 15 || Math.abs(t - s) < 4 || Math.abs(v - u) < 4) continue;
        chunk.tree(t, v, 6 + treeRandom() * 4, TREE_GREENS[k % 4], treeRandom() * 6.28);
      }
      if (chunk.inChunk(s)) chunk.features.discoveries.push({ ...site });
      continue;
    }
    // The church stands on a stone plinth on the building line, its tower
    // on the corner by the side street.
    if (!chunk.inChunk(s)) continue;
    const { front, root } = clockPlacement(chunk, site), samples = [[s - 4, front], [s + 4, front], [s - 4, front + 21], [s + 4, front + 21]].map(([a, b]) => chunk.ground(a, b).y);
    const base = Math.max(...samples, root.y) + .12;
    const plinth = chunk.at(s, front + 11.5, base - .3);
    boxes.push({ p: [plinth.x, plinth.y, plinth.z], scale: [26, .6, 15], r: [0, yaw, 0], color: '#8e8a83' });
    // Drawn a little over life size, as the plains do with their barns, so it reads from the road.
    add('city-clock-towers', assets.clockTower, [root.x, base, root.z], [0, yaw, 0], [CLOCK_SCALE, CLOCK_SCALE, CLOCK_SCALE]);
    solidModel(chunk, assets.clockTower, [root.x, base, root.z], yaw, CLOCK_SCALE);
    // A pocket garden in the unused corner beside the church. Two small
    // trees and a bench fill the setback while leaving the front door and
    // the pavement clear. All pieces reuse existing scenery/instance batches.
    for (const du of [6.5, 19]) {
      const t = s - 10.7, v = front + du, h = 4.2;
      const y = Math.max(...[[-1.2, -2.3], [1.2, -2.3], [1.2, 2.3], [-1.2, 2.3]].map(([ds, dv]) => chunk.ground(t + ds, v + dv).y));
      chunk.prism(chunk.scenery.details, t - 1.2, t + 1.2, v - 2.3, v + 2.3, y - .15, y + .32, new THREE.Color('#aaa99e'));
      chunk.prism(chunk.scenery.details, t - .95, t + .95, v - 2.05, v + 2.05, y + .32, y + .38, new THREE.Color('#607451'));
      chunk.tree(t, v, h, TREE_GREENS[1], randomAt(site.index, du + 3411) * 6.28, y + .38);
    }
    chunk.furniture('bench', s - 10.7, front + 12.8, yaw - Math.PI / 2);
    chunk.furniture('bin', s - 10.7, front + 15, yaw);
    chunk.features.discoveries.push({ ...site, ground: base });
  }
  for (const [name, { geometry, items }] of batches) {
    const mesh = new THREE.InstancedMesh(geometry, material, items.length); mesh.name = name;
    items.forEach((item, i) => {
      transform.position.set(...item.p); transform.rotation.set(...item.rotation); transform.scale.set(...item.scale);
      transform.updateMatrix(); mesh.setMatrixAt(i, transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    chunk.group.add(mesh);
  }
}

function seeded(seed) { let i = 0; return () => randomAt(seed, i++); }
