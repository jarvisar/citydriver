import * as THREE from 'three';
import { registerChunkResources } from './chunk-resources.js';
import { finalizeChunkTransforms } from './chunk-transforms.js';
import { splitBatch } from './instance-batches.js';
import { updateResidentChunks } from './resident.js';
import { CHUNK_LENGTH, randomAt, seededRandom, roadHeight, roadFrame } from './route.js';
import { DESERT_COLUMNS, DESERT_STEP, DESERT_VALLEY_EDGE, desertFacetColumn, desertColumns, desertVertex, desertPosition, desertHeight, desertRowStep, desertBridgeAt, desertCreek, desertCreekDistance, canyonProfile, dryWashCenter, dryWashWidth, mesasForChunk, insideMesa } from './desert-route.js';
import { buildDesertCrossing, buildDesertWater, desertWaterClock } from './desert-river.js';
import { desertDiscoveries, desertDiscoveryClears, desertFuelApronWidth } from './desert-discoveries.js';
import { buildDesertDiscoveries } from './desert-discovery-scenery.js';
import { solidPost } from './colliders.js';

const groundMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
const rockMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true });
const barkMaterial = new THREE.MeshStandardMaterial({ color: '#745038', roughness: 1, flatShading: true });
const plantMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true, side: THREE.DoubleSide });
const asphaltMaterial = new THREE.MeshStandardMaterial({ color: '#797669', roughness: 1 });
const sandMaterial = new THREE.MeshStandardMaterial({ color: '#dcb07a', roughness: 1 });
const edgeMaterial = new THREE.MeshStandardMaterial({ color: '#f6dfac', roughness: 1 });
const centerMaterial = new THREE.MeshStandardMaterial({ color: '#eac36a', roughness: 1 });
const stoneGeometry = new THREE.DodecahedronGeometry(1, 0);
const bushGeometry = new THREE.IcosahedronGeometry(1, 0);
const trunkGeometry = new THREE.CylinderGeometry(.72, 1, 1, 5);
const cactusGeometry = new THREE.SphereGeometry(1, 7, 5);
const transform = new THREE.Object3D();
const up = new THREE.Vector3(0, 1, 0);

function geometry(positions, colors) {
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (colors) result.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  result.computeVertexNormals(); result.computeBoundingSphere(); return result;
}
function triangle(positions, colors, a, b, c, color, start, upward = true) {
  if (upward && (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) < 0) [b, c] = [c, b];
  for (const p of [a, b, c]) { positions.push(p.x, p.y, p.z + start); if (colors) colors.push(color.r, color.g, color.b); }
}
function instances(group, source, material, items, name) {
  if (!items.length) return;
  for (const part of splitBatch(items)) batch(group, source, material, part, name);
}

function batch(group, source, material, items, name) {
  const mesh = new THREE.InstancedMesh(source, material, items.length);
  if (name) mesh.name = name;
  items.forEach((item, index) => {
    transform.position.set(...item.p); transform.rotation.set(...(item.r ?? [0, 0, 0]));
    if (item.q) transform.quaternion.copy(item.q);
    transform.scale.set(...item.scale); transform.updateMatrix(); mesh.setMatrixAt(index, transform.matrix);
    if (item.color) mesh.setColorAt(index, new THREE.Color(item.color));
  });
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere(); group.add(mesh);
}

// Flat triangular leaves form the spiky silhouettes of yuccas and Joshua trees.
const leafPositions = [];
for (let i = 0; i < 31; i++) {
  const angle = i * 2.399963;
  const radius = .65 + randomAt(i, 916) * .65;
  const x = Math.cos(angle), z = Math.sin(angle);
  const height = .2 + randomAt(i, 917) * 1.1;
  leafPositions.push(-z * .11, 0, x * .11, x * radius, height, z * radius, z * .11, 0, -x * .11);
}
const leafGeometry = geometry(leafPositions);

// Broad, folded leaves give the agaves a different silhouette from fine yuccas.
const agavePositions = [];
for (let i = 0; i < 13; i++) {
  const angle = i * 2.399963, x = Math.cos(angle), z = Math.sin(angle);
  const length = .9 + randomAt(i, 724) * .8;
  const left = { x: -z * .18, y: .08, z: x * .18 };
  const right = { x: z * .18, y: .08, z: -x * .18 };
  const fold = { x: x * length * .6, y: .58, z: z * length * .6 };
  const tip = { x: x * length, y: .28 + randomAt(i, 725) * .4, z: z * length };
  for (const p of [left, fold, right, left, tip, fold, fold, tip, right]) agavePositions.push(p.x, p.y, p.z);
}
const agaveGeometry = geometry(agavePositions);

// Bent, narrow blades catch the light around the reference's scrub pockets.
const grassPositions = [];
for (let i = 0; i < 17; i++) {
  const angle = i * 2.399963, x = Math.cos(angle), z = Math.sin(angle);
  const height = .45 + randomAt(i, 862) * .6;
  const bend = .22 + randomAt(i, 863) * .4;
  grassPositions.push(-z * .035, 0, x * .035, x * bend * .4, height * .7, z * bend * .4, z * .035, 0, -x * .035,
    z * .035, 0, -x * .035, x * bend * .4, height * .7, z * bend * .4, x * bend, height, z * bend);
}
const grassGeometry = geometry(grassPositions);

