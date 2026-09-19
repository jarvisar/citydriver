import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { randomAt } from './route.js';

function geometry(vertices, colors) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals(); g.computeBoundingSphere(); return g;
}

function crag(seed) {
  const vertices = [], colors = [], sides = 8;
  // Each scaffold has its own broken crown: a broad stack, a sloping slab,
  // and a cleft pinnacle. Shared vertical joints keep the facets connected;
  // uneven shoulder heights avoid horizontal rings and diamond-like cones.
  const profile = [
    { crown: [.76, .93, .81, .56, .62, .88, 1.02, .86], width: [.68, .59, .66, .81, .72, .51, .47, .63], lean: [-.13, .09], ridge: [1.04, 1.12] },
    { crown: [.49, .57, .73, .96, 1.04, .89, .62, .41], width: [.84, .76, .59, .52, .48, .64, .77, .83], lean: [-.22, -.08], ridge: [.96, .86] },
    { crown: [.82, 1.02, .91, .55, .69, .99, .83, .48], width: [.57, .48, .62, .57, .75, .53, .46, .73], lean: [.16, -.14], ridge: [1.12, .92] },
  ][seed - 1];
  const outline = Array.from({ length: sides }, (_, i) => ({
    angle: (i + (randomAt(seed * 19 + i, 221) - .5) * .28) / sides * Math.PI * 2,
    radius: .84 + randomAt(seed * 31 + i, 222) * .28,
  }));
  const rings = Array.from({ length: 4 }, (_, layer) => outline.map(({ angle, radius }, i) => {
    const shoulder = .13 + randomAt(seed * 43 + i, 223) * .4;
    const heights = [-1.04, -.38 + randomAt(seed, i + 224) * .23, Math.min(shoulder, profile.crown[i] - .2), profile.crown[i]];
    const widths = [.82, 1, .79 + randomAt(seed, i + 225) * .24, profile.width[i]];
    const r = radius * widths[layer];
    return [Math.cos(angle) * r + profile.lean[0] * layer / 3,
      heights[layer], Math.sin(angle) * r + profile.lean[1] * layer / 3];
  }));
  const warm = new THREE.Color('#fff2d9'), cool = new THREE.Color('#bac8ce');
  const edgeA = new THREE.Vector3(), edgeB = new THREE.Vector3();
  const face = (a, b, c, joint) => {
    vertices.push(...a, ...b, ...c);
    edgeA.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    edgeB.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const up = Math.max(0, edgeA.cross(edgeB).normalize().y);
    // Warm weathered caps and cool fracture planes, shared across a joint
    // instead of unrelated random colors on every triangle.
    const color = cool.clone().lerp(warm, .32 + up * .53 + randomAt(seed, joint + 81) * .12);
    for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
  };
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    for (let layer = 0; layer < rings.length - 1; layer++) {
      const a = rings[layer][i], b = rings[layer + 1][i], c = rings[layer][j], d = rings[layer + 1][j];
      if ((i + layer + seed) % 2) { face(a, b, c, i); face(c, b, d, i); }
      else { face(a, b, d, i); face(a, d, c, i); }
    }
    face([0, -1.2, 0], rings[0][i], rings[0][j], i);
  }
  // Two offset ridge points make a chipped roof with a long crest, rather
  // than closing every variant with the same pointed summit.
  const top = rings.at(-1);
  const front = [profile.lean[0] - .11, profile.ridge[0], .25 + profile.lean[1]];
  const back = [profile.lean[0] + .13, profile.ridge[1], -.24 + profile.lean[1]];
  for (let i = 0; i < sides; i++) face(i < 4 ? front : back, top[(i + 1) % sides], top[i], i);
  face(top[0], back, front, 0); face(top[4], front, back, 4);
  return geometry(vertices, colors);
}

function pine(seed) {
  const vertices = [], colors = [];
  for (let layer = 0; layer < 4; layer++) {
    const sides = 7, base = .17 + layer * .18, radius = .32 - layer * .064;
    const tip = [.025 * layer, base + .43 - layer * .035, 0];
    for (let i = 0; i < sides; i++) {
      const at = j => {
        const angle = j / sides * Math.PI * 2 + layer * .73;
        const r = radius * (.77 + randomAt(j % sides + seed * 13, layer + 316) * .4);
        return [Math.cos(angle) * r + layer * .02, base + (randomAt(j % sides, layer + seed * 11) - .5) * .055, Math.sin(angle) * r];
      };
      const a = at(i), b = at((i + 1) % sides);
      vertices.push(...a, ...tip, ...b, ...a, ...b, layer * .02, base, 0);
      const tint = new THREE.Color('#ffffff').multiplyScalar(.72 + layer * .07 + randomAt(i, seed + 315) * .1);
      for (let k = 0; k < 6; k++) colors.push(tint.r, tint.g, tint.b);
    }
  }
  return geometry(vertices, colors);
}

