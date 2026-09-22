import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const url = process.env.TEST_URL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(60000);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem('citydriver.graphics', JSON.stringify({ mode: 'basic' })); });
  const ready = () => page.waitForFunction(() => window.__citydriver && document.querySelector('#loading.loaded'));
  const block = () => page.evaluate(async () => (await import('/src/world/city-grid.js')).cityBlock(0, 0));
  await page.goto(`${url}/?seed=4817&ao=0`);
  await ready();
  const originalBlock = await block();
  await page.evaluate(() => localStorage.setItem('citydriver-weather', 'rain'));
  await page.keyboard.press('KeyR');
  await page.waitForURL(current => current.searchParams.get('seed') !== '4817');
  await ready();
  const newSeed = await page.evaluate(() => window.__citydriver.seed);
  assert.notEqual(newSeed, 4817);
  assert.equal(new URL(page.url()).searchParams.get('ao'), '0');
  assert.notDeepEqual(await block(), originalBlock, 'R must change the city at the same coordinates');
  assert.equal(await page.evaluate(() => window.__citydriver.started), false);
  assert.equal(await page.evaluate(() => window.__citydriver.weather.mode), 'rain');
  assert.equal(await page.locator('#start').isVisible(), true);

  for (const key of ['KeyW', 'ArrowUp', 'Numpad8']) {
    await page.keyboard.down(key);
    await page.waitForFunction(() => window.__citydriver.started && window.__citydriver.vehicle.speed > 1);
    assert.equal(await page.evaluate(() => window.__citydriver.gameMode), 'free');
    assert.equal(await page.evaluate(() => window.__citydriver.taxi.status), 'idle');
    assert.equal(await page.evaluate(() => window.__citydriver.input.state.forward), true);
    await page.keyboard.up(key);
    await page.reload();
    await ready();
  }

  await page.click('#start');
  await page.waitForFunction(() => window.__citydriver.taxi.running);
  assert.equal(await page.evaluate(() => window.__citydriver.gameMode), 'taxi');
  await page.keyboard.press('KeyP');
  const beforeReset = await page.evaluate(() => window.__citydriver.taxi.timeLeft);
  await page.keyboard.press('KeyR');
  assert.equal(await page.evaluate(() => window.__citydriver.taxi.timeLeft), beforeReset - 5);
  assert.equal(await page.evaluate(() => window.__citydriver.seed), newSeed);
  assert.deepEqual(errors, []);
  console.log('Menu checks passed: new city seed and scenery, saved weather, all forward keys enter free drive and accelerate, Start run enters taxi, taxi reset stays unchanged.');
} finally { await browser.close(); }
