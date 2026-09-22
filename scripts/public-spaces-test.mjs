import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const output = '.artifacts/public-spaces';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 720, height: 620 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${process.env.TEST_URL ?? 'http://127.0.0.1:5173'}/?seed=4817`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__citydriver && document.querySelector('#loading').classList.contains('loaded'), null, { timeout: 60000 });
  await page.click('#free-drive');
  await page.evaluate(() => { if (!window.__citydriver.paused) window.__citydriver.action('pause'); });
  const sites = await page.evaluate(async () => {
    const { cityBlock } = await import('/src/world/city-grid.js');
    const { publicSpacePlan, SPACE_NAMES } = await import('/src/world/city-public-space-kit.js');
    const found = new Map();
    for (let ix = -16; ix <= 16; ix++) for (let iz = -16; iz <= 16; iz++) {
      const b = cityBlock(ix, iz); if (!SPACE_NAMES[b.landmark || b.kind]) continue;
      const plan = publicSpacePlan(b), key = `${plan.type}-${plan.variant}`;
      if (!found.has(key)) found.set(key, { key, ix, iz, ...plan });
    }
    const style = document.createElement('style');
    style.textContent = 'body * { visibility: hidden !important; } #scene { visibility: visible !important; }';
    document.head.append(style);
    window.__citydriver.rendering.renderer.domElement.style.visibility = 'visible';
    return [...found.values()].sort((a, b) => Object.keys(SPACE_NAMES).indexOf(a.type) - Object.keys(SPACE_NAMES).indexOf(b.type) || a.variant - b.variant);
  });
  assert.equal(sites.length, 23);
  const cases = sites.concat([
    { key: 'north-river-join', name: 'North–south river bank', type: 'river', ix: 3, iz: 2, focus: [28, 12.6] },
    { key: 'east-river-join', name: 'East–west river bank', type: 'river', ix: 2, iz: 5, focus: [12.6, 84.4] },
    { key: 'confluence-join', name: 'Confluence corner', type: 'river', ix: 3, iz: 5, focus: [28, 28] },
  ]);
  const report = [];
  for (const site of cases) {
    const counts = await page.evaluate(async ({ ix, iz, type, variant, orientation, focus }) => {
      const THREE = await import('/node_modules/three/build/three.module.js');
      const { CitydriverChunk } = await import('/src/world/citydriver-world.js');
      const { cityLayout } = await import('/src/world/city-layout.js');
      const a = window.__citydriver, renderer = a.rendering.renderer;
      renderer.setPixelRatio(1); renderer.setSize(720, 620);
      const scene = new THREE.Scene(); scene.background = new THREE.Color('#d7d9cd');
      scene.add(new THREE.HemisphereLight('#e4f2f5', '#617149', 1.45));
      const sun = new THREE.DirectionalLight('#fff1db', 2.5); sun.position.set(-95, 150, 65); sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -140, right: 140, top: 140, bottom: -140, near: 1, far: 400 });
      sun.shadow.bias = -.0002; sun.shadow.normalBias = .08; scene.add(sun);
      sun.shadow.camera.updateProjectionMatrix();
      const chunk = new CitydriverChunk(ix, iz, a.world.materials); scene.add(chunk.group);
      const center = cityLayout(chunk.start + 56, chunk.east + 56), x = center.u - chunk.east, z = chunk.start - center.s;
      sun.target.position.set(x, 0, z); scene.add(sun.target);
      sun.position.add(new THREE.Vector3(x, 0, z));
      const camera = new THREE.OrthographicCamera(-82, 82, 70.6, -70.6, 1, 800);
      camera.position.set(x + 135, 185, z + 145); camera.lookAt(x, 24, z);
      renderer.shadowMap.needsUpdate = true;
      renderer.render(scene, camera);
      const result = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        instances: chunk.group.children.reduce((n, m) => n + (m.count ?? 0), 0), png: renderer.domElement.toDataURL('image/png') };
      const locations = {
        park: [[58, 78], [65, 58], [74, 37], [56, 56]], plaza: [[54, 52], [42, 48], [56, 74], [45, 44]],
        clock: [[56, 32], [31, 39], [29, 62]], market: [[33, 50], [56, 50], [50, 50]],
        garden: [[39, 35], [56, 47], [73, 50]], depot: [[56, 61], [56, 60], [72, 69]], art: [[56, 56], [56, 56], [56, 56]],
      };
      let [fx, fs] = focus ?? locations[type][variant];
      if (type === 'park' || type === 'plaza') {
        [fx, fs] = orientation === 1 ? [112 - fs, fx] : orientation === 2 ? [112 - fx, 112 - fs] : orientation === 3 ? [fs, 112 - fx] : [fx, fs];
      }
      const detail = cityLayout(chunk.start + fs, chunk.east + fx), px = detail.u - chunk.east, pz = chunk.start - detail.s;
      Object.assign(camera, { left: -35, right: 35, top: 30.14, bottom: -30.14 }); camera.updateProjectionMatrix();
      camera.position.set(px + 135, 185, pz + 145); camera.lookAt(px, 24, pz);
      renderer.render(scene, camera); result.detailPng = renderer.domElement.toDataURL('image/png');
      // Keep this scene alive until the screenshot is captured.
      window.spacePreview?.chunk.dispose(); window.spacePreview?.sun.shadow.map?.dispose();
      window.spacePreview = { chunk, sun };
      return result;
    }, site);
    const { png, detailPng, ...geometry } = counts;
    assert.ok(geometry.triangles > 500);
    await writeFile(`${output}/${site.key}.png`, Buffer.from(png.split(',')[1], 'base64'));
    await writeFile(`${output}/${site.key}-detail.png`, Buffer.from(detailPng.split(',')[1], 'base64'));
    report.push({ ...site, ...geometry });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const neighborhood = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { cityLayout } = await import('/src/world/city-layout.js');
    const a = window.__citydriver, p = cityLayout(-4.5 * 112, 112);
    a.world.update(p.s, p.u); a.world.scene.fog = null;
    const z = a.world.origin - p.s;
    a.world.scene.traverse(o => {
      if (!o.isDirectionalLight) return;
      o.position.set(p.u - 170, 310, z + 110); o.target.position.set(p.u, 0, z);
      Object.assign(o.shadow.camera, { left: -330, right: 330, top: 330, bottom: -330, near: 1, far: 850 });
      o.shadow.camera.updateProjectionMatrix();
    });
    const camera = new THREE.OrthographicCamera(-235, 235, 163.2, -163.2, 1, 1500);
    camera.position.set(p.u + 245, 355, z + 280); camera.lookAt(p.u, 24, z);
    const r = a.rendering.renderer; r.setPixelRatio(1); r.setSize(1440, 1000); r.shadowMap.needsUpdate = true;
    r.render(a.world.scene, camera);
    let instances = 0, triangles = 0, batches = 0;
    for (const group of [...a.world.chunks.values()].map(c => c.group).concat(a.world.distantGroup)) for (const m of group.children) {
      batches++; instances += m.count; triangles += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3 * m.count;
    }
    return { instances, triangles, batches, distantBatches: a.world.distantGroup.children.length, png: r.domElement.toDataURL('image/png') };
  });
  await writeFile(`${output}/neighborhood.png`, Buffer.from(neighborhood.png.split(',')[1], 'base64'));
  delete neighborhood.png;
  const tiles = [];
  for (const site of sites) {
    const data = (await readFile(`${output}/${site.key}.png`)).toString('base64');
    tiles.push(`<article><img src="data:image/png;base64,${data}"><h2>${site.name}</h2><p>${site.type} · ${site.ix}, ${site.iz}</p></article>`);
  }
  const html = `<!doctype html><title>City public spaces</title><style>body{margin:0;padding:30px;background:#edf0e6;color:#30484b;font:16px system-ui}h1{margin:0 0 24px;font-size:32px}main{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}article{background:#d7d9cd;border-radius:10px;overflow:hidden}img{width:100%;display:block}h2{margin:0 18px;font-size:20px}p{margin:5px 18px 16px;color:#58716e}</style><h1>City gardens, squares & discoveries</h1><main>${tiles.join('')}</main>`;
  await writeFile(`${output}/gallery.html`, html);
  const gallery = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await gallery.setContent(html); await gallery.screenshot({ path: `${output}/gallery.png`, fullPage: true });
  const details = [];
  for (const site of cases) {
    const data = (await readFile(`${output}/${site.key}-detail.png`)).toString('base64');
    details.push(`<article><img src="data:image/png;base64,${data}"><h2>${site.name}</h2><p>Connections & clearance</p></article>`);
  }
  const detailHtml = html.replace(/<h1>.*<\/h1><main>[\s\S]*<\/main>/, `<h1>Connections, planting & seams</h1><main>${details.join('')}</main>`);
  await writeFile(`${output}/details.html`, detailHtml);
  await gallery.setContent(detailHtml); await gallery.screenshot({ path: `${output}/details.png`, fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ sites: report, neighborhood, errors }, null, 2));
  console.log(`Rendered ${sites.length} designs and 3 river joins, with close-ups; no browser errors. Galleries: ${output}/gallery.png and details.png`);
} finally { await browser.close(); }
