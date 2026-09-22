import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Repeatable before/after photography of the actual procedural city.
const phase = process.argv[2] ?? 'after';
assert.ok(['before', 'after'].includes(phase));
const output = `.artifacts/city-tour/${phase}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [], report = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${process.env.TEST_URL ?? 'http://127.0.0.1:5173'}/?seed=4817`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__citydriver && document.querySelector('#loading').classList.contains('loaded'), null, { timeout: 90000 });
  await page.click('#free-drive');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#welcome')).visibility === 'hidden');
  await page.screenshot({ path: `${output}/gameplay.png` });
  await page.evaluate(() => { if (!window.__citydriver.paused) window.__citydriver.action('pause'); });
  const shots = [
    { key: 'neighborhood', title: 'The starting neighborhood', s: 56, u: 56, span: 240 },
    { key: 'waterfront', title: 'Along the river', s: -4.5 * 112, u: 112, span: 235 },
    { key: 'midtown', title: 'City blocks and skyline', s: 4.5 * 112, u: -.5 * 112, span: 220 },
    { key: 'street', title: 'At street level', s: 56, u: 3, street: true },
  ];
  if (phase === 'after') {
    const sites = await page.evaluate(async () => {
      const { cityBlock } = await import('/src/world/city-grid.js');
      const { CITY_PLACES, destinationType } = await import('/src/world/city-places.js');
      const { planBuildings } = await import('/src/world/city-buildings.js');
      const found = new Map();
      for (let radius = 0; radius <= 14; radius++) for (let ix = -radius; ix <= radius; ix++) for (let iz = -radius; iz <= radius; iz++) {
        const block = cityBlock(ix, iz);
        const type = destinationType(block);
        if (type && !found.has(type)) found.set(type, { key: type, title: CITY_PLACES[type].name, ix, iz, s: (iz + .5) * 112, u: (ix + .5) * 112, span: 85, isolated: true });
        if (block.kind === 'blocks') for (const type of ['townhouse', 'loft', 'pavilion', 'atrium']) {
          const key = `architecture-${type}`;
          if (!found.has(key) && planBuildings(block).buildings.filter(b => b.type === type).length >= 2) {
            found.set(key, { key, title: `${type[0].toUpperCase()}${type.slice(1)} architecture`, ix, iz, s: (iz + .5) * 112, u: (ix + .5) * 112, span: 90, isolated: true });
          }
        }
      }
      return [...found.values()];
    });
    shots.push(...sites);
    const cinema = sites.find(site => site.key === 'cinema');
    if (cinema) shots.push({ ...cinema, key: 'cinema-night', title: 'Rivoli after dark', night: true });
  }
  for (const shot of shots) {
    const result = await page.evaluate(async shot => {
      const THREE = await import('/node_modules/three/build/three.module.js');
      const { cityLayout } = await import('/src/world/city-layout.js');
      const { CitydriverChunk } = await import('/src/world/citydriver-world.js');
      const a = window.__citydriver, p = cityLayout(shot.s, shot.u), r = a.rendering.renderer;
      let scene, chunk;
      const center = new THREE.Vector3(p.u, 24, -p.s);
      if (shot.isolated) {
        scene = new THREE.Scene(); scene.background = new THREE.Color(shot.night ? '#1d303e' : '#dce2d6');
        chunk = new CitydriverChunk(shot.ix, shot.iz, a.world.materials);
        chunk.group.position.set(chunk.east, 0, -chunk.start); chunk.group.updateMatrix(); scene.add(chunk.group);
      } else {
        for (let frame = 0; frame < 10; frame++) a.world.update(p.s, p.u);
        scene = a.world.scene; center.z += a.world.origin;
      }
      const hidden = [];
      scene.traverse(o => { if (o.isLight) { hidden.push([o, o.visible]); o.visible = false; } });
      const sky = new THREE.HemisphereLight(shot.night ? '#adc1ef' : '#ecf3ff', '#698260', shot.night ? .65 : 2.1);
      const sun = new THREE.DirectionalLight(shot.night ? '#9daed4' : '#fff0d4', shot.night ? .6 : 3.1); sun.castShadow = true;
      sun.position.copy(center).add(new THREE.Vector3(-190, 310, 180)); sun.target.position.copy(center);
      sun.shadow.mapSize.set(2048, 2048);
      const shadowSpan = shot.isolated ? 120 : 340;
      Object.assign(sun.shadow.camera, { left: -shadowSpan, right: shadowSpan, top: shadowSpan, bottom: -shadowSpan, near: 1, far: 950 });
      sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -.0002; sun.shadow.normalBias = .12;
      scene.add(sky, sun, sun.target);
      const fog = scene.fog; scene.fog = shot.street ? new THREE.Fog('#cddfe1', 250, 640) : null;
      let camera;
      if (shot.street) {
        camera = new THREE.PerspectiveCamera(60, 1.44, .1, 1400);
        camera.position.copy(center).add(new THREE.Vector3(0, 6, 0));
        camera.lookAt(center.clone().add(new THREE.Vector3(5, 9, -100)));
      } else {
        camera = new THREE.OrthographicCamera(-shot.span, shot.span, shot.span / 1.44, -shot.span / 1.44, 1, 1600);
        camera.position.copy(center).add(new THREE.Vector3(260, 335, 295)); camera.lookAt(center);
      }
      r.setPixelRatio(1); r.setSize(1440, 1000); r.shadowMap.needsUpdate = true; r.render(scene, camera);
      const result = { png: r.domElement.toDataURL('image/png'), calls: r.info.render.calls, triangles: r.info.render.triangles };
      scene.remove(sky, sun, sun.target); sun.shadow.map?.dispose(); scene.fog = fog;
      for (const [light, visible] of hidden) light.visible = visible;
      chunk?.dispose();
      return result;
    }, shot);
    await writeFile(`${output}/${shot.key}.png`, Buffer.from(result.png.split(',')[1], 'base64'));
    delete result.png; report.push({ ...shot, ...result });
    console.log(`Captured ${phase}/${shot.key}`);
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ shots: report, errors }, null, 2));
} finally { await browser.close(); }
