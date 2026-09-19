import * as THREE from 'three';

// One shared clock, no per-frame geometry uploads. The phase is periodic over
// 4096 m, so floating-origin rebases do not make the water jump.
export const waterClock = { time: { value: 0 }, origin: { value: 0 } };
const declarations = /* glsl */`
  uniform float coastTime;
  uniform float coastOrigin;
  varying vec2 vWaterCoord;
  float waterHash(vec2 p) {
    // Wrap lattice coordinates so noise shares the floating-origin period.
    p = mod(p, 64.0);
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float waterNoise(vec2 p) {
    vec2 cell = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(waterHash(cell), waterHash(cell + vec2(1.0, 0.0)), f.x),
      mix(waterHash(cell + vec2(0.0, 1.0)), waterHash(cell + vec2(1.0)), f.x), f.y);
  }
  float swell(vec2 p) {
    vec2 q = p * 0.0015339807879;
    return sin(q.x * 83.0 + q.y * 29.0 - coastTime * 1.1)
      + 0.45 * sin(q.x * 47.0 - q.y * 53.0 - coastTime * 0.73);
  }
`;

export function createPondMaterial() {
  return new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .72, metalness: .03 });
}

export function createWaterMaterial(lake = false) {
  return animatedWaterMaterial({ lake });
}

export function createRiverMaterial() {
  return animatedWaterMaterial({ lake: true, river: true });
}

function animatedWaterMaterial({ lake = false, river = false }) {
  const material = createPondMaterial();
  material.onBeforeCompile = shader => {
    shader.uniforms.coastTime = waterClock.time; shader.uniforms.coastOrigin = waterClock.origin;
    shader.vertexShader = declarations + (river ? 'attribute vec2 riverCoord;\n' : '') + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vec4 waterWorld = modelMatrix * vec4(position, 1.0);
      vWaterCoord = ${river ? 'riverCoord' : 'vec2(waterWorld.x, waterWorld.z - coastOrigin)'};
      ${lake ? '// Pond ripples stay in the surface shading so the clipped shoreline stays sealed.' : 'transformed.y += swell(vWaterCoord) * 0.19;'}
    `);
    shader.fragmentShader = declarations + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      // River coordinates follow the banks. Advect every layer together at
      // 0.55 metres per second, so the highlights travel with the current.
      vec2 waterCoord = vWaterCoord ${river ? '- vec2(0.0, coastTime * 0.55)' : ''};
      vec2 q = waterCoord * 0.0015339807879;
      vec2 drift = waterCoord / 64.0 ${river ? '' : '+ vec2(-coastTime * 0.013, coastTime * 0.007)'};
      float bend = waterNoise(drift * 2.0);
      float detail = waterNoise(drift * 4.0 + vec2(19.3, 7.1));
      // Distort the crests and break them into uneven patches instead of
      // intersecting regularly spaced sine bands (which read as a grid).
      float phase = q.x * 284.0 + q.y * 92.0 ${river ? '' : '- coastTime * 1.3'}
        + (bend - 0.5) * 4.0 + (detail - 0.5) * 1.2;
      float wave = sin(phase);
      float crestPatch = waterNoise(drift * 8.0 + vec2(bend * 1.7, 11.6));
      float glint = pow(max(0.0, wave), 24.0) * smoothstep(0.38, 0.73, crestPatch);
      diffuseColor.rgb *= 0.97 + 0.035 * ${river ? '(sin(q.x * 83.0 + q.y * 29.0) + 0.45 * sin(q.x * 47.0 - q.y * 53.0))' : 'swell(vWaterCoord)'};
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.79, 0.94, 0.91), glint * ${lake ? '0.035' : '0.055'});
    `);
  };
  material.customProgramCacheKey = () => `coast-water-${river ? 'river' : lake ? 'lake' : 'ocean'}-v5`;
  return material;
}

