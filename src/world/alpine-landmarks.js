import * as THREE from 'three';
import { CHUNK_LENGTH, randomAt, lerp } from './route.js';
import { snowPosition, snowGroundHeight, summitForCell, alpineLake, LAKE_LEVEL } from './snow-route.js';
import { CABIN_SPACING, alpineCabin } from './alpine-cabins.js';
import { terrainSampler } from './snow-discovery-scenery.js';
import { SnowDiscoveryParts, snowDiscoveryMaterial } from './snow-discovery-assets.js';

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const steel = '#8b9caf', wood = '#8b725c', snow = '#d3dfeb';

export function alpineRelay(index) {
  if ((index % 3 + 3) % 3 !== 0) return null;
  const summit = summitForCell(index), start = Math.floor(summit.s / CHUNK_LENGTH) * CHUNK_LENGTH;
  // Keep the entire compound on its owning terrain mesh, including when the
  // summit happens to fall right on a streaming boundary.
  return { ...summit, s: Math.max(start + 14, Math.min(start + CHUNK_LENGTH - 14, summit.s)) };
}

export function nearAlpineRelay(s, u, radius = 0) {
  const cell = Math.floor((s - 76) / 280);
  for (let i = cell - 1; i <= cell + 1; i++) {
    const site = alpineRelay(i);
    if (site && Math.abs(s - site.s) < 12 + radius && Math.abs(u - site.u - 4) < 13 + radius) return true;
  }
  return false;
}

// Most cabins keep a quiet, undeveloped shore. A few have an old fishing
// landing, in the same seeded world positions on either direction of travel.
export function alpineLanding(index) {
  if ((index % 3 + 3) % 3 !== 0 || randomAt(index, 954) < .18) return null;
  const cabin = alpineCabin(index);
  const inChunk = ((cabin.s % CHUNK_LENGTH) + CHUNK_LENGTH) % CHUNK_LENGTH;
  if (inChunk < 14 || inChunk > CHUNK_LENGTH - 14) return null;
  const u = cabin.u - 2.5, shore = alpineLake(cabin.s).near;
  if ([-3, 3].some(ds => Math.abs(alpineLake(cabin.s + ds).near - shore) > 1.7)) return null;
  return { kind: 'fishing-landing', index, s: cabin.s, u, length: u - shore + 17, cabin };
}

function frame(chunk, s, u) {
  const p = snowPosition(s, u, 0), q = snowPosition(s, u + 1, 0);
  const across = v(q.x - p.x, 0, q.z - p.z).normalize();
  const along = v(-across.z, 0, across.x), origin = v(p.x, 0, p.z + chunk.start);
  const ground = terrainSampler(chunk, origin.x, origin.z, 38);
  const at = (x, y, z) => origin.clone().addScaledVector(across, x).addScaledVector(along, z).setY(y);
  const yaw = Math.atan2(-across.z, across.x);
  return { at, ground, yaw };
}

