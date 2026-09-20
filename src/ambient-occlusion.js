import * as THREE from 'three';
import { N8AOPass } from 'n8ao';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Bound the expensive sampling work independently of the display's pixel ratio.
// Depth-aware upsampling preserves silhouettes; the color pass keeps its MSAA.
export const AO_QUALITY = {
  high: { maxSize: 1280, aoSamples: 32, denoiseSamples: 16, denoiseIterations: 2 },
  balanced: { maxSize: 768, aoSamples: 16, denoiseSamples: 8, denoiseIterations: 1 },
};

export class AmbientOcclusion {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.enabled = true;
    this.size = new THREE.Vector2();
    this.hidden = [];
    this.pass = new N8AOPass(scene, camera, 2, 2);
    Object.assign(this.pass.configuration, {
      aoRadius: 2.4, distanceFalloff: 1, intensity: 2,
      halfRes: true, gammaCorrection: false, autoRenderBeauty: false,
      transparencyAware: false, accumulate: false, depthAwareUpsampling: true,
    });
    this.setQuality('high');
    this.pass.setDisplayMode('AO');
    // Match AO and depth sampling at silhouettes to avoid pulling background
    // occlusion into a foreground pixel before the denoiser checks its depth.
    for (const target of [this.pass.writeTargetInternal, this.pass.readTargetInternal, this.pass.accumulationRenderTarget]) {
      target.texture.minFilter = target.texture.magFilter = THREE.NearestFilter;
    }
    // Draw geometry once for depth/normals, without lighting. Keep native depth
    // for the final edge check; feed a cheap downsample to the bounded AO pass.
    this.normalMaterial = new THREE.MeshNormalMaterial();
    this.pass.beautyRenderTarget.texture.type = THREE.UnsignedByteType;
    this.depthTarget = new THREE.WebGLRenderTarget(2, 2);
    this.depthTarget.depthTexture = new THREE.DepthTexture(2, 2, THREE.UnsignedIntType);
    this.depthCopyMaterial = new THREE.ShaderMaterial({
      uniforms: { tDepth: { value: this.depthTarget.depthTexture }, tNormal: { value: this.depthTarget.texture } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        uniform sampler2D tDepth;
        uniform sampler2D tNormal;
        varying vec2 vUv;
        void main() {
          gl_FragDepth = texture2D(tDepth, vUv).r;
          gl_FragColor = texture2D(tNormal, vUv);
        }
      `,
      depthFunc: THREE.AlwaysDepth, toneMapped: false,
    });
    this.depthCopy = new FullScreenQuad(this.depthCopyMaterial);
    this.aoTarget = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false });
    this.material = new THREE.ShaderMaterial({
      name: 'Soft ambient occlusion',
      uniforms: {
        tAO: { value: this.aoTarget.texture },
        tDepth: { value: this.pass.beautyRenderTarget.depthTexture },
        tFullDepth: { value: null },
        tFullNormal: { value: null },
        resolution: { value: new THREE.Vector2() },
        projectionInverse: { value: new THREE.Matrix4() },
        upsample: { value: false },
        intensity: { value: .48 },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D tAO;
        uniform sampler2D tDepth;
        uniform sampler2D tFullDepth;
        uniform sampler2D tFullNormal;
        uniform vec2 resolution;
        uniform mat4 projectionInverse;
        uniform bool upsample;
        uniform float intensity;
        varying vec2 vUv;
        vec3 viewPosition(vec2 uv, float depth) {
          vec4 position = projectionInverse * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
          return position.xyz / position.w;
        }
        void main() {
          float depth = texture2D(tFullDepth, vUv).r;
          float ao = depth >= 1.0 ? 1.0 : texture2D(tAO, vUv).r;
          if (upsample && depth < 1.0) {
            vec3 position = viewPosition(vUv, depth);
            vec3 normal = normalize(texture2D(tFullNormal, vUv).xyz * 2.0 - 1.0);
            vec2 pixel = vUv * resolution - 0.5;
            vec2 fraction = fract(pixel);
            float darkness = 0.0;
            for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) {
              vec2 offset = vec2(float(x), float(y));
              vec2 uv = (floor(pixel) + offset + 0.5) / resolution;
              float sampleDepth = texture2D(tDepth, uv).r;
              vec3 delta = viewPosition(uv, sampleDepth) - position;
              vec3 sampleNormal = normalize(texture2D(tFullNormal, uv).xyz * 2.0 - 1.0);
              vec2 weight = mix(1.0 - fraction, fraction, offset);
              // Reject other surfaces, fading unmatched samples to unshaded.
              // Renormalizing those weights would spread a shadow over an edge.
              float surface = (1.0 - smoothstep(0.1, 0.3, abs(dot(delta, normal))))
                * smoothstep(0.8, 0.95, dot(normal, sampleNormal));
              darkness += (1.0 - texture2D(tAO, uv).r) * weight.x * weight.y * surface;
            }
            ao = 1.0 - darkness;
          }
          // N8AO already fades its mask with fog; preserve the original color.
          float shade = depth >= 1.0 ? 1.0 : mix(1.0, ao, intensity);
          gl_FragColor = vec4(vec3(shade), 1.0);
        }
      `,
      blending: THREE.MultiplyBlending, transparent: true, premultipliedAlpha: true,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.quad = new FullScreenQuad(this.material);
    // Bound once: this runs over every visible object on every rendered frame.
    this.hideOverlay = object => {
      if (!object.isMesh) return;
      // Background layers still draw; they just stay out of the AO prepass,
      // which is a second pass over the whole scene's geometry.
      if (object.userData.ambientOcclusion === false) {
        this.hidden.push(object);
        object.visible = false;
        return;
      }
      const material = object.material;
      if (Array.isArray(material) ? material.every(item => !item.depthWrite) : !material.depthWrite) {
        this.hidden.push(object);
        object.visible = false;
      }
    };
  }

  setQuality(quality) {
    if (quality === this.quality) return;
    const { maxSize, ...configuration } = AO_QUALITY[quality];
    this.quality = quality;
    this.maxSize = maxSize;
    Object.assign(this.pass.configuration, configuration);
  }

  render(camera) {
    const { renderer, scene, pass } = this;
    // Keep renderer.info meaningful across the scene and postprocessing draws.
    const autoReset = renderer.info.autoReset;
    renderer.info.autoReset = false;
    if (autoReset) renderer.info.reset();
    const autoClear = renderer.autoClear;
    const shadowAutoUpdate = renderer.shadowMap.autoUpdate;
    const matrixWorldAutoUpdate = scene.matrixWorldAutoUpdate;
    const overrideMaterial = scene.overrideMaterial;
    const background = scene.background;
    const xrEnabled = renderer.xr.enabled;
    const target = renderer.getRenderTarget();
    try {
      renderer.render(scene, camera);
      if (!this.enabled) return;

      renderer.getDrawingBufferSize(this.size);
      const scale = Math.min(1, this.maxSize / Math.max(this.size.x, this.size.y));
      // Even dimensions keep half-resolution depth and AO texels aligned.
      const width = Math.max(2, Math.floor(this.size.x * scale / 2) * 2);
      const height = Math.max(2, Math.floor(this.size.y * scale / 2) * 2);
      const cameraChanged = Boolean(pass.camera.isOrthographicCamera) !== Boolean(camera.isOrthographicCamera);
      pass.camera = camera;
      if (pass.width !== width || pass.height !== height) pass.setSize(width, height);
      if (this.aoTarget.width !== width || this.aoTarget.height !== height) this.aoTarget.setSize(width, height);
      const upsample = width !== this.size.x || height !== this.size.y;
      const depthTarget = upsample ? this.depthTarget : pass.beautyRenderTarget;
      if (upsample) depthTarget.setSize(this.size.x, this.size.y);
      const uniforms = this.material.uniforms;
      uniforms.tFullDepth.value = depthTarget.depthTexture;
      uniforms.tFullNormal.value = depthTarget.texture;
      uniforms.resolution.value.set(width, height);
      uniforms.projectionInverse.value.copy(camera.projectionMatrixInverse);
      uniforms.upsample.value = upsample;
      // N8AO specializes its shaders for the camera projection at creation.
      if (cameraChanged) {
        pass.configureSampleDependentPasses();
        pass.configureEffectCompositer(pass.configuration.depthBufferType, camera.isOrthographicCamera);
      }
      // Foam, mist, flakes and other overlays must not become opaque AO casters.
      scene.traverseVisible(this.hideOverlay);
      renderer.shadowMap.autoUpdate = false;
      // The color pass already updated every transform. AO uses the same pose.
      scene.matrixWorldAutoUpdate = false;
      scene.overrideMaterial = this.normalMaterial;
      scene.background = null;
      renderer.setRenderTarget(depthTarget);
      renderer.render(scene, camera);
      if (upsample) {
        renderer.setRenderTarget(pass.beautyRenderTarget);
        this.depthCopy.render(renderer);
      }
      scene.overrideMaterial = overrideMaterial;
      scene.background = background;
      pass.render(renderer, this.aoTarget);
      renderer.setRenderTarget(target);
      renderer.autoClear = false;
      this.quad.render(renderer);
    } finally {
      for (const object of this.hidden) object.visible = true;
      this.hidden.length = 0;
      renderer.setRenderTarget(target);
      renderer.shadowMap.autoUpdate = shadowAutoUpdate;
      scene.matrixWorldAutoUpdate = matrixWorldAutoUpdate;
      scene.overrideMaterial = overrideMaterial;
      scene.background = background;
      renderer.xr.enabled = xrEnabled;
      renderer.autoClear = autoClear;
      renderer.info.autoReset = autoReset;
    }
  }

  dispose() {
    // N8AO 2.0.1 inherits Pass's empty dispose(), so release its owned resources.
    const resources = new Set();
    for (const value of Object.values(this.pass)) {
      if (value?.isWebGLRenderTarget || value?.isTexture || value?.isMaterial) resources.add(value);
      if (value?.material?.isMaterial) resources.add(value.material);
      if (value?._mesh?.geometry) resources.add(value._mesh.geometry);
    }
    for (const resource of resources) resource.dispose();
    this.aoTarget.dispose();
    this.normalMaterial.dispose();
    this.depthTarget.dispose();
    this.depthCopyMaterial.dispose();
    this.depthCopy.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}
