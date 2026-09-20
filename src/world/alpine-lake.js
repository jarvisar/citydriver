import * as THREE from 'three';
import { registerChunkResources } from './chunk-resources.js';
import { CHUNK_LENGTH, randomAt, smoothstep } from './route.js';
import { alpineLake, snowPosition, LAKE_LEVEL } from './snow-route.js';

export const lakeClock = { value: 0 };
const water = new THREE.MeshStandardMaterial({ color: '#396d7e', roughness: .36, metalness: .18,
  emissive: '#264b60', emissiveIntensity: .36 });
const ice = new THREE.MeshStandardMaterial({ color: '#8aafbb', roughness: .48, metalness: .08, flatShading: true });
const noise = /* glsl */`
  float lakeHash(vec2 p) { return fract(sin(dot(mod(p, 256.0), vec2(127.1, 311.7))) * 43758.5453); }
  float lakeNoise(vec2 p) {
    vec2 cell = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(lakeHash(cell), lakeHash(cell + vec2(1.0, 0.0)), f.x),
      mix(lakeHash(cell + vec2(0.0, 1.0)), lakeHash(cell + vec2(1.0)), f.x), f.y);
  }
`;
water.onBeforeCompile = shader => {
  shader.uniforms.lakeTime = lakeClock;
  shader.vertexShader = 'attribute vec3 lakeCoord; varying vec3 vLakeCoord;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLakeCoord = lakeCoord;');
  shader.fragmentShader = 'uniform float lakeTime; varying vec3 vLakeCoord;\n' + noise + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
    #include <color_fragment>
    vec2 p = vLakeCoord.xy;
    float ripple = sin(p.y * 1.35 + p.x * 0.24 + lakeNoise(p * 0.1) * 5.0 - lakeTime * 0.52);
    float patches = smoothstep(0.38, 0.78, lakeNoise(p * 0.19 + vec2(lakeTime * 0.015, 0.0)));
    float sheen = pow(max(0.0, sin(p.x * 0.018 + p.y * 0.006 + 1.2)), 5.0);
    float glint = pow(max(0.0, ripple), 22.0) * patches * (0.2 + sheen * 0.8);
    // Dark sheltered water at the foot of the trees, silver-blue ripples
    // across open water. All phases use route coordinates, never chunk IDs.
    float reflection = exp(-vLakeCoord.z * 0.09) * (0.5 + lakeNoise(vec2(p.y * 0.045, 3.7)) * 0.5);
    diffuseColor.rgb *= 1.0 - reflection * 0.55;
    diffuseColor.rgb += vec3(0.11, 0.17, 0.19) * (glint * 0.75 + sheen * 0.13);
  `);
};
water.customProgramCacheKey = () => 'alpine-lake-v1';

const mist = new THREE.MeshBasicMaterial({ color: '#8ba5b4', transparent: true, opacity: .14,
  depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });
mist.onBeforeCompile = shader => {
  shader.uniforms.lakeTime = lakeClock;
  shader.vertexShader = 'attribute vec3 lakeCoord; varying vec3 vLakeCoord;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLakeCoord = lakeCoord;');
  shader.fragmentShader = 'uniform float lakeTime; varying vec3 vLakeCoord;\n' + noise + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
    #include <color_fragment>
    float wisp = lakeNoise(vLakeCoord.xy * vec2(0.045, 0.025) + vec2(lakeTime * 0.012, lakeTime * 0.004));
    diffuseColor.a *= smoothstep(0.42, 0.76, wisp) * smoothstep(0.0, 12.0, vLakeCoord.z);
  `);
};
mist.customProgramCacheKey = () => 'alpine-lake-mist-v1';
registerChunkResources('lake', { water, ice, mist });

function makeGeometry(vertices, coords) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  if (coords) g.setAttribute('lakeCoord', new THREE.Float32BufferAttribute(coords, 3));
  g.computeVertexNormals(); g.computeBoundingSphere(); return g;
}

export function buildAlpineLake(start) {
  const vertices = [], coords = [], frozen = [];
  const point = (s, u, lift = 0) => {
    const lake = alpineLake(s), p = snowPosition(s, u, LAKE_LEVEL + lift);
    return { ...p, z: p.z + start, s, u, bank: Math.max(0, Math.min(u - lake.far, lake.near - u)) };
  };
  const triangle = (target, a, b, c, uv = null) => {
    if ((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) < 0) [b, c] = [c, b];
    for (const p of [a, b, c]) { target.push(p.x, p.y, p.z); if (uv) uv.push(p.u, p.s, p.bank); }
  };
  const columns = [0, .035, .12, .3, .5, .7, .88, .965, 1];
  for (let s = start; s < start + CHUNK_LENGTH; s += 4) {
    const at = (t, fraction) => { const lake = alpineLake(t); return point(t, lake.far + (lake.near - lake.far) * fraction); };
    for (let col = 0; col < columns.length - 1; col++) {
      const a = at(s, columns[col]), b = at(s + 4, columns[col]), c = at(s, columns[col + 1]), d = at(s + 4, columns[col + 1]);
      triangle(vertices, a, b, c, coords); triangle(vertices, b, d, c, coords);
    }
    for (const side of ['near', 'far']) {
      const rim = (t, inside) => {
        const lake = alpineLake(t), sign = side === 'near' ? -1 : 1;
        const width = .7 + 2.2 * smoothstep(-.5, .9, Math.sin(t / 13 + (side === 'near' ? 0 : 2)))
          + randomAt(t / 4, 820) * 1.5;
        return point(t, lake[side] + sign * (inside ? width : .4), .055);
      };
      triangle(frozen, rim(s, false), rim(s + 4, false), rim(s, true));
      triangle(frozen, rim(s + 4, false), rim(s + 4, true), rim(s, true));
    }
  }
  // Small fractured ice plates sit close to sheltered coves.
  for (let i = 0; i < 10; i++) {
    const seed = start + i, s = start + 5 + randomAt(seed, 825) * (CHUNK_LENGTH - 10);
    const u = alpineLake(s).near - 5 - randomAt(seed, 826) * 9;
    const radius = .6 + randomAt(seed, 827) * 1.6, center = point(s, u, .075), ring = [];
    for (let j = 0; j < 5; j++) {
      const angle = j / 5 * Math.PI * 2, r = radius * (.7 + randomAt(seed, j + 829) * .4);
      ring.push(point(s + Math.sin(angle) * r, u + Math.cos(angle) * r, .075));
    }
    for (let j = 0; j < 5; j++) triangle(frozen, center, ring[j], ring[(j + 1) % 5]);
  }
  const surface = makeGeometry(vertices, coords), haze = surface.clone(); haze.translate(0, 3.8, 0);
  return [
    { geometry: surface, material: water, name: 'alpine-lake' },
    { geometry: makeGeometry(frozen), material: ice, name: 'shore-ice' },
    { geometry: haze, material: mist, name: 'lake-mist' },
  ];
}
