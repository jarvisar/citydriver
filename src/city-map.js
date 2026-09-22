import { CITY_BLOCK, cityBlock, cityStreetProfile, cityMedianRange } from './world/city-grid.js';
import { cityRoutePoints } from './world/city-layout.js';

// Cache world geometry, not pixels: routes, heading, passengers and selection
// still redraw immediately. Only the current 9 x 7 map footprint is retained.
export function buildMapBlock(x, z) {
  const west = cityStreetProfile('north', x), east = cityStreetProfile('north', x + 1);
  const south = cityStreetProfile('east', z), north = cityStreetProfile('east', z + 1);
  const b = cityBlock(x, z), u = x * CITY_BLOCK, s = z * CITY_BLOCK, shapes = [];
  const polygon = (color, x0, z0, x1, z1) => {
    const points = cityRoutePoints([{ u: x0, s: z0 }, { u: x1, s: z0 }, { u: x1, s: z1 }, { u: x0, s: z1 }, { u: x0, s: z0 }], 14);
    shapes.push({ color, points });
  };
  polygon(b.kind === 'park' || b.landmark === 'garden' ? '#4e705d' : b.landmark ? '#697369' : '#3a5155',
    u + west.halfWidth, s + south.halfWidth, u + CITY_BLOCK - east.halfWidth, s + CITY_BLOCK - north.halfWidth);
  if (b.kind === 'river') {
    if (b.rivers.north) polygon('#477e8b', u + 28, s, u + 84, s + CITY_BLOCK);
    if (b.rivers.east) polygon('#477e8b', u, s + 28, u + CITY_BLOCK, s + 84);
    if (b.rivers.north) {
      polygon('#718e8d', u + 27, s - south.halfWidth, u + 85, s + south.halfWidth);
      polygon('#718e8d', u + 27, s + CITY_BLOCK - north.halfWidth, u + 85, s + CITY_BLOCK + north.halfWidth);
    }
    if (b.rivers.east) {
      polygon('#718e8d', u - west.halfWidth, s + 27, u + west.halfWidth, s + 85);
      polygon('#718e8d', u + CITY_BLOCK - east.halfWidth, s + 27, u + CITY_BLOCK + east.halfWidth, s + 85);
    }
  }
  if (west.median && !b.rivers.east) {
    const [start, end] = cityMedianRange('north', z);
    polygon('#7c9667', u - west.median, s + start, u + west.median, s + end);
  }
  if (south.median && !b.rivers.north) {
    const [start, end] = cityMedianRange('east', x);
    polygon('#7c9667', u + start, s - south.median, u + end, s + south.median);
  }
  return { u, s, shapes };
}

export class CityMapCache {
  constructor(build = buildMapBlock, makePath = () => new Path2D()) {
    this.build = build; this.makePath = makePath; this.blocks = new Map(); this.center = null;
  }
  update(ix, iz) {
    const key = `${ix},${iz}`;
    if (this.center === key) return;
    this.center = key;
    const previous = this.blocks;
    this.blocks = new Map();
    // Preserve the original painter order, even after reversing or teleporting.
    for (let x = ix - 4; x <= ix + 4; x++) for (let z = iz - 3; z <= iz + 3; z++) {
      const index = `${x},${z}`;
      let block = previous.get(index);
      if (!block) {
        block = this.build(x, z);
        for (const shape of block.shapes) {
          shape.path = this.makePath();
          shape.points.forEach((p, i) => {
            const method = i ? 'lineTo' : 'moveTo';
            shape.path[method](p.u - block.u, p.s - block.s);
          });
          shape.path.closePath();
          delete shape.points;
        }
      }
      this.blocks.set(index, block);
    }
  }
  draw(ctx, vehicle, scale, width, height) {
    ctx.save();
    for (const block of this.blocks.values()) {
      ctx.save();
      ctx.translate(width / 2 + (block.u - vehicle.u) * scale, height / 2 - (block.s - vehicle.s) * scale);
      ctx.scale(scale, -scale);
      for (const shape of block.shapes) { ctx.fillStyle = shape.color; ctx.fill(shape.path); }
      ctx.restore();
    }
    ctx.restore();
  }
}
