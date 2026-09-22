import * as THREE from 'three';
import { PAVEMENT_LEVEL as G } from './city-grid.js';
import { bed, cafeTable, disk, path, entrancePath, pergola, pool, reserve } from './city-public-space-kit.js';
import { rectanglePolygon } from './city-surfaces.js';
import { planet } from './city-public-space-geometry.js';
import { barrelRoof } from './city-roofs.js';

// Shared instances keep the new venues as inexpensive to stream as a city block.
const lettering = new THREE.PlaneGeometry(1, 1);
const dome = new THREE.SphereGeometry(1, 24, 10, Math.PI / 2 + .16, Math.PI * 2 - .32, 0, Math.PI / 2);
export const VENUE_NAMES = ['RIVOLI', 'RIVOLI TOWER', 'GRAND HOTEL', 'MUSEUM', 'UNION', 'LIBRARY', 'HOSPITAL', 'PLANETARIUM', 'BLUE NOTE', 'ATHLETIC CLUB', 'FIRE STATION'];
const cream = '#ede0bf', dark = '#354e58', copper = '#62958b';

function sign(c, label, x, s, y, width, height = 2.4, yaw = 0) {
  if (c.distant) return;
  c.item(`shop-${label}`, lettering, c.materials[`shop-${label}`], [x, G + y, -s], [width, height, 1], '#ffffff', yaw);
}
function roof(c, x, s, w, d, y, color = copper) {
  c.box(x, G + y, s, w + .6, .5, d + .6, color);
  for (const side of [-1, 1]) {
    c.box(x + side * w / 2, G + y + .6, s, .35, 1.2, d - .35, cream);
    c.box(x, G + y + .6, s + side * d / 2, w + .35, 1.2, .35, cream);
  }
}
function frontDoor(c, x, s, base = 0, width = 4.8) {
  c.box(x, G + base + 2.05, s - .24, width, 4, .2, dark, 'glass');
  for (const dx of [-width / 2 - .1, 0, width / 2 + .1]) c.box(x + dx, G + base + 2.05, s - .37, .14, 4.1, .12, cream);
  c.box(x, G + base + 4.14, s - .32, width + .4, .18, .3, cream);
  c.box(x, G + base + .08, s - .25, width + .8, .16, 1, cream);
}
function hall(c, x, s, w, d, h, color, floors = 2, doors = [0], doorWidth = 4.8) {
  reserve(c, rectanglePolygon(x, s, w + 1, d + 1));
  c.rigid(x, s, () => {
    c.box(x, G + h / 2, s, w, h, d, color);
    c.box(x, G + .6, s, w + .3, 1.2, d + .3, '#b7ad95');
    roof(c, x, s, w, d, h);
    c.solid(x, s, w + .6, d + .6);
    for (let side = 0; side < 4; side++) {
      const east = side < 2, dir = side % 2 ? 1 : -1, span = east ? d : w;
      const bays = Math.max(2, Math.floor(span / 7)), spacing = (span - 5) / bays;
      for (let floor = 0; floor < floors; floor++) for (let bay = 0; bay < bays; bay++) {
        const along = (bay - (bays - 1) / 2) * spacing, y = G + 2.5 + floor * (h - 3) / floors;
        const px = x + (east ? dir * (w / 2 + .12) : along), ps = s + (east ? along : dir * (d / 2 + .12));
        const width = Math.min(3.3, spacing - 1.2), height = Math.min(3.4, (h - 3) / floors - .8);
        const lit = (floor * 7 + bay + side + c.plan.seed) % 9 === 0;
        c.box(px, y, ps, east ? .14 : width, height, east ? width : .14, lit ? '#e9cc93' : dark, lit ? 'lit' : 'glass');
        if (!c.distant) c.box(px, y - height / 2 - .2, ps, east ? .4 : width + .5, .22, east ? width + .5 : .4, cream);
      }
    }
    for (const dx of doors) frontDoor(c, x + dx, s - d / 2, 0, doorWidth);
  });
}
function barrel(c, x, s, w, d, y, color) {
  barrelRoof(c, x, s, w, d, G + y, color, cream);
}
function gardenEdge(c, p, xs = [25, 87], ss = [31, 84]) {
  for (const x of xs) for (const s of ss) { bed(c, x, s, 8, 8, p.green, p.stone); c.tree(x, s, 8); }
}
function entry(c, x, s, w, color = '#648c82') {
  reserve(c, rectanglePolygon(x, s, w + 1, 7));
  c.rigid(x, s, () => {
    c.box(x, G + 5.3, s, w, .5, 6, color);
    c.box(x, G + 5.03, s - 2.9, w, .14, .18, '#ffe0a0', 'lit');
    for (const dx of [-w / 2 + .6, w / 2 - .6]) { c.box(x + dx, G + 2.6, s - 1.9, .35, 5.2, .35, cream); c.post(x + dx, s - 1.9, .25); }
  });
}
function cinema(c, { variant: v, palette: p }) {
  // Doorways fit between the vertical Deco piers and poster cases.
  hall(c, 56, 68, 52, 44, 17, ['#bb6c57', '#c98b76', '#729996'][v], 2, [-11.5, 11.5], 3.6);
  c.rigid(56, 68, () => {
    // Fluted Art Deco blade and a wraparound illuminated marquee.
    for (const dx of [-9, -6, 6, 9]) c.box(56 + dx, G + 13, 45.6, 1.1, 24, .9, cream);
    c.box(56, G + 18, 44.8, 8, 26, 2.3, '#386976');
    sign(c, 'RIVOLI TOWER', 56, 43.57, 20, 5.8, 18);
    for (const dx of [-3.7, 3.7]) c.box(56 + dx, G + 18, 43.5, .22, 25, .22, '#f2b776', 'lit');
    c.box(56, G + 7, 41, 39, 2.1, 10, cream);
    for (const y of [6.1, 7.9]) c.box(56, G + y, 35.9, 39, .18, .2, '#ffe5ab', 'lit');
    sign(c, 'RIVOLI', 56, 35.82, 7, 17, 1.8);
    for (const x of [40, 72]) {
      c.box(x, G + 18.1, 73, 9, 1.6, 14, '#80948d');
      for (let s = 68; s <= 78; s += 2.5) c.box(x, G + 19, s, 8, .15, .3, '#566c70');
    }
    for (const x of [39, 73]) {
      c.box(x, G + 3.2, 45.7, 6.2, 4.6, .3, cream);
      c.box(x, G + 3.2, 45.45, 5.3, 3.8, .2, x === 39 ? '#648eaa' : '#d69c57');
      c.box(x, G + 3.1, 45.3, 2.4, 2.4, .12, '#edd4ac', 'solid', 0, .5);
    }
    c.box(56, G + 2.2, 43, 5.5, 4.4, 4, '#b56254');
    c.box(56, G + 2.8, 40.9, 4.4, 1.5, .15, '#9cc9c6', 'glass'); c.solid(56, 43, 5.5, 4);
  });
  path(c, [[56, 16], [56, 38]], 10, p.path);
  for (const x of [44.5, 67.5]) entrancePath(c, [[56, 37], [x, 37], [x, 45.25]], 3.5, p.path, [56, 68], [x, 45.25]);
  for (const x of [36, 76]) cafeTable(c, x, 25, p.accent);
  gardenEdge(c, p, [23, 89], v === 1 ? [30, 52, 86] : [30, 86]);
}
function hotel(c, { variant: v, palette: p }) {
  hall(c, 56, 66, 54, 42, 32 + v * 4, ['#e2c6a1', '#cfa588', '#c4ccc0'][v], 7);
  c.rigid(56, 66, () => {
    const top = 32 + v * 4;
    c.box(56, G + top + 3, 66, 34, 6, 26, '#e0cdb0');
    for (let i = 0; i < 5; i++) c.box(56, G + top + 6 + i * .9, 66, 36 - i * 4.5, 1, 28 - i * 3.5, copper);
    c.box(56, G + top + 14, 66, .3, 9, .3, '#d8b773');
    for (const x of [33, 79]) {
      c.box(x, G + top + .6, 66, 3.3, 1, 27, '#b4a88f');
      c.box(x, G + top + 1.2, 66, 3, .65, 26.5, '#819967');
      if (!c.distant) for (const s of [56, 61, 66, 71, 76]) c.box(x, G + top + 1.65, s, 1.6, .3, 1.6, p.flower);
    }
    for (const x of [49, 63]) for (const s of [48, 51]) c.box(x, G + top + 1.7, s, .2, 3.1, .2, '#d9c4a2');
    for (let x = 49; x <= 63; x += 2) c.box(x, G + top + 3.4, 49.5, .3, .2, 4.8, '#d9c4a2');
    for (const x of [52, 60]) c.prop('bench', x, 49.5, 0, G + top + .3);
    sign(c, 'GRAND HOTEL', 56, 44.65, 28, 25, 3.2);
    for (const dx of [-25, 25]) c.box(56 + dx, G + 16, 44.7, 1.1, 31, .8, cream);
  });
  entry(c, 56, 40.5, 25, '#587d73');
  entrancePath(c, [[56, 16], [56, 44.25]], 9, p.path, [56, 66], [56, 44.25]);
  for (const x of [31, 81]) { pool(c, x, 31, 11, 13, p.stone, v === 1); cafeTable(c, x, 91, p.accent); }
  gardenEdge(c, p, [22, 90], [53, 78]);
}
function museum(c, { variant: v, palette: p }) {
  hall(c, 56, 70, 64, 36, 15, v === 2 ? '#c6cfc8' : '#d6bc97', 2);
  c.rigid(56, 63, () => {
    for (let i = 0; i < 3; i++) c.box(56, G + .3 + i * .3, 47 + i, 59 - i * 2, .6, 13 - i * 2, cream);
    c.solid(56, 48, 59, 13);
    for (const x of [32, 42, 52, 60, 70, 80]) {
      c.box(x, G + 7, 48, 1.7, 13, 1.7, '#f0dfbe');
      c.box(x, G + 13.5, 48, 2.5, .65, 2.5, cream);
    }
    c.box(56, G + 14.5, 48, 58, 1.4, 8, cream);
    for (let i = 0; i < 8; i++) c.box(56, G + 15.5 + i * .65, 48, 57 - i * 7, .7, 8, v === 2 ? '#769791' : '#cdba98');
    sign(c, 'MUSEUM', 56, 43.85, 14.6, 17, 1.2);
    c.box(56, G + 15.8, 70, 26, 1.1, 23, '#84aaa7', 'glass');
  });
  entrancePath(c, [[56, 16], [56, 40.5]], 10, p.path, [56, 63], [56, 40.5]);
  for (const x of [33, 79]) {
    c.rigid(x, 29, () => {
      c.box(x, G + .6, 29, 8, 1.2, 8, p.stone);
      c.box(x, G + 4.5, 29, 3, 7, 3, v === 1 ? '#ca875f' : '#648d95', 'solid', .5, .35); c.solid(x, 29, 8, 8);
    });
  }
  gardenEdge(c, p, [22, 90], [47, 89]);
}
function station(c, { variant: v, palette: p }) {
  hall(c, 56, 38, 62, 24, 12, ['#ae7c61', '#cbb18c', '#8ca39b'][v], 2);
  c.rigid(56, 64, () => {
    c.box(56, G + 11, 36, 17, 22, 21, cream); roof(c, 56, 36, 17, 21, 22);
    disk(c, 56, 36, 20, 20, G + 23, 1.5, copper);
    c.box(56, G + 17, 25.35, 7, 7, .2, '#f8e2ac', 'lit');
    frontDoor(c, 56, 25.5);
    c.box(56, G + 18, 25.2, .2, 2.2, .13, dark); c.box(57, G + 17, 25.19, 2.2, .2, .13, dark);
    sign(c, 'UNION', 56, 25.15, 10, 12, 2.1);
    barrel(c, 56, 71, 41, 43, 9, '#85aaa6');
    for (const x of [35, 77]) for (const s of [53, 66, 79, 91]) { c.box(x, G + 4.5, s, .5, 9, .5, cream); c.post(x, s, .3); }
    for (const x of [43, 64]) {
      c.box(x, G + .14, 73, 12, .28, 42, '#a8a396');
      for (const dx of [-2, 2]) c.box(x + dx, G + .32, 73, .15, .1, 41, '#ced0c1');
      const s = x === 43 ? 70 : 80;
      c.box(x, G + 2, s, 5.1, 3.6, 20, x === 43 ? '#bd684d' : '#4d837e');
      c.box(x, G + 3, s, 5.2, 1.3, 18, '#99c4bf', 'glass');
      c.box(x, G + 4.2, s, 5.6, .45, 20.5, cream); c.solid(x, s, 5.6, 20.5);
    }
  });
  entrancePath(c, [[56, 16], [56, 24.75]], 8, p.path, [56, 64], [56, 24.75]);
  gardenEdge(c, p, [22, 90], [29, 62, 87]);
}
function library(c, { variant: v, palette: p }) {
  hall(c, 56, 69, 55, 38, 15, ['#c7b79a', '#aab6a2', '#cfa78a'][v], 2);
  c.rigid(56, 69, () => {
    c.box(56, G + 18, 69, 34, 6, 26, '#8eaeaa', 'glass');
    for (const side of [-1, 1]) for (let i = -2; i <= 2; i++) {
      c.box(56 + i * 7, G + 18, 69 + side * 13.2, .4, 6.5, .4, cream);
      c.box(56 + side * 17.2, G + 18, 69 + i * 5, .4, 6.5, .4, cream);
    }
    c.box(56, G + 21.5, 69, 37, .7, 29, copper);
    for (let i = 0; i < 9; i++) c.box(32 + i * 6, G + 8, 49.6, .65, 15, 1.2, '#d5bf93');
    sign(c, 'LIBRARY', 56, 48.9, 12, 20, 2.4);
  });
  entry(c, 56, 46, 17, copper);
  entrancePath(c, [[56, 16], [56, 49.25]], 8, p.path, [56, 69], [56, 49.25]);
  for (const x of [32, 80]) {
    pergola(c, x, 31, 13, 16, '#b39570');
    c.prop('bench', x, 27); c.prop('bench', x, 35, Math.PI);
  }
  gardenEdge(c, p, [23, 89], [53, 88]);
}
function hospital(c, { variant: v, palette: p }) {
  hall(c, 56, 72, 61, 28, 27, '#d9dcd0', 5);
  hall(c, 34, 49, 18, 20, 14 + v * 2, '#acc3bd', 3);
  hall(c, 78, 49, 18, 20, 14 + v * 2, '#acc3bd', 3);
  c.rigid(56, 72, () => {
    c.box(56, G + 24, 57.6, 11, 10, .5, '#f0eadd');
    c.box(56, G + 24, 57.25, 2, 7, .25, '#c65d52');
    c.box(56, G + 24, 57.24, 7, 2, .25, '#c65d52');
    sign(c, 'HOSPITAL', 56, 57.2, 16, 19, 2.5);
    // Recognizable rooftop landing pad, entirely within the building footprint.
    disk(c, 56, 72, 21, 21, G + 27.4, .2, '#688c89');
    for (const dx of [-2.2, 2.2]) c.box(56 + dx, G + 27.53, 72, .6, .035, 7, cream);
    c.box(56, G + 27.53, 72, 4.4, .035, .6, cream);
  });
  entry(c, 56, 51, 18, '#af6558');
  entrancePath(c, [[56, 16], [56, 57.25]], 8, p.path, [56, 72], [56, 57.25]);
  gardenEdge(c, p, [30, 82], [26, 93]);
  for (const x of [34, 78]) c.prop('bench', x, 32);
}
function observatory(c, { variant: v, palette: p }) {
  c.rigid(56, 66, () => {
    disk(c, 56, 66, 43, 43, G + 1, 2, p.stone);
    disk(c, 56, 66, 36, 36, G + 8, 14, '#d8ccb0');
    disk(c, 56, 66, 38, 38, G + 15.2, 1, cream);
    c.item('public-dome', dome, c.materials.solid, [56, G + 15.7, -66], [19, 16, 19], [copper, '#7a91a7', '#a7775e'][v]);
    // Raised rails finish both edges of the telescope slot, including its crown.
    for (const side of [-1, 1]) for (let i = 0; i < 10; i++) {
      const phi = Math.PI / 2 + side * .16;
      const point = t => [-19 * Math.cos(phi) * Math.sin(t), 16 * Math.cos(t), 19 * Math.sin(phi) * Math.sin(t)];
      const a = point(i / 10 * Math.PI / 2), b = point((i + 1) / 10 * Math.PI / 2);
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], length = Math.hypot(dx, dy, dz);
      c.box(56 + (a[0] + b[0]) / 2, G + 15.8 + (a[1] + b[1]) / 2, 66 - (a[2] + b[2]) / 2,
        .35, length + .05, .35, '#d6c8a6', 'solid', Math.atan2(dz, -dx), Math.acos(dy / length));
    }
    c.box(56, G + 24.8, 64, 2.8, 13, 2.8, '#698b8a');
    c.box(56, G + 28, 56, 3.8, 4.3, 25, '#d9d3bc');
    c.box(56, G + 28, 43.5, 4.6, 5.1, 1.1, '#799b98');
    c.box(56, G + 28, 42.85, 3.7, 4.2, .2, '#314c65', 'glass');
    c.solid(56, 66, 43, 43);
    for (const angle of [-Math.PI / 6, 0, Math.PI / 6]) {
      c.box(56 + Math.sin(angle) * 18.15, G + 7, 66 - Math.cos(angle) * 18.15, 3, 6, .25, dark, 'glass', angle);
    }
    sign(c, 'PLANETARIUM', 56, 47.8, 12, 15, 1.8);
    frontDoor(c, 56, 48, 2);
    for (let i = 0; i < 5; i++) c.box(56, G + (i + 1) * .2, 40.9 + i, 7, (i + 1) * .4, 1.05, p.stone);
  });
  entrancePath(c, [[56, 16], [56, 40.375]], 6, p.path, [56, 66], [56, 40.375]);
  // Orbit garden, with small gold planets on stone plinths.
  for (const [x, s, size] of [[29, 32, 3], [80, 31, 4.2], [26, 62, 2.5], [84, 84, 3.3]]) c.rigid(x, s, () => {
    disk(c, x, s, 7, 7, G + .4, .8, p.stone);
    c.item('public-planet', planet, c.materials.solid, [x, G + .8 + size / 2, -s], [size / 2, size / 2, size / 2], '#d4b477', .4, .35);
    c.solid(x, s, 7, 7);
  });
  gardenEdge(c, p, [23, 89], [45, 92]);
}
function music(c, { variant: v, palette: p }) {
  hall(c, 47, 73, 47, 36, 14, ['#67778f', '#997b8c', '#597d83'][v], 2);
  c.rigid(47, 73, () => {
    c.box(47, G + 8.2, 54.7, 42, 4.4, .5, '#283e57');
    for (const y of [6, 10.4]) c.box(47, G + y, 54.35, 42, .17, .2, '#dc9dc7', 'lit');
    sign(c, 'BLUE NOTE', 47, 54.25, 8.2, 28, 3.1);
    for (let i = 0; i < 15; i++) {
      c.box(27 + i * 2.8, G + 14.8, 54.5, 2.5, 2.4, .6, cream);
      if (i % 7 !== 2 && i % 7 !== 6) c.box(28.2 + i * 2.8, G + 15.4, 54.1, 1, 1.2, .35, dark);
    }
    c.box(47, G + 4.5, 51.5, 27, .6, 6, '#476584');
  });
  entrancePath(c, [[56, 16], [56, 45], [47, 45], [47, 54.25]], 6, p.path, [47, 73], [47, 54.25]);
  for (const [x, s] of [[31, 28], [76, 27], [79, 48]]) cafeTable(c, x, s, '#aa7899');
  c.rigid(84, 73, () => {
    c.box(84, G + .5, 73, 13, 1, 18, '#a08671'); c.solid(84, 73, 13, 18);
    c.box(89, G + 3.5, 73, .8, 6, 18, '#577584');
    for (const s of [67, 79]) c.box(87.5, G + 2.3, s, 2, 3.5, 2, dark);
  });
  gardenEdge(c, p, [23, 89], [41, 94]);
  if (v === 1) pergola(c, 38, 43, 18, 7);
}
function sports(c, { variant: v, palette: p }) {
  hall(c, 56, 85, 60, 17, 7, '#b98c6f', 1);
  c.rigid(56, 85, () => { sign(c, 'ATHLETIC CLUB', 56, 76.3, 5.1, 25, 2.1); });
  c.rigid(56, 48, () => {
    const tennis = v !== 1, w = 46, d = 40;
    c.box(56, G + .06, 48, w + 8, .12, d + 6, '#c08b6f');
    c.box(56, G + .14, 48, w, .04, d, tennis ? '#6c9c8b' : '#779ea8');
    for (const dx of [-w / 2 + 2, w / 2 - 2]) c.box(56 + dx, G + .175, 48, .18, .02, d - 4, cream);
    for (const ds of [-d / 2 + 2, 0, d / 2 - 2]) c.box(56, G + .175, 48 + ds, w - 4, .02, .18, cream);
    if (tennis) {
      for (const dx of [-16, 0, 16]) c.box(56 + dx, G + .175, 48, .15, .02, d - 4, cream);
      c.box(56, G + 1.1, 48, 44, 1.8, .12, '#c1c9b8');
      c.solid(56, 48, 44, .15);
      for (const x of [34, 78]) { c.box(x, G + 1.2, 48, .2, 2.4, .2, dark); c.post(x, 48, .2); }
    } else for (const s of [31, 65]) {
      c.box(56, G + 2.8, s, .25, 5.6, .25, dark); c.post(56, s, .2);
      c.box(56, G + 5.3, s, 4, 2.5, .2, cream);
      c.box(56, G + 4.5, s + (s === 31 ? 1 : -1), 1.7, .13, 1.7, '#c9704a');
    }
    for (const x of [27, 85]) {
      c.solid(x, 48, .15, 40);
      for (const s of [29, 48, 68]) { c.box(x, G + 3, s, .18, 6, .18, dark); c.post(x, s, .2); }
      for (const y of [1.2, 3, 6]) c.box(x, G + y, 48, .1, .1, 40, '#7e9991');
      for (let s = 31; s < 68; s += 3) c.box(x, G + 3, s, .045, 6, .045, '#7e9991');
    }
  });
  for (const x of [21, 91]) for (const s of [33, 58]) c.prop('bench', x, s, Math.PI / 2);
  entrancePath(c, [[16, 73], [56, 73], [56, 75.75]], 5, p.path, [56, 85], [56, 75.75]);
  gardenEdge(c, p, [23, 89], [22, 93]);
}
function firehouse(c, { variant: v, palette: p }) {
  hall(c, 52, 68, 51, 40, 15, ['#b46551', '#bd8160', '#a76853'][v], 3);
  hall(c, 83, 77, 13, 23, 30 + v * 3, '#ad7860', 5);
  c.rigid(52, 68, () => {
    for (const x of [35, 52, 69]) {
      c.box(x, G + 3.6, 47.7, 12.4, 7.2, .5, cream);
      c.box(x, G + 3.5, 47.3, 10.8, 6.5, .3, '#a94238');
      c.box(x, G + 5.4, 47.08, 8.7, 1.3, .12, '#8cb9b5', 'glass');
      if (!c.distant) for (const y of [1, 2.2, 3.4]) c.box(x, G + y, 47.1, 10, .09, .1, '#d27b62');
    }
    sign(c, 'FIRE STATION', 52, 47.02, 9, 23, 2);
    for (let i = 0; i < 4; i++) c.box(83, G + 31 + v * 3 + i, 77, 14 - i * 2.5, 1.2, 24 - i * 4, '#5c7f7a');
  });
  // A parked heritage engine makes the use of the building legible from above.
  c.rigid(38, 33, () => {
    c.box(38, G + 1.6, 33, 5, 2.7, 12, '#bb4f3b');
    c.box(38, G + 3, 29, 4.8, 2.2, 4, '#d9714f');
    c.box(38, G + 3.1, 26.9, 4, 1.25, .15, '#8cbbb6', 'glass');
    for (const dx of [-1.4, 1.4]) c.box(38 + dx, G + 3.25, 35, .18, .2, 7, cream);
    for (let s = 32; s <= 38; s += 1.2) c.box(38, G + 3.25, s, 2.8, .16, .16, cream);
    for (const dx of [-2.5, 2.5]) for (const ds of [-3.8, 3.8]) c.box(38 + dx, G + .75, 33 + ds, .7, 1.5, 1.5, dark);
    c.solid(38, 33, 5.7, 12);
  });
  entrancePath(c, [[52, 16], [52, 47.1]], 12, p.path, [52, 68], [52, 47.1]);
  gardenEdge(c, p, [22, 90], [29, 92]);
  pool(c, 76, 28, 13, 10, p.stone);
}

export const DESTINATION_BUILDERS = { cinema, hotel, museum, station, library, hospital, observatory, music, sports, firehouse };
