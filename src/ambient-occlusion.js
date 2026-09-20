import * as THREE from 'three';
import { N8AOPass } from 'n8ao';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// A small, independent AO buffer keeps the normal scene's antialiasing,
// tone mapping and unlit effects intact. No full-resolution color buffers.
export class AmbientOcclusion {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.enabled = true;
    this.size = new THREE.Vector2();
    this.hidden = [];
    this.pass = new N8AOPass(scene, camera, 2, 2);
    this.pass.setQualityMode('Medium');
    Object.assign(this.pass.configuration, {
      aoRadius: 2.4, distanceFalloff: 1, intensity: 2,
      halfRes: true, gammaCorrection: false, autoRenderBeauty: false,
      transparencyAware: false, accumulate: false, depthAwareUpsampling: false,
    });
    this.pass.setDisplayMode('AO');
    // Depth is sampled with nearest filtering. Keep the denoiser's AO samples
    // on that same surface instead of blending across silhouettes first.
    for (const target of [this.pass.writeTargetInternal, this.pass.readTargetInternal, this.pass.accumulationRenderTarget]) {
      target.texture.minFilter = target.texture.magFilter = THREE.NearestFilter;
    }
    // Supply depth and normals without rendering lighting a second time. N8AO
    // reconstructs its own normals; ours guide the final surface-aware upscale.
    this.normalMaterial = new THREE.MeshNormalMaterial();
    this.pass.beautyRenderTarget.texture.type = THREE.UnsignedByteType;
    this.aoTarget = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false });
    this.material = new THREE.ShaderMaterial({
      name: 'Soft ambient occlusion',
      uniforms: {
        tAO: { value: this.aoTarget.texture },
        tDepth: { value: this.pass.beautyRenderTarget.depthTexture },
        tNormal: { value: this.pass.beautyRenderTarget.texture },
        tSampleDepth: { value: this.pass.depthDownsampleTarget.textures[0] },
        tSampleNormal: { value: this.pass.depthDownsampleTarget.textures[1] },
        aoSize: { value: new THREE.Vector2(1, 1) },
        inverseProjection: { value: new THREE.Matrix4() },
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
        #include <packing>
        uniform sampler2D tAO;
        uniform sampler2D tDepth;
        uniform sampler2D tNormal;
        uniform sampler2D tSampleDepth;
        uniform sampler2D tSampleNormal;
        uniform vec2 aoSize;
        uniform mat4 inverseProjection;
        uniform float intensity;
        varying vec2 vUv;
        vec3 viewPosition(vec2 uv, float depth) {
          vec4 position = inverseProjection * vec4(vec3(uv, depth) * 2.0 - 1.0, 1.0);
          return position.xyz / position.w;
        }
        float surfaceAO(float depth) {
          vec3 center = viewPosition(vUv, depth);
          vec3 normal = unpackRGBToNormal(texture2D(tNormal, vUv).rgb);
          vec2 pixel = vUv * aoSize - 0.5;
          vec2 base = floor(pixel), fraction = fract(pixel);
          float shade = 0.0, weightSum = 0.0;
          // Upscale using only samples on this surface. Ordinary bilinear
          // filtering drags dark background pixels over moving silhouettes.
          for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) {
            vec2 offset = vec2(float(x), float(y));
            vec2 uv = (clamp(base + offset, vec2(0.0), aoSize - 1.0) + 0.5) / aoSize;
            float sampleDepth = texture2D(tSampleDepth, uv).r;
            vec3 sampleNormal = texture2D(tSampleNormal, uv).rgb;
            float planeDistance = abs(dot(viewPosition(uv, sampleDepth) - center, normal));
            float sameSurface = (1.0 - smoothstep(0.05, 0.3, planeDistance))
              * smoothstep(0.8, 0.98, dot(normal, sampleNormal)) * (1.0 - step(1.0, sampleDepth));
            vec2 weights = mix(1.0 - fraction, fraction, offset);
            float weight = weights.x * weights.y * sameSurface;
            shade += (texture2D(tAO, uv).r - 1.0) * weight;
            weightSum += weight;
          }
          // Thin features with no matching coarse sample stay unoccluded;
          // fade weak support smoothly instead of popping to a dark neighbor.
          return 1.0 + shade / max(weightSum, 0.2);
        }
        void main() {
          float depth = texture2D(tDepth, vUv).r;
          float ao = depth >= 1.0 ? 1.0 : surfaceAO(depth);
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
      const scale = Math.min(.5, 640 / Math.max(this.size.x, this.size.y));
      const width = Math.max(1, Math.round(this.size.x * scale)) * 2;
      const height = Math.max(1, Math.round(this.size.y * scale)) * 2;
      const cameraChanged = Boolean(pass.camera.isOrthographicCamera) !== Boolean(camera.isOrthographicCamera);
      pass.camera = camera;
      if (pass.width !== width || pass.height !== height) pass.setSize(width, height);
      if (this.aoTarget.width !== width / 2 || this.aoTarget.height !== height / 2) this.aoTarget.setSize(width / 2, height / 2);
      // N8AO specializes its shaders for the camera projection at creation.
      if (cameraChanged) {
        pass.configureSampleDependentPasses();
        pass.configureEffectCompositer(pass.configuration.depthBufferType, camera.isOrthographicCamera);
      }
      this.material.uniforms.aoSize.value.set(width / 2, height / 2);
      this.material.uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);
      // Foam, mist, flakes and other overlays must not become opaque AO casters.
      scene.traverseVisible(this.hideOverlay);
      renderer.shadowMap.autoUpdate = false;
      // The color pass already updated every transform. AO uses the same pose.
      scene.matrixWorldAutoUpdate = false;
      scene.overrideMaterial = this.normalMaterial;
      scene.background = null;
      renderer.setRenderTarget(pass.beautyRenderTarget);
      renderer.render(scene, camera);
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
    this.material.dispose();
    this.quad.dispose();
  }
}
