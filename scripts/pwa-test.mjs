import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { QUALITY_LEVELS } from '../src/graphics.js';

const SMALLEST_WINDOW = Math.min(...QUALITY_LEVELS.map(level => level.chunks.behind + level.chunks.ahead + 1));
import { build, createServer as createViteServer } from 'vite';

const launchOptions = {
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH }
    : process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}),
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
};
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

async function checkProduction(base) {
  const outDir = path.resolve('.artifacts', base === '/' ? 'pwa-root' : 'pwa-subpath');
  await build({ base, build: { outDir } });
  let update = false;
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (!pathname.startsWith(base)) { res.writeHead(404).end(); return; }
      const relative = pathname.slice(base.length) || 'index.html';
      const filename = path.resolve(outDir, relative);
      if (!filename.startsWith(`${outDir}${path.sep}`)) { res.writeHead(403).end(); return; }
      let content = await readFile(filename);
      if (relative === 'sw.js' && update) {
        content = content.toString().replace(/const VERSION = "[^"]+";/, 'const VERSION = "test-update";');
      }
      res.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(content);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}${base}`;
  const profile = await mkdtemp(path.resolve('.artifacts/pwa-browser-'));
  const context = await chromium.launchPersistentContext(profile, launchOptions);
  await context.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.__chunkWorkerCheck = { seed: null, readySeed: null, chunks: 0, errors: [] };
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', ({ data }) => {
          if (data.type === 'ready') window.__chunkWorkerCheck.readySeed = data.seed;
          if (data.type === 'chunk') window.__chunkWorkerCheck.chunks++;
          if (data.type === 'error') window.__chunkWorkerCheck.errors.push(data.message);
        });
        this.addEventListener('error', event => window.__chunkWorkerCheck.errors.push(event.message));
      }
      postMessage(data, ...rest) {
        if (data.type === 'init') window.__chunkWorkerCheck.seed = data.seed;
        super.postMessage(data, ...rest);
      }
    };
  });
  for (const page of context.pages()) await page.close();
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  try {
    let page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('#loading.loaded') && document.querySelector('#error').hidden);
    // A production build has no debug surface to read the quality level from,
    // so require the smallest window any level keeps built: enough to prove the
    // worker really supplied the route rather than the page falling back to
    // building it itself.
    await page.waitForFunction(count => window.__chunkWorkerCheck.chunks >= count, SMALLEST_WINDOW);
    const worker = await page.evaluate(() => window.__chunkWorkerCheck);
    assert.equal(worker.readySeed, worker.seed, 'production worker must use the page seed before building scenery');
    assert.deepEqual(worker.errors, []);
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    assert.equal(await page.locator('#pwa-install-invitation').count(), 0);
    await page.setViewportSize({ width: 393, height: 851 });
    assert.equal(await page.locator('#welcome :is(.pwa-install, .pwa-install-button, #pwa-install-invitation)').count(), 0, 'The install prompt stays out of the main menu');
    await page.screenshot({ path: path.resolve('.artifacts', base === '/' ? 'pwa-invitation.png' : 'pwa-invitation-subpath.png') });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.setViewportSize({ width: 1280, height: 720 });
    const manifest = await page.evaluate(async () => {
      const link = document.querySelector('link[rel=manifest]');
      return { url: link.href, data: await (await fetch(link.href)).json() };
    });
    assert.equal(manifest.data.display, 'fullscreen');
    assert.equal(new URL(manifest.data.start_url, manifest.url).href, url);
    assert.ok(manifest.data.screenshots.some(screenshot => screenshot.form_factor === 'wide'));
    assert.ok(manifest.data.screenshots.some(screenshot => screenshot.form_factor === 'narrow'));
    for (const icon of [...manifest.data.icons, ...manifest.data.screenshots]) {
      const dimensions = await page.evaluate(async src => {
        const image = new Image(); image.src = src; await image.decode();
        return `${image.naturalWidth}x${image.naturalHeight}`;
      }, new URL(icon.src, manifest.url).href);
      assert.equal(dimensions, icon.sizes);
    }
    assert.equal(await page.locator('link[rel=apple-touch-icon]').count(), 1);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Page.enable');
    const installability = await cdp.send('Page.getInstallabilityErrors');
    assert.deepEqual(installability.installabilityErrors, [], 'Chrome installability requirements');
    await cdp.detach();

    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#loading.loaded') && document.querySelector('#error').hidden);
    // A production build has no debug surface to read the quality level from,
    // so require the smallest window any level keeps built: enough to prove the
    // worker really supplied the route rather than the page falling back to
    // building it itself.
    await page.waitForFunction(count => window.__chunkWorkerCheck.chunks >= count, SMALLEST_WINDOW);
    assert.deepEqual(await page.evaluate(() => window.__chunkWorkerCheck.errors), [], 'worker bundle must be available offline');
    assert.equal(await page.locator('#pwa-install-invitation').isVisible(), false, 'Dismissal survives reload');
    // All journey assets are available even when switching for the first time offline.
    for (const journey of await page.locator('button[data-journey]').evaluateAll(buttons => buttons.map(button => button.dataset.journey))) {
      await page.locator('#change-journey').click();
      await page.locator(`button[data-journey="${journey}"]`).click();
      await page.waitForFunction(id => document.querySelector(`button[data-journey="${id}"]`).getAttribute('aria-current') === 'true' && !document.querySelector('#journey-dialog').open, journey);
      await page.waitForFunction(() => !document.querySelector('#journey-transition').classList.contains('active'));
    }
    await page.goto(`${url}?from=homescreen`);
    await page.waitForFunction(() => document.querySelector('#loading.loaded') && document.querySelector('#error').hidden);
    await page.locator('#start').click();
    await page.keyboard.down('ArrowUp');
    await page.waitForFunction(() => document.querySelector('#distance').textContent !== '0.0', null, { timeout: 20_000 });
    await page.keyboard.up('ArrowUp');

    await context.setOffline(false);
    await page.evaluate(() => caches.open('unrelated-app-cache'));
    const oldCache = await page.evaluate(async () => (await caches.keys()).find(name => name.startsWith('coastline:')));
    update = true;
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting));
    assert.ok((await page.evaluate(() => caches.keys())).includes(oldCache), 'Active version stays cached during play');
    await page.close();
    page = await context.newPage();
    await page.goto(url);
    await page.waitForFunction(async () => {
      const names = await caches.keys();
      return names.some(name => name.endsWith(':test-update')) && names.filter(name => name.startsWith('coastline:')).length === 1;
    });
    assert.ok((await page.evaluate(() => caches.keys())).includes('unrelated-app-cache'));
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#loading.loaded') && document.querySelector('#error').hidden);
    await page.keyboard.press('KeyP');
    await page.locator('#pause-overlay .pwa-install-button').waitFor({ state: 'visible' });
    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      event.prompt = async () => { window.testInstallPromptCalled = true; };
      event.userChoice = Promise.resolve({ outcome: 'dismissed' });
      window.dispatchEvent(event);
      // Trigger the stub in the same task, before Chrome can emit a real prompt event.
      document.querySelector('#pause-overlay .pwa-install-button').click();
    });
    assert.equal(await page.evaluate(() => window.testInstallPromptCalled), true);
    // Chrome can emit another native prompt after the stub finishes. Exercise
    // fallback deterministically instead of depending on that event's timing.
    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      event.prompt = async () => { throw new Error('Install prompt unavailable'); };
      event.userChoice = Promise.resolve({ outcome: 'dismissed' });
      window.dispatchEvent(event);
      document.querySelector('#pause-overlay .pwa-install-button').click();
    });
    await page.locator('#pause-overlay .pwa-install-help').waitFor({ state: 'visible' });
    assert.match(await page.locator('#pause-overlay .pwa-install-help').textContent(), /browser menu/);
    await page.setViewportSize({ width: 393, height: 851 });
    await page.screenshot({ path: path.resolve('.artifacts', base === '/' ? 'pwa-mobile-install.png' : 'pwa-mobile-subpath-install.png') });
    await page.locator('#pause-overlay .pwa-install-button').focus();
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#pause-overlay .pwa-install-help').isVisible(), false);
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    assert.equal(await page.locator('#pause-overlay .pwa-install-button').isVisible(), false);
    assert.deepEqual(errors, []);
    console.log(`PASS ${base}: Chrome installability, icons/screenshots, install button/fallback, offline journeys/driving, safe updates and cache cleanup`);
  } finally {
    await context.close();
    await new Promise(resolve => server.close(resolve));
  }
}

if (!process.argv.includes('--dev-only')) {
  await checkProduction('/');
  await checkProduction('/coastline/');
}
const dev = await createViteServer({ server: { port: 0, host: '127.0.0.1' } });
try {
  await dev.listen();
  const html = await (await fetch(`http://127.0.0.1:${dev.httpServer.address().port}/`)).text();
  assert.ok(html.includes('manifest.webmanifest'));
  assert.ok(html.includes('pwa-install.js'), 'Development includes the install setting');
  assert.ok(html.includes('pwa-install.css'), 'Development includes installation styling');
  assert.ok(!html.includes('pwa-register.js'), 'Development never registers an offline worker');
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage({ viewport: { width: 393, height: 851 }, hasTouch: true, isMobile: true });
    const url = `http://127.0.0.1:${dev.httpServer.address().port}/`;
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('#loading.loaded'));
    assert.equal(await page.locator('#pwa-install-invitation').isVisible(), false);
    await page.keyboard.press('KeyP');
    assert.equal(await page.locator('#pause-overlay .pwa-install-button').isVisible(), true);
    await page.screenshot({ path: path.resolve('.artifacts/pwa-dev-install.png') });
    await page.locator('#pause-overlay .pwa-install-button').click();
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#loading.loaded') && document.querySelector('#error').hidden);
    assert.equal(await page.locator('#pwa-install-invitation').isVisible(), false);
    await page.keyboard.press('KeyP');
    assert.equal(await page.locator('#pause-overlay .pwa-install-button').isVisible(), true);
    assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0);
  } finally { await browser.close(); }
  console.log('PASS development: manifest and install UI available, service worker registration disabled');
} finally { await dev.close(); }
