import * as THREE from 'three';
import { CHUNK_LENGTH, randomAt, roadFrame } from './route.js';
import { blockAt, blockBoundary, crossStreetAt, nearStreet, onCrossStreet, STREET_HALF_WIDTH, pavementHeight, quayOffset, QUAY_WALL, RIVER_LEVEL, RIVER_BED } from './city-route.js';
import { cityParkingForBlock, cityParkingAt, cityParkingWidth } from './city-parking.js';
import { buildWaterfrontGarden } from './city-gardens.js';

const STONE = new THREE.Color('#aaa99e'), JOINT = new THREE.Color('#80888b');
const GRASS = ['#6b8058', '#71865e', '#627951'];

// Small pieces of public space share one vertex-coloured mesh per chunk.
// All the paving samples the actual ground at its corners, including bends
// and chunk edges; the global street grid decides ownership of larger props.
export function buildPromenade(chunk) {
  const { details, boxes } = chunk.scenery;
  const end = chunk.start + CHUNK_LENGTH;
  const patch = (s0, s1, u0, u1, color, lift = .022) => {
    const points = [[s0, u0], [s1, u0], [s1, u1], [s0, u1]].map(([s, u]) => {
      const p = chunk.ground(s, u); p.y += lift; return p;
    });
    chunk.quad(details, points, color, [0, 1, 0]);
  };
  const bed = (s0, s1, u0, u1, seed) => {
    const y = Math.min(...[[s0, u0], [s1, u0], [s0, u1], [s1, u1]].map(([s, u]) => chunk.ground(s, u).y));
    chunk.prism(details, s0, s1, u0, u1, y - .12, y + .33, STONE);
    chunk.prism(details, s0 + .3, s1 - .3, u0 + .3, u1 - .3, y + .32, y + .38, new THREE.Color(GRASS[Math.abs(seed) % GRASS.length]));
    return y + .38;
  };
  const kioskSite = block => {
    const s = (blockBoundary(block) + blockBoundary(block + 1)) / 2, q = quayOffset(s);
    return randomAt(block, 3600) < .24 && q < -29 ? { s, u: (q - 12) / 2 } : null;
  };

  // Quiet joints give the pavement scale. Pale edge stones and a darker tide
  // line make the embankment read as masonry instead of an unbroken grey slab.
  for (let s = chunk.start; s < end; s += 8) {
    const t = Math.min(s + 8, end), q0 = quayOffset(s), q1 = quayOffset(t);
    const nearCrossing = Math.abs(s - crossStreetAt(s).center) < STREET_HALF_WIDTH;
    if (!nearCrossing) {
      patch(s, s + .055, q0 + 1.4, cityParkingAt(s) ? -cityParkingWidth(s) - .5 : -6.75, JOINT);
      patch(s, s + .055, 6.75, 13.8, JOINT);
    }
    for (const u of [-13.9, -9.2, 9.2]) if (!onCrossStreet(s + 4, u) && !(u < 0 && cityParkingAt(s + 4) && -u < cityParkingWidth(s + 4) + .5)) patch(s, t, u, u + .045, JOINT);
    const street = crossStreetAt(s + 4);
    const spans = nearStreet(street.index) ? [[s, Math.min(t, street.center - STREET_HALF_WIDTH)], [Math.max(s, street.center + STREET_HALF_WIDTH), t]] : [[s, t]];
    for (const [from, to] of spans) {
      if (to <= from) continue;
      const coping = [[from, -.12], [to, -.12], [to, 1.25], [from, 1.25]]
        .map(([a, offset]) => chunk.at(a, quayOffset(a) + offset, pavementHeight(a) + .075));
      chunk.quad(details, coping, STONE, [0, 1, 0]);
    }
    const waterline = (s, q, y) => {
      const height = chunk.ground(s, q).y;
      return chunk.at(s, q - QUAY_WALL * (height - y) / (height - RIVER_BED) - .025, y);
    };
    const wet = [waterline(s, q0, RIVER_LEVEL + .04), waterline(t, q1, RIVER_LEVEL + .04), waterline(t, q1, RIVER_LEVEL + .62), waterline(s, q0, RIVER_LEVEL + .62)];
    chunk.quad(details, wet, new THREE.Color('#596663'), [-1, 0, 0]);
    if (s % 16 === 0 && chunk.clearAt(s, q0, 1)) {
      const height = chunk.ground(s, q0).y;
      chunk.prism(details, s - .36, s + .36, q0 - 1.35, q0 + .4, RIVER_LEVEL - .12, height + .1, new THREE.Color('#96968d'));
    }
  }

  // Raised garden islands break the promenade into a walking route, planted
  // seating areas and small parking bays. Leave full access to every street.
  for (let block = blockAt(chunk.start - 80); block <= blockAt(end + 80); block++) {
    if (kioskSite(block)) continue;
    const from = blockBoundary(block) + STREET_HALF_WIDTH + 6, to = blockBoundary(block + 1) - STREET_HALF_WIDTH - 6;
    const count = Math.max(1, Math.floor((to - from) / 44));
    for (let k = 0; k < count; k++) {
      const s = from + (to - from) * (k + .5) / count, q = quayOffset(s), n = block * 3 + k;
      const parking = cityParkingForBlock(block), shift = parking ? 6 : 0;
      const u0 = Math.max(q + (parking || q < -35 ? 12 : 4.5), -28) - shift, u1 = -14.5 - shift, half = Math.min(11, ((to - from) / count - 8) / 2);
      if (!chunk.inChunk(s) || u1 - u0 < 2.2 || !chunk.clearAt(s, (u0 + u1) / 2, half + 2)) continue;
      buildWaterfrontGarden(chunk, s, u0, u1, half, n);
    }
  }

  // An occasional coffee stand and two benches occupy one of the wider
  // landings. They stay low enough to preserve the view of the driving lane.
  for (let block = blockAt(chunk.start - 80); block <= blockAt(end + 80); block++) {
    const site = kioskSite(block);
    if (!site || !chunk.inChunk(site.s) || !chunk.clearAt(site.s, site.u, 7)) continue;
    const { s, u } = site, yaw = -roadFrame(s).angle;
    patch(s - 5.5, s + 5.5, u - 4.3, u + 4.3, new THREE.Color('#999c94'));
    chunk.furniture('kiosk', s, u, yaw);
    for (const ds of [-4, 4]) {
      chunk.furniture('bench', s + ds, u - 1.4, yaw);
      bed(s + ds - .8, s + ds + .8, u + 1.4, u + 3, block);
      chunk.tree(s + ds, u + 2.2, 3.8, '#72865b', yaw);
    }
    chunk.furniture('bin', s + 3.6, u - 3, yaw);
  }

  // Tree pits and drains are attached to their existing street layout, so
  // furniture does not accumulate independently at the same position.
  for (const items of chunk.scenery.bark.values()) for (const item of items) {
    if (!item.pit) continue;
    const [x, y, z] = item.p;
    const matrixYaw = item.r[1];
    boxes.push({ p: [x, y + .16, z], scale: [1.85, .15, 1.85], r: [0, matrixYaw, 0], color: '#a8a797' });
    boxes.push({ p: [x, y + .25, z], scale: [1.55, .06, 1.55], r: [0, matrixYaw, 0], color: '#536249' });
  }
  for (let s = Math.ceil(chunk.start / 24) * 24 + 3; s < end; s += 24) {
    const yaw = -roadFrame(s).angle;
    for (const u of [-5.67, 5.67]) {
      const p = chunk.ground(s, u);
      boxes.push({ p: [p.x, p.y + .026, p.z], scale: [.45, .03, .9], r: [0, yaw, 0], color: '#363f42' });
      for (const ds of [-.28, 0, .28]) {
        const slit = chunk.ground(s + ds, u);
        boxes.push({ p: [slit.x, slit.y + .045, slit.z], scale: [.34, .02, .06], r: [0, yaw, 0], color: '#737d7d' });
      }
    }
  }
}
