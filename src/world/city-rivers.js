import { blockStreets } from './city-streets.js';
import { WATER_LEVEL as W, ROAD_LEVEL as R, PAVEMENT_LEVEL as G } from './city-grid.js';
import { cityLayout, cityRigidFrame } from './city-layout.js';
import { walkerPose } from './city-life.js';

// A rotated construction frame lets both orientations share bridge and bank
// design. At confluences the land is the four corner parcels, not two crossing
// ground slabs, so water remains continuous in every direction.
function riverBuilder(c, axis) {
  const east = axis === 'east', point = (x, s) => east ? [s, 112 - x] : [x, s];
  return {
    point,
    box: (x, y, s, w, h, d, color, kind = 'solid', roll = 0) => {
      const [px, ps] = point(x, s);
      if (roll) c.box(px, y, ps, w, h, d, color, kind, east ? -Math.PI / 2 : 0, roll);
      else c.box(px, y, ps, east ? d : w, h, east ? w : d, color, kind);
    },
    surface: (x, y, s, w, h, d, color, kind = 'solid') => {
      const [px, ps] = point(x, s); c.surface(px, y, ps, east ? d : w, h, east ? w : d, color, kind);
    },
    solid: (x, s, w, d, flexible = false) => { const [px, ps] = point(x, s); c.solid(px, ps, east ? d : w, east ? w : d, flexible); },
    tree: (x, s, size) => { const [px, ps] = point(x, s); c.tree(px, ps, size); },
    prop: (name, x, s, yaw = 0) => { const [px, ps] = point(x, s); c.prop(name, px, ps, yaw - (east ? Math.PI / 2 : 0)); },
  };
}

export function buildRiverGround(c) {
  const { west, east, south, north } = blockStreets(c.ix, c.iz), cuts = [0, 28, 84, 112];
  for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) {
    const x0 = cuts[x], x1 = cuts[x + 1], z0 = cuts[z], z1 = cuts[z + 1];
    if ((c.plan.rivers.north && x === 1) || (c.plan.rivers.east && z === 1)) {
      c.surface((x0 + x1) / 2, W - .12, (z0 + z1) / 2, x1 - x0, .24, z1 - z0, '#ffffff', 'water');
    } else {
      c.surface((x0 + x1) / 2, 20.85, (z0 + z1) / 2, x1 - x0, 6.2, z1 - z0, '#888f8e');
      const left = Math.max(x0, west.halfWidth), right = Math.min(x1, 112 - east.halfWidth);
      const bottom = Math.max(z0, south.halfWidth), top = Math.min(z1, 112 - north.halfWidth);
      c.surface((left + right) / 2, 24.06, (bottom + top) / 2, right - left, .12, top - bottom, '#afb0a5');
    }
  }
}

