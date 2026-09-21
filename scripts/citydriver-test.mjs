import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const url = process.env.TEST_URL ?? 'http://127.0.0.1:5173';
await mkdir('.artifacts/citydriver', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], records = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await page.goto(`${url}/?seed=4817`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__citydriver && document.querySelector('#loading').classList.contains('loaded'), null, { timeout: 60000 });
  assert.match(await page.title(), /^Citydriver\b/);
  assert.equal(await page.locator('#change-journey').isVisible(), false);
  await page.screenshot({ path: '.artifacts/citydriver/welcome.png' });
  await page.click('#start');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#welcome')).visibility === 'hidden');
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__citydriver.vehicle.speed > 5);
  await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyP');
  assert.equal(await page.evaluate(() => window.__citydriver.paused), true);

  // Stream to distant streets in every quadrant, then drive across a real
  // river deck in both directions. Run the actual controller and colliders.
  const results = await page.evaluate(async () => {
    const a = window.__citydriver;
    const { collideScenery } = await import('/src/collision.js');
    const { citydriverRoute, CITY_BLOCK } = await import('/src/world/city-grid.js');
    a.traffic.setEnabled(false, a.vehicle);
    const records = [];
    for (const [s, u, heading] of [[0, 3, 0], [0, -3, Math.PI], [-3, 0, Math.PI / 2], [3, 0, -Math.PI / 2], [11200, -11197, 0], [-11203, 11200, Math.PI / 2], [-3, 340, Math.PI / 2], [3, 445, -Math.PI / 2]]) {
      const v = a.vehicle;
      v.s = s; v.u = u; v.speed = 0; v.heading = heading; v.knock.x = v.knock.z = v.knock.spin = 0; v.update(0, {});
      for (let i = 0; i < 10; i++) a.world.update(v.s, v.u);
      for (let i = 0; i < 360; i++) { v.update(1 / 60, { forward: true }); collideScenery(v, a.world.chunks, 1 / 60); a.world.update(v.s, v.u); }
      records.push({ from: [s, u], to: [v.s, v.u], moved: Math.hypot(v.s - s, v.u - u), height: v.ground(v.s, v.u).height, blocked: v.ground(v.s, v.u).blocked, speed: v.speed, road: citydriverRoute.looseness(v.s, v.u), chunks: a.world.chunks.size, totalChunks: a.world.chunks.size + a.world.distantChunks.size });
    }
    // A stationary car beyond the current deck still cannot enter open water.
    const blocked = a.vehicle.ground(CITY_BLOCK / 2, 3.5 * CITY_BLOCK).blocked;
    return { records, waterBlocked: blocked };
  });
  for (const record of results.records) { assert.ok(record.moved > 100, JSON.stringify(record)); assert.equal(record.blocked, false); assert.equal(record.road, 0); assert.ok(record.chunks <= 49); assert.equal(record.totalChunks, 121); }
  assert.equal(results.waterBlocked, true); records.push(...results.records);

  // Use the public setting, including while paused; capture the same bridge.
  await page.evaluate(() => {
    const a = window.__citydriver, v = a.vehicle;
    v.s = -3; v.u = 370; v.heading = Math.PI / 2; v.speed = 0; v.update(0, {});
    for (let i = 0; i < 16; i++) a.world.update(v.s, v.u);
    v.render(1, a.world.origin); a.rendering.snap(); a.rendering.update(v.car, 1, a.world.origin);
  });
  for (const mode of ['clear', 'rain', 'storm', 'sunset', 'night']) {
    await page.selectOption('#city-weather', mode);
    assert.equal(await page.evaluate(() => window.__citydriver.weather.state.id), mode);
    await page.evaluate(() => { document.querySelector('#pause-overlay').hidden = true; window.__citydriver.rendering.render(); });
    await page.screenshot({ path: `.artifacts/citydriver/${mode}.png` });
    await page.evaluate(() => { document.querySelector('#pause-overlay').hidden = false; });
  }
  await page.evaluate(() => window.__citydriver.action('reset'));
  assert.deepEqual(await page.evaluate(() => { const a = window.__citydriver; return { paused: a.paused, weather: a.weather.state.id, lamps: a.vehicle.night }; }), { paused: true, weather: 'night', lamps: 1 });
  await page.selectOption('#city-weather', 'clear');
  await page.keyboard.press('KeyP');
  await page.keyboard.press('KeyV'); await page.keyboard.press('KeyV'); await page.keyboard.press('KeyV');
  await page.waitForTimeout(300);
  await page.screenshot({ path: '.artifacts/citydriver/chase.png' });
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => !window.__citydriver.changingJourney);
  assert.equal(await page.evaluate(() => window.__citydriver.vehicle.distance), 0);
  assert.equal(await page.evaluate(() => window.__citydriver.journey), 'city');

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  mobile.on('pageerror', e => errors.push(e.message));
  await mobile.goto(`${url}/?seed=4817`, { waitUntil: 'networkidle' });
  await mobile.waitForFunction(() => window.__citydriver && document.querySelector('#loading').classList.contains('loaded'));
  await mobile.screenshot({ path: '.artifacts/citydriver/mobile-welcome.png' });
  await mobile.tap('#start');
  await mobile.tap('#pause');
  await mobile.selectOption('#city-weather', 'night');
  assert.equal(await mobile.evaluate(() => window.__citydriver.weather.state.id), 'night');
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mobile.screenshot({ path: '.artifacts/citydriver/mobile-pause.png' });
  assert.deepEqual(errors, []);
  await writeFile('.artifacts/citydriver/report.json', JSON.stringify({ passed: true, errors, driving: records }, null, 2));
  console.log(`Citydriver browser checks passed: ${records.length} directional/bridge drives, weather, reset, desktop and mobile.`);
} catch (error) {
  console.error('Browser errors:', errors);
  throw error;
} finally { await browser.close(); }
