import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const stage = process.argv[2] || 'after';
const directory = `.artifacts/alpine/${stage}`;
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], records = [];
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const url = new URL(process.env.TEST_URL || 'http://127.0.0.1:5173');
    url.searchParams.set('seed', process.env.TEST_WORLD_SEED || '4817');
    await page.goto(url.href);
    await page.waitForFunction(() => window.__coastline && document.querySelector('#loading.loaded'), null, { timeout: 120000 });
    await page.click('#start');
    await page.evaluate(() => window.__coastline.action('pause'));
    const hideUI = '#app > :not(#scene), #pwa-install-invitation { display:none !important; }';
    const style = await page.addStyleTag({ content: hideUI });
    const spawn = await page.evaluate(async () => (await import('/src/world/route.js')).journeyStart(3).s);
    for (const [journey, s] of mobile ? [['snow', 24], ['snow', 420], ['snow', -1200], ['snow', spawn]]
      : [['coast', 24], ['desert', 420], ['snow', 24], ['snow', 420], ['snow', -1200]]) {
      const record = await page.evaluate(async ({ journey, s }) => {
        const a = window.__coastline;
        if (a.journey !== journey) await a.changeJourney(journey);
        a.vehicle.s = s; a.vehicle.reset();
        await a.world.chunkSource?.prepare(s);
        a.world.update(s); a.vehicle.render(1, a.world.origin); a.traffic.render(1, a.world.origin);
        a.rendering.snap(); a.rendering.update(a.vehicle.car, 10, a.world.origin); a.rendering.resize();
        a.world.animate(9, a.vehicle); a.rendering.render();
        return { journey, s, view: a.rendering.viewLabel, chunks: a.world.chunks.size,
          ...a.rendering.renderer.info.render, memory: { ...a.rendering.renderer.info.memory } };
      }, { journey, s });
      await page.screenshot({ path: `${directory}/${journey}-${s}-${mobile ? 'mobile' : 'desktop'}.png` });
      if (mobile && s === spawn) {
        await style.evaluate(el => { el.textContent = ''; });
        await page.evaluate(() => { document.querySelector('#pause-overlay').hidden = true; });
        await page.screenshot({ path: `${directory}/mobile-with-controls.png` });
        await style.evaluate((el, content) => { el.textContent = content; }, hideUI);
        // Framing has to leave the car visible when entering the scene and
        // rotating between portrait and landscape on different phone sizes.
        for (const [width, height] of [[320, 568], [430, 932], [844, 390], [390, 844]]) {
          await page.setViewportSize({ width, height });
          const position = await page.evaluate(() => {
            const a = window.__coastline;
            a.rendering.resize(); a.rendering.update(a.vehicle.car, 10, a.world.origin); a.rendering.render();
            const p = a.vehicle.car.position.clone().project(a.rendering.camera);
            return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 };
          });
          assert.ok(position.x > 24 && position.x < width - 24 && position.y > 60 && position.y < height - 120,
            `car outside the playable area at ${width}x${height}: ${JSON.stringify(position)}`);
        }
      }
      assert.ok(record.chunks >= 5);
      assert.ok(record.triangles > 20000);
      records.push({ mobile, ...record });
    }
    if (stage !== 'before') {
      const sites = await page.evaluate(async () => {
        const { alpineLanding, alpineRelay } = await import('/src/world/alpine-landmarks.js');
        const landings = Array.from({ length: 19 }, (_, i) => alpineLanding(i - 9)).filter(Boolean);
        return [alpineRelay(0), landings.sort((a, b) => Math.abs(a.s) - Math.abs(b.s))[0]];
      });
      for (const site of sites) {
        const name = site.kind || 'summit-relay';
        const record = await page.evaluate(async ({ site, mobile }) => {
          const a = window.__coastline;
          a.vehicle.s = site.s; a.vehicle.reset(); await a.world.chunkSource?.prepare(site.s);
          a.world.update(site.s); a.vehicle.render(1, a.world.origin); a.rendering.snap();
          // Show the relay in the existing wide view, and the landing in the
          // phone's default view. Detail shots below are explicitly reframed.
          const view = site.kind ? (mobile ? 'Close view' : 'Medium view') : 'Scenic view';
          while (a.rendering.viewLabel !== view) a.rendering.toggleView();
          a.rendering.update(a.vehicle.car, 10, a.world.origin); a.world.animate(9, a.vehicle); a.rendering.render();
          const feature = [...a.world.chunks.values()].flatMap(chunk => chunk.features?.alpineLandmarks ?? [])
            .find(f => f.kind === (site.kind || 'summit-relay') && f.index === site.index);
          return { name: site.kind || 'summit-relay', mobile, present: !!feature, geometries: a.rendering.renderer.info.memory.geometries };
        }, { site, mobile });
        assert.ok(record.present, `${name} must survive worker construction`);
        await page.screenshot({ path: `${directory}/${name}-${mobile ? 'mobile' : 'desktop'}.png` });
        if (!mobile) {
          await page.evaluate(async site => {
            const a = window.__coastline;
            const { snowPosition, snowGroundHeight, LAKE_LEVEL } = await import('/src/world/snow-route.js');
            const y = site.kind ? LAKE_LEVEL + 1 : snowGroundHeight(site.s, site.u) + 12;
            const p = snowPosition(site.s, site.u - (site.kind ? 5 : -3), y);
            const camera = a.rendering.camera, size = site.kind ? 36 : 62, aspect = innerWidth / innerHeight;
            camera.left = -size * aspect / 2; camera.right = size * aspect / 2; camera.top = size / 2; camera.bottom = -size / 2;
            camera.position.set(p.x - 110, y + 115, p.z + a.world.origin + 140);
            camera.lookAt(p.x, y, p.z + a.world.origin); camera.updateProjectionMatrix(); a.rendering.render();
          }, site);
          await page.screenshot({ path: `${directory}/${name}-detail.png` });
        }
        records.push(record);
      }
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${directory}/report.json`, JSON.stringify({ errors, records }, null, 2));
  console.log(JSON.stringify({ errors, records }, null, 2));
} finally { await browser.close(); }
