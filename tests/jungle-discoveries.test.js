import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { jungleDiscoveries, jungleDiscoveryClears, JUNGLE_PARROT_SPACING } from '../src/world/jungle-discoveries.js';
import { riverLips, sideFalls, riverCenter, riverHalfWidth, onRiver, poolAt } from '../src/world/jungle-route.js';
import { JungleChunk, JungleWorld } from '../src/world/jungle.js';
import { packChunk, unpackChunk } from '../src/world/chunk-transfer.js';
import { waterClock } from '../src/world/water.js';

test('jungle landmarks stay separated while parrot flock spacing stays unchanged',()=>{
  const sites=jungleDiscoveries(-100000,100000);
  const landmarks=sites.filter(site=>site.kind!=='parrots'),flocks=sites.filter(site=>site.kind==='parrots');
  assert.ok(landmarks.length>35 && landmarks.length<65, 'roughly one special encounter per 2.5 miles');
  assert.equal(JUNGLE_PARROT_SPACING,384);
  assert.ok(Math.abs(flocks.length-200000/JUNGLE_PARROT_SPACING)<1);
  for(let i=1;i<flocks.length;i++) assert.ok(Math.abs(flocks[i].s-flocks[i-1].s-JUNGLE_PARROT_SPACING)<1e-9);
  assert.deepEqual([...new Set(sites.map(site=>site.kind))].sort(),['parrots','rainbow','rope-bridge','temple']);
  assert.deepEqual(jungleDiscoveries(-100000,0).concat(jungleDiscoveries(0,100000)),sites);
  for(let i=1;i<landmarks.length;i++) assert.ok(landmarks[i].s-landmarks[i-1].s>900,'leave breathing room between landmarks');
  for(const site of [...sites].reverse()) {
    const start=Math.floor(site.s/128)*128;
    assert.deepEqual(jungleDiscoveries(start,start+128),sites.filter(candidate=>candidate.s>=start&&candidate.s<start+128));
    if(site.kind==='rainbow') {
      const falls=site.source==='side-fall'?sideFalls(site.s,site.s+1):riverLips(site.s,site.s+1);
      assert.equal(falls.length,1,'rainbows must belong to an actual waterfall');
      assert.ok(site.drop>4.8);
    } else if(site.kind==='parrots') assert.ok(site.count>=2 && site.count<=4);
    else if(site.kind==='rope-bridge') {
      const pool=poolAt(site.s);
      assert.ok(site.s-pool.start>=25 && pool.end-site.s>=25,'bridges stay clear of waterfall lips');
      assert.equal(sideFalls(site.s-35,site.s+35).length,0);
      assert.ok(site.farU<riverCenter(site.s)-riverHalfWidth(site.s));
      assert.ok(site.nearU>riverCenter(site.s)+riverHalfWidth(site.s));
      assert.ok(site.nearU<-10,'footbridges remain separate from the driving road');
    }
  }
});

test('temples occur on both roadsides with dry clearings and foundations grounded in the rendered terrain',()=>{
  const sites=jungleDiscoveries(-200000,200000).filter(site=>site.kind==='temple');
  assert.deepEqual([...new Set(sites.map(site=>site.side))].sort(),[-1,1]);
  for(const site of sites) {
    assert.ok(Math.abs(site.u)-9>9.6,'temple and steps stay off the road');
    assert.equal(sideFalls(site.s-32,site.s+32).length,0);
    for(const ds of [-9,0,9]) for(const du of [-9,0,9]) {
      assert.equal(onRiver(site.s+ds,site.u+du,4),false);
      assert.equal(jungleDiscoveryClears(site.s+ds,site.u+du,[site]),false);
    }
    assert.equal(jungleDiscoveryClears(site.s+30,site.u,[site],2),true);
  }
  for(const side of [-1,1]) {
    const site=sites.find(site=>site.side===side),chunk=new JungleChunk(Math.floor(site.s/128));
    try {
      const temple=chunk.group.getObjectByName('jungle-temple');
      const feature=chunk.features.discoveries.find(feature=>feature.kind==='temple');
      assert.ok(temple && chunk.group.getObjectByName('jungle-temple-foundation'));
      assert.ok(Number.isFinite(feature.base) && feature.base>feature.bottom);
      const facing=new THREE.Vector3(0,0,1).applyQuaternion(temple.quaternion);
      assert.ok(facing.x*side<0,'entrance faces back toward the road');
      for(const x of [-6.5,0,6.5]) for(const z of [-5.5,0,5.5]) {
        const p=new THREE.Vector3(x,0,z).applyQuaternion(temple.quaternion).add(temple.position);
        const ground=chunk.sampleGround(p.x,p.z);
        assert.ok(ground>feature.bottom && ground<feature.base,'foundation meets solid terrain without a floating corner');
      }
    } finally {chunk.dispose();}
  }
});

