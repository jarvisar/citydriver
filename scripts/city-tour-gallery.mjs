import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = '.artifacts/city-tour';
const report = JSON.parse(await readFile(`${root}/after/report.json`, 'utf8'));
const cards = report.shots.filter(s => s.isolated).map(s => `<article><a href="after/${s.key}.png"><img loading="lazy" src="after/${s.key}.png" alt="${s.title}"></a><h3>${s.title}</h3></article>`).join('');
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Citydriver · The city, rediscovered</title>
<style>*{box-sizing:border-box}body{margin:0;background:#142b32;color:#eceddd;font:16px/1.6 system-ui,sans-serif}main{max-width:1320px;margin:auto;padding:54px 32px}header{max-width:820px}small{font-size:11px;letter-spacing:3px;color:#a7cbbb;text-transform:uppercase}h1{font:normal clamp(36px,5vw,64px)/1.07 Georgia,serif;margin:20px 0}p{color:#b9cec6}h2{font:normal 32px Georgia,serif;margin:46px 0 18px}.stats{display:flex;gap:36px;margin:32px 0}.stats b{display:block;font:32px Georgia,serif;color:#eec998}.stats span{font-size:12px;color:#b9cec6}.toolbar{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}select{font:inherit;background:#29454b;color:#eceddd;border:1px solid #5a726e;border-radius:8px;padding:9px}.comparison{position:relative;aspect-ratio:1.44;overflow:hidden;border-radius:14px;background:#cfd6c7}.comparison img{width:100%;height:100%;object-fit:cover;position:absolute;inset:0}.comparison .before{clip-path:inset(0 50% 0 0)}.line{position:absolute;top:0;bottom:0;left:50%;border-left:2px solid white;pointer-events:none}.label{position:absolute;top:18px;padding:5px 12px;border-radius:30px;background:#142b32da;font-size:12px}.label.old{left:18px}.label.new{right:18px}.slider{display:flex;align-items:center;gap:18px;margin:16px 0;font-size:12px;color:#b9cec6}input{width:100%;accent-color:#eec998}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.grid article{background:#213d43;border:1px solid #3a5558;border-radius:12px;overflow:hidden}.grid img{width:100%;display:block}.grid h3{font-size:14px;font-weight:500;margin:13px 16px 16px}footer{margin-top:40px;border-top:1px solid #3a5558;padding-top:20px;font-size:12px;color:#a0bbb2}@media(max-width:700px){main{padding:28px 18px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.stats{gap:24px}.stats b{font-size:26px}}</style>
<main><header><small>Citydriver / City improvements</small><h1>The city, rediscovered.</h1><p>New places to take a fare. Streets with more character. A skyline of copper crowns, glass lanterns, factory lofts and colorful townhouses.</p></header>
<div class="stats"><div><b>5 → 17</b><span>Discovery categories</span></div><div><b>6 → 10</b><span>Building styles</span></div><div><b>53</b><span>Public-space designs</span></div></div>
<div class="toolbar"><h2>Before &amp; after</h2><label>View <select id="view"><option value="neighborhood">Starting neighborhood</option><option value="waterfront">Waterfront</option><option value="midtown">Midtown</option><option value="street">Street level</option><option value="gameplay">In game</option></select></label></div>
<div class="comparison"><img id="after" src="after/neighborhood.png" alt="Improved city"><img id="before" class="before" src="before/neighborhood.png" alt="Original city"><div class="line" id="line"></div><span class="label old">Before</span><span class="label new">After</span></div>
<label class="slider">Compare<input id="slider" aria-label="Before and after comparison" type="range" min="0" max="100" value="50"></label><p>Drag to compare. City seed 4817; matching camera positions and daylight for the four city studies. Select any image below to open it at full resolution.</p>
<h2>A few reasons to take the long way home.</h2><div class="grid">${cards}</div><footer>Captured from the running game. New places participate in passenger trips, map routing and saved discoveries. Detailed geometry retains clear travel lanes and stable distant silhouettes.</footer></main>
<script>const range=document.getElementById('slider'),before=document.getElementById('before'),after=document.getElementById('after'),line=document.getElementById('line');range.oninput=()=>{before.style.clipPath='inset(0 '+(100-range.value)+'% 0 0)';line.style.left=range.value+'%'};document.getElementById('view').onchange=e=>{before.src='before/'+e.target.value+'.png';after.src='after/'+e.target.value+'.png'};</script></html>`;
await writeFile(`${root}/gallery.html`, html);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(resolve(`${root}/gallery.html`)).href);
  await page.locator('img').evaluateAll(images => images.forEach(image => image.loading = 'eager'));
  await page.waitForFunction(() => [...document.images].every(image => image.complete));
  await page.screenshot({ path: `${root}/gallery.png`, fullPage: true });
  console.log(`Gallery: ${root}/gallery.html`);
} finally { await browser.close(); }
