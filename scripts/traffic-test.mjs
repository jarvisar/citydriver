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
  const positions = () => page.evaluate(() => window.__coastline.traffic.vehicles.map(car => car.s));
  const before = await positions();
  await page.waitForFunction(before => window.__coastline.traffic.vehicles.some((car, i) => Math.abs(car.s - before[i]) > 1), before);
  await page.keyboard.press('KeyP');
  const paused = await positions(); await page.waitForTimeout(250); assert.deepEqual(await positions(), paused);
  for (const journey of ['coast', 'desert', 'snow', 'coast']) {
    await page.evaluate(async journey => {
      const a = window.__coastline;
      if (a.journey !== journey) await a.changeJourney(journey);
      // A representative sparse encounter: one car ahead, one approaching.
      a.vehicle.s = 1022; a.vehicle.reset(); a.world.update(a.vehicle.s);
      a.traffic.reset(a.vehicle.route, a.vehicle.s, journey);
      a.traffic.respawn(a.traffic.vehicles[2], a.vehicle.s + 32);
      a.traffic.respawn(a.traffic.vehicles[3], a.vehicle.s + 82);
      a.vehicle.render(1, a.world.origin); a.traffic.render(1, a.world.origin);
      a.rendering.snap(); a.rendering.update(a.vehicle.car, 1, a.world.origin); a.world.animate(0, a.vehicle);
      a.rendering.renderer.render(a.rendering.scene, a.rendering.camera);
    }, journey);
    const record = await page.evaluate(() => {
      const a = window.__coastline;
      return { journey: a.journey, count: a.traffic.vehicles.length, models: [...new Set(a.traffic.vehicles.map(car => car.spec.name))], geometries: a.rendering.renderer.info.memory.geometries,
        lamps: a.traffic.vehicles[0].car.children[2].material.emissiveIntensity, groups: a.rendering.scene.children.filter(child => child.name === 'traffic').length };
    });
    assert.equal(record.count, 6); assert.equal(record.models.length, 5); assert.equal(record.groups, 1); assert.ok(record.geometries < 185);
    assert.equal(record.lamps > 2, journey === 'snow'); records.push(record);
    await page.locator('#pause-overlay').evaluate(el => { el.style.visibility = 'hidden'; });
    await page.screenshot({ path: `.artifacts/traffic-${journey}.png` });
  }
  // Run the actual controller and fleet together through an impact and origin shift.
  const impact = await page.evaluate(async () => {
    const a = window.__coastline;
    a.vehicle.s = 1022; a.vehicle.reset(); a.vehicle.speed = 28;
    a.traffic.reset(a.vehicle.route, a.vehicle.s);
    const other = a.traffic.vehicles[0]; a.traffic.respawn(other, a.vehicle.s + 12); other.speed = 0; other.cruiseSpeed = 0;
    let hit = false;
    for (let i = 0; i < 90; i++) {
      a.vehicle.update(1 / 60, { forward: true }); a.traffic.update(1 / 60, a.vehicle);
      if (a.vehicle.speed < 16 && other.speed > 10) hit = true; // slowed, with the stopped car shoved on
      a.world.update(a.vehicle.s); a.vehicle.render(.5, a.world.origin); a.traffic.render(.5, a.world.origin);
    }
    const result = { hit, behind: a.vehicle.s < other.s, origin: a.world.origin, playerZ: a.vehicle.car.position.z, trafficZ: other.car.position.z + a.traffic.group.position.z };
    await a.action('reset'); result.clearAfterReset = a.traffic.vehicles.every(car => Math.abs(car.s - a.vehicle.s) >= 18);
    return result;
  });
  assert.ok(impact.hit && impact.behind && impact.clearAfterReset); assert.equal(impact.origin, 1024);
  assert.ok(Math.abs(impact.playerZ - impact.trafficZ) < 15);
  // Close-up contact sheet makes all five procedural silhouettes reviewable.
  await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { createTrafficModels, TRAFFIC_COLORS } = await import('/src/traffic-models.js');
    const models = createTrafficModels(), scene = new THREE.Scene(); scene.background = new THREE.Color('#dce6df');
    scene.add(new THREE.HemisphereLight('#ffffff', '#728377', 2));
    const sun = new THREE.DirectionalLight('#fff0d4', 3); sun.position.set(-10, 20, 15); scene.add(sun);
    for (let i = 0; i < 5; i++) {
      const { car } = models.create(i, TRAFFIC_COLORS[i + 1]); car.position.x = (i - 2) * 5.2; car.rotation.y = -.45; scene.add(car);
    }
    const canvas = document.createElement('canvas'); canvas.id = 'traffic-lineup'; canvas.style.cssText = 'position:fixed;inset:0;z-index:99999;width:1440px;height:600px'; document.body.append(canvas);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); renderer.setSize(1440, 600); renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const camera = new THREE.OrthographicCamera(-15, 15, 6.25, -6.25, .1, 100); camera.position.set(-5, 12, 20); camera.lookAt(0, .8, 0);
    renderer.render(scene, camera);
    window.__trafficLineupCleanup = () => { renderer.dispose(); models.dispose(); canvas.remove(); };
  });
  await page.locator('#traffic-lineup').screenshot({ path: '.artifacts/traffic-models.png' });
  await page.evaluate(() => window.__trafficLineupCleanup());
  assert.deepEqual(errors, []);
  const report = { passed: true, movesAndPauses: true, impact, records, browserErrors: errors };
  await writeFile('.artifacts/traffic-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
