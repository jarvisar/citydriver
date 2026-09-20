// Generation-only footprint checks. Polygons use rendered world coordinates,
// so scaled landmarks and curved streets share the same clearance rule.
export class CityPlanting {
  constructor() { this.footprints = []; }
  reserve(points, margin = .35) {
    this.footprints.push({ points, margin,
      minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)),
      minZ: Math.min(...points.map(p => p.z)), maxZ: Math.max(...points.map(p => p.z)) });
  }
  clears(p, radius) {
    return this.footprints.every(({ points, margin, minX, maxX, minZ, maxZ }) => {
      const r = radius + margin;
      if (p.x < minX - r || p.x > maxX + r || p.z < minZ - r || p.z > maxZ + r) return true;
      let inside = false;
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        if ((a.z > p.z) !== (b.z > p.z) && p.x < a.x + (b.x - a.x) * (p.z - a.z) / (b.z - a.z)) inside = !inside;
        const dx = b.x - a.x, dz = b.z - a.z;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
        if ((p.x - a.x - t * dx) ** 2 + (p.z - a.z - t * dz) ** 2 <= r * r) return false;
      }
      return !inside;
    });
  }
}
