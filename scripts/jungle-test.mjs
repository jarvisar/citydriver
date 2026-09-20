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
  await page.waitForFunction(() => window.__coastline && document.querySelector('#loading').classList.contains('loaded'));
  const initial = await page.evaluate(() => { const a = window.__coastline; return { rotation: a.rendering.camera.quaternion.toArray(), top: a.rendering.camera.top, scale: a.vehicle.car.scale.toArray(), color: a.rendering.scene.background.getHex(), exposure: a.rendering.renderer.toneMappingExposure, fog: a.rendering.scene.fog.near }; });
  await page.locator('#change-journey').click();
  assert.equal(await page.locator('.journey-card').count(), 6);
  await page.getByRole('button', { name: 'Emerald Jungle', exact: true }).click();
  await page.waitForFunction(() => window.__coastline.journey === 'jungle' && !window.__coastline.changingJourney);
  assert.equal(await page.locator('.location-title').textContent(), 'EMERALD JUNGLE');
  assert.equal(await page.evaluate(() => document.body.dataset.journey), 'jungle');
  assert.equal(await page.evaluate(() => document.querySelector('meta[name="theme-color"]').content), '#22402a');
  assert.equal(await page.evaluate(() => window.__coastline.vehicle.car.getObjectByName('jungle-cargo').visible), true);
  assert.equal(await page.evaluate(() => window.__coastline.vehicle.car.getObjectByName('surfboard').visible), false);
  await page.waitForTimeout(600);
  await page.screenshot({ path: '.artifacts/jungle-welcome.png' });
  await page.click('#start');
  await page.keyboard.down('KeyW'); await page.waitForFunction(() => window.__coastline.vehicle.speed > 8); await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyR'); await page.waitForFunction(() => !window.__coastline.changingJourney);
  await page.keyboard.down('ArrowDown'); await page.waitForFunction(() => window.__coastline.vehicle.speed < -2); await page.keyboard.up('ArrowDown');
  for (const s of [24, 180, 498, 1025, 10000, -300]) {
    await page.evaluate(s => { const a = window.__coastline; a.vehicle.s = s; a.vehicle.reset(); a.rendering.snap(); }, s);
    await page.waitForTimeout(500);
    const result = await page.evaluate(() => {
      const a = window.__coastline, info = a.rendering.renderer.info, names = {};
      a.rendering.scene.traverse(object => { if (object.name) names[object.name] = (names[object.name] ?? 0) + 1; });
      const { behind, ahead } = a.graphics.settings.chunks;
      return { s: a.vehicle.s, chunks: a.world.chunks.size, resident: behind + ahead + 1, geometry: info.memory.geometries, triangles: info.render.triangles, calls: info.render.calls, origin: a.world.origin, carZ: a.vehicle.car.position.z,
        rotation: a.rendering.camera.quaternion.toArray(), top: a.rendering.camera.top, scale: a.vehicle.car.scale.toArray(),
        rivers: names['jungle-river'] ?? 0, floors: names['jungle-floor'] ?? 0, crowns: names['emergent-crowns'] ?? 0, foam: names['cascade-foam'] ?? 0, oceans: names['animated-ocean'] ?? 0, nightEffects: names['snow-night-effects'] ?? 0 };
    });
    // One river and one floor per resident chunk, however many this level keeps.
    assert.equal(result.chunks, result.resident); assert.equal(result.rivers, result.resident); assert.equal(result.floors, result.resident); assert.ok(result.crowns >= result.resident);
    assert.ok(result.foam >= 5); assert.equal(result.oceans, 0); assert.equal(result.nightEffects, 0);
    assert.ok(result.geometry < 200); assert.ok(Math.abs(result.carZ) < 1030);
    assert.deepEqual(result.scale, initial.scale); assert.equal(result.top, initial.top);
    result.rotation.forEach((v, i) => assert.ok(Math.abs(v - initial.rotation[i]) < 1e-10));
    records.push(result);
    if (s >= 0 && s < 1000) await page.screenshot({ path: `.artifacts/jungle-${s}.png` });
  }
  // The river and cascades animate with the drive and freeze while paused.
  const read = () => page.evaluate(() => {
    const a = window.__coastline; a.rendering.renderer.render(a.rendering.scene, a.rendering.camera);
    const canvas = document.createElement('canvas'); canvas.width = 1440; canvas.height = 1000;
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(document.querySelector('#scene'), 0, 0);
    return Array.from(context.getImageData(300, 380, 420, 320).data);
  });
  await page.evaluate(() => { const a = window.__coastline; a.vehicle.s = 498; a.vehicle.reset(); a.rendering.snap(); });
  await page.waitForTimeout(400);
  const before = await read(); await page.waitForTimeout(600); const after = await read();
  let moving = 0;
  for (let i = 0; i < before.length; i += 4) if (Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1]) + Math.abs(before[i + 2] - after[i + 2]) > 6) moving++;
  assert.ok(moving > 300, `water must animate (${moving} changed pixels)`);
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(300);
  const frozen = await read(); await page.waitForTimeout(500);
  assert.deepEqual(await read(), frozen);
  const saved = await page.evaluate(() => ({ s: window.__coastline.vehicle.s, distance: window.__coastline.vehicle.distance }));
  for (const id of ['coast', 'jungle', 'snow', 'jungle', 'desert', 'coast']) {
    await page.evaluate(id => window.__coastline.changeJourney(id), id);
    await page.waitForFunction(id => window.__coastline.journey === id && !window.__coastline.changingJourney, id);
    assert.equal(await page.evaluate(() => window.__coastline.paused), true);
    assert.ok(await page.evaluate(() => window.__coastline.rendering.renderer.info.memory.geometries < 200));
    if (id === 'jungle') assert.deepEqual(await page.evaluate(() => ({ s: window.__coastline.vehicle.s, distance: window.__coastline.vehicle.distance })), saved);
    else assert.equal(await page.evaluate(() => [...window.__coastline.world.chunks.values()].some(chunk => chunk.group.getObjectByName('jungle-river'))), false);
    if (id === 'coast') {
      assert.equal(await page.evaluate(() => window.__coastline.rendering.scene.background.getHex()), initial.color);
      assert.equal(await page.evaluate(() => window.__coastline.rendering.renderer.toneMappingExposure), initial.exposure);
      assert.equal(await page.evaluate(() => window.__coastline.rendering.scene.fog.near), initial.fog);
    }
  }
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  mobile.on('pageerror', e => errors.push(e.message));
  await mobile.goto(url, { waitUntil: 'networkidle' }); await mobile.waitForFunction(() => window.__coastline);
  await mobile.locator('#change-journey').tap();
  await mobile.screenshot({ path: '.artifacts/four-journeys-mobile.png' });
  await mobile.getByRole('button', { name: 'Emerald Jungle', exact: true }).tap();
  await mobile.waitForFunction(() => window.__coastline.journey === 'jungle' && !window.__coastline.changingJourney);
  await mobile.click('#start'); await mobile.waitForTimeout(2000);
  await mobile.screenshot({ path: '.artifacts/jungle-mobile.png' });
  const stick = await mobile.getByRole('group', { name: 'Virtual joystick', exact: true }).boundingBox();
  const touch = await mobile.context().newCDPSession(mobile);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: stick.x + stick.width / 2, y: stick.y + stick.height / 2 - 36 }] });
  await mobile.waitForFunction(() => window.__coastline.vehicle.speed > 4);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  const report = { passed: true, fourRoutes: true, unchangedCamera: true, jungleDrivingAndReverse: true, riverAnimates: true, pausedRiverFreezes: true, savedProgress: true, daylightRestored: true, mobileTouchDriving: true, records };
  await writeFile('.artifacts/jungle-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
