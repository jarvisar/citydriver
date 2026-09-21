import * as THREE from 'three';
import { CHUNK_LENGTH, roadFrame, roadHeight, randomAt, smoothstep } from './route.js';
import { DESERT_COLUMNS, DESERT_STEP, DESERT_VALLEY_EDGE, desertRowStep, desertPosition } from './desert-route.js';
import { desertFuelApronWidth, DESERT_FUEL_APRON_HALF_LENGTH } from './desert-discoveries.js';
import { solidModel } from './colliders.js';
import { desertDiscoveryAssets as assets, desertDiscoveryMaterial as material, desertFoundationMaterial, desertApronMaterial, desertRotorMaterial } from './desert-discovery-assets.js';

const transform = new THREE.Object3D();

export function buildDesertDiscoveries(chunk, discoveries) {
  chunk.features = {...chunk.features, discoveries: []};
  const batches = new Map();
  const point = (s, u, height) => {
    const p = chunk.groundPosition(s, u);
    return [p.x, height ?? p.y, p.z + chunk.start];
  };
  function add(name, geometry, paint, p, rotation = [0,0,0], scale = [1,1,1]) {
    if (!batches.has(name)) batches.set(name, {geometry, paint, items: []});
    batches.get(name).items.push({p, rotation, scale});
  }
  // A building or a fixture: drawn like the rest, and it stops the car.
  function solid(name, geometry, p, rotation) {
    add(name, geometry, material, p, rotation);
    solidModel(chunk, geometry, p, rotation[1]);
  }
  function foundation(s, u, halfU, halfS, angle) {
    const samples = [-halfS, 0, halfS].flatMap(ds => [-halfU, 0, halfU].map(du => chunk.groundPosition(s + ds, u + du).y));
    const low = Math.min(...samples) - .35, high = Math.max(...samples) + .06;
    add('desert-discovery-footings', assets.box, desertFoundationMaterial, point(s,u,(low+high)/2), [0,angle,0], [halfU*2,high-low,halfS*2]);
    return high;
  }
  function apron(site) {
    const vertices = [];
    // Clip the existing terrain faces to the paved footprint. Sampling a new
    // grid bridges ground creases and leaves small floating or buried patches.
    const first=Math.floor((site.s-DESERT_FUEL_APRON_HALF_LENGTH)/2)*2;
    const last=Math.ceil((site.s+DESERT_FUEL_APRON_HALF_LENGTH)/2)*2;
    function clip(polygon, distance) {
      const result = [];
      for (let i=0;i<polygon.length;i++) {
        const a=polygon[i],b=polygon[(i+1)%polygon.length];
        const da=distance(a),db=distance(b),insideA=da>=0,insideB=db>=0;
        if (insideA) result.push(a);
        if (insideA!==insideB) {
          const t=da/(da-db),p={};
          for (const key of ['s','u','x','y','z']) p[key]=a[key]+(b[key]-a[key])*t;
          result.push(p);
        }
      }
      return result;
    }
    for (let col=0;col<DESERT_COLUMNS.length-1;col++) {
      const step=r=>Math.abs(DESERT_COLUMNS[col])<=DESERT_VALLEY_EDGE && Math.abs(DESERT_COLUMNS[col+1])<=DESERT_VALLEY_EDGE ? desertRowStep(r) : 1;
      for (let row=Math.floor(first/DESERT_STEP)-1;row<=Math.ceil(last/DESERT_STEP)+1;row+=step(row)) {
        const next=row+step(row),a=chunk.vertex(row,col),b=chunk.vertex(next,col),c=chunk.vertex(row,col+1),d=chunk.vertex(next,col+1);
        const triangles=(row+col)%2 ? [[a,b,c],[b,d,c]] : [[a,b,d],[a,d,c]];
        for (const tri of triangles) {
          if (tri.every(p=>p.u*site.side<5.5) || tri.every(p=>p.u*site.side>Math.abs(site.u)-4.5)) continue;
          for (let s=Math.max(first,Math.floor(Math.min(...tri.map(p=>p.s))/2)*2);s<Math.min(last,Math.max(...tri.map(p=>p.s)));s+=2) {
            const low=desertFuelApronWidth(site,s),high=desertFuelApronWidth(site,s+2);
            if (Math.max(low,high)<=5.5001) continue;
            let polygon=clip(tri,p=>p.s-s);
            polygon=clip(polygon,p=>s+2-p.s);
            polygon=clip(polygon,p=>p.u*site.side-5.5);
            polygon=clip(polygon,p=>low+(high-low)*(p.s-s)/2-p.u*site.side);
            for (let i=1;i<polygon.length-1;i++) {
              for (const p of [polygon[0],polygon[i],polygon[i+1]]) {
                // Match the highway's two-meter segments exactly at its edge,
                // easing back onto the untouched terrain by the outer shoulder.
                const blend=1-smoothstep(5.5,7,Math.abs(p.u));
                const a=desertPosition(s,p.u,roadHeight(s)+.075),b=desertPosition(s+2,p.u,roadHeight(s+2)+.075),t=(p.s-s)/2;
                vertices.push(p.x+(a.x+(b.x-a.x)*t-p.x)*blend,
                  p.y+.08+(a.y+(b.y-a.y)*t-p.y-.08)*blend,
                  p.z+chunk.start+(a.z+(b.z-a.z)*t-p.z)*blend);
              }
            }
          }
        }
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vertices,3));
    g.computeVertexNormals(); g.computeBoundingSphere(); chunk.addMesh(g,desertApronMaterial).name = 'desert-fuel-stop-apron';
  }
  for (const site of discoveries) {
    if (site.s < chunk.start || site.s >= chunk.start+CHUNK_LENGTH) continue;
    const {s,u,side,kind} = site;
    const angle = -roadFrame(s).angle + (side < 0 ? Math.PI : 0);
    let ground;
    if (kind === 'fuel-stop') {
      ground = foundation(s,u,5.6,5.5,angle);
      solid('desert-fuel-stop',assets.fuelStop,point(s,u,ground),[0,angle,0]);
      apron(site);
    } else if (kind === 'windpump') {
      ground = foundation(s,u,1.8,1.8,angle);
      solid('desert-windpump-tower',assets.windTower,point(s,u,ground),[0,angle,0]);
      const rotor = new THREE.Vector3(0,11.15,-.72).applyAxisAngle(new THREE.Vector3(0,1,0),angle);
      const root = point(s,u,ground);
      add('desert-windpump-rotor',assets.windRotor,desertRotorMaterial,[root[0]+rotor.x,root[1]+rotor.y,root[2]+rotor.z],[0,angle,0]);
      const troughS = s+4, troughU = u-side*3.8;
      const troughGround = foundation(troughS,troughU,1.15,2.4,angle);
      solid('desert-ranch-trough',assets.trough,point(troughS,troughU,troughGround),[0,angle,0]);
    } else {
      // A single sun-bleached skull, tucked into the sand beside the road.
      ground = point(s,u)[1]-.025;
      // Face the fixed isometric camera, regardless of which roadside it uses.
      // A bounded seeded variation keeps every muzzle visible from the front.
      const yaw=Math.atan2(-220,260)+(randomAt(site.index,2317)-.5)*.56;
      const center=chunk.groundPosition(s,u),along=chunk.groundPosition(s+1,u),across=chunk.groundPosition(s,u+1);
      const normal=new THREE.Vector3().subVectors(across,center).cross(new THREE.Vector3().subVectors(along,center)).normalize();
      const orientation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),normal)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw));
      const rotation=new THREE.Euler().setFromQuaternion(orientation);
      solid('desert-cattle-skull',assets.skull,point(s,u,ground),[rotation.x,rotation.y,rotation.z]);
    }
    chunk.features.discoveries.push({...site,ground});
  }
  for (const [name,{geometry,paint,items}] of batches) {
    const mesh = new THREE.InstancedMesh(geometry,paint,items.length); mesh.name=name;
    items.forEach((item,i)=>{
      transform.position.set(...item.p); transform.rotation.set(...item.rotation); transform.scale.set(...item.scale);
      transform.updateMatrix(); mesh.setMatrixAt(i,transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate=true; mesh.castShadow=name!=='desert-windpump-rotor'; mesh.receiveShadow=true;
    mesh.computeBoundingSphere();
    if (name==='desert-windpump-rotor') mesh.boundingSphere.radius=Math.max(mesh.boundingSphere.radius,3);
    chunk.group.add(mesh);
  }
}
