import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// Shimmer as the player sees it: the finished canvas, sampled at fixed world
// points while the camera drives past. The scene is built to the game's scale,
// where a metre is a handful of pixels and a post is thinner than an AO texel.
// AO_MODULE measures another implementation on the same terms.
const DISPLAYS = [
  { name: 'desktop', width: 1920, height: 1080, ratio: 1 },
  { name: 'phone', width: 390, height: 844, ratio: 3 },
];

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  await page.goto(`${process.env.TEST_URL || 'http://127.0.0.1:5173'}/?ao=0`);
  await page.waitForFunction(() => window.__coastline);
  await page.evaluate(() => window.__coastline.action('pause'));
  const results = await page.evaluate(async ([displays, MODULE]) => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { AmbientOcclusion, AO_QUALITY } = await import(MODULE);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    const scene = new THREE.Scene(); scene.background = new THREE.Color('white'); scene.fog = new THREE.Fog('white', 2000, 4000);
    // Unlit white, so a canvas pixel is exactly the AO shade.
    const material = new THREE.MeshBasicMaterial({ color: 'white' });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), material); ground.rotation.x = -Math.PI / 2; scene.add(ground);
    const points = [];
    const place = (width, height, x, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, width), material);
      mesh.position.set(x, height / 2, z); scene.add(mesh);
      // Ground beside each base, inside the contact shadow, on the two sides that
      // face the camera: the far sides are hidden behind the object itself, and
      // sampling across its silhouette measures sharpness rather than flicker.
      for (const reach of [.4, .8, 1.2, 1.6]) for (const [dx, dz] of [[-1, 0], [0, 1]]) {
        const point = new THREE.Vector3(x + dx * (width / 2 + reach), .01, z + dz * (width / 2 + reach));
        point.group = width < 1 ? 'post' : 'box'; points.push(point);
      }
    };
    for (let i = -3; i <= 3; i++) { place(8, 10 + i, i * 22, -18); place(.4, 3, i * 7 + 1.3, 6); place(.4, 3, i * 7 - 2.1, 14); }
    const gl = renderer.getContext(), results = [];
    for (const display of displays) {
      renderer.setPixelRatio(display.ratio); renderer.setSize(display.width, display.height);
      const width = display.width * display.ratio, height = display.height * display.ratio, aspect = width / height;
      // The medium view: 165 metres of world down the screen.
      const camera = new THREE.OrthographicCamera(-82.5 * aspect, 82.5 * aspect, 82.5, -82.5, 1, 1200);
      const pixels = new Uint8Array(width * height * 4);
      const ao = new AmbientOcclusion(renderer, scene, camera);
      const measure = (name, configure) => {
        configure();
        const frames = [];
        for (let frame = 0; frame < 24; frame++) {
          // About twenty metres a second at sixty frames a second.
          camera.position.set(-220 + frame * .23, 245, 260 - frame * .19); camera.lookAt(frame * .23, 0, -frame * .19); camera.updateMatrixWorld();
          ao.enabled = true; ao.render(camera);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          frames.push(points.map(point => {
            const p = point.clone().project(camera), x = (p.x * .5 + .5) * width - .5, y = (p.y * .5 + .5) * height - .5;
            const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
            const sample = (dx, dy) => pixels[((iy + dy) * width + ix + dx) * 4] / 255;
            return (1 - fy) * ((1 - fx) * sample(0, 0) + fx * sample(1, 0)) + fy * ((1 - fx) * sample(0, 1) + fx * sample(1, 1));
          }));
        }
        let change = 0, worst = 0, darkness = 0; const groups = { post: [0, 0], box: [0, 0] };
        for (let f = 1; f < frames.length; f++) for (let p = 0; p < points.length; p++) {
          const delta = Math.abs(frames[f][p] - frames[f - 1][p]);
          groups[points[p].group][0] += delta; groups[points[p].group][1]++;
          change += delta; worst = Math.max(worst, delta); darkness += 1 - frames[f][p];
        }
        const count = (frames.length - 1) * points.length, target = ao.pass.writeTargetInternal;
        results.push({ post: groups.post[0] / groups.post[1], box: groups.box[0] / groups.box[1], display: display.name, name, shimmer: change / count, worst, darkness: darkness / count, aoSize: [target.width, target.height] });
      };
      for (const quality of Object.keys(AO_QUALITY)) measure(quality, () => ao.setQuality(quality));
      ao.dispose();
    }
    scene.traverse(object => object.geometry?.dispose()); material.dispose(); renderer.dispose();
    return results;
  }, [DISPLAYS, process.env.AO_MODULE || '/src/ambient-occlusion.js']);
  console.table(results.map(result => ({ ...result, post: +result.post.toFixed(5), box: +result.box.toFixed(5), shimmer: +result.shimmer.toFixed(5), worst: +result.worst.toFixed(3), darkness: +result.darkness.toFixed(4), aoSize: result.aoSize.join('×') })));
  await mkdir('.artifacts/ambient-occlusion', { recursive: true });
  await writeFile('.artifacts/ambient-occlusion/motion.json', JSON.stringify(results, null, 2));
  for (const result of results) {
    const label = `${result.display} · ${result.name}`;
    assert.ok(result.darkness > .01, `${label}: contact shading stays visible`);
    // The 384-pixel, single-denoise budget this replaced read 0.0050 and 0.0042.
    assert.ok(result.shimmer < .0035, `${label}: shading at a fixed world point changes under 0.35% a frame`);
  }
} finally { await browser.close(); }
