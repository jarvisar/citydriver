import { randomAt } from './route.js';
import { RIVER_PERIOD, RIVER_COLUMN, CROSS_RIVER_PERIOD, CROSS_RIVER_ROW } from './city-waterways.js';

// A logical street address stays stable while selected neighborhoods grow
// around waterways. Compact envelopes leave large, exactly rectangular areas
// between them. The displacement gradients stay below one, so the map can be
// inverted without folded blocks or disconnected streets, even below zero.
const B = 112;
const TAU = Math.PI * 2;
const fade = t => { t = Math.max(0, Math.min(1, t)); return t * t * t * (t * (t * 6 - 15) + 10); };
const bell = (distance, inner, outer) => 1 - fade((Math.abs(distance) - inner) / (outer - inner));
// Physics, traffic and walkers call this tens of thousands of times a second.
// Hashing an index is cheaper than a string-keyed cache and allocates nothing.
export function cityLayout(s, u) {
  const river = Math.round((u / B - RIVER_COLUMN - .5) / RIVER_PERIOD), center = (river * RIVER_PERIOD + RIVER_COLUMN + .5) * B;
  const phase = randomAt(river, 9351) * TAU;
  const waterfront = bell(u - center, B * .5, B * 2.1);
  let du = waterfront * (22 * Math.sin(s / (B * 1.7) + phase) + 8 * Math.sin(s / (B * 3.7) + phase * 2));
  const crossRiver = Math.round((s / B - CROSS_RIVER_ROW - .5) / CROSS_RIVER_PERIOD);
  const crossCenter = (crossRiver * CROSS_RIVER_PERIOD + CROSS_RIVER_ROW + .5) * B;
  const crossPhase = randomAt(crossRiver, 9354) * TAU;
  let ds = bell(s - crossCenter, B * .5, B * 2.1) * (22 * Math.sin(u / (B * 1.9) + crossPhase) + 8 * Math.sin(u / (B * 4.1) + crossPhase * 2));
  const rx = Math.floor(u / (B * 8)), rz = Math.floor(s / (B * 8));
  if (randomAt(rx, rz + 9352) < .55) {
    const districtPhase = randomAt(rx, rz + 9353) * TAU;
    const x = u - (rx * 8 + 4) * B, z = s - (rz * 8 + 4) * B;
    const amount = bell(x, B * .6, B * 3.1) * bell(z, B * .6, B * 3.1);
    du += amount * 14 * Math.sin(z / (B * 1.5) + districtPhase);
    ds += amount * 22 * Math.sin(x / (B * 1.8) - districtPhase);
  }
  return { s: s + ds, u: u + du };
}

export function cityLogical(s, u) {
  let ls = s, lu = u;
  for (let i = 0; i < 40; i++) {
    const p = cityLayout(ls, lu), ds = s - p.s, du = u - p.u;
    ls += ds; lu += du;
    if (Math.abs(ds) + Math.abs(du) < 1e-8) break;
  }
  return { s: ls, u: lu };
}

export function cityLayoutFrame(s, u) {
  const p = cityLayout(s, u), n = cityLayout(s + .1, u), e = cityLayout(s, u + .1);
  return { ...p, ns: (n.s - p.s) * 10, nu: (n.u - p.u) * 10, es: (e.s - p.s) * 10, eu: (e.u - p.u) * 10 };
}

export function cityRigidFrame(s, u, heading = null) {
  const f = cityLayoutFrame(s, u);
  // Closest pure rotation to the local layout: preserve every length and angle.
  const angle = heading ?? Math.atan2(f.nu - f.es, f.ns + f.eu), cos = Math.cos(angle), sin = Math.sin(angle);
  return { s: f.s, u: f.u, ns: cos, nu: sin, es: -sin, eu: cos, heading: angle };
}

export function cityLanePose(axis, lane, along, direction = 1) {
  const frame = cityLayoutFrame(axis === 'north' ? along : lane, axis === 'north' ? lane : along);
  const ds = axis === 'north' ? frame.ns : frame.es, du = axis === 'north' ? frame.nu : frame.eu;
  return { s: frame.s, u: frame.u, heading: Math.atan2(du * direction, ds * direction), stretch: Math.hypot(ds, du) };
}

// Sample in address space before mapping, so a long navigation leg follows
// bends rather than drawing a chord across buildings or open water.
export function cityRoutePoints(points, step = 8) {
  const result = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)], b = points[i];
    const count = i ? Math.max(1, Math.ceil(Math.hypot(b.s - a.s, b.u - a.u) / step)) : 1;
    for (let n = 1; n <= count; n++) result.push(cityLayout(a.s + (b.s - a.s) * n / count, a.u + (b.u - a.u) * n / count));
  }
  return result;
}
