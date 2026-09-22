import * as THREE from 'three';
import { PAVEMENT_LEVEL as G } from './city-grid.js';
import { randomAt } from './route.js';
import { pathPanels, distanceToPath, rectanglePolygon, insetPolygon, subtractPolygon, containsPoint, signedArea } from './city-surfaces.js';

// Shared geometry, shared city materials: no per-site meshes or textures.
const octagon = new THREE.CylinderGeometry(1, 1, 1, 8);
export const SPACE_NAMES = {
  park: ['Willow pond', 'Orchard garden', 'Meadow walk', 'Terrace garden'],
  plaza: ['Fountain court', 'Pergola square', 'Forum steps', 'Mosaic promenade'],
  clock: ['Reflecting court', 'Civic garden', 'Belfry square'],
  market: ['Covered market', 'Flower market', 'Lantern market'],
  garden: ['Palm house', 'Twin conservatories', 'Water garden'],
  depot: ['Tram sheds', 'Platform gardens', 'Works yard'],
  art: ['Balancing act', 'Colour gates', 'The sundial'],
};
const PALETTES = [
  { stone: '#d5c7ad', path: '#c7b99b', green: '#819668', accent: '#bd785b', flower: '#c597ab' },
  { stone: '#c6cbbd', path: '#d5ccaf', green: '#74926d', accent: '#648f8b', flower: '#d7b46a' },
  { stone: '#d9c6b0', path: '#c8bda7', green: '#8b9c6b', accent: '#9c7d95', flower: '#ba795f' },
];
export function publicSpacePlan(block) {
  const type = block.landmark || block.kind;
  // A four-colour address pattern prevents adjacent ordinary parks/plazas
  // from sharing a layout. Seeded palettes and planting soften the repetition.
  const variant = type === 'park' || type === 'plaza'
    ? (((block.ix % 2 + 2) % 2) * 2 + ((block.iz % 2 + 2) % 2) + Math.floor(randomAt(391, 812) * 4)) % 4
    : Math.floor(randomAt(block.seed, 813) * 3);
  return { type, variant, name: SPACE_NAMES[type][variant],
    orientation: Math.floor(randomAt(block.seed, 816) * 4),
    palette: PALETTES[Math.floor(randomAt(block.seed, 814) * PALETTES.length)],
    plantingSeed: Math.floor(randomAt(block.seed, 815) * 1e9) };
}
export function disk(c, x, s, w, d, y, h, color, water = false) {
  c.item(water ? 'public-water' : 'public-stone', octagon, c.materials[water ? 'glass' : 'solid'],
    [x, y, -s], [w / 2, h, d / 2], color);
}
export function pool(c, x, s, w, d, stone, jets = false) {
  reserve(c, Array.from({ length: 8 }, (_, i) => [x + Math.cos(i * Math.PI / 4) * w / 2, s + Math.sin(i * Math.PI / 4) * d / 2]));
  c.rigid(x, s, () => {
    disk(c, x, s, w, d, G + .22, .44, stone);
    disk(c, x, s, w - 1.3, d - 1.3, G + .46, .08, '#6faaa7', true);
    c.solid(x, s, w, d);
    if (jets) for (const dx of [-w * .22, 0, w * .22]) {
      c.box(x + dx, G + 1.2, s, .15, 1.5, .15, '#c8e5d8', 'glass');
      disk(c, x + dx, s, 1.7, 1.7, G + 1.9, .12, '#c8e5d8', true);
    }
  });
}
function plantingPieces(c, polygons, clearance) {
  let pieces = polygons;
  for (const walkway of c.paths ?? []) for (const reserved of pathPanels(walkway.points, walkway.width + clearance * 2)) {
    pieces = pieces.flatMap(p => subtractPolygon(p, reserved));
  }
  for (const reserved of c.plantingExclusions ?? []) pieces = pieces.flatMap(p => subtractPolygon(p, insetPolygon(reserved, -(.7 + clearance - .9))));
  for (const planted of c.plantedAreas ?? []) pieces = pieces.flatMap(p => subtractPolygon(p, insetPolygon(planted, -(.45 + clearance - .9))));
  return pieces.filter(p => p.length >= 3 && Math.abs(signedArea(p)) > .08);
}
export function reserve(c, polygon) {
  c.plantingExclusions ??= []; c.plantingExclusions.push(polygon);
  c.recordReserve(polygon);
}
function plantedPolygons(c, outer, inner, color, stone) {
  const clear = plantingPieces(c, outer, .9);
  const area = polygons => polygons.reduce((sum, p) => sum + Math.abs(signedArea(p)), 0);
  // A clipped remnant can be technically clear yet look like a spike or scrap.
  // Accept complete designed beds only; callers can try a slightly narrower
  // coherent bed, or leave the space open instead of exposing the clipping.
  if (Math.abs(area(clear) - area(outer)) > 1e-5) return false;
  const beds = outer, soil = inner;
  c.plantedAreas ??= []; c.plantedAreas.push(...beds);
  for (const polygon of beds) {
    c.polygon(polygon, G + .23, .46, stone);
    c.polygonSolid(polygon); c.recordPlanting(polygon);
  }
  const flowers = PALETTES.some(p => p.flower === color);
  for (const polygon of soil) c.polygon(polygon, G + .49, .06, flowers ? '#71855c' : color);
  if (!flowers || c.distant) return true;
  const planted = new Set();
  for (const polygon of soil) {
    const x0 = Math.ceil(Math.min(...polygon.map(p => p[0])) / 2.4), x1 = Math.floor(Math.max(...polygon.map(p => p[0])) / 2.4);
    const s0 = Math.ceil(Math.min(...polygon.map(p => p[1])) / 2.4), s1 = Math.floor(Math.max(...polygon.map(p => p[1])) / 2.4);
    for (let ix = x0; ix <= x1; ix++) for (let iz = s0; iz <= s1; iz++) {
      const x = ix * 2.4, s = iz * 2.4, key = `${ix},${iz}`;
      if (planted.has(key) || !containsPoint(polygon, x, s, .65)) continue;
      planted.add(key);
      c.box(x, G + .72, s, 1, .4, 1, '#658258');
      c.box(x, G + .96, s, .85, .16, .85, color);
    }
  }
  return true;
}
export function bed(c, x, s, w, d, color, stone = '#c8bda6') {
  for (const inset of [0, .4, .8]) {
    const boundary = rectanglePolygon(x, s, w - inset * 2, d - inset * 2);
    if (plantedPolygons(c, [boundary], [insetPolygon(boundary, .35)], color, stone)) return;
  }
}
export function ribbonBed(c, points, width, color, stone = '#c8bda6') {
  const trimmed = points.map(p => [...p]);
  for (const [i, j] of [[0, 1], [trimmed.length - 1, trimmed.length - 2]]) {
    const dx = points[j][0] - points[i][0], ds = points[j][1] - points[i][1], length = Math.hypot(dx, ds);
    trimmed[i][0] += dx / length * .35; trimmed[i][1] += ds / length * .35;
  }
  for (const scale of [1, .85, .75]) {
    const w = Math.max(2.4, width * scale);
    if (plantedPolygons(c, pathPanels(points, w), pathPanels(trimmed, w - .7), color, stone)) return;
  }
}
export function pergola(c, x, s, w, d, color = '#cbb593') {
  reserve(c, rectanglePolygon(x, s, w + 1.5, d + 1.5));
  c.rigid(x, s, () => {
    c.surface(x, G + .065, s, w + 1.5, .045, d + 1.5, '#c7b99b');
    for (const dx of [-w / 2 + .5, w / 2 - .5]) for (const ds of [-d / 2 + .5, d / 2 - .5]) {
      c.box(x + dx, G + 2.5, s + ds, .5, 5, .5, color); c.post(x + dx, s + ds, .4);
    }
    for (const dx of [-w / 2 + .5, w / 2 - .5]) c.box(x + dx, G + 4.8, s, .45, .5, d + 1, color);
    for (let ds = -d / 2; ds <= d / 2; ds += 2) c.box(x, G + 5.1, s + ds, w + 1, .35, .38, color);
    for (const ds of [-d * .3, d * .3]) c.prop('bench', x, s + ds, Math.PI / 2);
  });
}
export function cafeTable(c, x, s, color) {
  reserve(c, rectanglePolygon(x, s, 7, 6));
  c.rigid(x, s, () => {
    c.box(x, G + 1, s, 2.6, .2, 2.6, '#e2cda6');
    c.box(x, G + 1.6, s, .15, 3.2, .15, '#736d5c');
    disk(c, x, s, 5.7, 5.7, G + 3.2, .22, color);
    for (const dx of [-2.3, 2.3]) c.prop('bench', x + dx, s, Math.PI / 2);
    c.post(x, s, 1.6);
  });
}
export function path(c, points, width, color, bounds = [16, 16, 96, 96]) {
  c.paths ??= []; c.paths.push({ points, width });
  c.recordPath(points, width);
  for (const panel of pathPanels(points, width, bounds)) c.polygon(panel, G + .065, .045, color);
}
export function pathClear(c, x, s, radius = 1) {
  return (c.paths ?? []).every(p => distanceToPath(x, s, p.points) >= p.width / 2 + radius);
}
