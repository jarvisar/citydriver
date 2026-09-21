import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('.artifacts', { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], records = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${process.env.TEST_URL ?? 'http://127.0.0.1:5173'}/?seed=42`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__coastline?.traffic && document.querySelector('#loading').classList.contains('loaded'));
  await page.click('#start');
  // Drive the real loop across the road at the first row of buildings.
  const start = await page.evaluate(async () => {
    const a = window.__coastline, v = a.vehicle;
    await a.changeJourney('city');
    if (!v.freeDriving) v.toggleFreeDriving();
    v.u = 3; v.speed = 0; v.heading = v.route.frame(v.s).angle + Math.PI / 2; v.update(0, {});
    const chunks = [...a.world.chunks.values()];
    return { chunks: chunks.length, fromWorker: chunks.filter(chunk => chunk.sourceData).length, colliders: chunks.map(chunk => chunk.features?.colliders?.length ?? 0) };
  });
  assert.ok(start.fromWorker > 0, 'the chunk worker built none of the resident chunks');
  assert.ok(start.colliders.every(count => count > 20), `a city chunk arrived without its buildings: ${start.colliders}`);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(5000);
  const stopped = await page.evaluate(() => { const v = window.__coastline.vehicle; return { u: v.u, speed: v.speed, impacts: v.audioTelemetry.impactSerial }; });
  await page.keyboard.up('KeyW');
  assert.ok(stopped.u > 7 && stopped.u < 16, `the car should stand against the building line, u=${stopped.u}`);
  assert.ok(Math.abs(stopped.speed) < 3 && stopped.impacts > 0);
  await page.screenshot({ path: '.artifacts/collision-city.png' });
  // The river stops it on the other side, at the quay.
  await page.evaluate(() => { const v = window.__coastline.vehicle; v.reset(); v.heading = v.route.frame(v.s).angle - Math.PI / 2; });
  await page.keyboard.down('KeyW'); await page.waitForTimeout(6000);
  const quay = await page.evaluate(async () => {
    const v = window.__coastline.vehicle, { quayOffset } = await import('/src/world/city-route.js');
    return { u: v.u, edge: quayOffset(v.s) };
  });
  await page.keyboard.up('KeyW');
  // Nose on to the water, the whole car is still on the quay.
  assert.ok(quay.u < -7 && quay.u - quay.edge > 1.7 && quay.u - quay.edge < 3, `the car should stop at the quay's edge, u=${quay.u} edge=${quay.edge}`);
  await page.screenshot({ path: '.artifacts/collision-quay.png' });
  // The whole scenery pass, measured in the jungle, which has the most trunks standing in it.
  const cost = await page.evaluate(async () => {
    const a = window.__coastline, { collideScenery } = await import('/src/collision.js');
    await a.changeJourney('jungle');
    const begin = performance.now();
    for (let i = 0; i < 20000; i++) collideScenery(a.vehicle, a.world.chunks, 1 / 60);
    return { msPerStep: (performance.now() - begin) / 20000, colliders: [...a.world.chunks.values()].reduce((sum, chunk) => sum + (chunk.features?.colliders?.length ?? 0), 0) };
  });
  assert.ok(cost.colliders > 200 && cost.msPerStep < .05, `scenery collision costs ${cost.msPerStep} ms a step`);
  records.push(start, stopped, quay, cost);
  assert.deepEqual(errors, []);
  await writeFile('.artifacts/collision-test.json', JSON.stringify(records, null, 2));
  console.log('collision test passed', JSON.stringify(records));
} finally { await browser.close(); }
