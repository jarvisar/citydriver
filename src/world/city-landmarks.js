import { CITY_PLACES } from './city-places.js';
import { PAVEMENT_LEVEL as G } from './city-grid.js';

// All landmark pieces join the city's existing instance batches. The same
// silhouette is used at both detail levels; only small furnishings disappear.
export function pitchedRoof(c, x, s, width, depth, y, color, gable = null) {
  const pitch = .36, half = width / 4;
  for (const side of [-1, 1]) c.box(x + side * half, y, s, width / 2 / Math.cos(pitch), .5, depth, color, 'solid', 0, -side * pitch);
  if (gable) {
    const rise = width / 2 * Math.tan(pitch), step = rise / 12;
    for (const side of [-1, 1]) for (let i = 0; i < 12; i++) c.box(x, y - rise / 2 + step * (i + .5) - .2, s + side * (depth / 2 - .6), width * (1 - (i + .5) / 12), step, .35, gable);
  }
}
function planter(c, x, s, w, d, color = '#7a9a68') {
  c.box(x, G + .28, s, w, .56, d, '#c5bba5');
  c.box(x, G + .6, s, w - .6, .18, d - .6, color);
  c.solid(x, s, w, d);
}
function table(c, x, s, color) {
  c.box(x, G + 1, s, 2.2, .18, 2.2, '#ead6ac');
  c.box(x, G + .5, s, .25, 1, .25, '#566568');
  c.box(x, G + 3.1, s, 4.5, .18, 4.5, color);
  c.box(x, G + 1.7, s, .12, 3.4, .12, '#e5dfc9');
  for (const side of [-1, 1]) c.prop('bench', x + side * 2.4, s, side * Math.PI / 2);
  c.post(x, s, 1.4);
}
function clockSquare(c) {
  for (const s of [32, 80]) {
    c.box(56, G + .25, s, 30, .5, 12, '#d2c6ad');
    c.box(56, G + .53, s, 28.5, .08, 10.5, '#639ca5', 'glass');
    c.solid(56, s, 30, 12);
    for (const x of [48, 56, 64]) {
      c.box(x, G + 1.1, s, .22, 1.2, .22, '#b8e3dc', 'glass');
      c.box(x, G + 1.7, s, 1.3, .14, 1.3, '#d4e4d6', 'glass');
    }
  }
  c.box(56, G + .5, 56, 19, 1, 19, '#b2a389');
  c.box(56, G + 1.3, 56, 15, .6, 15, '#e2cfab');
  c.box(56, G + 17, 56, 10, 32, 10, '#ba9071');
  c.box(56, G + 32, 56, 13, 1, 13, '#eddbb4');
  c.box(56, G + 36, 56, 12, 7, 12, '#637e79');
  c.box(56, G + 40, 56, 15, 1, 15, '#b9ccad');
  pitchedRoof(c, 56, 56, 16, 16, G + 42, '#537b76', '#637e79');
  c.box(56, G + 47, 56, .32, 8, .32, '#dfc384');
  c.solid(56, 56, 19, 19);
  for (let side = 0; side < 4; side++) {
    const yaw = side * Math.PI / 2, dx = Math.sin(yaw), ds = -Math.cos(yaw);
    c.box(56 + dx * 5.1, G + 17, 56 + ds * 5.1, 2.2, 24, .16, '#6b7770', 'glass', yaw);
    c.box(56 + dx * 6.1, G + 36, 56 + ds * 6.1, 4.8, 4.8, .15, '#f5e9bf', 'lit', yaw);
    c.box(56 + dx * 6.22, G + 36.8, 56 + ds * 6.22, .18, 1.8, .1, '#354e55', 'solid', yaw);
    c.box(56 + dx * 6.25 + Math.cos(yaw) * .7, G + 36, 56 + ds * 6.25 + Math.sin(yaw) * .7, 1.5, .18, .1, '#354e55', 'solid', yaw);
  }
  for (const x of [25, 87]) for (const s of [28, 56, 84]) { planter(c, x, s, 8, 8); c.tree(x, s, 8); }
}
function market(c) {
  c.box(56, G + 5, 73, 61, 10, 27, '#b77155');
  c.box(56, G + 1.6, 73, 62, 3.2, 28, '#e5c398');
  pitchedRoof(c, 56, 73, 66, 32, G + 15, '#a34f43', '#b77155');
  c.solid(56, 73, 62, 28);
  for (const s of [59.3, 86.7]) for (let x = 32; x <= 80; x += 8) {
    c.box(x, G + 5.4, s, 5.5, 7, .2, '#355c60', 'glass');
    c.box(x, G + 9.4, s, 6.5, .5, .5, '#e7c89b');
  }
  for (const x of [25.4, 86.6]) c.box(x, G + 6, 73, .2, 6, 19, '#355c60', 'glass');
  for (const x of [30, 47, 65, 82]) for (const s of [29, 46]) {
    const color = (x + s) % 3 ? '#d77958' : '#558f87';
    c.box(x, G + 1, s, 9, 2, 4, '#8d7157');
    for (let stripe = 0; stripe < 6; stripe++) c.box(x - 4.6 + stripe * 1.85, G + 4.3, s, 1.85, .25, 7, stripe % 2 ? '#f2dfb8' : color);
    for (const side of [-1, 1]) c.box(x + side * 4.5, G + 2.2, s, .18, 4.4, .18, '#e5d4b6');
    c.solid(x, s, 9, 4);
    if (!c.distant) for (const offset of [-3, 0, 3]) c.box(x + offset, G + 2.2, s, 2, .5, 2.5, offset ? '#e5aa53' : '#83a163');
  }
  for (const x of [20, 92]) { c.tree(x, 91, 8); table(c, x, 51, '#b15c49'); }
  // Strings of lanterns run over the market's pedestrian aisles.
  for (const s of [37, 53]) {
    c.box(56, G + 6.5, s, 70, .06, .06, '#53656a');
    for (let x = 23; x <= 90; x += 7) c.box(x, G + 6.1, s, .65, .8, .65, '#ffe0a2', 'lit');
  }
}
function garden(c) {
  for (const x of [29, 83]) for (const s of [28, 50, 80]) {
    planter(c, x, s, 17, 13);
    c.tree(x, s, 8.5);
    if (!c.distant) for (const offset of [-5, 5]) c.box(x + offset, G + .85, s, 3, .4, 8, s === 50 ? '#caa0b4' : '#d9bd6b');
  }
  c.box(56, G + .5, 64, 30, 1, 53, '#d5ccb2');
  c.box(56, G + 6.4, 64, 27, 11, 50, '#78aaa9', 'glass');
  pitchedRoof(c, 56, 64, 29, 53, G + 13.7, '#91c5bf', '#78aaa9');
  c.solid(56, 64, 30, 53);
  for (const x of [42.2, 69.8]) for (let s = 40; s <= 88; s += 6) c.box(x, G + 6.8, s, .28, 12.5, .28, '#e3debd');
  for (const s of [38.8, 89.2]) for (let x = 44; x <= 68; x += 6) c.box(x, G + 6.8, s, .28, 12.5, .28, '#e3debd');
  for (const y of [2, 7, 12]) {
    for (const x of [42.1, 69.9]) c.box(x, G + y, 64, .3, .25, 51, '#e3debd');
    for (const s of [38.7, 89.3]) c.box(56, G + y, s, 28, .25, .3, '#e3debd');
  }
  for (let s = 38; s <= 90; s += 6.5) pitchedRoof(c, 56, s, 30, .3, G + 14, '#d8d9b9');
  c.box(56, G + .1, 25, 11, .2, 15, '#d7cfb4');
  for (const x of [47, 65]) c.prop('bench', x, 23);
}
function depot(c) {
  for (const x of [32, 56, 80]) {
    c.box(x, G + 4.3, 77, 22, 8.6, 30, '#9e6854');
    pitchedRoof(c, x, 77, 24, 34, G + 10.5, '#526a70', '#9e6854');
    c.box(x, G + 3.4, 61.9, 12, 6.8, .22, '#35474c', 'glass');
    c.box(x, G + 6.3, 92.1, 13, 2.4, .2, '#819c9c', 'glass');
    c.solid(x, 77, 22, 30);
    c.box(x, G + .025, 42, 6, .05, 40, '#928c7c');
    for (const dx of [-1.25, 1.25]) c.box(x + dx, G + .09, 42, .12, .12, 40, '#bcc5c1');
    if (!c.distant) for (let s = 23; s < 62; s += 2.8) c.box(x, G + .06, s, 4, .08, .36, '#6b6d60');
    const s = x === 56 ? 48 : 36;
    c.box(x, G + 1.35, s, 4.2, 1.8, 13.5, '#b95543');
    c.box(x, G + 2.9, s, 4, 1.5, 13, '#efd8a3');
    c.box(x, G + 3.85, s, 4.5, .4, 14, '#56696a');
    for (const dx of [-2.03, 2.03]) for (let ds = -5; ds <= 5; ds += 2.5) c.box(x + dx, G + 2.9, s + ds, .1, 1.12, 1.9, '#3d626c', 'glass');
    for (const ds of [-6.56, 6.56]) c.box(x, G + 2.9, s + ds, 3.4, 1.12, .1, '#3d626c', 'glass');
    c.box(x, G + 4.9, s, .2, 2, .2, '#52656a');
    c.box(x, G + 5.8, s, 3.6, .12, .16, '#52656a');
    c.solid(x, s, 4.5, 14);
  }
  for (const x of [20, 92]) { c.tree(x, 20, 8); c.prop('bench', x, 48); }
  c.box(89, G + 11, 85, 3, 22, 3, '#98634f');
}
function art(c) {
  c.box(56, G + .2, 56, 74, .4, 74, '#dbd2bc');
  c.box(56, G + .5, 56, 34, .4, 28, '#517a89', 'glass');
  c.solid(56, 56, 34, 28);
  c.box(56, G + 2, 56, 12, 4, 10, '#eee1c5');
  c.box(53, G + 11, 56, 5, 22, 5, '#d87450', 'solid', 0, -.35);
  c.box(60, G + 19, 56, 5, 17, 5, '#dfaa57', 'solid', 0, .8);
  c.box(56, G + 26, 56, 19, 4, 6, '#7d93aa', 'solid', .2);
  for (const [x, s, color] of [[28, 28, '#829eae'], [83, 82, '#c78d9d']]) {
    c.box(x, G + .5, s, 10, 1, 10, '#f0e2c8');
    c.box(x, G + 4.4, s, 5.5, 7, 5.5, color, 'solid', .5, .25);
    c.solid(x, s, 10, 10);
  }
  for (const x of [28, 42, 56, 70, 84]) {
    c.box(x, G + 3, 93, 9, 6, .8, '#e2d4ba');
    c.box(x, G + 3.5, 92.5, 6, 3.7, .1, x % 3 ? '#cb8169' : '#699ba3');
    c.solid(x, 93, 9, .8);
  }
  for (const [x, s] of [[24, 58], [87, 31], [25, 84]]) { planter(c, x, s, 8, 8); c.tree(x, s, 8); }
  table(c, 82, 57, '#bf8ca1');
}

export function buildLandmark(c) {
  const type = c.plan.landmark, place = CITY_PLACES[type];
  c.box(56, G + .015, 56, 86, .03, 86, type === 'garden' ? '#7e9d72' : '#c4baa3');
  for (const p of [17, 95]) {
    c.box(p, G + .04, 56, .25, .04, 78, '#e4d5b6');
    c.box(56, G + .04, p, 78, .04, .25, '#e4d5b6');
  }
  ({ clock: clockSquare, market, garden, depot, art })[type](c);
  // Low roadside totems make the destination identifiable from a driving view.
  for (const [x, s, yaw] of [[56, 13, 0], [99, 56, Math.PI / 2]]) {
    c.box(x, G + 2.1, s, 6.4, 4.2, .65, '#314f55', 'solid', yaw);
    c.box(x, G + 4.3, s, 6.6, .16, .8, place.color, 'lit', yaw);
    c.solid(x, s, yaw ? .8 : 6.6, yaw ? 6.6 : .8);
    c.sign(type, x, G + 2.5, s, yaw);
  }
  c.features.discoveries.push({ id: c.index, type, ...place, s: c.start + 56, u: c.east + 56 });
}
