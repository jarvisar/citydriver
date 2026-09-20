import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('.artifacts', { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [], results = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173/?seed=4817', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__coastline && document.querySelector('#loading').classList.contains('loaded'));
  await page.evaluate(() => {
    const a = window.__coastline;
    a.action('drive'); a.action('pause'); a.graphics.setMode('smooth');
    const resolve = a.vehicle.resolveTrafficCollision.bind(a.vehicle);
    a.vehicle.resolveTrafficCollision = (...args) => { window.passReview.contacts++; resolve(...args); };
  });
  for (const journey of ['coast', 'city']) {
    await page.evaluate(async journey => {
      const a = window.__coastline;
      if (document.querySelector('#autodrive').getAttribute('aria-pressed') === 'true') a.action('autodrive');
      await a.changeJourney(journey);
      if (!a.paused) a.action('pause');
      a.chooseCar('auto'); a.vehicle.reset();
      a.vehicle.speed = a.vehicle.stats.topSpeed; a.vehicle.update(0, {});
      a.traffic.setEnabled(true, a.vehicle);
      a.traffic.vehicles = a.traffic.pool.slice(0, 1);
      for (const car of a.traffic.pool) car.car.visible = car === a.traffic.vehicles[0];
      a.traffic.respawn(a.traffic.vehicles[0], a.vehicle.s + 55 / a.vehicle.route.frame(a.vehicle.s).scale);
      a.traffic.lastPlayerS = a.vehicle.s;
      while (a.rendering.viewLabel !== 'First-person view') a.action('view');
      a.vehicle.render(1, a.world.origin); a.traffic.render(1, a.world.origin); a.rendering.update(a.vehicle.car, 0, a.world.origin);
      window.passReview = { journey, contacts: 0, passed: false, complete: false, samples: [] };
      const record = () => {
        const r = window.passReview, p = a.vehicle;
        if (!a.paused) {
          r.passed ||= p.u < 0 && p.s > a.traffic.vehicles[0].s;
          r.complete = r.passed && p.u > 2.3;
          r.samples.push({ distance: p.distance, u: p.u, speed: p.speed, heading: p.heading });
        }
        if (!r.complete) requestAnimationFrame(record);
      };
      requestAnimationFrame(record);
    }, journey);
    await page.keyboard.press('KeyH');
    assert.equal(await page.locator('#autodrive').getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('KeyP');
    await page.waitForFunction(() => window.__coastline.vehicle.u < -1.5, undefined, { timeout: 45000 });
    await page.screenshot({ path: `.artifacts/autodrive-${journey}-passing.png` });
    await page.waitForFunction(() => window.passReview.complete, undefined, { timeout: 45000 });
    await page.keyboard.press('KeyP');
    const result = await page.evaluate(() => window.passReview);
    assert.equal(result.contacts, 0);
    assert.ok(result.samples.every(p => Math.abs(p.u) < 2.41));
    assert.equal(await page.evaluate(() => window.__coastline.rendering.viewLabel), 'First-person view');
    results.push(result);
  }
  await page.keyboard.press('KeyP');
  await page.keyboard.down('KeyD');
  await page.waitForFunction(() => document.querySelector('#autodrive').getAttribute('aria-pressed') === 'false');
  await page.keyboard.up('KeyD');
  assert.deepEqual(errors, []);
  await writeFile('.artifacts/autodrive-browser-report.json', JSON.stringify({ passed: true, results }, null, 2));
  console.log('Autodrive browser checks passed: coast/city windshield overtakes, lane return, no collisions, manual steering takeover.');
} finally { await browser.close(); }
