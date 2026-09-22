import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const output = '.artifacts/roof-review';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], photos = [];
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${process.env.TEST_URL ?? 'http://127.0.0.1:5173'}/?seed=4817`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__citydriver && document.querySelector('#loading.loaded'), null, { timeout: 90000 });
  const sites = await page.evaluate(async () => {
    const a = window.__citydriver; a.beginFree(); a.action('pause'); a.rendering.renderer.setAnimationLoop(null);
    const { cityBlock } = await import('/src/world/city-grid.js');
    const { planBuildings } = await import('/src/world/city-buildings.js');
    const found = new Map();
    for (let radius = 0; radius < 16; radius++) for (let ix = -radius; ix <= radius; ix++) for (let iz = -radius; iz <= radius; iz++) {
      const block = cityBlock(ix, iz);
      if (block.kind === 'blocks') for (const b of planBuildings(block).buildings) {
        if (!found.has(b.roofType)) found.set(b.roofType, { key: b.roofType, ix, iz, roofType: b.roofType });
      }
      if (['clock', 'market', 'garden', 'depot', 'station', 'hotel', 'observatory'].includes(block.landmark) && !found.has(block.landmark)) {
        found.set(block.landmark, { key: block.landmark, ix, iz });
      }
    }
    return [...found.values()];
  });
  assert.equal(sites.length, 15);
  for (const site of sites) for (const angle of [0, 1]) {
    const result = await page.evaluate(async ({ site, angle }) => {
      const THREE = await import('/node_modules/three/build/three.module.js');
      const { CitydriverChunk } = await import('/src/world/citydriver-world.js');
      const { cityLayout } = await import('/src/world/city-layout.js');
      const a = window.__citydriver, chunk = new CitydriverChunk(site.ix, site.iz, a.world.materials);
      const b = site.roofType ? chunk.features.buildings.find(b => b.roofType === site.roofType) : null;
      if (site.roofType && !b) { chunk.dispose(); return null; }
      chunk.group.position.set(chunk.east, 0, -chunk.start); chunk.group.updateMatrix();
      const center = b ? new THREE.Vector3(b.x, 24 + b.height - 1, -b.s) : (() => { const p = cityLayout(chunk.start + 56, chunk.east + 56); return new THREE.Vector3(p.u, 36, -p.s); })();
      const span = b ? Math.max(b.width, b.depth) * .83 : 80;
      const scene = new THREE.Scene(); scene.background = new THREE.Color('#dce2d6'); scene.add(chunk.group);
      const sun = new THREE.DirectionalLight('#fff0d4', 3); sun.position.copy(center).add(new THREE.Vector3(-100, 160, 80)); sun.target.position.copy(center);
      sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.normalBias = .65; sun.shadow.bias = -.0003;
      Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 1, far: 450 }); sun.shadow.camera.updateProjectionMatrix();
      scene.add(sun, sun.target, new THREE.HemisphereLight('#edf3ff', '#6e805d', 1.9));
      const camera = new THREE.OrthographicCamera(-span, span, span / 1.25, -span / 1.25, 1, 900), side = angle ? -1 : 1;
      camera.position.copy(center).add(new THREE.Vector3(120 * side, 115, 140 * side)); camera.lookAt(center);
      const r = a.rendering.renderer; r.setPixelRatio(1); r.setSize(1000, 800); r.shadowMap.needsUpdate = true; r.render(scene, camera);
      const png = r.domElement.toDataURL('image/png'); chunk.dispose(); sun.shadow.map?.dispose();
      return png;
    }, { site, angle });
    assert.ok(result, `The sampled ${site.key} building must fit its parcel`);
    const filename = `${site.key}-${angle}.png`;
    await writeFile(`${output}/${filename}`, Buffer.from(result.split(',')[1], 'base64'));
    photos.push({ ...site, angle, filename });
  }
  assert.deepEqual(errors, []);
  const html = `<!doctype html><title>Roof integration review</title><style>body{margin:0;padding:25px;background:#e5eadd;color:#304a4e;font:15px system-ui}main{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}article{background:#dce2d6;border-radius:10px;overflow:hidden}img{width:100%;display:block}h2{font-size:15px;margin:10px 14px}</style><h1>All roof families · both approaches</h1><main>${photos.map(p => `<article><a href="${p.filename}"><img src="${p.filename}"></a><h2>${p.key} · ${p.angle ? 'Rear' : 'Front'}</h2></article>`).join('')}</main>`;
  await writeFile(`${output}/gallery.html`, html);
  await page.setViewportSize({ width: 1800, height: 1100 });
  await page.goto(pathToFileURL(resolve(`${output}/gallery.html`)).href);
  await page.waitForFunction(() => [...document.images].every(image => image.complete));
  await page.screenshot({ path: `${output}/gallery.png`, fullPage: true });
  await writeFile(`${output}/report.json`, JSON.stringify({ sites, photos: photos.length, errors }, null, 2));
  console.log(`Reviewed ${sites.length} roof families/sites from both sides: ${photos.length} screenshots, no browser errors. ${output}/gallery.html`);
} finally { await browser.close(); }
