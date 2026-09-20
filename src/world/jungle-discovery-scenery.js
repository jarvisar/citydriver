import * as THREE from 'three';
import { CHUNK_LENGTH, positionAt, roadFrame, randomAt } from './route.js';
import { jungleHeight, jungleRoadHeight, riverHalfWidth } from './jungle-route.js';
import { JungleDiscoveryParts, ropeBridgeMaterial, parrotGeometry, parrotMaterial, rainbowGeometry, rainbowMaterial, landingPathMaterial } from './jungle-discovery-assets.js';
import { buildJungleTemple } from './jungle-temple.js';

const up=new THREE.Vector3(0,1,0),transform=new THREE.Object3D();

function buildLandingPaths(chunk,a,b,site) {
  const surfaces=[chunk.terrain,...['road-shoulders','jungle-road'].map(name=>chunk.group.getObjectByName(name))];
  const vertices=[],coords=[];
  const axis=b.clone().sub(a).setY(0).normalize(),across=axis.clone().cross(up);
  // Continue the near landing up the bank, ending just inside the asphalt.
  for(const [end,direction,length] of [[a,-1,6.5],[b,1,-4.4-site.nearU]]) {
    for(const surface of surfaces) {
      const floor=surface.geometry.attributes.position;
      for(let i=0;i<floor.count;i+=3) {
        const tri=Array.from({length:3},(_,j)=>{
          const x=floor.getX(i+j),y=floor.getY(i+j),z=floor.getZ(i+j),dx=x-end.x,dz=z-end.z;
          return {x,y,z,along:(dx*axis.x+dz*axis.z)*direction,cross:dx*across.x+dz*across.z};
        });
        if(tri.every(p=>p.along<-1.1)||tri.every(p=>p.along>length)||tri.every(p=>p.cross<-1.5)||tri.every(p=>p.cross>1.5)) continue;
        // Follow the actual ground, shoulder and asphalt faces so the dirt
        // remains flush with each surface all the way to its feathered end.
        for(const p of tri) {vertices.push(p.x,p.y+.025,p.z);coords.push(p.along,p.cross,length);}
      }
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geometry.setAttribute('landingCoord',new THREE.Float32BufferAttribute(coords,3));
  geometry.computeVertexNormals();geometry.computeBoundingSphere();
  chunk.addMesh(geometry,landingPathMaterial,'bridge-landing-paths');
}

function buildBridge(chunk,site) {
  const parts=new JungleDiscoveryParts();
  const ground=(s,u)=>{
    const p=positionAt(s,u);
    return new THREE.Vector3(p.x,chunk.sampleGround(p.x,p.z+chunk.start)??jungleHeight(s,u),p.z+chunk.start);
  };
  const a=ground(site.s,site.farU),b=ground(site.s,site.nearU);
  buildLandingPaths(chunk,a,b,site);
  const landings=[a,b].map((p,i)=>({x:p.x,z:p.z-chunk.start,ground:p.y,u:i?site.nearU:site.farU}));
  a.y+=.16;b.y+=.16;
  const widthAxis=b.clone().sub(a).cross(up).normalize(),length=Math.hypot(b.x-a.x,b.z-a.z);
  const sag=Math.max(.15,Math.min(.7,(a.y+b.y)/2-site.level-1.1));
  const deck=t=>a.clone().lerp(b,t).addScaledVector(up,-Math.sin(t*Math.PI)*sag);
  const boards=Math.ceil(length/.7),palette=['#998365','#a18a68','#89795d','#a28e70','#8c8064'];
  const basis=new THREE.Matrix4();
  for(let i=0;i<boards;i++) {
    const t=(i+.5)/boards,p=deck(t),axis=deck(Math.min(1,t+.005)).sub(deck(Math.max(0,t-.005))).normalize();
    const normal=widthAxis.clone().cross(axis).normalize();
    const q=new THREE.Quaternion().setFromRotationMatrix(basis.makeBasis(axis,normal,widthAxis))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),(randomAt(site.index*97+i,2811)-.5)*.045));
    const rotation=new THREE.Euler().setFromQuaternion(q);
    p.addScaledVector(widthAxis,(randomAt(site.index*97+i,2812)-.5)*.11);
    parts.box(p.toArray(),[length/boards-.055,.14,2.2+randomAt(site.index*97+i,2813)*.16],palette[i%palette.length],[rotation.x,rotation.y,rotation.z]);
  }
  const posts=[];
  for(const t of [0,1]) for(const side of [-1,1]) {
    const p=deck(t).addScaledVector(widthAxis,side*1.28);
    const y=chunk.sampleGround(p.x,p.z)??landings[t].ground;
    const root=p.clone().setY(y-.4),top=p.clone().setY(p.y+1.65);
    parts.beam(root,top,.15,'#75674f',6);
    posts.push({x:p.x,z:p.z-chunk.start,bottom:root.y,ground:y,top:top.y});
    // Rope wraps on the four weathered anchor posts.
    for(const h of [1.12,1.32]) {
      const wrap=new THREE.TorusGeometry(.17,.032,4,7);
      parts.add(wrap,[p.x,p.y+h,p.z],'#b0a07b',[Math.PI/2,0,0]);
    }
  }
  const segments=Math.ceil(length/1.4),rope='#aa9b77';
  for(const side of [-1,1]) {
    for(let i=0;i<segments;i++) {
      const t=i/segments,next=(i+1)/segments;
      for(const height of [-.13,.64,1.32]) {
        const p=deck(t).addScaledVector(widthAxis,side*1.18).addScaledVector(up,height);
        const q=deck(next).addScaledVector(widthAxis,side*1.18).addScaledVector(up,height);
        parts.beam(p,q,height<0?.058:.047,rope);
      }
      if(i%2===1) {
        const p=deck(t).addScaledVector(widthAxis,side*1.18);
        parts.beam(p.clone().addScaledVector(up,-.1),p.clone().addScaledVector(up,1.32),.025,'#92876b');
      }
    }
  }
  chunk.addMesh(parts.finish(),ropeBridgeMaterial,'jungle-rope-bridge',true);
  return {landings,posts,minimumDeckClearance:Math.min(...Array.from({length:41},(_,i)=>deck(i/40).y-site.level))};
}

