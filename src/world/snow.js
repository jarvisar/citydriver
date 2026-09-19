import * as THREE from 'three';
import { registerChunkResources } from './chunk-resources.js';
import { finalizeChunkTransforms } from './chunk-transforms.js';
import { splitBatch } from './instance-batches.js';
import { updateResidentChunks } from './resident.js';
import { CHUNK_LENGTH, randomAt, seededRandom, smoothstep } from './route.js';
import { SNOW_STEP, SNOW_COLUMN_COUNT, LAMP_SPACING, snowVertex, snowPosition, snowGroundHeight, snowRoadHeight, snowFrame, snowBridgeAt, lampAt, summitForCell, terrainPocket, alpineLake, onLake } from './snow-route.js';
import { alpineRockVariants } from './alpine-rocks.js';
import { alpinePines } from './alpine-pines.js';
import { buildAlpineLake, lakeClock } from './alpine-lake.js';
import { CABIN_SPACING, alpineCabin, nearCabin, buildAlpineCabin } from './alpine-cabins.js';
import { Snowfall } from './snowfall.js';
import { snowDiscoveries, snowDiscoveryClears } from './snow-discoveries.js';
import { buildSnowDiscoveries, animateSnowDiscoveries } from './snow-discovery-scenery.js';

const material = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .95, flatShading: true, ...extra });
const terrainMaterial = material('#ffffff', { vertexColors: true });
const snowMaterial = material('#c7d2df');
// Identical settings, but kept apart from the instanced snow caps: one
// material shared by instanced and plain meshes makes the renderer
// re-derive its program on every draw call.
const snowBankMaterial = material('#c7d2df');
const rockMaterial = material('#4b5870');
const stoneMaterial = material('#ffffff');
const pineMaterial = material('#ffffff', { side: THREE.DoubleSide });
const metalMaterial = material('#687688', { metalness: .2 });
const barkMaterial = material('#3a3e49');
const roadMaterial = material('#414a53', { roughness: .72 });
const lineMaterial = material('#b4ab84');
const edgeMaterial = material('#b1becf');
// Brown timber vanishes under the blue night ambient, so a little warm
// emissive keeps the trestle legible beside the lamps.
const timberMaterial = material('#7d6a5c', { roughness: .9, emissive: '#5a4636', emissiveIntensity: .24 });
const glowMaterial = new THREE.MeshBasicMaterial({ color: '#ffe0a0', toneMapped: false });
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const rockGeometry = new THREE.IcosahedronGeometry(1, 0);
const poleGeometry = new THREE.CylinderGeometry(1, 1, 1, 6);
const dummy = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0);
registerChunkResources('snow', { terrainMaterial, snowMaterial, snowBankMaterial, rockMaterial, stoneMaterial, pineMaterial, metalMaterial,
  barkMaterial, roadMaterial, lineMaterial, edgeMaterial, timberMaterial, glowMaterial, boxGeometry, rockGeometry, poleGeometry, alpinePines, alpineRockVariants });

// Road ribbons, guardrails and stakes stop at the abutments of a timber trestle.
function onDeck(a, b) {
  const bridge = snowBridgeAt((a + b) / 2);
  return b > bridge.start && a < bridge.end;
}

function headlightPattern() {
  // Two soft, symmetric lobes projected by one light; no extra shadow pass.
  const size = 64, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size * 2 - 1, v = (y + .5) / size * 2 - 1;
    const left = Math.exp(-.5 * ((u + .3) / .25) ** 2);
    const right = Math.exp(-.5 * ((u - .3) / .25) ** 2);
    const value = Math.round(255 * Math.min(1, left + right) * Math.exp(-.5 * (v / .65) ** 2));
    const offset = (y * size + x) * 4;
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = value; pixels[offset + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function geometry(vertices, colors) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals(); g.computeBoundingSphere(); return g;
}
function triangle(vertices, colors, a, b, c, color, start) {
  if ((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) < 0) [b, c] = [c, b];
  for (const p of [a, b, c]) { vertices.push(p.x, p.y, p.z + start); if (colors) colors.push(color.r, color.g, color.b); }
}
function instances(group, geo, mat, items, name) {
  if (!items.length) return;
  for (const part of splitBatch(items)) batch(group, geo, mat, part, name);
}

function batch(group, geo, mat, items, name) {
  const mesh = new THREE.InstancedMesh(geo, mat, items.length); mesh.name = name;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]; dummy.position.set(...item.p); dummy.rotation.set(0, item.angle ?? 0, 0);
    if (item.q) dummy.quaternion.copy(item.q);
    dummy.scale.set(...item.scale); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
    if (item.color) mesh.setColorAt(i, new THREE.Color(item.color));
  }
  mesh.castShadow = mat !== glowMaterial; mesh.receiveShadow = true;
  mesh.computeBoundingSphere(); group.add(mesh);
}

