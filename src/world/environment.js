import * as THREE from 'three';
import { registerChunkResources } from './chunk-resources.js';
import { finalizeChunkTransforms } from './chunk-transforms.js';
import { updateResidentChunks } from './resident.js';
import { CHUNK_LENGTH, TERRAIN_STEP, randomAt, seededRandom, roadFrame, coastOffset, shorelineOffset, terrainColumns, terrainCell, terrainVertex, positionAt, pondAt, pondRadius, ravineAmount, groundHeight, rockCover, cliffRib, bridgeAt, coastalGrove, coastalGuardrail, GUARDRAIL_OFFSET, overlookAt, overlookWidth, clamp, lerp, smoothstep } from './route.js';
import { createWaterMaterial, createSurfMaterial, createRockWashMaterial, animateWater } from './water.js';
import { buildLandmarks } from './landmarks.js';
import { CoastalBirds } from './birds.js';
import { coastalCrags, coastalPines, coastalCypress, coastalMontereyPine, coastalSedge, terrainSampler } from './coastal-assets.js';
import { coastalDiscoveries, discoveryClearsPlanting } from './coastal-discoveries.js';
import { buildCoastalDiscoveries } from './coastal-discovery-scenery.js';
import { solidModel, solidPost } from './colliders.js';

const terrainMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
const waterMaterial = createWaterMaterial();
const roadMaterial = new THREE.MeshStandardMaterial({ color: '#424e58', roughness: 1 });
const shoulderMaterial = new THREE.MeshStandardMaterial({ color: '#b9b9a7', roughness: 1 });
const lineMaterial = new THREE.MeshStandardMaterial({ color: '#f3ecd2', roughness: 1 });
const centerMaterial = new THREE.MeshStandardMaterial({ color: '#ecc967', roughness: 1 });
const foamMaterial = createSurfMaterial();
const rollingSurfMaterial = createSurfMaterial(true);
const rockWashMaterial = createRockWashMaterial();
const leavesMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 1 });
const pineMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, flatShading: true, roughness: 1 });
const trunkMaterial = new THREE.MeshStandardMaterial({ color: '#78664a', roughness: 1 });
const rockMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 1 });
const cragMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, flatShading: true, roughness: .92 });
cragMaterial.onBeforeCompile = shader => {
  shader.vertexShader = 'varying float vStoneHeight;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
    vec4 stonePosition = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      stonePosition = instanceMatrix * stonePosition;
    #endif
    vStoneHeight = (modelMatrix * stonePosition).y;
    #include <project_vertex>
  `);
  shader.fragmentShader = 'varying float vStoneHeight;\n' + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
    #include <color_fragment>
    diffuseColor.rgb *= mix(vec3(0.46, 0.57, 0.58), vec3(1.0), smoothstep(0.1, 2.5, vStoneHeight));
  `);
};
cragMaterial.customProgramCacheKey = () => 'coastal-tidal-stone-v1';
const postMaterial = new THREE.MeshStandardMaterial({ color: '#f4e9cd', roughness: 1 });
const trunkGeometry = new THREE.CylinderGeometry(.16, .25, 1, 5);
const shrubGeometry = new THREE.IcosahedronGeometry(1, 0);
const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
const postGeometry = new THREE.BoxGeometry(.22, 1.25, .25);
const capGeometry = new THREE.BoxGeometry(.235, .18, .265);
const capMaterial = new THREE.MeshStandardMaterial({ color: '#466050' });
const railGeometry = new THREE.BoxGeometry(1, 1, 1);
const railMaterial = new THREE.MeshStandardMaterial({ color: '#aeb9b8', roughness: .72, metalness: .18 });
const matrix = new THREE.Object3D();
registerChunkResources('coast', { terrainMaterial, waterMaterial, roadMaterial, shoulderMaterial, lineMaterial, centerMaterial,
  foamMaterial, rollingSurfMaterial, rockWashMaterial, leavesMaterial, pineMaterial, trunkMaterial, rockMaterial, cragMaterial,
  postMaterial, capMaterial, trunkGeometry, shrubGeometry, rockGeometry, postGeometry, capGeometry,
  coastalPines, coastalCrags, coastalCypress, coastalMontereyPine, coastalSedge, railGeometry, railMaterial });

function geometryFrom(positions, colors) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals(); g.computeBoundingSphere(); return g;
}
function addTriangle(positions, colors, a, b, c, color, start) {
  // All generated surfaces are height fields: keep their winding facing upward.
  if ((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) < 0) [b, c] = [c, b];
  for (const p of [a, b, c]) {
    positions.push(p.x, p.y, p.z + start);
    if (colors) {
      const tint = typeof color === 'function' ? color(p) : color;
      colors.push(tint.r, tint.g, tint.b);
    }
  }
}
function makeInstances(group, geometry, material, items, shadows = true) {
  if (!items.length) return;
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  items.forEach((item, i) => {
    matrix.position.set(...item.p); matrix.rotation.set(...(item.r ?? [0, 0, 0])); matrix.scale.set(...item.scale); matrix.updateMatrix(); mesh.setMatrixAt(i, matrix.matrix);
    if (item.color) mesh.setColorAt(i, new THREE.Color(item.color));
  });
  mesh.castShadow = shadows; mesh.receiveShadow = true; mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere(); group.add(mesh); return mesh;
}

