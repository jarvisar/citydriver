import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// Use the same seed, cameras, weather and game time for before/after captures.
const output = process.env.WATER_OUTPUT ?? '.artifacts/river-water/after';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], report = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await page.goto(`${process.env.TEST_URL ?? 'http://127.0.0.1:5173'}/?seed=4817`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__citydriver && document.querySelector('#loading').classList.contains('loaded'), null, { timeout: 60000 });
  await page.click('#free-drive');
  await page.evaluate(() => {
    if (!window.__citydriver.paused) window.__citydriver.action('pause');
    window.__citydriver.rendering.renderer.setAnimationLoop(null);
  });
  for (const shot of [
    { name: 'north-day', ix: 3, iz: 2, weather: 'clear' },
    { name: 'east-day', ix: 2, iz: 5, weather: 'clear' },
    { name: 'confluence', ix: 3, iz: 5, weather: 'clear', wide: true },
    { name: 'north-sunset', ix: 3, iz: 2, weather: 'sunset' },
    { name: 'north-night', ix: 3, iz: 2, weather: 'night' },
    { name: 'north-low-angle', ix: 3, iz: 2, weather: 'clear', low: true },
    { name: 'north-motion', ix: 3, iz: 2, weather: 'clear', time: 15 },
    { name: 'north-phone', ix: 3, iz: 2, weather: 'clear', phone: true },
  ]) {
    const result = await page.evaluate(async shot => {
      const THREE = await import('/node_modules/three/build/three.module.js');
      const { cityLayout } = await import('/src/world/city-layout.js');
      const { sampleCityWeather } = await import('/src/world/city-weather.js');
      const { fitSunShadow } = await import('/src/shadows.js');
      const a = window.__citydriver, r = a.rendering;
      const p = cityLayout((shot.iz + .5) * 112, (shot.ix + .5) * 112);
      a.world.update(p.s, p.u);
      Object.assign(a.vehicle, { s: p.s, u: p.u, speed: 0 });
      a.vehicle.update(0, {}); a.vehicle.render(1, a.world.origin);
      a.vehicle.car.visible = false;
      r.snap(); r.update(a.vehicle.car, 1, a.world.origin);
      r.setWeather(sampleCityWeather(0, shot.weather), 0);
      const width = shot.phone ? 480 : 1280, height = shot.phone ? 800 : 900;
      r.renderer.setPixelRatio(1); r.renderer.setSize(width, height);
      const span = shot.wide ? 120 : 66;
      const camera = shot.low ? new THREE.PerspectiveCamera(57, width / height, .5, 1800)
        : new THREE.OrthographicCamera(-span * width / height, span * width / height, span, -span, 1, 1800);
      const z = a.world.origin - p.s;
      camera.position.set(p.u + (shot.low ? 19 : 105), shot.low ? 29 : 146, z + (shot.low ? 49 : 118));
      camera.lookAt(p.u, 19, z - (shot.low ? 30 : 0));
      camera.updateMatrixWorld();
      a.world.animate(shot.time ?? 12, 12, camera);
      const sun = a.world.scene.children.find(c => c.isDirectionalLight);
      fitSunShadow(camera, sun, 0, a.world.origin);
      r.renderer.shadowMap.needsUpdate = true;
      r.renderer.render(a.world.scene, camera);
      return { png: r.renderer.domElement.toDataURL('image/png'), calls: r.renderer.info.render.calls,
        triangles: r.renderer.info.render.triangles, waterTime: a.world.materials.water.userData.time?.value,
        programs: r.renderer.info.programs.map(p => ({ name: p.name, runnable: p.diagnostics?.runnable ?? true })) };
    }, shot);
    const { png, ...stats } = result;
    await writeFile(`${output}/${shot.name}.png`, Buffer.from(png.split(',')[1], 'base64'));
    assert.ok(stats.programs.every(p => p.runnable), `${shot.name}: shader compilation failed`);
    report.push({ ...shot, ...stats });
  }
  const continuity = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { CitydriverChunk } = await import('/src/world/citydriver-world.js');
    const { DistantCity } = await import('/src/world/distant-city.js');
    const a = window.__citydriver, renderer = a.rendering.renderer, material = a.world.materials.water;
    const time = material.userData.time, origin = material.userData.origin;
    if (!time) return { baseline: true };
    const previousTime = time.value, previousOrigin = origin.value;
    const source = a.world.chunks.get('3,2').group.getObjectByName('citydriver-water');
    const water = source.clone(); water.matrix.copy(source.matrixWorld); water.matrixAutoUpdate = false;
    const scene = new THREE.Scene(); scene.add(water, new THREE.HemisphereLight('#c9e2f2', '#717977', 2));
    const center = source.boundingSphere.center.clone().applyMatrix4(source.matrixWorld);
    const camera = new THREE.OrthographicCamera(-75, 75, 75, -75, 1, 400);
    camera.position.copy(center).add(new THREE.Vector3(60, 130, 85)); camera.lookAt(center);
    const target = new THREE.WebGLRenderTarget(256, 256);
    const distantGroup = new THREE.Group(); distantGroup.position.z = previousOrigin; scene.add(distantGroup);
    const distant = new DistantCity(distantGroup), chunk = new CitydriverChunk(3, 2, a.world.materials, true);
    for (const key of chunk.batches.keys()) if (key !== 'water') chunk.batches.delete(key);
    distant.add(chunk); distant.rebuild(); distantGroup.visible = false;
    const capture = () => {
      renderer.setRenderTarget(target); renderer.render(scene, camera);
      const pixels = new Uint8Array(256 * 256 * 4);
      renderer.readRenderTargetPixels(target, 0, 0, 256, 256, pixels); return pixels;
    };
    const difference = (a, b) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;
    try {
      time.value = 12; const first = capture(), paused = capture();
      time.value = 15; const moving = capture(); time.value = 12;
      water.visible = false; distantGroup.visible = true; const far = capture();
      water.visible = true; distantGroup.visible = false;
      origin.value += 1024; water.matrix.elements[14] += 1024; water.matrixWorldNeedsUpdate = true; camera.position.z += 1024;
      const rebased = capture();
      return { motionDifference: difference(first, moving), pausedDifference: difference(first, paused),
        distantDifference: difference(first, far), rebaseDifference: difference(first, rebased) };
    } finally {
      time.value = previousTime; origin.value = previousOrigin;
      renderer.setRenderTarget(null); target.dispose(); water.dispose(); distant.dispose();
    }
  });
  if (!continuity.baseline) {
    // Subtle color changes are intentional; assert motion without requiring
    // the stronger contrast of the original water treatment.
    assert.ok(continuity.motionDifference > .01, 'water actually animates');
    assert.equal(continuity.pausedDifference, 0, 'pausing holds the water still');
    assert.ok(continuity.distantDifference < .1, `detail transitions preserve water: ${JSON.stringify(continuity)}`);
    assert.ok(continuity.rebaseDifference < .1, `origin shifts preserve water: ${JSON.stringify(continuity)}`);
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ report, continuity, errors }, null, 2));
  console.log(`Captured ${report.length} river views without browser or shader errors in ${output}. ${JSON.stringify(continuity)}`);
} finally { await browser.close(); }
