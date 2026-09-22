import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const url = process.env.TEST_URL ?? 'http://127.0.0.1:5173';
await mkdir('.artifacts/city-layout', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await page.goto(`${url}/?seed=4817`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__citydriver && document.querySelector('#loading').classList.contains('loaded'), null, { timeout: 60000 });
  await page.click('#free-drive');
  await page.evaluate(() => window.__citydriver.action('pause'));
  const report = await page.evaluate(async () => {
    const a = window.__citydriver, car = a.vehicle;
    const { cityLanePose, cityLayout } = await import('/src/world/city-layout.js');
    const { cityStreetAt, cityStreetProfile, citydriverRoute } = await import('/src/world/city-grid.js');
    const { CityAutodrive } = await import('/src/city-autodrive.js');
    const { collideScenery } = await import('/src/collision.js');
    a.traffic.setEnabled(false, car);
    const drives = [];
    for (const [axis, index, along, direction] of [['north', 3, -180, 1], ['north', -3, 160, -1], ['east', 4, 270, 1], ['east', -4, -270, -1],
      ['north', 2, 490, 1], ['north', -3, -730, -1], ['east', 6, 300, 1], ['east', 5, 490, -1]]) {
      const profile = cityStreetProfile(axis, index), lane = index * 112 + (axis === 'north' ? 1 : -1) * direction * profile.lane;
      Object.assign(car, cityLanePose(axis, lane, along, direction)); car.speed = 0;
      car.knock.x = car.knock.z = car.knock.spin = 0; car.update(0, {});
      const pilot = new CityAutodrive(), from = { s: car.s, u: car.u }, impact = car.audioTelemetry.impactSerial;
      let offRoad = 0, blocked = 0;
      for (let tick = 0; tick < 2400; tick++) {
        a.world.update(car.s, car.u);
        car.update(1 / 60, pilot.update(car, { enabled: false })); collideScenery(car, a.world.chunks, 1 / 60);
        offRoad += !cityStreetAt(car.s, car.u).onRoad; blocked += car.ground(car.s, car.u).blocked;
      }
      drives.push({ axis, index, direction, offRoad, blocked, impacts: car.audioTelemetry.impactSerial - impact, distance: Math.hypot(car.s - from.s, car.u - from.u) });
    }
    const wet = cityLayout(56, 392), deck = cityLayout(3, 392);
    return { drives, riverBlocked: citydriverRoute.water(wet.s, wet.u), bridgeDry: !citydriverRoute.water(deck.s, deck.u) };
  });
  for (const drive of report.drives) {
    assert.equal(drive.offRoad, 0, JSON.stringify(drive)); assert.equal(drive.blocked, 0, JSON.stringify(drive));
    assert.equal(drive.impacts, 0, JSON.stringify(drive)); assert.ok(drive.distance > 280, JSON.stringify(drive));
  }
  assert.ok(report.riverBlocked && report.bridgeDry);
  await page.selectOption('#city-weather', 'clear');
  await page.evaluate(async () => {
    const a = window.__citydriver;
    const { cityLanePose } = await import('/src/world/city-layout.js');
    Object.assign(a.vehicle, cityLanePose('north', 338.7, 120)); a.vehicle.speed = 0; a.vehicle.update(0, {});
    a.world.update(a.vehicle.s, a.vehicle.u); a.vehicle.render(1, a.world.origin);
    a.rendering.setView(4); a.rendering.snap(); a.rendering.update(a.vehicle.car, 1, a.world.origin);
    document.querySelector('#pause-overlay').hidden = true; a.cityGuide.update(false); a.rendering.render();
  });
  await page.screenshot({ path: '.artifacts/city-layout/riverfront-drive.png' });
  await page.evaluate(async () => {
    const a = window.__citydriver;
    const { cityLanePose } = await import('/src/world/city-layout.js');
    Object.assign(a.vehicle, cityLanePose('north', 3, 585)); a.vehicle.speed = 0; a.vehicle.update(0, {});
    a.world.update(a.vehicle.s, a.vehicle.u); a.vehicle.render(1, a.world.origin);
    a.rendering.snap(); a.rendering.update(a.vehicle.car, 1, a.world.origin);
    a.cityGuide.update(false); a.rendering.render();
  });
  await page.screenshot({ path: '.artifacts/city-layout/horizontal-river-bridge.png' });
  await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const a = window.__citydriver, r = a.rendering;
    a.world.update(280, 300); a.world.scene.fog = null;
    const camera = new THREE.OrthographicCamera(-640, 640, 445, -445, 1, 2200);
    camera.position.set(300, 1300, a.world.origin - 280); camera.up.set(0, 0, -1); camera.lookAt(300, 0, a.world.origin - 280);
    document.querySelectorAll('body > :not(canvas):not(script)').forEach(e => { e.style.visibility = 'hidden'; });
    r.renderer.domElement.style.visibility = 'visible';
    r.renderer.render(a.world.scene, camera);
  });
  await page.screenshot({ path: '.artifacts/city-layout/overview.png' });
  assert.deepEqual(errors, []);
  await writeFile('.artifacts/city-layout/report.json', JSON.stringify({ ...report, errors }, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