function coastalTree(pine = false) {
  const bark = [], leaves = [], up = new THREE.Vector3(0, 1, 0);
  const branch = (from, to, width) => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), direction = b.clone().sub(a);
    const g = new THREE.CylinderGeometry(width * .58, width, direction.length(), 5, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, direction.clone().normalize()));
    g.translate(...a.add(b).multiplyScalar(.5).toArray()); bark.push(g);
  };
  const lean = pine ? .13 : .32;
  branch([0, -.09, 0], [lean * .3, .33, .04], .075);
  branch([lean * .3, .33, .04], [lean, .65, -.02], .055);
  branch([lean, .65, -.02], [lean + .06, pine ? 1 : .81, .01], .034);
  for (let i = 0; i < (pine ? 5 : 6); i++) {
    const angle = i * 2.4, radius = .18 + randomAt(i, 910) * (pine ? .21 : .4);
    const height = pine ? .63 + i * .085 : .7 + randomAt(i, 911) * .16;
    const crown = [lean + Math.cos(angle) * radius + (pine ? 0 : .12), height, Math.sin(angle) * radius * .8];
    const fork = [crown[0] * .73, height - .13, crown[2] * .6];
    branch([lean * .7, .36 + i * .042, 0], fork, .035 - i * .002);
    branch(fork, crown, .019);
    const g = new THREE.IcosahedronGeometry(1, 1);
    g.scale(.29 + randomAt(i, 912) * .14, .16 + randomAt(i, 913) * .08, .26 + randomAt(i, 914) * .12);
    g.rotateY(angle); g.translate(...crown);
    const colors = [], normals = g.attributes.normal;
    for (let j = 0; j < normals.count; j += 3) {
      const up = (normals.getY(j) + normals.getY(j + 1) + normals.getY(j + 2)) / 3;
      const shade = .76 + Math.max(0, up) * .23 + randomAt(j, i + 916) * .04;
      for (let k = 0; k < 3; k++) colors.push(shade, shade, shade * .96);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    leaves.push(g);
  }
  const result = { bark: mergeGeometries(bark), leaves: mergeGeometries(leaves) };
  for (const part of [...bark, ...leaves]) part.dispose();
  return result;
}

export const coastalCrags = [crag(1), crag(2), crag(3)];
export const coastalPines = [pine(1), pine(2)];
export const coastalCypress = coastalTree();
export const coastalMontereyPine = coastalTree(true);

function sedge() {
  const vertices = [], colors = [];
  for (let blade = 0; blade < 9; blade++) {
    const angle = blade * 2.4, height = .5 + randomAt(blade, 2271) * .55;
    const x = Math.cos(angle), z = Math.sin(angle), width = .065;
    const base = [x * .12, -.08, z * .12];
    const left = [base[0] - z * width, 0, base[2] + x * width];
    const right = [base[0] + z * width, 0, base[2] - x * width];
    const mid = [x * .3, height * .64, z * .3], tip = [x * .55, height, z * .55];
    for (const triangle of [[left, right, mid], [right, tip, mid]]) {
      for (const p of [...triangle, ...triangle.toReversed()]) {
        vertices.push(...p);
        const light = .78 + Math.max(0, p[1]) * .22;
        colors.push(light, light, light * .91);
      }
    }
  }
  const g = geometry(vertices, colors);
  // Both sides receive sky light. Flipped card normals make the far-facing
  // half of a clump black even though these narrow leaves transmit daylight.
  const normals = g.attributes.normal;
  for (let i = 0; i < normals.count; i++) normals.setXYZ(i, 0, 1, 0);
  return g;
}
export const coastalSedge = sedge();

// Bucket projected terrain triangles once; grounding hundreds of plants then
// only visits a few nearby faces instead of raycasting the whole chunk.
export function terrainSampler(mesh) {
  const positions = mesh.geometry.attributes.position, buckets = new Map(), step = 16;
  for (let i = 0; i < positions.count; i += 3) {
    const points = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(positions, i + j));
    const lowX = Math.floor(Math.min(...points.map(p => p.x)) / step), highX = Math.floor(Math.max(...points.map(p => p.x)) / step);
    const lowZ = Math.floor(Math.min(...points.map(p => p.z)) / step), highZ = Math.floor(Math.max(...points.map(p => p.z)) / step);
    for (let x = lowX; x <= highX; x++) for (let z = lowZ; z <= highZ; z++) {
      const key = `${x},${z}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(points);
    }
  }
  return (x, z) => {
    for (const [a, b, c] of buckets.get(`${Math.floor(x / step)},${Math.floor(z / step)}`) ?? []) {
      const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(det) < 1e-8) continue;
      const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / det;
      const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / det;
      if (u >= -.00001 && v >= -.00001 && u + v <= 1.00001) return u * a.y + v * b.y + (1 - u - v) * c.y;
    }
    return null;
  };
}