function buildRelay(chunk, site) {
  const parts = new SnowDiscoveryParts(), { at, ground, yaw } = frame(chunk, site.s, site.u);
  const rotation = [0, yaw, 0], footings = [];
  const heightAt = (x, z) => { const p = at(x, 0, z); return ground(p.x, p.z) ?? snowGroundHeight(site.s - z, site.u + x); };
  const hutTop = Math.max(...[-2.8, 2.8].flatMap(x => [-2.7, 2.7].map(z => heightAt(x, z)))) + .35;
  const box = (x, y, z, size, color, glow = 0) => parts.box(at(x, y, z), size, color, rotation, glow);
  // A snow-loaded stone service hut anchors the delicate steel silhouette.
  const foundation = Math.min(...[-2.9, 2.9].flatMap(x => [-2.8, 2.8].map(z => heightAt(x, z)))) - .6;
  box(0, (foundation + hutTop) / 2, 0, [5.8, hutTop - foundation, 5.6], '#526071');
  box(0, hutTop + 1.9, 0, [5.4, 3.8, 5.2], '#687486');
  box(0, hutTop + 3.95, 0, [6.1, .3, 5.9], '#3b4859');
  box(.12, hutTop + 4.2, 0, [6.15, .24, 5.85], snow);
  box(-2.73, hutTop + 1.2, .75, [.08, 2.4, 1.25], '#354350');
  box(-2.79, hutTop + 2.25, -.95, [.045, 1.15, 1.15], '#ffd097', 2.3);
  box(-2.82, hutTop + 2.25, -.95, [.05, 1.2, .09], '#4d5865');
  box(0, hutTop + 2.15, 2.63, [1.3, 1.2, .05], '#ffd097', 2.1);
  box(0, hutTop + 2.15, 2.67, [.1, 1.25, .05], '#4d5865');
  box(-2.98, hutTop + 3.15, .75, [.45, .18, .6], '#ffd59c', 2.3);
  box(-3.2, hutTop + .12, .75, [.9, .24, 1.9], snow);

  const towerX = 8.2, base = Math.max(...[-1.65, 1.65].flatMap(x => [-1.65, 1.65].map(z => heightAt(towerX + x, z)))) + .5;
  const height = 23 + randomAt(site.index, 955) * 3;
  const corners = h => {
    const spread = lerp(1.55, .55, h / height);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => at(towerX + x * spread, base + h, z * spread));
  };
  const feet = corners(0), top = corners(height);
  feet.forEach((foot, i) => {
    const samples = [-.65, .65].flatMap(dx => [-.65, .65].map(dz => ground(foot.x + dx, foot.z + dz) ?? base - .5));
    const bottom = Math.min(...samples) - .65;
    parts.box([foot.x, (base + bottom) / 2, foot.z], [1.3, base - bottom, 1.3], '#586575');
    parts.beam(foot.clone().setY(base - .15), top[i], .14, steel, 4, .09);
    footings.push({ x: foot.x, z: foot.z, ground: ground(foot.x, foot.z), bottom, top: base });
  });
  for (let h = 0; h < height; h += 3.8) {
    const a = corners(h), b = corners(Math.min(height, h + 3.8));
    for (let side = 0; side < 4; side++) {
      const next = (side + 1) % 4;
      parts.beam(a[side], a[next], .08, steel);
      parts.beam(a[side], b[next], .06, steel);
      parts.beam(a[next], b[side], .06, steel);
    }
  }
  // Two pale microwave dishes, antenna panels and a small red obstruction
  // lamp read from the road without adding a shadow-casting point light.
  for (const [h, z, radius] of [[height - 5, 1.25, 1.2], [height - 11, -1.6, .9]]) {
    parts.beam(at(towerX, base + h, 0), at(towerX - 1.35, base + h, z), .09, steel);
    parts.add(new THREE.CylinderGeometry(radius, radius * .78, .38, 10), at(towerX - 1.45, base + h, z), '#b2c2d2', [0, yaw, Math.PI / 2]);
  }
  box(towerX + .9, base + height - 1.5, 0, [.4, 3.1, .85], '#a2b4c7');
  parts.beam(at(towerX, base + height - .2, 0), at(towerX, base + height + 4, 0), .085, steel, 5, .025);
  parts.lump(at(towerX, base + height + .45, 0), [.25, .32, .25], '#fa6952', null, 2.5);
  chunk.addMesh(parts.finish(), snowDiscoveryMaterial, 'summit-relay');
  return { kind: 'summit-relay', index: site.index, s: site.s, u: site.u, footings };
}

