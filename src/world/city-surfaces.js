// Split a convex polygon without moving it off its original terrain plane.
// Both halves share the same intersection vertices, avoiding cracks or layers
// competing for depth where grass meets paving.
function split(points, distance) {
  const inside = [], outside = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], da = distance(a), db = distance(b);
    (da >= 0 ? inside : outside).push(a);
    if ((da > 0 && db < 0) || (da < 0 && db > 0)) {
      const t = da / (da - db), p = {};
      for (const key of ['x', 'y', 'z', 's', 'u']) if (a[key] !== undefined) p[key] = a[key] + (b[key] - a[key]) * t;
      inside.push(p); outside.push(p);
    } else if (da === 0) outside.push(a);
  }
  return { inside, outside };
}

function partition(points, outline, axes = ['s', 'u']) {
  const [x, y] = axes;
  const area = outline.reduce((sum, a, i) => { const b = outline[(i + 1) % outline.length]; return sum + a[x] * b[y] - b[x] * a[y]; }, 0);
  const sign = Math.sign(area), outside = [];
  let inside = points;
  for (let i = 0; i < outline.length && inside.length >= 3; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    const parts = split(inside, p => sign * ((b[x] - a[x]) * (p[y] - a[y]) - (b[y] - a[y]) * (p[x] - a[x])));
    if (parts.outside.length >= 3) outside.push(parts.outside);
    inside = parts.inside;
  }
  return { inside: inside.length >= 3 ? inside : [], outside };
}

const rectangle = (s0, s1, u0, u1) => [{ s: s0, u: u0 }, { s: s1, u: u0 }, { s: s1, u: u1 }, { s: s0, u: u1 }];

export function cityParkLayout(site) {
  return {
    boundary: rectangle(site.s - site.halfS, site.s + site.halfS, site.u0, site.u1),
    paths: [rectangle(site.s - 2.5, site.s + 2.5, site.u0, site.u1),
      rectangle(site.s - site.halfS, site.s + site.halfS, site.u - 2.5, site.u + 2.5),
      Array.from({ length: 16 }, (_, i) => ({ s: site.s + 11.5 * Math.cos(i * Math.PI / 8), u: site.u + 11.5 * Math.sin(i * Math.PI / 8) }))],
  };
}

export function paintCityPark(triangle, layout, emit) {
  const park = partition(triangle, layout.boundary);
  for (const polygon of park.outside) emit(polygon, 'outside');
  let lawn = park.inside.length ? [park.inside] : [];
  for (const outline of layout.paths) {
    const remaining = [];
    for (const polygon of lawn) {
      const parts = partition(polygon, outline);
      if (parts.inside.length) emit(parts.inside, 'paving');
      remaining.push(...parts.outside);
    }
    lawn = remaining;
  }
  for (const polygon of lawn) emit(polygon, 'grass');
}

// Small courtyard lawns use the actual terrain triangles, clipped to their
// footprint, rather than one large quad that can cut through a slope.
export function drapeCityLawn(chunk, target, corners, color) {
  const outline = corners.map(([s, u]) => chunk.at(s, u, 0));
  const minX = Math.min(...outline.map(p => p.x)), maxX = Math.max(...outline.map(p => p.x));
  const minZ = Math.min(...outline.map(p => p.z)), maxZ = Math.max(...outline.map(p => p.z));
  const positions = chunk.terrain.geometry.attributes.position;
  for (let i = 0; i < positions.count; i += 3) {
    // Reject distant facets before allocating polygon vertices; most lawns
    // touch only a handful of the chunk's terrain triangles.
    if (Math.max(positions.getX(i), positions.getX(i + 1), positions.getX(i + 2)) < minX ||
        Math.min(positions.getX(i), positions.getX(i + 1), positions.getX(i + 2)) > maxX ||
        Math.max(positions.getZ(i), positions.getZ(i + 1), positions.getZ(i + 2)) < minZ ||
        Math.min(positions.getZ(i), positions.getZ(i + 1), positions.getZ(i + 2)) > maxZ) continue;
    const points = [0, 1, 2].map(j => ({ x: positions.getX(i + j), y: positions.getY(i + j), z: positions.getZ(i + j) }));
    const { inside } = partition(points, outline, ['x', 'z']);
    for (let j = 1; j < inside.length - 1; j++) for (const p of [inside[0], inside[j], inside[j + 1]]) {
      target.vertices.push(p.x, p.y + .035, p.z); target.colors.push(color.r, color.g, color.b);
    }
  }
}
