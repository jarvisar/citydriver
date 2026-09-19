import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const before = process.argv.includes('--before');
const directory = process.env.TEST_ARTIFACT_DIR || `.artifacts/snow-discoveries/${before ? 'before' : 'after'}`;
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], records = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  const url = new URL(process.env.TEST_URL || 'http://127.0.0.1:5173');
  url.searchParams.set('seed', process.env.TEST_WORLD_SEED || '4817');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__coastline && document.querySelector('#loading.loaded'), { timeout: 120000 });
  await page.evaluate(() => window.__coastline.changeJourney('snow'));
  await page.waitForFunction(() => window.__coastline.journey === 'snow' && !window.__coastline.changingJourney);
  await page.addStyleTag({ content: '#app > :not(#scene), #pwa-install-invitation {display:none !important;}' });
  const sites = await page.evaluate(async () => {
    const { snowDiscoveries } = await import('/src/world/snow-discoveries.js');
    const all = snowDiscoveries(-150000, 150000);
    return ['cable-car', 'snowmen'].map(kind => all.filter(s => s.kind === kind).sort((a, b) => Math.abs(a.s) - Math.abs(b.s))[0]);
  });
  assert.ok(sites.every(Boolean), 'the discovery appears in the world');
  for (const site of [...sites, sites[0]]) {
    const record = await page.evaluate(async site => {
      const a = window.__coastline;
      if (!a.paused) await a.action('pause');
      a.vehicle.s = site.s - 30; a.vehicle.reset(); a.world.update(a.vehicle.s); a.vehicle.render(1, a.world.origin);
      while (a.rendering.viewLabel !== 'Medium view') a.rendering.toggleView();
      a.rendering.snap(); a.rendering.update(a.vehicle.car, 10, a.world.origin); a.rendering.resize();
      a.world.animate(9, a.vehicle); a.rendering.render();
      return { kind: site.kind, s: site.s, chunks: a.world.chunks.size, resident: a.graphics.settings.chunks.behind + a.graphics.settings.chunks.ahead + 1,
        geometries: a.rendering.renderer.info.memory.geometries, calls: a.rendering.renderer.info.render.calls,
        features: [...a.world.chunks.values()].flatMap(chunk => chunk.features?.discoveries ?? []).map(f => ({ kind: f.kind, index: f.index })) };
    }, site);
    assert.equal(record.chunks, record.resident);
    if (!before) assert.equal(record.features.filter(f => f.index === site.index).length, 1, 'one chunk owns each discovery');
    await page.screenshot({ path: `${directory}/${site.kind}-drive.png` });
    // A framed view of the whole discovery, from the road's side.
    await page.evaluate(async site => {
      const a = window.__coastline;
      const { snowPosition, snowRoadHeight } = await import('/src/world/snow-route.js');
      const snowmen = site.kind === 'snowmen';
      const u = snowmen ? site.u : (site.lower.u + site.upper.u) / 2;
      const p = snowPosition(site.s, u, 0), z = p.z + a.world.origin;
      const y = snowRoadHeight(site.s) + (snowmen ? 2 : 26);
      const camera = a.rendering.camera, height = snowmen ? 16 : 230, aspect = innerWidth / innerHeight;
      camera.left = -height * aspect / 2; camera.right = height * aspect / 2; camera.top = height / 2; camera.bottom = -height / 2;
      camera.position.set(p.x - (snowmen ? 24 : 220), y + (snowmen ? 14 : 245), z + (snowmen ? 22 : 260)); camera.lookAt(p.x, y, z);
      camera.updateProjectionMatrix(); a.rendering.render();
    }, site);
    await page.screenshot({ path: `${directory}/${site.kind}-detail.png` });
    records.push(record);
  }
  // Streaming back to the first site must not leak geometry.
  assert.ok(records.at(-1).geometries <= records[0].geometries + 8, 'streaming leaves the geometry count bounded');
  if (!before) {
    const motion = await page.evaluate(async () => {
      const a = window.__coastline;
      const { snowDiscoveries } = await import('/src/world/snow-discoveries.js');
      const site = snowDiscoveries(-150000, 150000).filter(s => s.kind === 'cable-car').sort((x, y) => Math.abs(x.s) - Math.abs(y.s))[0];
      a.vehicle.s = site.s - 30; a.vehicle.reset(); a.world.update(a.vehicle.s);
      const cabins = a.rendering.scene.getObjectByName('cable-car-cabins');
      const read = () => Array.from(cabins.instanceMatrix.array);
      a.world.animate(9, a.vehicle); const first = read();
      a.world.animate(30, a.vehicle); const later = read();
      a.rendering.render();
      return { count: cabins.count, first, later };
    });
    assert.equal(motion.count, 2, 'each line carries two cabins');
    assert.notDeepEqual(motion.later, motion.first, 'cabins travel with the scene clock');
    await page.screenshot({ path: `${directory}/cable-car-travel.png` });
    await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(() =>
      Array.from(window.__coastline.rendering.scene.getObjectByName('cable-car-cabins').instanceMatrix.array)),
      motion.later, 'paused cabins stay put');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    const a = window.__coastline;
    a.rendering.resize(); a.rendering.snap(); a.rendering.update(a.vehicle.car, 10, a.world.origin); a.rendering.render();
  });
  await page.screenshot({ path: `${directory}/cable-car-mobile.png` });
  // Leaving the journey takes the discoveries with it.
  await page.evaluate(() => window.__coastline.changeJourney('coast'));
  await page.waitForFunction(() => window.__coastline.journey === 'coast' && !window.__coastline.changingJourney);
  for (const name of ['cable-car-line', 'cable-car-cabins', 'snowmen']) {
    assert.equal(await page.evaluate(name => !!window.__coastline.rendering.scene.getObjectByName(name), name), false, `${name} outlived the snow route`);
  }
  assert.deepEqual(errors, []);
  await writeFile(`${directory}/report.json`, JSON.stringify({ passed: true, records, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, records: records.map(({ features, ...rest }) => rest) }, null, 2));
} finally { await browser.close(); }
