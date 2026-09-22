import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const directory = '.artifacts/handling';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('citydriver.graphics', JSON.stringify({ mode: 'basic' })));
  await page.goto(`${process.env.TEST_URL ?? 'http://127.0.0.1:5173'}/?seed=4817`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__citydriver && document.querySelector('#loading.loaded'), null, { timeout: 90000 });
  await page.click('#free-drive');
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__citydriver.vehicle.speed > 8);
  await page.keyboard.up('KeyW');
  const before = await page.evaluate(() => window.__citydriver.vehicle.heading);
  await page.keyboard.down('KeyD');
  await page.waitForFunction(heading => window.__citydriver.vehicle.heading > heading + .02, before);
  await page.keyboard.up('KeyD');
  await page.waitForFunction(() => Math.abs(window.__citydriver.vehicle.steer) < .01);
  // Exercise real keyboard events, including overlapping corrections and key
  // repeat, rather than only feeding synthetic values to the controller.
  await page.keyboard.down('KeyD');
  await page.keyboard.down('KeyA');
  assert.deepEqual(await page.evaluate(() => {
    const state = window.__citydriver.input.state;
    return [Boolean(state.left), Boolean(state.right)];
  }), [true, false]);
  await page.keyboard.down('KeyD'); // An OS repeat must not reclaim priority.
  assert.equal(await page.evaluate(() => Boolean(window.__citydriver.input.state.left)), true);
  await page.keyboard.up('KeyA');
  assert.equal(await page.evaluate(() => Boolean(window.__citydriver.input.state.right)), true);
  await page.keyboard.up('KeyD');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal(await page.evaluate(() => Boolean(window.__citydriver.input.state.right)), false);
  await page.keyboard.press('KeyP');
  const report = await page.evaluate(async () => {
    const a = window.__citydriver, v = a.vehicle;
    a.rendering.renderer.setAnimationLoop(null);
    const { collideScenery } = await import('/src/collision.js');
    const { cityLanePose, cityLogical } = await import('/src/world/city-layout.js');
    const { CAR_IDS, DRAG } = await import('/src/cars.js');
    const { turningRadius } = await import('/src/handling.js');
    const { cityStreetProfile, CITY_BLOCK } = await import('/src/world/city-grid.js');
    const { PHYSICS_STEP } = await import('/src/timing.js');
    a.traffic.setEnabled(false, v);
    const turns = [];
    for (const arcade of [false, true]) for (const direction of [-1, 1]) {
      v.arcade = arcade; v.setCar('taxi'); v.reset();
      Object.assign(v, cityLanePose('north', 3, direction > 0 ? -7 : -3));
      v.update(0, {});
      for (let i = 0; i < 12; i++) a.world.update(v.s, v.u);
      const initialHeading = v.heading, initialImpact = v.audioTelemetry.impactSerial;
      let ticks = 0;
      const step = steering => {
        // Balance drag to test a repeatable 6 m/s junction turn with real scenery.
        v.speed = 6;
        v.update(PHYSICS_STEP, { forward: (DRAG.rolling + DRAG.air * 36) / (v.stats.acceleration * 1.11),
          right: Math.max(0, steering), left: Math.max(0, -steering) });
        collideScenery(v, a.world.chunks, PHYSICS_STEP);
      };
      while (Math.abs(v.heading - initialHeading) < Math.PI / 2 && ticks++ < 1000) step(direction);
      for (let i = 0; i < 240; i++) step(0);
      turns.push({ arcade, direction, ticks, ...cityLogical(v.s, v.u),
        impacts: v.audioTelemetry.impactSerial - initialImpact, speed: v.speed });
    }
    const cityTurns = [];
    for (const index of [1, 0, 2]) for (const id of CAR_IDS) for (const direction of [-1, 1]) for (const axis of ['north', 'east']) {
      const profile = cityStreetProfile(axis, index), center = index * CITY_BLOCK;
      const speed = ['formula', 'taxiFormula'].includes(id) ? (index === 1 ? 25 : 28)
        : ['rig', 'monster'].includes(id) ? 10 : index === 1 ? 15 : 18;
      v.setCar(id); v.reset(); v.arcade = false;
      Object.assign(v, cityLanePose(axis, center + (axis === 'north' ? 1 : -1) * profile.lane,
        center - direction * profile.lane));
      const radius = turningRadius(speed, v.stats);
      v.s -= Math.cos(v.heading) * (radius + speed * .04);
      v.u -= Math.sin(v.heading) * (radius + speed * .04);
      v.update(0, {});
      for (let i = 0; i < 12; i++) a.world.update(v.s, v.u);
      const initialHeading = v.heading, initialImpact = v.audioTelemetry.impactSerial;
      const launch = 1 + .22 * Math.max(0, 1 - speed / 12);
      let ticks = 0;
      const step = steering => {
        v.speed = speed;
        v.update(PHYSICS_STEP, { forward: (DRAG.rolling + DRAG.air * speed * speed) / (v.stats.acceleration * launch),
          right: Math.max(0, steering), left: Math.max(0, -steering) });
        collideScenery(v, a.world.chunks, PHYSICS_STEP);
      };
      while (Math.abs(v.heading - initialHeading) < Math.PI / 2 && ticks++ < 600) step(direction);
      for (let i = 0; i < Math.ceil(18 / speed / PHYSICS_STEP); i++) step(0);
      cityTurns.push({ id, street: profile.kind, axis, direction, speed, radius, ticks,
        impacts: v.audioTelemetry.impactSerial - initialImpact });
    }
    // Measure real player + scenery + traffic work at both rates. This is CPU
    // headroom on the test machine, not an end-to-end input latency measurement.
    v.setCar('taxi'); v.reset(); Object.assign(v, cityLanePose('north', 3, 24)); v.update(0, {});
    a.traffic.setEnabled(true, v);
    const cpu = [];
    for (const hz of [60, 120]) {
      const samples = [];
      for (let i = 0; i < hz * 6; i++) {
        const start = performance.now();
        v.update(1 / hz, {}); collideScenery(v, a.world.chunks, 1 / hz); a.traffic.update(1 / hz, v);
        if (i >= hz) samples.push(performance.now() - start);
      }
      samples.sort((x, y) => x - y);
      cpu.push({ hz, meanMs: samples.reduce((sum, ms) => sum + ms, 0) / samples.length,
        p95Ms: samples[Math.floor(samples.length * .95)] });
    }
    a.traffic.setEnabled(false, v);
    v.reset(); Object.assign(v, cityLanePose('north', 3, -9)); v.update(0, {});
    for (let i = 0; i < 80; i++) {
      v.speed = 14; v.update(PHYSICS_STEP, { forward: 1, right: 1, handbrake: i < 12 });
      collideScenery(v, a.world.chunks, PHYSICS_STEP);
    }
    v.render(1, a.world.origin); a.rendering.setView(4); a.rendering.snap();
    a.rendering.update(v.car, 1, a.world.origin); a.rendering.render();
    document.querySelector('#pause-overlay').hidden = true;
    return { turns, cityTurns, cpu, stepMs: PHYSICS_STEP * 1000, tapDriftActive: v.drifting,
      handbrakeReleased: v.audioTelemetry.handbrake === 0, driftSlipDegrees: (v.heading - v.slideHeading) * 180 / Math.PI };
  });
  await page.screenshot({ path: `${directory}/corner.png` });
  await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2));
  for (const turn of report.turns) {
    assert.ok(turn.ticks < 1000 && turn.impacts === 0, `junction turn: ${JSON.stringify(turn)}`);
    assert.ok(Math.abs(turn.s) < 8 && turn.u * turn.direction > 10, `exit onto cross street: ${JSON.stringify(turn)}`);
  }
  for (const turn of report.cityTurns) {
    assert.ok(turn.ticks < 600 && turn.impacts === 0, `city-speed corner: ${JSON.stringify(turn)}`);
  }
  assert.ok(report.driftSlipDegrees > 5 && report.driftSlipDegrees < 32);
  assert.ok(report.tapDriftActive && report.handbrakeReleased, 'slide continues after releasing the handbrake');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ...report, cityTurns: { trials: report.cityTurns.length,
    impacts: report.cityTurns.reduce((total, turn) => total + turn.impacts, 0) } }, null, 2));
} finally { await browser.close(); }
