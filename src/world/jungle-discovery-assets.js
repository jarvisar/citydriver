import * as THREE from 'three';
import { birdFlightGLSL } from './bird-flight.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { registerChunkResources } from './chunk-resources.js';
import { waterClock } from './water.js';

export class JungleDiscoveryParts {
  constructor() { this.parts=[]; }
  add(source, position, color, rotation=[0,0,0], wing=0) {
    let geometry=source;
    if(source.index) { geometry=source.toNonIndexed(); source.dispose(); }
    geometry.deleteAttribute('uv');
    geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)));
    geometry.translate(...position);
    const c=new THREE.Color(color),count=geometry.attributes.position.count,colors=new Float32Array(count*3);
    for(let i=0;i<count;i++) colors.set([c.r,c.g,c.b],i*3);
    geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
    geometry.setAttribute('birdWing',new THREE.Float32BufferAttribute(new Float32Array(count).fill(wing),1));
    this.parts.push(geometry);
  }
  box(position,size,color,rotation) { this.add(new THREE.BoxGeometry(...size),position,color,rotation); }
  beam(a,b,radius,color,sides=5) {
    const direction=b.clone().sub(a),g=new THREE.CylinderGeometry(radius*.85,radius,direction.length(),sides);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize()));
    this.add(g,a.clone().add(b).multiplyScalar(.5).toArray(),color);
  }
  finish(keepWings=false) {
    const geometry=mergeGeometries(this.parts);this.parts.forEach(part=>part.dispose());
    if(!keepWings) geometry.deleteAttribute('birdWing');
    geometry.computeVertexNormals();geometry.computeBoundingSphere();return geometry;
  }
}

function macaw() {
  const parts=new JungleDiscoveryParts();
  const body=(position,size,color,detail=0)=>{
    const g=new THREE.IcosahedronGeometry(1,detail);g.scale(...size);parts.add(g,position,color);
  };
  body([0,.06,0],[.25,.29,.66],'#ce4033',1);
  body([0,.23,-.55],[.26,.27,.28],'#e25336',1);
  body([0,.14,-.83],[.15,.15,.21],'#e3d2a4');
  parts.add(new THREE.ConeGeometry(.11,.25,5),[0,-.02,-.93],'#34382d',[Math.PI,0,0]);
  for(const side of [-1,1]) {
    body([side*.218,.25,-.64],[.045,.135,.14],'#ece0b6');
    body([side*.253,.29,-.68],[.025,.039,.04],'#242b27');
    const patches=[
      {color:'#d94832',triangles:[[.17,0,-.22,.73,.08,-.25,.23,0,.38],[.23,0,.38,.73,.08,-.25,.85,.025,.46]]},
      {color:'#e1b743',triangles:[[.73,.08,-.25,1.28,.025,.08,.85,.025,.46],[.85,.025,.46,1.28,.025,.08,1.32,0,.64]]},
      {color:'#287f9f',triangles:[[1.28,.025,.08,1.91,-.06,.77,1.32,0,.64],[1.32,0,.64,1.91,-.06,.77,1.53,-.04,.88]]},
    ];
    for(const patch of patches) {
      const positions=patch.triangles.flat().map((v,i)=>i%3===0?v*side:v);
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();
      parts.add(g,[0,0,0],patch.color,[0,0,0],side);
    }
  }
  for(const [side,color] of [[-1,'#287f9f'],[0,'#be3c32'],[1,'#287f9f']]) {
    const x=side*.1,g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute([x-.07,0,.44,x+.07,0,.44,x+side*.09,-.11,1.72-Math.abs(side)*.17],3));
    g.computeVertexNormals();parts.add(g,[0,0,0],color);
  }
  return parts.finish(true);
}

