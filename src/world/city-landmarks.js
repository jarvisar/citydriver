import { CITY_PLACES } from './city-places.js';
import { PAVEMENT_LEVEL as G } from './city-grid.js';
import { publicSpacePlan, pool, bed, pergola, cafeTable, path, entrancePath, reserve } from './city-public-space-kit.js';
import { rectanglePolygon } from './city-surfaces.js';
import { curvedPath } from './city-public-space-geometry.js';
import { grassArea } from './city-grass.js';
import { discoverySignFor } from './city-signs.js';
import { DESTINATION_BUILDERS } from './city-destinations.js';
import { pitchedRoof } from './city-roofs.js';
import { balancingBeam } from './city-sculptures.js';
import { round, clock, wheels, bell, produce } from './city-detail-assets.js';
export { pitchedRoof } from './city-roofs.js';

// All landmark pieces join the city's existing instance batches. The same
// silhouette is used at both detail levels; only small furnishings disappear.
function planter(c, x, s, w, d, color = '#7a9a68') {
  c.rigid(x, s, () => {
    c.box(x, G + .28, s, w, .56, d, '#c5bba5');
    c.box(x, G + .6, s, w - .6, .18, d - .6, color);
    c.solid(x, s, w, d);
  });
}
function table(c, x, s, color) {
  cafeTable(c, x, s, color);
}
function clockSquare(c, design) {
  const v = design.variant, palette = design.palette;
  for (const s of v === 0 ? [32, 80] : []) {
    c.rigid(56, s, () => {
      c.box(56, G + .25, s, 30, .5, 12, '#d2c6ad');
      c.box(56, G + .53, s, 28.5, .08, 10.5, '#639ca5', 'glass');
      c.solid(56, s, 30, 12);
      for (const x of [48, 56, 64]) {
        c.box(x, G + 1.1, s, .22, 1.2, .22, '#b8e3dc', 'glass');
        round(c, x, G + 1.7, s, 1.3, .14, 1.3, '#d4e4d6', 'y', 'glass');
      }
    });
  }
  c.structure(56, 56, () => {
    c.box(56, G + .5, 56, 19, 1, 19, '#b2a389');
    c.box(56, G + 1.3, 56, 15, .6, 15, '#e2cfab');
    c.box(56, G + 17, 56, 10, 32, 10, '#ba9071');
    c.box(56, G + 32, 56, 13, 1, 13, '#eddbb4');
    c.box(56, G + 36, 56, 12, 7, 12, '#637e79');
    c.box(56, G + 40, 56, 15, 1, 15, '#b9ccad');
    if (v === 2) {
      // Open belfry: a different crown with a smaller, taller roof.
      for (const dx of [-5, 5]) for (const ds of [-5, 5]) c.box(56 + dx, G + 44, 56 + ds, .8, 7, .8, '#e3cdab');
      c.item('detail-bell', bell, c.materials.props, [56, G + 44, -56], [3, 3.5, 3]);
      pitchedRoof(c, 56, 56, 14, 14, G + 47.5 - 1.6 * Math.tan(.36), '#537b76');
      c.box(56, G + 52, 56, .3, 5, .3, '#dfc384');
    } else if (v === 1) {
      for (let i = 0; i < 4; i++) c.box(56, G + 41 + i, 56, 13 - i * 2.5, 1, 13 - i * 2.5, '#648c87');
      c.box(56, G + 46, 56, .3, 5, .3, '#dfc384');
    } else {
      pitchedRoof(c, 56, 56, 16, 16, G + 40.5 - .5 * Math.tan(.36), '#537b76', '#637e79', .36, { wallWidth: 15, wallDepth: 15 });
      c.box(56, G + 47, 56, .32, 8, .32, '#dfc384');
    }
    c.solid(56, 56, 19, 19);
    for (let side = 0; side < 4; side++) {
      const yaw = side * Math.PI / 2, dx = Math.sin(yaw), ds = -Math.cos(yaw);
      c.box(56 + dx * 5.1, G + 17, 56 + ds * 5.1, 2.2, 24, .16, '#6b7770', 'glass', yaw);
      clock(c, 56 + dx * 6.12, G + 36, 56 + ds * 6.12, 5.2, yaw);
    }
  });
  if (v === 1) {
    for (const x of [30, 82]) {
      pool(c, x, 56, 13, 30, palette.stone, true);
      for (const s of [28, 84]) { bed(c, x, s, 17, 12, palette.flower, palette.stone); c.tree(x, s, 8); }
    }
    for (const x of [46, 66]) for (const s of [28, 84]) c.prop('bench', x, s);
  } else if (v === 2) {
    for (const x of [29, 83]) pergola(c, x, 60, 12, 35);
    for (const x of [29, 47, 65, 83]) { bed(c, x, 87, 10, 8, palette.green); c.tree(x, 87, 7); }
    for (const x of [31, 81]) cafeTable(c, x, 27, palette.accent);
  } else for (const x of [25, 87]) for (const s of [28, 56, 84]) { planter(c, x, s, 8, 8); c.tree(x, s, 8); }
}
function marketHall(c, x, s, w, d, color) {
  c.structure(x, s, () => {
    c.box(x, G + 5, s, w, 10, d, color);
    c.box(x, G + 1.6, s, w + 1, 3.2, d + 1, '#e5c398');
    pitchedRoof(c, x, s, w + 4, d + 4, G + 10 - 2 * Math.tan(.36), '#805c51', color, .36, { wallWidth: w, wallDepth: d });
    c.solid(x, s, w + 1, d + 1);
    for (const edge of [-1, 1]) for (let dx = -w / 2 + 6; dx < w / 2 - 2; dx += 8) {
      c.box(x + dx, G + 5.4, s + edge * (d / 2 + .1), 5, 7, .2, '#355c60', 'glass');
      c.box(x + dx, G + 9.4, s + edge * (d / 2 + .1), 6, .5, .5, '#e7c89b');
    }
  });
}
function market(c, design) {
  const v = design.variant, p = design.palette;
  if (v === 0) marketHall(c, 56, 75, 61, 25, '#b77155');
  else if (v === 1) {
    marketHall(c, 35, 77, 25, 23, '#a7846a'); marketHall(c, 78, 77, 25, 23, '#a7846a');
    for (const x of [25, 87]) { bed(c, x, 50, 8, 14, p.flower, p.stone); c.tree(x, 50, 7); }
    pergola(c, 56, 78, 10, 21);
  } else {
    marketHall(c, 33, 58, 24, 58, '#75918c');
    for (const x of [59, 80]) cafeTable(c, x, 83, p.accent);
  }
  const xs = v === 2 ? [60, 81] : v === 1 ? [39, 57, 75] : [30, 47, 65, 82];
  const ss = v === 2 ? [30, 47, 64] : [29, 46];
  for (const x of xs) for (const s of ss) {
    c.structure(x, s, () => {
      const color = (x + s) % 3 ? p.accent : '#658d77';
      c.box(x, G + 1, s, 9, 2, 4, '#8d7157');
      for (let stripe = 0; stripe < 6; stripe++) c.box(x - 4.6 + stripe * 1.85, G + 4.3, s, 1.85, .25, 7, stripe % 2 ? '#f2dfb8' : color);
      for (const side of [-1, 1]) c.box(x + side * 4.5, G + 2.2, s, .18, 4.4, .18, '#e5d4b6');
      c.solid(x, s, 9, 4);
      if (!c.distant) for (const offset of [-3, 0, 3]) {
        c.box(x + offset, G + 2.1, s, 2, .2, 2.5, '#806447');
        for (const ds of [-.65, .65]) c.item('market-produce', produce, c.materials.solid,
          [x + offset, G + 2.45, -(s + ds)], [.8, .42, .6], v === 1 ? (offset ? p.flower : '#d9bd6b') : offset ? '#e5aa53' : '#83a163');
      }
    });
  }
  for (const x of [23, 89]) c.tree(x, 92, 8);
  if (v === 0) for (const x of [23, 89]) cafeTable(c, x, 54, p.accent);
  // Short rigid spans keep lanterns and wires together on curved blocks.
  const left = xs[0] - 6, right = xs.at(-1) + 6;
  for (const s of v === 2 ? [38, 56, 73] : [37, 55]) c.rigid((left + right) / 2, s, () => {
    c.box((left + right) / 2, G + 6.5, s, right - left, .06, .06, '#53656a');
    for (const x of [left, right]) { c.box(x, G + 3.25, s, .18, 6.5, .18, '#53656a'); c.post(x, s, .2); }
    for (let x = left + 3; x < right; x += 7) c.box(x, G + 6.1, s, .65, .8, .65, '#ffe0a2', 'lit');
  });
}
function glasshouse(c, x, s, w, d, color = '#78aaa9') {
  reserve(c, rectanglePolygon(x, s, w + 3, d + 3));
  const front = s - (d + 3) / 2;
  reserve(c, rectanglePolygon(x, front - 1.5, 8, 3));
  c.structure(x, s, () => {
    c.box(x, G + .5, s, w + 3, 1, d + 3, '#d5ccb2');
    c.box(x, G + 6.4, s, w, 11, d, color, 'glass');
    const eave = G + 11.9 - Math.tan(.36);
    pitchedRoof(c, x, s, w + 2, d + 3, eave, '#91c5bf', color, .36, { wallWidth: w, wallDepth: d });
    c.solid(x, s, w + 3, d + 3);
    for (let i = 0; i < 3; i++) c.box(x, G + (i + 1) * .125, front - 2.5 + i, 8, (i + 1) * .25, 1, '#d5ccb2');
    c.box(x, G + 3, s - d / 2 - .15, 4.8, 4, .2, '#476e70', 'glass');
    c.box(x, G + 3, s - d / 2 - .28, .12, 4, .12, '#e3debd');
    for (const dx of [-w / 2 - .2, w / 2 + .2]) for (let ds = -d / 2; ds <= d / 2; ds += 6) c.box(x + dx, G + 6.15, s + ds, .3, 11.3, .3, '#e3debd');
    for (const ds of [-d / 2 - .2, d / 2 + .2]) for (let dx = -w / 2; dx <= w / 2; dx += 6) c.box(x + dx, G + 6.15, s + ds, .3, 11.3, .3, '#e3debd');
    for (const y of [2, 7, 12]) {
      for (const dx of [-w / 2 - .39, w / 2 + .39]) c.box(x + dx, G + y, s, .08, .25, d + 1, '#e3debd');
      for (const ds of [-d / 2 - .39, d / 2 + .39]) c.box(x, G + y, s + ds, w + .7, .25, .08, '#e3debd');
    }
    for (let ds = -d / 2; ds <= d / 2; ds += 6) pitchedRoof(c, x, s + ds, w + 2, .3, eave + .38, '#d8d9b9', null, .36, { thickness: .13, trim: null, ridge: false });
  });
}
function garden(c, design) {
  const v = design.variant, p = design.palette;
  if (v === 0) {
    entrancePath(c, [[56, 16], [56, 34.5]], 7, p.path, [56, 64], [56, 34.5]);
    for (const x of [39, 73]) path(c, [[x, 16], [x, 96]], 3, p.path);
    glasshouse(c, 56, 64, 27, 50);
    for (const x of [29, 83]) for (const s of [28, 50, 80]) {
      bed(c, x, s, 15, 13, p.green); c.tree(x, s, 8.5);
      if (!c.distant) for (const offset of [-5, 5]) c.box(x + offset, G + .85, s, 3, .4, 8, p.flower);
    }
  } else if (v === 1) {
    for (const x of [33, 79]) glasshouse(c, x, 70, 21, 36);
    pool(c, 56, 33, 24, 18, p.stone, true);
    path(c, [[56, 47], [56, 96]], 7, p.path);
    path(c, curvedPath([[56, 47], [39, 47], [37, 33], [39, 21], [73, 21], [75, 33], [73, 47], [56, 47]]), 3.5, p.path);
    path(c, [[56, 16], [56, 21]], 5, p.path);
    for (const x of [33, 79]) entrancePath(c, [[56, 47], [x, 47], [x, 47.5]], 3.5, p.path, [x, 70], [x, 47.5]);
    for (const x of [25, 87]) for (const s of [27, 39]) { bed(c, x, s, 10, 6, p.flower); }
    for (const x of [25, 87]) c.tree(x, 93, 8);
    for (const x of [48, 64]) c.prop('bench', x, 62, Math.PI / 2);
  } else {
    glasshouse(c, 56, 80, 51, 20);
    pool(c, 47, 43, 34, 27, p.stone, false, true);
    entrancePath(c, curvedPath([[16, 30], [28, 25], [54, 23], [73, 38], [71, 58], [60, 63], [56, 65.5]]), 3.5, p.path, [56, 80], [56, 65.5]);
    entrancePath(c, [[72.2, 46], [77.75, 46]], 3.5, p.path, [84, 46], [77.75, 46], Math.PI / 2);
    pergola(c, 84, 46, 11, 27);
    for (const [x, s] of [[24, 44], [27, 59], [87, 25]]) { bed(c, x, s, 9, 9, p.flower); c.tree(x, s, 8); }
    for (const x of [41, 55]) c.prop('bench', x, 61);
  }
}
function depot(c, design) {
  const v = design.variant;
  for (const x of v === 1 ? [36, 76] : v === 2 ? [32, 56] : [32, 56, 80]) c.rigid(x, 58, () => {
    c.structure(x, 58, () => {
      c.box(x, G + 4.3, 77, 22, 8.6, 30, '#9e6854');
      pitchedRoof(c, x, 77, 23.6, 34, G + 8.6 - .8 * Math.tan(.36), '#526a70', '#9e6854', .36, { wallWidth: 22, wallDepth: 30 });
      c.box(x, G + 3.4, 61.9, 12, 6.8, .22, '#35474c', 'glass');
      c.box(x, G + 6.3, 92.1, 13, 2.4, .2, '#819c9c', 'glass');
      c.solid(x, 77, 22, 30);
    });
    c.box(x, G + .025, 42, 6, .05, 40, '#928c7c');
    for (const dx of [-1.25, 1.25]) c.box(x + dx, G + .11, 42, .12, .12, 39.8, '#bcc5c1');
    if (!c.distant) for (let s = 23; s < 62; s += 2.8) c.box(x, G + .06, s, 4, .08, .36, '#6b6d60');
    const s = v === 1 ? (x === 36 ? 31 : 48) : x === 56 ? 48 : 36;
    {
      c.box(x, G + 1.35, s, 4.2, 1.8, 13.5, ['#b95543', '#537e78', '#bc9050'][v]);
      c.box(x, G + 2.9, s, 4, 1.5, 13, '#efd8a3');
      c.box(x, G + 3.85, s, 4.5, .4, 14, '#56696a');
      round(c, x, G + 4, s, 4.4, .6, 13.9, '#56696a', 'z');
      wheels(c, x, G + .6, s, 4.1, 8.4, 1.2, .4);
      for (const dx of [-2.03, 2.03]) for (let ds = -5; ds <= 5; ds += 2.5) c.box(x + dx, G + 2.9, s + ds, .1, 1.12, 1.9, '#3d626c', 'glass');
      for (const ds of [-6.56, 6.56]) c.box(x, G + 2.9, s + ds, 3.4, 1.12, .1, '#3d626c', 'glass');
      for (const end of [-1, 1]) {
        c.box(x, G + 1.05, s + end * 6.85, 3.6, .25, .3, '#bcc5c1');
        for (const dx of [-1.3, 1.3]) round(c, x + dx, G + 1.65, s + end * 6.8, .4, .4, .1, '#f2dbac', 'z');
      }
      c.box(x, G + 4.9, s, .2, 2, .2, '#52656a');
      c.box(x, G + 5.8, s, 3.6, .12, .16, '#52656a');
      c.solid(x, s, 4.5, 14);
    }
  });
  for (const x of [20, 92]) { c.tree(x, 20, 8); c.prop('bench', x, 48); }
  if (v === 1) {
    pergola(c, 56, 37, 12, 27, '#a1aaa0');
    for (const s of [63, 81]) { bed(c, 56, s, 10, 11, design.palette.flower); c.tree(56, s, 7); }
  } else if (v === 2) {
    c.structure(81, 77, () => {
      for (const dx of [-4, 4]) for (const ds of [-4, 4]) { c.box(81 + dx, G + 6, 77 + ds, .6, 12, .6, '#596f6a'); c.post(81 + dx, 77 + ds, .45); }
      round(c, 81, G + 13, 77, 12, 6, 12, '#8b9d94');
      for (const y of [10.2, 13, 15.8]) round(c, 81, G + y, 77, 12.2, .15, 12.2, '#657f7a');
      round(c, 81, G + 16.2, 77, 13, .45, 13, '#536a68');
    });
    for (const s of [30, 43, 55]) {
      c.rigid(81, s, () => { c.box(81, G + 1.2, s, 12, 2.4, 6, s === 43 ? '#b89b68' : '#83918a'); c.solid(81, s, 12, 6); });
    }
  } else c.structure(89, 85, () => c.box(89, G + 11, 85, 3, 22, 3, '#98634f'));
}
function art(c, design) {
  const v = design.variant;
  c.surface(56, G + .055, 56, 74, .05, 74, '#dbd2bc');
  c.structure(56, 56, () => {
    c.box(56, G + .5, 56, 34, .4, 28, '#517a89', 'glass');
    c.solid(56, 56, 34, 28);
    if (v === 0) {
      c.box(56, G + 2, 56, 12, 4, 10, '#eee1c5');
      c.box(53, G + 11, 56, 5, 22, 5, '#d87450', 'solid', 0, -.35);
      c.item('art-balance', balancingBeam, c.materials.solid, [56, G, -56], [1, 1, 1], '#dfaa57');
      c.box(56, G + 26, 56, 19, 4, 6, '#7d93aa', 'solid', .2);
    } else if (v === 1) {
      for (let i = 0; i < 3; i++) {
        const s = 48 + i * 8, h = 19 - i * 3, color = ['#ce765d', '#d6ad64', '#749e9b'][i];
        for (const x of [46, 66]) c.box(x, G + (h - 2.65) / 2, s, 2.7, h - 2.65, 2.7, color);
        c.box(56, G + h - 1.3, s, 22.7, 2.7, 2.7, color);
      }
    } else {
      c.box(56, G + 1.1, 56, 24, 1.2, 20, '#ded0ae');
      c.box(56, G + 11, 56, 2, 23, 6, '#bb7956', 'solid', 0, -.38);
      for (let i = 0; i < 9; i++) {
        const a = i / 8 * Math.PI;
        c.box(56 + Math.cos(a) * 12, G + 1.9, 56 + Math.sin(a) * 9, 1.1, .3, 2, '#68858b', 'solid', -a);
      }
    }
  });
  for (const [x, s, color] of v === 1 ? [[29, 82, '#d6ad64'], [82, 29, '#749e9b']] : [[28, 28, '#829eae'], [83, 82, '#c78d9d']]) {
    c.rigid(x, s, () => {
      c.box(x, G + .5, s, 10, 1, 10, '#f0e2c8');
      c.box(x, G + 4.4, s, 5.5, 7, 5.5, color, 'solid', .5, .25);
      c.solid(x, s, 10, 10);
    });
  }
  for (const x of [28, 42, 56, 70, 84]) {
    c.rigid(x, 93, () => {
      c.box(x, G + 3, 93, 9, 6, .8, '#e2d4ba');
      c.box(x, G + 3.5, 92.5, 6, 3.7, .1, x % 3 ? '#cb8169' : '#699ba3');
      c.solid(x, 93, 9, .8);
    });
  }
  for (const [x, s] of v === 1 ? [[24, 54], [87, 54], [55, 27]] : [[24, 58], [87, 31], [25, 84]]) { planter(c, x, s, 8, 8); c.tree(x, s, 8); }
  table(c, 82, 57, '#bf8ca1');
}

