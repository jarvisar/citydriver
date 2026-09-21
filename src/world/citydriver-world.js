import * as THREE from 'three';
import { cityAssets, cityTrees } from './city-assets.js';
import { seededRandom } from './route.js';
import { residentWindow } from './resident.js';
import { buildLandmark, pitchedRoof } from './city-landmarks.js';
import { CITY_PLACES } from './city-places.js';
import { cityWalker, cityBoat, walkerPose } from './city-life.js';
import { CITY_BLOCK, DISTANT_CITY_RADIUS, ROAD_HALF_WIDTH, ROAD_LEVEL, PAVEMENT_LEVEL, WATER_LEVEL, RIVER_MARGIN, cityCell, cityBlock } from './city-grid.js';
export { DISTANT_CITY_RADIUS } from './city-grid.js';

const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const windowGeometry = new THREE.PlaneGeometry(1, 1);
const transform = new THREE.Object3D();
const tint = new THREE.Color();
const AWNINGS = ['#b06b4d', '#3f7774', '#41607c', '#b69857', '#727456'];
const GREENS = ['#6f8754', '#7f9564', '#597849', '#8a995f'];
const DISTRICT_STYLE = {
  'Old town': { walls: ['#bc8f79', '#d6b18b', '#ac7667', '#c4a185'], floors: [3, 3], width: [23, 6], depth: [29, 5] },
  'Garden quarter': { walls: ['#c6c4a0', '#b6c5b1', '#d6c3a7', '#9dac97'], floors: [2, 3], width: [24, 4], depth: [25, 5] },
  Midtown: { walls: ['#718d9c', '#91a8ae', '#607c8c', '#b5bdb8'], floors: [8, 8], width: [28, 8], depth: [28, 8] },
  'Warehouse district': { walls: ['#a8755d', '#926758', '#b78d6f', '#8e8980'], floors: [2, 2], width: [33, 4], depth: [34, 3] },
  'Market district': { walls: ['#c5a280', '#bf8870', '#b5b49b', '#d2b797'], floors: [3, 4], width: [28, 7], depth: [28, 7] },
  'Civic quarter': { walls: ['#c0bca8', '#c8c5b5', '#a6b1ae', '#b4ab99'], floors: [4, 4], width: [30, 6], depth: [30, 6] },
};
const pick = (items, random) => items[Math.floor(random() * items.length)];

function renderBatches(group, batches, distant = false) {
  for (const [key, { geometry, material, items }] of batches) {
    if (!items.length) continue;
    const mesh = new THREE.InstancedMesh(geometry, material, items.length); mesh.name = `citydriver-${key}`;
    for (let i = 0; i < items.length; i++) {
      const item = items[i]; transform.position.set(...item.p); transform.scale.set(...item.scale);
      transform.rotation.set(0, item.yaw ?? 0, item.roll ?? 0); transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix); tint.set(item.color); mesh.setColorAt(i, tint);
    }
    mesh.castShadow = !distant && !['road', 'water', 'lit', 'glass'].includes(key);
    mesh.receiveShadow = !distant && key !== 'lit';
    if (distant || key === 'water') mesh.userData.ambientOcclusion = false;
    mesh.computeBoundingSphere(); group.add(mesh);
  }
}

function resources() {
  const standard = options => new THREE.MeshStandardMaterial({ roughness: .9, flatShading: true, ...options });
  const result = {
    solid: standard({ color: '#ffffff' }),
    road: standard({ color: '#666c70', roughness: .85 }),
    glass: standard({ color: '#ffffff', roughness: .32, metalness: .25 }),
    lit: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
    water: standard({ color: '#527c86', roughness: .24, metalness: .28 }),
    props: standard({ color: '#ffffff', vertexColors: true }),
    bark: standard({ color: '#625548', vertexColors: true }),
    leaves: standard({ color: '#ffffff', vertexColors: true }),
  };
  for (const [type, place] of Object.entries(CITY_PLACES)) {
    let map = null;
    if (globalThis.document) {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#314f55'; ctx.fillRect(0, 0, 512, 256);
      ctx.textAlign = 'center'; ctx.fillStyle = place.color; ctx.font = '30px sans-serif'; ctx.fillText(`CITY GUIDE  /  ${place.symbol}`, 256, 58);
      ctx.fillStyle = '#fff5df'; ctx.font = 'bold 44px sans-serif'; ctx.fillText(place.name, 256, 132, 475);
      ctx.fillStyle = '#b6cec9'; ctx.font = '24px sans-serif'; ctx.fillText(place.short.toUpperCase(), 256, 194);
      map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
    }
    result[`sign-${type}`] = new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide, toneMapped: false });
  }
  return result;
}

