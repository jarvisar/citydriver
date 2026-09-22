import { seededRandom } from './route.js';
import { PAVEMENT_LEVEL as G, CITY_BLOCK as B } from './city-grid.js';
import { cityLayout, cityLogical, cityRigidFrame } from './city-layout.js';
import { rectangleCorners, parcelsOverlap, footprintFitsBlock } from './city-parcels.js';
import { rectanglePolygon, pathPanels, subtractPolygon, signedArea } from './city-surfaces.js';
import { grassArea } from './city-grass.js';
import { cityTrees } from './city-assets.js';

const WALK_WIDTH = 4.4;
const crownRadius = Math.max(...cityTrees.map(tree => tree.radius)) * 1.06;

// Work from the fitted buildings, in physical space. The same reservations
// cover furniture, planting and walking room, even where streets bend.
export function planCourtyard(block, architecture, placement) {
  const east = block.ix * B, start = block.iz * B, turn = architecture.rotation;
  const rotate = (x, s) => {
    for (let i = 0; i < turn; i++) [x, s] = [B - s, x];
    return [x, s];
  };
  const mapped = ([x, s]) => cityLayout(start + s, east + x);
  const blocked = corners => placement.buildings.some(b => parcelsOverlap(corners, b.corners, 1.4));
  const panels = points => pathPanels(points, WALK_WIDTH).map(p => p.map(mapped));
  let route = null, score = -Infinity;
  // Find a continuous walk, ending before a rear wing instead of running
  // paving through it. Prefer a connection to the surrounding sidewalk.
  for (const lane of [56, 53, 59, 50, 62]) {
    let run = [];
    const finish = () => {
      if (run.length < 5) { run = []; return; }
      const value = run.length * 2 + (run[0] === 16 || run.at(-1) === 96 ? 30 : 0) - Math.abs(lane - 56) * .4;
      if (value > score) { score = value; route = { lane, from: run[0], to: run.at(-1) }; }
      run = [];
    };
    for (let along = 16; along <= 96; along += 2) {
      const [x, s] = rotate(along, lane);
      const f = cityRigidFrame(start + s, east + x);
      if (blocked(rectangleCorners(f, 7, 7))) finish();
      else run.push(along);
    }
    finish();
  }
  const walks = route ? [{ points: [rotate(route.from, route.lane), rotate(route.to, route.lane)], width: WALK_WIDTH }] : [];
  const walkReservations = walks.flatMap(walk => panels(walk.points));
  const islands = [], occupied = [...walkReservations];
  const random = seededRandom(block.seed ^ 0x27d4eb2d);
  if (route) for (const along of [30, 47, 64, 81]) for (const side of [-1, 1]) {
    if (along < route.from + 5 || along > route.to - 5) continue;
    const scale = 6.5 + random() * 1.2;
    let fitted = null;
    for (const shift of [0, -3, 3]) {
      const [x, s] = rotate(along + shift, route.lane + side * 8.5);
      const frame = cityRigidFrame(start + s, east + x);
      // Includes the full crown and the bench's approach, not just its trunk.
      const radius = Math.max(4.4, scale * crownRadius);
      const corners = rectangleCorners(frame, radius * 2, radius * 2);
      if (!footprintFitsBlock(block, corners, 3) || blocked(corners) || occupied.some(p => parcelsOverlap(corners, p, 1.1))) continue;
      fitted = { x, s, frame, corners, scale, side, turn };
      break;
    }
    if (fitted) { islands.push(fitted); occupied.push(fitted.corners); }
  }
  // Rejected lots are only lawns where space remains after fitting neighbors.
  // Sample the expanded rigid edges before returning to curved map space.
  const exclusions = placement.buildings.map(b => {
    const corners = rectangleCorners(b.frame, b.width, b.depth, 2);
    return corners.flatMap((a, i) => {
      const next = corners[(i + 1) % corners.length];
      return [0, .5].map(t => {
        const p = cityLogical(a.s + (next.s - a.s) * t, a.u + (next.u - a.u) * t);
        return [p.u - east, p.s - start];
      });
    });
  });
  const reserves = [...exclusions, ...walks.flatMap(walk => pathPanels(walk.points, walk.width + 2)), ...islands.map(island =>
    island.corners.map(p => { const q = cityLogical(p.s, p.u); return [q.u - east, q.s - start]; }))];
  const lawns = [];
  for (const b of placement.open) {
    let pieces = [rectanglePolygon(b.x, b.s, b.width, b.depth)];
    for (const reserve of reserves) pieces = pieces.flatMap(p => subtractPolygon(p, reserve));
    lawns.push(...pieces.filter(p => Math.abs(signedArea(p)) > 4));
  }
  return { walks, islands, lawns };
}

export function buildCourtyard(c, architecture, placement) {
  const plan = planCourtyard(c.plan, architecture, placement);
  c.features.courtyard = plan;
  for (const walk of plan.walks) {
    c.recordPath(walk.points, walk.width);
    // A light border gives the passage a finished edge without a raised curb.
    for (const panel of pathPanels(walk.points, walk.width + .5)) c.polygon(panel, G + .018, .02, '#c6c0ad');
    for (const panel of pathPanels(walk.points, walk.width)) c.polygon(panel, G + .033, .02, '#929e99');
  }
  for (const lawn of plan.lawns) {
    c.polygon(lawn, G + .02, .04, '#7c956c');
    grassArea(c, lawn, '#7c956c', G + .04);
  }
  for (const island of plan.islands) {
    const { x, s, frame, scale, side, turn } = island;
    const yaw = turn * Math.PI / 2, cos = Math.cos(yaw), sin = Math.sin(yaw);
    const point = (u, v) => [x + u * cos - v * sin, s + u * sin + v * cos];
    c.rigid(x, s, () => {
      c.box(x, G + .04, s, 8.4, .08, 8.4, '#b8b8a9');
      c.box(x, G + .24, s, 7.4, .48, 4.4, '#c8bfaa', 'solid', yaw);
      c.box(x, G + .49, s, 6.9, .06, 3.9, '#809269', 'solid', yaw);
      // Keep one compact tree centered in its bed; the surrounding planting
      // supplies detail without adding another overlapping canopy.
      c.tree(x, s, scale);
      const [bx, bs] = point(0, -side * 3.3);
      const benchYaw = yaw + side * Math.PI / 2;
      c.prop('bench', bx, bs, benchYaw, G + .08);
      c.solid(x, s, turn % 2 ? 4.4 : 7.4, turn % 2 ? 7.4 : 4.4);
      c.solid(bx, bs, turn % 2 ? .75 : 2.1, turn % 2 ? 2.1 : .75);
      for (const offset of [-2.6, 2.6]) {
        const [px, ps] = point(offset, 0);
        c.box(px, G + .69, ps, 1.1, .35, 1.3, '#6f875d', 'solid', yaw);
      }
    }, frame);
  }
}
