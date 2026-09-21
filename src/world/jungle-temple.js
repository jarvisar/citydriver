import * as THREE from 'three';
import { positionAt, roadFrame, randomAt } from './route.js';
import { JungleDiscoveryParts } from './jungle-discovery-assets.js';
import { registerChunkResources } from './chunk-resources.js';
import { solidModel } from './colliders.js';

// A square cobblestone ruin: broad lower chamber, recessed upper sanctuary,
// stepped cornices and a broken parapet. The entrance faces the road.
function templeGeometry() {
  const parts = new JungleDiscoveryParts();
  let serial = 0;
  function stone(x, y, z, size = [1, 1, 1]) {
    const seed = serial++;
    parts.add(new THREE.BoxGeometry(...size, 2, 2, 2), [x, y, z], '#ffffff');
    const colors = parts.parts.at(-1).attributes.color;
    const gray = ['#747b71', '#85897e', '#626c65', '#92968a', '#798276'];
    const moss = ['#566d40', '#657c47', '#748651'];
    // Flat square color patches suggest the game's pixelated mossy cobble,
    // without external textures or a separate material per block.
    for (let i = 0; i < colors.count; i += 6) {
      const palette = randomAt(seed * 29 + i, 2831) < .38 ? moss : gray;
      const color = new THREE.Color(palette[Math.floor(randomAt(seed * 29 + i, 2832) * palette.length)]);
      for (let j = 0; j < 6; j++) colors.setXYZ(i + j, color.r, color.g, color.b);
    }
  }
  function course(halfX, halfZ, y, filled = false) {
    for (let x = -halfX; x <= halfX; x++) for (let z = -halfZ; z <= halfZ; z++) {
      if (filled || Math.abs(x) === halfX || Math.abs(z) === halfZ) stone(x, y, z);
    }
  }
  course(6, 5, .5, true);
  for (let y = 1; y <= 4; y++) {
    for (let x = -5; x <= 5; x++) for (let z = -4; z <= 4; z++) {
      if (Math.abs(x) !== 5 && Math.abs(z) !== 4) continue;
      if (z === 4 && Math.abs(x) <= 1 && y < 4) continue;
      if (Math.abs(x) === 5 && Math.abs(z) === 1 && y === 3) continue;
      stone(x, y + .5, z);
    }
  }
  // Projecting corner buttresses and a heavy band over the lower chamber.
  for (const x of [-5, 5]) for (const z of [-4, 4]) for (let y = 1; y <= 4; y++) stone(x * 1.12, y + .5, z * 1.12);
  course(6, 5, 5.25, true);
  for (let y = 6; y <= 8; y++) {
    for (let x = -4; x <= 4; x++) for (let z = -3; z <= 3; z++) {
      if (Math.abs(x) !== 4 && Math.abs(z) !== 3) continue;
      if (Math.abs(z) === 3 && x === 0 && y < 8) continue;
      if (Math.abs(x) === 4 && z === 0 && y === 7) continue;
      stone(x, y, z);
    }
  }
  course(4, 3, 9, true);
  course(3, 2, 10, true);
  for (const x of [-3, 3]) for (const z of [-2, 2]) stone(x, 11, z);
  for (const x of [-1, 0, 1]) stone(x, 10.8, -2, [1, .6, 1]);
  // Recessed dark chambers keep openings readable in the isometric view.
  parts.box([0, 2.4, 1.8], [8, 2.8, .12], '#29352b');
  parts.box([0, 6.8, 0], [6, 2, .12], '#303c2d');
  for (let step = 0; step < 3; step++) {
    for (let x = -2; x <= 2; x++) stone(x, .15 + step * .15, 7 - step, [1, .3 + step * .3, 1]);
  }
  // Angular vines hug all four walls, leaving the central doorway open.
  for (let face = 0; face < 4; face++) for (const column of [-3.7, -2.5, 2.7, 3.8]) {
    const length = 2 + Math.floor(randomAt(face * 13 + Math.round(column * 10), 2833) * 6);
    for (let i = 0; i < length; i++) {
      const along = column + (i % 3 === 0 ? .2 : 0), y = 4.8 - i * .48;
      const p = face < 2 ? [along, y, (face ? -1 : 1) * 4.53] : [(face === 2 ? -1 : 1) * 5.53, y, along * .7];
      const size = face < 2 ? [.14, .55, .07] : [.07, .55, .14];
      parts.box(p, size, '#39582f');
      const leaf = [...p]; leaf[face < 2 ? 0 : 2] += i % 2 ? -.17 : .17;
      parts.box(leaf, face < 2 ? [.38, .28, .09] : [.09, .28, .38], i % 2 ? '#557a36' : '#46692f');
    }
  }
  return parts.finish();
}

const geometry = templeGeometry();
const material = new THREE.MeshStandardMaterial({vertexColors: true, roughness: 1, flatShading: true});
registerChunkResources('jungle-temple', {geometry, material});

export function buildJungleTemple(chunk, site) {
  const center = positionAt(site.s, site.u);
  const angle = -roadFrame(site.s).angle - site.side * Math.PI / 2;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const point = (x, z) => ({x: center.x + x * cos + z * sin, z: center.z + chunk.start - x * sin + z * cos});
  const samples = [];
  for (let x = -6.5; x <= 6.5; x++) for (let z = -5.5; z <= 7.5; z++) {
    const p = point(x, z);
    samples.push(chunk.sampleGround(p.x, p.z));
  }
  const base = Math.max(...samples) + .08, bottom = Math.min(...samples) - .45;
  const parts = new JungleDiscoveryParts();
  // A buried stone plinth reaches below the lowest rendered ground sample.
  // It supports the entire footprint on slopes, including the entry steps.
  parts.box([0, (bottom - base) / 2, 0], [13, base - bottom, 11], '#68745b');
  parts.box([0, (bottom - base) / 2, 6.5], [5, base - bottom, 2], '#68745b');
  const footing = chunk.addMesh(parts.finish(), material, 'jungle-temple-foundation', true);
  const temple = new THREE.Mesh(geometry, material);
  temple.name = 'jungle-temple'; temple.castShadow = true; temple.receiveShadow = true;
  chunk.group.add(temple);
  for (const mesh of [temple, footing]) {
    mesh.position.set(center.x, base, center.z + chunk.start);
    mesh.rotation.y = angle;
  }
  solidModel(chunk, geometry, [center.x, base, center.z + chunk.start], angle);
  return {base, bottom, angle};
}
