import * as THREE from 'three';
import { RIVER_PERIOD, RIVER_COLUMN, CROSS_RIVER_PERIOD, CROSS_RIVER_ROW } from './city-waterways.js';

// Subdivide the shared surface triangle, retaining identical edge vertices on
// adjacent instances. Shading follows the current rather than triangle edges.
const positions = [];
const segments = 4;
function point(x, z) {
  // Break up the regular grid inside each panel without disturbing shared edges.
  const interior = x > 0 && z > 0 && x + z < segments;
  return [(x + (interior ? Math.sin(x * 5.3 + z * 2.7) * .22 : 0)) / segments,
    (z + (interior ? Math.sin(x * 3.1 - z * 4.9) * .22 : 0)) / segments];
}
function triangle(a, b, c) {
  for (const p of [a, b, c]) positions.push(p[0], .5, -p[1]);
}
for (let x = 0; x < segments; x++) for (let z = 0; z < segments - x; z++) {
  const a = point(x, z), b = point(x + 1, z), c = point(x, z + 1);
  triangle(a, b, c);
  if (x + z < segments - 1) triangle(b, point(x + 1, z + 1), c);
}
export const riverWaterGeometry = new THREE.BufferGeometry();
riverWaterGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
riverWaterGeometry.computeVertexNormals();

// Address-space coordinates follow the river bends and survive origin shifts.
// Each batch owns its small attribute buffer, including merged distant tiles.
export function attachRiverFlow(mesh, addresses) {
  const geometry = riverWaterGeometry.clone();
  const buffer = new THREE.InstancedInterleavedBuffer(addresses, 6);
  for (let i = 0; i < 3; i++) geometry.setAttribute(`riverAddress${i}`, new THREE.InterleavedBufferAttribute(buffer, 2, i * 2));
  mesh.geometry = geometry;
  mesh.addEventListener('dispose', () => geometry.dispose());
}

