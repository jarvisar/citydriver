import * as THREE from 'three';
import { cityAssets, cityTrees } from './city-assets.js';
import { seededRandom } from './route.js';
import { residentWindow } from './resident.js';
import { applyWalkerHop, walkerTravelTime, holdWalkerTravel } from './pedestrian-reactions.js';
import { DistantCity, packDistantSteps } from './distant-city.js';
import { buildLandmark, buildDestinationSigns } from './city-landmarks.js';
import { VENUE_SIGNS, venueSignLabel } from './city-destinations.js';
import { buildPublicSpace } from './city-public-spaces.js';
import { buildGrassFringe } from './city-grass.js';
import { buildCityBuildings, buildCityBuildingSteps, shopSignMaterial } from './city-buildings.js';
import { createSignMaterial, discoverySignFor } from './city-signs.js';
import { blockStreets, buildStreets } from './city-streets.js';
import { cityGreen } from '../city-junctions.js';
import { cityWalker, cityBoat, walkerPose, walkerFloat, WALKER_COLORS, createWalkerMaterial, walkerAppearance, setWalkerAppearance, pairWalkers, offsetWalkerPose } from './city-life.js';
import { cityLayout, cityLogical, cityLayoutFrame, cityRigidFrame } from './city-layout.js';
import { cityItemMatrix, cityAffinePoint } from './city-layout-render.js';
import { addSurfacePolygon, rectanglePolygon } from './city-surfaces.js';
import { buildRiverGround, buildRivers, riverResidentPose, riverBoatPosition } from './city-rivers.js';
import { createRiverWaterMaterial, attachRiverFlow } from './river-water.js';
import { CITY_BLOCK, DISTANT_CITY_RADIUS, PAVEMENT_LEVEL, WATER_LEVEL, cityCell, cityBlock } from './city-grid.js';
export { DISTANT_CITY_RADIUS } from './city-grid.js';

const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const windowGeometry = new THREE.PlaneGeometry(1, 1);
const transform = new THREE.Object3D();
const residentItem = { p: [0, 0, 0], scale: [1, 1, 1], yaw: 0, roll: 0 };
const residentFloat = {};
const tint = new THREE.Color();
const dryRoad = new THREE.Color('#666c70'), wetRoad = new THREE.Color('#424e58');
const GREENS = ['#63924d', '#80a85c', '#4f8054', '#93ab65'];
const pick = (items, random) => items[Math.floor(random() * items.length)];

function* renderBatchSteps(group, batches, east = 0, start = 0) {
  for (const [batchKey, { geometry, material, items, structure }] of batches) {
    const key = structure ? batchKey.slice('structure-'.length) : batchKey;
    if (!items.length) continue;
    const mesh = new THREE.InstancedMesh(geometry, material, items.length); mesh.name = `citydriver-${batchKey}`;
    mesh.renderOrder = structure ? -2 : 0;
    if (key === 'water') attachRiverFlow(mesh, new Float32Array(items.flatMap(item => item.riverAddress)));
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const matrix = cityItemMatrix(item, east, start, transform.matrix);
      mesh.setMatrixAt(i, matrix); tint.set(item.color); mesh.setColorAt(i, tint);
      if (item.signTile !== undefined) mesh.setColorAt(i, tint.setRGB(item.signTile, 0, 0));
      if (key === 'residents') setWalkerAppearance(mesh, i, item.appearance);
    }
    mesh.castShadow = !key.startsWith('surface-') && !key.startsWith('public-water') && !['road', 'water', 'lit', 'signal-lens', 'detail-clock', 'glass', 'grass-fringe'].includes(key);
    mesh.receiveShadow = !['lit', 'signal-lens', 'detail-clock'].includes(key);
    if (material.userData.signAtlas) {
      mesh.castShadow = mesh.receiveShadow = false;
      mesh.userData.ambientOcclusion = false;
    }
    if (key === 'water' || key === 'grass-fringe') mesh.userData.ambientOcclusion = false;
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    mesh.computeBoundingSphere();
    if (key === 'water') mesh.boundingSphere.radius += .12;
    group.add(mesh);
    yield;
  }
}