function buildLanding(chunk, site) {
  const parts = new SnowDiscoveryParts(), { at, ground, yaw } = frame(chunk, site.s, site.u);
  const rotation = [0, yaw, 0], length = site.length, footings = [];
  const bank = [-1.8, 1.8].map(z => { const p = at(0, 0, z); return ground(p.x, p.z); });
  if (bank.some(y => y === null || y > LAKE_LEVEL + 2.5)) return null;
  const deck = Math.max(LAKE_LEVEL + 1.1, site.cabin.y + .05, ...bank.map(y => y + .2));
  const box = (x, y, z, size, color, glow = 0) => parts.box(at(x, y, z), size, color, rotation, glow);
  for (const z of [-1.2, 1.2]) box(-length / 2, deck - .25, z, [length + .4, .32, .22], '#665649');
  const boards = Math.ceil(length / .7), pitch = length / boards;
  for (let i = 0; i < boards; i++) {
    const x = -(i + .5) * pitch;
    const width = i >= boards - 5 ? 5.2 : 3.1;
    box(x, deck, 0, [pitch - .035, .19, width], i % 4 ? wood : '#a08a70');
    // Broken edge drifts leave the warm timber visible through the snow.
    if (i % 5 < 3) box(x, deck + .13, width / 2 - .26, [pitch, .08, .48], snow);
  }
  for (let x = -.3; x > -length; x -= 4.4) for (const z of [-1.35, 1.35]) {
    const p = at(x, 0, z), y = ground(p.x, p.z);
    if (y === null) { parts.parts.forEach(part => part.dispose()); return null; }
    const bottom = y - .45;
    parts.beam(p.clone().setY(bottom), p.clone().setY(deck + .64), .15, '#756351', 6, .12);
    box(x, deck + .69, z, [.31, .1, .31], snow);
    footings.push({ x: p.x, z: p.z, ground: y, bottom, top: deck + .64 });
  }
  // A bench, tackle box, two resting rods, and one lantern at the landing head.
  box(-length + 1.6, deck + .64, 1.75, [2.3, .18, .62], '#9b8267');
  for (const x of [-length + .75, -length + 2.45]) box(x, deck + .31, 1.75, [.16, .6, .5], '#675b50');
  box(-length + 2.8, deck + .33, -.85, [.7, .5, .55], '#935d47');
  for (const [z, lean] of [[-.75, -.55], [.45, .3]]) {
    parts.beam(at(-length + .6, deck + .15, z), at(-length - 2.1, deck + 2.2, z + lean), .028, '#b29e79', 4, .012);
    parts.beam(at(-length - 2.1, deck + 2.2, z + lean), at(-length - 2.3, LAKE_LEVEL + .15, z + lean), .007, '#839ca9', 3);
  }
  const lampX = -length + 1, lampZ = -2.05;
  box(lampX, deck + 1.4, lampZ, [.13, 2.8, .13], '#5c6770');
  box(lampX, deck + 2.72, lampZ, [.45, .65, .45], '#ffd097', 2.2);
  box(lampX, deck + 3.08, lampZ, [.64, .14, .64], '#465665');
  box(lampX, deck + 3.18, lampZ, [.58, .08, .58], snow);
  chunk.addMesh(parts.finish(), snowDiscoveryMaterial, 'alpine-fishing-landing');
  return { kind: site.kind, index: site.index, s: site.s, u: site.u, length, deck, footings };
}

export function buildAlpineLandmarks(chunk) {
  const landmarks = [];
  const first = Math.floor((chunk.start - 76) / 280);
  for (let i = first; i <= first + 1; i++) {
    const site = alpineRelay(i);
    if (site && site.s >= chunk.start && site.s < chunk.start + CHUNK_LENGTH) landmarks.push(buildRelay(chunk, site));
  }
  for (let i = Math.floor(chunk.start / CABIN_SPACING); i <= Math.floor((chunk.start + CHUNK_LENGTH) / CABIN_SPACING); i++) {
    const site = alpineLanding(i);
    if (!site || site.s < chunk.start || site.s >= chunk.start + CHUNK_LENGTH) continue;
    if (chunk.discoveries.some(other => Math.abs(other.s - site.s) < 32)) continue;
    const landing = buildLanding(chunk, site);
    if (landing) landmarks.push(landing);
  }
  chunk.features.alpineLandmarks = landmarks;
}
