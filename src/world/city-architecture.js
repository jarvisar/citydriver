import * as THREE from 'three';
import { randomAt, roadFrame } from './route.js';

const ACCENTS = ['#486f69', '#955e4f', '#aa894f', '#52687c', '#687451'];

// Broad glazing bands survive the fog without hundreds of individual panes.
// Interpolate the actual flat tower faces, so details cannot sink into their
// chords on bends. Reuse the skyline batch: no new draws, shadows or updates.
export function dressSkyline(chunk, b, base, roof, color, lane) {
  const { s0, s1, u0, u1 } = b, target = chunk.scenery.skyline;
  const corners = [[s0, u0], [s1, u0], [s1, u1], [s0, u1]].map(([s, u]) => chunk.at(s, u, 0));
  const glass = color.clone().multiplyScalar(lane < 2 ? .72 : .84), cap = color.clone().multiplyScalar(1.12);
  // Group more floors at the back; at most sixteen bands per face.
  const rows = Math.min(16, Math.max(3, Math.floor((roof - base) / (lane < 2 ? 6.4 : 9.6))));
  const pitch = (roof - base - 3) / rows;
  for (const [i, j, outward] of [[0, 1, [-1, 0, 0]], [1, 2, [0, 0, -1]], [3, 0, [0, 0, 1]]]) {
    const a = corners[i], b = corners[j], length = Math.hypot(b.x - a.x, b.z - a.z);
    const point = (t, y) => ({ x: a.x + (b.x - a.x) * t + outward[0] * .06, y, z: a.z + (b.z - a.z) * t + outward[2] * .06 });
    const band = (low, high, inset, tint) => chunk.quad(target,
      [point(inset, low), point(1 - inset, low), point(1 - inset, high), point(inset, high)], tint, outward);
    for (let row = 0; row < rows; row++) {
      const low = base + 2 + row * pitch;
      band(low, low + pitch * .55, 1 / length, glass);
    }
    band(roof - .65, roof - .15, 0, cap);
  }
}

export function rooftopTank(b, seed) {
  if (b.u0 < 0 || b.u0 > 85 || b.roof === 'gable' || randomAt(seed, 3521) >= (b.u0 < 40 ? .28 : .12)) return null;
  return { s: b.s0 + (b.s1 - b.s0) * .65, u: b.u0 + (b.u1 - b.u0) * .66 };
}

export function dressBuilding(chunk, b, base, roof, seed) {
  const { blocks } = chunk.scenery, { s0, s1, u0, u1 } = b;
  const near = u0 > 0 && u0 < 40;
  if (u0 < 0 || u0 > 85) return;
  const stone = new THREE.Color(b.wall).lerp(new THREE.Color('#c7c1b3'), .55);
  const trim = (bottom, top, depth) => {
    for (const [a, b, c, d] of [[s0 - .12, s1 + .12, u0 - depth, u0 + .12], [s0 - .12, s1 + .12, u1 - .12, u1 + .12], [s0 - .12, s0 + .12, u0, u1], [s1 - .12, s1 + .12, u0, u1]]) {
      chunk.prism(blocks, a, b, c, d, bottom, top, stone);
    }
  };
  trim(base + .12, base + .58, .16);
  if (near) {
    trim(base + 3.8, base + 4.05, .22);
    if (b.roof !== 'gable') trim(roof + .52, roof + .78, .22);
    // Slim stone piers frame masonry facades. The recessed glass remains the
    // dominant detail; a few broad bands read better than tiny brick textures.
    if (randomAt(seed, 3520) < .55) {
      for (const s of [s0 + .12, s1 - .4]) chunk.prism(blocks, s, s + .28, u0 - .12, u0 + .05, base + 4, roof - .2, stone.clone().multiplyScalar(.94));
    }
  }
  const tank = rooftopTank(b, seed);
  if (tank) {
    const { s, u } = tank;
    chunk.furniture('tank', s, u, -roadFrame(s).angle, { lift: roof - chunk.ground(s, u).y + .05 });
  }
}

