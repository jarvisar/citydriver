import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const url = process.env.TEST_URL || 'http://127.0.0.1:5173';
await mkdir('.artifacts/ambient-occlusion', { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
});
const errors = [], records = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${url}/?seed=21`);
  await page.waitForFunction(() => window.__coastline && document.querySelector('#loading.loaded'));
  await page.click('#start');
  assert.equal(await page.locator('#fps-counter').isVisible(), false);
  await page.keyboard.press('F3');
  await page.waitForFunction(() => /^\d+ FPS$/.test(document.querySelector('#fps-counter').textContent));
  await page.keyboard.press('F3');
  assert.equal(await page.locator('#fps-counter').isVisible(), false);
  assert.equal(await page.locator('#ambient-occlusion').count(), 0);
  await page.evaluate(() => window.__coastline.action('pause'));
  // Whether soft shading starts on depends on what this machine is, so pin the
  // level that has it before testing that the key turns it off and back on.
  await page.evaluate(() => window.__coastline.graphics.setMode('high'));
  assert.equal(await page.evaluate(() => window.__coastline.rendering.ambientOcclusion.enabled), true);
  await page.keyboard.press('KeyO');
  assert.equal(await page.evaluate(() => window.__coastline.rendering.ambientOcclusion.enabled), false);
  await page.keyboard.press('KeyO');
  assert.equal(await page.evaluate(() => window.__coastline.rendering.ambientOcclusion.enabled), true);

  for (const journey of ['coast', 'desert', 'snow', 'jungle', 'plains', 'city', 'coast']) {
    await page.evaluate(id => window.__coastline.changeJourney(id), journey);
    for (const perspective of [false, true]) {
      const result = await page.evaluate(perspective => {
        const a = window.__coastline, r = a.rendering, ao = r.ambientOcclusion;
        const label = perspective ? 'Third-person view' : 'Extra close view';
        for (let i = 0; i < 5 && r.viewLabel !== label; i++) r.toggleView();
        r.snap(); r.update(a.vehicle.car, 10, a.world.origin);
        const gl = r.renderer.getContext(), canvas = gl.canvas;
        const pixels = () => {
          const data = new Uint8Array(canvas.width * canvas.height * 4);
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
          return data;
        };
        ao.enabled = false; r.render();
        const off = pixels(), offImage = canvas.toDataURL();
        r.renderer.render(r.scene, r.camera);
        const direct = pixels();
        ao.enabled = true;
        const strength = ao.material.uniforms.intensity.value;
        ao.material.uniforms.intensity.value = 0; r.render();
        const neutral = pixels();
        ao.material.uniforms.intensity.value = strength;
        let transformUpdates = 0;
        const updateMatrices = r.scene.updateMatrixWorld;
        r.scene.updateMatrixWorld = function (...args) { transformUpdates++; return updateMatrices.apply(this, args); };
        try { r.render(); } finally { r.scene.updateMatrixWorld = updateMatrices; }
        const on = pixels(), onImage = canvas.toDataURL();
        // Compare against automatic scenery transforms and a fresh AO traversal.
        // Dense foliage makes this GPU redraw an identical jungle frame with a
        // few thousand channels different about once in ten frames, so a single
        // comparison cannot tell a transform regression from that. A real
        // regression repeats; the artifact does not, so take the best of three.
        const channelError = (x, y) => {
          let error = 0;
          for (let i = 0; i < x.length; i++) error = Math.max(error, Math.abs(x[i] - y[i]));
          return error;
        };
        const automaticTransforms = () => {
          const frozen = [], renderAO = ao.pass.render;
          r.scene.traverse(object => { if (!object.matrixAutoUpdate) { frozen.push(object); object.matrixAutoUpdate = true; } });
          ao.pass.render = function (...args) {
            const previous = r.scene.matrixWorldAutoUpdate;
            r.scene.matrixWorldAutoUpdate = true;
            try { return renderAO.apply(this, args); } finally { r.scene.matrixWorldAutoUpdate = previous; }
          };
          try { r.render(); } finally {
            ao.pass.render = renderAO;
            for (const object of frozen) object.matrixAutoUpdate = false;
          }
          return pixels();
        };
        let automatic = automaticTransforms();
        let transformError = channelError(on, automatic);
        for (let attempt = 0; attempt < 2 && transformError > 1; attempt++) {
          r.render();
          const cached = pixels();
          automatic = automaticTransforms();
          transformError = Math.min(transformError, channelError(cached, automatic));
        }
        let darkened = 0, brightened = 0, difference = 0, offError = 0, neutralError = 0;
        for (let i = 0; i < off.length; i += 4) {
          const delta = (off[i] + off[i + 1] + off[i + 2] - on[i] - on[i + 1] - on[i + 2]) / 3;
          if (delta > 2) darkened++;
          if (delta < -1) brightened++;
          difference += delta;
          for (let c = 0; c < 3; c++) {
            offError = Math.max(offError, Math.abs(off[i + c] - direct[i + c]));
            neutralError = Math.max(neutralError, Math.abs(off[i + c] - neutral[i + c]));
          }
        }
        // Repeated toggles reuse buffers, including while the game is paused.
        const textures = r.renderer.info.memory.textures;
        for (let i = 0; i < 6; i++) { ao.enabled = i % 2 === 1; r.render(); }
        const extension = gl.getExtension('WEBGL_debug_renderer_info');
        return {
          perspective, darkened, brightened, averageDarkening: difference / (off.length / 4), offError, neutralError,
          transformUpdates, transformError, autoUpdateRestored: r.scene.matrixWorldAutoUpdate,
          textures, texturesAfter: r.renderer.info.memory.textures, aoSize: [ao.pass.writeTargetInternal.width, ao.pass.writeTargetInternal.height],
          gpu: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unknown',
          offImage, onImage,
        };
      }, perspective);
      assert.ok(result.darkened > 50, `${journey}: shading must affect visible geometry`);
      assert.equal(result.brightened, 0, `${journey}: AO must only darken`);
      assert.ok(result.offError <= 1, 'disabled AO preserves original rendering within GPU rounding');
      assert.ok(result.neutralError <= 1, 'zero-strength AO preserves lighting, fog, sky and antialiasing within GPU rounding');
      assert.equal(result.transformUpdates, 1, 'color and AO reuse the same scene transforms');
      assert.ok(result.transformError <= 1, 'cached transforms preserve automatic rendering within GPU rounding');
      assert.equal(result.autoUpdateRestored, true, 'the next frame must update moving objects');
      assert.ok(result.averageDarkening < 15, 'subtle AO does not dim the whole screen');
      assert.equal(result.texturesAfter, result.textures, 'toggling does not leak textures');
      assert.ok(Math.max(...result.aoSize) <= 640);
      const name = `${journey}-${perspective ? 'third-person' : 'close'}`;
      for (const mode of ['off', 'on']) {
        await writeFile(`.artifacts/ambient-occlusion/${name}-${mode}.png`, Buffer.from(result[`${mode}Image`].split(',')[1], 'base64'));
        delete result[`${mode}Image`];
      }
      records.push({ journey, ...result });
    }
  }
  assert.equal(records[0].textures, records.at(-1).textures, 'returning to coast releases route resources');
  const timings = await page.evaluate(() => {
    const { rendering: r } = window.__coastline, gl = r.renderer.getContext();
    const measure = enabled => {
      r.ambientOcclusion.enabled = enabled;
      for (let i = 0; i < 4; i++) r.render();
      const samples = [];
      for (let i = 0; i < 16; i++) {
        gl.finish(); const start = performance.now(); r.render(); gl.finish();
        samples.push(performance.now() - start);
      }
      return samples.sort((a, b) => a - b)[8];
    };
    return { offMs: measure(false), onMs: measure(true) };
  });
  await page.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  mobile.on('pageerror', error => errors.push(error.message));
  mobile.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await mobile.goto(`${url}/?seed=21&ao=0`);
  await mobile.waitForFunction(() => window.__coastline);
  assert.equal(await mobile.evaluate(() => window.__coastline.rendering.ambientOcclusion.enabled), false);
  await mobile.evaluate(() => window.__coastline.action('ambientOcclusion'));
  assert.equal(await mobile.evaluate(() => window.__coastline.rendering.ambientOcclusion.enabled), true);
  for (const [width, height] of [[320, 568], [390, 844], [844, 390]]) {
    await mobile.setViewportSize({ width, height });
    await mobile.evaluate(() => window.__coastline.rendering.render());
    const size = await mobile.evaluate(() => {
      const r = window.__coastline.rendering;
      const target = r.ambientOcclusion.pass.writeTargetInternal;
      return { ao: [target.width, target.height], overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.ok(Math.max(...size.ao) <= 640, 'AO stays capped at high display density');
    assert.equal(size.overflow, false);
  }
  await mobile.screenshot({ path: '.artifacts/ambient-occlusion/mobile.png' });
  assert.deepEqual(errors, []);
  const report = { passed: true, records, timings };
  await writeFile('.artifacts/ambient-occlusion/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
