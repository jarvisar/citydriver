import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const output = '.artifacts/courtyards';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${process.env.TEST_URL ?? 'http://127.0.0.1:5173'}/?seed=4817`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__citydriver && document.querySelector('#loading').classList.contains('loaded'), null, { timeout: 60000 });
  const previews = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { cityBlock } = await import('/src/world/city-grid.js');
    const { cityLayout } = await import('/src/world/city-layout.js');
    const { planBuildings } = await import('/src/world/city-buildings.js');
    const { placeCityBuildings } = await import('/src/world/city-parcels.js');
    const { planCourtyard } = await import('/src/world/city-courtyards.js');
    const { CitydriverChunk } = await import('/src/world/citydriver-world.js');
    const app = window.__citydriver, renderer = app.rendering.renderer;
    if (!app.paused) app.action('pause');
    renderer.setPixelRatio(1); renderer.setSize(1200, 800);
    const sites = new Map();
    for (let ix = -10; ix <= 10; ix++) for (let iz = -10; iz <= 10; iz++) {
      const block = cityBlock(ix, iz);
      if (block.kind !== 'blocks' || block.landmark) continue;
      const architecture = planBuildings(block), placement = placeCityBuildings(block, architecture.buildings);
      const court = planCourtyard(block, architecture, placement);
      if (!court.islands.length) continue;
      const score = court.islands.length + placement.open.length * 2;
      if ((sites.get(architecture.layout)?.score ?? -1) < score) sites.set(architecture.layout, { ix, iz, score });
    }
    const result = [];
    for (const [layout, { ix, iz }] of sites) {
      const scene = new THREE.Scene(); scene.background = new THREE.Color('#d7e0dd');
      scene.add(new THREE.HemisphereLight('#e4f2f5', '#778569', 2));
      const sun = new THREE.DirectionalLight('#fff1db', 2.6); sun.position.set(-65, 180, 100); scene.add(sun);
      const chunk = new CitydriverChunk(ix, iz, app.world.materials); scene.add(chunk.group);
      const local = ([x, s]) => { const p = cityLayout(chunk.start + s, chunk.east + x); return new THREE.Vector3(p.u - chunk.east, 24.12, chunk.start - p.s); };
      const center = local([56, 56]);
      const overview = new THREE.OrthographicCamera(-75, 75, 50, -50, 1, 800);
      overview.position.copy(center).add(new THREE.Vector3(70, 190, 90)); overview.lookAt(center);
      renderer.render(scene, overview);
      const png = renderer.domElement.toDataURL('image/png');
      const walk = chunk.features.courtyard.walks[0];
      const a = local(walk.points[0]), b = local(walk.points.at(-1));
      const view = new THREE.PerspectiveCamera(64, 1.5, .1, 800);
      const direction = b.clone().sub(a).normalize();
      view.position.copy(a).addScaledVector(direction, 3); view.position.y += 4.5;
      const target = a.clone().lerp(b, .65); target.y += 2.3; view.lookAt(target);
      renderer.render(scene, view);
      result.push({ layout, ix, iz, groups: chunk.features.courtyard.islands.length, png, detail: renderer.domElement.toDataURL('image/png') });
      chunk.dispose();
    }
    return result;
  });
  assert.equal(previews.length, 5);
  for (const { layout, png, detail } of previews) {
    await writeFile(`${output}/${layout}.png`, Buffer.from(png.split(',')[1], 'base64'));
    await writeFile(`${output}/${layout}-detail.png`, Buffer.from(detail.split(',')[1], 'base64'));
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify(previews.map(({ png, detail, ...site }) => site), null, 2));
  console.log(`Rendered all ${previews.length} courtyard layouts at street level and from above; no browser errors. ${output}`);
} finally { await browser.close(); }
