import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

await mkdir('.artifacts', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Exercise Three's actual WebXRManager and stereo renderer with an in-page
  // XR device. This cannot measure headset latency, comfort or hardware speed.
  await page.addInitScript(() => {
    localStorage.setItem('coastline-install-dismissed-v2', String(Date.now()));
    localStorage.setItem('coastline.graphics', JSON.stringify({ mode: 'smooth' }));
    const matrix = (x, y, z, yaw = 0) => {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, x, y, z, 1]);
    };
    const input = handedness => ({ handedness, targetRayMode: 'tracked-pointer', gamepad: { mapping: 'xr-standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 7 }, () => ({ value: 0, pressed: false })) } });
    class Session extends EventTarget {
      constructor() {
        super(); this.inputSources = [input('left'), input('right')];
        this.visibilityState = 'visible'; this.environmentBlendMode = 'opaque';
        this.renderState = { depthNear: .1, depthFar: 1200 };
        this.head = { x: 0, y: 0, z: 0, yaw: 0 }; this.frames = 0;
      }
      updateRenderState(state) { Object.assign(this.renderState, state); }
      async requestReferenceSpace(type) { if (type !== 'local') throw new Error('Expected local space'); return new EventTarget(); }
      requestAnimationFrame(callback) {
        return window.requestAnimationFrame(time => {
          if (this.ended) return;
          this.frames++;
          const frame = { session: this, getViewerPose: () => {
            const { x, y, z, yaw } = this.head, near = this.renderState.depthNear, far = this.renderState.depthFar;
            const projection = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -(far + near) / (far - near), -1, 0, 0, -2 * far * near / (far - near), 0]);
            return { transform: { position: { x, y, z }, orientation: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) } }, views: [-.032, .032].map((eye, index) => ({ eye: index ? 'right' : 'left', transform: { matrix: matrix(x + eye * Math.cos(yaw), y, z - eye * Math.sin(yaw), yaw) }, projectionMatrix: projection })) };
          } };
          callback(time, frame);
        });
      }
      cancelAnimationFrame(id) { window.cancelAnimationFrame(id); }
      async end() { this.ended = true; this.dispatchEvent(new Event('end')); }
    }
    Object.defineProperty(window, 'XRWebGLBinding', { configurable: true, value: undefined });
    Object.defineProperty(window, 'XRWebGLLayer', { configurable: true, value: class {
      constructor() { this.framebufferWidth = 1024; this.framebufferHeight = 512; this.framebuffer = null; this.fixedFoveation = 0; }
      getViewport(view) { return { x: view.eye === 'left' ? 0 : 512, y: 0, width: 512, height: 512 }; }
    } });
    WebGL2RenderingContext.prototype.makeXRCompatible = async () => {};
    Object.defineProperty(navigator, 'xr', { configurable: true, value: {
      async isSessionSupported() { return true; },
      async requestSession(mode) {
        if (mode !== 'immersive-vr') throw new Error('Expected immersive VR');
        if (window.denyVR) throw new DOMException('Declined', 'NotAllowedError');
        window.testXR = new Session(); return window.testXR;
      },
    } });
  });
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173');
  await page.waitForFunction(() => window.__coastline && !document.querySelector('#enter-vr').hidden);
  await page.evaluate(() => { window.denyVR = true; });
  await page.locator('#enter-vr').click();
  await page.waitForFunction(() => !document.querySelector('#vr-error').hidden);
  assert.match(await page.locator('#vr-error').textContent(), /declined/);
  assert.equal(await page.evaluate(() => window.__coastline.vr.active), false);
  await page.evaluate(() => { window.denyVR = false; });
  await page.locator('#enter-vr').click();
  await page.waitForFunction(() => window.__coastline.rendering.renderer.xr.isPresenting && window.testXR.frames > 3);
  const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const button = (hand, index, value) => page.evaluate(({ hand, index, value }) => {
    const control = window.testXR.inputSources.find(source => source.handedness === hand).gamepad.buttons[index];
    control.value = value; control.pressed = value > .5;
  }, { hand, index, value });
  const press = async (hand, index) => { await button(hand, index, 1); await frames(); await button(hand, index, 0); await frames(); };
  assert.equal(await page.evaluate(() => window.__coastline.started), true);
  assert.equal(await page.evaluate(() => window.__coastline.paused), false);
  assert.equal(await page.locator('#vr-error').isVisible(), false);
  const stereo = await page.evaluate(() => {
    const { cameras } = window.__coastline.rendering.renderer.xr.getCamera();
    const a = cameras[0].matrixWorld.elements, b = cameras[1].matrixWorld.elements;
    return { count: cameras.length, separation: Math.hypot(a[12] - b[12], a[13] - b[13], a[14] - b[14]) };
  });
  assert.equal(stereo.count, 2); assert.ok(Math.abs(stereo.separation - .064) < 1e-5);
  // Prove the monoscopic compositor is not used in immersive mode.
  await page.evaluate(() => {
    const ao = window.__coastline.rendering.ambientOcclusion;
    window.originalAORender = ao.render.bind(ao);
    ao.render = () => { throw new Error('AO called during XR'); };
    window.dispatchEvent(new Event('blur'));
  });
  assert.equal(await page.evaluate(() => window.__coastline.paused), false, 'DOM blur must not pause an active headset');
  await frames();
  await button('right', 0, .8);
  await page.waitForFunction(() => window.__coastline.input.state.forward > .7);
  await page.evaluate(() => { window.testXR.inputSources[0].gamepad.axes[2] = .6; });
  await page.waitForFunction(() => window.__coastline.vehicle.steer > .2);
  await button('right', 0, 0);
  await page.evaluate(() => { window.testXR.inputSources[0].gamepad.axes[2] = 0; });
  await press('right', 5);
  assert.equal(await page.evaluate(() => window.__coastline.paused), true);
  const before = await page.evaluate(() => ({ s: window.__coastline.vehicle.s, matrix: [...window.__coastline.rendering.vrCamera.camera.matrixWorld.elements], frames: window.__coastline.rendering.renderer.info.render.frame }));
  await page.evaluate(() => { window.testXR.head.x = .25; window.testXR.head.yaw = .3; });
  await frames();
  const after = await page.evaluate(() => ({ s: window.__coastline.vehicle.s, matrix: [...window.__coastline.rendering.vrCamera.camera.matrixWorld.elements], frames: window.__coastline.rendering.renderer.info.render.frame }));
  assert.equal(after.s, before.s); assert.notDeepEqual(after.matrix, before.matrix); assert.ok(after.frames > before.frames);
  const views = new Set();
  for (let i = 0; i < 5; i++) {
    views.add(await page.evaluate(() => window.__coastline.rendering.viewLabel));
    await press('right', 4);
  }
  assert.equal(views.size, 5);
  await press('right', 3);
  const screenshotStyle = await page.addStyleTag({ content: '#app > :not(canvas) { display: none !important; }' });
  await page.screenshot({ path: '.artifacts/vr-stereo.png' });
  await screenshotStyle.evaluate(element => element.remove());
  await press('right', 5);
  assert.equal(await page.evaluate(() => window.__coastline.paused), false);
  await page.evaluate(() => { window.testXR.visibilityState = 'visible-blurred'; window.testXR.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await page.evaluate(() => window.__coastline.paused), true);
  await page.evaluate(() => { window.testXR.visibilityState = 'visible'; window.testXR.dispatchEvent(new Event('visibilitychange')); });
  await frames(); await press('right', 5);
  assert.equal(await page.evaluate(() => window.__coastline.paused), false);
  await press('left', 4);
  await page.waitForFunction(() => !window.__coastline.changingJourney);
  assert.equal(await page.evaluate(() => window.__coastline.vehicle.distance), 0);
  await page.evaluate(() => { window.__coastline.rendering.ambientOcclusion.render = window.originalAORender; });
  await press('left', 5);
  await page.waitForFunction(() => !window.__coastline.vr.active && !window.__coastline.rendering.renderer.xr.isPresenting);
  assert.equal(await page.evaluate(() => window.__coastline.paused), true);
  assert.equal(await page.evaluate(() => window.__coastline.input.xrActive), false);
  await page.locator('#enter-vr').click();
  await page.waitForFunction(() => window.testXR.frames > 3);
  assert.equal(await page.evaluate(() => window.__coastline.vr.active), true);
  await press('left', 5);
  assert.deepEqual(errors, []);
  console.log('VR browser checks passed: stereo, head tracking, driving, cameras, pause, focus, reset, exit, reentry and denied permission.');
} finally { await browser.close(); }
