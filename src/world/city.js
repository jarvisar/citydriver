import * as THREE from 'three';
import { registerChunkResources } from './chunk-resources.js';
import { finalizeChunkTransforms } from './chunk-transforms.js';
import { splitBatch } from './instance-batches.js';
import { updateResidentChunks } from './resident.js';
import { CHUNK_LENGTH, randomAt, seededRandom, smoothstep, lerp, roadFrame } from './route.js';
import { CITY_STEP, CITY_COLUMN_COUNT, KERB, PAVEMENT_LIFT, cityVertex, cityPosition, cityRoadHeight, cityGroundHeight, pavementHeight, quayOffset, RIVER_LEVEL,
  FAR_BANK, FAR_BANK_TOP, QUAY_WALL, blockBoundary, blockAt, crossStreetAt, nearStreet, onCrossStreet, STREET_HALF_WIDTH, BANDS, SKYLINE_FROM,
  BANK_BANDS, BANK_ROADS, SIDE_ROAD_HALF_WIDTH, onRiverCrossing } from './city-route.js';
import { createRiverMaterial, animateWater } from './water.js';
import { terrainSampler } from './coastal-assets.js';
import { cityAssets, cityTrees, parkedCars, PARKED_PAINTS } from './city-assets.js';
import { dressBuilding, buildShopfront, rooftopTank, dressSkyline } from './city-architecture.js';
import { buildPromenade } from './city-promenade.js';
import { buildCityParking, cityParkingAt } from './city-parking.js';
import { cityParkLayout, paintCityPark } from './city-surfaces.js';
import { buildCityRoads } from './city-roads.js';
import { buildNeighborhoods } from './city-neighborhoods.js';
import { cityDiscoveries, cityDiscoveryClears, cityLotClears, cityBuildingSpans } from './city-discoveries.js';
import { buildCityDiscoveries, reserveCityLandmarks } from './city-discovery-scenery.js';
import { solidModel, solidSpan } from './colliders.js';
import { CityPlanting } from './city-planting.js';
import { Rainfall } from './rainfall.js';

const material = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true, ...extra });
const terrainMaterial = material('#ffffff', { vertexColors: true });
// Wet asphalt: darker than the other routes' roads and glossy enough to take
// a broad sheen from the weak sun.
const roadMaterial = material('#4d5155', { roughness: .5, flatShading: false });
const kerbMaterial = material('#a4a7a9', { flatShading: false });
const edgeMaterial = material('#c3c6c3', { flatShading: false });
const centerMaterial = material('#bda041', { flatShading: false });
const waterMaterial = createRiverMaterial();
const blocksMaterial = material('#ffffff', { vertexColors: true, roughness: .92 });
const streetsMaterial = material('#ffffff', { vertexColors: true, roughness: .5, flatShading: false });
const skylineMaterial = material('#ffffff', { vertexColors: true });
// Lit windows ignore the weather: an unlit material reads as light from inside.
const litMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
const furnitureMaterial = material('#ffffff', { vertexColors: true, roughness: .9 });
const paintedMaterial = material('#ffffff');
const parkedPaintMaterial = material('#ffffff', { roughness: .6 });
const parkedTrimMaterial = material('#ffffff', { vertexColors: true, roughness: .76 });
const leavesMaterial = material('#ffffff', { vertexColors: true });
const barkMaterial = material('#55483b');
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const dummy = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0);
registerChunkResources('city', { terrainMaterial, roadMaterial, kerbMaterial, edgeMaterial, centerMaterial, waterMaterial, blocksMaterial, streetsMaterial, skylineMaterial, litMaterial,
  furnitureMaterial, paintedMaterial, parkedPaintMaterial, parkedTrimMaterial, leavesMaterial, barkMaterial, boxGeometry, cityAssets, parkedCars, trees: cityTrees });

function geometry(vertices, colors) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals(); g.computeBoundingSphere(); return g;
}
function triangle(vertices, colors, a, b, c, color, start, coordinates) {
  if ((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) < 0) [b, c] = [c, b];
  for (const p of [a, b, c]) {
    vertices.push(p.x, p.y, p.z + start);
    if (colors) colors.push(color.r, color.g, color.b);
    if (coordinates) coordinates.push(p.u, p.s);
  }
}
function instances(group, geo, mat, items, name, shadows = true, ambientOcclusion = true) {
  if (!items.length) return;
  for (const part of splitBatch(items)) {
    const mesh = new THREE.InstancedMesh(geo, mat, part.length); mesh.name = name;
    for (let i = 0; i < part.length; i++) {
      const item = part[i]; dummy.position.set(...item.p); dummy.rotation.set(...(item.r ?? [0, 0, 0]));
      if (item.q) dummy.quaternion.copy(item.q);
      dummy.scale.set(...(item.scale ?? [1, 1, 1])); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      if (item.color) mesh.setColorAt(i, new THREE.Color(item.color));
    }
    mesh.castShadow = shadows; mesh.receiveShadow = true;
    if (!ambientOcclusion) mesh.userData.ambientOcclusion = false;
    mesh.computeBoundingSphere(); group.add(mesh);
  }
}

// The palette is cool and wet: grey stone, dark brick, concrete, a little
// painted render, with warm accents on fascias, awnings and lit windows.
const WALLS = ['#846159', '#8f7064', '#755955', '#9e9ea2', '#aba7a2', '#b4b7ba', '#a0a5aa', '#90a2ab', '#78878f', '#ab9e91', '#b8a790', '#67747f', '#5a6670', '#978d81'];
const ROOFS = ['#5c6064', '#54585c', '#666a6e', '#4f5357'];
const GLASS = new THREE.Color('#3d515b'), LIT = ['#baa375', '#c1ab7f', '#b5a079', '#c8b58e'];
const asphalt = new THREE.Color('#52565a'), gutter = new THREE.Color('#44474b'), pavement = new THREE.Color('#909498'), paving = new THREE.Color('#93979b');
const lots = new THREE.Color('#868b8f'), vacant = new THREE.Color('#7a7f83'), far = new THREE.Color('#767d84'), fog = new THREE.Color('#aab4bc').multiplyScalar(.9);
const wall = new THREE.Color('#827f78'), bed = new THREE.Color('#3b464c'), bank = new THREE.Color('#75736e'), bankTop = new THREE.Color('#818486');
const lawn = new THREE.Color('#587347'), lawnWet = new THREE.Color('#4b653e');
const waterDeep = new THREE.Color('#5f6d76'), waterLight = new THREE.Color('#6c7a83');
const TREE_GREENS = ['#66804d', '#708859', '#56744b', '#768856'];
const pick = (list, n) => list[((n % list.length) + list.length) % list.length];

