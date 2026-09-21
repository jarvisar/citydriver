import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('.artifacts/taxi', { recursive: true });
const url = process.env.TEST_URL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
async function openPage(options) {
  const page = await browser.newPage(options); page.setDefaultTimeout(60000);
  await page.addInitScript(() => { localStorage.setItem('citydriver.graphics', JSON.stringify({ mode: 'basic' })); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${url}/?seed=4817&ao=0`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__citydriver && document.querySelector('#loading.loaded'));
  return page;
}
async function placeAtTarget(page) {
  await page.evaluate(() => {
    const a = window.__citydriver, target = a.taxi.target, v = a.vehicle;
    v.s = target.s; v.u = target.u; v.speed = 0; v.heading = target.axis === 'north' ? 0 : Math.PI / 2;
    v.knock.x = v.knock.z = v.knock.spin = 0; v.update(0, {}); a.world.update(v.s, v.u);
    v.render(1, a.world.origin); a.rendering.snap(); a.rendering.update(v.car, 1, a.world.origin);
  });
}
try {
  const page = await openPage({ viewport: { width: 1440, height: 960 } });
  await page.screenshot({ path: '.artifacts/taxi/menu.png' });
  await page.click('#start'); await page.waitForFunction(() => window.__citydriver.taxi.status === 'pickup');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#welcome')).visibility === 'hidden');
  assert.equal(await page.evaluate(() => window.__citydriver.vehicle.carId), 'taxi');
  assert.equal(await page.evaluate(() => window.__citydriver.rendering.viewLabel), 'Third-person view');
  await page.screenshot({ path: '.artifacts/taxi/pickup.png' });
  await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
  await page.waitForFunction(() => window.__citydriver.taxi.boost < .85 && window.__citydriver.vehicle.speed > 10);
  await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW'); await page.keyboard.press('KeyP');
  const time = await page.evaluate(() => window.__citydriver.taxi.timeLeft);
  await page.waitForTimeout(350); assert.equal(await page.evaluate(() => window.__citydriver.taxi.timeLeft), time);
  assert.equal(await page.locator('#autodrive').isDisabled(), true);
  await page.evaluate(() => window.__citydriver.traffic.setEnabled(false, window.__citydriver.vehicle));
  await placeAtTarget(page); await page.click('#resume');
  await page.waitForFunction(() => window.__citydriver.taxi.status === 'driving');
  assert.ok(await page.evaluate(() => window.__citydriver.taxi.fareLeft > 0));
  await page.screenshot({ path: '.artifacts/taxi/fare.png' });
  await placeAtTarget(page);
  await page.waitForFunction(() => window.__citydriver.taxi.delivered === 1);
  const cash = await page.evaluate(() => window.__citydriver.taxi.cash); assert.ok(cash > 0);
  await placeAtTarget(page); await page.waitForFunction(() => window.__citydriver.taxi.status === 'driving');
  await page.evaluate(() => { window.__citydriver.taxi.fareLeft = .05; });
  await page.waitForFunction(() => window.__citydriver.taxi.failed === 1);
  assert.equal(await page.evaluate(() => window.__citydriver.taxi.cash), cash);
  await page.evaluate(() => { window.__citydriver.taxi.timeLeft = .05; });
  await page.waitForFunction(() => window.__citydriver.taxi.status === 'over');
  assert.equal(await page.evaluate(() => window.__citydriver.paused), true);
  assert.equal(await page.locator('#taxi-results').isVisible(), true);
  assert.equal(await page.evaluate(() => Number(localStorage.getItem('citydriver-taxi-best'))), cash);
  await page.screenshot({ path: '.artifacts/taxi/results.png' });
  await page.click('#taxi-retry'); assert.equal(await page.evaluate(() => window.__citydriver.taxi.cash), 0);
  assert.equal(await page.evaluate(() => window.__citydriver.taxi.best), cash);
  await page.keyboard.press('KeyP'); await page.click('#switch-mode');
  assert.equal(await page.evaluate(() => window.__citydriver.gameMode), 'free');
  assert.equal(await page.evaluate(() => window.__citydriver.taxi.status), 'idle');
  assert.equal(await page.locator('#taxi-hud').isVisible(), false);
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForFunction(() => window.__citydriver);
  assert.equal(await page.evaluate(() => window.__citydriver.taxi.best), cash);
  await page.close();

  const mobile = await openPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.tap('#start'); await mobile.waitForFunction(() => window.__citydriver.taxi.running);
  await mobile.waitForFunction(() => getComputedStyle(document.querySelector('#welcome')).visibility === 'hidden');
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const boost = await mobile.locator('[data-drive-button=boost]').boundingBox(), stick = await mobile.locator('#touch-stick').boundingBox();
  assert.ok(boost.x + boost.width < stick.x || boost.y + boost.height < stick.y, 'boost and joystick must not overlap');
  // Send real simultaneous touches: boost must not cancel the steering stick.
  const touch = await mobile.context().newCDPSession(mobile);
  const fingers = [{ x: boost.x + boost.width / 2, y: boost.y + boost.height / 2, id: 1 }, { x: stick.x + stick.width / 2, y: stick.y + stick.height / 2, id: 2 }];
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers });
  assert.equal(await mobile.evaluate(() => window.__citydriver.input.state.boost), true);
  fingers[1].y -= 45;
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers });
  await mobile.waitForFunction(() => window.__citydriver.taxi.boostActive && window.__citydriver.vehicle.speed > 0);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  assert.equal(await mobile.evaluate(() => Boolean(window.__citydriver.input.state.boost)), false);
  const drift = await mobile.locator('[data-drive-button=handbrake]').boundingBox();
  fingers[0] = { x: drift.x + drift.width / 2, y: drift.y + drift.height / 2, id: 1 };
  fingers[1] = { x: stick.x + stick.width / 2, y: stick.y + stick.height / 2, id: 2 };
  await mobile.evaluate(() => { const a = window.__citydriver; a.traffic.setEnabled(false, a.vehicle); });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers });
  fingers[1].x += 30; fingers[1].y -= 45;
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers });
  await mobile.evaluate(() => { window.__citydriver.vehicle.speed = 22; });
  await mobile.waitForFunction(() => window.__citydriver.vehicle.drifting);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  assert.equal(await mobile.evaluate(() => Boolean(window.__citydriver.input.state.handbrake)), false);
  await mobile.screenshot({ path: '.artifacts/taxi/mobile.png' });
  await mobile.tap('#pause'); const mobileTime = await mobile.evaluate(() => window.__citydriver.taxi.timeLeft);
  await mobile.waitForTimeout(200); assert.equal(await mobile.evaluate(() => window.__citydriver.taxi.timeLeft), mobileTime);
  assert.deepEqual(errors, []);
  await writeFile('.artifacts/taxi/report.json', JSON.stringify({ passed: true, cash, errors }, null, 2));
  console.log('Taxi checks passed: pickup, drop-off, failure, boost, touch drift, pause, restart, saved best, free drive, desktop and touch.');
} finally { await browser.close(); }
