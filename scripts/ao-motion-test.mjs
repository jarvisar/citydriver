import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173');
  await page.waitForFunction(() => window.__coastline);
  await page.evaluate(() => window.__coastline.action('pause'));
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { AmbientOcclusion } = await import('/src/ambient-occlusion.js');
    const renderer = new THREE.WebGLRenderer(); renderer.setSize(960, 600);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('white'); scene.fog = new THREE.Fog('white', 100, 200);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xffffff, 2));
    const material = new THREE.MeshStandardMaterial({ color: 'white' });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(50, 50), material); ground.rotation.x = -Math.PI / 2; scene.add(ground);
    for (const x of [-3, 0, 3]) for (const z of [-2, 1]) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2 + x * .2, 1.4), material);
      box.position.set(x, (2 + x * .2) / 2, z); scene.add(box);
    }
    const camera = new THREE.OrthographicCamera(-8, 8, 5, -5, .1, 100);
    camera.position.set(8, 12, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    const origin = camera.position.clone(), right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const points = [];
    for (const x of [-3, 0, 3]) for (const z of [-2, 1]) {
      for (let i = 0; i < 20; i++) for (const side of [-1, 1]) {
        points.push(new THREE.Vector3(x - 1.2 + i * .12, .01, z + side * .95));
      }
    }
    const measure = quality => {
      renderer.render(scene, camera);
      const memoryBefore = { ...renderer.info.memory };
      const ao = new AmbientOcclusion(renderer, scene, camera);
      if (quality) ao.pass.setQualityMode(quality);
      const frames = [];
      for (let frame = 0; frame < 28; frame++) {
        camera.position.copy(origin).addScaledVector(right, frame * .025); camera.updateMatrixWorld();
        ao.render(camera);
        const target = ao.aoTarget, { width, height } = target;
        const pixels = new Uint8Array(width * height * 4);
        renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
        frames.push(points.map(point => {
          const p = point.clone().project(camera), x = (p.x * .5 + .5) * width - .5, y = (p.y * .5 + .5) * height - .5;
          const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
          const sample = (dx, dy) => pixels[((iy + dy) * width + ix + dx) * 4] / 255;
          return (1 - fy) * ((1 - fx) * sample(0, 0) + fx * sample(1, 0)) + fy * ((1 - fx) * sample(0, 1) + fx * sample(1, 1));
        }));
      }
      let change = 0, darkness = 0;
      for (let f = 1; f < frames.length; f++) for (let p = 0; p < points.length; p++) {
        change += Math.abs(frames[f][p] - frames[f - 1][p]); darkness += 1 - frames[f][p];
      }
      ao.dispose();
      if (renderer.info.memory.textures !== memoryBefore.textures || renderer.info.memory.geometries !== memoryBefore.geometries) {
        throw new Error('Disposing N8AO must release its textures and geometry');
      }
      return { shimmer: change / ((frames.length - 1) * points.length), darkness: darkness / ((frames.length - 1) * points.length) };
    };
    const performance = measure('Performance'), configured = measure(null);
    scene.traverse(object => object.geometry?.dispose()); material.dispose(); renderer.dispose();
    return { performance, configured };
  });
  console.log(JSON.stringify(result, null, 2));
  await mkdir('.artifacts/ambient-occlusion', { recursive: true });
  await writeFile('.artifacts/ambient-occlusion/motion.json', JSON.stringify(result, null, 2));
  assert.ok(result.configured.shimmer < .03, 'camera motion keeps AO changes below 3% at fixed world points');
  assert.ok(result.configured.darkness > .01, 'N8AO retains contact shading');
} finally { await browser.close(); }