test('rope bridges reach both rendered banks with grounded posts and a dry suspended deck',()=>{
  const sites=jungleDiscoveries(-100000,100000).filter(site=>site.kind==='rope-bridge').slice(0,5);
  const ray=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,-1,0));
  for(const site of sites) {
    const chunk=new JungleChunk(Math.floor(site.s/128));chunk.group.updateMatrixWorld(true);
    try {
      const feature=chunk.features.discoveries.find(feature=>feature.kind==='rope-bridge'),bridge=chunk.group.getObjectByName('jungle-rope-bridge');
      assert.ok(bridge && feature.minimumDeckClearance>.8);
      for(const post of feature.posts) {
        ray.ray.origin.set(post.x,post.top+5,post.z+chunk.start);
        const hit=ray.intersectObject(chunk.terrain,false)[0];assert.ok(hit);
        assert.ok(Math.abs(hit.point.y-post.ground)<.001,'post samples the rendered bank');
        assert.ok(post.bottom<hit.point.y && post.top>hit.point.y+1,'post extends into solid ground');
      }
      for(const landing of feature.landings) assert.equal(onRiver(site.s,landing.u,2),false);
      const [a,b]=feature.landings;
      for(let i=2;i<19;i++) {
        // Sample plank centers, avoiding the intentional narrow gaps.
        const length=Math.hypot(b.x-a.x,b.z-a.z),count=Math.ceil(length/.7);
        const t=(Math.floor(i/20*count)+.5)/count;
        ray.ray.origin.set(a.x+(b.x-a.x)*t,Math.max(a.ground,b.ground)+10,a.z+(b.z-a.z)*t+chunk.start);
        const hit=ray.intersectObject(bridge,false)[0];assert.ok(hit,'planks span the river continuously');
        assert.ok(hit.point.y>site.level+.8,'deck remains above the water');
      }
    } finally {chunk.dispose();}
  }
});

test('jungle discovery geometry and simulation-clock animation survive worker transfer',()=>{
  const sites=jungleDiscoveries(-100000,100000);
  for(const [kind,name] of [['rainbow','waterfall-rainbow'],['parrots','jungle-parrots'],['rope-bridge','jungle-rope-bridge'],['temple','jungle-temple']]) {
    const site=sites.find(site=>site.kind===kind),original=new JungleChunk(Math.floor(site.s/128));
    const before=original.group.getObjectByName(name),positions=before.geometry.attributes.position.array.slice();
    const matrices=before.instanceMatrix?.array.slice();
    const {data,transfers}=packChunk(original),restored=unpackChunk(structuredClone(data,{transfer:transfers}));
    try {
      const after=restored.group.getObjectByName(name);
      assert.deepEqual(restored.features,original.features);assert.equal(after.material,before.material);
      assert.deepEqual(after.geometry.attributes.position.array,positions);
      assert.ok([...positions].every(Number.isFinite));
      if(kind==='temple') assert.equal(after.geometry,before.geometry);
      if(kind==='rainbow' || kind==='parrots') {
        assert.equal(after.geometry,before.geometry);
        const shader={uniforms:{},vertexShader:'#include <beginnormal_vertex>\n#include <begin_vertex>',fragmentShader:'#include <color_fragment>'};
        after.material.onBeforeCompile(shader);assert.equal(shader.uniforms.jungleTime,waterClock.time);
        const world=new JungleWorld(new THREE.Scene());world.animate(12.5);assert.equal(shader.uniforms.jungleTime.value,12.5);
        if(kind==='parrots') {
          assert.match(shader.vertexShader,/wingTurn/);assert.match(shader.vertexShader,/orbit/);
          assert.deepEqual(after.instanceMatrix.array,matrices);
          assert.ok(after.boundingSphere.radius>18,'flight remains inside its culling bounds');
        } else assert.equal(after.material.depthWrite,false,'haze does not hide later transparent effects');
      }
    } finally {original.dispose();restored.dispose();}
  }
});
