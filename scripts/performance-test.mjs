import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const url = process.env.TEST_URL ?? 'http://127.0.0.1:5173';
const label = process.env.PERF_LABEL ?? 'current';
const directory = `.artifacts/performance/${label}`;
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [], report = [];
try {
  for (const profile of [
    { name: 'desktop', width: 1280, height: 800, dpr: 1, quality: 'high' },
    { name: 'phone', width: 390, height: 844, dpr: 3, quality: 'basic' },
  ]) {
    const page = await browser.newPage({ viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr, isMobile: profile.name === 'phone', hasTouch: profile.name === 'phone' });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
    await page.addInitScript(quality => localStorage.setItem('citydriver.graphics', JSON.stringify({ mode: quality })), profile.quality);
    await page.goto(`${url}/?seed=4817`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__citydriver && document.querySelector('#loading').classList.contains('loaded'), null, { timeout: 90000 });
    const samples = await page.evaluate(async () => {
      const a = window.__citydriver, r = a.rendering.renderer;
      a.beginFree(); a.action('pause'); r.setAnimationLoop(null);
      document.querySelector('#pause-overlay').hidden = true;
      const { cityLanePose } = await import('/src/world/city-layout.js');
      const quantiles = values => {
        const sorted = [...values].sort((a, b) => a - b);
        return { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))], max: sorted.at(-1) };
      };
      const pose = (s, u) => {
        Object.assign(a.vehicle, cityLanePose('north', u, s)); a.vehicle.speed = 0; a.vehicle.update(0, {});
        a.world.update(a.vehicle.s, a.vehicle.u);
        while (a.world.pending.length) a.world.update(a.vehicle.s, a.vehicle.u);
        a.vehicle.render(1, a.world.origin); a.traffic.render(1, a.world.origin);
        a.rendering.snap(); a.rendering.update(a.vehicle.car, 1, a.world.origin);
        a.weather.setMode('sunset', { immediate: true }); a.weather.update(0, a.vehicle, a.world.origin);
        a.rendering.setWeather(a.weather.state, 0); a.world.animate(0, 0, a.rendering.camera);
        a.cityGuide.update(false);
      };
      const views = [];
      for (const view of [2, 4]) {
        a.rendering.setView(view); pose(24, 3);
        for (let i = 0; i < 3; i++) a.rendering.render();
        const frames = [], cpu = [];
        let previous;
        for (let i = 0; i < 35; i++) {
          const timestamp = await new Promise(requestAnimationFrame);
          const start = performance.now();
          a.world.animate(i / 60, 0, a.rendering.camera); a.rendering.render();
          if (i > 4) { frames.push(timestamp - previous); cpu.push(performance.now() - start); }
          previous = timestamp;
        }
        views.push({ view, calls: r.info.render.calls, triangles: r.info.render.triangles,
          frameMs: quantiles(frames), submitMs: quantiles(cpu), geometries: r.info.memory.geometries, textures: r.info.memory.textures });
      }
      const updates = [], streams = [];
      for (let step = 1; step <= 6; step++) {
        const p = cityLanePose('north', 3, step * 112 + 24), start = performance.now();
        let calls = 0;
        do {
          const tick = performance.now(); a.world.update(p.s, p.u); updates.push(performance.now() - tick); calls++;
        } while (a.world.pending.length);
        streams.push({ ms: performance.now() - start, calls });
      }
      pose(24, 3);
      const driveUpdates = [];
      for (let s = 24; s < 800; s += .8) {
        const p = cityLanePose('north', 3, s), start = performance.now();
        a.world.update(p.s, p.u, { budgetMs: 3 }); driveUpdates.push(performance.now() - start);
      }
      pose(24, 3); a.rendering.setView(2); a.rendering.update(a.vehicle.car, 1, a.world.origin); a.rendering.render();
      return { views, streamingUpdatesMs: quantiles(updates), streams,
        driveUpdatesMs: quantiles(driveUpdates), driveUpdatesOver16ms: driveUpdates.filter(ms => ms > 1000 / 60).length,
        drawingBuffer: [r.domElement.width, r.domElement.height],
        detailed: a.world.chunks.size, distant: a.world.distantChunks.size };
    });
    report.push({ ...profile, ...samples });
    await page.screenshot({ path: `${directory}/${profile.name}.png` });
    await page.close();
  }
  assert.deepEqual(errors, [], 'no browser errors');
  await writeFile(`${directory}/report.json`, JSON.stringify({ renderer: 'Chromium SwiftShader (not a physical phone benchmark)', report, errors }, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