// A block owns one half of each boundary street. Its neighbour owns the other
// half, so roads and bridge decks meet without overlaps, gaps or dead ends.
export class CitydriverChunk {
  constructor(ix, iz, materials, distant = false) {
    this.ix = ix; this.iz = iz; this.start = iz * CITY_BLOCK; this.east = ix * CITY_BLOCK;
    this.index = `${ix},${iz}`; this.plan = cityBlock(ix, iz); this.materials = materials; this.distant = distant;
    this.group = new THREE.Group(); this.group.name = `citydriver-block-${this.index}`;
    this.features = { colliders: [], bridges: [], buildings: [], discoveries: [] };
    this.batches = new Map(); this.random = seededRandom(this.plan.seed);
    this.buildGround(); this.buildRoads();
    if (this.plan.kind === 'river') this.buildRiver();
    else if (this.plan.landmark) buildLandmark(this);
    else if (this.plan.kind === 'park' || this.plan.kind === 'plaza') this.buildPark();
    else this.buildBuildings();
    if (!distant) { this.buildFurniture(); this.buildLife(); this.finish(); }
  }
  item(key, geometry, material, p, scale = [1, 1, 1], color = '#ffffff', yaw = 0, roll = 0) {
    if (!this.batches.has(key)) this.batches.set(key, { geometry, material, items: [] });
    this.batches.get(key).items.push({ p, scale, color, yaw, roll });
  }
  box(x, y, s, width, height, depth, color, kind = 'solid', yaw = 0, roll = 0) {
    this.item(kind, boxGeometry, this.materials[kind], [x, y, -s], [width, height, depth], color, yaw, roll);
  }
  sign(type, x, y, s, yaw) {
    if (this.distant) return;
    this.item(`sign-${type}`, windowGeometry, this.materials[`sign-${type}`], [x + Math.sin(yaw) * .34, y, -s + Math.cos(yaw) * .34], [6.1, 3.05, 1], '#ffffff', yaw);
  }
  solid(x, s, width, depth) {
    if (this.distant) return;
    this.features.colliders.push({ x: this.east + x, z: -this.start - s, heading: 0, halfWidth: width / 2, halfLength: depth / 2, reach: Math.hypot(width, depth) / 2 });
  }
  post(x, s, radius) { if (!this.distant) this.features.colliders.push({ x: this.east + x, z: -this.start - s, reach: radius }); }
  prop(name, x, s, yaw = 0, y = PAVEMENT_LEVEL) {
    if (this.distant) return;
    this.item(name, cityAssets[name], this.materials.props, [x, y, -s], [1, 1, 1], '#ffffff', yaw);
  }
  tree(x, s, scale = 7) {
    const variant = cityTrees[0], p = [x, PAVEMENT_LEVEL, -s], size = [scale, scale, scale];
    if (this.distant) this.box(x, PAVEMENT_LEVEL + scale * .24, s, .2, scale * .48, .2, '#625548');
    else this.item('tree-trunks', variant.bark, this.materials.bark, p, size);
    this.item('tree-crowns', variant.leaves, this.materials.leaves, p, size, pick(GREENS, this.random));
    this.post(x, s, .28);
  }
  buildGround() {
    if (this.plan.kind === 'river') {
      for (const x of [RIVER_MARGIN / 2, CITY_BLOCK - RIVER_MARGIN / 2]) this.box(x, 20.85, 56, RIVER_MARGIN, 6.2, CITY_BLOCK, '#888f8e');
      for (const x of [18, 94]) this.box(x, 24.06, 56, 20, .12, 96, '#afb0a5');
      this.box(56, WATER_LEVEL - .12, 56, 56, .24, CITY_BLOCK, '#ffffff', 'water');
      return;
    }
    this.box(56, 23.75, 56, CITY_BLOCK, .4, CITY_BLOCK, '#858a87');
    this.box(56, 24.06, 56, 96, .12, 96, '#acafa8');
    if (this.distant) return;
    // Thin paving seams keep sidewalks legible at a low camera angle.
    for (let p = 16; p < 104; p += 8) {
      for (const side of [11.5, 100.5]) {
        this.box(side, 24.125, p, 7, .01, .035, '#929a96');
        this.box(p, 24.125, side, .035, .01, 7, '#929a96');
      }
    }
  }
  buildRoads() {
    for (const s of [4, 108]) this.box(56, 23.98, s, 112, .04, 8, '#ffffff', 'road');
    for (const x of [4, 108]) this.box(x, 23.98, 56, 8, .04, 96, '#ffffff', 'road');
    for (let p = 19; p <= 96; p += 11) {
      this.box(.18, 24.018, p, .11, .018, 5, '#d3b877');
      this.box(p, 24.018, .18, 5, .018, .11, '#d3b877');
    }
    // A complete junction is assembled from its four neighbouring blocks.
    for (const edge of [0, 112]) for (let p = 1.2; p < 8; p += 1.8) {
      this.box(p, 24.016, edge === 0 ? 11 : 101, 1, .015, 3.2, '#d7d8c9');
      this.box(edge === 0 ? 11 : 101, 24.016, p, 3.2, .015, 1, '#d7d8c9');
      this.box(112 - p, 24.016, edge === 0 ? 11 : 101, 1, .015, 3.2, '#d7d8c9');
      this.box(edge === 0 ? 11 : 101, 24.016, 112 - p, 3.2, .015, 1, '#d7d8c9');
    }
    for (const p of [14, 98]) {
      this.box(4, 24.019, p, 6.5, .02, .25, '#d7d8c9');
      this.box(p, 24.019, 108, .25, .02, 6.5, '#d7d8c9');
    }
  }
  buildBuildings() {
    const random = this.random, district = this.plan.district, style = DISTRICT_STYLE[district];
    for (const x of [34, 78]) for (const s of [34, 78]) {
      const width = style.width[0] + random() * style.width[1], depth = style.depth[0] + random() * style.depth[1];
      const floors = style.floors[0] + Math.floor(random() * style.floors[1]);
      const wall = pick(style.walls, random);
      this.buildBuilding(x, s, width, depth, floors, wall, pick(AWNINGS, random));
      const roof = PAVEMENT_LEVEL + 4.2 + floors * 3.2;
      if (district === 'Old town') {
        pitchedRoof(this, x, s, width + 1, depth + 1.5, roof + width * .085 + 1, '#995e4c', wall);
        this.box(x, roof + width * .18 + 1, s, .4, .4, depth + 1.8, '#c49a76');
      } else if (district === 'Midtown') {
        this.box(x, roof + 4.3, s, width * .65, 8, depth * .65, '#658994', 'glass');
        this.box(x, roof + 8.5, s, width * .7, .5, depth * .7, '#c5d1c9');
        this.box(x + 3, roof + 13, s, .25, 9, .25, '#a2b8b6');
        for (const sign of [-1, 1]) {
          this.box(x + sign * (width / 2 + .2), PAVEMENT_LEVEL + (roof - PAVEMENT_LEVEL) / 2, s, .4, roof - PAVEMENT_LEVEL, 1, '#a9c1bf');
          this.box(x, PAVEMENT_LEVEL + (roof - PAVEMENT_LEVEL) / 2, s + sign * (depth / 2 + .2), 1, roof - PAVEMENT_LEVEL, .4, '#a9c1bf');
        }
      } else if (district === 'Garden quarter') {
        this.box(x, roof + .65, s, width - 3, .3, depth - 3, '#719271');
        for (const sign of [-1, 1]) {
          this.box(x + sign * (width / 2 + 2), PAVEMENT_LEVEL + .65, s, 1.7, 1.3, depth + 3, '#6e895d');
          this.solid(x + sign * (width / 2 + 2), s, 1.7, depth + 3);
        }
      } else if (district === 'Warehouse district') {
        for (const offset of [-10, 0, 10]) this.box(x + offset, roof + 1.2, s, 6, 1.5, depth - 3, '#7d9c9e', 'glass');
        for (const sign of [-1, 1]) this.box(x, PAVEMENT_LEVEL + 2, s + sign * (depth / 2 + .2), 9, 3.6, .2, '#697d7c');
      }
    }
    // The service courtyard joins the pavements on all four sides.
    this.box(56, PAVEMENT_LEVEL + .008, 56, 10, .016, 82, '#929893');
    this.box(56, PAVEMENT_LEVEL + .009, 56, 82, .016, 10, '#929893');
    for (const [x, s] of [[56, 22], [56, 90], [22, 56], [90, 56]]) this.tree(x, s, 5.5 + random());
    if (district === 'Garden quarter') for (const [x, s] of [[15, 56], [97, 56], [56, 15], [56, 97]]) this.tree(x, s, 8);
  }
  buildBuilding(x, s, width, depth, floors, wall, accent) {
    const random = this.random, base = PAVEMENT_LEVEL, height = 4.2 + floors * 3.2, roof = base + height;
    this.box(x, base + height / 2, s, width, height, depth, wall);
    this.box(x, base + 1.75, s, width + .12, 3.5, depth + .12, '#777c7a');
    this.box(x, roof + .2, s, width + .65, .4, depth + .65, '#d0c6b5');
    this.box(x, roof + .43, s, width - 1, .1, depth - 1, '#606b6e');
    this.solid(x, s, width, depth);
    this.features.buildings.push({ x: this.east + x, s: this.start + s, width, depth, height, facadeSides: 4, windows: 0 });
    const metadata = this.features.buildings[this.features.buildings.length - 1];
    // Every facade receives the same architectural treatment: shop glazing,
    // awnings, pilasters, window bays, cornices and a roof parapet.
    for (let side = 0; side < 4; side++) {
      const eastWest = side < 2, sign = side % 2 ? 1 : -1, span = eastWest ? depth : width;
      const wallOffset = (eastWest ? width : depth) / 2;
      const along = (offset, y, outward, w, h, d, color, kind = 'solid') => {
        if (this.distant) {
          if (kind === 'solid') {
            // Keep the broad shop fascia and roofline; subpixel window frames
            // and individual sills can disappear without changing the facade.
            if (w > span * .8) {
              if (eastWest) this.box(x + sign * (wallOffset + outward), y, s + offset, d, h, w, color);
              else this.box(x + offset, y, s + sign * (wallOffset + outward), w, h, d, color);
            }
            return;
          }
          const p = eastWest ? [x + sign * (wallOffset + outward), y, -s - offset] : [x + offset, y, -s - sign * (wallOffset + outward)];
          const yaw = eastWest ? sign * Math.PI / 2 : sign > 0 ? Math.PI : 0;
          this.item(`distant-${kind}`, windowGeometry, this.materials[kind], p, [w, h, 1], color, yaw);
          return;
        }
        if (eastWest) this.box(x + sign * (wallOffset + outward), y, s + offset, d, h, w, color, kind);
        else this.box(x + offset, y, s + sign * (wallOffset + outward), w, h, d, color, kind);
      };
      const bays = Math.max(4, Math.floor(span / 4.8)), spacing = (span - 3) / bays;
      along(0, base + 3.9, .15, span + .3, .32, .36, '#c1b6a4');
      along(0, roof + .8, .03, span + .25, .7, .28, '#c1b6a4');
      for (const offset of [-span / 2 + .45, span / 2 - .45]) along(offset, base + height / 2, .08, .7, height, .22, '#c5bcae');
      for (let bay = 0; bay < bays; bay++) {
        const offset = (bay - (bays - 1) / 2) * spacing;
        along(offset, base + 1.8, .11, spacing - .65, 2.65, .09, '#3e5963', 'glass');
        along(offset, base + 3.35, .72, spacing - .45, .2, 1.4, accent);
        along(offset, base + 3.08, 1.3, spacing - .45, .35, .1, accent);
        for (let floor = 0; floor < floors; floor++) {
          const y = base + 5.7 + floor * 3.2, lit = random() < .17;
          along(offset, y, .09, 1.85, 2.15, .12, '#c7c5b7');
          along(offset, y + .02, .17, 1.53, 1.89, .08, lit ? '#d3bc86' : '#465f6b', lit ? 'lit' : 'glass');
          along(offset, y - 1.11, .27, 2.08, .15, .5, '#b9b5a6');
          metadata.windows++;
        }
      }
    }
    // Roofs remain interesting when the camera turns or rises above a block.
    this.box(x + width * .19, roof + 1.35, s - depth * .17, 4.3, 1.8, 3.8, '#9babae');
    this.box(x + width * .19, roof + 2.3, s - depth * .17, 4.5, .12, 4, '#566268');
    for (let i = 0; i < 3; i++) this.box(x + width * .19 - 1.3 + i * 1.3, roof + 2.38, s - depth * .17, .5, .06, 3.4, '#74898f');
    this.box(x - width * .24, roof + 1.7, s + depth * .22, 1.4, 2.6, 1.3, '#927a67');
    if (random() < .42) this.prop('tank', x - width * .2, s - depth * .15, 0, roof + .45);
    else this.box(x - width * .15, roof + .6, s - depth * .15, 6, .2, 5, '#4e6b79');
  }
  buildPark() {
    const park = this.plan.kind === 'park';
    if (park) for (const x of [34, 78]) for (const s of [34, 78]) this.box(x, 24.135, s, 34, .03, 34, '#769461');
    else {
      this.box(56, 24.13, 56, 78, .02, 78, '#bdb6a4');
      for (let p = 24; p <= 88; p += 8) {
        this.box(p, 24.145, 56, .09, .01, 78, '#9f9f92'); this.box(56, 24.145, p, 78, .01, .09, '#9f9f92');
      }
    }
    this.box(56, 24.38, 56, 12, .5, 12, '#c6bfae');
    this.box(56, 24.69, 56, 10.6, .15, 10.6, '#68969a', 'glass');
    this.box(56, 25.8, 56, 2.8, 2.3, 2.8, '#8faba8');
    this.box(56, 27.2, 56, 4.7, .35, 4.7, '#b4bfad');
    this.solid(56, 56, 12, 12);
    for (const x of [23, 40, 72, 89]) for (const s of [23, 89]) this.tree(x, s, park ? 8 + this.random() * 2 : 6.5);
    if (park) for (const x of [23, 89]) for (const s of [40, 72]) this.tree(x, s, 8 + this.random() * 2);
    for (const s of [38, 74]) for (const x of [50, 62]) this.prop('bench', x, s, x < 56 ? 0 : Math.PI);
    if (!park) {
      this.prop('kiosk', 30, 56); this.solid(30, 56, 5, 5);
      this.prop('kiosk', 82, 56, Math.PI); this.solid(82, 56, 5, 5);
    }
    this.features.discoveries.push({ kind: park ? 'park' : 'square', name: park ? 'Pocket gardens' : 'Market square', s: this.start + 56, u: this.east + 56 });
  }
  buildRiver() {
    const iron = '#7d6657', trim = '#c9bd9f';
    for (const s of [5.4, 106.6]) {
      this.box(56, 23.49, s, 58, .98, 10.8, '#929b99');
      this.box(56, 24.06, s < 56 ? 9.4 : 102.6, 58, .12, 2.8, '#b6b2a4');
    }
    for (const s of [10.6, 101.4]) {
      // Side trusses, parapets and piers all stand beyond the driving lanes.
      this.box(56, 24.8, s, 56, 1.1, .45, trim); this.solid(56, s, 56, .45);
      this.box(56, 30.7, s, 47, .48, .5, iron);
      for (const x of [33, 44.5, 56, 67.5, 79]) {
        this.box(x, 27.3, s, .6, 6.8, .65, iron);
        if (x === 33 || x === 79) this.box(x, 20.6, s, 3.2, 6.2, 2.5, '#87938f');
      }
      for (let x = 33; x < 78; x += 11.5) {
        // Diagonals use a full matrix because they lean in the x/y plane.
        const length = Math.hypot(11.5, 5.4), p = [x + 5.75, 27.8, -s];
        this.batches.get('solid').items.push({ p, scale: [length, .32, .4], color: iron, roll: Math.atan2((Math.round((x - 33) / 11.5) % 2 ? -1 : 1) * 5.4, 11.5) });
      }
    }
    for (const x of [27.6, 84.4]) {
      this.box(x, 24.85, 56, .18, .14, 88, '#52676a');
      this.box(x, 24.46, 56, .12, .1, 88, '#52676a');
      for (let s = 12; s <= 100; s += 4) this.box(x, 24.52, s, .13, .95, .13, '#52676a');
      this.solid(x, 56, .3, 88);
    }
    for (const x of [18, 94]) for (const s of [26, 48, 70, 92]) {
      this.tree(x, s, 6.5); this.prop('bench', x + (x < 56 ? 5 : -5), s + 5, x < 56 ? Math.PI : 0);
    }
    // Small water highlights share the glass batch and stay below bridge decks.
    for (let k = 0; k < 8; k++) this.box(34 + this.random() * 44, WATER_LEVEL + .012, 15 + this.random() * 82, 2 + this.random() * 6, .018, .16, '#80a8aa', 'glass');
    this.features.bridges.push({ s: this.start, u: this.east + 56, minU: this.east + 28, maxU: this.east + 84, halfWidth: ROAD_HALF_WIDTH, height: ROAD_LEVEL });
  }
  buildFurniture() {
    for (const s of [27, 83]) {
      this.prop('lamp', 10.6, s); this.post(10.6, s, .25);
      this.prop('lamp', 101.4, s, Math.PI); this.post(101.4, s, .25);
    }
    if (this.plan.kind !== 'river') for (const x of [27, 83]) {
      this.prop('lamp', x, 10.6, -Math.PI / 2); this.post(x, 10.6, .25);
      this.prop('lamp', x, 101.4, Math.PI / 2); this.post(x, 101.4, .25);
      this.tree(x + 12, 11.6, 6); this.tree(x - 12, 100.4, 6);
    }
    for (const [x, s] of [[10, 10], [102, 102]]) { this.prop('signal', x, s); this.post(x, s, .14); }
    this.prop('bin', 11.8, 43); this.post(11.8, 43, .36);
  }
  buildLife() {
    // Residents stay on the pavement; they never wander into driving lanes.
    const random = seededRandom(this.plan.seed + 912), river = this.plan.kind === 'river';
    this.walkers = Array.from({ length: this.plan.landmark ? 10 : 4 }, (_, i) => ({ phase: random() * (river ? 144 : 332), speed: .65 + random() * .45, side: i % 2 }));
    for (const walker of this.walkers) {
      const pose = walkerPose(walker, 0, river);
      this.item('residents', cityWalker, this.materials.props, [pose.x, PAVEMENT_LEVEL, -pose.s], [1, 1, 1], '#ffffff', pose.yaw);
    }
    if (river) {
      const x = this.plan.seed % 2 ? 37 : 75, s = 42 + random() * 25;
      this.item('canal-boat', cityBoat, this.materials.props, [x, WATER_LEVEL, -s]);
      this.box(x < 56 ? 30.5 : 81.5, WATER_LEVEL + .65, s, 5, .35, 18, '#a39478');
      for (const ds of [-7, 7]) this.box(x < 56 ? 32 : 80, WATER_LEVEL, s + ds, .5, 3, .5, '#6e7568');
    }
  }
  animate(time) {
    const mesh = this.peopleMesh;
    for (let i = 0; i < this.walkers.length; i++) {
      const walker = this.walkers[i], pose = walkerPose(walker, time, this.plan.kind === 'river');
      transform.position.set(pose.x, PAVEMENT_LEVEL + Math.sin(time * 7 + walker.phase) * .025, -pose.s);
      transform.rotation.set(0, pose.yaw, Math.sin(time * 3.5 + walker.phase) * .025);
      transform.scale.set(1, 1, 1); transform.updateMatrix(); mesh.setMatrixAt(i, transform.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (this.boatMesh) this.boatMesh.position.y = Math.sin(time * .8 + this.plan.seed) * .08;
  }
  finish() {
    renderBatches(this.group, this.batches);
    this.peopleMesh = this.group.getObjectByName('citydriver-residents');
    if (this.peopleMesh) {
      this.peopleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Their initial positions do not bound the full walk around the block.
      this.peopleMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(56, PAVEMENT_LEVEL + 1, -56), 63);
    }
    this.boatMesh = this.group.getObjectByName('citydriver-canal-boat');
    this.batches = null;
  }
  dispose() { this.group.removeFromParent(); for (const mesh of this.group.children) mesh.dispose(); }
}

export class CitydriverWorld {
  constructor(scene) {
    this.scene = scene; this.chunks = new Map(); this.origin = 0; this.center = null;
    this.s = 0; this.u = 2.4; this.materials = resources(); this.pending = [];
    this.distantChunks = new Map(); this.distantGroup = new THREE.Group();
    this.distantGroup.name = 'citydriver-distant-city'; scene.add(this.distantGroup);
  }
  update(s, u = 2.4) {
    this.s = s; this.u = u; this.origin = Math.floor(s / 1024) * 1024;
    const cell = cityCell(s, u), window = residentWindow();
    const radius = window.ahead >= 5 ? 3 : 2;
    let distantChanged = false;
    if (this.center !== cell.key || this.radius !== radius) {
      this.center = cell.key; this.radius = radius;
      for (const [key, chunk] of this.chunks) {
        if (Math.abs(chunk.ix - cell.ix) > radius || Math.abs(chunk.iz - cell.iz) > radius) { chunk.dispose(); this.chunks.delete(key); }
      }
      this.pending = [];
      for (let ix = cell.ix - radius; ix <= cell.ix + radius; ix++) for (let iz = cell.iz - radius; iz <= cell.iz + radius; iz++) {
        if (!this.chunks.has(`${ix},${iz}`)) this.pending.push({ ix, iz, distance: Math.max(Math.abs(ix - cell.ix), Math.abs(iz - cell.iz)) });
      }
      this.pending.sort((a, b) => a.distance - b.distance || a.iz - b.iz || a.ix - b.ix);
      // The outer city covers Scenic and wide displays without constructing
      // another hundred fully furnished blocks. All facades keep their glass;
      // two-triangle windows and combined batches keep the ring inexpensive.
      for (const [key, chunk] of this.distantChunks) {
        if (Math.abs(chunk.ix - cell.ix) > DISTANT_CITY_RADIUS || Math.abs(chunk.iz - cell.iz) > DISTANT_CITY_RADIUS || this.chunks.has(key)) this.distantChunks.delete(key);
      }
      for (let ix = cell.ix - DISTANT_CITY_RADIUS; ix <= cell.ix + DISTANT_CITY_RADIUS; ix++) for (let iz = cell.iz - DISTANT_CITY_RADIUS; iz <= cell.iz + DISTANT_CITY_RADIUS; iz++) {
        const key = `${ix},${iz}`;
        if (Math.max(Math.abs(ix - cell.ix), Math.abs(iz - cell.iz)) <= radius) continue;
        if (!this.chunks.has(key) && !this.distantChunks.has(key)) this.distantChunks.set(key, new CitydriverChunk(ix, iz, this.materials, true));
      }
      distantChanged = true;
    }
    // Build the newly entered strip together so the detailed and distant city
    // switch in one frame and the combined distant buffers rebuild only once.
    while (this.pending.length) {
      const next = this.pending.shift(), chunk = new CitydriverChunk(next.ix, next.iz, this.materials);
      this.chunks.set(chunk.index, chunk); this.scene.add(chunk.group);
      if (this.distantChunks.delete(chunk.index)) distantChanged = true;
    }
    for (const chunk of this.chunks.values()) chunk.group.position.set(chunk.east, 0, this.origin - chunk.start);
    if (distantChanged) this.rebuildDistant();
    this.distantGroup.position.z = this.origin;
  }
  rebuildDistant() {
    for (const mesh of [...this.distantGroup.children]) { mesh.dispose(); this.distantGroup.remove(mesh); }
    const batches = new Map();
    for (const chunk of this.distantChunks.values()) for (const [key, batch] of chunk.batches) {
      if (!batches.has(key)) batches.set(key, { geometry: batch.geometry, material: batch.material, items: [] });
      const items = batches.get(key).items;
      for (const item of batch.items) items.push({ ...item, p: [item.p[0] + chunk.east, item.p[1], item.p[2] - chunk.start] });
    }
    renderBatches(this.distantGroup, batches, true);
  }
  *collisionChunks(s, u) {
    const cell = cityCell(s, u);
    for (let ix = cell.ix - 1; ix <= cell.ix + 1; ix++) for (let iz = cell.iz - 1; iz <= cell.iz + 1; iz++) {
      const chunk = this.chunks.get(`${ix},${iz}`); if (chunk) yield chunk;
    }
  }
  setWetness(amount) {
    const wet = Math.max(0, Math.min(1, amount));
    this.materials.road.roughness = .85 - wet * .58;
    this.materials.road.color.set('#666c70').lerp(new THREE.Color('#424e58'), wet);
  }
  animate(time) { for (const chunk of this.chunks.values()) chunk.animate(time); }
  dispose() {
    for (const chunk of this.chunks.values()) chunk.dispose(); this.chunks.clear(); this.pending = [];
    for (const mesh of this.distantGroup.children) mesh.dispose(); this.distantGroup.removeFromParent(); this.distantChunks.clear();
    for (const material of Object.values(this.materials)) { material.map?.dispose(); material.dispose(); }
  }
}
