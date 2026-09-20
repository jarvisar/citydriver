import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('.artifacts', { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__coastline && document.querySelector('#loading').classList.contains('loaded'));
  await page.waitForTimeout(700);
  const camera = await page.evaluate(() => ({ quaternion: window.__coastline.rendering.camera.quaternion.toArray(), top: window.__coastline.rendering.camera.top, carScale: window.__coastline.vehicle.car.scale.toArray() }));
  await page.locator('#change-journey').click();
  assert.equal(await page.locator('#journey-dialog').isVisible(), true);
  await page.screenshot({ path: '.artifacts/journey-chooser.png' });
  await page.keyboard.down('KeyW'); await page.waitForTimeout(150); await page.keyboard.up('KeyW');
  assert.equal(await page.evaluate(() => window.__coastline.vehicle.speed), 0);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__coastline.paused);
  assert.equal(await page.locator('#journey-dialog').isVisible(), false);
  await page.locator('#change-journey').click();
  await page.getByRole('button', { name: 'Red Rock Desert', exact: true }).click();
  await page.waitForFunction(() => window.__coastline.journey === 'desert' && !window.__coastline.changingJourney);
  await page.waitForTimeout(600);
  await page.screenshot({ path: '.artifacts/desert-welcome.png' });
  const desertCamera = await page.evaluate(() => ({ quaternion: window.__coastline.rendering.camera.quaternion.toArray(), top: window.__coastline.rendering.camera.top, carScale: window.__coastline.vehicle.car.scale.toArray() }));
  assert.equal(desertCamera.top, camera.top); assert.deepEqual(desertCamera.carScale, camera.carScale);
  camera.quaternion.forEach((value, index) => assert.ok(Math.abs(value - desertCamera.quaternion[index]) < 1e-10));
  assert.equal(await page.locator('.location-title').textContent(), 'RED ROCK DESERT');
  await page.click('#start');
  await page.keyboard.down('KeyW'); await page.waitForFunction(() => window.__coastline.vehicle.speed > 8); await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyR'); await page.waitForFunction(() => !window.__coastline.changingJourney);
  await page.keyboard.down('ArrowDown'); await page.waitForFunction(() => window.__coastline.vehicle.speed < -2); await page.keyboard.up('ArrowDown');
  await page.keyboard.press('KeyR'); await page.waitForFunction(() => !window.__coastline.changingJourney);
  const records = [];
  for (const s of [24, 148, 300, 950, 1025, 10000]) {
    await page.evaluate(async s => {
      const a = window.__coastline; a.vehicle.s = s; a.vehicle.reset(); a.rendering.snap();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, s);
    await page.waitForTimeout(350);
    const result = await page.evaluate(() => {
      const a = window.__coastline;
      let oceans = 0, mesas = 0;
      a.rendering.scene.traverse(object => { if (object.name === 'animated-ocean') oceans++; if (object.name === 'sandstone-mesas') mesas++; });
      const { behind, ahead } = a.graphics.settings.chunks;
      return { s: a.vehicle.s, chunks: a.world.chunks.size, resident: behind + ahead + 1, origin: a.world.origin, carZ: a.vehicle.car.position.z, geometries: a.rendering.renderer.info.memory.geometries, textures: a.rendering.renderer.info.memory.textures, triangles: a.rendering.renderer.info.render.triangles, calls: a.rendering.renderer.info.render.calls, oceans, mesas };
    });
    // One mesa group per resident chunk, however many the quality level keeps.
    assert.equal(result.chunks, result.resident); assert.equal(result.oceans, 0); assert.equal(result.mesas, result.resident);
    assert.ok(result.geometries < 180); assert.ok(Math.abs(result.carZ) < 1030);
    records.push(result);
    if (s < 1000) await page.screenshot({ path: `.artifacts/desert-${s}.png` });
  }
  await page.evaluate(() => { const a = window.__coastline; a.vehicle.s = 300; a.vehicle.distance = 1245; a.vehicle.reset(); a.rendering.snap(); });
  await page.waitForTimeout(200);
  await page.keyboard.press('KeyV');
  await page.waitForFunction(() => Math.abs(window.__coastline.rendering.camera.top - 57.5) < .2);
  const zoom = await page.evaluate(() => window.__coastline.rendering.camera.top);
  await page.keyboard.press('KeyP');
  for (const id of ['coast', 'desert', 'coast', 'desert', 'coast', 'desert']) {
    await page.locator('#change-journey').click();
    await page.getByRole('button', { name: id === 'coast' ? 'Pacific Coast' : 'Red Rock Desert', exact: true }).click();
    await page.waitForFunction(id => window.__coastline.journey === id && !window.__coastline.changingJourney, id);
    assert.equal(await page.evaluate(() => window.__coastline.paused), true);
    if (id === 'desert') {
      assert.equal(await page.evaluate(() => window.__coastline.vehicle.s), 300);
      assert.equal(await page.evaluate(() => window.__coastline.vehicle.distance), 1245);
    }
  }
  const finalState = await page.evaluate(() => { const a = window.__coastline, { behind, ahead } = a.graphics.settings.chunks; return { geometry: a.rendering.renderer.info.memory.geometries, top: a.rendering.camera.top, speed: a.vehicle.speed, chunks: a.world.chunks.size, resident: behind + ahead + 1 }; });
  assert.ok(finalState.geometry < 180); assert.ok(Math.abs(finalState.top - zoom) < 1); assert.equal(finalState.speed, 0); assert.equal(finalState.chunks, finalState.resident);
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  mobile.on('pageerror', error => errors.push(error.message));
  await mobile.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
  await mobile.waitForFunction(() => window.__coastline && document.querySelector('#loading').classList.contains('loaded'));
  await mobile.waitForTimeout(650);
  await mobile.locator('#change-journey').tap();
  await mobile.screenshot({ path: '.artifacts/journey-chooser-mobile.png' });
  await mobile.getByRole('button', { name: 'Red Rock Desert', exact: true }).tap();
  await mobile.waitForFunction(() => window.__coastline.journey === 'desert' && !window.__coastline.changingJourney);
  await mobile.waitForTimeout(650); await mobile.click('#start'); await mobile.waitForTimeout(950);
  await mobile.screenshot({ path: '.artifacts/desert-mobile.png' });
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  const report = { passed: true, unchangedCamera: true, savedJourneyProgress: true, modalInputAndEscape: true, mobileChooser: true, finalState, records };
  await writeFile('.artifacts/journey-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
