import * as THREE from 'three';
import { cityAssets, cityTrees } from './city-assets.js';
import { seededRandom } from './route.js';
import { residentWindow } from './resident.js';
import { buildLandmark } from './city-landmarks.js';
import { buildCityBuildings, SHOP_NAMES, shopSignMaterial } from './city-buildings.js';
import { blockStreets, buildStreets } from './city-streets.js';
import { cityGreen } from '../city-junctions.js';
import { CITY_PLACES } from './city-places.js';
import { cityWalker, cityBoat, walkerPose } from './city-life.js';
import { CITY_BLOCK, DISTANT_CITY_RADIUS, ROAD_LEVEL, PAVEMENT_LEVEL, WATER_LEVEL, RIVER_MARGIN, cityCell, cityBlock } from './city-grid.js';
export { DISTANT_CITY_RADIUS } from './city-grid.js';

const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const windowGeometry = new THREE.PlaneGeometry(1, 1);
const transform = new THREE.Object3D();
const tint = new THREE.Color();
const GREENS = ['#63924d', '#80a85c', '#4f8054', '#93ab65'];
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
  for (const name of SHOP_NAMES) result[`shop-${name}`] = shopSignMaterial(name);
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
    this.features = { colliders: [], bridges: [], buildings: [], discoveries: [], medians: [], junctions: [], signals: [] };
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
    const index = this.random() < .28 ? 1 : 0, variant = cityTrees[index], p = [x, PAVEMENT_LEVEL, -s];
    const width = scale * (.82 + this.random() * .24), size = [width, scale, width];
    if (this.distant) this.box(x, PAVEMENT_LEVEL + scale * .24, s, .2, scale * .48, .2, '#625548');
    else this.item(`tree-trunks-${index}`, variant.bark, this.materials.bark, p, size);
    this.item(`tree-crowns-${index}`, variant.leaves, this.materials.leaves, p, size, pick(GREENS, this.random));
    this.post(x, s, .28);
  }
  buildGround() {
    const { west, east, south, north } = blockStreets(this.ix, this.iz);
    if (this.plan.kind === 'river') {
      for (const x of [RIVER_MARGIN / 2, CITY_BLOCK - RIVER_MARGIN / 2]) this.box(x, 20.85, 56, RIVER_MARGIN, 6.2, CITY_BLOCK, '#888f8e');
      const centerS = (south.halfWidth + 112 - north.halfWidth) / 2, length = 112 - south.halfWidth - north.halfWidth;
      this.box((west.halfWidth + 28) / 2, 24.06, centerS, 28 - west.halfWidth, .12, length, '#afb0a5');
      this.box((84 + 112 - east.halfWidth) / 2, 24.06, centerS, 28 - east.halfWidth, .12, length, '#afb0a5');
      this.box(56, WATER_LEVEL - .12, 56, 56, .24, CITY_BLOCK, '#ffffff', 'water');
      return;
    }
    this.box(56, 23.75, 56, CITY_BLOCK, .4, CITY_BLOCK, '#858a87');
    this.box((west.halfWidth + 112 - east.halfWidth) / 2, 24.06, (south.halfWidth + 112 - north.halfWidth) / 2, 112 - west.halfWidth - east.halfWidth, .12, 112 - south.halfWidth - north.halfWidth, '#acafa8');
    if (this.distant) return;
    // Thin paving seams keep sidewalks legible at a low camera angle.
    for (let p = 16; p < 104; p += 8) {
      for (const [edge, sign, profile] of [[0, 1, west], [112, -1, east]]) this.box(edge + sign * (profile.halfWidth + 16) / 2, 24.125, p, 16 - profile.halfWidth, .01, .035, '#929a96');
      for (const [edge, sign, profile] of [[0, 1, south], [112, -1, north]]) this.box(p, 24.125, edge + sign * (profile.halfWidth + 16) / 2, .035, .01, 16 - profile.halfWidth, '#929a96');
    }
  }
  buildRoads() { buildStreets(this); }
  buildBuildings() { buildCityBuildings(this); }
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
    const { south, north } = blockStreets(this.ix, this.iz);
    for (const [edge, sign, street] of [[0, 1, south], [112, -1, north]]) {
      const width = Math.max(10.8, street.halfWidth + 2.8);
      this.box(56, 23.49, edge + sign * width / 2, 58, .98, width, '#929b99');
      this.box(56, 24.06, edge + sign * (street.halfWidth + width) / 2, 58, .12, width - street.halfWidth, '#b6b2a4');
    }
    for (const s of [Math.max(10.8, south.halfWidth + 2.8) - .2, 112 - Math.max(10.8, north.halfWidth + 2.8) + .2]) {
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
    this.features.bridges.push({ s: this.start, u: this.east + 56, minU: this.east + 28, maxU: this.east + 84, halfWidth: south.halfWidth, height: ROAD_LEVEL });
  }
  buildFurniture() {
    const streetTree = (x, s) => {
      this.box(x, PAVEMENT_LEVEL + .055, s, 2.2, .11, 2.2, '#c0bba5');
      this.box(x, PAVEMENT_LEVEL + .12, s, 1.7, .03, 1.7, '#778568');
      this.tree(x, s, 8 + this.random() * 2);
    };
    for (const s of [27, 83]) {
      this.prop('lamp', 10.6, s); this.post(10.6, s, .25);
      this.prop('lamp', 101.4, s, Math.PI); this.post(101.4, s, .25);
    }
    if (this.plan.kind !== 'river') for (const x of [27, 83]) {
      this.prop('lamp', x, 10.6, -Math.PI / 2); this.post(x, 10.6, .25);
      this.prop('lamp', x, 101.4, Math.PI / 2); this.post(x, 101.4, .25);
      streetTree(x + 12, 11.6); streetTree(x - 12, 100.4);
    }
    if (this.plan.kind !== 'river') for (const s of [38, 70]) { streetTree(11.6, s); streetTree(100.4, s + 7); }
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
  animate(time, signalTime = time) {
    const phase = Math.floor(signalTime % 24);
    if (phase !== this.signalPhase && this.signalMesh) {
      this.signalPhase = phase;
      for (const signal of this.features.signals) {
        const green = cityGreen(signal.axis, signalTime), amber = signal.axis === 'north' ? phase === 10 : phase === 22;
        for (let i = 0; i < 3; i++) {
          tint.set((i === 2 && green) ? '#62d996' : (i === 1 && amber) ? '#ffd571' : (i === 0 && !green && !amber) ? '#ed654b' : '#293538');
          this.signalMesh.setColorAt(signal.indices[i], tint);
        }
      }
      this.signalMesh.instanceColor.needsUpdate = true;
    }
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
    this.signalMesh = this.group.getObjectByName('citydriver-lit');
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
  animate(time, signalTime = time) { for (const chunk of this.chunks.values()) chunk.animate(time, signalTime); }
  dispose() {
    for (const chunk of this.chunks.values()) chunk.dispose(); this.chunks.clear(); this.pending = [];
    for (const mesh of this.distantGroup.children) mesh.dispose(); this.distantGroup.removeFromParent(); this.distantChunks.clear();
    for (const material of Object.values(this.materials)) { material.map?.dispose(); material.dispose(); }
  }
}
