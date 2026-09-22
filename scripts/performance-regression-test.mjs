import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const url = process.env.TEST_URL ?? 'http://127.0.0.1:5173';
await mkdir('.artifacts/performance/regressions', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], requests = [], report = [];
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || /THREE.WebGLProgram|GL_INVALID/.test(message.text())) errors.push(message.text()); });
  page.on('request', request => requests.push(request.url()));
  await page.addInitScript(() => localStorage.setItem('citydriver.graphics', JSON.stringify({ mode: 'basic' })));
  await page.goto(`${url}/?seed=4817`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__citydriver && document.querySelector('#loading.loaded'), null, { timeout: 90000 });
  assert.ok(!requests.some(url => url.includes('ambient-occlusion-pass')), 'optional shading is not requested at startup');
  const minimap = await page.evaluate(async () => {
    const { CityMapCache, buildMapBlock } = await import('/src/city-map.js');
    const { cityCell } = await import('/src/world/city-grid.js');
    const cache = new CityMapCache(), results = [];
    for (const vehicle of [{ s: 24, u: 3 }, { s: -2100, u: -1400 }, { s: 4200, u: 980 }]) {
      const { ix, iz } = cityCell(vehicle.s, vehicle.u);
      for (const ratio of [1, 1.1, 2]) {
        const canvases = [document.createElement('canvas'), document.createElement('canvas')];
        for (const canvas of canvases) { canvas.width = Math.floor(208 * ratio); canvas.height = Math.floor(144 * ratio); }
        const [cached, direct] = canvases.map(canvas => canvas.getContext('2d', { willReadFrequently: true }));
        for (const ctx of [cached, direct]) {
          ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.fillStyle = '#20383e'; ctx.fillRect(0, 0, 208, 144);
        }
        cache.update(ix, iz); cache.draw(cached, vehicle, .36, 208, 144);
        // Replay the original pixel-space polygon algorithm as an independent
        // reference for cached Path2D transforms, curves and painter ordering.
        for (let x = ix - 4; x <= ix + 4; x++) for (let z = iz - 3; z <= iz + 3; z++) {
          for (const shape of buildMapBlock(x, z).shapes) {
            direct.fillStyle = shape.color; direct.beginPath();
            shape.points.forEach((p, i) => direct[i ? 'lineTo' : 'moveTo'](104 + (p.u - vehicle.u) * .36, 72 - (p.s - vehicle.s) * .36));
            direct.closePath(); direct.fill();
          }
        }
        const [a, b] = [cached, direct].map(ctx => ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data);
        let difference = 0;
        for (let i = 0; i < a.length; i++) difference += Math.abs(a[i] - b[i]);
        results.push({ ...vehicle, ratio, meanChannelDifference: difference / a.length, blocks: cache.blocks.size });
      }
    }
    return results;
  });
  assert.ok(minimap.every(result => result.meanChannelDifference < .15 && result.blocks === 63), 'cached minimap matches direct rendering');
  report.push({ minimap });
  const shading = await page.evaluate(async () => {
    const a = window.__citydriver, r = a.rendering.renderer, ao = a.rendering.ambientOcclusion;
    a.beginFree(); a.action('pause'); r.setAnimationLoop(null);
    document.querySelector('#pause-overlay').hidden = true;
    a.world.update(a.vehicle.s, a.vehicle.u); a.vehicle.render(1, a.world.origin);
    a.rendering.snap(); a.rendering.update(a.vehicle.car, 1, a.world.origin);
    // Camera changes expose different storefronts. Upload shared sign textures
    // first so lazy texture uploads cannot masquerade as retained AO targets.
    for (const material of Object.values(a.world.materials)) if (material.map) r.initTexture(material.map);
    const states = [];
    for (let cycle = 0; cycle < 3; cycle++) {
      a.graphics.toggleAmbientOcclusion(); a.rendering.render(); await ao.ready;
      if (!ao.effect) throw new Error('AO did not initialize');
      a.rendering.setView(cycle === 1 ? 5 : 2); a.rendering.update(a.vehicle.car, 1, a.world.origin);
      a.rendering.render();
      states.push({ enabled: true, textures: r.info.memory.textures, calls: r.info.render.calls, triangles: r.info.render.triangles, carVisible: a.vehicle.car.visible });
      a.graphics.toggleAmbientOcclusion(); a.rendering.render();
      if (ao.effect !== null) throw new Error('AO targets were retained after disabling');
      states.push({ enabled: false, textures: r.info.memory.textures, calls: r.info.render.calls, triangles: r.info.render.triangles, carVisible: a.vehicle.car.visible });
      if (!r.autoClear || !r.shadowMap.autoUpdate || !a.world.scene.matrixWorldAutoUpdate || a.world.scene.overrideMaterial !== null || r.getRenderTarget() !== null) {
        throw new Error('AO changed renderer state');
      }
    }
    return states;
  });
  assert.ok(shading.every(state => state.carVisible), 'first-person rendering restores car visibility');
  assert.ok(shading.every(state => state.triangles > 1000), 'the city renders with AO on and off in both camera projections');
  assert.ok(shading[5].textures <= shading[1].textures + 1, 'repeated AO toggles do not leak render targets');
  report.push({ shading });
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    // Viewport emulation can finish before the application's resize event.
    await page.waitForFunction(({ width, height }) => {
      const canvas = window.__citydriver.rendering.renderer.domElement;
      return canvas.width === width && canvas.height === height;
    }, viewport);
    const views = await page.evaluate(async () => {
      const a = window.__citydriver, r = a.rendering.renderer;
      const { cityLayout } = await import('/src/world/city-layout.js');
      const { cityCell } = await import('/src/world/city-grid.js');
      const results = [];
      for (const [s, u] of [[105, 3], [118, 3], [-2100, -1400]]) {
        const p = cityLayout(s, u); Object.assign(a.vehicle, p); a.vehicle.speed = 0; a.vehicle.update(0, {});
        a.world.update(p.s, p.u, { budgetMs: 0 });
        if ([...a.world.collisionChunks(p.s, p.u)].length !== 9) throw new Error('nearby collisions missing');
        const cell = cityCell(p.s, p.u);
        for (let x = cell.ix - 5; x <= cell.ix + 5; x++) for (let z = cell.iz - 5; z <= cell.iz + 5; z++) {
          if (a.world.chunks.has(`${x},${z}`) === a.world.distantChunks.has(`${x},${z}`)) throw new Error('hole or duplicate detail level');
        }
        a.vehicle.render(1, a.world.origin);
        for (let view = 0; view < 6; view++) {
          a.rendering.setView(view); a.rendering.snap(); a.rendering.update(a.vehicle.car, 2, a.world.origin);
          a.world.animate(42, 42, a.rendering.camera); a.rendering.render();
          results.push({ s, u, view, calls: r.info.render.calls, triangles: r.info.render.triangles });
        }
      }
      return { views: results, buffer: [r.domElement.width, r.domElement.height] };
    });
    assert.deepEqual(views.buffer, [viewport.width, viewport.height], 'Basic caps a 3x phone at one device pixel per CSS pixel');
    assert.ok(views.views.every(view => view.calls > 0 && view.triangles > 1000));
    report.push({ viewport, ...views });
    await page.screenshot({ path: `.artifacts/performance/regressions/${viewport.width}.png` });
  }
  const override = await page.evaluate(() => {
    const a = window.__citydriver;
    a.graphics.setDensity(1); const native = [a.rendering.renderer.domElement.width, a.rendering.renderer.domElement.height];
    a.graphics.setMode('basic'); return native;
  });
  assert.deepEqual(override, [844 * 3, 390 * 3], 'explicit native resolution is preserved');
  assert.deepEqual(errors, []);
  await writeFile('.artifacts/performance/regressions/report.json', JSON.stringify(report, null, 2));
  console.log('Performance regressions passed: cached minimap equivalence, lazy AO, GPU cleanup, all six cameras, staged coverage, origin rebasing, portrait/landscape, and native-density override.');
} finally { await browser.close(); }