export function buildShopfront(chunk, b, y0, seed) {
  const { s0, s1, u0 } = b, { blocks, lit } = chunk.scenery;
  const accent = new THREE.Color(ACCENTS[Math.abs(seed) % ACCENTS.length]);
  const frame = new THREE.Color('#b9b2a2'), glass = new THREE.Color('#354c54');
  const front = (start, end, low, high, color, target = blocks, depth = .08) => chunk.quad(target,
    [chunk.at(start, u0 - depth, y0 + low), chunk.at(end, u0 - depth, y0 + low), chunk.at(end, u0 - depth, y0 + high), chunk.at(start, u0 - depth, y0 + high)], color, [-1, 0, 0]);
  const bayCount = Math.max(2, Math.floor((s1 - s0) / 3.4)), width = (s1 - s0 - 1.2) / bayCount;
  const doorBay = Math.floor(randomAt(seed, 3530) * bayCount);
  for (let i = 0; i < bayCount; i++) {
    const a = s0 + .6 + i * width, end = a + width - .18, door = i === doorBay;
    const warm = !door && randomAt(seed + i, 3531) < .36;
    front(a - .1, end + .1, .28, 2.92, frame, blocks, .07);
    front(a + .08, end - .08, door ? .25 : .65, 2.75, warm ? new THREE.Color('#bbaa84') : glass, warm ? lit : blocks, .1);
    front(a + .08, end - .08, 2.18, 2.25, frame, blocks, .12);
    if (door) {
      front(a + .08, end - .08, .3, .56, accent, blocks, .12);
      front(end - .3, end - .24, 1.05, 1.4, frame, blocks, .14);
    } else {
      front(a - .06, end + .06, .27, .57, accent, blocks, .12);
      const mid = (a + end) / 2;
      front(mid - .035, mid + .035, .6, 2.78, frame, blocks, .12);
    }
  }
  chunk.prism(blocks, s0 + .22, s1 - .22, u0 - .22, u0 + .04, y0 + 2.98, y0 + 3.6, accent);
  // A small inset plaque on the fascia, without illegible text at driving scale.
  front(s0 + (s1 - s0) * .36, s0 + (s1 - s0) * .64, 3.16, 3.4, frame, blocks, .23);
  if (randomAt(seed, 3532) < .72) {
    const a0 = s0 + .45, a1 = s1 - .45, count = Math.ceil((a1 - a0) / .9);
    const striped = randomAt(seed, 3533) < .55;
    for (let i = 0; i < count; i++) {
      const a = a0 + (a1 - a0) * i / count, end = a0 + (a1 - a0) * (i + 1) / count;
      const color = striped && i % 2 ? new THREE.Color('#c0b9a5') : accent.clone();
      chunk.quad(blocks, [chunk.at(a, u0 - .24, y0 + 3.05), chunk.at(end, u0 - .24, y0 + 3.05), chunk.at(end, u0 - 1.5, y0 + 2.65), chunk.at(a, u0 - 1.5, y0 + 2.65)], color, [-1, 1, 0]);
      chunk.quad(blocks, [chunk.at(a, u0 - 1.5, y0 + 2.65), chunk.at(end, u0 - 1.5, y0 + 2.65), chunk.at(end, u0 - 1.5, y0 + 2.4), chunk.at(a, u0 - 1.5, y0 + 2.4)], color.clone().multiplyScalar(.88), [-1, 0, 0]);
    }
  }
  if (u0 < 40) {
    for (const s of [s0 + .8, s1 - .8]) {
      const y = chunk.ground(s, u0 - .65).y;
      chunk.prism(blocks, s - .45, s + .45, u0 - 1.1, u0 - .25, y, y + .55, new THREE.Color('#8c8575'));
      chunk.prism(blocks, s - .4, s + .4, u0 - 1.04, u0 - .31, y + .5, y + .95, new THREE.Color('#60794c'));
    }
  }
}