// Uneven rings make broad broken slabs with sloping fracture faces.
const slabPositions = [];
const slabRings = [[-.35, .93], [.08, 1.08], [.48, .68]].map(([y, radius], layer) =>
  Array.from({ length: 7 }, (_, i) => {
    const angle = i / 7 * Math.PI * 2;
    const r = radius * (.85 + randomAt(i, 864) * .3);
    return { x: Math.cos(angle) * r + layer * .07, y: y + (randomAt(i, 865) - .5) * .14, z: Math.sin(angle) * r };
  }));
for (let i = 0; i < 7; i++) {
  const next = (i + 1) % 7;
  for (let layer = 0; layer < 2; layer++) {
    const a = slabRings[layer][i], b = slabRings[layer][next], c = slabRings[layer + 1][i], d = slabRings[layer + 1][next];
    // Counterclockwise rings viewed from above; wall winding faces outward.
    triangle(slabPositions, null, a, c, b, null, 0, false);
    triangle(slabPositions, null, b, c, d, null, 0, false);
  }
  triangle(slabPositions, null, { x: .1, y: .52, z: 0 }, slabRings[2][i], slabRings[2][next], null, 0);
  triangle(slabPositions, null, { x: 0, y: -.42, z: 0 }, slabRings[0][i], slabRings[0][next], null, 0, false);
}
const slabGeometry = geometry(slabPositions);
registerChunkResources('desert', { groundMaterial, rockMaterial, barkMaterial, plantMaterial, asphaltMaterial, sandMaterial,
  edgeMaterial, centerMaterial, stoneGeometry, bushGeometry, trunkGeometry, cactusGeometry, leafGeometry, agaveGeometry, grassGeometry, slabGeometry });

