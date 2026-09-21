import * as THREE from 'three';
import { registerChunkResources } from './chunk-resources.js';
import { splitBatch } from './instance-batches.js';
import { updateResidentChunks } from './resident.js';
import { finalizeChunkTransforms } from './chunk-transforms.js';
import { CHUNK_LENGTH, randomAt, seededRandom, smoothstep, lerp, positionAt } from './route.js';
import { JUNGLE_STEP, JUNGLE_COLUMN_COUNT, RIVER_STEP, jungleColumns, jungleRows, jungleVertex, jungleHeight, jungleRoadHeight as roadHeight, riverCenter, riverHalfWidth, riverLevel, riverLips, riverLipOffset, riverRocks, riverTurbulence,
  onRiver, cutHeight, gorgeWall, jungleGuardrail, sideFalls, jungleZones, jungleCrags, jungleNoise } from './jungle-route.js';
import { riverMaterial, fallMaterial, foamMaterial, mistMaterial, valleyMistMaterial } from './jungle-water.js';
import { animateWater } from './water.js';
import { jungleDiscoveries, jungleDiscoveryClears } from './jungle-discoveries.js';
import { buildJungleDiscoveries } from './jungle-discovery-scenery.js';
import { terrainSampler } from './coastal-assets.js';
import { solidModel, solidPost } from './colliders.js';
import { jungleCrowns, emergentCrowns, emergentTrunks, junglePalms, fernGeometry, bigLeafGeometry, bananaGeometry, bambooGeometry, lilyGeometry, vineGeometry, tuftGeometry,
  jungleBoulders, cliffBlocks } from './jungle-assets.js';

const material = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true, ...extra });
const terrainMaterial = material('#ffffff', { vertexColors: true });
const roadMaterial = material('#4a5156', { roughness: .95, flatShading: false });
const shoulderMaterial = material('#b5a77b', { flatShading: false });
const edgeMaterial = material('#d9d5c4', { flatShading: false });
const centerMaterial = material('#d4b03d', { flatShading: false });
const canopyMaterial = material('#ffffff', { vertexColors: true });
const frondMaterial = material('#ffffff', { vertexColors: true, side: THREE.DoubleSide });
const shrubMaterial = material('#ffffff');
const barkMaterial = material('#6a5644');
// Fallen logs carry per-instance colours; standing trunks do not. Sharing one
// material across both makes the renderer re-derive its program every draw.
const logMaterial = material('#6a5644');
const palmBarkMaterial = material('#8b7657', { vertexColors: true });
const stoneMaterial = material('#ffffff', { vertexColors: true, roughness: .95 });
const railMaterial = material('#ffffff', { roughness: .7 });
// Standing trunks end inside a crown and below the ground, so they need no caps; fallen logs do.
const trunkGeometry = new THREE.CylinderGeometry(.5, .72, 1, 6, 1, true);
const logGeometry = new THREE.CylinderGeometry(.5, .72, 1, 6);
const shrubGeometry = new THREE.IcosahedronGeometry(1, 0);
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const dummy = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0);
registerChunkResources('jungle', { terrainMaterial, roadMaterial, shoulderMaterial, edgeMaterial, centerMaterial, canopyMaterial, frondMaterial,
  shrubMaterial, barkMaterial, logMaterial, palmBarkMaterial, stoneMaterial, railMaterial, trunkGeometry, logGeometry, shrubGeometry, boxGeometry, jungleCrowns, emergentCrowns,
  emergentTrunks, junglePalms, fernGeometry, bigLeafGeometry, bananaGeometry, bambooGeometry, lilyGeometry, vineGeometry, tuftGeometry, jungleBoulders, cliffBlocks });

// Streams wander: across the terrace toward the gorge wall, straightening at
// the culvert and the lip, and down the far hillside toward the road.
function streamShift(fall, u) {
  if (u > 0) return Math.sin(u * .19 + fall.s * 1.3) * 1.8 * smoothstep(12, 18, u);
  const rim = riverCenter(fall.s) + riverHalfWidth(fall.s) + 7;
  return Math.sin(u * .23 + fall.s) * 1.3 * smoothstep(rim + 1, rim + 6, u) * smoothstep(-10.3, -13, u);
}
// Fan out over the last few meters, matching the waterfall's world-space width.
function streamHalfWidth(fall, u) {
  const rim=riverCenter(fall.s)+riverHalfWidth(fall.s)+7;
  const a=positionAt(fall.s-.5,rim),b=positionAt(fall.s+.5,rim);
  const alongScale=Math.hypot(b.x-a.x,b.z-a.z);
  return lerp(1.1,fall.width/(2*alongScale),1-smoothstep(rim+.6,rim+9,u));
}
// Each far-side creek rises its own fixed distance up the hillside.
const creekLength = fall => 26 + randomAt(Math.round(fall.s), 2505) * 40;
// Horizontal unit vectors along the road (+s) and across it (+u) at a spot.
function frameAt(s, u) {
  const a = positionAt(s, u), b = positionAt(s + 1, u), c = positionAt(s, u + 1);
  return { along: new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize(), across: new THREE.Vector3(c.x - a.x, 0, c.z - a.z).normalize() };
}

function geometryFrom(vertices, colors) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals(); g.computeBoundingSphere(); return g;
}
function triangle(vertices, colors, a, b, c, color, start) {
  if ((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) < 0) [b, c] = [c, b];
  for (const p of [a, b, c]) { vertices.push(p.x, p.y, p.z + start); if (colors) colors.push(color.r, color.g, color.b); }
}
function batch(group, geometry, mat, items, name, shadows, ambientOcclusion) {
  const mesh = new THREE.InstancedMesh(geometry, mat, items.length); mesh.name = name;
  items.forEach((item, i) => {
    dummy.position.set(...item.p); dummy.rotation.set(...(item.r ?? [0, 0, 0]));
    if (item.q) dummy.quaternion.copy(item.q);
    dummy.scale.set(...item.scale); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
    if (item.color) mesh.setColorAt(i, new THREE.Color(item.color));
  });
  mesh.castShadow = shadows; mesh.receiveShadow = true; mesh.instanceMatrix.needsUpdate = true;
  if (!ambientOcclusion) mesh.userData.ambientOcclusion = false;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere(); group.add(mesh); return mesh;
}

// `ambientOcclusion: false` keeps a batch out of the soft-shading prepass, which
// redraws the whole scene. The background forest layers cover a few per cent of
// the screen behind fog and nearer trees, so their shading is not visible there.
function instances(group, geometry, mat, items, name, shadows = true, { ambientOcclusion = true } = {}) {
  if (!items.length) return;
  let last;
  for (const part of splitBatch(items)) last = batch(group, geometry, mat, part, name, shadows, ambientOcclusion);
  return last;
}
// Quads over a parameter grid, each vertex carrying its own attribute values.
function sheet(vertices, coords, rows, cols, point) {
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < cols.length - 1; j++) {
    const a = point(rows[i], cols[j]), b = point(rows[i + 1], cols[j]), c = point(rows[i], cols[j + 1]), d = point(rows[i + 1], cols[j + 1]);
    for (const tri of [[a, b, c], [b, d, c]]) for (const v of tri) { vertices.push(v.x, v.y, v.z); coords.push(...v.coord); }
  }
}
// A waterfall leaving a lip heading `out`, spread along `across`: a short
// run-in over the edge, then an arc clear of the rock that widens a little as
// it drops `height`, the middle bulging forward, foaming toward the foot.
function fallSheet(water, lip, out, across, half, height, reach, seed) {
  sheet(water.sheets, water.sheetCoords, [-.1, 0, .05, .14, .28, .46, .66, .84, 1], [-1, -.6, -.2, .2, .6, 1], (t, f) => {
    const drop = Math.max(0, t), forward = t < 0 ? t * 7 : (reach + .3 * (1 - f * f)) * Math.sqrt(drop), spread = half * (1 + .18 * drop) * f;
    return { x: lip.x + out.x * forward + across.x * spread, y: lip.y - drop * height, z: lip.z + out.z * forward + across.z * spread, coord: [t * height, f, smoothstep(.55, 1, drop) * .85, seed] };
  });
}
// Foam spreading from where falling water meets a pool, mostly away from the rock.
function plunge(water, center, out, across, radius, seed) {
  sheet(water.foam, water.foamCoords, [0, .3, .6, 1], [-1.9, -1.2, -.6, 0, .6, 1.2, 1.9], (r, a) => {
    const d = radius * (.2 + r), x = Math.cos(a) * d, z = Math.sin(a) * d;
    return { x: center.x + out.x * x + across.x * z, y: center.y, z: center.z + out.z * x + across.z * z,
      coord: [d * 1.1 + seed, a * 2, (1 - smoothstep(.35, 1, r)) * (1 - smoothstep(1.2, 1.9, Math.abs(a)) * .85)] };
  });
}
// Spray rising from the foot of a fall: two crossed, soft-edged veils.
function spray(water, center, out, across, width, height, seed) {
  for (const dir of [across, out]) sheet(water.mist, water.mistCoords, [0, .35, .7, 1], [-1, -.35, .35, 1], (h, f) => ({
    x: center.x + dir.x * f * width, y: center.y + .2 + h * height, z: center.z + dir.z * f * width,
    coord: [h * 3 + seed, f * 1.5 + seed, Math.sin(h * Math.PI) * (1 - Math.abs(f)) * .95] }));
}

