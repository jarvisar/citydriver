import * as THREE from 'three';
import { randomAt } from './route.js';

const WIDTH = 240, HEIGHT = 160, DEPTH = 280, COUNT = 1800, NEAR_COUNT = 600;
const wrap = (value, extent) => value - Math.floor(value / extent) * extent - extent / 2;

// One reusable point cloud, like rain: no textures, shadows or extra passes.
// World-space wrapping keeps flakes from travelling sideways with the car.
export class Snowfall {
  constructor() {
    this.seeds = new Float32Array(COUNT * 4);
    const sizes = new Float32Array(COUNT), near = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      this.seeds.set([randomAt(i, 81) * WIDTH, randomAt(i, 82) * HEIGHT,
        randomAt(i, 83) * DEPTH, 2.2 + randomAt(i, 84) * 2.4], i * 4);
      sizes[i] = .55 + randomAt(i, 85) ** 2 * .9;
      near[i] = i < NEAR_COUNT ? 1 : 0;
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('flakeSize', new THREE.BufferAttribute(sizes, 1));
    this.geometry.setAttribute('flakeNear', new THREE.BufferAttribute(near, 1));
    this.material = new THREE.PointsMaterial({ color: '#f0f6ff', size: 1, transparent: true,
      opacity: .85, depthWrite: false, sizeAttenuation: false, toneMapped: false });
    this.material.onBeforeCompile = shader => {
      shader.vertexShader = 'attribute float flakeSize; attribute float flakeNear; varying float vFlakeAlpha;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('gl_PointSize = size;', `
        float perspective = projectionMatrix[2][3] == -1.0 ? clamp(90.0 / max(8.0, -mvPosition.z), 0.6, 2.5) : 1.0;
        gl_PointSize = size * flakeSize * 4.0 * perspective;
        vec3 extent = mix(vec3(${WIDTH / 2}.0, ${HEIGHT / 2}.0, ${DEPTH / 2}.0), vec3(36.0, 35.0, 36.0), flakeNear);
        vec3 edge = abs(position + vec3(0.0, 40.0 * flakeNear, 0.0)) / extent;
        vFlakeAlpha = (1.0 - smoothstep(0.7, 1.0, max(edge.x, max(edge.y, edge.z))))
          * smoothstep(2.0, 8.0, -mvPosition.z);
      `);
      shader.fragmentShader = 'varying float vFlakeAlpha;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        float radius = length(gl_PointCoord - vec2(0.5));
        if (radius > 0.5) discard;
        diffuseColor.a *= (1.0 - smoothstep(0.12, 0.5, radius)) * vFlakeAlpha;
      `);
    };
    this.material.customProgramCacheKey = () => 'city-snow-v1';
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = 'falling-snow'; this.points.frustumCulled = false;
  }
  update(time, anchor, origin) {
    this.points.position.set(anchor.x, anchor.y, anchor.z + origin);
    const positions = this.geometry.attributes.position;
    for (let i = 0; i < COUNT; i++) {
      const n = i * 4, phase = this.seeds[n + 3];
      // Reserve a third of the same budget for street-level flakes so driving
      // cameras see snowfall nearby, not just high above the rooftops.
      const near = i < NEAR_COUNT, yOffset = near ? 40 : 0;
      positions.setXYZ(i,
        wrap(this.seeds[n] + time * .65 + Math.sin(time * .6 + phase * 7) * 1.8 - anchor.x, near ? 72 : WIDTH),
        wrap(this.seeds[n + 1] - time * phase - anchor.y + yOffset, near ? 70 : HEIGHT) - yOffset,
        wrap(this.seeds[n + 2] + Math.sin(time * .4 + phase * 11) * 1.4 - anchor.z, near ? 72 : DEPTH));
    }
    positions.needsUpdate = true;
  }
  dispose() { this.points.removeFromParent(); this.geometry.dispose(); this.material.dispose(); }
}
