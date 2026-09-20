import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${process.env.TEST_URL || 'http://127.0.0.1:5173'}/?ao=0`);
  await page.waitForFunction(() => window.__coastline);
  await page.evaluate(() => window.__coastline.action('pause'));
  const results = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { AmbientOcclusion } = await import('/src/ambient-occlusion.js');
    const renderer = new THREE.WebGLRenderer(); renderer.setSize(960, 600);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('white'); scene.fog = new THREE.Fog('white', 100, 200);
    const material = new THREE.MeshBasicMaterial({ color: 'white' });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(50, 50), material); ground.rotation.x = -Math.PI / 2; scene.add(ground);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2, 1.4), material); box.position.y = 1; scene.add(box);
    const camera = new THREE.OrthographicCamera(-8, 8, 5, -5, .1, 100);
    camera.position.set(-8, 12, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    const origin = camera.position.clone(), right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    // A floating foreground card crosses the box's contact shadow in the image,
    // but sits five meters closer to the camera, beyond the AO radius.
    const cardMaterial = new THREE.MeshBasicMaterial({ color: '#40ffff' });
    const card = new THREE.Mesh(new THREE.PlaneGeometry(1, 4), cardMaterial); card.quaternion.copy(camera.quaternion);
    card.position.set(.75, 0, -.4).addScaledVector(origin.clone().normalize(), 5).addScaledVector(right, -.5); scene.add(card);
    const points = [];
    for (let y = -.8; y < .8; y += .01) points.push(card.position.clone().addScaledVector(right, .49).addScaledVector(up, y));
    const ao = new AmbientOcclusion(renderer, scene, camera), gl = renderer.getContext(), results = [];
    for (const quality of ['high', 'balanced']) for (const ratio of [1, 3]) {
      ao.setQuality(quality); renderer.setPixelRatio(ratio);
      const width = 960 * ratio, height = 600 * ratio;
      const read = () => {
        const data = new Uint8Array(width * height * 4); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data); return data;
      };
      let samples = 0, bleeding = 0, contactPixels = 0;
      for (let frame = 0; frame < 24; frame++) {
        camera.position.copy(origin).addScaledVector(right, frame * .023); camera.updateMatrixWorld();
        ao.enabled = false; ao.render(camera); const off = read();
        ao.enabled = true; ao.render(camera); const on = read();
        for (const point of points) {
          const p = point.clone().project(camera), x = Math.floor((p.x * .5 + .5) * width), y = Math.floor((p.y * .5 + .5) * height);
          const index = (y * width + x) * 4;
          if (off[index] > 200) continue; // Only samples inside the cyan card.
          samples++;
          if (off[index + 1] - on[index + 1] > 1) bleeding++;
        }
        for (let i = 0; i < off.length; i += 4) if (off[i] > 200 && off[i + 1] - on[i + 1] > 2) contactPixels++;
      }
      results.push({ quality, ratio, samples, bleeding, contactPixels });
    }
    ao.dispose(); scene.traverse(object => object.geometry?.dispose()); material.dispose(); cardMaterial.dispose(); renderer.dispose();
    return results;
  });
  console.log(JSON.stringify(results, null, 2));
  assert.deepEqual(errors, []);
  for (const result of results) {
    assert.ok(result.samples > 3000, 'track the foreground edge across many subpixel camera positions');
    assert.equal(result.bleeding, 0, 'background AO must not crawl over the foreground silhouette');
    assert.ok(result.contactPixels > 100, 'contact shading must remain visible behind the card');
  }
} finally { await browser.close(); }
