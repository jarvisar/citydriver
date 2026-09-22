import * as THREE from 'three';

// Subdivide the shared surface triangle, retaining identical edge vertices on
// adjacent instances. The mesh stays coarse enough for visible flat facets.
const positions = [], centers = [];
const segments = 4;
function point(x, z) {
  // Break up the regular grid inside each panel without disturbing shared edges.
  const interior = x > 0 && z > 0 && x + z < segments;
  return [(x + (interior ? Math.sin(x * 5.3 + z * 2.7) * .22 : 0)) / segments,
    (z + (interior ? Math.sin(x * 3.1 - z * 4.9) * .22 : 0)) / segments];
}
function triangle(a, b, c) {
  const center = [(a[0] + b[0] + c[0]) / 3, .5, -(a[1] + b[1] + c[1]) / 3];
  for (const p of [a, b, c]) { positions.push(p[0], .5, -p[1]); centers.push(...center); }
}
for (let x = 0; x < segments; x++) for (let z = 0; z < segments - x; z++) {
  const a = point(x, z), b = point(x + 1, z), c = point(x, z + 1);
  triangle(a, b, c);
  if (x + z < segments - 1) triangle(b, point(x + 1, z + 1), c);
}
export const riverWaterGeometry = new THREE.BufferGeometry();
riverWaterGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
riverWaterGeometry.setAttribute('riverCenter', new THREE.Float32BufferAttribute(centers, 3));
riverWaterGeometry.computeVertexNormals();

export function createRiverWaterMaterial() {
  const material = new THREE.MeshStandardMaterial({ color: '#4e858c', roughness: .38, metalness: .08, flatShading: true });
  const time = { value: 0 }, origin = { value: 0 };
  material.userData.time = time;
  material.userData.origin = origin;
  material.customProgramCacheKey = () => 'citydriver-river-water-v2';
  material.onBeforeCompile = shader => {
    shader.uniforms.riverTime = time;
    shader.uniforms.riverOrigin = origin;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `
      #include <common>
      uniform float riverTime;
      uniform float riverOrigin;
      attribute vec3 riverCenter;
      varying vec2 vRiverPosition;
      varying vec2 vRiverCenter;
    `).replace('#include <project_vertex>', `
      vec4 riverPoint = vec4(transformed, 1.0);
      vec4 riverFacet = vec4(riverCenter, 1.0);
      #ifdef USE_INSTANCING
        riverPoint = instanceMatrix * riverPoint;
        riverFacet = instanceMatrix * riverFacet;
      #endif
      vRiverPosition = (modelMatrix * riverPoint).xz - vec2(0.0, riverOrigin);
      vRiverCenter = (modelMatrix * riverFacet).xz - vec2(0.0, riverOrigin);
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
      varying vec2 vRiverCenter;
      float riverHash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
    `).replace('#include <color_fragment>', `
      #include <color_fragment>
      float facet = sin(dot(vRiverCenter, vec2(0.18, 0.24)) - riverTime * 0.72)
        * sin(dot(vRiverCenter, vec2(-0.11, 0.21)) + riverTime * 0.29);
      float broad = sin(dot(vRiverPosition, vec2(0.034, 0.052)) - riverTime * 0.12);
      // Let moving face normals carry the shape; keep pigment nearly uniform
      // so overlapping waves do not read as blotches on the surface.
      diffuseColor.rgb *= 1.0 + 0.025 * facet + 0.012 * broad;

      // Sparse, broken strokes move slowly across the facets. Screen-space
      // filtering fades them away before they can shimmer in distant views.
      vec2 ripplePosition = vRiverPosition - vec2(0.18, -0.36) * riverTime;
      vec2 cell = floor(ripplePosition / vec2(9.0, 6.0));
      vec2 local = fract(ripplePosition / vec2(9.0, 6.0)) - 0.5;
      float seed = riverHash(cell);
      float line = abs(local.y * 6.0 + (seed - 0.5) * 2.6 + local.x * 0.35);
      float aa = max(fwidth(line), 0.025);
      float stroke = (1.0 - smoothstep(0.06, 0.06 + aa, line))
        * (1.0 - smoothstep(0.16 + seed * 0.12, 0.31 + seed * 0.1, abs(local.x)))
        * smoothstep(0.56, 0.8, seed) * (0.65 + 0.35 * sin(riverTime * 0.6 + seed * 24.0))
        * (1.0 - smoothstep(0.22, 0.75, length(fwidth(vRiverPosition))));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.36, 0.57, 0.58), stroke * 0.38);
    `).replace('#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      vec3 riverView = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
      float riverGrazing = pow(1.0 - max(dot(normal, riverView), 0.0), 3.0);
      diffuseColor.rgb *= 1.0 + riverGrazing * 0.32;
    `);
  };
  return material;
}