export function createRiverWaterMaterial() {
  const material = new THREE.MeshStandardMaterial({ color: '#397780', roughness: .3, metalness: .04, flatShading: true });
  const time = { value: 0 }, origin = { value: 0 };
  material.userData.time = time;
  material.userData.origin = origin;
  material.customProgramCacheKey = () => 'citydriver-river-water-v5';
  material.onBeforeCompile = shader => {
    shader.uniforms.riverTime = time;
    shader.uniforms.riverOrigin = origin;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `
      #include <common>
      uniform float riverTime;
      uniform float riverOrigin;
      varying vec2 vRiverPosition;
      varying vec2 vRiverAddress;
      attribute vec2 riverAddress0;
      attribute vec2 riverAddress1;
      attribute vec2 riverAddress2;
    `).replace('#include <project_vertex>', `
      vec4 riverPoint = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        riverPoint = instanceMatrix * riverPoint;
      #endif
      vRiverPosition = (modelMatrix * riverPoint).xz - vec2(0.0, riverOrigin);
      vRiverAddress = riverAddress0 + transformed.x * (riverAddress1 - riverAddress0)
        - transformed.z * (riverAddress2 - riverAddress0);
      // Absolute coordinates keep ripples joined across streamed chunks and
      // floating-origin shifts. Total vertical travel is only 24 centimetres.
      float riverWave = 0.075 * sin(dot(vRiverPosition, vec2(0.18, 0.24)) - riverTime * 0.72)
        + 0.045 * sin(dot(vRiverPosition, vec2(-0.32, 0.16)) - riverTime * 0.53);
      #ifdef USE_INSTANCING
        transformed.y += riverWave / instanceMatrix[1][1];
      #else
        transformed.y += riverWave;
      #endif
      #include <project_vertex>
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
      #include <common>
      uniform float riverTime;
      varying vec2 vRiverPosition;
      varying vec2 vRiverAddress;
      float riverHash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      vec2 riverCurrent(vec2 p) {
        // Staggered, elongated facets travel together down the channel. Their
        // endpoints taper to zero before the next independently spaced segment.
        float lane = floor(p.x / 4.0);
        float laneSeed = riverHash(vec2(lane, 37.0));
        float along = p.y - riverTime * (1.35 + laneSeed * 0.35) + laneSeed * 43.0;
        float segment = floor(along / 28.0);
        float seed = riverHash(vec2(lane, segment));
        float y = mod(along, 28.0) - 14.0;
        float halfLength = 4.5 + seed * 6.5;
        float taper = max(0.0, 1.0 - abs(y) / halfLength);
        float x = mod(p.x, 4.0) - 2.0 - (laneSeed - 0.5) * 1.4 - (seed - 0.5) * 0.5;
        // Piecewise straight edges keep each ribbon angular, not cloudy.
        x += (abs(y + halfLength * 0.25) - abs(y - halfLength * 0.4)) * (seed - 0.5) * 0.06;
        float aa = max(fwidth(x), 0.035);
        float width = (0.25 + seed * 0.4) * taper;
        float ribbon = (1.0 - smoothstep(width - aa, width + aa, abs(x))) * taper;
        float glint = (1.0 - smoothstep(0.09 - aa, 0.09 + aa, abs(x - width * 0.55))) * taper;
        float distanceFade = 1.0 - smoothstep(0.4, 1.4, length(fwidth(p)));
        return vec2(ribbon, glint) * (0.55 + seed * 0.45) * distanceFade;
      }
    `).replace('#include <color_fragment>', `
      #include <color_fragment>
      // Keep the body color uniform: depth comes from surface lighting, not
      // mottled pigment or broad patches of procedural noise.

      float northDistance = abs(mod(vRiverAddress.x - ${(RIVER_COLUMN + .5) * 112}.0
        + ${RIVER_PERIOD * 56}.0, ${RIVER_PERIOD * 112}.0) - ${RIVER_PERIOD * 56}.0);
      float eastDistance = abs(mod(vRiverAddress.y - ${(CROSS_RIVER_ROW + .5) * 112}.0
        + ${CROSS_RIVER_PERIOD * 56}.0, ${CROSS_RIVER_PERIOD * 112}.0) - ${CROSS_RIVER_PERIOD * 56}.0);
      // The north current carries the junction; the side current joins it.
      // Avoid laying two crossing patterns over the center of a confluence.
      float northWeight = 1.0 - smoothstep(20.0, 32.0, northDistance);
      float eastWeight = (1.0 - smoothstep(20.0, 32.0, eastDistance)) * (1.0 - northWeight);
      vec2 current = (riverCurrent(vRiverAddress) * northWeight
        + riverCurrent(vRiverAddress.yx) * eastWeight) / max(northWeight + eastWeight, 0.001);
      diffuseColor.rgb *= 1.0 + current.x * 0.12;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.36, 0.57, 0.58), current.y * 0.12);
    `).replace('#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      // Smooth normals follow the gentle mesh displacement. Using the actual
      // triangle normals here exposes the triangulation as a repeating lattice.
      vec2 slope = vec2(0.18, 0.24) * 0.075
        * cos(dot(vRiverPosition, vec2(0.18, 0.24)) - riverTime * 0.72)
        + vec2(-0.32, 0.16) * 0.045
        * cos(dot(vRiverPosition, vec2(-0.32, 0.16)) - riverTime * 0.53);
      normal = normalize(mat3(viewMatrix) * vec3(-slope.x, 1.0, -slope.y));
      nonPerturbedNormal = normal;
      vec3 riverView = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
      float riverFresnel = 0.035 + 0.4 * pow(1.0 - max(dot(normal, riverView), 0.0), 5.0);
    `).replace('#include <lights_fragment_end>', `
      #include <lights_fragment_end>
      // Reflect the existing weather-driven hemisphere sky. This gives water
      // a soft sheen without another scene render or a fixed daytime texture.
      vec3 riverReflection = reflect(-riverView, normal);
      vec3 riverSky = vec3(0.0);
      #if NUM_HEMI_LIGHTS > 0
        for (int i = 0; i < NUM_HEMI_LIGHTS; i++) {
          float skyFacing = clamp(dot(riverReflection, hemisphereLights[i].direction) * 0.5 + 0.5, 0.0, 1.0);
          riverSky += mix(hemisphereLights[i].groundColor, hemisphereLights[i].skyColor, skyFacing);
        }
      #endif
      reflectedLight.indirectSpecular += riverSky * riverFresnel;
    `);
  };
  return material;
}
