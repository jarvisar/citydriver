import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const output = '.artifacts/signs';
await mkdir(output, { recursive: true });
const server = await createServer({ server: { port: 0, host: '127.0.0.1' } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH }
      : process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}),
    args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  // A minimal same-origin page tests the real shader without running gameplay.
  await page.route('**/sign-review*', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0"></body>' }));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/sign-review?seed=4817`);
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { SIGN_CATALOG, createSignMaterial } = await import('/src/world/city-signs.js');
    const { CitydriverWorld, CitydriverChunk } = await import('/src/world/citydriver-world.js');
    const { cityBlock } = await import('/src/world/city-grid.js');
    const { publicSpacePlan } = await import('/src/world/city-public-space-kit.js');
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1280, 900); document.body.append(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#a4adb0');
    const material = createSignMaterial(), plane = new THREE.PlaneGeometry(1, 1);
    const selection = [0, 4, 15, 22, 28, 35, 40, 48, 57, 65, 74, 82, 91, 99, 110, 119, 135, 136, 137, 138, 156, 162, 175, 185];
    const mesh = new THREE.InstancedMesh(plane, material, selection.length);
    const transform = new THREE.Object3D(), color = new THREE.Color();
    selection.forEach((tile, i) => {
      const sign = SIGN_CATALOG[tile];
      transform.position.set((i % 4 - 1.5) * 8, (2.5 - Math.floor(i / 4)) * 4.5, 0);
      transform.scale.set(7, 7 / sign.aspect, 1); transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix); mesh.setColorAt(i, color.setRGB(tile, 0, 0));
    });
    scene.add(mesh);
    const camera = new THREE.OrthographicCamera(-17, 17, 14, -14, .1, 100); camera.position.z = 20;
    renderer.render(scene, camera);
    const report = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures,
      gallery: renderer.domElement.toDataURL('image/png') };
    const world = new CitydriverWorld(new THREE.Scene());
    const captures = [];
    const sites = new Map();
    for (let ix = -25; ix <= 25 && sites.size < 5; ix++) for (let iz = -25; iz <= 25 && sites.size < 5; iz++) {
      const plan = cityBlock(ix, iz);
      const key = plan.landmark === 'cinema' ? `cinema-${publicSpacePlan(plan).variant}` : plan.landmark ? 'discovery' : plan.kind === 'blocks' ? 'storefront' : null;
      if (!key || sites.has(key)) continue;
      if (key === 'storefront') {
        const probe = new CitydriverChunk(ix, iz, world.materials);
        const hasSigns = probe.group.children.some(mesh => mesh.material === world.materials.signs);
        probe.dispose(); if (!hasSigns) continue;
      }
      sites.set(key, { ix, iz });
    }
    for (const [name, { ix, iz }] of sites) {
      const cinema = name.startsWith('cinema-'), wantDiscovery = name === 'discovery';
      const chunk = new CitydriverChunk(ix, iz, world.materials);
      const signs = chunk.group.children.find(mesh => cinema ? mesh.name.includes('venue-RIVOLI TOWER-') : mesh.material === world.materials.signs);
      if (!signs) { chunk.dispose(); continue; }
      // Isolate the facade for placement review; street trees can block the
      // inspection camera without intersecting any architectural details.
      for (const mesh of chunk.group.children) if (/tree-|lamp|residents/.test(mesh.name)) mesh.visible = false;
      const view = new THREE.Scene(); view.background = new THREE.Color('#c6d2d0'); view.add(chunk.group);
      view.add(new THREE.HemisphereLight('#fff3df', '#899d90', 2));
      const sun = new THREE.DirectionalLight('#fff3d5', 2); sun.position.set(20, 90, 50); view.add(sun);
      const matrix = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), scale = new THREE.Vector3();
      signs.getMatrixAt(0, matrix); matrix.decompose(p, q, scale);
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      const eye = p.clone().addScaledVector(normal, cinema ? 48 : wantDiscovery ? 12 : 11);
      eye.y = p.y + 1.2;
      const camera = new THREE.PerspectiveCamera(50, 1280 / 900, .1, 300);
      camera.position.copy(eye); camera.lookAt(p); renderer.render(view, camera);
      captures.push({ name, image: renderer.domElement.toDataURL('image/png') });
      chunk.dispose();
    }
    world.dispose(); mesh.dispose(); plane.dispose(); material.map.dispose(); material.dispose(); renderer.dispose();
    return { ...report, captures };
  });
  assert.deepEqual(errors, []);
  assert.equal(result.calls, 1); assert.equal(result.triangles, 48); assert.equal(result.textures, 1);
  assert.equal(result.captures.length, 5, `Captured: ${result.captures.map(capture => capture.name).join(', ')}`);
  for (const { name, image } of [{ name: 'gallery', image: result.gallery }, ...result.captures]) {
    await writeFile(`${output}/${name}.png`, Buffer.from(image.split(',')[1], 'base64'));
  }
  console.log(JSON.stringify({ calls: result.calls, triangles: result.triangles, textures: result.textures, errors, output }));
} finally {
  await browser?.close(); await server.close();
}