export function buildJungleDiscoveries(chunk,sites) {
  chunk.features.discoveries=[];
  for(const site of sites) {
    if(site.s<chunk.start || site.s>=chunk.start+CHUNK_LENGTH) continue;
    let details={};
    if(site.kind==='temple') details=buildJungleTemple(chunk,site);
    else if(site.kind==='rope-bridge') details=buildBridge(chunk,site);
    else if(site.kind==='rainbow') {
      const radius=site.source==='side-fall'?Math.min(11,site.drop*.85):Math.min(13,riverHalfWidth(site.s)*1.1);
      const p=positionAt(site.s-(site.source==='cascade'?4:0),site.u,site.lower+.4);
      const rainbow=new THREE.Mesh(rainbowGeometry,rainbowMaterial);rainbow.name='waterfall-rainbow';
      rainbow.rotation.y=Math.atan2(-220,260);
      rainbow.position.set(p.x-1.4,p.y,p.z+chunk.start+1.7);rainbow.scale.setScalar(radius);
      rainbow.renderOrder=4;chunk.group.add(rainbow);
      details={radius};
    } else {
      const mesh=new THREE.InstancedMesh(parrotGeometry,parrotMaterial,site.count);mesh.name='jungle-parrots';
      // Small loops over the river keep the flock out of the trees and visible
      // above the lower canopy, without moving instance buffers every frame.
      const height=jungleRoadHeight(site.s)+11;
      for(let i=0;i<site.count;i++) {
        const p=positionAt(site.s+i*2.5,site.u+(i%2?1.6:-1.2),height+i*.75);
        transform.position.set(p.x,p.y,p.z+chunk.start);transform.rotation.set(0,-roadFrame(site.s).angle,0);
        transform.scale.setScalar(.95+randomAt(site.index*7+i,2814)*.18);transform.updateMatrix();mesh.setMatrixAt(i,transform.matrix);
      }
      mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();mesh.boundingSphere.radius+=18;
      chunk.group.add(mesh);details={height};
    }
    chunk.features.discoveries.push({...site,...details});
  }
}
