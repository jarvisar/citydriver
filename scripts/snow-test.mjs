import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const url = process.env.TEST_URL ?? 'http://127.0.0.1:5173';
await mkdir('.artifacts', { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const errors = [], records = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(e.message)); page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__coastline);
  const initial = await page.evaluate(() => { const a = window.__coastline; return { rotation: a.rendering.camera.quaternion.toArray(), top: a.rendering.camera.top, scale: a.vehicle.car.scale.toArray(), color: a.rendering.scene.background.getHex(), exposure: a.rendering.renderer.toneMappingExposure }; });
  await page.locator('#change-journey').click();
  assert.equal(await page.locator('.journey-card').count(), 6);
  await page.screenshot({ path: '.artifacts/three-journeys.png' });
  await page.getByRole('button', { name: 'Midnight Alpine', exact: true }).click();
  await page.waitForFunction(() => window.__coastline.journey === 'snow' && !window.__coastline.changingJourney);
  await page.click('#start');
  await page.keyboard.down('KeyW'); await page.waitForFunction(() => window.__coastline.vehicle.speed > 8); await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyR'); await page.waitForFunction(() => !window.__coastline.changingJourney);
  await page.keyboard.down('ArrowDown'); await page.waitForFunction(() => window.__coastline.vehicle.speed < -2); await page.keyboard.up('ArrowDown');
  for (const s of [24, 148, 420, 1025, 10000, -300]) {
    await page.evaluate(s => { const a = window.__coastline; a.vehicle.s = s; a.vehicle.reset(); a.rendering.snap(); }, s);
    await page.waitForTimeout(500);
    const result = await page.evaluate(() => {
      const a = window.__coastline, info = a.rendering.renderer.info;
      const { behind, ahead } = a.graphics.settings.chunks;
      return { s: a.vehicle.s, chunks: a.world.chunks.size, resident: behind + ahead + 1, geometry: info.memory.geometries, triangles: info.render.triangles, lights: a.world.lights.length, headlight: a.world.headlight.intensity, origin: a.world.origin, carZ: a.vehicle.car.position.z, rotation: a.rendering.camera.quaternion.toArray(), top: a.rendering.camera.top, scale: a.vehicle.car.scale.toArray(),
        lakes: [...a.world.chunks.values()].filter(chunk => chunk.group.getObjectByName('alpine-lake')).length,
        flakeSizes: new Set(a.world.flakeGeometry.attributes.flakeSize.array).size };
    });
    assert.equal(result.chunks, result.resident); assert.equal(result.lights, 7); assert.ok(result.headlight > 0);
    assert.ok(result.geometry < 150); assert.ok(Math.abs(result.carZ) < 1030);
    assert.equal(result.lakes, result.resident, 'one alpine lake per resident chunk'); assert.ok(result.flakeSizes > 100);
    assert.deepEqual(result.scale, initial.scale); assert.equal(result.top, initial.top);
    result.rotation.forEach((v, i) => assert.ok(Math.abs(v - initial.rotation[i]) < 1e-10));
    records.push(result);
    if (s >= 0 && s < 1000) await page.screenshot({ path: `.artifacts/snow-${s}.png` });
  }
  const snowState = () => page.evaluate(() => Array.from(window.__coastline.world.flakeGeometry.attributes.position.array.slice(0, 12)));
  const moving = await snowState(); await page.waitForTimeout(500); assert.notDeepEqual(await snowState(), moving);
  await page.keyboard.press('KeyP'); const stopped = await snowState(); await page.waitForTimeout(500); assert.deepEqual(await snowState(), stopped);
  const saved = await page.evaluate(() => ({ s: window.__coastline.vehicle.s, distance: window.__coastline.vehicle.distance }));
  for (const id of ['desert', 'coast', 'snow', 'coast', 'snow']) {
    await page.evaluate(id => window.__coastline.changeJourney(id), id);
    assert.equal(await page.evaluate(() => window.__coastline.paused), true);
    assert.ok(await page.evaluate(() => window.__coastline.rendering.renderer.info.memory.geometries < 150));
    if (id === 'snow') assert.deepEqual(await page.evaluate(() => ({ s: window.__coastline.vehicle.s, distance: window.__coastline.vehicle.distance })), saved);
    else assert.equal(await page.evaluate(() => !!window.__coastline.rendering.scene.getObjectByName('snow-night-effects')), false);
    if (id === 'coast') {
      assert.equal(await page.evaluate(() => window.__coastline.rendering.scene.background.getHex()), initial.color);
      assert.equal(await page.evaluate(() => window.__coastline.rendering.renderer.toneMappingExposure), initial.exposure);
    }
  }
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  mobile.on('pageerror', e => errors.push(e.message));
  await mobile.goto(url, { waitUntil: 'networkidle' }); await mobile.waitForFunction(() => window.__coastline);
  await mobile.locator('#change-journey').tap();
  await mobile.screenshot({ path: '.artifacts/three-journeys-mobile.png' });
  await mobile.getByRole('button', { name: 'Midnight Alpine', exact: true }).tap();
  await mobile.waitForFunction(() => window.__coastline.journey === 'snow' && !window.__coastline.changingJourney);
  await mobile.click('#start'); await mobile.waitForTimeout(2500);
  await mobile.screenshot({ path: '.artifacts/snow-mobile.png' });
  const forward = await mobile.getByRole('group', { name: 'Virtual joystick', exact: true }).boundingBox();
  const touch = await mobile.context().newCDPSession(mobile);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: forward.x + forward.width / 2, y: forward.y + forward.height / 2 - 36 }] });
  await mobile.waitForFunction(() => window.__coastline.vehicle.speed > 4);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  const report = { passed: true, unchangedCamera: true, snowyDrivingAndReverse: true, snowPauses: true, boundedNightLights: true, savedProgress: true, daylightRestored: true, mobileTouchDriving: true, records };
  await writeFile('.artifacts/snow-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