export class CityChunk {
  constructor(index) {
    this.index = index; this.start = index * CHUNK_LENGTH; this.group = new THREE.Group(); this.group.name = `city-chunk-${index}`; this.owned = [];
    this.features = { discoveries: [], bridges: [] };
    this.planting = new CityPlanting();
    this.discoveries = cityDiscoveries(this.start - 160, this.start + CHUNK_LENGTH + 160);
    this.scenery = { blocks: { vertices: [], colors: [] }, details: { vertices: [], colors: [] }, streets: { vertices: [], colors: [] }, lit: { vertices: [], colors: [] }, skyline: { vertices: [], colors: [] },
      boxes: [], furniture: new Map(), parked: new Map(), bark: new Map(), leaves: new Map() };
    this.buildTerrain(); this.buildRoad(); this.buildRiver(); reserveCityLandmarks(this, this.discoveries);
    this.buildBlocks(); this.buildStreets(); buildPromenade(this); buildCityParking(this); buildCityRoads(this); buildNeighborhoods(this);
    buildCityDiscoveries(this, this.discoveries);
    this.finishScenery();
    this.planting = null;
    finalizeChunkTransforms(this.group);
  }
  addMesh(g, mat, name, shadows = false) {
    const mesh = new THREE.Mesh(g, mat); mesh.name = name; mesh.castShadow = shadows; mesh.receiveShadow = true;
    this.group.add(mesh); this.owned.push(g); return mesh;
  }
  inChunk(s) { return s >= this.start && s < this.start + CHUNK_LENGTH; }
  // Scenery stands on the rendered facets; the analytic ground covers spots
  // outside this chunk.
  ground(s, u) {
    const p = cityPosition(s, u, 0);
    return { x: p.x, y: this.sampleGround(p.x, p.z + this.start) ?? cityGroundHeight(s, u), z: p.z + this.start };
  }
  // Local coordinates for a point on the road frame at a given height.
  at(s, u, y) { const p = cityPosition(s, u, y); return { x: p.x, y: p.y, z: p.z + this.start }; }
  buildTerrain() {
    const vertices = [], colors = [], cache = new Map();
    const parks = this.discoveries.filter(site => site.kind === 'square').map(site => ({ site, layout: cityParkLayout(site) }));
    const vertex = (row, col) => {
      const key = `${row},${col}`;
      if (!cache.has(key)) {
        let p = cityVertex(row, col);
        // Extra street rows split the distant terrain's existing edges;
        // resampling its jitter here could fold the closely spaced rows.
        if (!Number.isInteger(row) && (p.u < -260 || p.u > 170)) {
          const a = vertex(Math.floor(row), col), b = vertex(Math.ceil(row), col), t = row - Math.floor(row);
          p = { column: col };
          for (const axis of ['x', 'y', 'z', 's', 'u']) p[axis] = lerp(a[axis], b[axis], t);
        }
        cache.set(key, p);
      }
      return cache.get(key);
    };
    // Put terrain edges at the asphalt edges as well as the outer pavements.
    // Otherwise a lowered eight-metre row leaves a trough outside the kerb.
    const end = this.start + CHUNK_LENGTH, rows = new Set();
    for (let s = this.start; s <= end; s += CITY_STEP) rows.add(s / CITY_STEP);
    for (let index = blockAt(this.start) - 1; index <= blockAt(end) + 1; index++) {
      for (const side of [-1, 1]) {
        const s = blockBoundary(index) + side * SIDE_ROAD_HALF_WIDTH;
        if (s > this.start && s < end) rows.add(s / CITY_STEP);
      }
    }
    const ordered = [...rows].sort((a, b) => a - b);
    for (let k = 0; k < ordered.length - 1; k++) {
      const row = ordered[k], next = ordered[k + 1];
      for (let col = 0; col < CITY_COLUMN_COUNT - 1; col++) {
        const a = vertex(row, col), b = vertex(next, col), c = vertex(row, col + 1), d = vertex(next, col + 1);
        const tris = (row + col) % 2 ? [[a, b, c], [b, d, c]] : [[a, b, d], [a, d, c]];
        tris.forEach((tri, i) => {
          const park = parks.find(({ site }) => tri.some(p => p.s > site.s - site.halfS) && tri.some(p => p.s < site.s + site.halfS) &&
            tri.some(p => p.u > site.u0) && tri.some(p => p.u < site.u1));
          if (!park) { triangle(vertices, colors, ...tri, this.facetColor(tri, row, col, i), this.start); return; }
          const s = tri.reduce((sum, p) => sum + p.s, 0) / 3, u = tri.reduce((sum, p) => sum + p.u, 0) / 3;
          const grass = lawn.clone().lerp(lawnWet, .5 + .5 * Math.sin(s / 9 + u / 7));
          paintCityPark(tri, park.layout, (polygon, surface) => {
            const color = surface === 'grass' ? grass : surface === 'paving' ? paving : this.facetColor(polygon, row, col, i);
            for (let j = 1; j < polygon.length - 1; j++) triangle(vertices, colors, polygon[0], polygon[j], polygon[j + 1], color, this.start);
          });
        });
      }
    }
    this.terrain = this.addMesh(geometry(vertices, colors), terrainMaterial, 'city-ground', true);
    this.sampleGround = terrainSampler(this.terrain);
  }
  facetColor(tri, row, col, i) {
    const s = tri.reduce((sum, p) => sum + p.s, 0) / tri.length, u = tri.reduce((sum, p) => sum + p.u, 0) / tri.length, cross = Math.abs(u);
    const facet = randomAt(row * 2 + i, col + 3041);
    let color;
    // Secondary asphalt has its own precisely clipped mesh. Its terrain
    // backing stays paved so coarse facets cannot spill past the sidewalks.
    if (cross <= KERB + .3) color = asphalt.clone();
    else if (cross < 6.6) color = gutter.clone();
    else if (u > 0) {
      if (onCrossStreet(s, u) || (u > BANDS[0].back && u < BANDS[1].front) || (u > BANDS[1].back && u < BANDS[2].front) || u < 13) color = pavement.clone();
      else if (u < BANDS[2].back) color = lots.clone();
      else if (u < SKYLINE_FROM) color = vacant.clone();
      else color = far.clone().lerp(fog, smoothstep(180, 420, u) * .6);
    } else {
      const q = quayOffset(s);
      if (u >= q) {
        color = (Math.floor(row) % 2 ? paving : pavement).clone();
      } else if (u >= q - QUAY_WALL) color = wall.clone();
      else if (u > FAR_BANK) color = bed.clone();
      else if (u > FAR_BANK_TOP) color = bank.clone();
      else if (onCrossStreet(s, u) || BANK_ROADS.some(center => Math.abs(u - center) < 5.5)) color = pavement.clone();
      else color = bankTop.clone().lerp(fog, smoothstep(-260, -420, u) * .6);
    }
    return color.multiplyScalar(.975 + facet * .05);
  }
  ribbon(ranges, lift, mat, name, skip = () => false) {
    const vertices = [];
    for (const [low, high] of ranges) for (let s = this.start; s < this.start + CHUNK_LENGTH; s += 2) {
      if (skip(s + 1, (low + high) / 2)) continue;
      const at = (t, u) => cityPosition(t, u, cityRoadHeight(t) + lift);
      const a = at(s, low), b = at(s + 2, low), c = at(s, high), d = at(s + 2, high);
      triangle(vertices, null, a, b, c, null, this.start); triangle(vertices, null, b, d, c, null, this.start);
    }
    this.addMesh(geometry(vertices), mat, name);
  }
  buildRoad() {
    this.ribbon([[-5.5, 5.5]], .075, roadMaterial, 'city-road');
    this.ribbon([[-6.7, -6.05], [6.05, 6.7]], PAVEMENT_LIFT + .02, kerbMaterial, 'kerbs', (s, u) => onCrossStreet(s, u) || (u < 0 && cityParkingAt(s)));
    this.ribbon([[-5.05, -4.89], [4.89, 5.05]], .09, edgeMaterial, 'road-edges', (s, u) => onCrossStreet(s, Math.sign(u) * 7) || (u < 0 && cityParkingAt(s)));
    this.ribbon([[-.21, -.07], [.07, .21]], .093, centerMaterial, 'center-lines', s => Math.abs(s - crossStreetAt(s).center) < STREET_HALF_WIDTH + 6);
  }
  // The river: one level plane from the far bank to just inside the quay
  // wall, so the wall's own facet meets the water without a seam.
  buildRiver() {
    const vertices = [], colors = [], coordinates = [];
    // Keep coordinates small on long drives, with the same noise period at
    // each chunk seam. Never wrap individual vertices across a triangle.
    const flowStart = ((this.start % 4096) + 4096) % 4096;
    for (let s = this.start; s < this.start + CHUNK_LENGTH; s += CITY_STEP) {
      const t = s + CITY_STEP;
      const columns = q => [-128.3, -104, -82, -62, q - .9];
      const c0 = columns(quayOffset(s)), c1 = columns(quayOffset(t));
      for (let k = 0; k < c0.length - 1; k++) {
        const at = (v, u) => ({ ...cityPosition(v, u, RIVER_LEVEL), u, s: flowStart + v - this.start });
        const a = at(s, c0[k]), b = at(t, c1[k]), c = at(s, c0[k + 1]), d = at(t, c1[k + 1]);
        const color = waterDeep.clone().lerp(waterLight, .3 + .35 * Math.sin(s / 41 + k * 1.7)).multiplyScalar(.97 + randomAt(s, k + 3051) * .06);
        triangle(vertices, colors, a, b, c, color, this.start, coordinates); triangle(vertices, colors, b, d, c, color, this.start, coordinates);
      }
    }
    const water = this.addMesh(geometry(vertices, colors), waterMaterial, 'city-river');
    water.geometry.setAttribute('riverCoord', new THREE.Float32BufferAttribute(coordinates, 2));
    water.geometry.boundingSphere.radius += .5;
  }
  // A face of a building, in local coordinates, wound to face outward.
  quad(target, points, color, outward) {
    const [p1, p2, p3, p4] = points;
    const ax = p2.x - p1.x, ay = p2.y - p1.y, az = p2.z - p1.z, bx = p3.x - p1.x, by = p3.y - p1.y, bz = p3.z - p1.z;
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const order = nx * outward[0] + ny * outward[1] + nz * outward[2] < 0 ? [p1, p4, p3, p2] : [p1, p2, p3, p4];
    for (const p of [order[0], order[1], order[2], order[0], order[2], order[3]]) {
      target.vertices.push(p.x, p.y, p.z); target.colors.push(color.r, color.g, color.b);
    }
  }
  // A block standing on the road frame: its footprint is a rectangle in
  // (s, u), so rows of buildings stay square to the road round the bends.
  prism(target, s0, s1, u0, u1, y0, y1, color, { top = true, back = true, sides = true, shade = 1 } = {}) {
    // Follow the same curved road frame as the windows. A single chord across
    // a long facade can bury its middle windows inside the wall on a bend.
    const divisions = (a, b, mid) => Math.max(1, Math.ceil(Math.sqrt(Math.hypot(mid.x - (a.x + b.x) / 2, mid.z - (a.z + b.z) / 2) / .018)));
    const steps = target === this.scenery?.skyline ? 1 : Math.max(...[u0, u1].map(u => divisions(this.at(s0, u, 0), this.at(s1, u, 0), this.at((s0 + s1) / 2, u, 0))));
    for (let k = 0; k < steps; k++) {
      const a = lerp(s0, s1, k / steps), b = lerp(s0, s1, (k + 1) / steps);
      const c = [[a, u0], [b, u0], [b, u1], [a, u1]].map(([s, u]) => [this.at(s, u, y0), this.at(s, u, y1)]);
      const face = (i, j, tint, outward) => this.quad(target, [c[i][0], c[j][0], c[j][1], c[i][1]], color.clone().multiplyScalar(tint * shade), outward);
      face(0, 1, 1, [-1, 0, 0]);
      if (back) face(2, 3, .82, [1, 0, 0]);
      if (top) this.quad(target, [c[0][1], c[1][1], c[2][1], c[3][1]], color.clone().multiplyScalar(1.04 * shade), [0, 1, 0]);
    }
    // The normal offset also eases across the lot depth. Subdivide the ends
    // near the road so their windows follow the wall rather than cutting it.
    if (sides) {
      const across = target === this.scenery?.skyline ? 1 : Math.max(...[s0, s1].map(s => divisions(this.at(s, u0, 0), this.at(s, u1, 0), this.at(s, (u0 + u1) / 2, 0))));
      for (const [s, outward] of [[s0, [0, 0, 1]], [s1, [0, 0, -1]]]) for (let k = 0; k < across; k++) {
        const a = lerp(u0, u1, k / across), b = lerp(u0, u1, (k + 1) / across);
        this.quad(target, [this.at(s, a, y0), this.at(s, b, y0), this.at(s, b, y1), this.at(s, a, y1)], color.clone().multiplyScalar(.9 * shade), outward);
      }
    }
  }
  // Face the boulevard on either bank, with end windows for both driving
  // directions. All panes are baked into the existing opaque/lit batches.
  windows(b, y0, seed, kind) {
    const { s0, s1, u0, u1 } = b, { blocks, lit } = this.scenery;
    const storeys = Math.floor((b.height - 1.2) / 3.2), first = b.shop ? 1 : 0;
    const detailed = u0 > 0 && u0 < 40, distant = u0 >= 90 || u0 < -190, surround = new THREE.Color(b.wall).lerp(new THREE.Color('#c8c1b3'), .48);
    const facing = u1 < 0 ? 1 : -1, front = facing > 0 ? u1 : u0;
    const frontPoint = (s, depth, y) => this.at(s, front + facing * depth, y);
    const frontNormal = [facing, 0, 0];
    let n = 0;
    const pane = (points, outward, salt) => {
      const on = randomAt(seed, 3061 + salt) < b.lit;
      this.quad(on ? lit : blocks, points, on ? new THREE.Color(pick(LIT, seed + salt)) : GLASS.clone().multiplyScalar(.92 + randomAt(seed, 3062 + salt) * .16), outward);
    };
    for (let k = first; k < storeys; k++) {
      const yLow = y0 + 1.0 + k * 3.2, yHigh = yLow + (detailed ? 1.85 : 1.55);
      if (kind === 'ribbon') {
        // Ribbon strips in bays, so a lit office is one bay, not a whole floor.
        for (let s = s0 + .5; s < s1 - .5; s += 6) {
          const e = Math.min(s + 5.7, s1 - .5);
          pane([frontPoint(s, .05, yLow), frontPoint(e, .05, yLow), frontPoint(e, .05, yHigh), frontPoint(s, .05, yHigh)], frontNormal, ++n);
        }
        for (const [end, direction] of [[s0, -1], [s1, 1]]) for (let u = u0 + .5; u < u1 - .5; u += 6) {
          const e = Math.min(u + 5.7, u1 - .5);
          const s = end + direction * .05;
          pane([this.at(s, u, yLow), this.at(s, e, yLow), this.at(s, e, yHigh), this.at(s, u, yHigh)], [0, 0, -direction], ++n);
        }
        continue;
      }
      for (let s = s0 + 1.3; s + 1.3 <= s1 - .9; s += detailed ? 3.15 : distant ? 3.8 : 2.8) {
        if (detailed) {
          this.quad(blocks, [this.at(s - .14, u0 - .035, yLow - .13), this.at(s + 1.44, u0 - .035, yLow - .13), this.at(s + 1.44, u0 - .035, yHigh + .14), this.at(s - .14, u0 - .035, yHigh + .14)], surround, [-1, 0, 0]);
          this.prism(blocks, s - .2, s + 1.5, u0 - .22, u0, yLow - .16, yLow - .04, surround);
        }
        pane([frontPoint(s, .05, yLow), frontPoint(s + 1.3, .05, yLow), frontPoint(s + 1.3, .05, yHigh), frontPoint(s, .05, yHigh)], frontNormal, ++n);
        if (detailed) this.quad(blocks, [this.at(s, u0 - .07, yLow + .92), this.at(s + 1.3, u0 - .07, yLow + .92), this.at(s + 1.3, u0 - .07, yLow + 1), this.at(s, u0 - .07, yLow + 1)], surround.clone().multiplyScalar(.8), [-1, 0, 0]);
      }
      for (const [end, direction] of [[s0, -1], [s1, 1]]) for (let u = u0 + 1.4; u + 1.3 <= u1 - 1; u += detailed ? 3.2 : distant ? 3.8 : 2.9) {
        const outward = [0, 0, -direction], s = end + direction * .05, frameS = end + direction * .035;
        if (detailed) this.quad(blocks, [this.at(frameS, u - .14, yLow - .13), this.at(frameS, u + 1.44, yLow - .13), this.at(frameS, u + 1.44, yHigh + .14), this.at(frameS, u - .14, yHigh + .14)], surround, outward);
        pane([this.at(s, u, yLow), this.at(s, u + 1.3, yLow), this.at(s, u + 1.3, yHigh), this.at(s, u, yHigh)], outward, ++n);
      }
    }
  }
  // One building: walls, roof, parapet or gable, roof furniture and windows.
  building(b, seed) {
    const { blocks } = this.scenery, { s0, s1, u0, u1 } = b;
    this.reserveBuilding(s0, s1, u0, u1);
    if (!this.inChunk((s0 + s1) / 2)) return;
    this.solidLot(s0, s1, u0, u1);
    const heights =[[s0, u0], [s1, u0], [s1, u1], [s0, u1], [(s0 + s1) / 2, (u0 + u1) / 2]].map(([s, u]) => this.ground(s, u).y);
    const y0 = Math.min(...heights) - .25, y1 = Math.max(...heights) + b.height;
    const color = new THREE.Color(b.wall);
    this.prism(blocks, s0, s1, u0, u1, y0, y1, color, { top: b.roof !== 'gable', shade: b.shade });
    if (b.simple) {
      // Infill uses the existing batch, with a roof cap and broad window
      // bays instead of shopfronts, stone trim or rooftop equipment.
      this.prism(blocks, s0, s1, u0, u1, y1, y1 + .35, new THREE.Color(b.roofColor));
      this.windows(b, y0, seed, 'ribbon');
      return;
    }
    if (b.roof === 'gable') {
      const ridge = y1 + (u1 - u0) * .32, um = (u0 + u1) / 2, roof = new THREE.Color(b.roofColor);
      this.quad(blocks, [this.at(s0 - .3, u0 - .3, y1 - .15), this.at(s1 + .3, u0 - .3, y1 - .15), this.at(s1 + .3, um, ridge), this.at(s0 - .3, um, ridge)], roof, [-1, 1, 0]);
      this.quad(blocks, [this.at(s0 - .3, um, ridge), this.at(s1 + .3, um, ridge), this.at(s1 + .3, u1 + .3, y1 - .15), this.at(s0 - .3, u1 + .3, y1 - .15)], roof.clone().multiplyScalar(.9), [1, 1, 0]);
      for (const [s, outward] of [[s0, [0, 0, 1]], [s1, [0, 0, -1]]]) {
        const a = this.at(s, u0, y1), c = this.at(s, u1, y1), t = this.at(s, um, ridge);
        this.quad(blocks, [a, c, t, t], color.clone().multiplyScalar(.9 * b.shade), outward);
      }
    } else {
      const roof = new THREE.Color(b.roofColor), p = color.clone().multiplyScalar(.9);
      this.quad(blocks, [this.at(s0, u0, y1 + .02), this.at(s1, u0, y1 + .02), this.at(s1, u1, y1 + .02), this.at(s0, u1, y1 + .02)], roof, [0, 1, 0]);
      for (const [a, c, d, e] of [[s0, s1, u0, u0 + .45], [s0, s1, u1 - .45, u1], [s0, s0 + .45, u0, u1], [s1 - .45, s1, u0, u1]]) this.prism(blocks, a, c, d, e, y1, y1 + .7, p, { shade: 1 });
      // Tanks, plant and stair heads on the flat roofs.
      const inset = 1.4, tank = rooftopTank(b, seed);
      for (let k = 0, count = 1 + Math.floor(randomAt(seed, 3081) * 3); k < count; k++) {
        const w = 1.4 + randomAt(seed, 3082 + k) * 2.2, d = 1.4 + randomAt(seed, 3086 + k) * 2, h = .9 + randomAt(seed, 3090 + k) * 1.8;
        if (s1 - s0 < w + inset * 2 + 1 || u1 - u0 < d + inset * 2 + 1) break;
        const rs = s0 + inset + randomAt(seed, 3094 + k) * (s1 - s0 - w - inset * 2), ru = u0 + inset + randomAt(seed, 3098 + k) * (u1 - u0 - d - inset * 2);
        if (tank && Math.abs(rs + w / 2 - tank.s) < w / 2 + 1.8 && Math.abs(ru + d / 2 - tank.u) < d / 2 + 1.8) continue;
        this.prism(blocks, rs, rs + w, ru, ru + d, y1, y1 + h, new THREE.Color(k ? '#8d9195' : '#6f7377'), {});
      }
    }
    if (b.windows !== 'none') this.windows(b, y0, seed, b.windows);
    else if (u0 < 0) {
      // Wharf workshops read as occupied buildings even at a distance:
      // loading doors and a short clerestory use only a few flat panels.
      for (let s = s0 + 2; s < s1 - 3; s += 6.5) {
        this.quad(blocks, [this.at(s, u1 + .055, y0 + .3), this.at(s + 2.6, u1 + .055, y0 + .3), this.at(s + 2.6, u1 + .055, y0 + 3.3), this.at(s, u1 + .055, y0 + 3.3)], new THREE.Color('#4a595d'), [1, 0, 0]);
        this.quad(blocks, [this.at(s, u1 + .06, y1 - 1.5), this.at(s + 2.6, u1 + .06, y1 - 1.5), this.at(s + 2.6, u1 + .06, y1 - .65), this.at(s, u1 + .06, y1 - .65)], GLASS, [1, 0, 0]);
      }
    }
    if (b.shop) buildShopfront(this, b, y0, seed);
    dressBuilding(this, b, y0, y1, seed);
  }
  // Lots along each block, each row of buildings at its own scale: shops
  // and flats on the building line, taller blocks behind, towers at the back.
  lotsFor(block, band, s0, s1) {
    const lots = [];
    let s = s0, i = 0;
    while (s1 - s > 9) {
      const r = randomAt(block * 16 + band * 5, 3111 + i);
      let w = band === 2 ? 16 + r * 18 : band === 3 ? 14 + r * 16 : 11 + r * 13;
      if (s1 - s - w < 9) w = s1 - s;
      lots.push({ s0: s, s1: s + w, i }); s += w + .7; i++;
    }
    return lots;
  }
  buildBlocks() {
    const first = blockAt(this.start - 160), last = blockAt(this.start + CHUNK_LENGTH + 160);
    for (let block = first; block <= last; block++) {
      const start = blockBoundary(block) + STREET_HALF_WIDTH + 1.5, end = blockBoundary(block + 1) - STREET_HALF_WIDTH - 1.5;
      for (const [band, range] of BANDS.entries()) {
        const spans = cityBuildingSpans(start, end, range.front, range.back, this.discoveries);
        for (const span of spans) for (const lot of this.lotsFor(block, band, span.s0, span.s1)) {
          const seed = (block * 16 + band * 5) * 41 + lot.i, r = k => randomAt(seed, 3121 + k);
          if (r(0) > [.98, .95, .94][band]) continue;
          const simple = r(0) > [.94, .88, .74][band];
          const depth = band === 0 ? 16 + r(1) * 6 : band === 1 ? 18 + r(1) * 18 : 34 + r(1) * 20;
          const u0 = range.front + (band ? r(2) * 4 : 0), u1 = Math.min(range.back, u0 + depth);
          if (!cityLotClears(lot.s0, lot.s1, u0, u1, this.discoveries)) continue;
          const storeys = simple ? 3 + Math.floor(r(3) * (band === 2 ? 5 : 3)) : band === 0 ? 3 + Math.floor(r(3) * 4) : band === 1 ? 5 + Math.floor(r(3) * 7) : 8 + Math.floor(r(3) * 11);
          const gable = band === 0 && storeys <= 4 && r(4) < .35;
          this.building({ s0: lot.s0, s1: lot.s1, u0, u1, height: storeys * 3.2 + 1.2, wall: WALLS[Math.floor(r(5) * WALLS.length)], roofColor: ROOFS[Math.floor(r(6) * ROOFS.length)],
            roof: simple ? 'flat' : gable ? 'gable' : 'flat', windows: band === 2 && r(7) < .5 ? 'ribbon' : 'punched', shop: !simple && band < 2 && r(8) < (band ? .35 : .85), lit: [.11, .08, .05][band], shade: .96 + r(9) * .08, simple }, seed);
        }
      }
    }
    // The opposite bank shares the street grid, so bridge landings lead into
    // open intersections rather than through randomly positioned buildings.
    for (const [k, range] of BANK_BANDS.entries()) {
      for (let block = first; block <= last; block++) for (const lot of this.lotsFor(block, k ? 2 : 3, blockBoundary(block) + STREET_HALF_WIDTH + 1.5, blockBoundary(block + 1) - STREET_HALF_WIDTH - 1.5)) {
        const { s0, s1 } = lot, seed = block * 97 + k * 31 + lot.i, r = j => randomAt(seed, 3141 + j);
        if (r(2) < .16 || !cityLotClears(s0, s1, range.back, range.front, this.discoveries)) continue;
        const u1 = range.front - r(3) * 3, u0 = Math.max(range.back, u1 - (k ? 16 + r(4) * 20 : 9 + r(4) * 8));
        const height = k ? 14 + r(5) * 26 : 6 + r(5) * 5;
        this.building({ s0, s1, u0, u1, height, wall: WALLS[Math.floor(r(6) * WALLS.length)], roofColor: ROOFS[Math.floor(r(7) * ROOFS.length)],
          roof: !k && r(8) < .55 ? 'gable' : 'flat', windows: k ? 'punched' : 'none', shop: false, lit: k ? .05 : 0, shade: .94 + r(9) * .08 }, seed);
      }
    }
    // The skyline: lightly banded towers beyond the far blocks, fading into the fog,
    // without shadows or soft shading, like the far windbreaks on the plains.
    // The near side has none: nothing on the camera's side of the road is
    // ever far enough away for the fog to soften it.
    const { skyline } = this.scenery;
    for (const [lane, u] of [[0, 260], [1, 320], [2, 390], [3, 470]]) {
      for (let n = Math.floor((this.start - 60) / 46); n * 46 < this.start + CHUNK_LENGTH + 60; n++) {
        const r = j => randomAt(n, lane * 10 + 3161 + j), s = n * 46 + r(0) * 30, w = 14 + r(1) * 18, d = 14 + r(2) * 18;
        if (!this.inChunk(s) || r(3) < .3) continue;
        const height = 30 + r(4) * 95 + lane * 6;
        const base = cityGroundHeight(s, u) - 1, color = new THREE.Color(lane % 2 ? '#78828d' : '#808a95').lerp(fog, .15 + .06 * (lane % 5));
        this.prism(skyline, s, s + w, u, u + d, base, base + height, color, { back: false, sides: true });
        this.solidLot(s, s + w, u, u + d);
        dressSkyline(this, { s0: s, s1: s + w, u0: u, u1: u + d }, base, base + height, color, lane);
      }
    }
  }
  clearAt(s, u, r = 1) { return !onRiverCrossing(s, u, r) && cityDiscoveryClears(s, u, this.discoveries, r); }
  reserveBuilding(s0, s1, u0, u1) {
    if (s1 < this.start - 24 || s0 > this.start + CHUNK_LENGTH + 24) return;
    const points = [], corners = [[s0, u0], [s1, u0], [s1, u1], [s0, u1]];
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4], steps = Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / 2);
      for (let j = 0; j < steps; j++) points.push(this.at(lerp(a[0], b[0], j / steps), lerp(a[1], b[1], j / steps), 0));
    }
    // Include projecting sills and roof edges, as well as the wall itself.
    this.planting.reserve(points, .65);
  }
  // A building's walls stop the car. A lot is a rectangle in (s, u), which a
  // bend shears a little; the rectangle through the middles of its four sides
  // stays within a hand of the walls.
  solidLot(s0, s1, u0, u1) {
    const s = (s0 + s1) / 2, u = (u0 + u1) / 2, near = this.at(s, u0, 0), far = this.at(s, u1, 0);
    solidSpan(this, this.at(s0, u, 0), this.at(s1, u, 0), Math.hypot(far.x - near.x, far.z - near.z) / 2);
  }
  furniture(name, s, u, yaw, extra = {}) {
    const p = this.ground(s, u), { furniture } = this.scenery;
    if (!furniture.has(name)) furniture.set(name, []);
    furniture.get(name).push({ p: [p.x, p.y + (extra.lift ?? 0), p.z], r: [0, yaw, 0], scale: extra.scale });
  }
  tree(s, u, height, color, yaw, plantingHeight = null) {
    const variant = cityTrees[Math.abs(Math.round(s * 7 + u)) % cityTrees.length];
    const p = this.ground(s, u), { bark, leaves } = this.scenery;
    if (!this.planting.clears(p, variant.radius * height)) return false;
    if (plantingHeight !== null) p.y = plantingHeight;
    if (!bark.has(variant)) { bark.set(variant, []); leaves.set(variant, []); }
    solidModel(this, variant.bark, [p.x, p.y, p.z], yaw, height, true);
    bark.get(variant).push({ p: [p.x, p.y - .12, p.z], scale: [height, height, height], r: [0, yaw, 0], pit: plantingHeight === null });
    leaves.get(variant).push({ p: [p.x, p.y - .12, p.z], scale: [height, height, height], r: [0, yaw, 0], color });
    return true;
  }
  parkedCar(s, u, yaw, seed, lift = 0) {
    // Two body shapes per chunk: variety along the route, few draw calls in it.
    const names = Object.keys(parkedCars), name = names[(Math.abs(this.index) * 2 + (randomAt(seed, 3181) < .5 ? 0 : 1)) % names.length], p = this.ground(s, u), { parked } = this.scenery;
    if (!parked.has(name)) parked.set(name, []);
    parked.get(name).push({ p: [p.x, p.y + .02 + lift, p.z], r: [0, yaw, 0], color: PARKED_PAINTS[Math.floor(randomAt(seed, 3182) * PARKED_PAINTS.length)] });
  }
  beam(list, a, b, width, color) {
    const from = new THREE.Vector3(a.x, a.y, a.z), to = new THREE.Vector3(b.x, b.y, b.z), direction = to.clone().sub(from);
    list.push({ p: from.clone().add(to).multiplyScalar(.5).toArray(), scale: [width, direction.length(), width], q: new THREE.Quaternion().setFromUnitVectors(up, direction.normalize()), color });
  }
  buildStreets() {
    const random = seededRandom(this.index + 30231), { boxes } = this.scenery;
    const yaw = s => -roadFrame(s).angle, across = s => yaw(s) + Math.PI / 2;
    const street = s => { const c = crossStreetAt(s); return Math.abs(s - c.center) < STREET_HALF_WIDTH + 2; };
    // Street lamps face the road from both pavements; benches, trees and
    // shelters keep the promenade side, with trees also along the far pavement.
    for (let s = Math.ceil((this.start - 4) / 26) * 26 + 5; s < this.start + CHUNK_LENGTH + 4; s += 26) {
      if (!this.inChunk(s) || street(s)) continue;
      if (this.clearAt(s, 7.4)) this.furniture('lamp', s, 7.4, yaw(s));
      const u = cityParkingAt(s, 3) ? -17.2 : -7.4;
      if (this.clearAt(s, u)) this.furniture('lamp', s, u, yaw(s) + Math.PI);
    }
    for (let s = Math.ceil((this.start - 4) / 18) * 18 + 9; s < this.start + CHUNK_LENGTH + 4; s += 18) {
      const t = s + (randomAt(Math.round(s), 3201) - .5) * 4;
      if (!this.inChunk(t) || street(t)) continue;
      const u = cityParkingAt(t, 4) ? -17.2 : -10.4;
      if (randomAt(Math.round(s), 3202) < .8 && this.clearAt(t, u, 2)) this.tree(t, u, 5.5 + randomAt(Math.round(s), 3203) * 3, TREE_GREENS[Math.abs(Math.round(s / 18)) % 4], random() * 6.28);
      if (randomAt(Math.round(s), 3204) < .65 && this.clearAt(t, 10.2, 2)) this.tree(t, 10.2, 5 + randomAt(Math.round(s), 3205) * 2.5, TREE_GREENS[(Math.abs(Math.round(s / 18)) + 1) % 4], random() * 6.28);
    }
    for (let s = Math.ceil((this.start - 4) / 36) * 36 + 20; s < this.start + CHUNK_LENGTH + 4; s += 36) {
      const u = cityParkingAt(s, 3) ? -18.4 : -12.8;
      if (!this.inChunk(s) || street(s) || randomAt(Math.round(s), 3211) > .65 || !this.clearAt(s, u, 1.5)) continue;
      this.furniture('bench', s, u, yaw(s));
    }
    for (let s = Math.ceil((this.start - 4) / 176) * 176 + 60; s < this.start + CHUNK_LENGTH + 4; s += 176) {
      if (!this.inChunk(s) || street(s)) continue;
      if (randomAt(Math.round(s), 3221) < .7 && this.clearAt(s, 8.6, 2.5)) this.furniture('shelter', s, 8.6, yaw(s));
      const u = cityParkingAt(s, 4) ? -18.2 : -8.6;
      if (randomAt(Math.round(s), 3222) < .5 && this.clearAt(s, u, 2.5)) this.furniture('shelter', s, u, yaw(s) + Math.PI);
    }
    // The quay railing follows the wandering embankment in four-metre runs.
    for (let s = this.start; s < this.start + CHUNK_LENGTH; s += 4) {
      const street = crossStreetAt(s + 2), edge = STREET_HALF_WIDTH - .3;
      const spans = nearStreet(street.index) ? [[s, Math.min(s + 4, street.center - edge)], [Math.max(s, street.center + edge), s + 4]] : [[s, s + 4]];
      for (const [from, to] of spans) {
        if (to <= from) continue;
        const mid = (from + to) / 2, u = quayOffset(mid) + .55;
        if (!cityDiscoveryClears(mid, u, this.discoveries.filter(site => site.kind !== 'river-bridge'), (to - from) / 2)) continue;
        const a = this.at(from, quayOffset(from) + .55, pavementHeight(from) + .02);
        const b = this.at(to, quayOffset(to) + .55, pavementHeight(to) + .02);
        const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
        this.furniture('railing', mid, u, Math.atan2(dx, dz), { scale: [1, 1, length / 4], lift: (a.y + b.y) / 2 - this.ground(mid, u).y });
      }
    }
    // Every cross street gets corner signals and zebra crossings. River-bound
    // streets stay clear for the bridge approaches built with the road network.
    const first = crossStreetAt(this.start - 20).index, last = crossStreetAt(this.start + CHUNK_LENGTH + 20).index;
    for (let index = first; index <= last; index++) {
      const center = blockBoundary(index);
      for (const k of [-1, 1]) {
        const s = center + k * (STREET_HALF_WIDTH + 1.4);
        if (this.inChunk(s)) this.furniture('signal', s, 7.6, yaw(s));
        if (this.inChunk(s) && nearStreet(index)) this.furniture('signal', s, -7.6, yaw(s) + Math.PI);
        const crossing = center + k * (STREET_HALF_WIDTH + 3.2);
        if (!this.inChunk(crossing)) continue;
        for (let j = 0; j < 8; j++) {
          const u = -4.4 + j * 1.26, p = this.at(crossing, u, cityRoadHeight(crossing) + .088);
          boxes.push({ p: [p.x, p.y, p.z], scale: [.62, .012, 2.6], r: [0, yaw(crossing), 0], color: '#d2d4d2' });
        }
      }
      // Cars parked along the side streets, nose to the kerb.
      for (const k of [-1, 1]) for (let u = 17; u < 34; u += 6.2) {
        const s = center + k * 4.15;
        if (!this.inChunk(s) || randomAt(index * 4 + k, Math.round(u) + 3231) > .5 || !this.clearAt(s, u, 2)) continue;
        this.parkedCar(s, u, across(s), index * 100 + Math.round(u) + k * 7, .075);
      }
    }
    // Cars in the alleys behind the building line. Waterfront cars belong
    // to the pull-offs so their placement always agrees with the bay markings.
    for (const alley of [(BANDS[0].back + BANDS[1].front) / 2]) {
      for (let s = Math.ceil((this.start - 4) / 22) * 22 + 6; s < this.start + CHUNK_LENGTH + 4; s += 22) {
        if (!this.inChunk(s) || street(s) || randomAt(Math.round(s), Math.round(alley) + 3241) > .4 || !this.clearAt(s, alley, 2)) continue;
        this.parkedCar(s, alley - 1.6, yaw(s) + (randomAt(Math.round(s), 3242) < .5 ? 0 : Math.PI), Math.round(s) * 3 + Math.round(alley), .075);
      }
    }
    // Manholes sit flush with the wet asphalt.
    for (let k = 0; k < 2; k++) {
      const s = this.start + 12 + random() * (CHUNK_LENGTH - 24), u = (random() - .5) * 6;
      this.furniture('manhole', s, u, yaw(s), { lift: .08 - (this.ground(s, u).y - cityRoadHeight(s)) });
    }
  }
  finishScenery() {
    const { blocks, details, streets, lit, skyline, boxes, furniture, parked, bark, leaves } = this.scenery;
    if (blocks.vertices.length) this.addMesh(geometry(blocks.vertices, blocks.colors), blocksMaterial, 'city-blocks', true);
    if (details.vertices.length) this.addMesh(geometry(details.vertices, details.colors), blocksMaterial, 'city-promenade', true);
    if (streets.vertices.length) this.addMesh(geometry(streets.vertices, streets.colors), streetsMaterial, 'city-side-roads');
    if (lit.vertices.length) { const mesh = this.addMesh(geometry(lit.vertices, lit.colors), litMaterial, 'lit-windows'); mesh.receiveShadow = false; }
    if (skyline.vertices.length) {
      const mesh = this.addMesh(geometry(skyline.vertices, skyline.colors), skylineMaterial, 'city-skyline');
      mesh.userData.ambientOcclusion = false;
    }
    instances(this.group, boxGeometry, paintedMaterial, boxes, 'city-boxes');
    const names = { lamp: 'street-lamps', signal: 'traffic-signals', bench: 'benches', shelter: 'bus-shelters', railing: 'quay-railings', bollard: 'bollards', manhole: 'manholes', tank: 'rooftop-water-tanks', kiosk: 'riverside-kiosks', bin: 'litter-bins' };
    for (const [name, items] of furniture) instances(this.group, cityAssets[name], furnitureMaterial, items, names[name], name !== 'manhole');
    for (const [name, items] of parked) {
      instances(this.group, parkedCars[name].paint, parkedPaintMaterial, items, 'parked-cars');
      instances(this.group, parkedCars[name].trim, parkedTrimMaterial, items.map(item => ({ ...item, color: undefined })), 'parked-car-trim');
    }
    for (const [variant, items] of bark) {
      instances(this.group, variant.bark, barkMaterial, items, 'city-trunks');
      instances(this.group, variant.leaves, leavesMaterial, leaves.get(variant), 'city-crowns');
    }
    this.scenery = null;
  }
  dispose() {
    this.group.removeFromParent(); for (const g of this.owned) g.dispose();
    this.group.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
  }
}

