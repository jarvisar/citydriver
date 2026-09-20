import * as THREE from 'three';
import { randomAt, roadFrame } from './route.js';

const GRASS = ['#6b8058', '#71865e', '#627951'];
const GREENS = ['#60794b', '#708659', '#567047'];
const stone = new THREE.Color('#aaa99e');
const shrubGeometry = new THREE.IcosahedronGeometry(1, 0);
const shrubVertices = Array.from(shrubGeometry.attributes.position.array);
shrubGeometry.dispose();

// A few loose planting compositions, not a new asset or draw call per park.
// Keep the original site's envelope and seed, so walks and chunk ownership
// stay stable as the car travels in either direction.
export function buildWaterfrontGarden(chunk, s, u0, u1, half, seed) {
  const r = salt => randomAt(seed, 3720 + salt), { details } = chunk.scenery;
  const h = half * (.78 + r(0) * .2), d = (u1 - u0) * (.78 + r(1) * .18) / 2;
  const u = (u0 + u1) / 2, offset = (r(2) - .5) * (half - h) * 1.6;
  const cut = [3, 4, 5, 6].map(k => .12 + r(k) * .26);
  // Unequal chamfered corners soften the outline while keeping broad facets.
  const outline = [[-h + h * cut[0], -d], [h - h * cut[1], -d], [h, -d + d * cut[1]],
    [h, d - d * cut[2]], [h - h * cut[2], d], [-h + h * cut[3], d], [-h, d - d * cut[3]], [-h, -d + d * cut[0]]];
  const inset = Math.min(.22 / d, .2);
  const inner = outline.map(([x, z]) => [x * (1 - .22 / h), z * (1 - inset)]);
  const at = ([x, z], lift) => { const p = chunk.ground(s + offset + x, u + z); p.y += lift; return p; };
  const grass = new THREE.Color(GRASS[Math.floor(r(7) * GRASS.length)]);
  const center = at([0, 0], .23);
  for (let i = 0; i < outline.length; i++) {
    const j = (i + 1) % outline.length, a = at(outline[i], .2), b = at(outline[j], .2);
    chunk.quad(details, [at(outline[i], -.08), at(outline[j], -.08), b, a], stone, [a.x - center.x, 0, a.z - center.z]);
    chunk.quad(details, [a, b, at(inner[j], .2), at(inner[i], .2)], stone, [0, 1, 0]);
    chunk.quad(details, [center, at(inner[i], .23), at(inner[j], .23), center], grass, [0, 1, 0]);
  }

  const mirror = r(8) < .5 ? -1 : 1, style = Math.floor(r(9) * 3);
  const grove = style === 2 && d > 3 && h > 7;
  const trees = style === 0 ? [[-.3, .05]] : grove ? [[-.48, -.17], [.05, .36], [.48, -.28]] : [[-.43, -.18], [.4, .22]];
  for (const [i, [x, z]] of trees.entries()) {
    const t = s + offset + (x + (r(10 + i) - .5) * .12) * h * mirror;
    const v = u + (z + (r(14 + i) - .5) * .15) * d;
    const height = (grove ? 4.7 : 5.2) + r(18 + i) * 1.6;
    chunk.tree(t, v, height, GREENS[Math.floor(r(22 + i) * GREENS.length)], r(26 + i) * Math.PI * 2, chunk.ground(t, v).y + .23);
  }

  const shrub = (x, z, index) => {
    const p = at([x, z], .23), radius = .6 + r(31 + index) * .35, height = .48 + r(35 + index) * .3;
    const color = new THREE.Color(GREENS[index % GREENS.length]);
    for (let i = 0; i < shrubVertices.length; i += 9) {
      const tint = color.clone().multiplyScalar(.92 + (i / 9 % 3) * .05);
      for (let j = 0; j < 9; j += 3) {
        details.vertices.push(p.x + shrubVertices[i + j] * radius, p.y + height * .7 + shrubVertices[i + j + 1] * height, p.z + shrubVertices[i + j + 2] * radius);
        details.colors.push(tint.r, tint.g, tint.b);
      }
    }
  };
  if (style === 0) {
    // An open lawn with a small, uneven shrub cluster opposite its shade tree.
    for (let i = 0; i < (d > 2 ? 3 : 2); i++) shrub(h * (.38 + i * .11) * mirror, (i - 1) * Math.min(.85, d * .28), i);
  } else if (style === 1) {
    // Sometimes a short broken hedge, sometimes just shrubs. Change both the
    // end and orientation rather than repeating a full-width green bar.
    if (r(39) < .55 && d > 2.2) {
      const along = r(40) < .5;
      for (let i = 0; i < 2; i++) {
        const x = (along ? -.12 + i * .27 : .68) * h * mirror;
        const z = along ? d * (r(41) < .5 ? -.68 : .68) : (i ? .28 : -.28) * d;
        const t = s + offset + x, v = u + z, y = chunk.ground(t, v).y + .23;
        const w = along ? h * .11 : .45, depth = along ? .4 : d * .2;
        chunk.prism(details, t - w, t + w, v - depth, v + depth, y, y + .55 + r(42 + i) * .18, new THREE.Color('#566f4b'));
      }
    } else for (let i = 0; i < 2; i++) shrub((.63 - i * .1) * h * mirror, (i ? .32 : -.32) * d, i);
  }

  const yaw = -roadFrame(s).angle, seat = (r(45) - .5) * h * .8;
  chunk.furniture('bench', s + offset + seat, u - d - 1.15, yaw);
  if (r(46) < .58) {
    if (r(47) < .5) chunk.furniture('bench', s + offset + h + 1.1, u + d * .1, yaw + Math.PI / 2);
    else chunk.furniture('bench', s + offset + (seat > 0 ? -.55 : .55) * h, u - d - 1.15, yaw);
  }
  chunk.furniture('bin', s + offset + seat + 1.9, u - d - 1.05, yaw);
}
