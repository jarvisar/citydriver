import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// Phone-sized drawing buffers on the host GPU. Timings are diagnostic, not a
// claim about phone hardware; deterministic assertions guard the work budget.
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const errors = [], results = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${process.env.TEST_URL || 'http://127.0.0.1:5173'}/?seed=21&ao=0`);
  await page.waitForFunction(() => window.__coastline && document.querySelector('#loading.loaded'));
  await page.evaluate(() => { window.__coastline.action('pause'); window.__coastline.graphics.setMode('high'); });
  for (const journey of ['coast', 'jungle']) {
    await page.evaluate(id => window.__coastline.changeJourney(id), journey);
    const result = await page.evaluate(async () => {
      const { rendering: r } = window.__coastline;
      const { AmbientOcclusion } = await import('/src/ambient-occlusion.js');
      const gl = r.renderer.getContext();
      const extension = gl.getExtension('WEBGL_debug_renderer_info');
      const measure = profile => {
        const texturesBefore = r.renderer.info.memory.textures;
        const ao = new AmbientOcclusion(r.renderer, r.scene, r.camera);
        if (profile === 'before') {
          // The previous full-resolution, 64-sample implementation.
          ao.maxSize = Infinity;
          Object.assign(ao.pass.configuration, { halfRes: false, depthAwareUpsampling: false,
            aoSamples: 64, denoiseSamples: 16, denoiseIterations: 3 });
        } else if (profile === 'off') ao.enabled = false;
        else ao.setQuality(profile);
        const pixel = new Uint8Array(4);
        // A readback waits for actual GPU completion; gl.finish alone can leave
        // Chrome's GPU-process command queue outstanding.
        const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        for (let i = 0; i < 4; i++) { ao.render(r.camera); sync(); }
        const samples = [];
        for (let i = 0; i < 15; i++) {
          const start = performance.now(); ao.render(r.camera); sync();
          samples.push(performance.now() - start);
        }
        const target = ao.pass.writeTargetInternal;
        const result = { profile, medianMs: samples.sort((a, b) => a - b)[7],
          aoSize: [target.width, target.height], samplesPerPixel: ao.pass.configuration.aoSamples,
          sampleWork: target.width * target.height * ao.pass.configuration.aoSamples,
          drawCalls: r.renderer.info.render.calls };
        ao.dispose();
        if (profile !== 'off' && r.renderer.info.memory.textures !== texturesBefore) {
          throw new Error(`${profile}: disposing AO must release all of its textures`);
        }
        return result;
      };
      return { gpu: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unknown',
        buffer: [gl.canvas.width, gl.canvas.height], profiles: ['off', 'before', 'high', 'balanced'].map(measure) };
    });
    const [off, before, high, balanced] = result.profiles;
    assert.ok(Math.max(...high.aoSize) <= 640);
    assert.ok(Math.max(...balanced.aoSize) <= 384);
    assert.ok(high.sampleWork < before.sampleWork / 20, 'High bounds AO work on a 3x phone viewport');
    assert.ok(balanced.sampleWork < high.sampleWork / 4, 'Balanced has a distinctly cheaper AO budget');
    assert.ok(off.drawCalls < balanced.drawCalls, 'disabling AO skips the extra geometry pass');
    results.push({ journey, ...result });
  }
  assert.deepEqual(errors, []);
  await mkdir('.artifacts/ambient-occlusion', { recursive: true });
  await writeFile('.artifacts/ambient-occlusion/performance.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
