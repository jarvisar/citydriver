import { CITY_BLOCK as B, ROAD_LEVEL as R, PAVEMENT_LEVEL as G, cityStreetProfile, cityMedianRange, cityJunctionControl } from './city-grid.js';

export function blockStreets(ix, iz) {
  return { west: cityStreetProfile('north', ix), east: cityStreetProfile('north', ix + 1), south: cityStreetProfile('east', iz), north: cityStreetProfile('east', iz + 1) };
}

export function buildStreets(c) {
  const { west, east, south, north } = blockStreets(c.ix, c.iz);
  const middleS = (south.halfWidth + B - north.halfWidth) / 2, length = B - south.halfWidth - north.halfWidth;
  c.box(B / 2, R - .02, south.halfWidth / 2, B, .04, south.halfWidth, '#ffffff', 'road');
  c.box(B / 2, R - .02, B - north.halfWidth / 2, B, .04, north.halfWidth, '#ffffff', 'road');
  c.box(west.halfWidth / 2, R - .02, middleS, west.halfWidth, .04, length, '#ffffff', 'road');
  c.box(B - east.halfWidth / 2, R - .02, middleS, east.halfWidth, .04, length, '#ffffff', 'road');
  for (const [axis, profile] of [['north', west], ['east', south]]) {
    const along = (p, across, width, depth, color, y = R + .017, h = .018) => {
      if (axis === 'north') c.box(across, y, p, width, h, depth, color);
      else c.box(p, y, across, depth, h, width, color);
    };
    const [start, end] = cityMedianRange(axis, axis === 'north' ? c.iz : c.ix);
    if (profile.kind === 'avenue') for (let p = start; p < end; p += 11) along(p + 2, .16, .13, 4, '#d8bd80');
    if (profile.kind === 'boulevard') {
      // The west/south owner draws each complete median once. River spans
      // keep an uninterrupted deck and receive center lines instead.
      const planted = axis === 'north' || c.plan.kind !== 'river';
      if (planted) {
        const center = (start + end) / 2;
        along(center, 0, profile.median * 2, end - start, '#c3bfab', R + .11, .22);
        along(center, 0, profile.median * 2 - .4, end - start - .6, '#779757', G + .13, .06);
        c.features.medians.push({ axis, line: axis === 'north' ? c.east : c.start, start: (axis === 'north' ? c.start : c.east) + start, end: (axis === 'north' ? c.start : c.east) + end, halfWidth: profile.median });
        for (const p of [start + 11, center, end - 11]) {
          const before = c.features.colliders.length;
          c.tree(axis === 'north' ? 0 : p, axis === 'north' ? p : 0, 7.5 + c.random() * 1.5);
          for (let i = before; i < c.features.colliders.length; i++) c.features.colliders[i].kind = 'median-tree';
        }
      } else for (let p = start; p < end; p += 11) along(p, .16, .13, 5, '#d8bd80');
      for (const sign of [-1, 1]) {
        along((start + end) / 2, sign * (profile.median + .4), .12, end - start, '#d8bd80');
        along((start + end) / 2, sign * (profile.halfWidth - .6), .13, end - start, '#d7d8c9');
      }
    }
  }
  // Each block supplies a quarter of the crossing, using its actual width.
  for (const [x, nx, dx] of [[0, west, 1], [B, east, -1]]) for (const [s, ex, ds] of [[0, south, 1], [B, north, -1]]) {
    for (let p = .9; p < nx.halfWidth - .4; p += 1.7) c.box(x + dx * p, R + .017, s + ds * (ex.halfWidth + 3), .9, .018, 2.8, '#deddd0');
    for (let p = .9; p < ex.halfWidth - .4; p += 1.7) c.box(x + dx * (nx.halfWidth + 3), R + .017, s + ds * p, 2.8, .018, .9, '#deddd0');
  }
  const approaches = [
    { axis: 'east', direction: -1, index: c.iz, cross: c.ix, x: west.halfWidth + 6, s: south.halfWidth + 1.8, yaw: Math.PI / 2, profile: south, stop: west.halfWidth + 5 },
    { axis: 'north', direction: -1, index: c.ix + 1, cross: c.iz, x: B - east.halfWidth - 1.8, s: south.halfWidth + 6, yaw: Math.PI, profile: east, stop: south.halfWidth + 5 },
    { axis: 'north', direction: 1, index: c.ix, cross: c.iz + 1, x: west.halfWidth + 1.8, s: B - north.halfWidth - 6, yaw: 0, profile: west, stop: B - north.halfWidth - 5 },
    { axis: 'east', direction: 1, index: c.iz + 1, cross: c.ix + 1, x: B - east.halfWidth - 6, s: B - north.halfWidth - 1.8, yaw: -Math.PI / 2, profile: north, stop: B - east.halfWidth - 5 },
  ];
  for (const a of approaches) {
    const control = cityJunctionControl(a.axis, a.index, a.cross);
    c.features.junctions.push({ axis: a.axis, direction: a.direction, control, x: c.east + a.x, s: c.start + a.s });
    if (control === 'priority') continue;
    const lane = a.index * B - (a.axis === 'north' ? c.east : c.start) + (a.axis === 'north' ? 1 : -1) * a.direction * a.profile.lane;
    const paintWidth = a.profile.kind === 'boulevard' ? 6.6 : a.profile.halfWidth - .8;
    if (a.axis === 'north') c.box(lane, R + .02, a.stop, paintWidth, .02, .3, '#e1dfce');
    else c.box(a.stop, R + .02, lane, .3, .02, paintWidth, '#e1dfce');
    if (c.distant) continue;
    c.prop(control === 'stop' ? 'stop' : 'signal', a.x, a.s, a.yaw); c.post(a.x, a.s, .15);
    if (control === 'signal') {
      const indices = [];
      for (const y of [4.92, 4.6, 4.28]) {
        const x = a.x + Math.sin(a.yaw) * .2, s = a.s - Math.cos(a.yaw) * .2;
        c.box(x, G + y, s, .2, .2, .035, '#293538', 'lit', a.yaw);
        indices.push(c.batches.get('lit').items.length - 1);
      }
      c.features.signals.push({ axis: a.axis, indices });
    }
  }
}
