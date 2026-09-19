import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const directory = process.env.TEST_ARTIFACT_DIR || '.artifacts/pacific-inland/review';
await mkdir(directory, {recursive: true});
const browser = await chromium.launch({executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
const errors = [], records = [];
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({viewport: mobile ? {width: 390, height: 844} : {width: 1440, height: 1000},
      deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile});
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
    const url = new URL(process.env.TEST_URL || 'http://127.0.0.1:5173');
    url.searchParams.set('seed', process.env.TEST_WORLD_SEED || '4817');
    await page.goto(url.href);
    await page.waitForFunction(() => window.__coastline && document.querySelector('#loading.loaded'), {timeout: 120000});
    await page.evaluate(async mobile => {
      const a = window.__coastline;
      if (!a.paused) await a.action('pause');
      a.graphics.setMode(mobile ? 'smooth' : 'high');
    }, mobile);
    await page.addStyleTag({content: '#app > :not(#scene), #pwa-install-invitation {display:none !important;}'});
    const sites = mobile ? [['phone', 246, 'Scenic view'], ['phone-reverse', -458, 'Scenic view']]
      : [['pond', 246, 'Scenic view'], ['ridge', 500, 'Scenic view'], ['valley', 950, 'Scenic view'],
        ['pond-4', 3062, 'Scenic view'], ['third-person', 500, 'Third-person view'], ['reverse', -458, 'Scenic view'], ['return', 246, 'Scenic view'],
        ['ridge-repeat', 500, 'Scenic view'], ['reverse-repeat', -458, 'Scenic view'], ['return-repeat', 246, 'Scenic view']];
    for (const [name, s, view] of sites) {
      const record = await page.evaluate(async ({s, view}) => {
        const a = window.__coastline;
        a.vehicle.s = s; a.vehicle.reset(); a.world.update(s); a.vehicle.render(1, a.world.origin);
        a.traffic.render(1, a.world.origin); a.rendering.snap();
        for (let i = 0; i < 5 && a.rendering.viewLabel !== view; i++) a.rendering.toggleView();
        a.rendering.update(a.vehicle.car, 10, a.world.origin); a.rendering.resize(); a.world.animate(8.5); a.rendering.render();
        return {s, chunks: a.world.chunks.size, resident: a.graphics.settings.chunks.behind + a.graphics.settings.chunks.ahead + 1,
          geometries: a.rendering.renderer.info.memory.geometries, textures: a.rendering.renderer.info.memory.textures,
          triangles: a.rendering.renderer.info.render.triangles,
          sedges: [...a.world.chunks.values()].reduce((sum, chunk) => sum + (chunk.group.getObjectByName('pond-shore-sedges')?.count || 0), 0)};
      }, {s, view});
      assert.equal(record.chunks, record.resident);
      assert.ok(record.geometries < 200, 'streamed geometry must remain bounded');
      assert.ok(record.triangles > 50000, 'scenery remains visible after origin changes');
      records.push({name, ...record});
      await page.screenshot({path: `${directory}/${name}.png`});
    }
    await page.close();
  }
  assert.ok(records.some(r => r.sedges > 0), 'shore planting must reach the renderer');
  // Shared assets are uploaded on first visibility. Compare repeated visits
  // after those uploads, rather than treating their first use as a leak.
  const first = records.find(r => r.name === 'return'), last = records.find(r => r.name === 'return-repeat');
  await writeFile(`${directory}/report.json`, JSON.stringify({errors, records}, null, 2));
  assert.ok(last.geometries <= first.geometries, 'returning releases streamed geometry');
  assert.equal(last.textures, first.textures, 'shore detail needs no extra textures');
  assert.deepEqual(errors, []);
  await writeFile(`${directory}/report.json`, JSON.stringify({passed: true, errors, records}, null, 2));
  console.log(JSON.stringify({passed: true, errors, records}, null, 2));
} finally { await browser.close(); }
