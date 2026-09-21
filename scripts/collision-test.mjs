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
  // Traffic gives way. Run into the back of a car and it is shoved on; lean on
  // the side of one and it is pushed across its lane, turned, and recovers.
  const watch = scenario => page.evaluate(({ scenario }) => {
    const a = window.__coastline, v = a.vehicle, car = a.traffic.vehicles.find(car => car.direction > 0);
    v.reset(); a.traffic.clearNear(v);
    a.traffic.respawn(car, v.s + (scenario === 'rear' ? 14 : 1.5));
    if (scenario === 'side') { v.u = -.1; v.heading = v.route.frame(v.s).angle + .1; }
    v.speed = 26; v.update(0, {});
    const seen = window.traffic = { scenario, contacts: 0, fastest: 0, pushed: 0, turned: 0, slowest: 26, car };
    const resolve = v.resolveTrafficCollision.bind(v);
    v.resolveTrafficCollision = (...args) => { seen.contacts++; resolve(...args); };
    seen.timer = setInterval(() => {
      seen.fastest = Math.max(seen.fastest, car.speed); seen.pushed = Math.max(seen.pushed, Math.abs(car.u - 2.4));
      seen.turned = Math.max(seen.turned, Math.abs(car.yaw)); seen.slowest = Math.min(seen.slowest, v.speed);
    }, 8);
  }, { scenario });
  const seen = () => page.evaluate(() => {
    const { timer, car, ...seen } = window.traffic; clearInterval(timer);
    delete window.__coastline.vehicle.resolveTrafficCollision;
    return { ...seen, speed: window.__coastline.vehicle.speed, lane: car.u, yaw: car.yaw, finite: [car.speed, car.u, car.yaw, car.s].every(Number.isFinite) };
  });
  await page.keyboard.down('KeyW');
  await watch('rear'); await page.waitForTimeout(2500);
  const rear = await seen();
  assert.ok(rear.contacts > 0 && rear.fastest > 19 && rear.slowest > 12 && rear.finite, `running into the back of a car: ${JSON.stringify(rear)}`);
  await watch('side'); await page.waitForTimeout(350);
  await page.screenshot({ path: '.artifacts/collision-traffic.png' });
  await page.waitForTimeout(4000);
  const side = await seen();
  await page.keyboard.up('KeyW');
  assert.ok(side.contacts > 0 && side.pushed > .05 && side.turned > .01 && side.slowest > 20 && side.finite, `leaning on the side of a car: ${JSON.stringify(side)}`);
  assert.ok(side.lane === 2.4 && side.yaw === 0, `the car should be back in its lane: ${JSON.stringify(side)}`);
  records.push(rear, side);
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