function addRockWash(rock, phase, vertices, washCoords, shape = rockGeometry) {
  matrix.position.set(...rock.p); matrix.rotation.set(...rock.r); matrix.scale.set(...rock.scale); matrix.updateMatrix();
  const position = shape.attributes.position;
  const points = [];
  // Intersect the actual rotated, scaled rock with the water plane so the
  // foam touches its base, rather than sitting in a detached oval around it.
  for (let i = 0; i < position.count; i += 3) {
    const triangle = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(position, i + j).applyMatrix4(matrix.matrix));
    for (let edge = 0; edge < 3; edge++) {
      const a = triangle[edge], b = triangle[(edge + 1) % 3];
      if ((a.y > .12) === (b.y > .12)) continue;
      const p = a.clone().lerp(b, (.12 - a.y) / (b.y - a.y));
      if (!points.some(other => other.distanceToSquared(p) < .000001)) points.push(p);
    }
  }
  if (points.length < 3) return;
  const center = points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / points.length);
  points.sort((a, b) => Math.atan2(a.z - center.z, a.x - center.x) - Math.atan2(b.z - center.z, b.x - center.x));
  const pairs = points.map(p => {
    const outward = p.clone().sub(center).setY(0).normalize();
    const angle = Math.atan2(outward.z, outward.x);
    const width = (1.1 + rock.scale[0] * .32) * (1 - outward.x * .3) * (.85 + .2 * Math.sin(angle * 3 + phase));
    return [p.clone().addScaledVector(outward, -.25), p.clone().addScaledVector(outward, width)];
  });
  for (let i = 0; i < pairs.length; i++) {
    const [a, b] = pairs[i], [c, d] = pairs[(i + 1) % pairs.length];
    for (const [p, edge] of [[a, 0], [c, 0], [b, 1], [b, 1], [c, 0], [d, 1]]) {
      vertices.push(p.x, .12, p.z); washCoords.push(edge, phase);
    }
  }
}