export const parrotGeometry=macaw();
export const parrotMaterial=new THREE.MeshStandardMaterial({vertexColors:true,flatShading:true,roughness:1,side:THREE.DoubleSide});
parrotMaterial.onBeforeCompile=shader=>{
  shader.uniforms.jungleTime=waterClock.time;
  shader.vertexShader='uniform float jungleTime; attribute float birdWing;\n'+birdFlightGLSL+shader.vertexShader;
  const motion=`
    float seed = dot(instanceMatrix[3].xz, vec2(0.41, 0.29)) + float(gl_InstanceID) * 17.0;
    float phase = birdHash(seed + 5.0) * 6.2831853;
    float beat = birdBeat(jungleTime, seed, 6.7);
    float wingAngle = birdWing * (0.1 + beat * 0.48);
    mat2 wingTurn = mat2(cos(wingAngle), sin(wingAngle), -sin(wingAngle), cos(wingAngle));
    float orbit = jungleTime * mix(0.13, 0.19, birdHash(seed + 6.0)) + phase;
    vec2 radius = vec2(8.0, 14.0) * mix(0.85, 1.05, birdHash(seed + 7.0));
    mat3 heading = birdFrame(orbit, radius, phase);
  `;
  shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>\n${motion}
    objectNormal.xy = wingTurn * objectNormal.xy;
    objectNormal = heading * objectNormal;`);
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
    transformed.xy = wingTurn * (transformed.xy - vec2(birdWing * 0.17, 0.0)) + vec2(birdWing * 0.17, 0.0);
    transformed = heading * transformed;
    transformed += birdOrbit(orbit, radius, phase);
  `);
};
parrotMaterial.customProgramCacheKey=()=> 'jungle-macaw-flight-v3';

export const rainbowGeometry=new THREE.PlaneGeometry(2.4,1.25);
rainbowGeometry.translate(0,.625,0);
rainbowGeometry.setAttribute('rainbowCoord',rainbowGeometry.attributes.uv.clone());
export const rainbowMaterial=new THREE.MeshBasicMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true,toneMapped:false});
rainbowMaterial.onBeforeCompile=shader=>{
  shader.uniforms.jungleTime=waterClock.time;
  shader.vertexShader='attribute vec2 rainbowCoord; varying vec2 vRainbow;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvRainbow = rainbowCoord;');
  shader.fragmentShader='uniform float jungleTime; varying vec2 vRainbow;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
    vec2 p = vec2((vRainbow.x - 0.5) * 2.4, vRainbow.y * 1.25);
    float radius = length(p);
    float band = clamp((radius - 0.76) / 0.22, 0.0, 1.0);
    vec3 spectrum = vec3(smoothstep(0.5, 0.9, band) + 0.24 * (1.0 - band),
      exp(-pow((band - 0.48) * 3.6, 2.0)), 1.0 - smoothstep(0.26, 0.65, band));
    float softArc = exp(-pow((radius - 0.87) / 0.135, 4.0));
    float haze = 0.8 + 0.12 * sin(p.x * 7.0 + p.y * 4.0 + jungleTime * 0.19)
      + 0.08 * sin(p.x * 13.0 - p.y * 9.0 - jungleTime * 0.13);
    diffuseColor.rgb = mix(vec3(0.94, 0.98, 0.93), spectrum, 0.8);
    diffuseColor.a = softArc * smoothstep(0.06, 0.34, p.y) * haze * 0.56;
  `);
};
rainbowMaterial.customProgramCacheKey=()=> 'waterfall-rainbow-v1';
export const ropeBridgeMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,flatShading:true});
export const landingPathMaterial=new THREE.MeshStandardMaterial({color:'#998e69',roughness:1,flatShading:true,transparent:true,depthWrite:false});
landingPathMaterial.onBeforeCompile=shader=>{
  shader.vertexShader='attribute vec3 landingCoord; varying vec3 vLanding;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvLanding = landingCoord;');
  shader.fragmentShader='varying vec3 vLanding;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
    float along = vLanding.x;
    float edge = abs(vLanding.y) + 0.07 * sin(along * 2.1 + vLanding.y * 3.0);
    float width = 1.4 - 0.07 * clamp(along, 0.0, 6.0);
    diffuseColor.a *= smoothstep(-1.1, -0.3, along) * (1.0 - smoothstep(vLanding.z - 5.0, vLanding.z, along))
      * (1.0 - smoothstep(0.6, width, edge)) * 0.76;
  `);
};
landingPathMaterial.customProgramCacheKey=()=> 'jungle-bridge-landing-v2';
registerChunkResources('jungle-discoveries',{parrotGeometry,parrotMaterial,rainbowGeometry,rainbowMaterial,ropeBridgeMaterial,landingPathMaterial});
