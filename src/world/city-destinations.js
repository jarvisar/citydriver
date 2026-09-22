import * as THREE from 'three';
import { PAVEMENT_LEVEL as G } from './city-grid.js';
import { bed, cafeTable, disk, path, entrancePath, pergola, pool, reserve, publicSpacePlan } from './city-public-space-kit.js';
import { rectanglePolygon } from './city-surfaces.js';
import { planet, basinRim, curvedPath, ellipsePoints } from './city-public-space-geometry.js';
import { barrelRoof, pitchedRoof, sawtoothRoof, mansardRoof } from './city-roofs.js';
import { donutDough, donutGlaze, sprinklePosition } from './city-donut.js';
import { round, clock, wheels, fireEngine, bell, hoop, produce } from './city-detail-assets.js';
import { parkedCars } from './city-assets.js';
import { venueBrand, SHOP_BRANDS } from './city-businesses.js';

// Shared instances keep the new venues as inexpensive to stream as a city block.
const lettering = new THREE.PlaneGeometry(1, 1);
const dome = new THREE.SphereGeometry(1, 24, 10, Math.PI / 2 + .16, Math.PI * 2 - .32, 0, Math.PI / 2);
// One source for mesh and texture proportions prevents flattened lettering.
export const VENUE_SIGNS = {
  RIVOLI: [17, 1.8], 'RIVOLI TOWER': [5.8, 18], 'GRAND HOTEL': [25, 3.2],
  MUSEUM: [17, 1.2], UNION: [12, 2.1], LIBRARY: [20, 2.4], HOSPITAL: [19, 2.5],
  PLANETARIUM: [15, 1.8], 'BLUE NOTE': [28, 3.1], 'ATHLETIC CLUB': [25, 2.1],
  'FIRE STATION': [23, 2], 'POST OFFICE': [21, 2.6], 'MOSAIC BATHS': [23, 1.8],
  'FARMERS MARKET': [14, 1.5], BAKERY: [17, 1.7], 'LUCKY DONUT': [27, 2], 'CITY HALL': [18, .9],
};
const VENUE_TYPES = {
  RIVOLI: 'cinema', 'RIVOLI TOWER': 'cinema', 'GRAND HOTEL': 'hotel', MUSEUM: 'museum', UNION: 'station',
  LIBRARY: 'library', HOSPITAL: 'hospital', PLANETARIUM: 'observatory', 'BLUE NOTE': 'music', 'ATHLETIC CLUB': 'sports',
  'FIRE STATION': 'firehouse', 'POST OFFICE': 'postoffice', 'MOSAIC BATHS': 'bathhouse',
  'FARMERS MARKET': 'farmersmarket', 'LUCKY DONUT': 'donut',
};
export function venueSignLabel(label, variant) {
  if (label === 'BAKERY') return SHOP_BRANDS.BAKERY[variant + 4][0];
  const brand = venueBrand(VENUE_TYPES[label], variant);
  return brand ? `${brand.lettering}${label.endsWith(' TOWER') ? ' TOWER' : ''}` : label;
}
// Produce has just twenty faces and is shared with the covered market.
const vaultEnd = new THREE.CircleGeometry(1, 12, 0, Math.PI);
// Continuous profiles replace intersecting segments at the slot rails and crest.
const railProfile = new THREE.Shape();
for (let i = 0; i <= 10; i++) {
  const a = i / 10 * Math.PI / 2;
  railProfile[i ? 'lineTo' : 'moveTo'](19.18 * Math.sin(a), 16.18 * Math.cos(a));
}
for (let i = 10; i >= 0; i--) {
  const a = i / 10 * Math.PI / 2;
  railProfile.lineTo(18.82 * Math.sin(a), 15.82 * Math.cos(a));
}
railProfile.closePath();
const slotRail = new THREE.ExtrudeGeometry(railProfile, { depth: .35, bevelEnabled: false, steps: 1 });
slotRail.translate(0, 0, -.175);
const envelopeProfile = new THREE.Shape([[-4.15, .99], [0, -1.17], [4.15, .99], [4.07, 1.16], [0, -.96], [-4.07, 1.16]].map(p => new THREE.Vector2(...p)));
const envelopeFold = new THREE.ExtrudeGeometry(envelopeProfile, { depth: .12, bevelEnabled: false, steps: 1 });
envelopeFold.translate(0, 0, -.06);
const cream = '#ede0bf', dark = '#354e58', copper = '#62958b';