export class SnowChunk {
  constructor(index) {
    this.start = index * CHUNK_LENGTH; this.group = new THREE.Group(); this.group.name = `snow-chunk-${index}`; this.owned = [];
    this.discoveries = snowDiscoveries(this.start - 40, this.start + CHUNK_LENGTH + 40);
    this.buildTerrain();
    for (const part of buildAlpineLake(this.start)) this.addMesh(part.geometry, part.material, part.name).castShadow = false;
    this.buildRoad(); this.buildScenery(index);
    for (let i = Math.floor(this.start / CABIN_SPACING); i <= Math.floor((this.start + CHUNK_LENGTH) / CABIN_SPACING); i++) {
      const cabin = alpineCabin(i);
      if (cabin.s >= this.start && cabin.s < this.start + CHUNK_LENGTH) this.group.add(buildAlpineCabin(i, this.start));
    }
    buildSnowDiscoveries(this, this.discoveries);
    finalizeChunkTransforms(this.group);
  }
  addMesh(g, mat, name) {
    const mesh = new THREE.Mesh(g, mat); mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true;
    this.group.add(mesh); this.owned.push(g); return mesh;
  }
  buildTerrain() {
    const vertices = [], colors = [], cross = new THREE.Vector3(), ab = new THREE.Vector3(), ac = new THREE.Vector3();
    const sampleRow = row => Array.from({ length: SNOW_COLUMN_COUNT }, (_, col) => snowVertex(row, col));
    let current = sampleRow(this.start / SNOW_STEP);
    for (let row = this.start / SNOW_STEP; row < (this.start + CHUNK_LENGTH) / SNOW_STEP; row++) {
      const next = sampleRow(row + 1);
      for (let col = 0; col < SNOW_COLUMN_COUNT - 1; col++) {
        const a = current[col], b = next[col], c = current[col + 1], d = next[col + 1];
        const tris = (row + col) % 2 ? [[a, b, c], [b, d, c]] : [[a, b, d], [a, d, c]];
        tris.forEach((tri, i) => {
          ab.set(tri[1].x - tri[0].x, tri[1].y - tri[0].y, tri[1].z - tri[0].z);
          ac.set(tri[2].x - tri[0].x, tri[2].y - tri[0].y, tri[2].z - tri[0].z);
          cross.crossVectors(ab, ac).normalize();
          const facet = randomAt(row * 2 + i, col + 923);
          const s = tri.reduce((sum, p) => sum + p.s, 0) / 3;
          const u = tri.reduce((sum, p) => sum + p.u, 0) / 3;
          const highSnow = tri.reduce((sum, p) => sum + p.y, 0) / 3 > snowRoadHeight(s) + 54;
          const exposure = .5 + .5 * Math.sin(s / 29 + u / 19);
          const snowy = Math.abs(cross.y) > (highSnow ? .5 : .66 + exposure * .07);
          const color = new THREE.Color(snowy ? '#c2cddb' : '#4f5d6e');
          // Broad tonal changes let the actual fracture planes describe the
          // mountain, with only a little variation between adjacent facets so
          // each stratum riser reads as one dark plane.
          color.multiplyScalar(snowy ? .94 + exposure * .09 + facet * .045 : .9 + exposure * .1 + facet * .07);
          triangle(vertices, colors, ...tri, color, this.start);
        });
      }
      current = next;
    }
    this.terrain = this.addMesh(geometry(vertices, colors), terrainMaterial, 'snowy-mountain');
  }
  ribbon(ranges, lift, mat, name) {
    const vertices = [];
    for (const [low, high] of ranges) for (let s = this.start; s < this.start + CHUNK_LENGTH; s += 2) {
      if (onDeck(s, s + 2)) continue;
      const p = (t, u) => snowPosition(t, u, snowRoadHeight(t) + lift);
      const a = p(s, low), b = p(s + 2, low), c = p(s, high), d = p(s + 2, high);
      triangle(vertices, null, a, b, c, null, this.start); triangle(vertices, null, b, d, c, null, this.start);
    }
    this.addMesh(geometry(vertices), mat, name);
  }
  buildRoad() {
    this.ribbon([[-7, 7]], .025, snowBankMaterial, 'plowed-snow-shoulders');
    this.ribbon([[-5.5, 5.5]], .075, roadMaterial, 'mountain-road');
    this.ribbon([[-4.98, -4.85], [4.85, 4.98]], .094, edgeMaterial, 'road-edge');
    this.ribbon([[-.08, .08]], .096, lineMaterial, 'center-line');
    const banks = [];
    for (const side of [-1, 1]) for (let s = this.start; s < this.start + CHUNK_LENGTH; s += 4) {
      const profile = [[5.55, .05], [6.1, .33], [6.65, .54], [7.45, .1]];
      const at = (t, col) => {
        const [u, lift] = profile[col], drift = 1 + .28 * Math.sin(t / 7 + side);
        return snowPosition(t, side * u, Math.max(snowRoadHeight(t) + lift * drift, snowGroundHeight(t, side * u) + .035));
      };
      for (let i = 0; i < profile.length - 1; i++) {
        triangle(banks, null, at(s, i), at(s + 4, i), at(s, i + 1), null, this.start);
        triangle(banks, null, at(s + 4, i), at(s + 4, i + 1), at(s, i + 1), null, this.start);
      }
    }
    this.addMesh(geometry(banks), snowBankMaterial, 'roadside-snowbanks');
  }
  buildScenery(index) {
    const random = seededRandom(index + 90241), trunks = [], metal = [], lamps = [];
    const pines = alpinePines.map(() => []), caps = alpinePines.map(() => []);
    const rocks = alpineRockVariants.map(() => []), rockCaps = alpineRockVariants.map(() => []);
    const point = (s, u, y) => { const p = snowPosition(s, u, y); return [p.x, p.y, p.z + this.start]; };
    const clearOfDiscoveries = (s, u, radius) => snowDiscoveryClears(s, u, this.discoveries, radius);
    const stone = (s, u, size, snowy = true, tall = false) => {
      if (onLake(s, u, size + .8) || nearCabin(s, u) || !clearOfDiscoveries(s, u, size)) return;
      const variant = Math.floor(random() * rocks.length);
      const ground = Math.min(snowGroundHeight(s, u), snowGroundHeight(s, u - size * .45), snowGroundHeight(s, u + size * .45));
      const item = { p: point(s, u, ground - size * .04),
        scale: [size * (.8 + random() * .5), size * (tall ? 1.35 : .55 + random() * .5), size * (.65 + random() * .5)],
        angle: random() * Math.PI * 2 };
      rocks[variant].push({ ...item, color: ['#455166', '#515d70', '#596477', '#414c60'][Math.floor(random() * 4)] });
      if (snowy) rockCaps[variant].push(item);
    };
    const beam = (a, b, width, depth = width) => {
      const direction = new THREE.Vector3().fromArray(b).sub(new THREE.Vector3().fromArray(a));
      metal.push({ p: a.map((v, i) => (v + b[i]) / 2), scale: [width, direction.length(), depth], q: new THREE.Quaternion().setFromUnitVectors(up, direction.normalize()) });
    };
    const pine = (s, u, y, height, angle) => {
      if (onLake(s, u, height * .18) || nearCabin(s, u) || !clearOfDiscoveries(s, u, height * .2)) return;
      const variant = Math.floor(random() * alpinePines.length), width = height * (.85 + random() * .25);
      trunks.push({ p: point(s, u, y + height * .36), scale: [height * .018, height * .85, height * .018] });
      const item = { p: point(s, u, y - .2), scale: [width, height, width], angle };
      pines[variant].push({ ...item, color: ['#29473e', '#36564b', '#203b35'][Math.floor(random() * 3)] });
      caps[variant].push(item);
    };
    for (let s = this.start; s < this.start + CHUNK_LENGTH; s += 4) {
      const y = snowRoadHeight(s), endY = snowRoadHeight(s + 4);
      if (!onDeck(s - .5, s + .5)) metal.push({ p: point(s, -7.2, y + .73), scale: [.2, 1.65, .22] });
      if (!onDeck(s, s + 4)) beam(point(s, -7.2, y + 1.42), point(s + 4, -7.2, endY + 1.42), .3, .2);
      // Slim red snow stakes mark the inner shoulder without enclosing the view.
      if (s % 16 === 0 && !onDeck(s - .5, s + .5)) trunks.push({ p: point(s, 7.4, y + .9), scale: [.12, 1.9, .12] });
    }
    for (let i = Math.ceil((this.start - 60) / LAMP_SPACING); i * LAMP_SPACING - 24 < this.start + CHUNK_LENGTH; i++) {
      const lamp = lampAt(i), ground = snowRoadHeight(lamp.s);
      if (lamp.hidden || lamp.s < this.start || lamp.s >= this.start + CHUNK_LENGTH) continue;
      metal.push({ p: point(lamp.s, lamp.u, ground + 3.75), scale: [.17, 7.5, .17] });
      beam(point(lamp.s, lamp.u, ground + 7.5), point(lamp.s, 6.2, ground + 7.5), .14);
      lamps.push({ p: point(lamp.s, 6.2, ground + 7.38), scale: [.62, .18, .95] });
    }
    // Firs gather in small groves on the flat strata shelves, as in the
    // reference, with lone trees between them; steep risers stay bare rock.
    for (let i = 0; i < 38; i++) {
      const s = this.start + random() * CHUNK_LENGTH;
      const u = (random() > .48 ? 1 : -1) * (12 + random() ** 1.5 * 190);
      const count = i % 3 === 0 ? 1 : 2 + Math.floor(random() * 3), size = 4.5 + random() * 5;
      for (let j = 0; j < count; j++) {
        const t = s + (random() - .5) * 9, v = u + (random() - .5) * 7;
        if (t < this.start || t >= this.start + CHUNK_LENGTH || Math.abs(v) < 12 || onLake(t, v, 4)) continue;
        if (Math.abs(snowGroundHeight(t, v + 1) - snowGroundHeight(t, v - 1)) > 1.5) continue;
        pine(t, v, snowGroundHeight(t, v), size * (.8 + random() * .5), random() * Math.PI);
      }
    }
    // Fir groves follow coves on both shores, framing open stretches of water.
    for (let i = 0; i < 13; i++) {
      const s = this.start + random() * CHUNK_LENGTH, lake = alpineLake(s);
      const u = i % 4 === 0 ? lake.far - 9 - random() * 20 : lake.near + 5 + random() * 13;
      for (let j = 0; j < 3; j++) {
        const t = s + (random() - .5) * 11, v = u + (random() - .5) * 7;
        if (t < this.start || t >= this.start + CHUNK_LENGTH || onLake(t, v, 3)) continue;
        if (Math.abs(snowGroundHeight(t, v + 1) - snowGroundHeight(t, v - 1)) > 1.6) continue;
        pine(t, v, snowGroundHeight(t, v), 5 + random() * 7.5, random() * Math.PI * 2);
      }
    }
    for (let cell = Math.floor(this.start / 80) - 1; cell <= Math.floor((this.start + CHUNK_LENGTH) / 80); cell++) {
      for (const side of [-1, 1]) {
        const pocket = terrainPocket(cell, side);
        if (pocket.s < this.start || pocket.s >= this.start + CHUNK_LENGTH) continue;
        for (let i = 0; i < 2; i++) {
          const s = pocket.s + (i - .5) * 3.5, u = pocket.u + (i - .5) * 1.4;
          pine(s, u, snowGroundHeight(s, u) - .6, 4.5 + random() * 3, random() * Math.PI);
        }
      }
    }
    // Loose angular debris gathers below the face and around the roadside toe.
    for (let i = 0; i < 105; i++) {
      const s = this.start + random() * CHUNK_LENGTH;
      const u = i % 3 ? alpineLake(s).near + 3 + random() * 14 : 12 + random() * 10;
      const size = .35 + random() ** 1.6 * 1.9;
      stone(s, u, size, i % 4 === 0);
    }
    for (let i = 0; i < 115; i++) {
      const s = this.start + random() * CHUNK_LENGTH, u = (random() > .5 ? 1 : -1) * (12 + random() ** 1.8 * 160);
      if (Math.abs(snowGroundHeight(s, u + 1) - snowGroundHeight(s, u - 1)) > 2.8) continue;
      const size = .8 + random() ** 2 * 4.6;
      stone(s, u, size, true, i % 5 === 0);
      // A few fragments around larger stones read as natural rockfall groups.
      if (size > 3) for (let chip = 0; chip < 2; chip++) {
        const ds = (random() - .5) * size * 3, du = (random() - .5) * size * 3;
        if (s + ds >= this.start && s + ds < this.start + CHUNK_LENGTH && Math.abs(u + du) > 10)
          stone(s + ds, u + du, size * (.15 + random() * .16), chip === 0);
      }
    }
    this.buildBridge(point, random, stone);
    instances(this.group, poleGeometry, barkMaterial, trunks, 'alpine-trunks');
    alpinePines.forEach((variant, i) => {
      instances(this.group, variant.needles, pineMaterial, pines[i], 'alpine-firs');
      instances(this.group, variant.snow, snowMaterial, caps[i], 'fir-snow');
    });
    alpineRockVariants.forEach((variant, i) => {
      instances(this.group, variant.rock, stoneMaterial, rocks[i], 'alpine-boulders');
      instances(this.group, variant.snow, snowMaterial, rockCaps[i], 'boulder-snow');
    });
    instances(this.group, boxGeometry, metalMaterial, metal, 'guardrails-and-lamps');
    instances(this.group, boxGeometry, glowMaterial, lamps, 'amber-lanterns');
    const cell = Math.floor((this.start - 76) / 280);
    for (let i = cell; i <= cell + 1; i++) {
      const summit = summitForCell(i);
      if ((i % 3 + 3) % 3 === 0 && summit.s >= this.start && summit.s < this.start + CHUNK_LENGTH) this.buildRelay(point, summit);
    }
  }
  buildBridge(point, random, stone) {
    // A timber trestle carries the road over each stream gully. Planks, bents
    // and railings are instanced boxes like the guardrails, tinted per plank.
    const bridge = snowBridgeAt(this.start + CHUNK_LENGTH / 2), { start, end } = bridge;
    if (end + 40 < this.start || start - 40 >= this.start + CHUNK_LENGTH) return;
    const inChunk = s => s >= this.start && s < this.start + CHUNK_LENGTH;
    const timber = [], caps = [], road = snowRoadHeight, across = s => -snowFrame(s).angle;
    const bar = (list, a, b, width, depth = width) => {
      const direction = new THREE.Vector3().fromArray(b).sub(new THREE.Vector3().fromArray(a));
      list.push({ p: a.map((v, i) => (v + b[i]) / 2), scale: [width, direction.length(), depth], q: new THREE.Quaternion().setFromUnitVectors(up, direction.normalize()) });
    };
    const floor = (s, u) => Math.min(snowGroundHeight(s - 1.5, u), snowGroundHeight(s, u), snowGroundHeight(s + 1.5, u)) - .8;
    const tint = () => ['#ffffff', '#e8dfd6', '#d6cabf', '#f3ece5'][Math.floor(random() * 4)];
    for (let s = start + .475; s < end; s += .95) {
      if (inChunk(s)) timber.push({ p: point(s, 0, road(s) - .12), scale: [15.4, .32, .9], angle: across(s), color: tint() });
    }
    for (let s = start; s < end; s += 4) {
      if (!inChunk(s)) continue;
      const e = Math.min(s + 4, end);
      for (const u of [-5.4, 0, 5.4]) bar(timber, point(s, u, road(s) - .58), point(e, u, road(e) - .58), .5, .6);
      for (const side of [-1, 1]) {
        const u = side * 7.15;
        timber.push({ p: point(s, u, road(s) + .55), scale: [.3, 1.4, .3], angle: across(s) });
        bar(timber, point(s, u, road(s) + 1.12), point(e, u, road(e) + 1.12), .2, .24);
        bar(timber, point(s, u, road(s) + .62), point(e, u, road(e) + .62), .12, .18);
        bar(caps, point(s, u, road(s) + 1.3), point(e, u, road(e) + 1.3), .3, .12);
      }
    }
    // Timber cribbing at each abutment meets the dipping terrain, so the road
    // ribbon never floats above the gully rim; a sill plank covers the joint.
    for (const s of [start, end]) {
      if (inChunk(s)) {
        timber.push({ p: point(s, 0, road(s) + .05), scale: [15.4, .22, 1.3], angle: across(s), color: '#c9bcb0' });
        for (const side of [-1, 1]) timber.push({ p: point(s, side * 7.15, road(s) + .6), scale: [.36, 1.5, .36], angle: across(s) });
      }
      for (let t = s === start ? start - 8 : end; t < (s === start ? start : end + 8); t += 4) {
        if (!inChunk(t + 2)) continue;
        const top = road(t + 2) - .2, bottom = Math.min(floor(t, -7.5), floor(t, 7.5), floor(t + 4, -7.5), floor(t + 4, 7.5));
        timber.push({ p: point(t + 2, 0, (top + bottom) / 2), scale: [15, top - bottom, 4.1], angle: across(t + 2) });
      }
    }
    for (let s = start + 4; s < end; s += 8) {
      if (!inChunk(s)) continue;
      const cap = road(s) - 1, angle = across(s);
      timber.push({ p: point(s, 0, cap), scale: [14.8, .55, .55], angle });
      const drop = cap - floor(s, 0), splay = Math.min(2.4, Math.max(0, drop) * .14);
      const feet = { [-6.2]: -6.2 - splay, [6.2]: 6.2 + splay, 0: 0 };
      const base = Object.fromEntries(Object.values(feet).map(u => [u, floor(s, u)]));
      for (const top of drop > 3.5 ? [-6.2, 0, 6.2] : [-6.2, 6.2]) bar(timber, point(s, top, cap), point(s, feet[top], base[feet[top]]), .5);
      if (drop > 2) bar(timber, point(s, feet[-6.2], base[feet[-6.2]] + .3), point(s, feet[6.2], base[feet[6.2]] + .3), .5, .5);
      if (drop > 4.5) {
        bar(timber, point(s, -6, cap - .4), point(s, feet[6.2] * .95, base[feet[6.2]] + .6), .3, .16);
        bar(timber, point(s, 6, cap - .4), point(s, feet[-6.2] * .95, base[feet[-6.2]] + .6), .3, .16);
      }
      // Longitudinal ties and alternating diagonals brace neighbouring bents.
      const next = s + 8, nextCap = road(next) - 1, nextDrop = nextCap - floor(next, 0);
      if (next >= end || drop < 5 || nextDrop < 5) continue;
      const nextSplay = Math.min(2.4, nextDrop * .14), lean = ((s - start) / 8) % 2 ? [.15, .85] : [.85, .15];
      for (const side of [-1, 1]) {
        bar(timber, point(s, side * (6.2 + splay * .5), cap - drop * .5), point(next, side * (6.2 + nextSplay * .5), nextCap - nextDrop * .5), .3, .3);
        bar(timber, point(s, side * (6.2 + splay * lean[0]), cap - drop * lean[0]), point(next, side * (6.2 + nextSplay * lean[1]), nextCap - nextDrop * lean[1]), .26, .16);
      }
    }
    // Loose stones gather along the stream bed on both sides of the crossing.
    for (let i = 0; i < 9; i++) {
      const u = (i % 2 ? 1 : -1) * (11 + random() * 16), s = bridge.center + u * .2 + (random() - .5) * 18;
      if (inChunk(s)) stone(s, u, .7 + random() * 1.8, i % 3 === 0);
    }
    instances(this.group, boxGeometry, timberMaterial, timber, 'timber-trestle');
    instances(this.group, boxGeometry, snowMaterial, caps, 'trestle-snow');
  }
  buildRelay(point, summit) {
    // A tiny mountaintop relay hut and antenna echo the reference's summit detail.
    const s = summit.s, u = summit.u, y = snowGroundHeight(s, u);
    instances(this.group, boxGeometry, rockMaterial, [{ p: point(s, u, y + 2.1), scale: [5.2, 4.2, 5] }], 'relay-hut');
    instances(this.group, boxGeometry, snowMaterial, [{ p: point(s, u, y + 4.4), scale: [5.8, .6, 5.7] }], 'relay-roof');
    instances(this.group, boxGeometry, glowMaterial, [{ p: point(s, u - 2.62, y + 2.4), scale: [.07, 1.1, 1.1] }], 'relay-window');
    const metal = [];
    for (const ds of [-2, 2]) for (const du of [-2, 2]) {
      const ground = snowGroundHeight(s + ds, u + du) - 3;
      metal.push({ p: point(s + ds, u + du, (y + ground) / 2), scale: [.22, Math.max(.2, y - ground), .22] });
    }
    const towerY = snowGroundHeight(s, u + 7) - 1;
    for (const du of [-1, 1]) for (const ds of [-1, 1]) metal.push({ p: point(s + ds, u + 7 + du, towerY + 8), scale: [.14, 16, .14] });
    for (let h = 2; h < 16; h += 3) metal.push({ p: point(s, u + 7, towerY + h), scale: [2.2, .15, 2.2] });
    metal.push({ p: point(s, u + 7, towerY + 17), scale: [.08, 5, .08] });
    instances(this.group, boxGeometry, metalMaterial, metal, 'summit-relay');
    instances(this.group, rockGeometry, edgeMaterial, [{ p: point(s, u + 5.8, towerY + 13), scale: [.25, 1.15, .8] }], 'relay-dish');
  }
  dispose() {
    this.group.removeFromParent(); for (const g of this.owned) g.dispose();
    this.group.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
  }
}

