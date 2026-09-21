import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { QUALITY_LEVELS, renderScale } from '../src/graphics.js';

// The quality levels, the settings panel and the adaptive controller, against a
// real renderer at three display densities. Frame delivery is fed deterministically
// so a headless software GPU's speed never decides the outcome.
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const errors = [], results = [];
  const url = process.env.TEST_URL ?? 'http://127.0.0.1:5173';
  for (const deviceScaleFactor of [1, 2, 3]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => window.__coastline && document.querySelector('#loading.loaded'));
    await page.evaluate(() => window.__coastline.action('pause'));

    const result = await page.evaluate(() => {
      const { rendering, graphics } = window.__coastline, { renderer, camera } = rendering;
      const projection = camera.projectionMatrix.toArray();
      const observer = new MutationObserver(() => {});
      observer.observe(renderer.domElement, { attributes: true, attributeFilter: ['width', 'height'] });
      const reads = () => observer.takeRecords().length;

      // Each level must reach the renderer, not just the stored preference.
      const levels = [];
      for (const id of ['high', 'balanced', 'smooth', 'basic']) {
        graphics.setMode(id);
        levels.push({ id, ratio: renderer.getPixelRatio(), width: renderer.domElement.width, height: renderer.domElement.height,
          shadow: rendering.scene.children.find(child => child.isDirectionalLight).shadow.mapSize.x,
          ambientOcclusion: rendering.ambientOcclusion.enabled, aoQuality: rendering.ambientOcclusion.quality });
      }
      graphics.toggleAmbientOcclusion();
      const enabledLevels = [];
      for (const id of ['high', 'balanced', 'smooth', 'basic', 'auto']) {
        graphics.setMode(id);
        enabledLevels.push({ enabled: rendering.ambientOcclusion.enabled, quality: rendering.ambientOcclusion.quality });
      }
      graphics.toggleAmbientOcclusion();
      reads();

      // Deterministic frame delivery. `rates` is either a fixed refresh rate or
      // the rate this pretend device reaches at each level, so stepping down
      // actually buys frames, which is the signal the controller reads.
      const order = ['high', 'balanced', 'smooth', 'basic'];
      const drive = (rates, start, seconds) => {
        graphics.sample(start, false);
        let time = start;
        for (const end = start + seconds * 1000; time < end;) {
          time += 1000 / (typeof rates === 'number' ? rates : rates[order.indexOf(graphics.levelId)]);
          graphics.sample(time, true);
        }
        return time;
      };
      graphics.setMode('high'); graphics.setMode('auto');
      reads();
      let clock = drive(60, 0, 20);
      const steady = { level: graphics.levelId, writes: reads() };
      clock = drive([24, 61, 61, 61], clock + 1000, 25);
      const slowed = { level: graphics.levelId, ratio: renderer.getPixelRatio(), softShading: graphics.settings.ambientOcclusion, writes: reads() };
      clock = drive(60, clock + 1000, 40);
      const recovered = { level: graphics.levelId, writes: reads() };

      // A pinned level ignores frame times entirely.
      graphics.setMode('high'); reads();
      clock = drive(12, clock + 1000, 30);
      const pinned = { level: graphics.levelId, writes: reads() };
      observer.disconnect();
      graphics.setMode('auto');
      renderer.render(rendering.scene, rendering.camera);
      return { levels, enabledLevels, steady, slowed, recovered, pinned,
        unchangedProjection: JSON.stringify(projection) === JSON.stringify(camera.projectionMatrix.toArray()) };
    });

    const density = id => result.levels.find(level => level.id === id);
    const expected = id => renderScale(QUALITY_LEVELS.find(level => level.id === id).density, deviceScaleFactor);
    // Every level must remove pixels at every density — the point of scaling the
    // device's own ratio rather than capping it. A cap left a 1x panel rendering
    // 1x at three of the four levels.
    for (const id of ['high', 'balanced', 'smooth', 'basic']) assert.equal(density(id).ratio, expected(id), `${id} density`);
    for (let i = 1; i < result.levels.length; i++) {
      assert.ok(result.levels[i].ratio < result.levels[i - 1].ratio, `${result.levels[i].id} must draw fewer pixels than ${result.levels[i - 1].id}`);
    }
    assert.equal(density('basic').width, Math.floor(390 * expected('basic')));
    assert.equal(density('basic').height, Math.floor(844 * expected('basic')));
    assert.deepEqual(result.levels.map(level => level.shadow), [2048, 1536, 1024, 512]);
    assert.deepEqual(result.levels.map(level => level.ambientOcclusion), [false, false, false, false]);
    assert.deepEqual(result.levels.map(level => level.aoQuality), ['high', 'high', 'low', 'low'], 'the AO budget follows the level');
    assert.ok(result.enabledLevels.every(level => level.enabled), 'no preset, nor Auto, switches the AO opt-in off');
    assert.ok(result.unchangedProjection, 'density never touches the camera projection');

    assert.equal(result.steady.level, 'high', 'a display-rate device keeps its level');
    assert.equal(result.steady.writes, 0, 'no resize without a decision');
    // Auto changes resolution without changing the independent AO choice.
    assert.equal(result.slowed.softShading, false, 'soft shading stays off');
    assert.equal(result.slowed.level, 'balanced', 'one step down per decision');
    assert.equal(result.slowed.ratio, expected('balanced'));
    // One resize writes the canvas width and height: two attribute records.
    assert.equal(result.slowed.writes, 2, 'one canvas resize per adjustment');
    assert.equal(result.recovered.level, 'balanced', 'a settled level does not climb back');
    assert.equal(result.recovered.writes, 0);
    assert.equal(result.pinned.level, 'high', 'a chosen level ignores frame times');

    // The panel reflects the renderer, and survives a rotation and a reload.
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForFunction(() => document.querySelector('#scene').style.width === '844px');
    await page.evaluate(() => window.__coastline.graphics.setMode('smooth'));
    assert.equal(await page.evaluate(() => window.__coastline.rendering.renderer.getPixelRatio()), expected('smooth'));
    assert.match(await page.locator('#graphics-status').textContent(), /^Smooth · \d+ × \d+ · soft shading off$/);
    await page.reload();
    await page.waitForFunction(() => window.__coastline && document.querySelector('#loading.loaded'));
    assert.equal(await page.evaluate(() => window.__coastline.graphics.mode), 'smooth', 'the choice is remembered');
    assert.equal(await page.locator('[data-quality="smooth"]').getAttribute('aria-checked'), 'true');

    // The slider changes the real drawing buffer, including above the old 2x cap.
    await page.evaluate(() => window.__coastline.action('pause'));
    await page.locator('#graphics-toggle').click();
    const slider = page.locator('#pixel-density');
    assert.equal(await slider.inputValue(), '70');
    await slider.fill('83');
    assert.equal(await page.evaluate(() => window.__coastline.rendering.renderer.getPixelRatio()), deviceScaleFactor * .83);
    await slider.press('ArrowRight');
    assert.equal(await slider.inputValue(), '84', 'keyboard arrows adjust density without driving');
    assert.equal(await page.evaluate(() => window.__coastline.paused), true);
    await page.evaluate(() => window.__coastline.action('menuNext'));
    assert.equal(await slider.inputValue(), '85', 'controller right adjusts density');
    await slider.press('End');
    assert.equal(await slider.inputValue(), '100');
    assert.equal(await page.locator('#pixel-density-value').textContent(), '100% · Native');
    assert.equal(await page.evaluate(() => window.__coastline.rendering.renderer.getPixelRatio()), deviceScaleFactor);
    await slider.fill('83');
    await page.reload();
    await page.waitForFunction(() => window.__coastline && document.querySelector('#loading.loaded'));
    assert.equal(await slider.inputValue(), '83', 'custom density survives reload');
    await page.evaluate(() => window.__coastline.action('pause'));
    await page.locator('#graphics-toggle').click();
    await page.locator('[data-quality="balanced"]').click();
    assert.equal(await slider.inputValue(), '85', 'a preset restores its density');
    await page.evaluate(() => window.__coastline.action('pause'));

    // The main loop must keep supplying active and inactive samples.
    await page.evaluate(() => {
      const rendering = window.__coastline.rendering, original = rendering.recordFrame;
      window.__samples = [];
      rendering.recordFrame = (time, active) => { window.__samples.push(active); return original(time, active); };
    });
    await page.waitForFunction(() => window.__samples.includes(true));
    await page.evaluate(() => window.__coastline.action('pause'));
    await page.waitForFunction(() => window.__samples.includes(false));

    results.push({ deviceScaleFactor, ...result });
    await context.close();
  }
  assert.deepEqual(errors, []);
  await mkdir('.artifacts/graphics', { recursive: true });
  await writeFile('.artifacts/graphics/report.json', JSON.stringify({ passed: true, results }, null, 2));
  console.log(JSON.stringify({ passed: true, results }, null, 2));
} finally { await browser.close(); }