export function buildRivers(c) {
  const streets = blockStreets(c.ix, c.iz), confluence = c.plan.rivers.north && c.plan.rivers.east;
  for (const axis of ['north', 'east']) {
    if (!c.plan.rivers[axis]) continue;
    const b = riverBuilder(c, axis), profiles = axis === 'north' ? [streets.south, streets.north] : [streets.west, streets.east];
    for (const [edge, sign, street] of [[0, 1, profiles[0]], [112, -1, profiles[1]]]) {
      const width = Math.max(10.8, street.halfWidth + 2.8), railS = edge + sign * (width - .2);
      b.surface(56, 23.49, edge + sign * width / 2, 58, .98, width, '#929b99');
      b.surface(56, 24.06, edge + sign * (street.halfWidth + width) / 2, 58, .12, width - street.halfWidth, '#b6b2a4');
      const [x, s] = b.point(56, railS), address = { s: c.start + s, u: c.east + x };
      const start = b.point(27.6, railS), end = b.point(84.4, railS);
      const a = cityLayout(c.start + start[1], c.east + start[0]), d = cityLayout(c.start + end[1], c.east + end[0]);
      const heading = axis === 'north' ? Math.atan2(a.s - d.s, d.u - a.u) : Math.atan2(a.u - d.u, a.s - d.s);
      const stretch = Math.hypot(d.s - a.s, d.u - a.u) / 56.8;
      const frame = { ...cityRigidFrame(address.s, address.u, heading), s: (a.s + d.s) / 2, u: (a.u + d.u) / 2 };
      c.structure(x, s, () => {
        b.box(56, 24.8, railS, 56.8 * stretch, 1.1, .45, '#c9bd9f'); b.solid(56, railS, 56.8 * stretch, .45);
        b.box(56, 30.7, railS, 47 * stretch, .48, .5, '#7d6657');
        for (const offset of [-23, -11.5, 0, 11.5, 23]) {
          const px = 56 + offset * stretch;
          b.box(px, 27.3, railS, .6, 6.8, .65, '#7d6657');
          if (Math.abs(offset) === 23) b.box(px, 20.6, railS, 3.2, 6.2, 2.5, '#87938f');
        }
        for (let k = 0; k < 4; k++) {
          const run = 11.5 * stretch, rise = (k % 2 ? -1 : 1) * 5.4;
          b.box(56 + (k - 1.5) * run, 27.8, railS, Math.hypot(run, rise), .32, .4, '#7d6657', 'solid', Math.atan2(rise, run));
        }
      }, frame);
      const bridge = b.point(56, edge);
      c.features.bridges.push({ s: c.start + bridge[1], u: c.east + bridge[0], axis: axis === 'north' ? 'east' : 'north', halfWidth: street.halfWidth, height: R });
    }
    const bankStart = Math.max(10.8, profiles[0].halfWidth + 2.8) - .2;
    const bankEnd = 112 - Math.max(10.8, profiles[1].halfWidth + 2.8) + .2;
    for (const x of [27.6, 84.4]) for (const [start, end] of confluence ? [[bankStart, 27.6], [84.4, bankEnd]] : [[bankStart, bankEnd]]) {
      b.surface(x, 24.85, (start + end) / 2, .18, .14, end - start, '#52676a');
      b.surface(x, 24.46, (start + end) / 2, .12, .1, end - start, '#52676a');
      for (let s = start; s <= end; s += 4) b.box(x, 24.52, s, .13, .95, .13, '#52676a');
      b.solid(x, (start + end) / 2, .3, end - start, true);
    }
    // Alternate formal quays and planted embankments. A continuous path stays
    // beside the road while small green wedges soften the edge of the water.
    if ((c.plan.seed % 4 !== 0) && (!confluence || axis === 'north')) {
      for (const x of [22, 90]) for (const [start, end] of confluence ? [[16, 26], [86, 96]] : [[18, 94]]) {
        b.surface(x, G + .018, (start + end) / 2, 9, .036, end - start, '#799566');
        if (!confluence) b.surface(x < 56 ? 14.5 : 97.5, G + .035, 56, 2.8, .03, 76, '#c8bda3');
      }
    }
    // Avoid duplicate furniture on the four corner gardens at a confluence.
    if (!confluence || axis === 'north') for (const x of [18, 94]) for (const s of confluence ? [20, 92] : [26, 48, 70, 92]) {
      b.tree(x, s, 6.5); b.prop('bench', x + (x < 56 ? 5 : -5), s + 5, x < 56 ? Math.PI : 0);
      if (s === 26 || s === 92) b.prop('lamp', x, s - 7);
    }
    // Surface highlights belong to the shared animated water material.
  }
}

export function riverResidentPose(c, walker, time) {
  if (c.plan.rivers.north && c.plan.rivers.east) {
    const direction = walker.direction ?? 1;
    const t = ((walker.phase + time * walker.speed * direction) % 20 + 20) % 20, along = t < 10 ? t : 20 - t;
    const north = t === 0 || (t !== 10 && (t < 10) === (direction > 0));
    return { x: walker.side % 2 ? 97.5 : 14.5, s: (walker.side < 2 ? 14.5 : 87.5) + along, yaw: north ? 0 : Math.PI };
  }
  const p = walkerPose(walker, time, true);
  return c.plan.rivers.east ? { x: p.s, s: 112 - p.x, yaw: p.yaw - Math.PI / 2 } : p;
}

export function riverBoatPosition(c, x, s) {
  return c.plan.rivers.east && !c.plan.rivers.north ? { x: s, s: 112 - x, yaw: -Math.PI / 2 } : { x, s, yaw: 0 };
}
