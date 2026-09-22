import * as THREE from 'three';
import { cityAssets, cityTrees } from './city-assets.js';
import { seededRandom } from './route.js';
import { residentWindow } from './resident.js';
import { buildLandmark } from './city-landmarks.js';
import { buildPublicSpace } from './city-public-spaces.js';
import { buildCityBuildings, SHOP_NAMES, shopSignMaterial } from './city-buildings.js';
import { blockStreets, buildStreets } from './city-streets.js';
import { cityGreen } from '../city-junctions.js';
import { CITY_PLACES } from './city-places.js';
import { cityWalker, cityBoat, walkerPose } from './city-life.js';
import { cityLayout, cityLayoutFrame, cityRigidFrame } from './city-layout.js';
import { cityItemMatrix, cityAffinePoint } from './city-layout-render.js';
import { addSurfacePolygon, rectanglePolygon } from './city-surfaces.js';
import { buildRiverGround, buildRivers, riverResidentPose, riverBoatPosition } from './city-rivers.js';
import { CITY_BLOCK, DISTANT_CITY_RADIUS, PAVEMENT_LEVEL, WATER_LEVEL, cityCell, cityBlock } from './city-grid.js';
export { DISTANT_CITY_RADIUS } from './city-grid.js';

const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const windowGeometry = new THREE.PlaneGeometry(1, 1);
const transform = new THREE.Object3D();
const tint = new THREE.Color();
const GREENS = ['#63924d', '#80a85c', '#4f8054', '#93ab65'];
const pick = (items, random) => items[Math.floor(random() * items.length)];