export class JungleChunk {
  constructor(index) {
    this.index = index; this.start = index * CHUNK_LENGTH; this.group = new THREE.Group(); this.group.name = `jungle-chunk-${index}`; this.owned = [];
    this.lips = riverLips(this.start, this.start + CHUNK_LENGTH);
    this.falls = sideFalls(this.start, this.start + CHUNK_LENGTH);
    this.features = { lips: this.lips.map(lip => lip.index) };
    this.discoveries = jungleDiscoveries(this.start-30,this.start+CHUNK_LENGTH+30);
    this.buildTerrain(); this.buildWater(); this.buildMist(); this.buildRoad(); this.buildScenery();
    buildJungleDiscoveries(this,this.discoveries);
    finalizeChunkTransforms(this.group);
  }
  addMesh(geometry, mat, name, shadows = false) {
    const mesh = new THREE.Mesh(geometry, mat); mesh.name = name; mesh.castShadow = shadows; mesh.receiveShadow = true;
    this.group.add(mesh); this.owned.push(geometry); return mesh;
  }
  buildTerrain() {
    const vertices = [], colors = [], ab = new THREE.Vector3(), ac = new THREE.Vector3(), normal = new THREE.Vector3();
    const lips = riverLips(this.start - 24, this.start + CHUNK_LENGTH + 24), falls = sideFalls(this.start - 16, this.start + CHUNK_LENGTH + 16);
    const moss = new THREE.Color('#3d6f30'), brightMoss = new THREE.Color('#4c8238'), litter = new THREE.Color('#6b6541'), damp = new THREE.Color('#34602f');
    const dirt = new THREE.Color('#a89b6f'), verge = new THREE.Color('#6d7e46'), wetRock = new THREE.Color('#4f5550');
    const coolRock = new THREE.Color('#8f877b'), warmRock = new THREE.Color('#aca190'), fracture = new THREE.Color('#665e56'), mossRock = new THREE.Color('#5a7d3c');
    const mud = new THREE.Color('#6e6a4f'), wetStone = new THREE.Color('#8a8477'), bed = new THREE.Color('#2f4d47'), lipRock = new THREE.Color('#7a746b');
    const canopy = ['#2d6a2c', '#367a33', '#3f8a3a', '#28602b', '#4a9440'].map(c => new THREE.Color(c)), farHaze = new THREE.Color('#33604c');
    const light = new THREE.Vector3(-55, 245, 40).normalize();
    const stations = jungleRows(this.start, this.start + CHUNK_LENGTH);
    const coarse = Array.from({ length: CHUNK_LENGTH / JUNGLE_STEP + 1 }, (_, i) => this.start + i * JUNGLE_STEP);
    const columns = jungleColumns(0).map((u, col) => (u >= -95 && u <= -12.5 ? stations : coarse).map(s => jungleVertex(s / JUNGLE_STEP, col)));
    // Each column owns its vertices. Stitch unequal row counts directly so
    // the detailed river meets the coarse hills without cracks or thin strips
    // running all the way to the edge of the scene.
    for (let col = 0; col < JUNGLE_COLUMN_COUNT - 1; col++) {
      const left = columns[col], right = columns[col + 1];
      let li = 0, ri = 0;
      while (li < left.length - 1 || ri < right.length - 1) {
        const a = left[li], c = right[ri], b = left[li + 1], d = right[ri + 1];
        const row = Math.floor(Math.min(a.s, c.s) / JUNGLE_STEP);
        let tris;
        if (b && d && b.s === d.s) {
          tris = (row + col) % 2 ? [[a, b, c], [b, d, c]] : [[a, b, d], [a, d, c]];
          li++; ri++;
        } else if (b && (!d || b.s < d.s)) { tris = [[a, b, c]]; li++; }
        else { tris = [[a, d, c]]; ri++; }
        tris.forEach((tri, i) => {
          ab.set(tri[1].x - tri[0].x, tri[1].y - tri[0].y, tri[1].z - tri[0].z); ac.set(tri[2].x - tri[0].x, tri[2].y - tri[0].y, tri[2].z - tri[0].z);
          normal.crossVectors(ab, ac).normalize(); if (normal.y < 0) normal.negate();
          const facet = randomAt(row * 2 + i, col + 2381);
          const s = (tri[0].s + tri[1].s + tri[2].s) / 3, u = (tri[0].u + tri[1].u + tri[2].u) / 3, y = (tri[0].y + tri[1].y + tri[2].y) / 3;
          const cross = Math.abs(u), fromWater = Math.abs(u - riverCenter(s)) - riverHalfWidth(s);
          const exposure = Math.max(0, normal.dot(light)), steep = normal.y < .6, crag = jungleCrags(s, u);
          let color;
          if (u < 0 && fromWater < 0) {
            // Grey rock shows through the churn at each lip; elsewhere the bed is dark.
            color = (lips.some(lip => Math.abs(s - lip.s) < 9) ? lipRock : bed).clone();
          } else if (u < 0 && steep && falls.some(fall => Math.abs(s - fall.s) < fall.width * .8 && u > riverCenter(fall.s) + riverHalfWidth(fall.s))) {
            // The rock behind a side fall is dark and wet, with no moss.
            color = wetRock.clone().lerp(fracture, jungleNoise(s, u, 2, 2389) * .5);
          } else if (u < 0 && fromWater < 4.6) {
            color = mud.clone().lerp(wetStone, jungleNoise(s, u, 5, 2382));
            if (normal.y > .8) color.lerp(mossRock, .35 * jungleNoise(s, u, 3, 2383) + .15);
          } else if (cross <= 9.6) {
            color = dirt.clone().lerp(verge, smoothstep(.35, .7, jungleNoise(s, u, 7, 2384)) * .8 + smoothstep(7.5, 9.6, cross) * .3);
          } else if (steep || (crag > 2.5 && normal.y < .74) || (u > 9.6 && u < 15.5 && cutHeight(s) > 2.2 && normal.y < .74)) {
            color = fracture.clone().lerp(coolRock, smoothstep(.05, .45, exposure));
            color.lerp(warmRock, smoothstep(.5, .95, exposure) * .7);
            color.lerp(mossRock, smoothstep(.45, .8, normal.y) * (.3 + .5 * jungleNoise(s, u, 6, 2385)));
            if (u < 0) color.lerp(mossRock, smoothstep(.4, .8, jungleNoise(s, u, 11, 2390)) * .65);
          } else if (cross > (u < 0 ? 100 : 130)) {
            // Beyond the instanced trees the bumpy terrain itself reads as treetops.
            // The visible foreground is forest floor: color it in cohesive
            // patches so neighboring triangles do not form a bright/dark mosaic.
            color = u < 0 ? canopy[1].clone().lerp(canopy[2], jungleNoise(s, u, 26, 2392))
              : canopy[Math.floor(facet * canopy.length)].clone().multiplyScalar(.8 + .25 * smoothstep(-2.5, 2.5, y - jungleHeight(s, u)));
            if (u > 0) color.lerp(farHaze, smoothstep(190, 340, u) * .7);
          } else {
            const patch = jungleNoise(s, u, 23, 2386), fine = jungleNoise(s, u, 6, 2387);
            color = moss.clone().lerp(brightMoss, fine);
            color.lerp(litter, smoothstep(.6, .82, patch) * .55);
            if (u < 0) color.lerp(damp, .35 * (1 - smoothstep(4, 14, fromWater)));
          }
          color.multiplyScalar(.94 + facet * .12);
          triangle(vertices, colors, ...tri, color, this.start);
        });
      }
    }
    this.terrain = this.addMesh(geometryFrom(vertices, colors), terrainMaterial, 'jungle-floor', true);
    this.sampleGround = terrainSampler(this.terrain);
  }
  // All water in a chunk shares four meshes: the river and streams, the falling
  // sheets, foam, and spray and haze.
  buildWater() {
    const water = { surface: [], colors: [], coords: [], sheets: [], sheetCoords: [], foam: [], foamCoords: [], mist: [], mistCoords: [] };
    this.buildRiver(water); this.buildCascades(water); this.buildStreams(water);
    const river = geometryFrom(water.surface, water.colors); river.setAttribute('riverCoord', new THREE.Float32BufferAttribute(water.coords, 3)); river.boundingSphere.radius += 1;
    this.addMesh(river, riverMaterial, 'jungle-river');
    if (water.sheets.length) {
      const falls = geometryFrom(water.sheets); falls.setAttribute('fallCoord', new THREE.Float32BufferAttribute(water.sheetCoords, 4)); falls.boundingSphere.radius += 1;
      this.addMesh(falls, fallMaterial, 'waterfalls');
    }
    if (water.foam.length) {
      const foam = geometryFrom(water.foam); foam.setAttribute('foamCoord', new THREE.Float32BufferAttribute(water.foamCoords, 3)); foam.boundingSphere.radius += 1;
      this.addMesh(foam, foamMaterial, 'cascade-foam');
    }
    const haze = geometryFrom(water.mist); haze.setAttribute('foamCoord', new THREE.Float32BufferAttribute(water.mistCoords, 3)); haze.boundingSphere.radius += 2;
    this.addMesh(haze, mistMaterial, 'river-mist');
  }
  buildRiver(water) {
    const across = [1, .82, .5, .17, -.17, -.5, -.82, -1], color = new THREE.Color();
    const shallow = new THREE.Color('#68c8b9'), deep = new THREE.Color('#278f99');
    // The surface runs under both bank rims, and under a gorge wall right to the cliff foot.
    const at = (s, k) => {
      const f = across[k], u = riverCenter(s) + f * riverHalfWidth(s) + (k === 0 ? 1.05 + 3.3 * gorgeWall(s) : k === across.length - 1 ? -1.05 : 0);
      const p = positionAt(s, u, riverLevel(s, f));
      return { x: p.x, y: p.y, z: p.z + this.start, s, f, turbulence: riverTurbulence(s) };
    };
    for (let s = this.start; s < this.start + CHUNK_LENGTH; s += RIVER_STEP) for (let k = 0; k < across.length - 1; k++) {
      const a = at(s, k), b = at(s + RIVER_STEP, k), c = at(s, k + 1), d = at(s + RIVER_STEP, k + 1);
      for (let tri of (k % 2 ? [[a, b, c], [b, d, c]] : [[a, b, d], [a, d, c]])) {
        const [p, q, r] = tri;
        if ((q.z - p.z) * (r.x - p.x) - (q.x - p.x) * (r.z - p.z) < 0) tri = [p, r, q];
        for (const v of tri) {
          water.surface.push(v.x, v.y, v.z);
          color.copy(shallow).lerp(deep, Math.pow(1 - Math.min(1, Math.abs(v.f)), .7));
          // Streaks drift toward -s, the way the water runs.
          water.colors.push(color.r, color.g, color.b); water.coords.push(-v.s, v.f, v.turbulence);
        }
      }
    }
    for (const rock of riverRocks(this.start, this.start + CHUNK_LENGTH)) {
      // Two thin wakes part around each stone and dissolve into the current.
      for (const side of [-1, 1]) sheet(water.foam, water.foamCoords, [0, .2, .55, 1], [-1, 0, 1], (t, f) => {
        const s = rock.s - t * (4 + rock.size * 2), width = rock.size * (.6 + t * .8);
        const u = rock.u + side * width + f * (.12 + t * .26), p = positionAt(s, u, riverLevel(s) + .07);
        return { x: p.x, y: p.y, z: p.z + this.start, coord: [t * 4 + rock.seed, side + f, (1 - t) * (1 - Math.abs(f)) * .72] };
      });
    }
    // Humid haze hangs low over the whole river.
    const rows = Array.from({ length: CHUNK_LENGTH / 8 + 1 }, (_, i) => this.start + i * 8);
    sheet(water.mist, water.mistCoords, rows, [-1.35, -.5, .5, 1.35], (s, f) => {
      const p = positionAt(s, riverCenter(s) + f * riverHalfWidth(s), riverLevel(s) + 1.6);
      return { x: p.x, y: p.y, z: p.z + this.start, coord: [s * .5, f, .18 * (1 - Math.abs(f) / 1.35)] };
    });
  }
  // Each lip pours a sheet toward -s, straight at the camera, into a churning pool.
  buildCascades(water) {
    const edge = f => 1 - smoothstep(.72, 1.02, Math.abs(f));
    for (const lip of this.lips) {
      if (lip.drop < .6) continue;
      const hw = riverHalfWidth(lip.s), rc = riverCenter(lip.s), { along, across } = frameAt(lip.s, rc), out = along.clone().negate();
      const spot = (s, f, y) => { const p = positionAt(s, riverCenter(s) + f * riverHalfWidth(s), y); return { x: p.x, y: p.y, z: p.z + this.start }; };
      sheet(water.sheets, water.sheetCoords, [-.12, 0, .06, .18, .36, .6, .82, 1], [-1, -.8, -.55, -.3, 0, .3, .55, .8, 1], (t, f) => {
        const drop = Math.max(0, t), forward = t < 0 ? t * 5 : (RIVER_STEP + .45 + .25 * Math.cos(f * 5 + lip.index)) * Math.sqrt(drop);
        const s = lip.s + riverLipOffset(lip.index, f) - forward;
        return { ...spot(s, f * (1 + .035 * drop), lip.upper + .065 - drop * (lip.drop + .08)), coord: [t * lip.drop, f, smoothstep(.5, 1, drop) * .8, lip.index * 1.37] };
      });
      const fs = [-1.02, -.6, -.2, .2, .6, 1.02], reach = 11 + Math.min(10, lip.drop * 1.2);
      // Churn spreading downstream from the foot, and a light drawing-in above the lip.
      sheet(water.foam, water.foamCoords, [RIVER_STEP + .4, 4, 7, 11, reach], fs, (d, f) => ({ ...spot(lip.s - d, f, lip.lower + .1), coord: [d * .35 + lip.drop * .5, f, (1 - smoothstep(3, reach, d)) * edge(f)] }));
      sheet(water.foam, water.foamCoords, [-3.5, -1.2, 0], fs, (d, f) => ({ ...spot(lip.s + riverLipOffset(lip.index, f) - d, f, lip.upper + .1), coord: [d * .3, f, .4 * (1 - smoothstep(0, 3.5, -d)) * edge(f)] }));
      if (lip.drop > 2) {
        sheet(water.mist, water.mistCoords, [1, 4, 7, 10], [-1.3, -.45, .45, 1.3], (d, f) => ({ ...spot(lip.s - d, f, lip.lower + 1.2 + Math.min(3, lip.drop * .35)),
          coord: [d, f, Math.sin((d - 1) / 9 * Math.PI) * (1 - Math.abs(f) / 1.3) * Math.min(1, lip.drop / 5)] }));
        spray(water, spot(lip.s - 3, 0, lip.lower), out, across, hw * .85, 1 + Math.min(4, lip.drop * .45), lip.index);
      }
    }
  }
  // Every side fall has a whole stream: a creek down the far hillside to the
  // culvert, a meander across the terrace, a fall down the gorge wall, and
  // foam and spray where it meets the river.
  buildStreams(water) {
    const calm = new THREE.Color('#3fa99c'), white = new THREE.Color('#8fd9cb'), color = new THREE.Color(), ab = new THREE.Vector3(), ac = new THREE.Vector3();
    const groundAt = (s, u, half) => {
      let y = -Infinity;
      for (const ds of [-half, 0, half]) { const q = positionAt(s + ds, u); y = Math.max(y, this.sampleGround(q.x, q.z + this.start) ?? jungleHeight(s + ds, u)); }
      return y;
    };
    // An upward-facing ribbon through path points { s, u, y, half, turbulence }; the flow runs toward -u.
    const ribbon = path => {
      const cols = [-1, -.35, .35, 1];
      const point = (p, f) => {
        const q = p.center ? {x:p.center.x+p.across.x*f*p.half, y:p.y, z:p.center.z+p.across.z*f*p.half}
          : positionAt(p.s + f * p.half, p.u, p.y);
        return { x: q.x, y: q.y, z: q.z + this.start, coord: [-p.u, f * .45, p.turbulence] };
      };
      for (let i = 0; i < path.length - 1; i++) for (let j = 0; j < cols.length - 1; j++) {
        const a = point(path[i], cols[j]), b = point(path[i + 1], cols[j]), c = point(path[i], cols[j + 1]), d = point(path[i + 1], cols[j + 1]);
        for (let [p, q, r] of [[a, b, c], [b, d, c]]) {
          ab.set(q.x - p.x, q.y - p.y, q.z - p.z); ac.set(r.x - p.x, r.y - p.y, r.z - p.z);
          if (ab.cross(ac).y < 0) [q, r] = [r, q];
          for (const v of [p, q, r]) { water.surface.push(v.x, v.y, v.z); water.coords.push(...v.coord); color.copy(calm).lerp(white, v.coord[2]); water.colors.push(color.r, color.g, color.b); }
        }
      }
    };
    for (const fall of this.falls) {
      const { s, width } = fall, rc = riverCenter(s), hw = riverHalfWidth(s), level = riverLevel(s), rim = rc + hw + 7, half = width / 2;
      const top = Math.max(jungleHeight(s,rim)+.4,groundAt(s,rim+.6,streamHalfWidth(fall,rim+.6))+.16);
      const { along, across } = frameAt(s, rim), out = across.clone().negate(), lip = positionAt(s, rim - 1, top);
      // The creek starts as a trickle among stones and gathers toward the road, whitening where it tumbles.
      const length = creekLength(fall), creek = [];
      for (let k = 0, steps = Math.ceil(length / 1.25); k <= steps; k++) {
        const u = 10.35 + length * (1 - k / steps), t = k / steps, shift = streamShift(fall, u), y = groundAt(s + shift, u, .9) + .14;
        const turbulence = creek.length ? Math.min(.8, Math.max(.05, (creek[creek.length - 1].y - y) * .45)) : .05;
        creek.push({ s: s + shift, u, y, half: lerp(.35, .95, t), turbulence });
      }
      ribbon(creek);
      const stream = [];
      for (let u = -10.35; u > rim + .6; u -= 1.25) {
        const shift = streamShift(fall, u),spread=streamHalfWidth(fall,u),gather=1-smoothstep(rim+.6,rim+9,u);
        const floor=groundAt(s+shift,u,spread)+.16;
        stream.push({ s:s+shift,u,y:lerp(floor,Math.max(floor,top),1-smoothstep(rim+.6,rim+3,u)),
          half:spread,turbulence:lerp(.06,.38,gather) });
      }
      // Share the exact back edge of the falling sheet: same center, width,
      // height and crosswise direction, even where the road bends.
      stream.push({s,u:rim-.3,y:top,half,turbulence:.42,across:along,
        center:{x:lip.x-out.x*.7,z:lip.z-out.z*.7}});
      ribbon(stream);
      const lipPoint = { x: lip.x, y: lip.y, z: lip.z + this.start }, height = top - level + .05, reach = 2.8 + height * .04;
      fallSheet(water, lipPoint, out, along, half, height, reach, s * .173);
      const foot = { x: lipPoint.x + out.x * (reach + .3), y: level + .09, z: lipPoint.z + out.z * (reach + .3) };
      plunge(water, foot, out, along, half * 1.25 + 1.8, s * .31);
      spray(water, foot, out, along, half * 1.1, 1.2 + height * .3, s * .07);
    }
  }
  ribbon(ranges, lift, mat, name) {
    const vertices = [];
    for (const [low, high] of ranges) for (let s = this.start; s < this.start + CHUNK_LENGTH; s += 2) {
      const at = (t, u) => positionAt(t, u, roadHeight(t) + lift);
      const a = at(s, low), b = at(s + 2, low), c = at(s, high), d = at(s + 2, high);
      triangle(vertices, null, a, b, c, null, this.start); triangle(vertices, null, b, d, c, null, this.start);
    }
    this.addMesh(geometryFrom(vertices), mat, name);
  }
  buildRoad() {
    this.ribbon([[-6.4, 6.4]], .045, shoulderMaterial, 'road-shoulders');
    this.ribbon([[-5.5, 5.5]], .075, roadMaterial, 'jungle-road');
    this.ribbon([[-5.05, -4.9], [4.9, 5.05]], .09, edgeMaterial, 'road-edges');
    this.ribbon([[-.31, -.19], [.19, .31]], .093, centerMaterial, 'center-lines');
  }
  buildScenery() {
    const random = seededRandom(this.index + 77113);
    const trunks = [], crowns = jungleCrowns.map(() => []), farCrowns = jungleCrowns.map(() => []), emergents = emergentTrunks.map(() => []), emergentTops = emergentCrowns.map(() => []), vines = [];
    const palmTrunks = junglePalms.map(() => []), palmFronds = junglePalms.map(() => []), ferns = [], leaves = [], bananas = [], bamboos = [], shrubs = [], forestShrubs = [], tufts = [], lumps = [], lilies = [];
    const boulders = jungleBoulders.map(() => []), cliffs = cliffBlocks.map(() => []), rails = [], railPosts = [], logs = [];
    const crownColors = ['#2c6429', '#33742f', '#3d8236', '#47903a', '#295c2a', '#529c40', '#397a33', '#3c8a3c'];
    const darkCrowns = ['#275727', '#2c642c', '#224f24', '#31692e'], sunlitCrowns = ['#4d9440', '#57a047', '#3f8a38', '#5aa64a'];

    const palmColors = ['#4f9a3a', '#5ca744', '#438f36', '#6bb04c'], fernColors = ['#4b8f3a', '#5a9c44', '#3f7f33', '#69a84d'], leafColors = ['#3f8a3a', '#4d9842', '#367a33'];
    const bananaColors = ['#4f9d3c', '#5dab45', '#6ab94e', '#468f38'], bambooColors = ['#86a845', '#7a9e3f', '#98b04e', '#6f9a3c'], lilyColors = ['#4f8f3a', '#5b9b40', '#467f35'];
    const vineColors = ['#5b9239', '#6aa244', '#4f8733'], shrubColors = ['#3f7a34', '#4a8a3b', '#357030', '#5b9a44'], stoneTints = ['#e6e9e2', '#d5dbd3', '#f0f2ec', '#c9d1c8'];
    const pick = list => list[Math.floor(random() * list.length)];
    const ground = (s, u) => { const p = positionAt(s, u); return { x: p.x, y: this.sampleGround(p.x, p.z + this.start) ?? jungleHeight(s, u), z: p.z + this.start }; };
    const slope = (s, u) => Math.hypot(jungleHeight(s, u + 1) - jungleHeight(s, u - 1), jungleHeight(s + 1, u) - jungleHeight(s - 1, u)) / 2;
    // Near-side scenery must stay below the camera's line of sight to the road;
    // farther out and lower down on the slope there is more headroom.
    const headroom = (s, u, y) => u > 0 ? 60 : Math.max(0, -u * .78 - 4 + Math.max(0, roadHeight(s) - y) * .8);
    // Streams keep their channels clear, and nothing hangs in front of a fall.
    const falls = sideFalls(this.start - 16, this.start + CHUNK_LENGTH + 16);
    const inStream = (s, u, margin = 0) => falls.some(f => Math.abs(s - f.s - streamShift(f, u)) < (u < 0 ? f.width * .6 : 1.4) + margin &&
      (u < 0 ? u < -9.6 && u > riverCenter(f.s) + riverHalfWidth(f.s) : u > 9.6 && u < 11.5 + creekLength(f)));
    const nearFall = (s, u, r) => falls.some(f => Math.abs(s - f.s) < f.width * .6 + r && u < -9.6 && u > riverCenter(f.s) + riverHalfWidth(f.s) - 3);
    const discoveryClear = (s,u,radius=0) => jungleDiscoveryClears(s,u,this.discoveries,radius);
    const open = (s, u, margin = 0) => Math.abs(u) > 9.6 + margin && !onRiver(s, u, 1.5 + margin) && !inStream(s, u, .6 + margin) && discoveryClear(s,u,margin);
    const spots = [];
    const clear = (s, u, r) => discoveryClear(s,u,r) && spots.every(spot => Math.hypot(spot.s - s, spot.u - u) > spot.r + r);
    const vine = (s, u, top, length) => {
      if (!discoveryClear(s,u,2)) return;
      if (Math.abs(u) < 9.8 || nearFall(s, u, 1.5)) return;
      const p = positionAt(s, u), floor = jungleHeight(s, u);
      length = Math.min(length, top - floor - 1);
      if (length < 1.5) return;
      vines.push({ p: [p.x, top, p.z + this.start], scale: [.9 + random() * .5, length, .9 + random() * .5], r: [0, random() * 6.28, 0], color: pick(vineColors) });
    };

    const tree = (s, u, height, palette) => {
      if (!discoveryClear(s,u,height*.55)) return;
      const p = ground(s, u), width = height * (.4 + random() * .18);
      trunks.push({ p: [p.x, p.y + height * .3, p.z], scale: [height * .045, height * .62, height * .045] });
      solidPost(this, p.x, p.z, height * .045 * .72);
      // Crowns deep in the forest skip the shadow pass; their shade lands on other canopy anyway.
      (Math.abs(u) > 70 ? farCrowns : crowns)[Math.floor(random() * crowns.length)].push({ p: [p.x, p.y + height * .42, p.z], scale: [width, height * .58, width], r: [0, random() * 6.28, 0], color: pick(palette) });
      spots.push({ s, u, r: width * .45 });
      if (height > 10 && Math.abs(u) < 90 && random() < .4) for (let i = 0, count = 2 + Math.floor(random() * 3); i < count; i++) {
        const a = random() * 6.28, r = width * (.45 + random() * .4);
        vine(s + Math.sin(a) * r, u + Math.cos(a) * r, p.y + height * .55, height * (.2 + random() * .25));
      }
    };
    const emergent = (s, u, height, lean) => {
      if (!discoveryClear(s,u,height*.65)) return;
      const p = ground(s, u), width = height * (.36 + random() * .1), angle = random() * 6.28;
      const tallHeight = Math.min(height + Math.max(0, height - 28) * 2, headroom(s, u, p.y));
      const trunk = Math.floor(random() * emergents.length);
      emergents[trunk].push({ p: [p.x, p.y - .1, p.z], scale: [height, tallHeight, height], r: [0, angle, 0] });
      solidModel(this, emergentTrunks[trunk], [p.x, p.y, p.z], angle, height, true);
      const crownLean = lean * .25, c = positionAt(s, u - crownLean), top = p.y + tallHeight * .78;
      emergentTops[Math.floor(random() * emergentTops.length)].push({ p: [c.x, top, c.z + this.start], scale: [width, width, width], r: [0, angle, 0], color: pick(sunlitCrowns) });
      spots.push({ s, u, r: width * .6 });
      // Curtains of lianas hang from the rim of the crown, some almost to the floor.
      for (let i = 0, count = 8 + Math.floor(random() * 7); i < count; i++) {
        const a = random() * 6.28, r = width * (.45 + random() * .5);
        vine(s + Math.sin(a) * r, u - crownLean + Math.cos(a) * r, top + width * .06, 3 + random() * 11);
      }
    };
    const palm = (s, u, height) => {
      if (!discoveryClear(s,u,height*.55)) return;
      const p = ground(s, u), w = height * .8, angle = random() * 6.28, variant = Math.floor(random() * junglePalms.length);
      palmTrunks[variant].push({ p: [p.x, p.y - .1, p.z], scale: [w, height, w], r: [0, angle, 0] });
      solidModel(this, junglePalms[variant].trunk, [p.x, p.y, p.z], angle, w, true);
      palmFronds[variant].push({ p: [p.x, p.y - .1, p.z], scale: [w, height, w], r: [0, angle, 0], color: pick(palmColors) });
      spots.push({ s, u, r: 1.2 });
    };
    const stone = (s, u, size, mossy, lift = null) => {
      if (!discoveryClear(s,u,size)) return;
      const p = ground(s, u), variant = mossy ? 1 + Math.floor(random() * 2) : Math.floor(random() * 2);
      boulders[variant].push({ p: [p.x, lift ?? p.y + size * .28, p.z], scale: [size * (.8 + random() * .5), size * (.55 + random() * .55), size * (.7 + random() * .5)], r: [(random() - .5) * .4, random() * 6.28, (random() - .5) * .4], color: pick(stoneTints) });
    };
    // A column of rock standing on base; vines hang down the face turned to the camera.
    const rock = (s, u, base, height, width, depth, vineCount = 0, yaw = null) => {
      if (!discoveryClear(s,u,Math.max(width,depth)*.7)) return;
      if (height < 1) return;
      const p = positionAt(s, u);
      cliffs[Math.floor(random() * cliffs.length)].push({ p: [p.x, base, p.z + this.start], scale: [width, height, depth], r: [(random() - .5) * .08, yaw ?? random() * 6.28, (random() - .5) * .08], color: pick(stoneTints) });
      for (let i = 0; i < vineCount; i++) vine(s + (random() - .5) * width * .6, u - depth * .5, base + height * (.9 + random() * .08), height * (.3 + random() * .45));
    };
    const plant = (list, p, size, colors, stretch = 1) => list.push({ p: [p.x, p.y, p.z], scale: [size, size * stretch, size], r: [0, random() * 6.28, 0], color: pick(colors) });
    const clump = (s, u, height) => { const p = ground(s, u); plant(bamboos, { ...p, y: p.y - .2 }, height * .85, bambooColors, 1.18); spots.push({ s, u, r: height * .16 }); };
    // Uneven groups of embedded slabs break through the bank, with open mossy
    // slopes between them. Broad bases and overlapping shelves avoid a row of pillars.
    for (let cell = Math.floor(this.start / 31) - 1; cell <= Math.floor((this.start + CHUNK_LENGTH) / 31); cell++) {
      const s = cell * 31 + 4 + randomAt(cell, 2521) * 23;
      if (s < this.start || s >= this.start + CHUNK_LENGTH || randomAt(cell, 2522) < .24) continue;
      const wall = gorgeWall(s), rc = riverCenter(s), hw = riverHalfWidth(s), rim = rc + hw + 7, level = riverLevel(s);
      const face = jungleHeight(s, rim) - level, u = rim - 1.5, width = 8 + randomAt(cell, 2523) * 10;
      if (wall < .35 || nearFall(s, u, width * .6)) continue;
      const height = face * (.7 + randomAt(cell, 2524) * .45), { across } = frameAt(s, u), yaw = -Math.atan2(across.z, across.x);
      rock(s, u, level - 2, height + 2, 6 + random() * 3, width, 2, yaw + (random() - .5) * .3);
      const side = random() < .5 ? -1 : 1, shelfS = s + side * width * .4, shelfU = u - 1.5 - random() * 1.5;
      if (!nearFall(shelfS, shelfU, width * .35)) {
        rock(shelfS, shelfU, level - 1.5, height * (.28 + random() * .3) + 1.5, 5 + random() * 3, width * .65, 1, yaw - side * .3);
        for (let i = 0; i < 4; i++) stone(shelfS + (random() - .5) * width, rc + hw + random() * 3, .8 + random() * 1.8, true);
      }
      // Plant on the actual terrain beside each exposed mass, never on an
      // assumed flat top of a faceted rock.
      for (let i = 0; i < 5; i++) {
        const t = s + (random() - .5) * width * 1.4, cross = rim + 1.5 + random() * 3;
        if (!inStream(t, cross, 1)) plant(random() < .7 ? ferns : bananas, ground(t, cross), .9 + random() * 1.1, fernColors);
      }
      spots.push({ s, u: rim, r: 3.5 });
    }
    // Rocks frame each side fall at the lip and at its foot; culverts carry the
    // stream under the road, and stones line the creek and the terrace stream.
    for (const fall of this.falls) {
      const { s, width } = fall, rc = riverCenter(s), hw = riverHalfWidth(s), level = riverLevel(s), rim = rc + hw + 7, top = jungleHeight(s, rim), half = width / 2;
      for (const side of [-1, 1]) {
        const w = 2.6 + random() * 1.2, offset = half * 1.12 + w * .5 - .4;
        rock(s + side * offset, rim - 1, top - 1.5, 2.6 + random() * 2, w, 2.8, 0);
        rock(s + side * (offset + .3), rc + hw + 2.2, level - 1.4, (top - level) * (.72 + random() * .22) + 1.4, w + .8, 3.2, 0);
        const a = positionAt(s - 1, side * 10), b = positionAt(s + 1, side * 10), yaw = Math.atan2(b.x - a.x, b.z - a.z), y = roadHeight(s);
        const wallAt = positionAt(s, side * 10.05, y - .5), mouth = positionAt(s, side * 10.3, y - .62);
        rails.push({ p: [wallAt.x, wallAt.y, wallAt.z + this.start], scale: [.45, 1.1, 3.2], r: [0, yaw, 0] });
        railPosts.push({ p: [mouth.x, mouth.y, mouth.z + this.start], scale: [.08, .5, 1.3], r: [0, yaw, 0] });
      }
      const length = creekLength(fall);
      for (let u = -11.5; u > rim + 1; u -= 1.6 + random() * 1.4) {
        const shift = streamShift(fall, u);
        stone(s + shift + (random() > .5 ? 1 : -1) * (streamHalfWidth(fall,u)+.4+random()*.6), u, .5 + random() * .6, true);
        spots.push({ s: s + shift, u, r: 1.8 });
      }
      for (let u = 12; u < 10.35 + length; u += 1.8 + random() * 1.6) {
        const shift = streamShift(fall, u), t = (u - 10.35) / length;
        stone(s + shift + (random() > .5 ? 1 : -1) * (lerp(1.3, .7, t) + random() * .5), u, .4 + random() * .7, true);
        if (random() < .5) plant(ferns, ground(s + shift + (random() > .5 ? 1 : -1) * (2 + random()), u), .8 + random() * .6, fernColors);
        spots.push({ s: s + shift, u, r: 1.6 });
      }
      for (let i = 0; i < 3; i++) stone(s + streamShift(fall, 10.35 + length) + (random() - .5) * 3, 10.8 + length + random() * 1.5, .9 + random() * .8, true);
    }
    // Lily pads also gather in calm water near the banks.
    for (let i = 0; i < 24; i++) {
      const s = this.start + random() * CHUNK_LENGTH, hw = riverHalfWidth(s);
      if (riverTurbulence(s) > .02) continue;
      const p = positionAt(s, riverCenter(s) + (random() > .5 ? 1 : -1) * hw * (.6 + random() * .35), riverLevel(s) + .04), size = .4 + random() * .5;
      lilies.push({ p: [p.x, p.y, p.z + this.start], scale: [size, 1, size], r: [0, random() * 6.28, 0], color: pick(lilyColors) });
    }
    // Mossy crags break through the forest as blocky outcrops.
    for (let i = 0; i < 40; i++) {
      const s = this.start + random() * CHUNK_LENGTH, u = (random() > .5 ? 1 : -1) * (26 + random() * 120);
      const crag = jungleCrags(s, u);
      if (crag < 4 || slope(s, u) < .6 || !clear(s, u, 1)) continue;
      const p = ground(s, u), size = 2.6 + random() * 3.2;
      rock(s, u, p.y - 1.8, 3 + crag * (.25 + random() * .25), size, size * (.7 + random() * .4), random() < .5 ? 1 : 0);
      spots.push({ s, u, r: size * .55 });
    }
    // Emergent giants beside the road throw their crowns and shadows across it;
    // in the giant stretches they stand close enough to roof the road over.
    for (let k = 0; k < 7; k++) {
      const s = this.start + 4 + k * 18 + random() * 12, u = 10.5 + random() * 5, giants = jungleZones(s).giants;
      if (random() > (k % 2 ? .1 : .7) + giants * .85 || slope(s, u) > 2.2 || !open(s, u) || !clear(s, u, 3)) continue;
      emergent(s, u, 24 + random() * 9 + giants * 4, 3 + random() * 3);
    }
    for (let i = 0; i < 10; i++) {
      const s = this.start + random() * CHUNK_LENGTH, u = i < 7 ? 40 + random() * 85 : -100 - random() * 50;
      if (i >= 4 && i < 7 && random() > .25 + jungleZones(s).giants) continue;
      const p = ground(s, u), height = Math.min(22 + random() * 10, headroom(s, u, p.y));
      if (height < 16 || !open(s, u) || slope(s, u) > 2 || !clear(s, u, 6)) continue;
      emergent(s, u, height, 0);
    }
    for (let i = 0; i < 360; i++) {
      const s = this.start + random() * CHUNK_LENGTH, u = 11 + random() ** 1.35 * 128, zones = jungleZones(s);
      const grove = jungleNoise(s, u, 29, 2271);
      // Palm groves and bamboo thickets push the broadleaf trees back from the road.
      if (u < 50 && random() < zones.palms * .6 + zones.bamboo * .45) continue;
      if (random() > .3 + grove * .8 || !open(s, u) || slope(s, u) > 1.9 || (jungleCrags(s, u) > 3 && slope(s, u) > 1.2) || !clear(s, u, 1)) continue;
      tree(s, u, (5.5 + random() ** 1.2 * 10) * (1 - smoothstep(60, 130, u) * .35) * (1 + zones.giants * .25), grove > .6 ? darkCrowns : crownColors);
    }
    for (let i = 0; i < 90; i++) {
      const s = this.start + random() * CHUNK_LENGTH, bankTop = riverCenter(s) + riverHalfWidth(s) + 4;
      const u = lerp(-11.5, bankTop + .5, random()), p = ground(s, u);
      const height = Math.min(headroom(s, u, p.y), 5 + random() * 7);
      if (height < 3.8 || slope(s, u) > 2.3 || !open(s, u) || !clear(s, u, 1)) continue;
      tree(s, u, height, crownColors);
    }
    for (let i = 0; i < 260; i++) {
      const s = this.start + random() * CHUNK_LENGTH, farTop = riverCenter(s) - riverHalfWidth(s) - 4;
      const u = i < 190 ? farTop - 4 - random() ** 1.2 * 78 : -135 - random() * 125;
      const p = ground(s, u);
      // Trees on the camera-side bank stay short near the water so the river and gorge wall show.
      const height = Math.min(headroom(s, u, p.y), i < 190 ? 2.5 + (farTop - u) * .45 : 30, 5.5 + random() * 10);
      if (height < 3.8 || slope(s, u) > 2.1 || !open(s, u) || !clear(s, u, .6)) continue;
      tree(s, u, height, jungleNoise(s, u, 29, 2271) > .6 ? darkCrowns : crownColors);
    }
    for (let i = 0; i < 70; i++) {
      const s = this.start + random() * CHUNK_LENGTH, u = 130 + random() * 130;
      if (slope(s, u) > 2.4 || !clear(s, u, 2)) continue;
      tree(s, u, 9 + random() * 7, darkCrowns);
    }
    // Cheap single-lobe crowns texture the distant hills and fill steep gaps between the trees.
    for (let i = 0; i < 500; i++) {
      const near = i >= 270, s = this.start + random() * CHUNK_LENGTH;
      const u = near ? 16 + random() * 114 : (random() > .35 ? 1 : -1) * (105 + random() * 190);
      if (near ? !open(s, u, 1) || (slope(s, u) < 1.3 && random() < .7) : u > 0 && u < 130) continue;
      const p = ground(s, u), size = near ? 2.2 + random() * 2.6 : 4 + random() * 5;
      lumps.push({ p: [p.x, p.y + size * .2, p.z], scale: [size, size * .8, size], r: [0, random() * 6.28, 0], color: pick(darkCrowns) });
    }
    // Palms crowd the far verge and both riverbanks, far more thickly in the palm groves.
    for (let i = 0; i < 190; i++) {
      const s = this.start + random() * CHUNK_LENGTH, rc = riverCenter(s), hw = riverHalfWidth(s), kind = random(), palms = jungleZones(s).palms;
      if (random() > .5 + palms * .5) continue;
      const u = kind < .3 ? rc + hw + 5 + random() * 9 : kind < .5 ? rc - hw - 3 - random() * 12 : kind < .78 ? 10.5 + random() * (8 + palms * 30) : kind < .9 ? -12 - random() * 6 : 18 + random() * 60;
      const p = ground(s, u), height = Math.min(headroom(s, u, p.y), 7 + random() * (6 + palms * 4));
      if (height < 4.5 || slope(s, u) > 2.4 || !open(s, u) || !clear(s, u, 1.5)) continue;
      palm(s, u, height);
    }
    // Bamboo thickets lean over the verges and banks in their own stretches.
    for (let i = 0; i < 60; i++) {
      const s = this.start + random() * CHUNK_LENGTH, bamboo = jungleZones(s).bamboo, kind = random();
      if (random() > .02 + bamboo * .95) continue;
      const u = kind < .45 ? 11.5 + random() * 14 : kind < .7 ? -12 - random() * 12 : kind < .85 ? riverCenter(s) - riverHalfWidth(s) - 3 - random() * 8 : 25 + random() * 45;
      const p = ground(s, u), height = Math.min(headroom(s, u, p.y) * 1.05, 8 + random() * 6);
      if (height < 4 || slope(s, u) > 2.2 || !open(s, u, .5) || !clear(s, u, 1)) continue;
      clump(s, u, height);
    }
    // The terrace above the wall is thick with undergrowth, palms and banana plants.
    for (let i = 0; i < 60; i++) {
      const s = this.start + random() * CHUNK_LENGTH;
      if (gorgeWall(s) < .4) continue;
      const u = lerp(-10.8, riverCenter(s) + riverHalfWidth(s) + 9, random()), p = ground(s, u), kind = random(), room = headroom(s, u, p.y);
      if (slope(s, u) > 1.8 || !open(s, u, .6)) continue;
      if (kind < .4) { const size = Math.min(1.2 + random() * 1.4, room * .7); shrubs.push({ p: [p.x, p.y + size * .3, p.z], scale: [size, size * .7, size * .9], r: [0, random() * 6.28, .1], color: pick(shrubColors) }); }
      else if (kind < .75 && room > 2) plant(bananas, p, Math.min(1.8 + random() * 1.4, room), bananaColors);
      else plant(ferns, p, .9 + random() * .8, fernColors);
    }
    // Ferns, broad leaves, banana plants, shrubs and grass fill the floor and crowd the verges.
    const floorSpot = (i, share) => {
      const s = this.start + random() * CHUNK_LENGTH, rc = riverCenter(s), hw = riverHalfWidth(s), kind = i / share;
      if (kind < .45) return [s, (random() > .5 ? 1 : -1) * (9.7 + random() * 3.5)];
      if (kind < .7) return [s, random() > .5 ? rc + hw + 1.5 + random() * 5 : rc - hw - 1.5 - random() * 5];
      return [s, (random() > .5 ? 1 : -1) * (10 + random() * 90)];
    };
    for (let i = 0; i < 420; i++) {
      const [s, u] = floorSpot(i, 420);
      if (!open(s, u) || slope(s, u) > 2.5) continue;
      plant(ferns, ground(s, u), .8 + random() * .9, fernColors);
    }
    for (let i = 0; i < 120; i++) {
      const [s, u] = floorSpot(i, 120);
      if (!open(s, u, .5) || slope(s, u) > 2.2) continue;
      plant(leaves, ground(s, u), 1.2 + random() * 1.1, leafColors);
    }
    for (let i = 0; i < 110; i++) {
      const [s, u] = floorSpot(i, 110);
      if (!open(s, u, 1.6) || slope(s, u) > 2.1 || !clear(s, u, .3)) continue;
      const p = ground(s, u), size = Math.min(2.1 + random() * 1.7, headroom(s, u, p.y));
      if (size >= 1.6) plant(bananas, { ...p, y: p.y - .05 }, size, bananaColors, .9 + random() * .25);
    }
    for (let i = 0; i < 170; i++) {
      const s = this.start + random() * CHUNK_LENGTH, u = (random() > .5 ? 1 : -1) * (10.5 + random() * 110);
      if (!open(s, u, .8) || slope(s, u) > 2.3) continue;
      const p = ground(s, u), size = .9 + random() * 1.5;
      shrubs.push({ p: [p.x, p.y + size * .3, p.z], scale: [size, size * .7, size * .9], r: [0, random() * 6.28, .1], color: pick(shrubColors) });
    }
    for (let i = 0; i < 90; i++) {
      const [s, u] = floorSpot(i, 90);
      if (!open(s, u) || slope(s, u) > 2.5) continue;
      plant(tufts, ground(s, u), .7 + random() * .8, ['#7fa04c', '#94ad55']);
    }
    // Boulders line the banks, crowd each lip, and break through the slopes.
    for (let s = this.start + 2; s < this.start + CHUNK_LENGTH; s += 5) {
      const rc = riverCenter(s), hw = riverHalfWidth(s);
      for (let i = 0, count = 1 + Math.floor(random() * 3); i < count; i++) {
        const side = random() > .5 ? 1 : -1, t = s + random() * 4;
        const u = rc + side * (hw + .8 + random() * 3.2);
        const size = .5 + random() ** 1.5 * 1.9;
        stone(t, u, size, random() > .3, onRiver(t, u) ? riverLevel(t) - .3 + size * .35 : null);
      }
    }
    for (const rock of riverRocks(this.start, this.start + CHUNK_LENGTH)) stone(rock.s, rock.u, rock.size, false, riverLevel(rock.s) - rock.size * .16);
    for (const lip of this.lips) {
      const hw = riverHalfWidth(lip.s), rc = riverCenter(lip.s);
      for (let i = 0; i < 8; i++) {
        const f = -1.15 + i * 2.3 / 7 + (random() - .5) * .2, size = 1.1 + random() * 2.1;
        const s = lip.s + riverLipOffset(lip.index, f) + (random() - .5) * 1.2, u = rc + f * hw, p = ground(s, u);
        // Stones inside the sheet stay low so the water pours over them.
        stone(s, u, Math.abs(f) < .85 ? size * .6 : size, Math.abs(f) > .9, Math.abs(f) < .85 ? lip.upper - size * .7 : Math.max(p.y + size * .3, lip.upper - size * .3));
      }
      for (let i = 0; i < 5; i++) {
        const s = lip.s - 3 - random() * 8, u = rc + (random() * 2 - 1) * hw * .8, size = .7 + random() * 1.2;
        stone(s, u, size, false, lip.lower - .25 + size * .3);
      }
    }
    for (let i = 0; i < 45; i++) {
      const s = this.start + random() * CHUNK_LENGTH, u = (random() > .5 ? 1 : -1) * (12 + random() * 128);
      if (!open(s, u, 1)) continue;
      const crag = jungleCrags(s, u), size = crag > 2 ? 1.5 + random() * 2.5 : .6 + random() * 1.4;
      stone(s, u, size, random() > .4);
    }
    for (let s = this.start + 3; s < this.start + CHUNK_LENGTH; s += 6) {
      if (cutHeight(s) < 2.4 || random() > .6 || inStream(s, 12, 1)) continue;
      stone(s + random() * 3, 11 + random() * 3.5, .7 + random() * 1.1, random() > .5);
    }
    // Fallen, moss-covered trunks lie across the floor.
    for (let i = 0; i < 5; i++) {
      const s = this.start + random() * CHUNK_LENGTH, u = (random() > .5 ? 1 : -1) * (13 + random() * 80);
      if (!open(s, u, 4) || slope(s, u) > 1.2) continue;
      const p = ground(s, u), length = 5 + random() * 4, radius = .35 + random() * .2, angle = random() * 6.28;
      const direction = new THREE.Vector3(Math.cos(angle), .04, Math.sin(angle)).normalize();
      logs.push({ p: [p.x, p.y + radius * .8, p.z], scale: [radius * 1.4, length, radius * 1.4], q: new THREE.Quaternion().setFromUnitVectors(up, direction), color: '#8ea36a' });
    }
    // The foreground beyond the river is still rainforest, even where it is
    // far from the road. Layer overlapping groves over a lower plant cover;
    // jittered cells keep the coverage even without planting visible rows.
    for (let row = 0; row < CHUNK_LENGTH / 8; row++) for (let band = 0; band < 23; band++) {
      const s = this.start + row * 8 + 1 + random() * 6, u = -108 - band * 10 - random() * 8;
      const grove = jungleNoise(s, u, 32, 2731), p = ground(s, u), steepness = slope(s, u);
      if (steepness > 2.1) continue;
      const density = (.55 + grove * .5) * (1 - smoothstep(300, 340, -u) * .45);
      if (random() < density && clear(s, u, .8)) {
        const height = Math.min(8 + random() * 7 + grove * 3, headroom(s, u, p.y));
        if (random() < .16) palm(s, u, height * .85);
        else tree(s, u, height, grove > .6 ? darkCrowns : crownColors);
      }
      // Understory sits between the trunks and reaches into small canopy gaps.
      const t = Math.max(this.start + .2, Math.min(this.start + CHUNK_LENGTH - .2, s + (random() - .5) * 6));
      const cross = u + (random() - .5) * 7, floor = ground(t, cross), kind = random();
      if (kind < .28) plant(ferns, floor, 1.4 + random() * 1.3, fernColors);
      else if (kind < .42) plant(bananas, floor, 2 + random() * 1.7, bananaColors);
      else {
        const size = 2 + random() * 2 + grove;
        forestShrubs.push({ p: [floor.x, floor.y + size * .3, floor.z], scale: [size, size * .8, size], r: [0, random() * 6.28, 0], color: pick(shrubColors) });
      }
    }
    // Fill the inland hillside with a lighter layer of overlapping trees and
    // broad shrubs. Existing clearances preserve the creeks and rocky crags;
    // crowns beyond the roadside forest already use the cheaper shadow-free batch.
    for (let row = 0; row < CHUNK_LENGTH / 8; row++) for (let band = 0; band < 18; band++) {
      const s = this.start + row * 8 + 1 + random() * 6, u = 52 + band * 12 + random() * 9;
      const grove = jungleNoise(s, u, 37, 2732), steepness = slope(s, u);
      if (steepness > 2 || !open(s, u, 2)) continue;
      if (random() < .5 + grove * .4 && clear(s, u, 1)) {
        tree(s, u, 8 + random() * 7 + grove * 2, grove > .65 ? darkCrowns : crownColors);
      }
      if (random() > .7 || inStream(s, u, 3)) continue;
      const p = ground(s, u), size = 2.3 + random() * 2.2;
      forestShrubs.push({ p: [p.x, p.y + size * .25, p.z], scale: [size, size * .85, size], r: [0, random() * 6.28, 0], color: pick(shrubColors) });
      if (random() < .2) plant(ferns, ground(s, u + size), 1.4 + random(), fernColors);
    }
    this.buildGuardrail(rails, railPosts);
    instances(this.group, trunkGeometry, barkMaterial, trunks, 'jungle-trunks');
    jungleCrowns.forEach((g, i) => { instances(this.group, g, canopyMaterial, crowns[i], 'jungle-canopy'); instances(this.group, g, canopyMaterial, farCrowns[i], 'jungle-canopy-far', false, { ambientOcclusion: false }); });
    emergentTrunks.forEach((g, i) => instances(this.group, g, barkMaterial, emergents[i], 'emergent-trunks'));
    emergentCrowns.forEach((g, i) => instances(this.group, g, canopyMaterial, emergentTops[i], 'emergent-crowns'));
    instances(this.group, vineGeometry, frondMaterial, vines, 'lianas', false);
    junglePalms.forEach((palmShape, i) => {
      instances(this.group, palmShape.trunk, palmBarkMaterial, palmTrunks[i], 'palm-trunks');
      instances(this.group, palmShape.fronds, frondMaterial, palmFronds[i], 'palm-fronds');
    });
    instances(this.group, bambooGeometry, frondMaterial, bamboos, 'bamboo');
    instances(this.group, fernGeometry, frondMaterial, ferns, 'ferns', false);
    instances(this.group, bigLeafGeometry, frondMaterial, leaves, 'broad-leaves');
    instances(this.group, bananaGeometry, frondMaterial, bananas, 'banana-plants', false);
    instances(this.group, shrubGeometry, shrubMaterial, shrubs, 'undergrowth');
    // Dense ground cover under the forest canopy receives shade but does not
    // need hundreds of extra shadow casters on either hillside.
    instances(this.group, shrubGeometry, shrubMaterial, forestShrubs, 'forest-undergrowth', false, { ambientOcclusion: false });
    instances(this.group, shrubGeometry, shrubMaterial, lumps, 'distant-canopy', false, { ambientOcclusion: false });
    instances(this.group, tuftGeometry, frondMaterial, tufts, 'grass-tufts', false);
    instances(this.group, lilyGeometry, frondMaterial, lilies, 'lily-pads', false);
    jungleBoulders.forEach((g, i) => instances(this.group, g, stoneMaterial, boulders[i], 'mossy-boulders'));
    cliffBlocks.forEach((g, i) => instances(this.group, g, stoneMaterial, cliffs[i], 'gorge-rocks'));
    instances(this.group, logGeometry, logMaterial, logs, 'fallen-logs');
    instances(this.group, boxGeometry, railMaterial, [...rails.map(item => ({ ...item, color: '#b3b9b7' })), ...railPosts.map(item => ({ ...item, color: '#6f7674' }))], 'guardrails');
  }
  buildGuardrail(rails, posts) {
    const guarded = jungleGuardrail;
    const point = (s, u, lift) => { const p = positionAt(s, u, roadHeight(s) + lift); return new THREE.Vector3(p.x, p.y, p.z + this.start); };
    const side = new THREE.Vector3(), normal = new THREE.Vector3(), basis = new THREE.Matrix4();
    const beam = (a, b) => {
      const direction = b.clone().sub(a), length = direction.length();
      direction.normalize(); side.crossVectors(direction, up).normalize(); normal.crossVectors(side, direction);
      const q = new THREE.Quaternion().setFromRotationMatrix(basis.makeBasis(side, direction, normal));
      rails.push({ p: a.clone().add(b).multiplyScalar(.5).toArray(), scale: [.07, length + .06, .3], q });
    };
    for (let s = Math.ceil(this.start / 4) * 4; s < this.start + CHUNK_LENGTH; s += 4) {
      if (!guarded(s)) continue;
      posts.push({ p: point(s, -8.12, .36).toArray(), scale: [.15, .8, .15] });
      if (guarded(s + 4)) beam(point(s, -7.98, .6), point(s + 4, -7.98, .6));
      else beam(point(s, -7.98, .6), point(s + 3, -8.4, .1));
      if (!guarded(s - 4)) beam(point(s - 3, -8.4, .1), point(s, -7.98, .6));
    }
  }
  // Humid mist drifts in patches just above the canopy on both sides of the
  // valley and pools lower toward the mountains, whose peaks rise clear of it.
  buildMist() {
    const vertices = [], coords = [];
    const rows = Array.from({ length: CHUNK_LENGTH / 16 + 1 }, (_, i) => this.start + i * 16);
    const veil = (s, u) => {
      const road = roadHeight(s), terrain = jungleHeight(s, u), cross = Math.abs(u);
      // Well clear of the crowns, and never dipping into the gorge, so trees do not cut hard edges through it.
      const y = Math.max(terrain + 38 + 4 * Math.sin(s / 97 + u / 53), u > 0 ? road + 62 + 9 * Math.sin(s / 173 + u / 131) : road + 44);
      const fade = smoothstep(u > 0 ? 45 : 110, u > 0 ? 95 : 160, cross) * (1 - smoothstep(u > 0 ? 400 : 240, u > 0 ? 460 : 290, cross)) * (1 - smoothstep(road + 70, road + 100, terrain));
      const p = positionAt(s, u, y);
      // The camera looks through the near veil, so it stays thinner.
      return { x: p.x, y: p.y, z: p.z + this.start, coord: [s * .05, u * .02, fade * (u > 0 ? 1 : .55)] };
    };
    sheet(vertices, coords, rows, [45, 70, 95, 125, 160, 200, 245, 295, 350, 405, 460], veil);
    sheet(vertices, coords, rows, [-290, -250, -210, -175, -145, -120, -105], veil);
    const g = geometryFrom(vertices); g.setAttribute('foamCoord', new THREE.Float32BufferAttribute(coords, 3)); g.boundingSphere.radius += 10;
    this.addMesh(g, valleyMistMaterial, 'valley-mist');
  }
  dispose() {
    this.group.removeFromParent(); for (const g of this.owned) g.dispose();
    this.group.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
  }
}

export class JungleWorld {
  constructor(scene, chunkSource = null) { this.scene = scene; this.chunkSource = chunkSource; this.chunks = new Map(); this.origin = 0; this.center = null; }
  update(s) {
    const center = Math.floor(s / CHUNK_LENGTH); this.origin = Math.floor(s / 1024) * 1024;
    updateResidentChunks(this, center, JungleChunk);
    for (const chunk of this.chunks.values()) chunk.group.position.z = this.origin - chunk.start;
  }
  animate(time) { animateWater(time, this.origin); }
  dispose() { this.chunkSource?.dispose(); for (const chunk of this.chunks.values()) chunk.dispose(); this.chunks.clear(); }
}
