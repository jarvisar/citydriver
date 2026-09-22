import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({ server: { port: 0, host: '127.0.0.1' } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH }
      : process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}),
    args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(60000);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?seed=4817`);
  await page.waitForFunction(() => document.querySelector('#loading.loaded') && document.querySelector('#error').hidden);
  await page.locator('#loading').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  await page.locator('#start').waitFor({ state: 'visible' });
  await page.evaluate(() => document.fonts.ready);
  await mkdir(new URL('../screenshots-showcase/', import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL('../screenshots-showcase/main-menu.png', import.meta.url)) });
  console.log('Updated screenshots-showcase/main-menu.png');
} finally {
  await browser?.close();
  await server.close();
}