function renderBatches(group, batches, distant = false, east = 0, start = 0) {
  for (const [key, { geometry, material, items }] of batches) {
    if (!items.length) continue;
    const mesh = new THREE.InstancedMesh(geometry, material, items.length); mesh.name = `citydriver-${key}`;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const matrix = item.worldMatrix ? transform.matrix.fromArray(item.worldMatrix) : cityItemMatrix(item, east, start, transform.matrix);
      mesh.setMatrixAt(i, matrix); tint.set(item.color); mesh.setColorAt(i, tint);
    }
    mesh.castShadow = !distant && !key.startsWith('surface-') && !['road', 'water', 'lit', 'glass', 'public-water'].includes(key);
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
    this.batches = new Map(); this.random = seededRandom(this.plan.seed); this.layoutFrames = new Map();
    this.buildGround(); this.buildRoads();
    if (this.plan.kind === 'river') this.buildRiver();
    else if (this.plan.landmark) buildLandmark(this);
    else if (this.plan.kind === 'park' || this.plan.kind === 'plaza') this.buildPark();
    else this.buildBuildings();
    if (!distant) { this.buildFurniture(); this.buildLife(); }
    this.mapFeatures();
    if (!distant) this.finish();
    this.layoutFrames = null;
    this.surfacePoints = null;
    this.paths = this.plantedAreas = this.plantingExclusions = null;
  }
  layoutFrame(s, u, flexible = false) {
    const key = `${s},${u},${flexible}`;
    if (!this.layoutFrames.has(key)) this.layoutFrames.set(key, flexible ? cityLayoutFrame(s, u) : cityRigidFrame(s, u));
    return this.layoutFrames.get(key);
  }
  item(key, geometry, material, p, scale = [1, 1, 1], color = '#ffffff', yaw = 0, roll = 0) {
    if (!this.batches.has(key)) this.batches.set(key, { geometry, material, items: [] });
    const anchor = this.layoutAnchor ?? { s: this.start - p[2], u: this.east + p[0] };
    this.batches.get(key).items.push({ p, scale, color, yaw, roll, anchor, frame: this.layoutPlacement ?? this.layoutFrame(anchor.s, anchor.u, this.followLayout) });
  }
  rigid(x, s, build, placement = null) {
    const previousAnchor = this.layoutAnchor, previousPlacement = this.layoutPlacement, previousFollow = this.followLayout;
    this.layoutAnchor = { s: this.start + s, u: this.east + x };
    this.layoutPlacement = placement ?? this.layoutFrame(this.layoutAnchor.s, this.layoutAnchor.u);
    this.followLayout = false;
    try { return build(); } finally { this.layoutAnchor = previousAnchor; this.layoutPlacement = previousPlacement; this.followLayout = previousFollow; }
  }
  polygon(points, y, height, color, kind = 'solid') {
    addSurfacePolygon(this, points, y, height, color, kind);
  }
  recordPath(points, width) {
    this.features.walkways ??= [];
    this.features.walkways.push({ points: points.map(p => [...p]), width });
  }
  recordPlanting(points) {
    this.features.planting ??= []; this.features.planting.push(points.map(p => [...p]));
  }
  recordReserve(points) {
    this.features.plantingExclusions ??= []; this.features.plantingExclusions.push(points.map(p => [...p]));
  }
  polygonSolid(points) {
    if (!this.distant) this.features.colliders.push({ logicalPolygon: points.map(([x, s]) => [this.east + x, this.start + s]) });
  }
  surface(x, y, s, width, height, depth, color, kind = 'solid', yaw = 0, roll = 0) {
    if (this.layoutAnchor || roll) return this.box(x, y, s, width, height, depth, color, kind, yaw, roll);
    this.polygon(rectanglePolygon(x, s, width, depth, yaw), y, height, color, kind);
  }
  box(x, y, s, width, height, depth, color, kind = 'solid', yaw = 0, roll = 0) {
    this.item(kind, boxGeometry, this.materials[kind], [x, y, -s], [width, height, depth], color, yaw, roll);
  }
  sign(type, x, y, s, yaw) {
    if (this.distant) return;
    this.item(`sign-${type}`, windowGeometry, this.materials[`sign-${type}`], [x + Math.sin(yaw) * .34, y, -s + Math.cos(yaw) * .34], [6.1, 3.05, 1], '#ffffff', yaw);
  }
  solid(x, s, width, depth, flexible = false) {
    if (this.distant) return;
    const nx = !this.layoutAnchor && depth < 1 ? Math.ceil(width / 14) : 1;
    const nz = !this.layoutAnchor && width < 1 ? Math.ceil(depth / 14) : 1;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) this.features.colliders.push({
      x: this.east + x + (nx === 1 ? 0 : -width / 2 + (i + .5) * width / nx), z: -this.start - s + (nz === 1 ? 0 : depth / 2 - (j + .5) * depth / nz),
      heading: 0, halfWidth: width / nx / 2, halfLength: depth / nz / 2, reach: Math.hypot(width / nx, depth / nz) / 2, anchor: this.layoutAnchor, frame: this.layoutPlacement, flexible,
    });
  }
  post(x, s, radius) { if (!this.distant) this.features.colliders.push({ x: this.east + x, z: -this.start - s, reach: radius, anchor: this.layoutAnchor, frame: this.layoutPlacement }); }
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
    this.features.trees ??= [];
    this.features.trees.push({ x, s, scale });
    this.post(x, s, .28);
  }
  buildGround() {
    const { west, east, south, north } = blockStreets(this.ix, this.iz);
    if (this.plan.kind === 'river') {
      buildRiverGround(this);
      return;
    }
    // Streets and pavement cover the full block with shared edges. A second
    // buried slab is unnecessary now that the ground no longer has tile gaps.
    this.surface((west.halfWidth + 112 - east.halfWidth) / 2, 24.06, (south.halfWidth + 112 - north.halfWidth) / 2, 112 - west.halfWidth - east.halfWidth, .12, 112 - south.halfWidth - north.halfWidth, '#acafa8');
    if (this.distant) return;
    // Thin paving seams keep sidewalks legible at a low camera angle.
    for (let p = 16; p < 104; p += 8) {
      for (const [edge, sign, profile] of [[0, 1, west], [112, -1, east]]) this.surface(edge + sign * (profile.halfWidth + 16) / 2, 24.125, p, 16 - profile.halfWidth, .01, .035, '#929a96');
      for (const [edge, sign, profile] of [[0, 1, south], [112, -1, north]]) this.surface(p, 24.125, edge + sign * (profile.halfWidth + 16) / 2, .035, .01, 16 - profile.halfWidth, '#929a96');
    }
  }
  buildRoads() { buildStreets(this); }
  buildBuildings() { buildCityBuildings(this); }
  buildPark() { buildPublicSpace(this); }
  buildRiver() { buildRivers(this); }
  buildFurniture() {
    if (this.plan.kind === 'river') return;
    const streetTree = (x, s) => {
      this.box(x, PAVEMENT_LEVEL + .055, s, 2.2, .11, 2.2, '#c0bba5');
      this.box(x, PAVEMENT_LEVEL + .12, s, 1.7, .03, 1.7, '#778568');
      this.tree(x, s, 8 + this.random() * 2);
    };
    for (const s of [27, 83]) {
      this.prop('lamp', 10.6, s); this.post(10.6, s, .25);
      this.prop('lamp', 101.4, s, Math.PI); this.post(101.4, s, .25);
    }
    for (const x of [27, 83]) {
      this.prop('lamp', x, 10.6, -Math.PI / 2); this.post(x, 10.6, .25);
      this.prop('lamp', x, 101.4, Math.PI / 2); this.post(x, 101.4, .25);
      streetTree(x + 12, 11.6); streetTree(x - 12, 100.4);
    }
    for (const s of [38, 70]) { streetTree(11.6, s); streetTree(100.4, s + 7); }
    this.prop('bin', 11.8, 43); this.post(11.8, 43, .36);
  }
  buildLife() {
    // Residents stay on the pavement; they never wander into driving lanes.
    const random = seededRandom(this.plan.seed + 912), river = this.plan.kind === 'river';
    const sides = this.plan.rivers.north && this.plan.rivers.east ? 4 : 2;
    this.walkers = Array.from({ length: this.plan.landmark ? 10 : 4 }, (_, i) => ({ phase: random() * (river ? 144 : 332), speed: .65 + random() * .45, side: i % sides }));
    for (const walker of this.walkers) {
      const pose = river ? riverResidentPose(this, walker, 0) : walkerPose(walker, 0);
      this.item('residents', cityWalker, this.materials.props, [pose.x, PAVEMENT_LEVEL, -pose.s], [1, 1, 1], '#ffffff', pose.yaw);
    }
    if (river) {
      const x = this.plan.seed % 2 ? 37 : 75, s = 42 + random() * 25;
      const boat = riverBoatPosition(this, x, s);
      this.item('canal-boat', cityBoat, this.materials.props, [boat.x, WATER_LEVEL, -boat.s], [1, 1, 1], '#ffffff', boat.yaw);
      if (!(this.plan.rivers.north && this.plan.rivers.east)) {
        const dock = riverBoatPosition(this, x < 56 ? 30.5 : 81.5, s);
        this.rigid(dock.x, dock.s, () => {
          this.box(dock.x, WATER_LEVEL + .65, dock.s, 5, .35, 18, '#a39478', 'solid', dock.yaw);
          for (const ds of [-7, 7]) {
            const post = riverBoatPosition(this, x < 56 ? 32 : 80, s + ds);
            this.box(post.x, WATER_LEVEL, post.s, .5, 3, .5, '#6e7568');
          }
        });
      }
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
      const walker = this.walkers[i], pose = this.plan.kind === 'river' ? riverResidentPose(this, walker, time) : walkerPose(walker, time);
      mesh.setMatrixAt(i, cityItemMatrix({ p: [pose.x, PAVEMENT_LEVEL + Math.sin(time * 7 + walker.phase) * .025, -pose.s],
        yaw: pose.yaw, roll: Math.sin(time * 3.5 + walker.phase) * .025, scale: [1, 1, 1] }, this.east, this.start, transform.matrix));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (this.boatMesh) this.boatMesh.position.y = Math.sin(time * .8 + this.plan.seed) * .08;
  }
  finish() {
    renderBatches(this.group, this.batches, false, this.east, this.start);
    this.signalMesh = this.group.getObjectByName('citydriver-lit');
    this.peopleMesh = this.group.getObjectByName('citydriver-residents');
    if (this.peopleMesh) {
      this.peopleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Their initial positions do not bound the full walk around the block.
      const center = cityLayout(this.start + 56, this.east + 56);
      this.peopleMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(center.u - this.east, PAVEMENT_LEVEL + 1, this.start - center.s), 100);
    }
    this.boatMesh = this.group.getObjectByName('citydriver-canal-boat');
    this.batches = null;
  }
  mapFeatures() {
    for (const c of this.features.colliders) {
      if (c.logicalPolygon) {
        const n = c.logicalPolygon.length;
        c.logicalU = c.logicalPolygon.reduce((sum, p) => sum + p[0], 0) / n;
        c.logicalS = c.logicalPolygon.reduce((sum, p) => sum + p[1], 0) / n;
        c.corners = c.logicalPolygon.map(([u, s]) => { const p = cityLayout(s, u); return { x: p.u, z: -p.s }; });
        c.x = c.corners.reduce((sum, p) => sum + p.x, 0) / n; c.z = c.corners.reduce((sum, p) => sum + p.z, 0) / n;
        c.reach = Math.max(...c.corners.map(p => Math.hypot(p.x - c.x, p.z - c.z)));
        c.heading = 0; delete c.logicalPolygon; continue;
      }
      const s = -c.z, u = c.x, anchor = c.anchor ?? { s, u }, frame = c.frame ?? this.layoutFrame(anchor.s, anchor.u, c.flexible);
      const p = cityAffinePoint(s, u, anchor, frame);
      c.logicalS = s; c.logicalU = u; c.x = p.u; c.z = -p.s;
      if (c.halfWidth !== undefined) {
        c.corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([dx, ds]) => {
          const v = cityAffinePoint(s + ds * c.halfLength, u + dx * c.halfWidth, anchor, frame);
          return { x: v.u, z: -v.s };
        });
        c.reach = Math.max(...c.corners.map(v => Math.hypot(v.x - c.x, v.z - c.z)));
        c.heading = Math.atan2(frame.nu, frame.ns);
      }
      delete c.anchor; delete c.frame;
    }
    for (const b of this.features.buildings) {
      b.logicalS = b.s; b.logicalU = b.x;
      const p = b.placement ?? cityLayout(b.s, b.x); b.s = p.s; b.x = p.u;
    }
    for (const d of this.features.discoveries) Object.assign(d, cityLayout(d.s, d.u));
    for (const j of this.features.junctions) { const p = cityLayout(j.s, j.x); j.s = p.s; j.x = p.u; }
    for (const b of this.features.bridges) Object.assign(b, cityLayout(b.s, b.u));
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
      for (const item of batch.items) {
        // Distant blocks are immutable. Reusing their physical matrices avoids
        // recalculating thousands of transforms every time one strip streams.
        if (!item.worldMatrix) {
          cityItemMatrix(item, chunk.east, chunk.start, transform.matrix);
          transform.matrix.elements[12] += chunk.east; transform.matrix.elements[14] -= chunk.start;
          item.worldMatrix = new Float32Array(transform.matrix.elements);
        }
        items.push(item);
      }
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
