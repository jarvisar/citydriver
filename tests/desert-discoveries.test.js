import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { desertDiscoveries, DESERT_DISCOVERY_SPACING } from '../src/world/desert-discoveries.js';
import { desertCreekDistance, canyonProfile, insideMesa } from '../src/world/desert-route.js';
import { DesertChunk } from '../src/world/desert.js';
import { packChunk, unpackChunk } from '../src/world/chunk-transfer.js';
import { roadHeight } from '../src/world/route.js';
import { desertPosition } from '../src/world/desert-route.js';

test('desert discoveries are sparse, varied, and stable across reversed chunk queries', () => {
  const sites=desertDiscoveries(-100000,100000);
  assert.deepEqual(desertDiscoveries(-100000,0).concat(desertDiscoveries(0,100000)),sites);
  assert.ok(sites.length>5 && sites.length<44);
  assert.deepEqual([...new Set(sites.map(s=>s.kind))].sort(),['cattle-skull','fuel-stop','windpump']);
  for(let i=1;i<sites.length;i++) assert.ok(sites[i].s-sites[i-1].s>3000,'leave several kilometers between any two discoveries');
  for(const site of [...sites].reverse()) {
    assert.ok(Math.abs(site.s-(site.index+.5)*DESERT_DISCOVERY_SPACING)<1100);
    const start=Math.floor(site.s/128)*128;
    assert.deepEqual(desertDiscoveries(start,start+128),sites.filter(s=>s.s>=start&&s.s<start+128));
    for(const ds of [-site.halfS,0,site.halfS]) for(const du of [-site.halfU,0,site.halfU]) {
      const s=site.s+ds,u=site.u+du;
      assert.ok(Math.abs(u)>=18,'structures stay beyond driving limits');
      assert.ok(Math.abs(u)<=canyonProfile(s,site.side).foot-10);
      assert.ok(desertCreekDistance(s,u)>=6,'structures keep clear of the river');
      assert.ok(!insideMesa(s,u,1.4),'structures cannot overlap a mesa');
    }
  }
});

test('desert discovery meshes and the windpump animation material survive worker transfer', () => {
  const sites=desertDiscoveries(-100000,100000);
  for(const [kind,name] of [['fuel-stop','desert-fuel-stop'],['windpump','desert-windpump-rotor'],['cattle-skull','desert-cattle-skull']]) {
    const site=sites.find(s=>s.kind===kind),original=new DesertChunk(Math.floor(site.s/128));
    const before=original.group.getObjectByName(name),matrices=before.instanceMatrix.array.slice();
    const {data,transfers}=packChunk(original),restored=unpackChunk(structuredClone(data,{transfer:transfers}));
    try {
      const after=restored.group.getObjectByName(name);
      assert.deepEqual(restored.features,original.features);
      assert.equal(after.geometry,before.geometry);assert.equal(after.material,before.material);
      assert.deepEqual(after.instanceMatrix.array,matrices);
      assert.ok(after.geometry.attributes.position.array.byteLength>0);
      assert.equal(restored.features.discoveries.filter(s=>s.index===site.index).length,1);
      if(kind==='cattle-skull') {
        const matrix=new THREE.Matrix4();after.getMatrixAt(0,matrix);
        const front=new THREE.Vector3(0,0,1).transformDirection(matrix),camera=new THREE.Vector3(-220,0,260).normalize();
        assert.ok(front.dot(camera)>.9,'skulls face the camera with only small angular variation');
      }
      if(kind==='windpump') {
        const shader={uniforms:{},vertexShader:'#include <beginnormal_vertex>\n#include <begin_vertex>'};
        after.material.onBeforeCompile(shader);
        assert.ok(shader.uniforms.desertTime);
        assert.match(shader.vertexShader,/transformed.xy = spin/);
      }
    } finally {original.dispose();restored.dispose();}
  }
});

test('fuel stop pavement follows the rendered ground through chunk seams', () => {
  const sites=desertDiscoveries(-100000,100000).filter(s=>s.kind==='fuel-stop').slice(0,4);
  let checked=0;
  for(const site of sites) {
    const index=Math.floor(site.s/128),chunk=new DesertChunk(index),neighbors=[new DesertChunk(index-1),chunk,new DesertChunk(index+1)];
    const scene=new THREE.Scene();for(const c of neighbors){c.group.position.z=-c.start;scene.add(c.group);}scene.updateMatrixWorld(true);
    const floors=neighbors.map(c=>c.group.getObjectByName('desert-floor'));
    const ray=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,-1,0));
    try {
      const apron=chunk.group.getObjectByName('desert-fuel-stop-apron'),positions=apron.geometry.attributes.position;
      for(let i=0;i<positions.count;i+=3) {
        const center=new THREE.Vector3();for(let j=0;j<3;j++)center.add(new THREE.Vector3().fromBufferAttribute(positions,i+j));center.multiplyScalar(1/3);center.z-=chunk.start;
        ray.ray.origin.set(center.x,center.y+30,center.z);
        const hit=ray.intersectObjects(floors,false)[0];assert.ok(hit);
        assert.ok(center.y>hit.point.y+.01,'sand must not cover the pavement');
        assert.ok(Math.abs(center.y-hit.point.y-.08)<.01,`pavement floats ${center.y-hit.point.y}m at ${site.s}, ${site.u}; triangle ${i}; world ${center.x},${center.z}`);checked++;
      }
      for(let s=Math.ceil((site.s-20)/2)*2;s<site.s+20;s+=2) {
        const a=desertPosition(s,site.side*5.52),b=desertPosition(s+2,site.side*5.52);
        const expected=(roadHeight(s)+roadHeight(s+2))/2+.075;
        ray.ray.origin.set((a.x+b.x)/2,expected+30,(a.z+b.z)/2);
        const hit=ray.intersectObject(apron,false)[0];assert.ok(hit,'paved entrance meets the highway without a sandy gap');
        assert.ok(Math.abs(hit.point.y-expected)<.012,'pavement joins the highway at the same height');
      }
    } finally {neighbors.forEach(c=>c.dispose());}
  }
  assert.ok(checked>100);
});