// Lightning: a rare double flash, on a fixed schedule from the scene clock so
// it pauses with the drive and repeats for a shared seed.
export function lightning(time) {
  const window = 42, k = Math.floor(time / window);
  let strength = 0;
  for (const cell of [k - 1, k]) {
    if (randomAt(cell, 3301) > .7) continue;
    const dt = time - (cell * window + 4 + randomAt(cell, 3302) * 34);
    if (dt < 0 || dt > .6) continue;
    strength = Math.max(strength, .9 * (Math.exp(-dt / .05) + (dt > .17 ? .6 * Math.exp(-(dt - .17) / .07) : 0)));
  }
  return strength;
}

export class CityWorld {
  constructor(scene, chunkSource = null) {
    this.scene = scene; this.chunkSource = chunkSource; this.chunks = new Map(); this.origin = 0; this.center = null; this.s = 0;
    this.effects = new THREE.Group(); this.effects.name = 'city-storm-effects'; scene.add(this.effects);
    this.rainfall = new Rainfall(); this.drops = this.rainfall.points; this.dropGeometry = this.rainfall.geometry; this.effects.add(this.drops);
    this.flash = new THREE.AmbientLight('#dbe6f4', 0); this.effects.add(this.flash);
    this.reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.time = 0;
  }
  update(s) {
    this.s = s; this.origin = Math.floor(s / 1024) * 1024;
    const center = Math.floor(s / CHUNK_LENGTH);
    updateResidentChunks(this, center, CityChunk);
    for (const chunk of this.chunks.values()) chunk.group.position.z = this.origin - chunk.start;
  }
  animate(time) {
    this.time = time; animateWater(time, this.origin);
    const anchor = cityPosition(this.s, -20, cityRoadHeight(this.s));
    this.rainfall.update(time, anchor, this.origin);
    this.flash.intensity = this.reducedMotion ? 0 : lightning(time);
  }
  dispose() {
    this.chunkSource?.dispose();
    for (const chunk of this.chunks.values()) chunk.dispose(); this.chunks.clear();
    this.effects.removeFromParent(); this.rainfall.dispose(); this.flash.dispose();
  }
}
