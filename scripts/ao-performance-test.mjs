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
    const result = await page.evaluate(async baseline => {
      const { rendering: r } = window.__coastline;
      const { AmbientOcclusion } = await import('/src/ambient-occlusion.js');
      // AO_BASELINE_MODULE times another implementation on the same buffers.
      const Baseline = baseline ? (await import(baseline)).AmbientOcclusion : null;
      const gl = r.renderer.getContext();
      const extension = gl.getExtension('WEBGL_debug_renderer_info');
      const measure = profile => {
        const texturesBefore = r.renderer.info.memory.textures;
        const ao = new (profile === 'baseline' ? Baseline : AmbientOcclusion)(r.renderer, r.scene, r.camera);
        if (profile === 'baseline') ao.setQuality('balanced');
        else if (profile === 'off') ao.enabled = false;
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
          depthSize: [ao.pass.width, ao.pass.height], aoSize: [target.width, target.height],
          sampleWork: target.width * target.height * ao.pass.configuration.aoSamples,
          drawCalls: r.renderer.info.render.calls };
        ao.dispose();
        if (profile !== 'off' && r.renderer.info.memory.textures !== texturesBefore) {
          throw new Error(`${profile}: disposing AO must release all of its textures`);
        }
        return result;
      };
      return { gpu: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unknown',
        buffer: [gl.canvas.width, gl.canvas.height], profiles: ['off', 'high', 'low', ...(Baseline ? ['baseline'] : [])].map(measure) };
    }, process.env.AO_BASELINE_MODULE || null);
    const [off, high, low] = result.profiles;
    // A 390 x 844 phone: depth stops at 1.5 and 1 device pixels per CSS pixel,
    // and N8AO shades at exactly half of that.
    assert.deepEqual(high.depthSize, [584, 1266]);
    assert.deepEqual(low.depthSize, [390, 844]);
    for (const profile of [high, low]) assert.deepEqual(profile.aoSize, profile.depthSize.map(size => size / 2), 'AO is exactly half its depth');
    assert.ok(low.sampleWork < high.sampleWork / 2, 'Low has a distinctly cheaper AO budget on a dense screen');
    assert.ok(off.drawCalls < low.drawCalls, 'disabling AO skips the extra geometry pass');
    results.push({ journey, ...result });
  }
  assert.deepEqual(errors, []);
  await mkdir('.artifacts/ambient-occlusion', { recursive: true });
  await writeFile('.artifacts/ambient-occlusion/performance.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