export class DesertChunk {
  constructor(index) {
    this.index = index; this.start = index * CHUNK_LENGTH; this.group = new THREE.Group(); this.owned = []; this.vertices = new Map();
    this.group.name = `desert-chunk-${index}`;
    this.discoveries = desertDiscoveries(this.start - 40, this.start + CHUNK_LENGTH + 40);
    // A row uses only two column profiles (road and jittered terrain), shared
    // by all its vertices. Keep this cache local to the chunk's construction.
    const columns = new Map();
    this.sampleColumns = s => {
      if (!columns.has(s)) columns.set(s, desertColumns(s));
      return columns.get(s);
    };
    this.buildGround(); this.buildMesas(); this.buildRoad();
    buildDesertCrossing(this, instances, { stoneGeometry, slabGeometry, bushGeometry, trunkGeometry, grassGeometry, rockMaterial, barkMaterial, plantMaterial });
    this.buildPlants(); this.buildReferenceDetails(); this.buildForeground();
    this.clearDiscoveryFootprints();
    buildDesertDiscoveries(this, this.discoveries);
    this.sampleColumns = desertColumns;
    finalizeChunkTransforms(this.group);
  }
  addMesh(source, material, castShadow = false) {
    const mesh = new THREE.Mesh(source, material); mesh.castShadow = castShadow; mesh.receiveShadow = true;
    this.group.add(mesh); this.owned.push(source); return mesh;
  }
  clearDiscoveryFootprints() {
    if (!this.discoveries.length) return;
    // Filter existing instances after generation so unrelated scenery retains
    // exactly the same seeded sequence. Neighboring chunks clear the same site.
    const position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
    const matrix = new THREE.Matrix4(), color = new THREE.Color();
    const footprints = this.discoveries.map(site => {
      const p = this.groundPosition(site.s,site.u), road = this.groundPosition(site.s,0),frame=roadFrame(site.s);
      return {...site,x:p.x,z:p.z+this.start,roadX:road.x,roadZ:road.z+this.start,frame};
    });
    const cleared = (x,z,radius) => footprints.some(site => {
      if (Math.hypot(x-site.x,z-site.z) < Math.hypot(site.halfS,site.halfU)+radius) return true;
      if (site.kind!=='fuel-stop') return false;
      const dx=x-site.roadX,dz=z-site.roadZ,{nx,nz,scale}=site.frame;
      const s=site.s+(dx*nz-dz*nx)/scale,u=dx*nx+dz*nz;
      return !desertDiscoveryClears(s,u,[site],radius+2);
    });
    // A tree cleared from a site takes its footprint with it.
    if (this.features?.colliders) this.features.colliders = this.features.colliders.filter(solid => !cleared(solid.x,solid.z+this.start,solid.reach*1.3));
    this.group.traverse(object => {
      if (!object.isInstancedMesh) return;
      let kept=0;
      for (let i=0;i<object.count;i++) {
        object.getMatrixAt(i,matrix); matrix.decompose(position,rotation,scale);
        if (cleared(position.x,position.z,Math.min(5,Math.max(scale.x,scale.z)*1.3))) continue;
        if (kept!==i) {
          object.setMatrixAt(kept,matrix);
          if (object.instanceColor) {object.getColorAt(i,color);object.setColorAt(kept,color);}
        }
        kept++;
      }
      object.count=kept; object.instanceMatrix.needsUpdate=true;
      if (object.instanceColor) object.instanceColor.needsUpdate=true;
      if (kept) object.computeBoundingSphere();
    });
  }
  vertex(row, column) {
    const key = `${row},${column}`;
    if (!this.vertices.has(key)) this.vertices.set(key, desertVertex(row, column, this.sampleColumns));
    return this.vertices.get(key);
  }
  groundPosition(s, u) {
    // Plant on the rendered triangles, including broken shelves and chunk edges.
    const columns = desertColumns(s);
    const column = Math.max(0, columns.findIndex(value => value > u) - 1);
    const row = Math.floor(s / DESERT_STEP);
    for (let c = Math.max(0, column - 1); c <= Math.min(columns.length - 2, column + 1); c++) {
      const step = r => Math.abs(DESERT_COLUMNS[c]) <= DESERT_VALLEY_EDGE && Math.abs(DESERT_COLUMNS[c + 1]) <= DESERT_VALLEY_EDGE ? desertRowStep(r) : 1;
      for (let r = row - 1; r <= row + 1; r += step(r)) {
        const next = r + step(r);
        const a = this.vertex(r, c), b = this.vertex(next, c), d = this.vertex(next, c + 1), e = this.vertex(r, c + 1);
        const triangles = (r + c) % 2 ? [[a, b, e], [b, d, e]] : [[a, b, d], [a, d, e]];
        for (const [p, q, t] of triangles) {
          const denominator = (q.u - t.u) * (p.s - t.s) + (t.s - q.s) * (p.u - t.u);
          const w0 = ((q.u - t.u) * (s - t.s) + (t.s - q.s) * (u - t.u)) / denominator;
          const w1 = ((t.u - p.u) * (s - t.s) + (p.s - t.s) * (u - t.u)) / denominator;
          const w2 = 1 - w0 - w1;
          if (Math.min(w0, w1, w2) >= -1e-6) return {
            x: p.x * w0 + q.x * w1 + t.x * w2,
            y: p.y * w0 + q.y * w1 + t.y * w2,
            z: p.z * w0 + q.z * w1 + t.z * w2,
          };
        }
      }
    }
    return desertPosition(s, u);
  }
  buildGround() {
    const positions = [], colors = [];
    const riverTriangles = [];
    const sand = ['#e7b77d', '#e5b47a', '#ebbd83', '#e2b178', '#e9ba80', '#e6b67c'];
    const stone = ['#c77a46', '#d38247', '#cb7540', '#be6c3e', '#dc884a', '#c57745'];
    const ab = new THREE.Vector3(), ac = new THREE.Vector3();
    for (let col = 0; col < DESERT_COLUMNS.length - 1; col++) {
      const step = r => Math.abs(DESERT_COLUMNS[col]) <= DESERT_VALLEY_EDGE && Math.abs(DESERT_COLUMNS[col + 1]) <= DESERT_VALLEY_EDGE ? desertRowStep(r) : 1;
      for (let row = this.start / DESERT_STEP; row < (this.start + CHUNK_LENGTH) / DESERT_STEP; row += step(row)) {
        const next = row + step(row);
        const a = this.vertex(row, col), b = this.vertex(next, col), c = this.vertex(row, col + 1), d = this.vertex(next, col + 1);
        const triangles = (row + col) % 2 ? [[a, b, c], [b, d, c]] : [[a, b, d], [a, d, c]];
        triangles.forEach((tri, i) => {
          const s = tri.reduce((sum, p) => sum + p.s, 0) / 3;
          const u = tri.reduce((sum, p) => sum + p.u, 0) / 3;
          const distance = Math.abs(u) - canyonProfile(s, Math.sign(u) || 1).foot;
          const originalColumn = desertFacetColumn(col, u);
          const facet = randomAt(row * 2 + i, originalColumn + 393);
          let color;
          ab.subVectors(tri[1], tri[0]); ac.subVectors(tri[2], tri[0]);
          const normal = ab.cross(ac).normalize();
          const steepness = 1 - Math.abs(normal.y);
          const creek = desertCreek(s), bank = Math.abs(u - creek.center) - creek.width;
          if (bank < 3.4) {
            color = new THREE.Color(bank < .4 ? '#a59470' : bank < 1.8 ? '#c4a579' : '#d4ad78').multiplyScalar(.95 + facet * .1);
          } else if (distance > -4 && steepness > .24) {
            // Give an entire vertical face a related color instead of noisy strata.
            const block = Math.floor(randomAt(Math.floor(s / 24), Math.sign(u) + 393) * stone.length);
            color = new THREE.Color(stone[block]).multiplyScalar(.97 + facet * .06);
          } else if (Math.abs(u - dryWashCenter(s)) < dryWashWidth(s)) {
            color = new THREE.Color(facet > .5 ? '#d2ac7c' : '#d9b181');
          } else {
            color = new THREE.Color(sand[Math.floor(facet * sand.length)]);
            if (distance > -4) color.lerp(new THREE.Color('#e2a568'), .32);
          }
          triangle(positions, colors, ...tri, color, this.start);
          if (tri.some(p => desertCreekDistance(p.s, p.u) < 4)) riverTriangles.push(tri);
        });
      }
    }
    this.addMesh(geometry(positions, colors), groundMaterial, true).name = 'desert-floor';
    buildDesertWater(this, riverTriangles);
  }
  buildMesas() {
    const positions = [], colors = [];
    const stone = ['#bd663b', '#ce7440', '#d68349', '#b95e36', '#df8a4b', '#c36c3f'];
    this.mesas = mesasForChunk(this.index); this.mesaTops = new Map();
    for (const mesa of this.mesas) {
      const random = seededRandom(mesa.seed + 4371);
      const broad = mesa.ru >= 18 || mesa.kind === 'buttress';
      const sides = broad ? 12 : 9;
      const shape = Array.from({ length: sides }, () => .78 + random() * .34);
      const shelf = .23 + random() * .18;
      const layers = !broad
        ? [[0, 1.22], [.16, .81], [.58, .72], [.94, .48], [1, .43]]
        : [[0, 1.13], [.12, 1], [shelf, .91], [shelf + .025, .79], [.65, .77], [.97, .73], [1, .68]];
      const base = desertHeight(mesa.s, mesa.u) - 1.5;
      const rings = layers.map(([height, radius], layer) => Array.from({ length: sides }, (_, i) => {
        const angle = i / sides * Math.PI * 2;
        const erosion = layer === 0 ? 1 : 1 + (randomAt(mesa.seed + layer, i + 572) - .5) * .11;
        // Squared shoulders and wide caps give the buttes a broken mesa silhouette.
        const sin = Math.sin(angle), cos = Math.cos(angle);
        const along = broad ? Math.sign(sin) * Math.abs(sin) ** .58 : sin;
        const across = broad ? Math.sign(cos) * Math.abs(cos) ** .58 : cos;
        const s = mesa.s + along * mesa.rs * radius * shape[i] * erosion;
        const u = mesa.u + across * mesa.ru * radius * shape[i] * erosion;
        // The same height variation at every level keeps thin ledges from
        // crossing each other while still breaking up their horizontal edges.
        const y = layer === 0 ? Math.min(base, desertHeight(s, u) - 1) : base + height * mesa.height * (1 + (randomAt(mesa.seed, i + 16) - .5) * .03);
        return desertPosition(s, u, y);
      }));
      for (let layer = 0; layer < layers.length - 1; layer++) {
        for (let i = 0; i < sides; i++) {
          const next = (i + 1) % sides;
          const a = rings[layer][i], b = rings[layer][next], c = rings[layer + 1][i], d = rings[layer + 1][next];
          const color = new THREE.Color(stone[Math.floor(randomAt(mesa.seed, i + 492) * stone.length)]);
          const center = new THREE.Vector3((a.x + b.x + c.x + d.x) / 4, (a.y + b.y + c.y + d.y) / 4, (a.z + b.z + c.z + d.z) / 4);
          const mesaCenter = desertPosition(mesa.s, mesa.u);
          const outward = new THREE.Vector3(center.x - mesaCenter.x, 0, center.z - mesaCenter.z).normalize();
          const wall = layers[layer + 1][0] - layers[layer][0] > .08;
          if (wall) center.addScaledVector(outward, (random() - .15) * Math.min(mesa.ru, mesa.rs) * .085);
          else color.set('#e4a466');
          for (const tri of [[a, b, center], [b, d, center], [d, c, center], [c, a, center]]) {
            triangle(positions, colors, ...tri, color.clone().multiplyScalar(.93 + random() * .14), this.start, false);
          }
        }
      }
      const top = desertPosition(mesa.s, mesa.u, base + mesa.height + .15);
      const ring = rings.at(-1);
      this.mesaTops.set(mesa, { top, ring });
      for (let i = 0; i < sides; i++) triangle(positions, colors, top, ring[i], ring[(i + 1) % sides], new THREE.Color('#e9af6c').multiplyScalar(.98 + random() * .04), this.start);
    }
    this.addMesh(geometry(positions, colors), groundMaterial, true).name = 'sandstone-mesas';
  }
  ribbon(ranges, lift, material, skip) {
    const vertices = [];
    for (const [low, high] of ranges) for (let s = this.start; s < this.start + CHUNK_LENGTH; s += 2) {
      const bridge = desertBridgeAt(s + 1);
      if (s >= bridge.start && s < bridge.end) continue;
      if (skip?.(s,low)) continue;
      const at = (t, u) => desertPosition(t, u, roadHeight(t) + lift);
      const a = at(s, low), b = at(s + 2, low), c = at(s, high), d = at(s + 2, high);
      triangle(vertices, null, a, b, c, null, this.start); triangle(vertices, null, b, d, c, null, this.start);
    }
    return this.addMesh(geometry(vertices), material);
  }
  buildRoad() {
    this.ribbon([[-6.25, 6.25]], .045, sandMaterial);
    this.ribbon([[-5.5, 5.5]], .075, asphaltMaterial);
    this.ribbon([[-5.05, -4.89], [4.89, 5.05]], .09, edgeMaterial,(s,u)=>this.discoveries.some(site=>
      site.kind==='fuel-stop' && Math.sign(u)===site.side && desertFuelApronWidth(site,s+1)>7)).name='desert-road-edge-lines';
    this.ribbon([[-.15, -.055], [.055, .15]], .093, centerMaterial);
  }
  buildPlants() {
    const random = seededRandom(this.index + 64713);
    const stones = [], bushes = [], trunks = [], crowns = [], cacti = [], agaves = [];
    const stoneColors = ['#c67a48', '#af643d', '#db9858', '#c28650', '#dbab74'];
    const greens = ['#6c753f', '#8e8546', '#626d44', '#959255'];
    const sample = () => ({ s: this.start + random() * CHUNK_LENGTH, u: (random() > .5 ? 1 : -1) * (10 + random() ** 1.5 * 210) });
    const canGrow = (s, u) => desertDiscoveryClears(s, u, this.discoveries, 7) && desertCreekDistance(s, u) > 4 && !insideMesa(s, u) && Math.abs(desertHeight(s, u + .6) - desertHeight(s, u - .6)) < .9 && Math.abs(u - dryWashCenter(s)) > 2;
    for (let i = 0; i < 155; i++) {
      const { s, u } = sample(); if (insideMesa(s, u, .98) || desertCreekDistance(s, u) < 5.5) continue;
      const p = this.groundPosition(s, u); const size = .35 + random() ** 2 * 3.5;
      stones.push({ p: [p.x, p.y + size * .35, p.z + this.start], scale: [size, size * (.6 + random() * .8), size * .82], r: [random() * .25, random() * 6, random() * .4], color: stoneColors[Math.floor(random() * stoneColors.length)] });
    }
    // Continuous rockfall aprons and fractured blocks tie both canyon walls
    // into the valley floor, with occasional larger pieces on the ledges.
    for (let s = this.start; s < this.start + CHUNK_LENGTH; s += 6) {
      for (const side of [-1, 1]) {
        const t = s + random() * 3;
        const { foot, cliffStrength } = canyonProfile(t, side);
        if (random() > .2 + cliffStrength * .8) continue;
        for (let piece = 0; piece < 3; piece++) {
          const ledge = piece === 2 && random() > .52;
          const u = side * (foot + (ledge ? 17 + random() * 5 : -9 + random() * 15));
          const p = this.groundPosition(t, u); const size = .6 + random() ** 1.8 * (ledge ? 2.5 : 3.8);
          stones.push({ p: [p.x, p.y + size * .21, p.z + this.start], scale: [size * .85, size * (.8 + random()), size * 1.1], r: [random() * .5, random() * 6, random() * .45], color: stoneColors[Math.floor(random() * stoneColors.length)] });
        }
      }
    }
    for (let i = 0; i < 55; i++) {
      const s = this.start + random() * CHUNK_LENGTH, u = dryWashCenter(s) + (random() - .5) * dryWashWidth(s) * 2;
      const p = this.groundPosition(s, u); const size = .17 + random() * .48;
      stones.push({ p: [p.x, p.y + size * .21, p.z + this.start], scale: [size, size * .5, size * .8], r: [0, random() * 6, 0], color: '#bba68c' });
    }
    for (const mesa of this.mesas) {
      for (let i = 0; i < 12; i++) {
        const angle = random() * Math.PI * 2;
        const top = i < 4 && mesa.ru > 20;
        const radius = top ? random() * .28 : 1.03 + random() * .3;
        const s = mesa.s + Math.sin(angle) * mesa.rs * radius;
        const u = mesa.u + Math.cos(angle) * mesa.ru * radius;
        if (Math.abs(u) < 22) continue;
        const size = top ? .6 + random() * 1.7 : 1.4 + random() * 3.2;
        const p = top ? desertPosition(s, u, desertHeight(mesa.s, mesa.u) - 1.5 + mesa.height) : this.groundPosition(s, u);
        stones.push({ p: [p.x, p.y + size * .36, p.z + this.start], scale: [size, size * .9, size * .8], r: [.2, random() * 6, -.1], color: stoneColors[i % stoneColors.length] });
      }
      if (mesa.ru >= 18) {
        const { top, ring } = this.mesaTops.get(mesa);
        for (let i = 0; i < 10; i++) {
          const edge = Math.floor(random() * ring.length), a = ring[edge], b = ring[(edge + 1) % ring.length];
          const radius = .28 + random() * .53, blend = random();
          const p = new THREE.Vector3().copy(top).multiplyScalar(1 - radius)
            .addScaledVector(a, radius * blend).addScaledVector(b, radius * (1 - blend));
          p.z += this.start;
          const size = .55 + random() * .8;
          if (i % 3 === 0) {
            p.y += size * .27;
            bushes.push({ p: p.toArray(), scale: [size, size * .6, size * .85], color: greens[i % greens.length] });
          } else crowns.push({ p: p.toArray(), scale: [size, size * .7, size], r: [0, random() * 6, 0], color: greens[i % greens.length] });
        }
      }
    }
    for (let i = 0; i < 90; i++) {
      const { s, u } = sample(); if (!canGrow(s, u)) continue;
      const p = this.groundPosition(s, u); const size = .55 + random() * .85;
      if (i % 3 === 0) {
        crowns.push({ p: [p.x, p.y, p.z + this.start], scale: [size, size * .8, size], r: [0, random() * 6, 0], color: greens[i % greens.length] });
      } else {
        bushes.push({ p: [p.x, p.y + size * .35, p.z + this.start], scale: [size, size * .6, size * .83], r: [0, random() * 6, 0], color: greens[i % greens.length] });
      }
      if (i % 9 === 0) cacti.push({ p: [p.x + 1.1, p.y + .55, p.z + this.start], scale: [.45, .7, .45], color: '#819052' });
    }
    for (let i = 0; i < 30; i++) {
      const s = this.start + random() * CHUNK_LENGTH;
      const u = (random() > .5 ? 1 : -1) * (12 + random() * 33);
      if (!canGrow(s, u)) continue;
      const p = this.groundPosition(s, u), size = .7 + random() * .65;
      agaves.push({ p: [p.x, p.y, p.z + this.start], scale: [size, size, size], r: [0, random() * 6, 0], color: i % 2 ? '#7e8970' : '#929371' });
    }
    const branch = (a, b, radius) => {
      const direction = new THREE.Vector3().subVectors(b, a);
      trunks.push({ p: a.clone().add(b).multiplyScalar(.5).toArray(), scale: [radius, direction.length(), radius], q: new THREE.Quaternion().setFromUnitVectors(up, direction.normalize()) });
    };
    for (let i = 0; i < 19; i++) {
      const { s, u } = sample(); if (!canGrow(s, u)) continue;
      const p = this.groundPosition(s, u); const height = 4.2 + random() * 4.1;
      const root = new THREE.Vector3(p.x, p.y - .2, p.z + this.start);
      const fork = root.clone().add(new THREE.Vector3(.2, height * .5, -.1));
      branch(root, fork, height * .078); solidPost(this, root.x, root.z, height * .078);
      for (let arm = 0; arm < 3; arm++) {
        const angle = arm * 2.1 + random() * .7;
        const elbow = fork.clone().add(new THREE.Vector3(Math.cos(angle) * height * .26, height * .17, Math.sin(angle) * height * .26));
        const tip = elbow.clone().add(new THREE.Vector3(Math.cos(angle) * .25, height * (.15 + random() * .17), Math.sin(angle) * .25));
        branch(fork, elbow, height * .045); branch(elbow, tip, height * .038);
        const scale = .75 + height * .055;
        crowns.push({ p: tip.toArray(), scale: [scale, scale, scale], r: [0, angle, 0], color: greens[arm % greens.length] });
        bushes.push({ p: tip.clone().add(new THREE.Vector3(0, .12, 0)).toArray(), scale: [.33 * scale, .27 * scale, .33 * scale], color: greens[arm % greens.length] });
      }
    }
    instances(this.group, stoneGeometry, rockMaterial, stones);
    instances(this.group, bushGeometry, plantMaterial, bushes);
    instances(this.group, trunkGeometry, barkMaterial, trunks);
    instances(this.group, leafGeometry, plantMaterial, crowns);
    instances(this.group, cactusGeometry, plantMaterial, cacti);
    instances(this.group, agaveGeometry, plantMaterial, agaves);
  }
  buildReferenceDetails() {
    // Independent seed keeps the established scenery in exactly the same places.
    const random = seededRandom(this.index + 98173);
    const trunks = [], foliage = [], scrub = [], grasses = [], slabs = [], gravel = [];
    const greens = ['#7e8645', '#8e934d', '#a0a35a', '#727d47'];
    const stoneColors = ['#d79c69', '#c3895e', '#e1af7c', '#b97851'];
    const clear = (s, u, radius = 1) => Math.abs(u) - radius > 9
      && desertDiscoveryClears(s, u, this.discoveries, radius + 5)
      && desertCreekDistance(s, u) > radius + 3.5
      && Math.abs(u - dryWashCenter(s)) > radius + 2
      && !insideMesa(s, u, 1.5)
      && Math.abs(desertHeight(s, u + radius) - desertHeight(s, u - radius)) < radius * .6
      && Math.abs(desertHeight(s + radius, u) - desertHeight(s - radius, u)) < radius * .6;
    const at = (s, u) => {
      const p = this.groundPosition(s, u);
      return new THREE.Vector3(p.x, p.y, p.z + this.start);
    };
    const branch = (a, b, radius) => {
      const direction = b.clone().sub(a);
      trunks.push({ p: a.clone().add(b).multiplyScalar(.5).toArray(), scale: [radius, direction.length(), radius], q: new THREE.Quaternion().setFromUnitVectors(up, direction.normalize()) });
    };
    // Small, twisting leafy trees complement the existing spiky Joshua trees.
    for (let i = 0; i < 9; i++) {
      const s = this.start + 6 + random() * (CHUNK_LENGTH - 12);
      const side = i % 2 ? -1 : 1;
      const u = side * (i < 6 ? 16 + random() * 27 : canyonProfile(s, side).foot + 43 + random() * 13);
      if (!clear(s, u, 3.5)) continue;
      const root = at(s, u); root.y -= .18;
      const height = 3.3 + random() * 2.2;
      const fork = root.clone().add(new THREE.Vector3(.25, height * .48, -.15));
      branch(root, fork, height * .055); solidPost(this, root.x, root.z, height * .055);
      for (let arm = 0; arm < 4; arm++) {
        const angle = arm * 1.57 + random() * .65;
        const elbow = fork.clone().add(new THREE.Vector3(Math.cos(angle) * height * .24, height * .19, Math.sin(angle) * height * .24));
        const tip = elbow.clone().add(new THREE.Vector3(Math.cos(angle) * .3, height * (.17 + random() * .13), Math.sin(angle) * .3));
        branch(fork, elbow, height * .031); branch(elbow, tip, height * .018);
        for (let lobe = 0; lobe < 4; lobe++) {
          const theta = lobe * 2.4 + angle, size = height * (.15 + random() * .09);
          const p = tip.clone().add(new THREE.Vector3(Math.cos(theta) * size * .6, (random() - .3) * size, Math.sin(theta) * size * .6));
          foliage.push({ p: p.toArray(), scale: [size, size * .78, size * .88], r: [0, theta, .1], color: greens[(arm + lobe) % greens.length] });
        }
      }
    }
    // Broad slabs sit in little groups, with chips spilling into nearby sand.
    for (let i = 0; i < 12; i++) {
      const s = this.start + 8 + random() * (CHUNK_LENGTH - 16), side = i % 2 ? -1 : 1;
      const u = side * (i < 8 ? 19 + random() * 25 : canyonProfile(s, side).foot + 43 + random() * 12);
      if (!clear(s, u, 5)) continue;
      for (let j = 0; j < 3; j++) {
        const t = s + (random() - .5) * 7, v = u + (random() - .5) * 5;
        if (!clear(t, v, 3)) continue;
        const size = j === 0 ? 2.8 + random() * 1.6 : 1 + random() * 1.4;
        const p = at(t, v); p.y += size * .17;
        slabs.push({ p: p.toArray(), scale: [size * 1.25, size * .85, size * .82], r: [(random() - .5) * .2, random() * Math.PI * 2, (random() - .5) * .15], color: stoneColors[(i + j) % stoneColors.length] });
      }
      for (let j = 0; j < 15; j++) {
        const t = s + (random() - .5) * 13, v = u + (random() - .5) * 10;
        if (!clear(t, v, .5)) continue;
        const size = .12 + random() ** 2 * .48, p = at(t, v); p.y += size * .2;
        gravel.push({ p: p.toArray(), scale: [size, size * .6, size * .8], r: [.15, random() * 6, .2], color: stoneColors[j % stoneColors.length] });
      }
    }
    // Vegetation grows in scattered pockets, leaving open sand between them.
    for (let i = 0; i < 42; i++) {
      const s = this.start + 5 + random() * (CHUNK_LENGTH - 10), side = i % 2 ? -1 : 1;
      const u = side * (i % 4 ? 12 + random() * 31 : canyonProfile(s, side).foot + 43 + random() * 20);
      if (!clear(s, u, 2)) continue;
      const size = .6 + random() * .6;
      for (let lobe = 0; lobe < 5; lobe++) {
        const angle = lobe * 2.4, t = s + Math.cos(angle) * size * .5, v = u + Math.sin(angle) * size * .5;
        const p = at(t, v); p.y += size * .28;
        scrub.push({ p: p.toArray(), scale: [size * .6, size * (.4 + random() * .25), size * .55], r: [0, angle, 0], color: greens[(i + lobe) % greens.length] });
      }
      for (let j = 0; j < 6; j++) {
        const t = s + (random() - .5) * 6, v = u + (random() - .5) * 6;
        if (!clear(t, v, .7)) continue;
        const p = at(t, v), scale = .7 + random() * .8;
        grasses.push({ p: p.toArray(), scale: [scale, scale, scale], r: [0, random() * 6, 0], color: j % 2 ? '#c2aa68' : '#a3a064' });
      }
    }
    instances(this.group, trunkGeometry, barkMaterial, trunks, 'desert-leafy-tree-branches');
    instances(this.group, bushGeometry, plantMaterial, foliage, 'desert-leafy-tree-canopies');
    instances(this.group, bushGeometry, plantMaterial, scrub, 'desert-scrub-pockets');
    instances(this.group, grassGeometry, plantMaterial, grasses, 'desert-dry-grass');
    instances(this.group, slabGeometry, rockMaterial, slabs, 'desert-fractured-slabs');
    instances(this.group, stoneGeometry, rockMaterial, gravel, 'desert-stone-chips');
  }
  buildForeground() {
    const random = seededRandom(this.index + 75231);
    const blocks = [], chips = [], branches = [], crowns = [], shrubs = [], grasses = [];
    const stone = ['#c37c4b', '#d79459', '#b97248', '#dfad77'];
    const greens = ['#7a8144', '#96914b', '#89914f', '#686f3d'];
    const at = (s, u) => {
      const p = this.groundPosition(s, u);
      return new THREE.Vector3(p.x, p.y, p.z + this.start);
    };
    const suitable = (s, u, radius) => !insideMesa(s, u, 1.4)
      && Math.abs(desertHeight(s + radius, u) - desertHeight(s - radius, u)) < radius * .95
      && Math.abs(desertHeight(s, u + radius) - desertHeight(s, u - radius)) < radius * .95;
    const branch = (a, b, radius) => {
      const direction = b.clone().sub(a);
      branches.push({ p: a.clone().add(b).multiplyScalar(.5).toArray(), scale: [radius, direction.length(), radius], q: new THREE.Quaternion().setFromUnitVectors(up, direction.normalize()) });
    };
    // Each pocket reads as a little composition: a fractured outcrop, smaller
    // fallen pieces, one sculptural tree, then low plants fading back into sand.
    for (let garden = 0; garden < 6; garden++) {
      let s, u, found = false;
      for (let attempt = 0; attempt < 9; attempt++) {
        s = this.start + 12 + garden * 17 + random() * 10;
        u = -(garden < 3 ? 77 + random() * 90 : 158 + random() * 97);
        if (suitable(s, u, 5)) { found = true; break; }
      }
      if (!found) continue;
      const heading = random() * Math.PI * 2;
      for (let rock = 0; rock < 5; rock++) {
        const t = s + Math.cos(heading) * rock * 2.1 + (random() - .5) * 3;
        const v = u + Math.sin(heading) * rock * 2.1 + (random() - .5) * 3;
        if (!suitable(t, v, 2)) continue;
        const p = at(t, v), size = rock === 0 ? 4.8 + random() * 2.7 : 1.5 + random() * 3.2;
        const rise = size * (rock === 0 && garden % 2 ? 2.1 : 1.1);
        p.y += rise * .23;
        blocks.push({ p: p.toArray(), scale: [size, rise, size * (.65 + random() * .4)], r: [(random() - .5) * .22, heading + random() * .35, (random() - .5) * .22], color: stone[(garden + rock) % stone.length] });
      }
      for (let i = 0; i < 23; i++) {
        const angle = random() * Math.PI * 2, radius = 4 + random() * 10;
        const t = s + Math.cos(angle) * radius, v = u + Math.sin(angle) * radius;
        if (!suitable(t, v, .8)) continue;
        const p = at(t, v), size = .25 + random() ** 2 * 1.3;
        p.y += size * .25;
        chips.push({ p: p.toArray(), scale: [size, size * .8, size * .7], r: [.2, angle, .1], color: stone[i % stone.length] });
      }
      // Larger, uneven Joshua silhouettes make the near side feel like foreground.
      const treeS = s - 5 - random() * 3, treeU = u - 5 - random() * 3;
      if (garden !== 3 && suitable(treeS, treeU, 2.8)) {
        const root = at(treeS, treeU); root.y -= .2;
        const height = 8.5 + random() * 4.5;
        const fork = root.clone().add(new THREE.Vector3(-height * .065, height * .43, height * .04));
        branch(root, fork, height * .053); solidPost(this, root.x, root.z, height * .053);
        for (let arm = 0; arm < 5; arm++) {
          const angle = heading + arm * 2.4;
          const reach = height * (.18 + random() * .15);
          const elbow = fork.clone().add(new THREE.Vector3(Math.cos(angle) * reach, height * (.13 + random() * .14), Math.sin(angle) * reach));
          const tip = elbow.clone().add(new THREE.Vector3(Math.cos(angle) * .35, height * (.12 + random() * .19), Math.sin(angle) * .35));
          branch(fork, elbow, height * .033); branch(elbow, tip, height * .024);
          const size = 1.25 + random() * .75;
          crowns.push({ p: tip.toArray(), scale: [size, size * .88, size], r: [.1, angle, -.1], color: greens[arm % greens.length] });
          const skirt = tip.clone(); skirt.y -= .2;
          crowns.push({ p: skirt.toArray(), scale: [size * .7, size * .45, size * .7], r: [Math.PI, angle + .8, .12], color: '#91834c' });
          shrubs.push({ p: tip.toArray(), scale: [size * .38, size * .3, size * .38], color: greens[arm % greens.length] });
        }
      }
      for (let i = 0; i < 22; i++) {
        const angle = random() * Math.PI * 2, radius = 5 + random() * 12;
        const t = s + Math.cos(angle) * radius, v = u + Math.sin(angle) * radius;
        if (!suitable(t, v, 1.4)) continue;
        const p = at(t, v), size = .9 + random() * 1.1;
        if (i % 3 === 0) {
          p.y += size * .25;
          shrubs.push({ p: p.toArray(), scale: [size, size * .55, size * .85], r: [0, angle, 0], color: greens[i % greens.length] });
        } else crowns.push({ p: p.toArray(), scale: [size, size * .8, size], r: [0, angle, .08], color: greens[i % greens.length] });
        for (let blade = 0; blade < 2; blade++) {
          const grass = at(t + (random() - .5) * 3, v + (random() - .5) * 3);
          grasses.push({ p: grass.toArray(), scale: [size * .7, size, size * .7], r: [0, angle, 0], color: '#bba367' });
        }
      }
    }
    instances(this.group, slabGeometry, rockMaterial, blocks, 'desert-foreground-outcrops');
    instances(this.group, stoneGeometry, rockMaterial, chips, 'desert-foreground-rubble');
    instances(this.group, trunkGeometry, barkMaterial, branches, 'desert-foreground-joshua-branches');
    instances(this.group, leafGeometry, plantMaterial, crowns, 'desert-foreground-yuccas');
    instances(this.group, bushGeometry, plantMaterial, shrubs, 'desert-foreground-scrub');
    instances(this.group, grassGeometry, plantMaterial, grasses, 'desert-foreground-grass');
  }
  dispose() {
    this.group.removeFromParent();
    for (const source of this.owned) source.dispose();
    this.group.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
  }
}

export class DesertWorld {
  constructor(scene, chunkSource = null) { this.scene = scene; this.chunkSource = chunkSource; this.chunks = new Map(); this.origin = 0; this.center = null; }
  update(s) {
    const center = Math.floor(s / CHUNK_LENGTH); this.origin = Math.floor(s / 1024) * 1024;
    updateResidentChunks(this, center, DesertChunk);
    for (const chunk of this.chunks.values()) chunk.group.position.z = this.origin - chunk.start;
  }
  animate(time) { desertWaterClock.value = time; }
  dispose() { this.chunkSource?.dispose(); for (const chunk of this.chunks.values()) chunk.dispose(); this.chunks.clear(); }
}