export class SnowWorld {
  constructor(scene, chunkSource = null) {
    this.scene = scene; this.chunkSource = chunkSource; this.chunks = new Map(); this.origin = 0; this.center = null;
    this.effects = new THREE.Group(); this.effects.name = 'snow-night-effects'; scene.add(this.effects);
    // A fixed pool lights only nearby lamps, with no additional shadow maps.
    this.lights = Array.from({ length: 7 }, () => { const light = new THREE.PointLight('#ffb76b', 340, 40, 2); this.effects.add(light); return light; });
    this.cabinLights = Array.from({ length: 2 }, () => { const light = new THREE.PointLight('#ffc080', 110, 23, 2); this.effects.add(light); return light; });
    this.glowGeometry = new THREE.BufferGeometry();
    this.glowGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(21), 3));
    this.glowGeometry.setAttribute('strength', new THREE.Float32BufferAttribute(new Float32Array(7), 1));
    this.glowMaterial = new THREE.PointsMaterial({ color: '#ffc37c', size: 26, transparent: true, opacity: .38,
      depthWrite: false, sizeAttenuation: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.glowMaterial.onBeforeCompile = shader => {
      shader.vertexShader = 'attribute float strength; varying float vGlow;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = strength;');
      shader.fragmentShader = 'varying float vGlow;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        float radius = length(gl_PointCoord - vec2(0.5));
        diffuseColor.a *= exp(-radius * radius * 22.0) * (1.0 - smoothstep(0.32, 0.5, radius)) * vGlow;
      `);
    };
    this.lampGlows = new THREE.Points(this.glowGeometry, this.glowMaterial); this.lampGlows.name = 'lamp-halos';
    this.lampGlows.frustumCulled = false; this.effects.add(this.lampGlows);
    this.headlights = new THREE.Group(); this.effects.add(this.headlights);
    this.headlight = new THREE.SpotLight('#ffe0a6', 170, 18, .64, .8, 1.5);
    this.headlight.position.set(0, 1.03, -2.02); this.headlight.target.position.set(0, -1, -8);
    this.headlight.map = headlightPattern(); this.headlight.castShadow = false;
    this.headlights.add(this.headlight, this.headlight.target);
    this.snowfall = new Snowfall(); this.flakes = this.snowfall.points;
    this.flakeGeometry = this.snowfall.geometry; this.flakeMaterial = this.snowfall.material;
    this.effects.add(this.flakes); this.time = 0;
  }
  update(s) {
    this.s = s; this.origin = Math.floor(s / 1024) * 1024;
    const center = Math.floor(s / CHUNK_LENGTH);
    updateResidentChunks(this, center, SnowChunk);
    for (const chunk of this.chunks.values()) chunk.group.position.z = this.origin - chunk.start;
    const lampIndex = Math.round((s - 16) / LAMP_SPACING);
    // Fixed fixtures only move when the light pool advances or the world rebases.
    // Their fades still follow the car every frame.
    if (lampIndex !== this.lampIndex || this.origin !== this.lightOrigin) {
      this.lamps = this.lights.map((light, i) => {
        const lamp = lampAt(lampIndex + i - 3), p = snowPosition(lamp.s, 6.2, lamp.y - .35);
        light.position.set(p.x, p.y, p.z + this.origin);
        this.glowGeometry.attributes.position.setXYZ(i, p.x, p.y + .2, p.z + this.origin);
        return lamp;
      });
      this.lampIndex = lampIndex;
      this.glowGeometry.attributes.position.needsUpdate = true;
    }
    this.lights.forEach((light, i) => {
      const lamp = this.lamps[i];
      const strength = lamp.hidden ? 0 : 1 - smoothstep(120, 174, Math.abs(lamp.s - s));
      light.intensity = 340 * strength;
      this.glowGeometry.attributes.strength.setX(i, strength);
    });
    this.glowGeometry.attributes.strength.needsUpdate = true;
    const cabinIndex = Math.floor((s - 76) / CABIN_SPACING);
    if (cabinIndex !== this.cabinIndex || this.origin !== this.lightOrigin) {
      this.cabins = this.cabinLights.map((light, i) => {
        const cabin = alpineCabin(cabinIndex + i), p = snowPosition(cabin.s, cabin.u, cabin.y);
        light.position.set(p.x - 3, p.y + 2, p.z + this.origin);
        return cabin;
      });
      this.cabinIndex = cabinIndex;
    }
    this.cabinLights.forEach((light, i) => {
      const cabin = this.cabins[i];
      light.intensity = 110 * (1 - smoothstep(210, 340, Math.abs(cabin.s - s)));
    });
    this.lightOrigin = this.origin;
  }
  animate(time, vehicle) {
    this.time = time; lakeClock.value = time;
    animateSnowDiscoveries(this.chunks.values(), time, vehicle);
    if (vehicle) {
      this.headlights.visible = vehicle.carId !== 'formula';
      this.headlights.position.copy(vehicle.car.position); this.headlights.quaternion.copy(vehicle.car.quaternion);
      this.headlight.shadow.camera.up.copy(up).applyQuaternion(vehicle.car.quaternion);
    }
    const anchor = snowPosition(this.s, -35, snowRoadHeight(this.s));
    this.snowfall.update(time, anchor, this.origin);
  }
  dispose() {
    this.chunkSource?.dispose();
    for (const chunk of this.chunks.values()) chunk.dispose(); this.chunks.clear(); this.effects.removeFromParent();
    this.snowfall.dispose();
    this.headlight.map.dispose(); this.headlight.dispose();
    this.glowGeometry.dispose(); this.glowMaterial.dispose();
  }
}
