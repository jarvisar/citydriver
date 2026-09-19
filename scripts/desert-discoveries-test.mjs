import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const directory=process.env.TEST_ARTIFACT_DIR||'.artifacts/desert-discoveries';
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,
  args:['--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const errors=[],records=[];
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
  const url=new URL(process.env.TEST_URL||'http://127.0.0.1:5173');url.searchParams.set('seed',process.env.TEST_WORLD_SEED||'4817');
  await page.goto(url.href);
  await page.waitForFunction(()=>window.__coastline&&document.querySelector('#loading.loaded'),{timeout:120000});
  await page.evaluate(()=>window.__coastline.changeJourney('desert'));
  await page.waitForFunction(()=>window.__coastline.journey==='desert'&&!window.__coastline.changingJourney);
  await page.addStyleTag({content:'#app > :not(#scene), #pwa-install-invitation {display:none !important;}'});
  const sites=await page.evaluate(async()=>{
    const {desertDiscoveries}=await import('/src/world/desert-discoveries.js');
    const all=desertDiscoveries(-150000,150000);
    return ['fuel-stop','windpump','cattle-skull'].map(kind=>all.filter(s=>s.kind===kind).sort((a,b)=>Math.abs(a.s)-Math.abs(b.s))[0]);
  });
  assert.ok(sites.every(Boolean));
  for(const site of [...sites,sites[0]]) {
    const record=await page.evaluate(async site=>{
      const a=window.__coastline;if(!a.paused)await a.action('pause');
      a.vehicle.s=site.s;a.vehicle.reset();a.world.update(site.s);a.vehicle.render(1,a.world.origin);
      while(a.rendering.viewLabel!=='Medium view')a.rendering.toggleView();
      a.rendering.snap();a.rendering.update(a.vehicle.car,10,a.world.origin);a.rendering.resize();a.world.animate(8.5);a.rendering.render();
      return {...site,chunks:a.world.chunks.size,resident:a.graphics.settings.chunks.behind+a.graphics.settings.chunks.ahead+1,geometries:a.rendering.renderer.info.memory.geometries,
        features:[...a.world.chunks.values()].flatMap(c=>c.features?.discoveries||[])};
    },site);
    assert.equal(record.chunks,record.resident);
    assert.equal(record.features.filter(s=>s.index===site.index).length,1);
    await page.screenshot({path:`${directory}/${site.kind}-drive.png`});
    await page.evaluate(async site=>{
      const a=window.__coastline,{desertPosition}=await import('/src/world/desert-route.js');
      const p=desertPosition(site.s,site.u),z=p.z+a.world.origin,y=p.y+(site.kind==='windpump'?4:1.5);
      const camera=a.rendering.camera,height=site.kind==='windpump'?36:site.kind==='cattle-skull'?9:31,aspect=innerWidth/innerHeight;
      camera.left=-height*aspect/2;camera.right=height*aspect/2;camera.top=height/2;camera.bottom=-height/2;
      camera.position.set(p.x-80,y+75,z+95);camera.lookAt(p.x,y,z);camera.updateProjectionMatrix();a.rendering.render();
    },site);
    await page.screenshot({path:`${directory}/${site.kind}-detail.png`});
    if(site.kind==='windpump') {
      const animation=await page.evaluate(()=>{
        const a=window.__coastline,rotor=a.rendering.scene.getObjectByName('desert-windpump-rotor');
        const shader={uniforms:{},vertexShader:'#include <beginnormal_vertex>\n#include <begin_vertex>'};rotor.material.onBeforeCompile(shader);
        const before=shader.uniforms.desertTime.value;a.world.animate(10.5);a.rendering.render();
        return {before,after:shader.uniforms.desertTime.value};
      });
      assert.equal(animation.before,8.5);assert.equal(animation.after,10.5);
      await page.screenshot({path:`${directory}/windpump-turned.png`});
    }
    records.push(record);
  }
  assert.ok(records.at(-1).geometries<=records[0].geometries+8);
  await page.evaluate(()=>window.__coastline.changeJourney('coast'));
  await page.waitForFunction(()=>window.__coastline.journey==='coast'&&!window.__coastline.changingJourney);
  assert.equal(await page.evaluate(()=>!!window.__coastline.rendering.scene.getObjectByName('desert-fuel-stop')),false);
  assert.deepEqual(errors,[]);
  await writeFile(`${directory}/report.json`,JSON.stringify({passed:true,records,errors},null,2));
  console.log(JSON.stringify({passed:true,records:records.map(({features,...r})=>r)},null,2));
} finally {await browser.close();}
