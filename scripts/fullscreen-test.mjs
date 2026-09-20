import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const script = (await readFile(new URL('../src/pwa-fullscreen.js', import.meta.url), 'utf8')).replace('export function', 'function');
const browser = await chromium.launch(process.env.CHROME_PATH
  ? { executablePath: process.env.CHROME_PATH }
  : process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {});
try {
  const page = await browser.newPage();
  await page.route('https://coastline.test/', route => route.fulfill({ contentType: 'text/html', body: '<button id="drive">Drive</button><button id="fullscreen">Fullscreen</button>' }));
  async function setup(mode, { reject = false, desktop = false } = {}) {
    await page.goto('https://coastline.test/');
    await page.evaluate(({ mode, reject, desktop }) => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = query => query.includes('display-mode:') ? { matches: query === `(display-mode: ${mode})` } : original(query);
      if (desktop) window.coastlineDesktop = {};
      window.requests = 0;
      document.documentElement.requestFullscreen = () => {
        window.requests++;
        return reject ? Promise.reject(new Error('Fullscreen unavailable')) : Promise.resolve();
      };
    }, { mode, reject, desktop });
    await page.addScriptTag({ content: `${script}\nsetupPwaFullscreen();` });
  }
  const requests = () => page.evaluate(() => window.requests);
  for (const mode of ['standalone', 'minimal-ui']) {
    await setup(mode);
    assert.equal(await requests(), 0, 'Fallback waits for user activation');
    await page.keyboard.press('Escape');
    assert.equal(await requests(), 0, 'Escape does not enter fullscreen');
    await page.locator('#drive').click();
    assert.equal(await requests(), 1, `${mode} enters on first tap`);
    await page.keyboard.press('KeyW');
    assert.equal(await requests(), 1, 'Only one startup request per launch');
  }
  await setup('standalone');
  await page.keyboard.press('KeyW');
  assert.equal(await requests(), 1, 'Driving key enters fullscreen');
  for (const mode of ['browser', 'fullscreen']) {
    await setup(mode);
    await page.locator('#drive').click();
    assert.equal(await requests(), 0, `${mode} needs no fallback`);
  }
  await setup('standalone', { desktop: true });
  await page.locator('#drive').click();
  assert.equal(await requests(), 0, 'Electron uses native fullscreen');
  for (const control of ['keyboard', 'button']) {
    await setup('standalone');
    if (control === 'keyboard') await page.keyboard.press('KeyF');
    else await page.locator('#fullscreen').click();
    await page.locator('#drive').click();
    assert.equal(await requests(), 0, 'Explicit fullscreen control cancels startup fallback');
  }
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await setup('standalone', { reject: true });
  await page.locator('#drive').click();
  await page.keyboard.press('KeyW');
  assert.equal(await requests(), 1, 'Rejected requests are not repeated');
  assert.deepEqual(errors, [], 'Unsupported fullscreen is handled quietly');
  console.log('Passed PWA fullscreen startup fallback checks.');
} finally {
  await browser.close();
}
