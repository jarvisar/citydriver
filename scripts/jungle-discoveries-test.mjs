import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const before = process.argv.includes('--before');
const directory = process.env.TEST_ARTIFACT_DIR || `.artifacts/jungle-discoveries/${before?'before':'after'}`;
await mkdir(directory,{recursive:true});
const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,
  args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const errors=[],records=[];
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
  const url=new URL(process.env.TEST_URL||'http://127.0.0.1:5173');url.searchParams.set('seed',process.env.TEST_WORLD_SEED||'4817');
  await page.goto(url.href);
  await page.waitForFunction(()=>window.__coastline&&document.querySelector('#loading.loaded'),{timeout:120000});
  await page.evaluate(()=>window.__coastline.changeJourney('jungle'));
  await page.waitForFunction(()=>window.__coastline.journey==='jungle'&&!window.__coastline.changingJourney);
  await page.addStyleTag({content:'#app > :not(#scene), #pwa-install-invitation {display:none !important;}'});
  const sites=await page.evaluate(async()=>{
    const {jungleDiscoveries}=await import('/src/world/jungle-discoveries.js');
    const all=jungleDiscoveries(-150000,150000);
    return [...['rainbow','parrots','rope-bridge'].map(kind=>all.filter(s=>s.kind===kind).sort((a,b)=>Math.abs(a.s)-Math.abs(b.s))[0]),
      ...[-1,1].map(side=>all.filter(s=>s.kind==='temple'&&s.side===side).sort((a,b)=>Math.abs(a.s)-Math.abs(b.s))[0])];
  });
  assert.ok(sites.every(Boolean));
  for(const site of [...sites,sites[0]]) {
    const record=await page.evaluate(async site=>{
      const a=window.__coastline;if(!a.paused)await a.action('pause');
      a.vehicle.s=site.s;a.vehicle.reset();a.world.update(site.s);a.vehicle.render(1,a.world.origin);
      while(a.rendering.viewLabel!=='Medium view')a.rendering.toggleView();
      a.rendering.snap();a.rendering.update(a.vehicle.car,10,a.world.origin);a.rendering.resize();a.world.animate(8.5);a.rendering.render();
      const {behind,ahead}=a.graphics.settings.chunks;
      const indices=[...a.world.chunks.keys()];
      const expectedFlocks=indices.filter(index=>((index%3)+3)%3===0).length;
      return {...site,chunks:a.world.chunks.size,resident:behind+ahead+1,expectedFlocks,geometries:a.rendering.renderer.info.memory.geometries,
        features:[...a.world.chunks.values()].flatMap(c=>c.features?.discoveries||[])};
    },site);
    assert.equal(record.chunks,record.resident);
    if(!before) {
      assert.equal(record.features.filter(s=>s.kind===site.kind&&s.index===site.index).length,1);
      assert.equal(record.features.filter(s=>s.kind==='parrots').length,record.expectedFlocks,'parrot flock frequency stays unchanged');
    }
    const label=site.kind==='temple'?`temple-${site.side<0?'left':'right'}`:site.kind;
    await page.screenshot({path:`${directory}/${label}-drive.png`});
    await page.evaluate(async site=>{
      const a=window.__coastline,{junglePosition,jungleRoadHeight,riverLevel}=await import('/src/world/jungle-route.js');
      const p=junglePosition(site.s,site.u),z=p.z+a.world.origin;
      const feature=[...a.world.chunks.values()].flatMap(c=>c.features?.discoveries||[]).find(s=>s.kind===site.kind&&s.index===site.index);
      const y=site.kind==='temple'?feature.base+5:site.kind==='parrots'?jungleRoadHeight(site.s)+10:(site.lower??site.level??riverLevel(site.s))+5;
      const camera=a.rendering.camera,height=site.kind==='rope-bridge'?44:site.kind==='rainbow'?37:36,aspect=innerWidth/innerHeight;
      camera.left=-height*aspect/2;camera.right=height*aspect/2;camera.top=height/2;camera.bottom=-height/2;
      camera.position.set(p.x-(site.side??1)*80,y+75,z+95);camera.lookAt(p.x,y,z);camera.updateProjectionMatrix();a.rendering.render();
    },site);
    await page.screenshot({path:`${directory}/${label}-detail.png`});
    if(!before && site.kind==='parrots') {
      const timing=await page.evaluate(async()=>{
        const a=window.__coastline,mesh=a.rendering.scene.getObjectByName('jungle-parrots');
        const shader={uniforms:{},vertexShader:'#include <beginnormal_vertex>\n#include <begin_vertex>'};mesh.material.onBeforeCompile(shader);
        const before=shader.uniforms.jungleTime.value;a.world.animate(10.5);a.rendering.render();
        return {before,after:shader.uniforms.jungleTime.value,count:mesh.count};
      });
      assert.equal(timing.before,8.5);assert.equal(timing.after,10.5);assert.ok(timing.count>=2&&timing.count<=4);
      await page.screenshot({path:`${directory}/parrots-flight.png`});
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(()=>{
        const mesh=window.__coastline.rendering.scene.getObjectByName('jungle-parrots');
        const shader={uniforms:{},vertexShader:'#include <beginnormal_vertex>\n#include <begin_vertex>'};mesh.material.onBeforeCompile(shader);
        return shader.uniforms.jungleTime.value;
      }),10.5,'paused wildlife clock stays frozen');
    }
    records.push(record);
  }
  assert.ok(records.at(-1).geometries<=records[0].geometries+8);
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{const a=window.__coastline;a.rendering.resize();a.rendering.snap();a.rendering.update(a.vehicle.car,10,a.world.origin);a.rendering.render();});
  await page.screenshot({path:`${directory}/rainbow-mobile.png`});
  await page.evaluate(()=>window.__coastline.changeJourney('coast'));
  await page.waitForFunction(()=>window.__coastline.journey==='coast'&&!window.__coastline.changingJourney);
  for(const name of ['jungle-parrots','jungle-rope-bridge','waterfall-rainbow','jungle-temple','jungle-temple-foundation']) {
    assert.equal(await page.evaluate(name=>!!window.__coastline.rendering.scene.getObjectByName(name),name),false);
  }
  assert.deepEqual(errors,[]);
  await writeFile(`${directory}/report.json`,JSON.stringify({passed:true,records,errors},null,2));
  console.log(JSON.stringify({passed:true,records:records.map(({features,...r})=>r)},null,2));
} finally {await browser.close();}
