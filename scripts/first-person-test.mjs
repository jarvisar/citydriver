import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

await mkdir('.artifacts', { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('coastline-install-dismissed-v2', String(Date.now())));
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173/?seed=4817', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__coastline && document.querySelector('#loading').classList.contains('loaded'));
  await page.locator('#start').tap();
  for (let i = 0; i < 3; i++) await page.locator('#view').tap();
  assert.match(await page.locator('#view').getAttribute('aria-label'), /First-person view/);
  assert.match(await page.locator('#touch-stick').getAttribute('aria-label'), /left and right to steer/);
  await page.locator('#reset').tap();
  await page.waitForFunction(() => !window.__coastline.changingJourney);
  const client = await page.context().newCDPSession(page);
  const rect = await page.locator('#touch-stick').boundingBox();
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, id: 1 };
  const heading = await page.evaluate(() => window.__coastline.vehicle.heading);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...center, x: center.x + 20, y: center.y - 30 }] });
  await page.waitForFunction(heading => window.__coastline.vehicle.speed > 1 && window.__coastline.vehicle.heading > heading + .1, heading);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => window.__coastline.vehicle.speed === 0);
  await page.locator('#pause').tap();
  await page.evaluate(() => window.__coastline.graphics.setMode('high'));
  for (const id of ['formula', 'van', 'auto']) {
    await page.evaluate(id => window.__coastline.chooseCar(id), id);
    assert.equal(await page.evaluate(() => window.__coastline.vehicle.carId), id);
    assert.ok(await page.evaluate(() => {
      const { vehicle, rendering } = window.__coastline;
      return rendering.viewLabel === 'First-person view' && vehicle.car.visible && rendering.camera.position.distanceTo(vehicle.car.position) < 3;
    }), `driver position after selecting ${id}`);
  }
  await page.locator('#resume').tap();
  for (const [width, height] of [[390, 844], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(aspect => window.__coastline.rendering.camera.aspect === aspect, width / height);
    await page.screenshot({ path: `.artifacts/first-person-${width}.png` });
  }
  for (const journey of ['snow', 'desert']) {
    await page.evaluate(id => window.__coastline.changeJourney(id), journey);
    await page.waitForFunction(() => !window.__coastline.changingJourney);
    assert.equal(await page.evaluate(() => window.__coastline.rendering.viewLabel), 'First-person view');
  }
  await page.locator('#view').tap();
  assert.equal(await page.evaluate(() => window.__coastline.vehicle.car.visible), true);
  assert.equal(await page.evaluate(() => window.__coastline.rendering.camera.isOrthographicCamera), true);
  assert.deepEqual(errors, []);
  console.log('First-person browser checks passed: touch steering and stop, reset, car swaps, AO, rotation, routes, exterior restoration.');
} finally { await browser.close(); }