function sign(c, label, x, s, y, yaw = 0) {
  if (c.distant) return;
  const [width, height] = VENUE_SIGNS[label], { variant } = publicSpacePlan(c.plan);
  const key = `venue-${label}-${variant}`;
  c.item(key, lettering, c.materials[key], [x, G + y, -s], [width, height, 1], '#ffffff', yaw);
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
  c.structure(x, s, () => {
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
  c.structure(x, s, () => {
    c.box(x, G + 5.3, s, w, .5, 6, color);
    c.box(x, G + 4.98, s - 2.9, w, .14, .18, '#ffe0a0', 'lit');
    for (const dx of [-w / 2 + .6, w / 2 - .6]) { c.box(x + dx, G + 2.6, s - 1.9, .35, 5.2, .35, cream); c.post(x + dx, s - 1.9, .25); }
  });
}
function cinema(c, { variant: v, palette: p }) {
  // Doorways fit between the vertical Deco piers and poster cases.
  hall(c, 56, 68, 52, 44, 17, ['#bb6c57', '#c98b76', '#729996'][v], 2, [-11.5, 11.5], 3.6);
  c.structure(56, 68, () => {
    // Fluted Art Deco blade and a wraparound illuminated marquee.
    for (const dx of [-9, -6, 6, 9]) c.box(56 + dx, G + 13, 45.6, 1.1, 24, .9, cream);
    c.box(56, G + 18, 44.8, 8, 26, 2.3, '#386976');
    sign(c, 'RIVOLI TOWER', 56, 43.57, 20);
    for (const dx of [-3.7, 3.7]) c.box(56 + dx, G + 18, 43.5, .22, 25, .22, '#f2b776', 'lit');
    c.box(56, G + 7, 41, 39, 2.1, 10, cream);
    for (const y of [6.1, 7.9]) c.box(56, G + y, 35.9, 39, .18, .2, '#ffe5ab', 'lit');
    sign(c, 'RIVOLI', 56, 35.82, 7);
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
  c.structure(56, 66, () => {
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
    sign(c, 'GRAND HOTEL', 56, 44.65, 28);
    for (const dx of [-25, 25]) c.box(56 + dx, G + 16, 44.7, 1.1, 31, .8, cream);
  });
  entry(c, 56, 40.5, 25, '#587d73');
  entrancePath(c, [[56, 16], [56, 44.25]], 9, p.path, [56, 66], [56, 44.25]);
  for (const x of [31, 81]) { pool(c, x, 31, 11, 13, p.stone, v === 1); cafeTable(c, x, 91, p.accent); }
  gardenEdge(c, p, [22, 90], [53, 78]);
}
function museum(c, { variant: v, palette: p }) {
  hall(c, 56, 70, 64, 36, 15, v === 2 ? '#c6cfc8' : '#d6bc97', 2);
  c.structure(56, 63, () => {
    for (let i = 0; i < 3; i++) c.box(56, G + .3 + i * .3, 47 + i, 59 - i * 2, .6, 13 - i * 2, cream);
    c.solid(56, 48, 59, 13);
    for (const x of [32, 42, 52, 60, 70, 80]) {
      round(c, x, G + 7, 48, 1.7, 13, 1.7, '#f0dfbe');
      c.box(x, G + 13.5, 48, 2.5, .65, 2.5, cream);
    }
    c.box(56, G + 14.5, 48, 58, 1.4, 8, cream);
    pitchedRoof(c, 56, 48, 58, 8, G + 15.2, v === 2 ? '#769791' : '#cdba98', '#cdba98', .17, { wallWidth: 58, wallDepth: 8 });
    sign(c, 'MUSEUM', 56, 43.85, 14.6);
    c.box(56, G + 15.8, 70, 26, 1.1, 23, '#84aaa7', 'glass');
  });
  entrancePath(c, [[56, 16], [56, 40.5]], 10, p.path, [56, 63], [56, 40.5]);
  for (const x of [33, 79]) {
    c.structure(x, 29, () => {
      c.box(x, G + .6, 29, 8, 1.2, 8, p.stone);
      c.box(x, G + 4.5, 29, 3, 7, 3, v === 1 ? '#ca875f' : '#648d95', 'solid', .5, .35); c.solid(x, 29, 8, 8);
    });
  }
  gardenEdge(c, p, [22, 90], [47, 89]);
}
function station(c, { variant: v, palette: p }) {
  hall(c, 56, 38, 62, 24, 12, ['#ae7c61', '#cbb18c', '#8ca39b'][v], 2, []);
  c.structure(56, 64, () => {
    c.box(56, G + 11, 36, 17, 22, 21, cream); roof(c, 56, 36, 17, 21, 22);
    disk(c, 56, 36, 20, 20, G + 23, 1.5, copper);
    clock(c, 56, G + 17, 25.3, 7);
    frontDoor(c, 56, 25.5);
    sign(c, 'UNION', 56, 25.15, 10);
    barrel(c, 56, 71, 41, 43, 9, '#85aaa6');
    for (const x of [35, 77]) for (const s of [53, 66, 79, 91]) { c.box(x, G + 4.5, s, .5, 9, .5, cream); c.post(x, s, .3); }
    for (const x of [43, 64]) {
      c.box(x, G + .14, 73, 12, .28, 42, '#a8a396');
      for (const dx of [-2, 2]) c.box(x + dx, G + .32, 73, .15, .1, 41, '#ced0c1');
      const s = x === 43 ? 70 : 80;
      c.box(x, G + 1.15, s, 4.5, .5, 19.6, dark);
      c.box(x, G + 2.1, s, 5.1, 1.4, 20, x === 43 ? '#bd684d' : '#4d837e');
      c.box(x, G + 3.3, s, 4.9, 1.5, 19.8, cream);
      for (const side of [-1, 1]) {
        for (let ds = -7.6; ds <= 7.6; ds += 3.05) c.box(x + side * 2.48, G + 3.35, s + ds, .1, 1.12, 2.2, dark, 'glass');
        c.box(x, G + 3.35, s + side * 9.96, 3.9, 1.12, .1, dark, 'glass');
        for (const dx of [-1.6, 1.6]) round(c, x + dx, G + 2.15, s + side * 10.06, .4, .4, .1, side < 0 ? '#f1d9a0' : '#ba6654', 'z');
      }
      round(c, x, G + 4.02, s, 5.3, .7, 20.2, '#718c87', 'z');
      wheels(c, x, G + .8, s, 4.5, 13, 1.45, .45);
      c.solid(x, s, 5.6, 20.5);
    }
  });
  entrancePath(c, [[56, 16], [56, 24.75]], 8, p.path, [56, 64], [56, 24.75]);
  gardenEdge(c, p, [22, 90], [29, 62, 87]);
}
function library(c, { variant: v, palette: p }) {
  hall(c, 56, 69, 55, 38, 15, ['#c7b79a', '#aab6a2', '#cfa78a'][v], 2);
  c.structure(56, 69, () => {
    c.box(56, G + 18, 69, 34, 6, 26, '#8eaeaa', 'glass');
    for (const side of [-1, 1]) for (let i = -2; i <= 2; i++) {
      c.box(56 + i * 7, G + 18, 69 + side * 13.2, .4, 6.5, .4, cream);
      c.box(56 + side * 17.2, G + 18, 69 + i * 5, .4, 6.5, .4, cream);
    }
    c.box(56, G + 21.5, 69, 37, .7, 29, copper);
    for (let i = 0; i < 9; i++) c.box(32 + i * 6, G + 8, 49.6, .65, 15, 1.2, '#d5bf93');
    sign(c, 'LIBRARY', 56, 48.9, 12);
  });
  entry(c, 56, 46, 17, copper);
  entrancePath(c, [[56, 16], [56, 49.25]], 8, p.path, [56, 69], [56, 49.25]);
  for (const x of [32, 80]) {
    pergola(c, x, 31, 13, 16, '#b39570');
  }
  gardenEdge(c, p, [23, 89], [53, 88]);
}
function hospital(c, { variant: v, palette: p }) {
  hall(c, 56, 72, 61, 28, 27, '#d9dcd0', 5);
  hall(c, 34, 49, 18, 20, 14 + v * 2, '#acc3bd', 3);
  hall(c, 78, 49, 18, 20, 14 + v * 2, '#acc3bd', 3);
  c.structure(56, 72, () => {
    c.box(56, G + 24, 57.6, 11, 10, .5, '#f0eadd');
    c.box(56, G + 24, 57.25, 2, 7, .25, '#c65d52');
    for (const dx of [-2.25, 2.25]) c.box(56 + dx, G + 24, 57.25, 2.5, 2, .25, '#c65d52');
    sign(c, 'HOSPITAL', 56, 57.2, 16);
    // Recognizable rooftop landing pad, entirely within the building footprint.
    disk(c, 56, 72, 21, 21, G + 27.4, .2, '#688c89');
    for (const dx of [-2.2, 2.2]) c.box(56 + dx, G + 27.53, 72, .6, .035, 7, cream);
    c.box(56, G + 27.53, 72, 3.8, .035, .6, cream);
  });
  entry(c, 56, 51, 18, '#af6558');
  entrancePath(c, [[56, 16], [56, 57.25]], 8, p.path, [56, 72], [56, 57.25]);
  gardenEdge(c, p, [30, 82], [26, 93]);
  for (const x of [34, 78]) c.prop('bench', x, 32);
}
function observatory(c, { variant: v, palette: p }) {
  c.structure(56, 66, () => {
    disk(c, 56, 66, 43, 43, G + 1, 2, p.stone);
    disk(c, 56, 66, 36, 36, G + 8, 14, '#d8ccb0');
    disk(c, 56, 66, 38, 38, G + 15.2, 1, cream);
    c.item('public-dome', dome, c.materials.solid, [56, G + 15.7, -66], [19, 16, 19], [copper, '#7a91a7', '#a7775e'][v]);
    // Raised rails finish both edges of the telescope slot, including its crown.
    for (const side of [-1, 1]) {
      const phi = Math.PI / 2 + side * .16;
      c.item('observatory-slot-rail', slotRail, c.materials.solid, [56, G + 15.8, -66], [1, 1, 1], '#d6c8a6', phi - Math.PI);
    }
    round(c, 56, G + 24.8, 64, 2.8, 13, 2.8, '#698b8a');
    round(c, 56, G + 28, 56, 4.3, 4.3, 25, '#d9d3bc', 'z');
    round(c, 56, G + 28, 43.5, 5.1, 5.1, 1.1, '#799b98', 'z');
    round(c, 56, G + 28, 42.85, 4.2, 4.2, .2, '#314c65', 'z', 'glass');
    c.solid(56, 66, 43, 43);
    for (const angle of [-Math.PI / 6, 0, Math.PI / 6]) {
      c.box(56 + Math.sin(angle) * 18.15, G + 7, 66 - Math.cos(angle) * 18.15, 3, 6, .25, dark, 'glass', angle);
    }
    sign(c, 'PLANETARIUM', 56, 47.8, 12);
    frontDoor(c, 56, 48, 2);
    for (let i = 0; i < 5; i++) c.box(56, G + (i + 1) * .2, 40.9 + i, 7, (i + 1) * .4, 1, p.stone);
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
  c.structure(47, 73, () => {
    c.box(47, G + 8.2, 54.7, 42, 4.4, .5, '#283e57');
    for (const y of [6, 10.4]) c.box(47, G + y, 54.35, 42, .17, .2, '#dc9dc7', 'lit');
    sign(c, 'BLUE NOTE', 47, 54.25, 8.2);
    for (let i = 0; i < 15; i++) {
      c.box(27 + i * 2.8, G + 14.8, 54.5, 2.5, 2.4, .6, cream);
      if (i % 7 !== 2 && i % 7 !== 6) c.box(28.2 + i * 2.8, G + 15.6, 54.1, 1, 1.2, .35, dark);
    }
    c.box(47, G + 4.5, 51.5, 27, .6, 6, '#476584');
  });
  entrancePath(c, [[56, 16], [56, 45], [47, 45], [47, 54.25]], 6, p.path, [47, 73], [47, 54.25]);
  for (const [x, s] of [[31, 28], [76, 27], [79, 48]]) cafeTable(c, x, s, '#aa7899');
  c.structure(84, 73, () => {
    c.box(84, G + .5, 73, 13, 1, 18, '#a08671'); c.solid(84, 73, 13, 18);
    c.box(89, G + 4, 73, .8, 6, 18, '#577584');
    for (const s of [67, 79]) c.box(87.5, G + 2.3, s, 2, 3.5, 2, dark);
  });
  gardenEdge(c, p, [23, 89], [41, 94]);
  if (v === 1) pergola(c, 38, 43, 18, 7);
}
function sports(c, { variant: v, palette: p }) {
  hall(c, 56, 85, 60, 17, 7, '#b98c6f', 1);
  c.structure(56, 85, () => { sign(c, 'ATHLETIC CLUB', 56, 76.3, 5.1); });
  c.rigid(56, 48, () => {
    const tennis = v !== 1, w = 46, d = 40;
    c.box(56, G + .06, 48, w + 8, .12, d + 6, '#c08b6f');
    c.box(56, G + .14, 48, w, .04, d, tennis ? '#6c9c8b' : '#779ea8');
    for (const dx of [-w / 2 + 2, w / 2 - 2]) c.box(56 + dx, G + .175, 48, .18, .02, d - 4, cream);
    for (const ds of [-d / 2 + 2, 0, d / 2 - 2]) c.box(56, G + .175, 48 + ds, w - 4.18, .02, .18, cream);
    if (tennis) {
      for (const dx of [-16, 0, 16]) for (const ds of [-9, 9]) c.box(56 + dx, G + .175, 48 + ds, .15, .02, 17.82, cream);
      c.box(56, G + 1.1, 48, 44, 1.8, .12, '#c1c9b8');
      c.solid(56, 48, 44, .15);
      for (const x of [34, 78]) { c.box(x, G + 1.2, 48, .2, 2.4, .2, dark); c.post(x, 48, .2); }
    } else for (const s of [31, 65]) {
      const inward = s === 31 ? 1 : -1;
      c.box(56, G + 2.8, s, .25, 5.6, .25, dark); c.post(56, s, .2);
      c.box(56, G + 5.3, s + inward * .23, 4, 2.5, .2, cream);
      c.item('detail-hoop', hoop, c.materials.solid, [56, G + 4.5, -(s + inward * 1.2)], [1, 1, 1], '#c9704a');
      c.box(56, G + 4.5, s + inward * .4, .22, .13, .3, '#c9704a');
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
  c.structure(52, 68, () => {
    for (const x of [35, 52, 69]) {
      c.box(x, G + 3.6, 47.7, 12.4, 7.2, .5, cream);
      c.box(x, G + 3.5, 47.3, 10.8, 6.5, .3, '#a94238');
      c.box(x, G + 5.4, 47.08, 8.7, 1.3, .12, '#8cb9b5', 'glass');
      if (!c.distant) for (const y of [1, 2.2, 3.4]) c.box(x, G + y, 47.1, 10, .09, .1, '#d27b62');
    }
    sign(c, 'FIRE STATION', 52, 47.02, 9);
    for (let i = 0; i < 4; i++) c.box(83, G + 31 + v * 3 + i, 77, 14 - i * 2.5, 1.2, 24 - i * 4, '#5c7f7a');
  });
  // One shared engine mesh, with the same faceted tires and glazing as traffic.
  c.rigid(38, 33, () => {
    c.item('detail-fire-engine', fireEngine, c.materials.props, [38, G, -33], [1, 1, 1], '#ffffff', Math.PI);
    c.solid(38, 33, 5.7, 12);
  });
  entrancePath(c, [[52, 16], [52, 47.1]], 12, p.path, [52, 68], [52, 47.1]);
  gardenEdge(c, p, [22, 90], [29, 92]);
  pool(c, 76, 28, 13, 10, p.stone);
}

function postalVan(c, x, s, color) {
  c.rigid(x, s, () => {
    const scale = [2.2, 1.65, 2.35];
    c.item('postal-paint', parkedCars.van.paint, c.materials.solid, [x, G, -s], scale, color, Math.PI);
    c.item('postal-trim', parkedCars.van.trim, c.materials.props, [x, G, -s], scale, '#ffffff', Math.PI);
    for (const side of [-1, 1]) c.box(x + side * 2.32, G + 1.9, s + 1, .08, .55, 3.2, cream);
    c.solid(x, s, 5.2, 12);
  });
}
function postoffice(c, { variant: v, palette: p }) {
  const brick = ['#b77c61', '#bf9d7b', '#ad8070'][v], postal = ['#557f80', '#a75949', '#4f738b'][v];
  hall(c, 56, 70, 58, 38, 16, brick, 2);
  c.structure(56, 70, () => {
    sawtoothRoof(c, { x: 56, s: 72, width: 54, depth: 30, wall: brick, roof: '#71938c' }, G + 16.3);
    for (const x of [28, 43, 69, 84]) c.box(x, G + 8, 50.65, .9, 16, .65, cream);
    c.box(56, G + 12.8, 50.3, 24, 4.5, .8, postal);
    sign(c, 'POST OFFICE', 56, 49.86, 12.8);
    // The envelope crest is readable even when lettering disappears at distance.
    c.box(56, G + 19, 53, 15, 7, 6, brick);
    c.box(56, G + 22.7, 53, 16, .7, 7, cream);
    c.box(56, G + 19, 49.9, 8.4, 4.4, .3, cream);
    c.item('postal-envelope-fold', envelopeFold, c.materials.solid, [56, G + 19.5, -49.68], [1, 1, 1], postal);
    c.box(56, G + 5.25, 48.5, 15, .6, 5, postal);
    if (!c.distant) for (const x of [48.5, 63.5]) {
      c.box(x, G + 3.1, 50.1, .7, 1.4, .4, '#f1d9a0', 'lit');
      c.box(x, G + 3.9, 50.1, 1, .2, .7, dark);
    }
  });
  entrancePath(c, [[56, 16], [56, 50.25]], 8, p.path, [56, 70], [56, 50.25]);
  path(c, [[16, 43], [96, 43]], 4, p.path);
  for (const x of v === 1 ? [32] : [32, 80]) postalVan(c, x, 30, postal);
  if (v === 1) { pergola(c, 80, 29, 12, 15); c.prop('bench', 80, 29); }
  for (const x of [45, 67]) c.rigid(x, 24, () => {
    c.box(x, G + 1.1, 24, .45, 2.2, .45, dark);
    c.box(x, G + 2.3, 24, 2.3, 2.1, 1.5, postal);
    c.box(x, G + 3.43, 24, 2.6, .25, 1.8, cream);
    c.box(x, G + 2.6, 23.21, 1.6, .17, .08, dark); c.post(x, 24, 1.2);
  });
  gardenEdge(c, p, [22, 90], [55, 88]);
  for (const x of [24, 88]) c.prop('bench', x, 39);
}
function bathhouse(c, { variant: v, palette: p }) {
  const tile = ['#5a9997', '#65918a', '#618ca6'][v], terracotta = ['#be8066', '#cfab87', '#b57b69'][v];
  // Three closed vaults, with inset glazed end panels and cream ribs.
  hall(c, 56, 79, 62, 22, 10, '#dcccb0', 1);
  c.structure(56, 79, () => {
    for (const x of [35, 56, 77]) {
      barrel(c, x, 79, 20, 24, 11.3, terracotta);
      for (const side of [-1, 1]) {
        c.item('venue-vault-end', vaultEnd, c.materials.solid, [x, G + 11.3, -(79 + side * 11)], [10, 5.5, 1], cream, side === 1 ? Math.PI : 0);
        c.item('venue-vault-end', vaultEnd, c.materials.glass, [x, G + 11.45, -(79 + side * 11.08)], [7.8, 4, 1], tile, side === 1 ? Math.PI : 0);
        for (const dx of [-4, 0, 4]) c.box(x + dx, G + 12.9, 79 + side * 11.15, .17, 3, .15, cream);
      }
      // High, opaque skylight caps use the existing shared glass material.
      c.box(x, G + 16.9, 79, 3.5, .5, 10, '#9bc5bf', 'glass');
    }
    for (const x of [26, 42, 70, 86]) {
      c.box(x, G + 3.3, 64.5, .7, 6.6, .7, cream); c.post(x, 64.5, .4);
    }
    c.box(56, G + 6.7, 65, 62, .6, 5.5, tile);
    sign(c, 'MOSAIC BATHS', 56, 62.2, 6.7);
    for (const x of [27, 39, 73, 85]) {
      c.box(x, G + 1.2, 67.8, 2, 2.4, .3, tile);
      if (!c.distant) for (const y of [.5, 1.3, 2.1]) c.box(x, G + y, 67.59, 1, .35, .12, cream);
    }
  });
  entrancePath(c, [[56, 16], [56, 67.25]], 8, p.path, [56, 79], [56, 67.25]);
  path(c, [[16, 60], [96, 60]], 4, p.path);
  for (const x of [34, 78]) {
    const w = v === 2 ? 24 : 22, d = v === 2 ? 24 : 29;
    pool(c, x, 39, w, d, cream, v === 1);
    c.rigid(x, 39, () => {
      c.item('public-basin-rim', basinRim, c.materials.solid, [x, G + .11, -39], [w / 2 + .65, .12, d / 2 + .65], tile);
      const edge = 39 - d / 2;
      // Low entry rails and underwater rungs distinguish baths from fountains.
      for (const dx of [-1.1, 1.1]) {
        for (const ds of [-1.1, 1.8]) c.box(x + dx, G + .845, edge + ds, .13, 1.58, .13, '#b7c9be');
        c.box(x + dx, G + 1.7, edge + .35, .13, .13, 3.1, '#b7c9be');
      }
      for (const y of [.3, .65, 1]) c.box(x, G + y, edge + 1.8, 2.2, .13, .35, '#b7c9be');
      c.solid(x, edge + .35, 2.5, 3.1);
    });
    // A narrow tiled surround is punctuated by diamond inlays, away from walks.
    if (!c.distant) for (const dx of [-7, 0, 7]) c.box(x + dx, G + .07, 21, .85, .05, .85, tile, 'solid', Math.PI / 4);
    for (const s of [30, 45]) c.prop('bench', x === 34 ? 19.5 : 92.5, s, x === 34 ? Math.PI / 2 : -Math.PI / 2);
  }
  gardenEdge(c, p, [23, 89], [92]);
  for (const x of [35, 77]) bed(c, x, 93, 12, 4, v === 1 ? p.flower : p.green, p.stone);
}
function farmStall(c, x, s, accent, flowers = false) {
  reserve(c, rectanglePolygon(x, s, 14, 11));
  c.structure(x, s, () => {
    // A taut striped gable, open on all sides, over a timber display counter.
    // Roof strips run front-to-back so the stripes stay readable from above.
    const pitch = .28, run = 6.5;
    for (const side of [-1, 1]) for (let stripe = 0; stripe < 4; stripe++) {
      const r = (stripe + .5) * run / 4;
      c.box(x + side * r, G + 5.1 + (run - r) * Math.tan(pitch), s,
        run / 4 / Math.cos(pitch), .16, 9.5, stripe % 2 ? cream : accent, 'solid', 0, -side * pitch);
    }
    c.box(x, G + 7.02, s, .24, .18, 9.7, cream);
    for (const dx of [-5.5, 5.5]) {
      c.box(x + dx, G + 5.1, s, .24, .28, 9.7, '#8e7859');
      for (const ds of [-3.7, 3.7]) {
        c.box(x + dx, G + 2.55, s + ds, .24, 5.1, .24, '#8e7859'); c.post(x + dx, s + ds, .2);
      }
    }
    c.box(x, G + .9, s - 2, 10, 1.8, 3.4, '#a98c64');
    c.box(x, G + 1.9, s - 2, 10.5, .2, 3.8, '#d3b58a'); c.solid(x, s - 2, 10.5, 3.8);
    for (const dx of [-3.3, 0, 3.3]) {
      c.box(x + dx, G + 2.15, s - 2, 2.7, .4, 2.7, '#735d46');
      c.box(x + dx, G + 2.4, s - 2, 2.3, .2, 2.3, flowers ? '#738957' : dx === 0 ? '#d9aa58' : dx < 0 ? '#bd7756' : '#8caa66');
      if (!c.distant) {
        if (flowers) for (const ds of [-.6, .6]) {
          c.box(x + dx, G + 2.85, s - 2 + ds, .1, .9, .1, '#728359');
          c.box(x + dx, G + 3.3, s - 2 + ds, .8, .35, .8, dx === 0 ? '#dcb977' : '#c68caa');
        } else for (const a of [-.65, .65]) for (const b of [-.65, .65]) {
          c.item('market-produce', produce, c.materials.solid, [x + dx + a, G + 2.65, -(s - 2 + b)], [.35, .3, .35], dx === 0 ? '#e5b65c' : dx < 0 ? '#c26b4d' : '#92b36d');
        }
      }
    }
    if (!c.distant) {
      c.box(x, G + 3.1, s - 3.95, 2, 1.2, .18, cream);
      c.box(x, G + 3.1, s - 4.06, 1.65, .9, .08, '#425c55');
      for (const dx of [-4, 4]) {
        c.box(x + dx, G + .65, s + 2, 2, 1.3, 2, '#b99b70');
        c.box(x + dx, G + .8, s + 2, 2.1, .12, 2.1, '#786f58'); c.solid(x + dx, s + 2, 2.1, 2.1);
      }
    }
  });
}
function farmersmarket(c, { variant: v, palette: p }) {
  // A small bakery anchors one edge; the rest is an open-air neighborhood fair.
  hall(c, 36, 74, 26, 27, 9, ['#c89974', '#c4a282', '#b88368'][v], 1);
  c.structure(36, 74, () => {
    pitchedRoof(c, 36, 74, 29, 30, G + 9.8, '#739184', '#c89974', .43, { wallWidth: 26, wallDepth: 27 });
    c.box(28, G + 14, 81, 3, 8, 3, '#aa765f');
    c.box(28, G + 18.2, 81, 3.8, .5, 3.8, cream);
    c.box(36, G + 6.6, 60.2, 23, 2.1, .5, dark);
    sign(c, 'BAKERY', 36, 59.9, 6.6);
    for (let i = 0; i < 8; i++) c.box(25.5 + i * 3, G + 4.8, 58.3, 3, .25, 4.5, i % 2 ? cream : p.accent);
  });
  path(c, [[56, 16], [56, 96]], 6, p.path);
  path(c, [[16, 43], [96, 43]], 5, p.path);
  path(c, [[56, 71], [96, 71]], 4, p.path);
  entrancePath(c, [[36, 43], [36, 59.75]], 5, p.path, [36, 74], [36, 59.75]);
  const stalls = v === 1 ? [[70, 58], [86, 58]] : v === 2 ? [[70, 58], [86, 58], [70, 84]] : [[70, 58], [86, 58], [70, 84], [86, 84]];
  for (const [i, [x, s]] of stalls.entries()) farmStall(c, x, s, i % 2 ? '#c89762' : '#769777', v === 1 || (v === 2 && i === 2));
  if (v === 1) {
    pergola(c, 78, 85, 25, 12, '#bda27e');
    for (const x of [72, 84]) c.prop('bench', x, 85);
  } else if (v === 2) c.rigid(87, 84, () => {
    // A flower cart finishes the smaller harvest layout.
    c.box(87, G + 1.1, 84, 4, 1.3, 6, '#b89a70'); c.solid(87, 84, 4.6, 6);
    wheels(c, 87, G + .6, 84, 4.2, 4, 1.2, .4);
    for (const s of [82.5, 85.5]) {
      c.box(87, G + 2.1, s, 2.8, 1, 2, '#82935d');
      c.box(87, G + 2.7, s, 2.9, .3, 2.1, p.flower);
    }
  });
  c.structure(56, 21, () => {
    for (const x of [50, 62]) { c.box(x, G + 2.9, 21, .45, 5.8, .45, '#887154'); c.post(x, 21, .3); }
    c.box(56, G + 5.6, 21, 15, 2.1, .5, '#526e5b');
    c.box(56, G + 6.75, 21, 15.5, .25, .8, cream);
    sign(c, 'FARMERS MARKET', 56, 20.72, 5.6);
  });
  for (const [x, s] of [[29, 28], [80, 29]]) cafeTable(c, x, s, p.accent);
  gardenEdge(c, p, [22, 92], [49]);
  for (const x of [27, 43]) { bed(c, x, 94, 10, 3, p.green, p.stone); }
  for (const x of [41, 68]) bed(c, x, 31, 5, 10, p.flower, p.stone);
}

function donut(c, { variant: v, palette: p }) {
  const icing = ['#d98faa', '#805344', '#d4ab71'][v], trim = ['#649d99', '#8ca797', '#789aa4'][v];
  reserve(c, rectanglePolygon(56, 68, 45, 33));
  c.structure(56, 68, () => {
    c.box(56, G + 4.5, 68, 42, 9, 30, '#e9d8b5');
    c.box(56, G + .65, 68, 42.4, 1.3, 30.4, trim);
    roof(c, 56, 68, 43, 31, 9.4, trim);
    c.solid(56, 68, 43, 31);
    for (const x of [44, 68]) {
      c.box(x, G + 3.3, 52.86, 11.5, 4.4, .2, '#557f83', 'glass');
      for (const dx of [-5.85, 0, 5.85]) c.box(x + dx, G + 3.3, 52.7, .18, 4.7, .18, cream);
      for (const y of [1, 5.6]) c.box(x, G + y, 52.7, 12, .2, .3, cream);
      c.box(x, G + 1.4, 52.52, 11.5, .22, .55, '#d5bd93');
      if (!c.distant) for (let i = 0; i < 5; i++) {
        // Warm pastry-box displays sit against the glass, below eye level.
        c.box(x - 4.4 + i * 2.2, G + 1.75, 52.53, 1.5, .45, .45, i % 2 ? '#d6a873' : '#e8c7b1');
      }
    }
    for (const side of [-1, 1]) for (const s of [61, 74]) {
      c.box(56 + side * 21.12, G + 3.3, s, .18, 4.4, 9, '#557f83', 'glass');
      c.box(56 + side * 21.25, G + 1, s, .32, .22, 9.4, cream);
      c.box(56 + side * 21.25, G + 3.3, s, .18, 4.5, .18, cream);
    }
    for (const x of [42, 70]) c.box(x, G + 4, 83.12, 7, 3, .18, '#557f83', 'glass');
    frontDoor(c, 56, 53, 0, 5.2);
    c.box(56, G + 7.25, 52.65, 38, 2.5, .6, trim);
    sign(c, 'LUCKY DONUT', 56, 52.29, 7.25);
    for (const y of [5.95, 8.55]) c.box(56, G + y, 52.25, 38.5, .13, .18, '#f1c1b8', 'lit');
    // A broad cantilever with a lit underside shelters the whole shopfront.
    c.box(56, G + 5.65, 49.5, 43, .42, 7, cream);
    c.box(56, G + 5.54, 45.925, 43, .35, .15, icing);
    for (const x of [42, 56, 70]) c.box(x, G + 5.42, 49.3, 3, .06, 1, '#f4dda9', 'lit');
    // The 24.6 m donut faces the street, with a real hole and visible supports.
    c.box(56, G + 10.45, 70, 16, .6, 5, '#b9b29c');
    for (const x of [51, 61]) {
      c.box(x, G + 12.7, 70, .7, 4.5, .8, '#71857e');
      c.box(x, G + 11.7, 72, .45, 4, .45, '#71857e', 'solid', Math.PI / 2, -.48);
    }
    c.item('donut-dough', donutDough, c.materials.solid, [56, G + 25, -70], [1, 1, 1], '#cf9c60');
    c.item('donut-glaze', donutGlaze, c.materials.solid, [56, G + 25, -70], [1, 1, 1], icing);
    if (!c.distant) for (let i = 0; i < 28; i++) {
      const q = sprinklePosition(i), colors = ['#f3d887', '#a6cbc1', '#eeccc3', '#f0e3bd', '#9b738a'];
      c.box(56 + q.x, G + 25 + q.y, 70 - q.z, 1.05, .26, .22, colors[(i + v) % colors.length], 'solid', 0, q.roll);
    }
    c.box(71, G + 10.6, 77, 5, 1.7, 4, '#a4b3a6');
    if (!c.distant) for (const x of [69.5, 71, 72.5]) c.box(x, G + 11.5, 77, .25, .15, 3.5, '#6e827c');
  });
  // A looping coffee terrace replaces the usual axial cross. Its two round
  // seating pads join the curved walks, while the last leg meets the real sill.
  const arrival = curvedPath([[56, 16], [51, 23], [50, 32], [56, 43], [56, 48]], 4);
  entrancePath(c, [...arrival, [56, 52.25]], 7, p.path, [56, 68], [56, 52.25]);
  path(c, curvedPath([[16, 32], [24, 37], [38, 39], [50, 32]], 4), 3.5, p.path);
  path(c, curvedPath([[56, 43], [69, 42], [83, 40], [96, 32]], 4), 3.5, p.path);
  for (const [x, s] of v === 1 ? [[33, 30], [79, 32], [86, 65]] : [[33, 30], [79, 32]]) {
    // Flexible paving follows the ground; furnishings keep their rigid shape.
    c.polygon(ellipsePoints(x, s, 17, 17), G + .065, .045, p.path);
    c.polygon(ellipsePoints(x, s, 15.6, 15.6), G + .09, .035, '#e7d5b6');
    cafeTable(c, x, s, v === 2 ? '#c4a574' : icing);
    if (!c.distant) for (let i = 0; i < 12; i++) {
      const angle = i / 12 * Math.PI * 2;
      c.surface(x + Math.cos(angle) * 7.1, G + .12, s + Math.sin(angle) * 7.1, .65, .02, .65, trim, 'solid', Math.PI / 4);
    }
  }
  gardenEdge(c, p, [23, 89], [49, 88]);
  for (const x of [40, 72]) bed(c, x, 92, 15, 5, v === 0 ? p.flower : p.green, p.stone);
  // A freestanding menu sits beside the entrance without blocking it.
  c.rigid(65, 48, () => {
    c.box(65, G + 1.3, 48, 2.2, 2.6, .3, '#b89a72');
    c.box(65, G + 1.5, 47.8, 1.8, 1.9, .12, dark);
    if (!c.distant) for (const y of [1, 1.5, 2]) c.box(65, G + y, 47.7, 1.1, .1, .08, cream);
    c.solid(65, 48, 2.2, .8);
  });
}

function cityhall(c, { palette: p }) {
  const limestone = '#d7c6a7', bronze = '#577e77';
  reserve(c, rectanglePolygon(56, 71, 65, 37));
  reserve(c, rectanglePolygon(56, 49.75, 53, 14.5));
  c.structure(56, 71, () => {
    // A raised limestone hall, with finished facades on all four sides.
    c.box(56, G + .75, 71, 64, 1.5, 36, '#b9ab90');
    c.box(56, G + 10.25, 71, 62, 17.5, 34, limestone);
    c.solid(56, 71, 64, 36);
    for (const y of [2, 10, 18.8]) c.box(56, G + y, 71, 63, .5, 35, cream);
    for (const side of [-1, 1]) {
      for (const x of [31, 40, 49, 63, 72, 81]) for (const y of [5.8, 14]) {
        c.box(x, G + y, 71 + side * 17.12, 3.5, 5, .2, dark, 'glass');
        c.box(x, G + y - 2.65, 71 + side * 17.28, 4.2, .3, .5, cream);
        if (!c.distant) c.box(x, G + y, 71 + side * 17.26, .14, 5, .15, cream);
      }
      for (const s of [60, 71, 82]) for (const y of [5.8, 14]) {
        c.box(56 + side * 31.12, G + y, s, .2, 5, 3.5, dark, 'glass');
        c.box(56 + side * 31.28, G + y - 2.65, s, .5, .3, 4.2, cream);
      }
      for (const x of [25.5, 86.5]) c.box(x, G + 10, 71 + side * 16.9, 1.2, 18, .7, cream);
    }
    mansardRoof(c, 56, 71, 65, 37, G + 19.1, 5.5, bronze);
    c.box(56, G + 24.7, 71, 45.5, .35, 25.9, bronze);
    // Six low risers lead continuously onto the portico landing.
    for (let i = 0; i < 6; i++) {
      const front = 42.5 + i * .6, back = 56;
      c.box(56, G + (i + 1) * .125, (front + back) / 2, 52 - i * .7, (i + 1) * .25, back - front, cream);
    }
    c.solid(56, 49.25, 52, 13.5);
    frontDoor(c, 56, 54, 1.5, 6.6);
    for (const x of [35, 43, 49, 63, 69, 77]) {
      c.box(x, G + 1.8, 50, 2.1, .6, 2.1, limestone);
      disk(c, x, 50, 1.35, 1.35, G + 7.65, 11.1, cream);
      c.box(x, G + 13.4, 50, 2.2, .5, 2.2, limestone);
    }
    c.box(56, G + 14.1, 51.5, 49, 1, 12, cream);
    sign(c, 'CITY HALL', 56, 45.44, 14.1);
    pitchedRoof(c, 56, 51.5, 51, 13.5, G + 14.65, bronze, cream, .22, { wallWidth: 49, wallDepth: 12 });
    // A small civic medallion in the triangular pediment.
    c.box(56, G + 17.3, 45.35, 2, 2, .3, '#b69a64', 'solid', 0, Math.PI / 4);
    // Copper clocktower, open belfry and a compact hipped crown.
    c.box(56, G + 26, 72, 15, 13, 14, limestone);
    for (const y of [25, 32.5]) c.box(56, G + y, 72, 16.5, .6, 15.5, cream);
    for (let side = 0; side < 4; side++) {
      const a = side * Math.PI / 2, dx = Math.sin(a), ds = -Math.cos(a), r = side % 2 ? 7.65 : 7.15;
      clock(c, 56 + dx * (r + .1), G + 29, 72 + ds * (r + .1), 5.2, a);
    }
    for (const dx of [-5, 5]) for (const ds of [-4.5, 4.5]) c.box(56 + dx, G + 35, 72 + ds, .9, 4.5, .9, cream);
    c.item('detail-bell', bell, c.materials.props, [56, G + 35.3, -72], [2.2, 2.6, 2.2]);
    c.box(56, G + 37.4, 72, 14, .6, 13, cream);
    mansardRoof(c, 56, 72, 15, 14, G + 37.7, 3.3, bronze);
    c.box(56, G + 41.1, 72, 10.5, .3, 9.8, bronze);
    c.box(56, G + 43, 72, .3, 3.8, .3, '#c6ad73');
  });
  entrancePath(c, [[56, 16], [56, 42.5]], 10, p.path, [56, 71], [56, 42.5]);
  for (const side of [-1, 1]) {
    const x = 56 + side * 21;
    entrancePath(c, curvedPath([[side < 0 ? 16 : 96, 35], [56 + side * 30, 39], [x, 42.5]]), 4, p.path, [56, 71], [x, 42.5]);
    bed(c, 56 + side * 21, 26, 15, 11, p.flower, cream);
    c.prop('bench', 56 + side * 20, 35);
    c.rigid(56 + side * 33, 28, () => {
      const x = 56 + side * 33;
      disk(c, x, 28, 3, 3, G + .3, .6, limestone);
      c.box(x, G + 7, 28, .2, 14, .2, '#9ea99b'); c.post(x, 28, .5);
      c.box(x + 1.5, G + 12.3, 28, 3, 2, .12, side < 0 ? bronze : '#b98b68');
      c.box(x + 3.1, G + 12.15, 28.3, 1.5, 1.7, .12, side < 0 ? '#7e9e8e' : '#d2af80', 'solid', -.35);
    });
  }
  gardenEdge(c, p, [21, 91], [62, 91]);
}

export const DESTINATION_BUILDERS = { cinema, hotel, museum, station, library, hospital, observatory, music, sports, firehouse, postoffice, bathhouse, farmersmarket, donut, cityhall };