export function buildLandmark(c) {
  const type = c.plan.landmark, place = CITY_PLACES[type], design = publicSpacePlan(c.plan);
  c.surface(56, G + .015, 56, 80, .03, 80, type === 'garden' ? design.palette.green : design.palette.stone);
  if (type === 'garden') grassArea(c, rectanglePolygon(56, 56, 80, 80), design.palette.green, G + .03);
  for (const p of [17, 95]) {
    c.surface(p, G + .04, 56, .25, .04, 78.25, '#e4d5b6');
    c.surface(56, G + .04, p, 77.75, .04, .25, '#e4d5b6');
  }
  ({ clock: clockSquare, market, garden, depot, art, ...DESTINATION_BUILDERS })[type](c, design);
  buildDestinationSigns(c, type);
  c.features.discoveries.push({ id: c.index, type, ...place, name: discoverySignFor(c.plan).name,
    variant: design.variant, design: design.name, s: c.start + 56, u: c.east + 56 });
}

export function buildDestinationSigns(c, type) {
  // Open supports leave each board's cutout silhouette visible. They share the
  // ordinary solid batch and retain the existing roadside collision footprint.
  for (const [x, s, yaw] of [[71, 18, 0], [94, 70, Math.PI / 2]]) {
    c.rigid(x, s, () => {
      for (const side of [-1, 1]) c.box(x + Math.cos(yaw) * side * 1.65, G + 1.6,
        s + Math.sin(yaw) * side * 1.65, .18, 3.2, .18, '#52645a', 'solid', yaw);
      c.solid(x, s, yaw ? .8 : 6.6, yaw ? 6.6 : .8);
      c.sign(type, x, G + 2.5, s, yaw);
    });
  }
}
