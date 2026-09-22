import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const directory = `.artifacts/performance/${process.env.PERF_LABEL ?? 'profile'}`;
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => localStorage.setItem('citydriver.graphics', JSON.stringify({ mode: 'basic' })));
  await page.goto(`${process.env.TEST_URL ?? 'http://127.0.0.1:5173'}/?seed=4817`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__citydriver && document.querySelector('#loading.loaded'), null, { timeout: 90000 });
  const report = await page.evaluate(async () => {
    const a = window.__citydriver, renderer = a.rendering.renderer;
    a.beginFree(); a.action('pause'); renderer.setAnimationLoop(null);
    const { cityLanePose } = await import('/src/world/city-layout.js');
    Object.assign(a.vehicle, cityLanePose('north', 3, 24)); a.vehicle.update(0, {});
    a.world.update(a.vehicle.s, a.vehicle.u); a.vehicle.render(1, a.world.origin); a.traffic.render(1, a.world.origin);
    a.rendering.setView(2); a.rendering.snap(); a.rendering.update(a.vehicle.car, 1, a.world.origin);
    const draws = new Map();
    a.rendering.scene.traverse(object => {
      if (!object.isMesh) return;
      const previous = object.onBeforeRender;
      object.onBeforeRender = function (...args) {
        previous.apply(this, args);
        const geometry = object.geometry, count = object.isInstancedMesh ? object.count : 1;
        const name = object.name || object.parent?.name;
        const entry = draws.get(name) ?? { name, calls: 0, triangles: 0, vertices: 0 };
        entry.calls++; entry.triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3 * count;
        entry.vertices += geometry.attributes.position.count * count;
        draws.set(name, entry);
      };
    });
    a.rendering.render();
    const measure = (work, iterations = 100) => {
      for (let i = 0; i < 10; i++) work(i);
      const samples = [];
      for (let n = 0; n < 7; n++) {
        const start = performance.now();
        for (let i = 0; i < iterations; i++) work(i);
        samples.push((performance.now() - start) / iterations);
      }
      samples.sort((x, y) => x - y);
      return { median: samples[3], max: samples.at(-1) };
    };
    const map = measure(() => a.cityGuide.update(false));
    const animate = measure(i => a.world.animate(i / 60, i / 60, a.rendering.camera));
    const observer = { s: a.vehicle.s, u: a.vehicle.u, groundedPosition: { x: 1e9, z: 1e9 } };
    const traffic = measure(() => a.traffic.update(1 / 60, observer));
    return { renderer: 'Chromium SwiftShader; CPU microbenchmarks, not a phone FPS estimate',
      draws: [...draws.values()].sort((x, y) => y.vertices - x.vertices), cpuMs: { map, animate, traffic } };
  });
  assert.deepEqual(errors, []);
  await writeFile(`${directory}/profile.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
