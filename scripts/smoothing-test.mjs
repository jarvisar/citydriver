import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], results = [];
try {
  for (const quality of ['high', 'basic']) {
    const page = await browser.newPage({ viewport: quality === 'high' ? { width: 640, height: 420 } : { width: 390, height: 600 } });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
    await page.addInitScript(mode => localStorage.setItem('citydriver.graphics', JSON.stringify({ mode })), quality);
    await page.goto(`${process.env.TEST_URL ?? 'http://127.0.0.1:5173'}/?seed=4817`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__citydriver && document.querySelector('#loading.loaded'), null, { timeout: 90000 });
    results.push(...await page.evaluate(async quality => {
      const a = window.__citydriver, r = a.rendering.renderer, gl = r.getContext(), results = [];
      a.beginFree(); a.action('pause'); r.setAnimationLoop(null);
      const { cityLanePose } = await import('/src/world/city-layout.js');
      const capture = () => {
        a.rendering.render();
        const pixels = new Uint8Array(r.domElement.width * r.domElement.height * 4);
        gl.readPixels(0, 0, r.domElement.width, r.domElement.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return { pixels, calls: r.info.render.calls, triangles: r.info.render.triangles };
      };
      for (const s of [24, 136, -2100]) {
        Object.assign(a.vehicle, cityLanePose('north', 3, s)); a.vehicle.speed = 0; a.vehicle.update(0, {});
        a.world.update(a.vehicle.s, a.vehicle.u); a.vehicle.render(1, a.world.origin); a.traffic.render(1, a.world.origin);
        for (const weather of ['sunset', 'night']) for (const view of [2, 4, 5]) {
          a.rendering.setView(view); a.rendering.snap(); a.rendering.update(a.vehicle.car, 1, a.world.origin);
          a.weather.setMode(weather, { immediate: true }); a.weather.update(0, a.vehicle, a.world.origin);
          a.rendering.setWeather(a.weather.state, 0); a.world.animate(0, 0, a.rendering.camera);
          const camera = a.rendering.camera, far = camera.far, bounds = [];
          // Warm shaders and texture uploads before comparing the same scene.
          capture(); const optimized = capture();
          a.world.distantGroup.traverse(mesh => {
            if (!mesh.isInstancedMesh) return;
            bounds.push([mesh, mesh.boundingSphere.clone()]); mesh.computeBoundingSphere();
            if (mesh.name === 'citydriver-water') mesh.boundingSphere.radius += .12;
            // A full upload is an independent check on retained buffers after
            // the adjacent-block crossing, including water's interleaved data.
            for (const attribute of [mesh.instanceMatrix, mesh.instanceColor, mesh.geometry.getAttribute('riverAddress0')?.data]) {
              if (attribute) { attribute.clearUpdateRanges(); attribute.needsUpdate = true; }
            }
          });
          camera.far = 1200; camera.updateProjectionMatrix();
          const reference = capture();
          camera.far = far; camera.updateProjectionMatrix();
          for (const [mesh, bound] of bounds) mesh.boundingSphere.copy(bound);
          let difference = 0, changed = 0;
          for (let i = 0; i < optimized.pixels.length; i += 4) {
            let largest = 0;
            for (let c = 0; c < 3; c++) {
              const delta = Math.abs(optimized.pixels[i + c] - reference.pixels[i + c]);
              difference += delta; largest = Math.max(largest, delta);
            }
            if (largest > 8) changed++;
          }
          results.push({ quality, s, weather, view, far, optimized: { calls: optimized.calls, triangles: optimized.triangles },
            reference: { calls: reference.calls, triangles: reference.triangles },
            meanChannelDifference: difference / (optimized.pixels.length * .75), changedFraction: changed / (optimized.pixels.length / 4) });
        }
      }
      return results;
    }, quality));
    await page.close();
  }
  await mkdir('.artifacts/performance/smoothing', { recursive: true });
  await writeFile('.artifacts/performance/smoothing/images.json', JSON.stringify(results, null, 2));
  assert.deepEqual(errors, []);
  assert.ok(results.every(r => r.meanChannelDifference < .15 && r.changedFraction < .002), 'optimized rendering matches the full-distance reference');
  assert.ok(results.some(r => r.view >= 4 && r.optimized.triangles < r.reference.triangles * .9), 'fully fogged geometry is culled');
  console.log(`Smoothing checks passed: ${results.length} image comparisons across quality, cameras, weather and rebasing.`);
} finally { await browser.close(); }