function resources() {
  const standard = options => new THREE.MeshStandardMaterial({ roughness: .9, flatShading: true, ...options });
  // Everything used to sit at roughness .9, so masonry, asphalt, painted
  // steel and foliage all answered the sun in exactly the same way. Spreading
  // these apart is what separates one material from another. Metalness stays
  // at zero outside the glass: there is no environment map for metal to
  // reflect, so it would only darken the surface.
  const result = {
    solid: standard({ color: '#ffffff' }),
    road: standard({ color: '#666c70', roughness: .6 }),
    glass: standard({ color: '#ffffff', roughness: .2, metalness: .25 }),
    lit: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
    clock: new THREE.MeshBasicMaterial({ color: '#ffffff', vertexColors: true, toneMapped: false }),
    water: createRiverWaterMaterial(),
    // Lamp posts, signals, benches and bins: painted steel, not stucco.
    props: standard({ color: '#ffffff', vertexColors: true, roughness: .62 }),
    residents: createWalkerMaterial(),
    bark: standard({ color: '#625548', vertexColors: true, roughness: .97 }),
    leaves: standard({ color: '#ffffff', vertexColors: true, roughness: .8 }),
  };
  result.signs = createSignMaterial();
  for (const [name, [w, h]] of Object.entries(VENUE_SIGNS)) {
    for (let variant = 0; variant < (name === 'CITY HALL' ? 1 : 3); variant++) {
      result[`venue-${name}-${variant}`] = shopSignMaterial(venueSignLabel(name, variant), w / h);
    }
  }
  return result;
}