export function createSurfMaterial(moving = false) {
  // Thin foam surfaces need both sides visible, but not separate back/front passes.
  const material = new THREE.MeshBasicMaterial({ color: '#f4fdff', toneMapped: false, transparent: true, opacity: .96, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });
  material.onBeforeCompile = shader => {
    shader.uniforms.coastTime = waterClock.time; shader.uniforms.coastOrigin = waterClock.origin;
    shader.vertexShader = declarations + `
      attribute float surfEdge; varying float vSurfEdge;
      ${moving ? 'attribute vec3 surfFlow; varying float vSurfFade;' : ''}
    ` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vSurfEdge = surfEdge;
      ${moving ? `
        vec4 baseWorld = modelMatrix * vec4(position, 1.0);
        vec2 baseCoord = vec2(baseWorld.x, baseWorld.z - coastOrigin);
        float localPhase = waterNoise(baseCoord / 64.0 + vec2(5.7, 21.3));
        float progress = fract(coastTime * 0.16 + surfFlow.z + localPhase * 0.55);
        transformed.xz += surfFlow.xy * progress * 10.0;
        vSurfFade = sin(progress * 3.14159265);
      ` : ''}
      vec4 waterWorld = modelMatrix * vec4(transformed, 1.0);
      vWaterCoord = vec2(waterWorld.x, waterWorld.z - coastOrigin);
      transformed.y += swell(vWaterCoord) * 0.19;
    `);
    shader.fragmentShader = declarations + 'varying float vSurfEdge;\n' + (moving ? 'varying float vSurfFade;\n' : '') + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float foamPatch = waterNoise(vWaterCoord / 4.0 + vec2(-coastTime * 0.06, coastTime * 0.04));
      float grain = waterNoise(vWaterCoord * 1.35 + vec2(coastTime * 0.12, -coastTime * 0.08));
      float edge = vSurfEdge + (foamPatch - 0.5) * 0.5 + (grain - 0.5) * 0.13;
      float feather = smoothstep(0.0, 0.14, edge) * (1.0 - smoothstep(0.45, 0.96, edge));
      float lace = smoothstep(0.24, 0.63, foamPatch * 0.65 + grain * 0.35);
      diffuseColor.a *= ${moving ? 'vSurfFade *' : ''} feather * (0.34 + lace * 0.66);
    `);
  };
  material.customProgramCacheKey = () => `coast-surf-${moving ? 'rolling' : 'wash'}-v5`;
  return material;
}

export function createRockWashMaterial() {
  const material = new THREE.MeshBasicMaterial({ color: '#effcff', toneMapped: false, transparent: true, opacity: .9, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });
  material.onBeforeCompile = shader => {
    shader.uniforms.coastTime = waterClock.time; shader.uniforms.coastOrigin = waterClock.origin;
    shader.vertexShader = declarations + 'attribute vec2 rockWash; varying vec2 vRockWash;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vRockWash = rockWash;
      vec4 waterWorld = modelMatrix * vec4(position, 1.0);
      vWaterCoord = vec2(waterWorld.x, waterWorld.z - coastOrigin);
      transformed.y += swell(vWaterCoord) * 0.19;
    `);
    shader.fragmentShader = declarations + 'varying vec2 vRockWash;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      vec2 drift = vWaterCoord / 4.0 + vec2(-coastTime * 0.09, coastTime * 0.025);
      float washNoise = waterNoise(drift);
      float froth = waterNoise(drift * 4.0 + vec2(7.3, 19.1));
      float surge = 0.5 + 0.5 * sin(coastTime * 1.05 + vRockWash.y);
      // Fade out through a ragged edge instead of outlining a hollow ring.
      float reach = 0.4 + washNoise * 0.35 + surge * 0.2;
      float edgeFade = 1.0 - smoothstep(reach * 0.3, reach, vRockWash.x);
      float breakup = smoothstep(0.2, 0.7, washNoise * 0.65 + froth * 0.35);
      diffuseColor.a *= edgeFade * (0.2 + breakup * 0.8) * (0.65 + surge * 0.35);
    `);
  };
  material.customProgramCacheKey = () => 'coast-rock-wash-v1';
  return material;
}

export function animateWater(time, origin) {
  waterClock.time.value = time;
  waterClock.origin.value = ((origin % 4096) + 4096) % 4096;
}
