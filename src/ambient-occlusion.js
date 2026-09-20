import * as THREE from 'three';
import { N8AOPass } from 'n8ao';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Render AO at the drawing-buffer resolution so moving small surfaces do not
// switch between coarse samples. The original color pass keeps its antialiasing.
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
      aoSamples: 64, denoiseSamples: 16, denoiseIterations: 3,
      aoRadius: 2.4, distanceFalloff: 1, intensity: 2,
      halfRes: false, gammaCorrection: false, autoRenderBeauty: false,
      transparencyAware: false, accumulate: false, depthAwareUpsampling: false,
    });
    this.pass.setDisplayMode('AO');
    // Match AO and depth sampling at silhouettes to avoid pulling background
    // occlusion into a foreground pixel before the denoiser checks its depth.
    for (const target of [this.pass.writeTargetInternal, this.pass.readTargetInternal, this.pass.accumulationRenderTarget]) {
      target.texture.minFilter = target.texture.magFilter = THREE.NearestFilter;
    }
    // Supply depth without rendering lighting a second time. N8AO reconstructs
    // its own normals from this full-resolution depth buffer.
    this.normalMaterial = new THREE.MeshNormalMaterial();
    this.pass.beautyRenderTarget.texture.type = THREE.UnsignedByteType;
    this.aoTarget = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false });
    this.material = new THREE.ShaderMaterial({
      name: 'Soft ambient occlusion',
      uniforms: {
        tAO: { value: this.aoTarget.texture },
        tDepth: { value: this.pass.beautyRenderTarget.depthTexture },
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
        uniform float intensity;
        varying vec2 vUv;
        void main() {
          float depth = texture2D(tDepth, vUv).r;
          float ao = depth >= 1.0 ? 1.0 : texture2D(tAO, vUv).r;
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
      const width = Math.max(1, this.size.x), height = Math.max(1, this.size.y);
      const cameraChanged = Boolean(pass.camera.isOrthographicCamera) !== Boolean(camera.isOrthographicCamera);
      pass.camera = camera;
      if (pass.width !== width || pass.height !== height) pass.setSize(width, height);
      if (this.aoTarget.width !== width || this.aoTarget.height !== height) this.aoTarget.setSize(width, height);
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