export class CoastalChunk {
  constructor(index) {
    this.index = index; this.start = index * CHUNK_LENGTH; this.group = new THREE.Group(); this.owned = [];
    this.discoveries = coastalDiscoveries(this.start - 96, this.start + CHUNK_LENGTH + 96);
    this.buildTerrain(); this.buildWater(); this.buildRoad(); buildLandmarks(this); this.buildScenery();
    buildCoastalDiscoveries(this, this.discoveries);
    if (index % 3 === 0) this.birds = new CoastalBirds(this);
    finalizeChunkTransforms(this.group);
  }
  addMesh(geometry, material, shadows = false) {
    const mesh = new THREE.Mesh(geometry, material); mesh.receiveShadow = true; mesh.castShadow = shadows; this.group.add(mesh); this.owned.push(geometry); return mesh;
  }
  buildTerrain() {
    const positions = []; const colors = [];
    const firstRow = this.start / TERRAIN_STEP;
    // Adjacent faces share expensive terrain samples. Release the cache once
    // this chunk is built, so long drives never accumulate cached terrain.
    const vertices = new Map();
    const vertex = (row, col) => {
      const key = `${row},${col}`;
      if (!vertices.has(key)) vertices.set(key, terrainVertex(row, col));
      return vertices.get(key);
    };
    const columns = terrainColumns(this.start).length;
    const meadow = new THREE.Color('#88a746'), fern = new THREE.Color('#527b3e'), dryGrass = new THREE.Color('#b7b56e');
    const stone = new THREE.Color('#c4bba5'), coolStone = new THREE.Color('#829095'), fracture = new THREE.Color('#505d63');
    const cliffStone = new THREE.Color('#d9c9ad'), coolCliff = new THREE.Color('#81929b'), dust = new THREE.Color('#b7af7c');
    const stoneLight = new THREE.Vector3(-145, 230, 95).normalize();
    for (let row = firstRow; row < firstRow + CHUNK_LENGTH / TERRAIN_STEP; row++) {
      for (let col = 0; col < columns - 1; col++) {
        const seedCol = col > 8 ? col - 1 : col;
        terrainCell(row, col, vertex).forEach((tri, j) => {
          const r = randomAt(row * 2 + j, seedCol + 191);
          let color, meadowFace = false;
          const s = tri.reduce((sum, p) => sum + p.s, 0) / 3;
          const u = tri.reduce((sum, p) => sum + p.u, 0) / 3;
          const edgeA = new THREE.Vector3(tri[1].x - tri[0].x, tri[1].y - tri[0].y, tri[1].z - tri[0].z);
          const edgeB = new THREE.Vector3(tri[2].x - tri[0].x, tri[2].y - tri[0].y, tri[2].z - tri[0].z);
          const longestEdgeSq = Math.max(edgeA.lengthSq(), edgeB.lengthSq(), edgeA.clone().sub(edgeB).lengthSq());
          const normal = edgeA.cross(edgeB);
          const sliver = normal.length() < longestEdgeSq * .12;
          normal.normalize();
          if (normal.y < 0) normal.negate();
          const steep = Math.abs(normal.y) < .59;
          const y = tri.reduce((sum, p) => sum + p.y, 0) / 3;
          // Carry the roadside greens well into either meadow before easing
          // into local hillside color. The transition spans roughly 90 m.
          const vergeBlend = smoothstep(8, 100, Math.abs(u));
          const grassU = u * vergeBlend;
          const meadowMix = .5 + .28 * Math.sin(s / 75 + grassU / 80) + .2 * Math.sin(s / 150 - grassU / 140);
          const shoreFace = col <= 6 || (ravineAmount(s, u) > .65 && u < 35);
          // Sand stays on low, gentle ground. Turf follows the shaped rim
          // shoulder; cliff sliver cleanup never reaches the inland meadow.
          const sandyFace = shoreFace && normal.y > .78 && Math.max(...tri.map(p => p.y)) < 3.5;
          const grassyLedge = tri.rimTurf && normal.y > .5 && !(sliver && normal.y < .7) && ravineAmount(s, u) < .12;
          const coastalRock = col >= 7 && col <= 9 && !grassyLedge;
          const grassyShelf = col >= 10 && col <= 11 && ravineAmount(s, u) < .12;
          // Inland rock follows the summits and cohesive patches; only truly
          // sheer facets break through the turf elsewhere.
          const cover = col >= 12 ? rockCover(s, u) : 0;
          const inlandRock = !grassyShelf && ((steep && u > coastOffset(s) - 10 && (normal.y < .44 || (ravineAmount(s, u) > .05 && normal.y < .55))) || cover + (r - .5) * .08 > .48);
          const exposure = clamp(normal.dot(stoneLight), 0, 1);
          if (sandyFace) {
            color = new THREE.Color('#e9d8b3').lerp(new THREE.Color('#94aaa1'), 1 - smoothstep(-.3, 1.5, y));
          } else if (shoreFace || coastalRock || (!grassyLedge && (col <= 9 || inlandRock))) {
            if (col <= 10) {
              // Warm sunlit slabs, cool shaded planes, and dark recessed
              // fractures, with a damp, darker band along the toe.
              const weathering = randomAt(Math.floor((s + y * .2) / 14), 1641);
              color = fracture.clone().lerp(coolCliff, smoothstep(.02, .3, exposure));
              color.lerp(cliffStone, smoothstep(.4, .88, exposure) * .8 + weathering * .16);
              color.multiplyScalar(lerp(.8, 1, smoothstep(1.2, 4.5, y)));
            } else {
              const weathering = randomAt(Math.floor(s / 21) * 7 + Math.floor(u / 17), 1642);
              color = fracture.clone().lerp(coolStone, smoothstep(.02, .32, exposure));
              color.lerp(stone, smoothstep(.36, .9, exposure) * .78 + weathering * .12 + r * .1);
              color.multiplyScalar(.96 + .06 * smoothstep(20, 70, cover * 60 + (y - 30)));
              // Weathered lower faces carry lichen and grass into the rock;
              // a summit still reads as a connected mass of exposed granite.
              color.lerp(dryGrass, (1 - smoothstep(.45, .85, cover)) * smoothstep(.48, .85, normal.y) * .38);
            }
          } else {
            meadowFace = true;
            // One turf palette crosses the road. Broad habitat patches and
            // elevation change its color, never which side of the road it is on.
            color = fern.clone().lerp(meadow, clamp(meadowMix * .7 + r * .07 + .18, 0, 1));
            const grove = lerp(coastalGrove(s, 0), coastalGrove(s, u), vergeBlend);
            color.lerp(fern, smoothstep(.34, .88, grove) * .34);
            // Sun-facing upland slopes dry to a straw tint; the rim turf wears
            // through to bare dust on the exposed headland buttresses.
            color.lerp(dryGrass, smoothstep(.45, .95, exposure) * smoothstep(12, 90, y - roadFrame(s).y) * .28);
            if (tri.rimTurf) color.lerp(dust, smoothstep(.45, .9, cliffRib(s, 1)) * (.35 + r * .4));
          }
          // Let broad meadow patches carry the color, with quieter random
          // variation so the flat-shaded slopes still define the facets.
          color.multiplyScalar(sandyFace || meadowFace ? .985 + r * .03 : col > 9 && !steep ? .95 + r * .1 : .97 + r * .06);
          let tint = color;
          if (meadowFace && u > 7 && pondRadius(s, u) < 2.6) {
            const pond = pondAt(s);
            // Damp grass uses the meadow's own green, fading over a broad
            // bank. Interpolate moisture within each face so it cannot paint
            // a ring of solid, differently colored triangles around the pond.
            tint = p => {
              const damp = (1 - smoothstep(.65, 2.3, pondRadius(p.s, p.u, pond)))
                * (1 - smoothstep(pond.level + .5, pond.level + 12, p.y));
              return color.clone().lerp(fern, damp * .18);
            };
          }
          addTriangle(positions, colors, ...tri, tint, this.start);
        });
      }
    }
    this.terrain = this.addMesh(geometryFrom(positions, colors), terrainMaterial, true);
    this.sampleGround = terrainSampler(this.terrain);
  }
  buildWater() {
    const positions = [], colors = [];
    const step = 16, firstRow = this.start / step;
    const seaPoint = (row, col) => {
      const s = row * step + (randomAt(row, col + 717) - .5) * 9;
      const u = -420 + col * 16 + (row % 2 === 0 ? -3 : 3) + (randomAt(row + 122, col) - .5) * 9;
      return { ...positionAt(s, u, -.05), u, s };
    };
    for (let row = firstRow; row < firstRow + CHUNK_LENGTH / step; row++) for (let col = 0; col < 32; col++) {
      const a = seaPoint(row, col), b = seaPoint(row + 1, col), c = seaPoint(row, col + 1), d = seaPoint(row + 1, col + 1);
      const triangles = randomAt(row, col + 613) > .5 ? [[a, b, c], [b, d, c]] : [[a, b, d], [a, d, c]];
      triangles.forEach((tri, t) => {
        const u = tri.reduce((sum, v) => sum + v.u, 0) / 3;
        const s = tri.reduce((sum, v) => sum + v.s, 0) / 3;
        const depth = clamp((shorelineOffset(s) - u) / 155, 0, 1);
        const color = new THREE.Color('#71cfc7').lerp(new THREE.Color('#277f9e'), smoothstep(0, .52, depth));
        color.lerp(new THREE.Color('#205879'), smoothstep(.28, 1, depth));
        color.multiplyScalar(.94 + randomAt(row * 2 + t, col + 819) * .13);
        addTriangle(positions, colors, ...tri, color, this.start);
      });
    }
    const ocean = this.addMesh(geometryFrom(positions, colors), waterMaterial);
    ocean.name = 'animated-ocean'; ocean.geometry.boundingSphere.radius += .5;
    for (let line = 0; line < 4; line++) {
      const foam = [], flow = [], edges = [];
      for (let s = this.start; s < this.start + CHUNK_LENGTH; s += 2) {
        if (ravineAmount(s, 0) > .15) continue;
        if (line > 0 && randomAt(Math.floor(s / 6), line + 19) > .8) continue;
        const offset = line === 0 ? -1.1 : 16;
        const width = line === 0 ? 5.8 + Math.sin(s * .31) * 1.5 : 3.4 + Math.sin(s * .18 + line) * 1.3;
        const at = (t, du) => positionAt(t, shorelineOffset(t) - offset + Math.sin(t * .21 + line) * 1.1 + du, .17);
        const a = at(s, 0), b = at(s + 2, 0), c = at(s, -width), d = at(s + 2, -width);
        a.edge = b.edge = 0; c.edge = d.edge = 1;
        for (let triangle of [[a, c, b], [b, c, d]]) {
          const [p, q, r] = triangle;
          if ((q.z - p.z) * (r.x - p.x) - (q.x - p.x) * (r.z - p.z) < 0) triangle = [p, r, q];
          for (const v of triangle) { foam.push(v.x, v.y, v.z + this.start); edges.push(v.edge); }
        }
        for (let vertex = 0; vertex < 6; vertex++) flow.push(1, 0, line / 3);
      }
      const geo = geometryFrom(foam);
      geo.setAttribute('surfEdge', new THREE.Float32BufferAttribute(edges, 1));
      if (line > 0) geo.setAttribute('surfFlow', new THREE.Float32BufferAttribute(flow, 3));
      geo.boundingSphere.radius += 12;
      const surf = this.addMesh(geo, line === 0 ? foamMaterial : rollingSurfMaterial);
      surf.name = line === 0 ? 'shore-wash' : 'rolling-breakers';
    }
  }
  ribbon(ranges, lift, material, dashed = false) {
    const positions = [];
    for (const [low, high] of ranges) for (let s = this.start; s < this.start + CHUNK_LENGTH; s += 2) {
      if (dashed && Math.floor(s / 4) % 3 === 2) continue;
      const point = (t, u) => { const f = roadFrame(t); return positionAt(t, u, f.y + lift); };
      const edge = (value, t) => typeof value === 'function' ? value(t) : value;
      const a = point(s, edge(low, s)), b = point(s + 2, edge(low, s + 2)), c = point(s, edge(high, s)), d = point(s + 2, edge(high, s + 2));
      addTriangle(positions, null, a, b, c, null, this.start); addTriangle(positions, null, b, d, c, null, this.start);
    }
    this.addMesh(geometryFrom(positions), material);
  }
  buildRoad() {
    // Carry the shoulder around the pullout instead of through its entrance.
    this.ribbon([[s => -overlookWidth(s), 6.05]], .045, shoulderMaterial);
    this.ribbon([[-5.5, 5.5]], .075, roadMaterial);
    // Matching markings share geometry and a draw call within each chunk.
    this.ribbon([[-5.05, -4.89], [4.89, 5.05]], .09, lineMaterial);
    this.ribbon([[-.21, -.07], [.07, .21]], .093, centerMaterial);
    const pavement = [], markings = [];
    const point = (s, u, lift) => positionAt(s, u, roadFrame(s).y + lift);
    const strip = (array, s, low, high, endLow = low, endHigh = high, lift = .075) => {
      const a = point(s, low, lift), b = point(s + 2, endLow, lift), c = point(s, high, lift), d = point(s + 2, endHigh, lift);
      addTriangle(array, null, a, b, c, null, this.start); addTriangle(array, null, b, d, c, null, this.start);
    };
    for (let s = this.start; s < this.start + CHUNK_LENGTH; s += 2) {
      const width = overlookWidth(s), endWidth = overlookWidth(s + 2);
      if (Math.max(width, endWidth) <= 6.06) continue;
      // Share the road's exact edge, height, and sampling so no pale seam or
      // overlapping asphalt separates the turnout from the driving surface.
      strip(pavement, s, -width + .55, -5.5, -endWidth + .55, -5.5);
      if (Math.min(width, endWidth) > 15.8 && Math.floor(s / 2) % 3 === 0) {
        // Short bay dividers on the seaward edge leave room to pull through.
        const a = point(s, -14.85, .098), b = point(s + .12, -14.85, .098);
        const c = point(s, -10.5, .098), d = point(s + .12, -10.5, .098);
        addTriangle(markings, null, a, b, c, null, this.start); addTriangle(markings, null, b, d, c, null, this.start);
      }
    }
    if (pavement.length) {
      this.addMesh(geometryFrom(pavement), roadMaterial).name = 'paved-ocean-overlook';
      this.addMesh(geometryFrom(markings), lineMaterial).name = 'overlook-parking-bays';
    }
  }
  buildScenery() {
    const random = seededRandom(this.index + 8913);
    const trunks = [], foliage = [[], []], shrubs = [], rocks = [], posts = [], caps = [], rails = [], benches = [], cypresses = [], monterey = [], sedges = [], stacks = [[], [], []];
    const rockWashVertices = [], rockWashCoords = [];
    const canGrow = (s, u) => !(u < 0 && u > -overlookWidth(s) - 3) && pondRadius(s, u) > 1.15 && ravineAmount(s, u) < .13 && groundHeight(s, u) > 2 && discoveryClearsPlanting(s, u, this.discoveries);
    const hillSlope = (s, u) => Math.hypot(groundHeight(s, u + 1) - groundHeight(s, u - 1), groundHeight(s + 1, u) - groundHeight(s - 1, u)) / 2;
    const green = ['#315c48', '#406747', '#52744e', '#294e40', '#607e4d', '#3e624b'];
    const uplandGreen = ['#254e40', '#305b45', '#40664b', '#29483e'];
    const bushColors = ['#6a8652', '#829357', '#547c56', '#94a365'];
    const rockColors = ['#b9b39f', '#a5b1b0', '#c7bba2', '#929fa1', '#b7b6a9'];
    const outcropColors = ['#9ca8a6', '#bab5a5', '#8c9c9d', '#acada2'];
    const planted = (s, u) => {
      const p = positionAt(s, u);
      p.y = this.sampleGround(p.x, p.z + this.start) ?? p.y;
      return p;
    };
    for (let i = 0; i < 475; i++) {
      const s = this.start + random() * CHUNK_LENGTH;
      let u = 12 + random() ** .8 * 170;
      if (i < 13) u = lerp(coastOffset(s) + 7, -13, random());
      // Firs crowd into groves on the upland flanks and ridges; the low
      // terrace by the road keeps a looser mix with broadleaf crowns.
      const grove = coastalGrove(s, u);
      const upland = smoothstep(45, 85, u);
      if (grove < (u < 0 ? .58 : .51) || random() > smoothstep(.46, .71, grove)) continue;
      if (!canGrow(s, u) || rockCover(s, u) > .42 || hillSlope(s, u) > 1.35) continue;
      const p = planted(s, u);
      const maturity = u < 0 ? .7 : (.76 + smoothstep(.47, .72, grove) * .37) * (1 - rockCover(s, u) * .22);
      const size = (5.8 + random() * 6.8) * maturity;
      const y = p.y - .25; const rotation = random() * Math.PI;
      if (u < 58 && (u < 0 || i % 4 === 0)) {
        const item = { p: [p.x, y, p.z + this.start], scale: [size * .85, size, size * .85], r: [0, rotation, 0], color: green[i % green.length] };
        (u < 0 ? cypresses : monterey).push(item);
        solidModel(this, (u < 0 ? coastalCypress : coastalMontereyPine).bark, item.p, rotation, size * .85, true);
        continue;
      }
      trunks.push({ p: [p.x, y + size * .29, p.z + this.start], scale: [size * .35, size * .6, size * .35] });
      solidPost(this, p.x, p.z + this.start, size * .09);
      const palette = upland > .5 ? uplandGreen : green;
      const color = palette[Math.floor(random() * palette.length)];
      foliage[i % 2].push({ p: [p.x, y, p.z + this.start], scale: [size, size, size], r: [0, rotation, 0], color });
    }
    for (let i = 0; i < 98; i++) {
      const s = this.start + random() * CHUNK_LENGTH;
      const u = i < 42 ? lerp(coastOffset(s) + 1.7, -8.5, random()) : 9.5 + random() * 91;
      if (!canGrow(s, u) || (u > 16 && coastalGrove(s, u) < .47)) continue;
      const p = planted(s, u); const size = 1 + random() * 1.9;
      shrubs.push({ p: [p.x, p.y + size * .43, p.z + this.start], scale: [size, size * .7, size * .86], r: [0, random() * 6, .15], color: bushColors[Math.floor(random() * bushColors.length)] });
      if (i % 3 === 0) shrubs.push({ p: [p.x + size * .72, p.y + size * .25, p.z + this.start + .4], scale: [size * .65, size * .5, size * .7], color: '#99a779' });
    }
    for (let i = 0; i < 52; i++) {
      const s = this.start + random() * CHUNK_LENGTH;
      const sea = i < 25;
      // A few larger silhouettes and small companions leave breathing room in
      // the open water, instead of a field of equally prominent boulders.
      if (sea && i % 8 > 1) continue;
      const hero = sea && i % 8 === 0;
      const u = sea ? shorelineOffset(s) - (i === 0 ? 35 : 6) - random() ** 1.7 * (i === 0 ? 45 : 34) : (i < 35 ? coastOffset(s) + random() * 5 : 12 + random() * 140);
      if (sea && this.discoveries.some(site => site.kind !== 'lighthouse' && Math.hypot(s - site.s, u - site.u) < site.radius + 10)) continue;
      if (!sea && !canGrow(s, u)) continue;
      const p = planted(s, u);
      const size = sea ? (i === 0 ? 8 + random() * 2.5 : hero ? 3.2 + random() * 2.8 : .8 + random() * 2.2) : .7 + random() * 3.1;
      const height = size * (hero ? 1.1 + random() * .72 : .8 + random() * .65);
      const rock = { p: [p.x, sea ? -.8 + height * .3 : p.y + height * .28, p.z + this.start], scale: [size, height, size * (.6 + random() * .6)], r: [random() * .25, random() * 6, random() * .4], color: rockColors[Math.floor(random() * rockColors.length)] };
      if (sea) {
        const variant = Math.floor(i / 3) % 3;
        stacks[variant].push(rock);
        addRockWash(rock, randomAt(this.index, i + 503) * Math.PI * 2, rockWashVertices, rockWashCoords, coastalCrags[variant]);
        if (hero) for (let companion = 0; companion < 2; companion++) {
          // A shared fracture direction and overlapping feet make these read
          // as shoulders broken from the stack, not evenly orbiting pebbles.
          const angle = rock.r[1] + .7 + companion * 2.5 + randomAt(this.index * 31 + i, 614 + companion) * .5;
          const small = size * (companion === 0 ? .46 : .29);
          const radius = size * (companion === 0 ? .83 : 1.07);
          const satellite = { p: [p.x + Math.cos(angle) * radius, -.3 + small * .16, p.z + this.start + Math.sin(angle) * radius],
            scale: [small, small * (companion === 0 ? 1.65 : 1.05), small * .82],
            r: [.08, rock.r[1] + companion * .35, companion === 0 ? -.18 : .22], color: rock.color };
          const shape = (variant + companion + 1) % coastalCrags.length;
          stacks[shape].push(satellite);
          addRockWash(satellite, angle, rockWashVertices, rockWashCoords, coastalCrags[shape]);
        }
      } else rocks.push(rock);
    }
    // Weathered outcrops break through the hillside turf where the rock
    // patches and summits are, half buried so they read as bedrock.
    const outcropRandom = seededRandom(this.index + 51377);
    for (let cluster = 0; cluster < 7; cluster++) {
      const s = this.start + 6 + outcropRandom() * (CHUNK_LENGTH - 12);
      const u = 34 + outcropRandom() ** .7 * 130;
      if (!canGrow(s, u) || rockCover(s, u) < .3 || hillSlope(s, u) > 1.6) continue;
      const lean = outcropRandom() * Math.PI * 2, tint = outcropColors[cluster % outcropColors.length];
      const pieces = 3 + Math.floor(outcropRandom() * 3);
      for (let piece = 0; piece < pieces; piece++) {
        const t = s + (outcropRandom() - .5) * 11, v = u + (outcropRandom() - .5) * 9;
        if (!canGrow(t, v)) continue;
        const p = planted(t, v);
        const size = piece === 0 ? 2.6 + outcropRandom() * 2.6 : 1.1 + outcropRandom() * 2;
        const height = size * (.7 + outcropRandom() * .6);
        stacks[(cluster + piece) % coastalCrags.length].push({ p: [p.x, p.y + height * .05, p.z + this.start],
          scale: [size, height, size * (.7 + outcropRandom() * .5)],
          r: [(outcropRandom() - .5) * .5, lean + piece * .4, (outcropRandom() - .5) * .5], color: tint });
      }
    }
    // Substantial slabs collect beneath eroded sections, with smaller fragments
    // spreading toward the beach. Their buried bases merge into the cliff toe.
    const fallRandom = seededRandom(this.index + 68134);
    for (let pile = 0; pile < 3; pile++) {
      const center = this.start + 14 + pile * 36 + fallRandom() * 12;
      if (ravineAmount(center, coastOffset(center) - 14) > .1) continue;
      for (let piece = 0; piece < 12; piece++) {
        const large = piece < 3;
        const s = center + (fallRandom() - .5) * (large ? 12 : 23);
        const u = coastOffset(s) - (large ? 13.5 : 15) - fallRandom() * (large ? 3 : 6);
        const p = planted(s, u);
        if (p.y < .6 || p.y > 4 || ravineAmount(s, u) > .12) continue;
        const size = large ? 2.7 + fallRandom() * 3.1 : .5 + fallRandom() * 1.9;
        const height = size * (large ? .6 + fallRandom() * .45 : .4 + fallRandom() * .35);
        const rock = { p: [p.x, p.y + height * .12, p.z + this.start],
          scale: [size, height, size * (.65 + fallRandom() * .5)],
          r: [(fallRandom() - .5) * .6, fallRandom() * Math.PI * 2, (fallRandom() - .5) * .65],
          color: rockColors[Math.floor(fallRandom() * rockColors.length)] };
        const variant = (pile + piece) % coastalCrags.length;
        stacks[variant].push(rock);
        if (large) addRockWash(rock, pile + piece, rockWashVertices, rockWashCoords, coastalCrags[variant]);
      }
    }
    if (rockWashVertices.length) {
      const geometry = geometryFrom(rockWashVertices);
      geometry.setAttribute('rockWash', new THREE.Float32BufferAttribute(rockWashCoords, 2));
      geometry.boundingSphere.radius += .5;
      this.addMesh(geometry, rockWashMaterial).name = 'sea-stack-wash';
    }
    // Low, muted wildflowers sit beside shrubs rather than dotting open turf.
    for (let patch = 0; patch < 28; patch++) {
      const s = this.start + random() * CHUNK_LENGTH;
      const u = patch % 2 ? 10 + random() * 20 : lerp(coastOffset(s) + 3, -9, random());
      if (!canGrow(s, u)) continue;
      const center = planted(s, u);
      const besideShrub = shrubs.some(shrub => Math.hypot(shrub.p[0] - center.x, shrub.p[2] - center.z - this.start) < shrub.scale[0] + 3);
      for (let flower = 0; flower < 12; flower++) {
        const t = s + (random() - .5) * 4, v = u + (random() - .5) * 3;
        if (!canGrow(t, v) || Math.abs(v) < 8) continue;
        const p = planted(t, v);
        if (besideShrub) shrubs.push({ p: [p.x, p.y + .2, p.z + this.start], scale: [.32, .22, .32], color: patch % 3 ? '#d5bc59' : '#c4b5b9' });
      }
    }
    for (let s = this.start; s < this.start + CHUNK_LENGTH; s += 16) {
      if (Math.abs(s - bridgeAt(s).center) < 49) continue;
      for (const u of [-6.85, 6.85]) {
        // A delineator beside a guardrail is 20 cm of clutter; the rail marks
        // that edge on its own.
        if (u < 0 && (overlookWidth(s) > 6.2 || coastalGuardrail(s))) continue;
        const p = positionAt(s, u); const angle = -roadFrame(s).angle;
        posts.push({ p: [p.x, p.y + .62, p.z + this.start], scale: [1, 1, 1], r: [0, angle, 0] });
        caps.push({ p: [p.x, p.y + .94, p.z + this.start], scale: [1, 1, 1], r: [0, angle, 0] });
      }
    }
    // Galvanized rails follow exposed bends and the approaches to the viaduct,
    // wherever `coastalGuardrail` says one stands. Keep the sheltered meadows
    // open, with sparse roadside delineators.
    for (let s = this.start; s < this.start + CHUNK_LENGTH; s += 4) {
      if (!coastalGuardrail(s + 2)) continue;
      const a = positionAt(s, GUARDRAIL_OFFSET), b = positionAt(s + 4, GUARDRAIL_OFFSET);
      const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
      rails.push({ p: [(a.x + b.x) / 2, (a.y + b.y) / 2 + .95, (a.z + b.z) / 2 + this.start],
        scale: [.18, .32, length + .12], r: [-Math.atan2(b.y - a.y, length), Math.atan2(dx, dz), 0] });
      rails.push({ p: [a.x, a.y + .48, a.z + this.start], scale: [.17, .96, .18] });
      // Each segment posts its own near end, so a run needs one more to close
      // it rather than leaving the last beam hanging in the air.
      if (!coastalGuardrail(s + 6)) rails.push({ p: [b.x, b.y + .48, b.z + this.start], scale: [.17, .96, .18] });
    }
    const overlook = overlookAt(this.start + CHUNK_LENGTH / 2);
    if (overlook.enabled && overlook.center >= this.start && overlook.center < this.start + CHUNK_LENGTH) {
      for (const ds of [-7, 7]) {
        const s = overlook.center + ds, p = planted(s, -20), angle = -roadFrame(s).angle;
        const part = (u, y, along, scale) => {
          const q = positionAt(s + along, -20 + u, p.y + y);
          benches.push({p: [q.x, q.y, q.z + this.start], scale, r: [0, angle, 0]});
        };
        part(0, .78, 0, [.95, .16, 3.2]);
        part(.42, 1.25, 0, [.13, .65, 3.2]);
        for (const along of [-1.15, 1.15]) for (const u of [-.3, .3]) part(u, .35, along, [.15, .7, .15]);
      }
    }
    // Preserve the detail seed sequence for beach stones and headland trees.
    const detailRandom = seededRandom(this.index + 45192);
    const grounded = (s, u) => {
      const p = planted(s, u);
      const slope = Math.abs(groundHeight(s, u + 1) - groundHeight(s, u - 1)) / 2;
      return slope < 1.7 ? new THREE.Vector3(p.x, p.y, p.z + this.start) : null;
    };
    for (let patch = 0; patch < 30; patch++) {
      const s = this.start + 5 + detailRandom() * (CHUNK_LENGTH - 10);
      const u = patch < 10 ? coastOffset(s) + 3 + detailRandom() * 6 : 12 + detailRandom() * 110;
      for (let item = 0; item < 9; item++) {
        const t = s + (detailRandom() - .5) * 8, v = u + (detailRandom() - .5) * 6;
        if (!canGrow(t, v) || v < coastOffset(t) + 1 || Math.abs(v) < 9) continue;
        const p = grounded(t, v);
        if (!p) continue;
        const size = .22 + detailRandom() * .65;
        if (item < 5) rocks.push({ p: [p.x, p.y + size * .18, p.z], scale: [size, size * .48, size * .7], r: [0, detailRandom() * 6.28, .15], color: rockColors[patch % rockColors.length] });
        else {
          // Skip meadow tufts, which read as stray green pixels at driving zoom.
          // Consume their height and rotation draws so later scenery stays put.
          detailRandom(); detailRandom();
        }
      }
    }
    // Pebble drifts on the sand give the coves the reference's broken edges.
    for (let patch = 0; patch < 9; patch++) {
      const s = this.start + 5 + detailRandom() * (CHUNK_LENGTH - 10);
      const u = coastOffset(s) - 11 - detailRandom() * 2;
      if (ravineAmount(s, u) > .1) continue;
      for (let item = 0; item < 8; item++) {
        const t = s + (detailRandom() - .5) * 6, v = u + (detailRandom() - .5) * 2;
        const p = grounded(t, v);
        if (!p || p.y < .6 || p.y > 3) continue;
        const size = .18 + detailRandom() * .55;
        rocks.push({ p: [p.x, p.y + size * .16, p.z], scale: [size, size * .4, size * .75], r: [0, detailRandom() * 6.28, 0], color: rockColors[item % rockColors.length] });
      }
    }
    // Wind-shaped cypresses punctuate the headlands; their broad, leaning
    // crowns contrast with the taller inland fir groves.
    for (let i = 0; i < 5; i++) {
      const s = this.start + 8 + detailRandom() * 112;
      const u = lerp(coastOffset(s) + 6, -13, detailRandom());
      if (!canGrow(s, u) || u > -11) continue;
      const p = planted(s, u), size = 6.5 + detailRandom() * 4;
      cypresses.push({ p: [p.x, p.y - .12, p.z + this.start], scale: [size, size, size], r: [0, -.6 + detailRandom() * .5, 0], color: green[i % green.length] });
      solidModel(this, coastalCypress.bark, cypresses.at(-1).p, cypresses.at(-1).r[1], size, true);
    }
    // Shoreline details grow in interrupted colonies. Find the water's edge
    // on the rendered faces, so sedges and partly submerged stones touch the
    // same bank the water was clipped against, even at a streaming boundary.
    const pond = pondAt(this.start + CHUNK_LENGTH / 2);
    if (Math.abs(pond.center - this.start - CHUNK_LENGTH / 2) < CHUNK_LENGTH / 2 + pond.rs * 1.5) {
      for (let patch = 0; patch < 64; patch++) {
        const angle = patch / 64 * Math.PI * 2;
        const colony = Math.sin(angle * 3 + pond.index * 1.7) + Math.cos(angle * 5 - pond.index) * .4;
        const at = radius => {
          const s = pond.center + Math.cos(angle) * pond.rs * radius;
          const u = pond.u + Math.sin(angle) * pond.ru * radius;
          const p = positionAt(s, u);
          return { ...p, s, u, y: this.sampleGround(p.x, p.z + this.start) };
        };
        let low = .35, high = 1.5, valid = true;
        const inner = at(low), outer = at(high);
        if (inner.y === null || outer.y === null || inner.y >= pond.level || outer.y <= pond.level) continue;
        for (let step = 0; step < 12; step++) {
          const mid = (low + high) / 2, p = at(mid);
          if (p.y === null) { valid = false; break; }
          if (p.y < pond.level) low = mid; else high = mid;
        }
        if (!valid) continue;
        // Every candidate uses its own seed so neighboring chunks agree even
        // when only one of them can sample a particular shoreline segment.
        const r = randomAt(pond.index * 67 + patch, 2282);
        const bank = at(high + .035 + r * .045);
        if (bank.s < this.start || bank.s >= this.start + CHUNK_LENGTH || bank.y === null) continue;
        if (colony > .12) {
          for (let plant = 0; plant < 3; plant++) {
            const s = bank.s + (plant - 1) * 1.05, u = bank.u + Math.sin(patch + plant) * .7;
            if (s < this.start || s >= this.start + CHUNK_LENGTH) continue;
            const p = planted(s, u);
            if (this.sampleGround(p.x, p.z + this.start) === null || p.y < pond.level - .15 || p.y > pond.level + 1.65) continue;
            const size = .85 + randomAt(patch * 3 + plant, pond.index + 2283) * .7;
            sedges.push({p: [p.x, p.y - .08, p.z + this.start], scale: [size, size * (1 + r * .35), size],
              r: [0, angle + plant * 2.4, 0], color: patch % 4 ? '#81915e' : '#a2a071'});
          }
        } else if (colony < -.42 && patch % 3 === 0) {
          const p = at(high - .025), size = 1 + r * 1.6;
          if (p.y === null || p.s < this.start || p.s >= this.start + CHUNK_LENGTH) continue;
          rocks.push({p: [p.x, p.y + size * .12, p.z + this.start], scale: [size, size * .48, size * .75],
            r: [.12, angle, -.1], color: rockColors[patch % rockColors.length]});
          const companion = at(high + .07);
          if (companion.y !== null && companion.s >= this.start && companion.s < this.start + CHUNK_LENGTH) {
            rocks.push({p: [companion.x, companion.y, companion.z + this.start], scale: [size * .6, size * .33, size * .55],
              r: [0, angle + .4, .1], color: rockColors[patch % rockColors.length]});
          }
        }
      }
    }
    makeInstances(this.group, trunkGeometry, trunkMaterial, trunks);
    coastalPines.forEach((shape, i) => { const mesh = makeInstances(this.group, shape, pineMaterial, foliage[i]); if (mesh) mesh.name = 'coastal-firs'; });
    makeInstances(this.group, coastalCypress.bark, trunkMaterial, cypresses.map(({ color, ...item }) => item));
    const cypress = makeInstances(this.group, coastalCypress.leaves, pineMaterial, cypresses);
    if (cypress) cypress.name = 'headland-cypresses';
    makeInstances(this.group, coastalMontereyPine.bark, trunkMaterial, monterey.map(({color, ...item}) => item));
    const pines = makeInstances(this.group, coastalMontereyPine.leaves, pineMaterial, monterey);
    if (pines) pines.name = 'monterey-pines';
    const rushes = makeInstances(this.group, coastalSedge, pineMaterial, sedges, false);
    if (rushes) { rushes.name = 'pond-shore-sedges'; rushes.userData.ambientOcclusion = false; }
    coastalCrags.forEach((shape, i) => { const mesh = makeInstances(this.group, shape, cragMaterial, stacks[i]); if (mesh) mesh.name = 'tidal-sea-stacks'; });
    makeInstances(this.group, shrubGeometry, leavesMaterial, shrubs);
    // Tiny stones read as bright speckles on turf at driving zoom. Keep beach
    // pebbles and substantial rocks; retain candidates so seeded plants stay put.
    makeInstances(this.group, rockGeometry, rockMaterial, rocks.filter(rock => rock.scale[0] >= 1 || rock.p[1] < 4));
    makeInstances(this.group, postGeometry, postMaterial, posts);
    makeInstances(this.group, capGeometry, capMaterial, caps);
    const rail = makeInstances(this.group, railGeometry, railMaterial, rails);
    if (rail) rail.name = 'coastal-guardrails';
    const seats = makeInstances(this.group, railGeometry, trunkMaterial, benches);
    if (seats) seats.name = 'ocean-overlook-benches';
  }
  dispose() {
    this.group.removeFromParent();
    for (const geometry of this.owned) geometry.dispose();
    this.group.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
  }
}

export class CoastalWorld {
  constructor(scene, chunkSource = null) { this.scene = scene; this.chunkSource = chunkSource; this.chunks = new Map(); this.origin = 0; this.center = null; }
  update(s) {
    const center = Math.floor(s / CHUNK_LENGTH);
    this.origin = Math.floor(s / 1024) * 1024;
    updateResidentChunks(this, center, CoastalChunk);
    for (const chunk of this.chunks.values()) chunk.group.position.z = this.origin - chunk.start;
  }
  animate(time) {
    animateWater(time, this.origin);
    for (const chunk of this.chunks.values()) chunk.birds?.update(time);
  }
  dispose() { this.chunkSource?.dispose(); for (const chunk of this.chunks.values()) chunk.dispose(); this.chunks.clear(); }
}
