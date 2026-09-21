import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// Compare shading at fixed points on real bale meshes and the small faceted
// shapes used elsewhere. Unlit white surfaces isolate AO from other effects.
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${process.env.TEST_URL || 'http://127.0.0.1:5173'}/?seed=21&ao=0`);
  await page.waitForFunction(() => window.__coastline);
  await page.evaluate(() => window.__coastline.action('pause'));
  const results = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { AmbientOcclusion } = await import('/src/ambient-occlusion.js');
    const { baleGeometry, squareBaleGeometry } = await import('/src/world/plains-assets.js');
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(960, 600);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('white'); scene.fog = new THREE.Fog('white', 100, 200);
    const material = new THREE.MeshBasicMaterial({ color: 'white' });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), material);
    ground.rotation.x = -Math.PI / 2; scene.add(ground);
    const shapes = [baleGeometry, squareBaleGeometry, new THREE.DodecahedronGeometry(1, 0),
      new THREE.CylinderGeometry(.6, .8, 2, 7), new THREE.SphereGeometry(1, 7, 5)];
    const names = ['round-bale', 'square-bale', 'rock', 'trunk', 'cactus'];
    const points = [];
    shapes.forEach((shape, index) => {
      const mesh = new THREE.Mesh(shape, material);
      mesh.position.set((index - 2) * 4, index === 0 ? .85 : index === 1 ? .4 : 1, 0);
      scene.add(mesh); mesh.updateMatrixWorld();
      const geometry = shape.index ? shape.toNonIndexed() : shape, positions = geometry.attributes.position;
      for (let vertex = 0; vertex < positions.count; vertex += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(positions, vertex);
        const b = new THREE.Vector3().fromBufferAttribute(positions, vertex + 1);
        const c = new THREE.Vector3().fromBufferAttribute(positions, vertex + 2);
        const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
        for (const weights of [[.34, .33, .33], [.6, .2, .2], [.2, .6, .2], [.2, .2, .6]]) {
          const point = a.clone().multiplyScalar(weights[0]).addScaledVector(b, weights[1]).addScaledVector(c, weights[2]);
          points.push({ point: point.applyMatrix4(mesh.matrixWorld), normal, shape: index });
        }
      }
      if (geometry !== shape) geometry.dispose();
      for (let x = -1.2; x < 1.3; x += .15) for (const z of [-.9, .9]) {
        points.push({ point: new THREE.Vector3(mesh.position.x + x, .01, z), normal: new THREE.Vector3(0, 1, 0), shape: index, contact: true });
      }
    });
    const results = [];
    for (const perspective of [false, true]) for (const span of [30, 75]) {
      for (const variant of ['full-resolution', 'high', 'low']) {
        const camera = perspective ? new THREE.PerspectiveCamera(50, 1.6, .1, 200)
          : new THREE.OrthographicCamera(-span * .8, span * .8, span * .5, -span * .5, .1, 200);
        camera.position.set(8, 16, 22).multiplyScalar(perspective ? span / 26 : 1);
        camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
        const origin = camera.position.clone(), right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const ao = new AmbientOcclusion(renderer, scene, camera);
        if (variant === 'full-resolution') {
          Object.assign(ao.pass.configuration, { aoSamples: 64, denoiseSamples: 16,
            denoiseIterations: 3, halfRes: false, depthAwareUpsampling: false });
        } else ao.setQuality(variant);
        const frames = [];
        for (let frame = 0; frame < 40; frame++) {
          camera.position.copy(origin).addScaledVector(right, frame * span / 600 * .27); camera.updateMatrixWorld();
          ao.render(camera);
          const gl = renderer.getContext(), pixels = new Uint8Array(960 * 600 * 4);
          gl.readPixels(0, 0, 960, 600, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          frames.push(points.map(({ point, normal }) => {
            if (normal.dot(camera.position.clone().sub(point)) <= .25) return null;
            const projected = point.clone().project(camera);
            const x = Math.floor((projected.x * .5 + .5) * 960), y = Math.floor((projected.y * .5 + .5) * 600);
            return x < 0 || x >= 960 || y < 0 || y >= 600 ? null : pixels[(y * 960 + x) * 4] / 255;
          }));
        }
        const metrics = names.map((name, shape) => {
          let change = 0, darkness = 0, count = 0, contact = 0, contacts = 0;
          for (let frame = 1; frame < frames.length; frame++) points.forEach((point, index) => {
            if (point.shape !== shape || frames[frame][index] === null || frames[frame - 1][index] === null) return;
            if (point.contact) { contact += 1 - frames[frame][index]; contacts++; return; }
            change += Math.abs(frames[frame][index] - frames[frame - 1][index]);
            darkness += 1 - frames[frame][index]; count++;
          });
          return { name, shimmer: change / count, darkness: darkness / count, contact: contact / contacts };
        });
        results.push({ perspective, span, variant, metrics }); ao.dispose();
      }
    }
    ground.geometry.dispose(); shapes.slice(2).forEach(shape => shape.dispose()); material.dispose(); renderer.dispose();
    return results;
  });
  await mkdir('.artifacts/ambient-occlusion', { recursive: true });
  await writeFile('.artifacts/ambient-occlusion/objects-motion.json', JSON.stringify(results, null, 2));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(results, null, 2));
  for (const revised of results.filter(result => result.variant !== 'full-resolution')) {
    const previous = results.find(result => result.variant === 'full-resolution' && result.span === revised.span && result.perspective === revised.perspective);
    revised.metrics.forEach((after, index) => {
      const before = previous.metrics[index];
      const label = `${revised.variant}, ${after.name}, ${revised.perspective ? 'perspective' : 'overhead'}, span ${revised.span}`;
      assert.ok(after.shimmer < .03, `${label}: keep frame-to-frame shading changes under 3%`);
      assert.ok(after.darkness > before.darkness * .65 && after.darkness < before.darkness * 1.4, `${label}: retain object shading`);
      // Small contact shadows are only a few percent dark; compare their
      // absolute change so a one-point shift is not treated as a large error.
      assert.ok(after.contact > before.contact * .65 && Math.abs(after.contact - before.contact) < .03, `${label}: retain contact shading within three percentage points`);
    });
  }
} finally { await browser.close(); }
