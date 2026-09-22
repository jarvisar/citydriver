import { PAVEMENT_LEVEL as G } from './city-grid.js';
import { seededRandom } from './route.js';
import { publicSpacePlan, pool, bed, ribbonBed, pergola, cafeTable, path, disk, pathClear, reserve } from './city-public-space-kit.js';
import { offsetPath, rectanglePolygon } from './city-surfaces.js';

// Rotate the composition in address space before placing each rigid assembly.
// Collider dimensions rotate with the structures; architecture is never bent.
function orientedSite(c, turn) {
  if (!turn) return c;
  const point = (x, s) => turn === 1 ? [112 - s, x] : turn === 2 ? [112 - x, 112 - s] : [s, 112 - x];
  const angle = turn * Math.PI / 2, odd = turn % 2;
  return {
    distant: c.distant, materials: c.materials,
    polygon(points, y, height, color, kind) { c.polygon(points.map(p => point(...p)), y, height, color, kind); },
    recordPath(points, width) { c.recordPath(points.map(p => point(...p)), width); },
    recordPlanting(points) { c.recordPlanting(points.map(p => point(...p))); },
    recordReserve(points) { c.recordReserve(points.map(p => point(...p))); },
    polygonSolid(points) { c.polygonSolid(points.map(p => point(...p))); },
    rigid(x, s, build) { return c.rigid(...point(x, s), build); },
    box(x, y, s, w, h, d, color, kind, yaw = 0, roll = 0) {
      const [px, ps] = point(x, s); c.box(px, y, ps, w, h, d, color, kind, yaw + angle, roll);
    },
    surface(x, y, s, w, h, d, color, kind, yaw = 0) {
      const [px, ps] = point(x, s);
      // Exchanging rectangle dimensions preserves axis-aligned tessellation.
      c.surface(px, y, ps, odd ? d : w, h, odd ? w : d, color, kind, yaw);
    },
    item(key, geometry, material, p, scale, color, yaw = 0, roll = 0) {
      const [x, s] = point(p[0], -p[2]); c.item(key, geometry, material, [x, p[1], -s], scale, color, yaw + angle, roll);
    },
    solid(x, s, w, d) { c.solid(...point(x, s), odd ? d : w, odd ? w : d); },
    post(x, s, radius) { c.post(...point(x, s), radius); },
    tree(x, s, scale) { c.tree(...point(x, s), scale); },
    prop(name, x, s, yaw = 0) { c.prop(name, ...point(x, s), yaw + angle); },
  };
}
function grove(c, points, random) {
  for (const [x, s] of points) {
    const px = x + (random() - .5) * 2.5, ps = s + (random() - .5) * 2.5, size = 7 + random() * 3.5;
    const location = [[px, ps], [x, s], [x - 3, s], [x + 3, s], [x, s - 3], [x, s + 3]]
      .find(([xx, ss]) => xx > 20 && xx < 92 && ss > 20 && ss < 92 && pathClear(c, xx, ss, 2.4));
    if (location) c.tree(...location, size);
  }
}
function benchBay(c, points, width, x, s, color) {
  let nearest = null;
  for (let i = 1; i < points.length; i++) {
    const [ax, as] = points[i - 1], dx = points[i][0] - ax, ds = points[i][1] - as, length = Math.hypot(dx, ds);
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (s - as) * ds) / (length * length)));
    const px = ax + dx * t, ps = as + ds * t, distance = Math.hypot(x - px, s - ps);
    if (!nearest || distance < nearest.distance) nearest = { x: px, s: ps, dx: dx / length, ds: ds / length, distance };
  }
  const sign = Math.sign((x - nearest.x) * -nearest.ds + (s - nearest.s) * nearest.dx) || 1;
  const nx = -nearest.ds * sign, ns = nearest.dx * sign, yaw = Math.atan2(ns, nx);
  const center = width / 2 + 1.1, seat = width / 2 + 2.2;
  const px = nearest.x + nx * center, ps = nearest.s + ns * center;
  reserve(c, rectanglePolygon(px, ps, 3.2, 5, yaw));
  c.surface(px, G + .065, ps, 3.2, .045, 5, color, 'solid', yaw);
  c.prop('bench', nearest.x + nx * seat, nearest.s + ns * seat, yaw);
}
function pondGarden(c, p, random) {
  const { stone, path: paving, flower } = p;
  path(c, [[31, 43], [44, 29], [66, 27], [85, 40], [91, 61], [78, 81], [58, 87], [38, 77], [27, 61], [31, 43]], 3.3, paving);
  path(c, [[16, 48], [31, 43]], 3.3, paving);
  path(c, [[58, 87], [56, 96]], 3.3, paving);
  path(c, [[58, 87], [58, 79.7]], 3.3, paving);
  pool(c, 58, 54, 41, 32, stone);
  // A straight timber viewing deck projects over the faceted water.
  c.rigid(58, 74, () => {
    c.box(58, G + .65, 72, 17, .4, 10, '#a18b6d'); c.solid(58, 72, 17, 10);
    for (const [s, h] of [[78.9, .28], [77.65, .56]]) c.box(58, G + h / 2, s, 5, h, 1.3, stone);
    c.solid(58, 78.5, 5, 3.2);
    if (!c.distant) for (let x = 50; x < 67; x += 1.4) c.box(x, G + .86, 72, .045, .02, 10, '#7e715e');
    c.prop('bench', 58, 74, Math.PI);
  });
  grove(c, [[24, 28], [37, 23], [80, 25], [88, 79], [77, 90], [25, 82], [22, 65]], random);
  bed(c, 33, 88, 10, 5, flower, stone);
  c.surface(84, G + .065, 47, 6, .045, 4, paving); c.prop('bench', 82, 47, Math.PI / 2);
}
function orchard(c, p, random) {
  path(c, [[16, 55], [96, 55]], 5, p.path);
  path(c, [[58, 16], [58, 96]], 4, p.path);
  path(c, [[58, 32], [78, 32]], 3, p.path);
  path(c, [[78, 55], [78, 62]], 4, p.path);
  c.surface(78, G + .065, 76.5, 14, .045, 29, p.path);
  grove(c, [[28, 28], [43, 28], [28, 43], [43, 43], [28, 70], [43, 70], [28, 87], [43, 87]], random);
  pergola(c, 78, 32, 17, 19);
  for (const s of [70, 83]) cafeTable(c, 78, s, p.accent);
  for (const s of [66, 80]) bed(c, 65, s, 5, 8, p.flower, p.stone);
  for (const x of [27, 43]) c.prop('bench', x, 60);
}
function meadow(c, p, random) {
  const points = Array.from({ length: 17 }, (_, i) => {
    const t = i / 16; return [16 + t * 80, 54 + Math.sin(t * Math.PI * 2) * 16];
  });
  path(c, points, 4.5, p.path);
  path(c, [[53, 16], [56, 32], [56, 54]], 3, p.path);
  path(c, [[65, 96], [61, 77], [56, 54]], 3, p.path);
  path(c, [[56, 32], [67, 27], [79, 27]], 3, p.path);
  // An open lawn is the focal point; dense planting is kept at the edges.
  grove(c, [[23, 26], [35, 23], [25, 38], [85, 72], [89, 86], [74, 88], [24, 83], [36, 89]], random);
  pergola(c, 79, 27, 18, 10);
  benchBay(c, points, 4.5, 37, 66, p.path);
  benchBay(c, points, 4.5, 72, 43, p.path);
  benchBay(c, [[65, 96], [61, 77], [56, 54]], 3, 65.5, 79, p.path);
  ribbonBed(c, [[23, 69], [28, 73], [34, 76], [41, 77], [48, 74]], 3.2, p.flower, p.stone);
  ribbonBed(c, offsetPath(points.slice(10, 15), 8), 3.2, p.flower, p.stone);
}
function terrace(c, p, random) {
  for (const points of [[[56, 16], [56, 43.5]], [[56, 68.5], [56, 96]]]) path(c, points, 8, p.path);
  for (const points of [[[16, 56], [43.5, 56]], [[68.5, 56], [96, 56]]]) path(c, points, 5, p.path);
  path(c, Array.from({ length: 9 }, (_, i) => [56 + Math.cos(i * Math.PI / 4) * 12.5, 56 + Math.sin(i * Math.PI / 4) * 12.5]), 4, p.path);
  for (const s of [21, 91]) path(c, [[16, s], [96, s]], 4, p.path);
  for (const s of [29, 41, 71, 83]) for (const x of [32, 80]) {
    bed(c, x, s, 21, 7, s === 29 || s === 83 ? p.flower : '#657e58', p.stone);
  }
  pool(c, 56, 56, 15, 15, p.stone, true);
  grove(c, [[25, 61], [87, 61], [24, 91], [89, 22]], random);
  for (const x of [42, 70]) for (const s of [24, 88]) c.prop('bench', x, s, s === 24 ? 0 : Math.PI);
}
function fountainCourt(c, p, random) {
  // Treat the paving as ground so it follows the square and cannot cast
  // striped self-shadows onto the nearly coplanar plaza below it.
  c.polygon(Array.from({ length: 8 }, (_, i) => [54 + Math.cos(i * Math.PI / 4) * 24.5, 52 + Math.sin(i * Math.PI / 4) * 24.5]), G + .065, .045, p.path);
  pool(c, 54, 52, 27, 27, p.stone, true);
  for (const [x, s, yaw] of [[35, 52, -Math.PI / 2], [73, 52, Math.PI / 2], [54, 33, 0], [54, 71, Math.PI]]) c.prop('bench', x, s, yaw);
  for (const x of [28, 46, 65, 84]) { bed(c, x, 87, 10, 7, p.green, p.stone); c.tree(x, 87, 7 + random()); }
  for (const x of [28, 83]) cafeTable(c, x, 26, p.accent);
}
function pergolaSquare(c, p, random) {
  for (const x of [29, 83]) pergola(c, x, 56, 13, 54);
  pool(c, 56, 51, 14, 33, p.stone);
  for (const x of [43, 69]) for (const s of [29, 80]) cafeTable(c, x, s, p.accent);
  for (const x of [27, 85]) for (const s of [23, 89]) { bed(c, x, s, 9, 8, p.green, p.stone); c.tree(x, s, 7 + random()); }
  for (const x of [45, 67]) bed(c, x, 53, 4, 27, p.flower, p.stone);
}
function forum(c, p, random) {
  // Three sides of shallow seating frame an open performance court.
  c.surface(56, G + .04, 51, 41, .05, 34, p.path);
  c.rigid(56, 56, () => {
    for (let i = 0; i < 4; i++) {
      const y = G + .25 + i * .22, h = .5 + i * .44;
      for (const x of [31 - i * 2.4, 81 + i * 2.4]) {
        c.box(x, y, 53, 2.3, h, 37 + i * 4.8, p.stone); c.solid(x, 53, 2.3, 37 + i * 4.8);
      }
      c.box(56, y, 74 + i * 2.4, 52 + i * 4.8, h, 2.3, p.stone); c.solid(56, 74 + i * 2.4, 52 + i * 4.8, 2.3);
    }
  });
  c.rigid(56, 33, () => { c.box(56, G + .3, 33, 24, .6, 9, p.accent); c.solid(56, 33, 24, 9); });
  grove(c, [[25, 25], [87, 25], [28, 90], [43, 92], [72, 92], [87, 90]], random);
  for (const x of [42, 70]) bed(c, x, 23, 10, 4, p.flower, p.stone);
}
function mosaic(c, p, random) {
  path(c, [[22, 16], [38, 40], [72, 69], [90, 96]], 14, p.path);
  for (let i = 0; i < 7; i++) c.box(36 + i * 6, G + .095, 39 + i * 5, 4.5, .035, 4.5, i % 2 ? p.accent : p.stone, 'solid', -.7);
  c.rigid(35, 75, () => {
    disk(c, 35, 75, 20, 20, G + .25, .5, p.stone);
    for (const dx of [-4.5, 4.5]) c.box(35 + dx, G + 5, 75, 2, 10, 3, p.accent);
    c.box(35, G + 9.3, 75, 12, 2, 3, p.accent); c.solid(35, 75, 14, 5);
  });
  for (const [x, s] of [[72, 28], [85, 40], [58, 85]]) cafeTable(c, x, s, p.accent);
  for (const [x, s] of [[24, 45], [26, 62], [87, 57], [67, 90]]) { bed(c, x, s, 9, 10, p.green, p.stone); c.tree(x, s, 7 + random() * 2); }
  ribbonBed(c, [[47, 33], [54, 38], [64, 46], [73, 54]], 3.5, p.flower, p.stone);
  pergola(c, 32, 91, 22, 7);
}
export function buildPublicSpace(c) {
  const plan = publicSpacePlan(c.plan), p = plan.palette, park = plan.type === 'park';
  c.surface(56, G + .016, 56, 80, .03, 80, park ? p.green : p.stone);
  // Plan randomness is separate from street furniture and near-only details.
  const random = seededRandom(plan.plantingSeed);
  (park ? [pondGarden, orchard, meadow, terrace] : [fountainCourt, pergolaSquare, forum, mosaic])[plan.variant](orientedSite(c, plan.orientation), p, random);
  c.features.discoveries.push({ kind: park ? 'park' : 'square', name: plan.name, variant: plan.variant, orientation: plan.orientation, s: c.start + 56, u: c.east + 56 });
}