// A block owns one half of each boundary street. Its neighbour owns the other
// half, so roads and bridge decks meet without overlaps, gaps or dead ends.
export class CitydriverChunk {
  constructor(ix, iz, materials, distant = false, deferred = false) {
    this.ix = ix; this.iz = iz; this.start = iz * CITY_BLOCK; this.east = ix * CITY_BLOCK;
    this.index = `${ix},${iz}`; this.plan = cityBlock(ix, iz); this.materials = materials; this.distant = distant;
    this.group = new THREE.Group(); this.group.name = `citydriver-block-${this.index}`;
    this.features = { colliders: [], bridges: [], buildings: [], discoveries: [], medians: [], junctions: [], signals: [] };
    this.batches = new Map(); this.random = seededRandom(this.plan.seed); this.layoutFrames = new Map();
    this.construction = this.buildSteps();
    if (!deferred) this.buildUntil();
  }
  buildUntil(deadline = Infinity) {
    // Prefetch can stop between roads, individual buildings and mesh batches.
    // Startup and urgently needed collision blocks drain the same recipe.
    while (this.construction && performance.now() < deadline) {
      if (this.construction.next().done) this.construction = null;
    }
    return this.construction === null;
  }
  *buildSteps() {
    this.buildGround(); yield;
    this.buildRoads(); yield;
    if (this.plan.kind === 'river') this.buildRiver();
    else if (this.plan.landmark) buildLandmark(this);
    else if (this.plan.kind === 'park' || this.plan.kind === 'plaza') this.buildPark();
    else yield* buildCityBuildingSteps(this);
    yield;
    if (!this.distant) { this.buildFurniture(); yield; this.buildLife(); yield; }
    this.mapFeatures(); yield;
    buildGrassFringe(this); yield;
    if (!this.distant) yield* this.finishSteps();
    this.layoutFrames = null;
    this.surfacePoints = null;
    this.surfaceLayers = null;
    this.paths = this.plantedAreas = this.plantingExclusions = null;
  }
  layoutFrame(s, u, flexible = false) {
    const key = `${s},${u},${flexible}`;
    if (!this.layoutFrames.has(key)) this.layoutFrames.set(key, flexible ? cityLayoutFrame(s, u) : cityRigidFrame(s, u));
    return this.layoutFrames.get(key);
  }
  item(key, geometry, material, p, scale = [1, 1, 1], color = '#ffffff', yaw = 0, roll = 0, structure = this.buildingStructure === true) {
    if (structure) key = `structure-${key}`;
    if (!this.batches.has(key)) this.batches.set(key, { geometry, material, items: [], structure });
    const anchor = this.layoutAnchor ?? { s: this.start - p[2], u: this.east + p[0] };
    const item = { p, scale, color, yaw, roll, anchor, frame: this.layoutPlacement ?? this.layoutFrame(anchor.s, anchor.u, this.followLayout) };
    this.batches.get(key).items.push(item);
    return item;
  }
  rigid(x, s, build, placement = null) {
    const previousAnchor = this.layoutAnchor, previousPlacement = this.layoutPlacement, previousFollow = this.followLayout;
    this.layoutAnchor = { s: this.start + s, u: this.east + x };
    this.layoutPlacement = placement ?? this.layoutFrame(this.layoutAnchor.s, this.layoutAnchor.u);
    this.followLayout = false;
    try { return build(); } finally { this.layoutAnchor = previousAnchor; this.layoutPlacement = previousPlacement; this.followLayout = previousFollow; }
  }
  structure(x, s, build, placement = null) {
    // Separate architecture from scenery sharing its materials. These batches
    // draw before the car silhouette; everything else keeps its normal order.
    const previous = this.buildingStructure;
    this.buildingStructure = true;
    try { return this.rigid(x, s, build, placement); }
    finally { this.buildingStructure = previous; }
  }
  polygon(points, y, height, color, kind = 'solid') {
    addSurfacePolygon(this, points, y, height, color, kind);
  }
  groundPoint(x, s) {
    if (!this.layoutAnchor) return [x, s];
    const p = cityAffinePoint(this.start + s, this.east + x, this.layoutAnchor,
      this.layoutPlacement ?? this.layoutFrame(this.layoutAnchor.s, this.layoutAnchor.u));
    const logical = cityLogical(p.s, p.u);
    return [logical.u - this.east, logical.s - this.start];
  }
  recordPath(points, width, endSection = null) {
    this.features.walkways ??= [];
    this.features.walkways.push({ points: points.map(p => [...p]), width, ...(endSection ? { endSection } : {}) });
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
    const sign = discoverySignFor(this.plan), width = 6.1;
    for (const facing of [yaw, yaw + Math.PI]) {
      this.item(`sign-${type}`, windowGeometry, this.materials.signs,
        [x + Math.sin(facing) * .14, y, -s + Math.cos(facing) * .14],
        [width, width / sign.aspect, 1], '#ffffff', facing).signTile = sign.tile;
    }
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
    this.item(name, cityAssets[name], this.materials.props, [x, y, -s], [1, 1, 1], '#ffffff', yaw, 0, ['shelter', 'tank', 'kiosk'].includes(name));
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
  buildPark() { buildPublicSpace(this); buildDestinationSigns(this, this.plan.kind); }
  buildRiver() { buildRivers(this); }
  buildFurniture() {
    if (this.plan.kind === 'river') return;
    const { west, east, south, north } = blockStreets(this.ix, this.iz);
    // Keep the existing furniture placement unless the wider curb needs room.
    const lampInset = profile => Math.max(10.6, profile.halfWidth + .6);
    const treeInset = profile => Math.max(11.6, profile.halfWidth + 1.6);
    const streetTree = (x, s) => {
      this.box(x, PAVEMENT_LEVEL + .055, s, 2.2, .11, 2.2, '#c0bba5');
      this.box(x, PAVEMENT_LEVEL + .12, s, 1.7, .03, 1.7, '#778568');
      this.tree(x, s, 8 + this.random() * 2);
    };
    for (const s of [27, 83]) {
      this.prop('lamp', lampInset(west), s); this.post(lampInset(west), s, .25);
      this.prop('lamp', 112 - lampInset(east), s, Math.PI); this.post(112 - lampInset(east), s, .25);
    }
    for (const x of [27, 83]) {
      this.prop('lamp', x, lampInset(south), -Math.PI / 2); this.post(x, lampInset(south), .25);
      this.prop('lamp', x, 112 - lampInset(north), Math.PI / 2); this.post(x, 112 - lampInset(north), .25);
      streetTree(x + 12, treeInset(south)); streetTree(x - 12, 112 - treeInset(north));
    }
    for (const s of [38, 70]) { streetTree(treeInset(west), s); streetTree(112 - treeInset(east), s + 7); }
    const binX = Math.max(11.8, west.halfWidth + 1.8);
    this.prop('bin', binX, 43); this.post(binX, 43, .36);
  }
  buildLife() {
    // Residents stay on the pavement; they never wander into driving lanes.
    const random = seededRandom(this.plan.seed + 912), river = this.plan.kind === 'river';
    const sides = this.plan.rivers.north && this.plan.rivers.east ? 4 : 2;
    this.walkers = Array.from({ length: this.plan.landmark ? 10 : 4 }, (_, i) => ({
      phase: random() * (river ? 144 : 332), speed: 1.1 + random() * 1.1, side: i % sides,
      direction: i % 2 ? -1 : 1, size: .9 + random() * .22, width: .92 + random() * .16, color: pick(WALKER_COLORS, random),
      appearance: walkerAppearance(this.plan.seed + i * 719),
    }));
    pairWalkers(this.walkers, this.plan.seed);
    for (const walker of this.walkers) {
      const pose = offsetWalkerPose(river ? riverResidentPose(this, walker, 0) : walkerPose(walker, 0), walker, river);
      const motion = walkerFloat(walker, 0, residentFloat), width = walker.size * walker.width;
      this.item('residents', cityWalker, this.materials.residents, [pose.x, PAVEMENT_LEVEL + motion.lift, -pose.s],
        [width, walker.size * motion.stretch, width], walker.color, pose.yaw, motion.roll);
      this.batches.get('residents').items.at(-1).appearance = walker.appearance;
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
  animate(time, signalTime = time, animatePeople = true, contacts = null) {
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
    if (!animatePeople) return;
    const mesh = this.peopleMesh;
    for (let i = 0; i < this.walkers.length; i++) {
      const walker = this.walkers[i], river = this.plan.kind === 'river';
      const travelTime = walkerTravelTime(walker, time);
      const pose = offsetWalkerPose(river ? riverResidentPose(this, walker, travelTime) : walkerPose(walker, travelTime), walker, river);
      const motion = walkerFloat(walker, time, residentFloat), width = walker.size * walker.width;
      residentItem.p[0] = pose.x; residentItem.p[1] = PAVEMENT_LEVEL + motion.lift; residentItem.p[2] = -pose.s;
      residentItem.yaw = pose.yaw; residentItem.roll = motion.roll;
      residentItem.scale[0] = residentItem.scale[2] = width; residentItem.scale[1] = walker.size * motion.stretch;
      const matrix = cityItemMatrix(residentItem, this.east, this.start, transform.matrix), e = matrix.elements;
      if (contacts?.hit(walker, e[12] + this.east, e[13], e[14] - this.start, .28 * width, time)) {
        const partner = walker.pairOffset ? this.walkers[i + (walker.pairOffset < 0 ? 1 : -1)] : null;
        holdWalkerTravel(walker, partner, time);
      }
      applyWalkerHop(walker, matrix, time);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (this.boatMesh) this.boatMesh.position.y = Math.sin(time * .8 + this.plan.seed) * .08;
  }
  finish() { for (const _ of this.finishSteps()) { /* synchronous tools/startup */ } }
  *finishSteps() {
    // Record the exact rigid lamp placement, including curved streets and
    // bridge furniture. Lighting reuses these points without scene traversal.
    this.features.lamps = (this.batches.get('lamp')?.items ?? []).map(item => {
      const matrix = cityItemMatrix(item, this.east, this.start, transform.matrix);
      const point = new THREE.Vector3(-1.75, 7.36, 0).applyMatrix4(matrix);
      return { x: point.x + this.east, y: point.y, z: point.z - this.start,
        yaw: Math.atan2(matrix.elements[8], matrix.elements[10]) };
    });
    yield* renderBatchSteps(this.group, this.batches, this.east, this.start);
    this.signalMesh = this.group.getObjectByName('citydriver-signal-lens');
    this.peopleMesh = this.group.getObjectByName('citydriver-residents');
    if (this.peopleMesh) {
      this.peopleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Their initial positions do not bound the full walk around the block.
      const center = cityLayout(this.start + 56, this.east + 56);
      this.peopleMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(center.u - this.east, PAVEMENT_LEVEL + 1, this.start - center.s), 100);
    }
    this.boatMesh = this.group.getObjectByName('citydriver-canal-boat');
    if (this.boatMesh) this.boatMesh.matrixAutoUpdate = true;
    this.group.matrixAutoUpdate = false;
    this.collisionBounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const c of this.features.colliders) {
      this.collisionBounds.minX = Math.min(this.collisionBounds.minX, c.x - c.reach);
      this.collisionBounds.maxX = Math.max(this.collisionBounds.maxX, c.x + c.reach);
      this.collisionBounds.minZ = Math.min(this.collisionBounds.minZ, c.z - c.reach);
      this.collisionBounds.maxZ = Math.max(this.collisionBounds.maxZ, c.z + c.reach);
    }
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
  dispose() {
    this.construction?.return(); this.construction = null;
    this.group.removeFromParent(); for (const mesh of this.group.children) mesh.dispose();
  }
}

export class CitydriverWorld {
  constructor(scene) {
    this.scene = scene; this.chunks = new Map(); this.origin = 0; this.center = null;
    this.s = 0; this.u = 2.4; this.materials = resources(); this.pending = [];
    this.distantChunks = new Map(); this.distantGroup = new THREE.Group();
    this.distantGroup.name = 'citydriver-distant-city'; scene.add(this.distantGroup);
    this.distantGroup.matrixAutoUpdate = false;
    this.distantCity = new DistantCity(this.distantGroup);
    this.prefetched = new Map(); this.prefetchPending = []; this.prefetchTarget = null;
    this.prefetchedDetails = new Map(); this.prefetchDetailPending = [];
    this.prefetchedDemotions = new Map(); this.prefetchDemotionPending = []; this.prefetchBuild = null;
    this.prefetchDirection = { x: 0, z: 0 };
    this.animationFrustum = new THREE.Frustum(); this.animationMatrix = new THREE.Matrix4(); this.animationSphere = new THREE.Sphere();
  }
  update(s, u = 2.4, { budgetMs = Infinity } = {}) {
    const deadline = performance.now() + budgetMs, oldOrigin = this.origin;
    const ds = s - this.s, du = u - this.u;
    this.s = s; this.u = u; this.origin = Math.floor(s / 1024) * 1024;
    this.materials.water.userData.origin.value = this.origin;
    const cell = cityCell(s, u), window = residentWindow();
    const radius = window.ahead >= 5 ? 3 : window.ahead >= 4 ? 2 : 1;
    let placementChanged = oldOrigin !== this.origin;
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
      // Keep a distant fallback until a detailed replacement is ready. Nearby
      // collisions load synchronously; optional detail can span several frames.
      for (const [key, chunk] of this.distantChunks) {
        if (Math.abs(chunk.ix - cell.ix) > DISTANT_CITY_RADIUS || Math.abs(chunk.iz - cell.iz) > DISTANT_CITY_RADIUS || this.chunks.has(key)) {
          this.distantCity.delete(chunk); this.distantChunks.delete(key);
        }
      }
      for (let ix = cell.ix - DISTANT_CITY_RADIUS; ix <= cell.ix + DISTANT_CITY_RADIUS; ix++) for (let iz = cell.iz - DISTANT_CITY_RADIUS; iz <= cell.iz + DISTANT_CITY_RADIUS; iz++) {
        const key = `${ix},${iz}`;
        const distance = Math.max(Math.abs(ix - cell.ix), Math.abs(iz - cell.iz));
        if (distance <= (Number.isFinite(budgetMs) ? 1 : radius)) continue;
        if (!this.chunks.has(key) && !this.distantChunks.has(key)) {
          const chunk = this.prefetched.get(key) ?? this.prefetchedDemotions.get(key) ?? this.requiredChunk(ix, iz, true);
          this.prefetched.delete(key);
          this.prefetchedDemotions.delete(key);
          this.distantChunks.set(key, chunk); this.distantCity.add(chunk);
        }
      }
    }
    let built = 0;
    while (this.pending.length) {
      if (this.pending[0].distance > 1 && built > 0 && performance.now() >= deadline) break;
      const next = this.pending.shift(), key = `${next.ix},${next.iz}`;
      const chunk = this.prefetchedDetails.get(key) ?? this.requiredChunk(next.ix, next.iz, false);
      this.prefetchedDetails.delete(key);
      this.chunks.set(chunk.index, chunk); this.scene.add(chunk.group);
      const distant = this.distantChunks.get(chunk.index);
      if (distant) { this.distantCity.delete(distant); this.distantChunks.delete(chunk.index); }
      placementChanged = true; built++;
    }
    if (placementChanged) {
      for (const chunk of this.chunks.values()) {
        chunk.group.position.set(chunk.east, 0, this.origin - chunk.start); chunk.group.updateMatrix();
      }
      this.distantGroup.position.z = this.origin; this.distantGroup.updateMatrix();
    }
    this.rebuildDistant();
    if (Number.isFinite(budgetMs) && !this.pending.length) this.prefetchDistant(cell, ds, du, deadline);
  }
  requiredChunk(ix, iz, distant) {
    // If the car reaches an unfinished block, finish its remaining work rather
    // than throwing away the work already done. Collision coverage is urgent.
    const chunk = this.prefetchBuild?.chunk;
    if (chunk && chunk.ix === ix && chunk.iz === iz && chunk.distant === distant) {
      this.prefetchBuild = null; chunk.buildUntil(); return chunk;
    }
    return new CitydriverChunk(ix, iz, this.materials, distant);
  }
  prefetchDistant(cell, ds, du, deadline) {
    // Prepare both sides of the detail transition and the next skyline strip.
    // Work resumes within the frame budget, completing at most one block per
    // frame. Packed distant caches own no GPU objects.
    const p = cityLogical(this.s, this.u), x = p.u - cell.ix * CITY_BLOCK, z = p.s - cell.iz * CITY_BLOCK;
    // Rendering can run faster than fixed-step physics. A repeated position is
    // not a turn: keep preparing the same strip instead of disposing and
    // rebuilding it on alternating frames. Predict in logical street space,
    // since a curved northbound road also moves east/west in world space.
    if (ds || du) {
      const previous = cityLogical(this.s - ds, this.u - du);
      this.prefetchDirection.x = Math.abs(p.u - previous.u) > 1e-6 ? Math.sign(p.u - previous.u) : 0;
      this.prefetchDirection.z = Math.abs(p.s - previous.s) > 1e-6 ? Math.sign(p.s - previous.s) : 0;
    }
    const dx = this.prefetchDirection.x < 0 && x < 48 ? -1 : this.prefetchDirection.x > 0 && x > CITY_BLOCK - 48 ? 1 : 0;
    const dz = this.prefetchDirection.z < 0 && z < 48 ? -1 : this.prefetchDirection.z > 0 && z > CITY_BLOCK - 48 ? 1 : 0;
    const key = `${cell.ix + dx},${cell.iz + dz}/${this.radius}`;
    if (key !== this.prefetchTarget) {
      this.prefetchTarget = key; this.prefetchPending = []; this.prefetchDetailPending = [];
      this.prefetchBuild?.chunk.dispose(); this.prefetchBuild = null;
      this.prefetchDemotionPending = [];
      // Prepare the whole next detail strip, including the outer detail at
      // higher quality. Basic needs at most five blocks; High needs thirteen.
      // They own buffers, so retire unused entries when the driver turns away.
      const detailWanted = new Set();
      if (dx || dz) for (let ix = cell.ix + dx - this.radius; ix <= cell.ix + dx + this.radius; ix++) {
        for (let iz = cell.iz + dz - this.radius; iz <= cell.iz + dz + this.radius; iz++) {
          const index = `${ix},${iz}`;
          if (this.chunks.has(index)) continue;
          detailWanted.add(index);
          if (!this.prefetchedDetails.has(index)) this.prefetchDetailPending.push({ ix, iz, index });
        }
      }
      for (const [index, chunk] of this.prefetchedDetails) if (!detailWanted.has(index)) {
        chunk.dispose(); this.prefetchedDetails.delete(index);
      }
      // The trailing detail strip also changes level at a crossing. Without
      // preparing it, all of its distant models are regenerated in that frame.
      const demotionWanted = new Set();
      if (dx || dz) for (const chunk of this.chunks.values()) {
        if (Math.abs(chunk.ix - cell.ix - dx) <= this.radius && Math.abs(chunk.iz - cell.iz - dz) <= this.radius) continue;
        demotionWanted.add(chunk.index);
        if (!this.prefetchedDemotions.has(chunk.index)) this.prefetchDemotionPending.push({ ix: chunk.ix, iz: chunk.iz, index: chunk.index });
      }
      for (const index of this.prefetchedDemotions.keys()) if (!demotionWanted.has(index)) this.prefetchedDemotions.delete(index);
      const wanted = new Set();
      if (dx || dz) for (let ix = cell.ix + dx - DISTANT_CITY_RADIUS; ix <= cell.ix + dx + DISTANT_CITY_RADIUS; ix++) {
        for (let iz = cell.iz + dz - DISTANT_CITY_RADIUS; iz <= cell.iz + dz + DISTANT_CITY_RADIUS; iz++) {
          if (Math.abs(ix - cell.ix) <= DISTANT_CITY_RADIUS && Math.abs(iz - cell.iz) <= DISTANT_CITY_RADIUS) continue;
          const index = `${ix},${iz}`; wanted.add(index);
          if (!this.prefetched.has(index)) this.prefetchPending.push({ ix, iz, index });
        }
      }
      for (const index of this.prefetched.keys()) if (!wanted.has(index)) this.prefetched.delete(index);
    }
    if (performance.now() >= deadline) return;
    if (!this.prefetchBuild) {
      const detail = this.prefetchDetailPending.length > 0;
      const demotion = !detail && this.prefetchDemotionPending.length > 0;
      const next = (detail ? this.prefetchDetailPending : demotion ? this.prefetchDemotionPending : this.prefetchPending).shift();
      if (!next) return;
      const chunk = new CitydriverChunk(next.ix, next.iz, this.materials, !detail, true);
      this.prefetchBuild = { chunk, cache: detail ? this.prefetchedDetails : demotion ? this.prefetchedDemotions : this.prefetched };
    }
    const work = this.prefetchBuild;
    if (!work.chunk.buildUntil(deadline)) return;
    if (work.chunk.distant) {
      work.packing ??= packDistantSteps(work.chunk);
      while (performance.now() < deadline) {
        if (work.packing.next().done) { work.packing = null; break; }
      }
      if (work.packing) return;
    }
    work.cache.set(work.chunk.index, work.chunk); this.prefetchBuild = null;
  }
  rebuildDistant() {
    this.distantCity.rebuild();
  }
  *collisionChunks(s, u) {
    const cell = cityCell(s, u);
    for (let ix = cell.ix - 1; ix <= cell.ix + 1; ix++) for (let iz = cell.iz - 1; iz <= cell.iz + 1; iz++) {
      const chunk = this.chunks.get(`${ix},${iz}`); if (chunk) yield chunk;
    }
  }
  setWetness(amount) {
    const wet = Math.max(0, Math.min(1, amount));
    if (wet === this.wetness) return;
    this.wetness = wet;
    this.materials.road.roughness = .6 - wet * .33;
    this.materials.road.color.copy(dryRoad).lerp(wetRoad, wet);
  }
  animate(time, signalTime = time, camera = null, contacts = null) {
    this.materials.water.userData.time.value = time;
    if (camera) {
      camera.updateMatrixWorld();
      this.animationMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.animationFrustum.setFromProjectionMatrix(this.animationMatrix);
    }
    for (const chunk of this.chunks.values()) {
      let visible = true;
      if (camera && chunk.peopleMesh) {
        this.animationSphere.copy(chunk.peopleMesh.boundingSphere);
        this.animationSphere.center.add(chunk.group.position);
        // Include residents whose shadows can fall into the visible area.
        this.animationSphere.radius += 12;
        visible = this.animationFrustum.intersectsSphere(this.animationSphere);
      }
      chunk.animate(time, signalTime, visible, contacts);
    }
  }
  dispose() {
    for (const chunk of this.chunks.values()) chunk.dispose(); this.chunks.clear(); this.pending = [];
    this.distantCity.dispose(); this.distantGroup.removeFromParent(); this.distantChunks.clear();
    this.prefetched.clear(); this.prefetchPending = [];
    for (const chunk of this.prefetchedDetails.values()) chunk.dispose();
    this.prefetchedDetails.clear(); this.prefetchDetailPending = [];
    this.prefetchBuild?.chunk.dispose(); this.prefetchBuild = null;
    this.prefetchedDemotions.clear(); this.prefetchDemotionPending = [];
    for (const material of Object.values(this.materials)) { material.map?.dispose(); material.dispose(); }
  }
}
