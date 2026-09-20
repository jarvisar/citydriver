import * as THREE from 'three';
import { CHUNK_LENGTH, randomAt, lerp } from './route.js';
import { blockAt, blockBoundary, nearStreet, bankStreetRange, cityGroundHeight, cityStreetHeight, STREET_HALF_WIDTH } from './city-route.js';
import { drapeCityLawn } from './city-surfaces.js';

const WALLS = ['#887970', '#96968e', '#78878b', '#8a6960', '#a99d85', '#71808a'];
const ROOFS = ['#555e63', '#626866', '#6b625c'];
const GREENS = ['#607450', '#71805a', '#58704f'];
const canopy = new THREE.IcosahedronGeometry(1, 0);
const canopyPositions = Array.from(canopy.attributes.position.array);
canopy.dispose();

// Background density comes from compact silhouettes and simple facades.
// Everything is baked into existing chunk batches; there are no additional
// objects, materials, shadow lights or per-frame updates.
export function buildNeighborhoods(chunk) {
  const { blocks, skyline, details, boxes } = chunk.scenery;
  const plantings = [];
  const first = blockAt(chunk.start - 160), last = blockAt(chunk.start + CHUNK_LENGTH + 160);
  const ground = (s, u, lift = 0) => {
    const p = chunk.ground(s, u); p.y += lift; return p;
  };
  function tree(target, s, u, h, seed) {
    plantings.push({ target, s, u, h, seed });
  }
  function plantTree({ target, s, u, h, seed }) {
    const p = ground(s, u), color = new THREE.Color(GREENS[Math.abs(seed) % GREENS.length]);
    if (!chunk.planting.clears(p, h * .35)) return;
    chunk.prism(target, s - .14, s + .14, u - .14, u + .14, p.y, p.y + h * .64, new THREE.Color('#655a48'));
    for (let i = 0; i < canopyPositions.length; i += 9) {
      const tint = color.clone().multiplyScalar(.87 + randomAt(seed, i + 3681) * .25);
      for (let j = 0; j < 9; j += 3) {
        target.vertices.push(p.x + canopyPositions[i + j] * h * .35, p.y + h * .67 + canopyPositions[i + j + 1] * h * .42, p.z + canopyPositions[i + j + 2] * h * .35);
        target.colors.push(tint.r, tint.g, tint.b);
      }
    }
  }
  function green(target, s, u, width, depth, seed) {
    const c = new THREE.Color('#65745b');
    const corners = [[s - width / 2, u - depth / 2], [s + width / 2, u - depth / 2], [s + width / 2, u + depth / 2], [s - width / 2, u + depth / 2]];
    drapeCityLawn(chunk, target, corners, c);
    if (!chunk.inChunk(s)) return;
    for (const ds of [-width * .27, width * .22]) tree(target, s + ds, u + (randomAt(seed, Math.round(ds) + 3682) - .5) * depth * .35, 4.2 + randomAt(seed, Math.round(ds) + 3683) * 1.8, seed + Math.round(ds));
  }
  function building(target, s0, s1, u0, u1, height, seed) {
    chunk.reserveBuilding(s0, s1, u0, u1);
    if (!chunk.inChunk((s0 + s1) / 2)) return;
    const corners = [[s0, u0], [s1, u0], [s1, u1], [s0, u1]].map(([s, u]) => ground(s, u));
    const base = Math.min(...corners.map(p => p.y)) - .2, top = Math.max(...corners.map(p => p.y)) + height;
    const color = new THREE.Color(WALLS[Math.floor(randomAt(seed, 3691) * WALLS.length)]);
    const roof = new THREE.Color(ROOFS[Math.floor(randomAt(seed, 3692) * ROOFS.length)]);
    const at = (i, y) => ({ ...corners[i], y });
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4, outward = [[-1, 0, 0], [0, 0, -1], [1, 0, 0], [0, 0, 1]][i];
      chunk.quad(target, [at(i, base), at(j, base), at(j, top), at(i, top)], color.clone().multiplyScalar([1, .9, .82, .94][i]), outward);
      // The opposite bank faces +u; both ends can be seen while driving.
      if (i === (u1 < 0 ? 0 : 2)) continue;
      const a = corners[i], b = corners[j], length = Math.hypot(b.x - a.x, b.z - a.z);
      const point = (distance, y) => ({ x: lerp(a.x, b.x, distance / length) + outward[0] * .04, y, z: lerp(a.z, b.z, distance / length) + outward[2] * .04 });
      for (let y = base + 1.3; y < top - 1.8; y += 3.4) for (let d = 1.5; d < length - 2.2; d += 4.2) {
        chunk.quad(target, [point(d, y), point(d + 1.65, y), point(d + 1.65, y + 1.5), point(d, y + 1.5)], new THREE.Color('#40545d'), outward);
      }
    }
    chunk.quad(target, [0, 1, 2, 3].map(i => at(i, top)), roof, [0, 1, 0]);
    // A roof cap and one stair head give depth without full parapet geometry.
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4, center = { x: (corners[0].x + corners[2].x) / 2, z: (corners[0].z + corners[2].z) / 2 };
      const inset = k => ({ x: lerp(corners[k].x, center.x, .045), y: top + .025, z: lerp(corners[k].z, center.z, .045) });
      chunk.quad(target, [at(i, top + .025), at(j, top + .025), inset(j), inset(i)], color.clone().multiplyScalar(.92), [0, 1, 0]);
    }
    if (randomAt(seed, 3693) < .55) chunk.prism(target, s0 + 2, s0 + 4.4, u0 + 2, u0 + 4.8, top, top + 1.3, roof.clone().multiplyScalar(1.16));
  }

  for (let block = first; block <= last; block++) {
    const start = blockBoundary(block) + STREET_HALF_WIDTH + 3, end = blockBoundary(block + 1) - STREET_HALF_WIDTH - 3;
    // A stepped fringe: compact residential blocks on the opposite bank,
    // and shorter town blocks between the inland avenue and distant skyline.
    for (const [lane, front, back] of [[0, -282, -257], [1, -328, -298], [2, 178, 205], [3, 215, 241]]) {
      const count = Math.max(1, Math.floor((end - start) / (lane === 1 ? 35 : 29))), width = (end - start) / count;
      for (let k = 0; k < count; k++) {
        const seed = block * 131 + lane * 29 + k, r = j => randomAt(seed, 3671 + j);
        const center = start + width * (k + .5);
        const target = front > 0 ? skyline : blocks;
        const u0 = front + r(0) * 4, u1 = Math.min(back - 1, u0 + 15 + r(1) * 9);
        if (r(2) < .2) {
          green(target, center, (front + back) / 2, width - 5, back - front - 4, seed);
          continue;
        }
        const s0 = center - width / 2 + 1.5 + r(3) * 2.5, s1 = center + width / 2 - 2;
        const height = (lane === 1 ? 6 : 8) + Math.floor(r(4) * (lane > 1 ? 5 : 3)) * 3.4;
        building(target, s0, s1, u0, u1, height, seed);
        // Small, irregular yards soften the building row without filling
        // every lot with another costly foreground tree or parked vehicle.
        if (chunk.inChunk(center) && r(5) < .55) tree(target, s1 + .8, back - 2, 4.5 + r(6) * 2, seed);
      }
    }
    // The waterfront gets a few planted setbacks between bridge approaches.
    const count = Math.max(1, Math.floor((end - start) / 38));
    for (let k = 0; k < count; k++) {
      const s = start + (end - start) * (k + .5) / count, seed = block * 13 + k;
      if (chunk.inChunk(s)) tree(blocks, s, -132, 4.2 + randomAt(seed, 3685), seed);
      if (randomAt(seed, 3686) < .7) green(details, s, -177.2, 12, 3.4, seed);
    }
    // Where a short side street stops, the former empty outer block becomes
    // a little green court rather than another repeated cross intersection.
    if (bankStreetRange(block).from > -245) green(blocks, blockBoundary(block), -217, 12, 29, block);
  }

  // Check after every lot is reserved, including buildings owned by the next
  // chunk. Planting must not depend on which side of a seam was built first.
  plantings.forEach(plantTree);

  // Continuous riverfront edge. The rail opens only at a real bridge, so
  // T junctions retain a walking route instead of ending abruptly at water.
  for (let s = chunk.start; s < chunk.start + CHUNK_LENGTH; s += 8) {
    const index = blockAt(s + 4), nearest = Math.abs(s + 4 - blockBoundary(index)) < Math.abs(s + 4 - blockBoundary(index + 1)) ? index : index + 1;
    const center = blockBoundary(nearest), edge = STREET_HALF_WIDTH - .3;
    const spans = nearStreet(nearest) ? [[s, Math.min(s + 8, center - edge)], [Math.max(s, center + edge), s + 8]] : [[s, s + 8]];
    for (const [from, to] of spans) {
      if (to <= from) continue;
      const point = (t, lift) => chunk.at(t, -133, cityStreetHeight(t, -133) + .095 + lift);
      chunk.beam(boxes, point(from, 0), point(from, 1.04), .085, '#414b4d');
      for (const lift of [.5, 1.02]) chunk.beam(boxes, point(from, lift), point(to, lift), .075, '#414b4d');
      chunk.quad(details, [[from, -133.35], [to, -133.35], [to, -132.65], [from, -132.65]].map(([a, b]) => chunk.at(a, b, cityGroundHeight(a, b) + .035)), new THREE.Color('#a4a7a0'), [0, 1, 0]);
    }
  }
}
