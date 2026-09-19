import * as THREE from 'three';
import { registerChunkResources } from './chunk-resources.js';
import { Parts } from './city-assets.js';

const stone = '#9d988f', darkStone = '#7f7a72', slate = '#4b5257', water = '#66818b', iron = '#3d4246';

// A tiered fountain for the square: a wide basin, a pedestal bowl and a
// figure on a column. Still water; the storm dimples the river, not this.
function fountain() {
  const p = new Parts();
  p.cylinder([0, .45, 0], 5.2, 5.4, .9, stone, 14);
  p.cylinder([0, .9, 0], 4.5, 4.5, .06, water, 14);
  p.cylinder([0, .95, 0], 5.2, 5.2, .18, darkStone, 14);
  p.cylinder([0, 1.35, 0], 1.9, 2.2, .7, stone, 12);
  p.cylinder([0, 1.7, 0], 1.6, 1.6, .06, water, 12);
  p.cylinder([0, 3.1, 0], .42, .55, 2.8, stone, 8);
  p.cone([0, 4.85, 0], 1.3, .7, stone, 10);
  p.cylinder([0, 5.25, 0], .3, .35, .5, darkStone, 8);
  p.box([0, 6.2, 0], [.7, 1.5, .5], darkStone);
  p.box([0, 7.1, 0], [.4, .4, .4], darkStone);
  return p.finish();
}

// A stone church with its clock tower on the corner. The tower faces -x,
// toward the road; the nave runs back along +x behind it.
function clockTower() {
  const p = new Parts();
  p.box([9, 4, 0], [16, 8, 9], stone);
  // The nave runs along x; the shared gable builder runs its ridge along z.
  const roof = new Parts();
  roof.gable([0, 0, 0], 9, 16, 8, 12.2, stone, slate, .4);
  p.parts.push(roof.finish().rotateY(Math.PI / 2).translate(9, 0, 0));
  for (const z of [-4.55, 4.55]) for (const x of [4, 8, 12, 16]) p.box([x, 4.4, z], [1, 3.6, .14], '#2f3a44');
  p.box([0, 12, 0], [6.4, 24, 6.4], stone);
  p.box([0, 24.3, 0], [7, .6, 7], darkStone);
  for (const y of [8, 16]) p.box([0, y, 0], [6.7, .35, 6.7], darkStone);
  p.box([-3.22, 2.2, 0], [.1, 4.4, 2.2], '#2b2521');
  p.box([-3.3, 4.6, 0], [.12, .5, 2.6], darkStone);
  for (const [x, z, r] of [[-3.24, 0, [0, 0, Math.PI / 2]], [3.24, 0, [0, 0, Math.PI / 2]], [0, -3.24, [Math.PI / 2, 0, 0]], [0, 3.24, [Math.PI / 2, 0, 0]]]) {
    p.cylinder([x, 20.5, z], 1.5, 1.5, .1, '#e9e4d2', 12, r);
    p.box([x + (x ? Math.sign(x) * .12 : 0), 20.5, z + (z ? Math.sign(z) * .12 : 0)], x ? [.1, .12, 1.3] : [1.3, .12, .1], '#2f3336');
    p.box([x + (x ? Math.sign(x) * .12 : 0), 20.9, z + (z ? Math.sign(z) * .12 : 0)], x ? [.1, .8, .12] : [.12, .8, .1], '#2f3336');
  }
  for (const [x, z] of [[-3.22, 0], [0, -3.22], [0, 3.22]]) p.box([x, 13.5, z], x ? [.1, 3, 1.2] : [1.2, 3, .1], '#2b3138');
  p.cone([0, 29.2, 0], 3.7, 9.2, slate, 8);
  p.cylinder([0, 34.4, 0], .06, .06, 1.6, iron, 5);
  p.box([0, 34.9, 0], [.7, .09, .09], iron);
  return p.finish();
}

export const cityDiscoveryAssets = { fountain: fountain(), clockTower: clockTower() };
export const cityDiscoveryMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .95 });
registerChunkResources('city-discoveries', { cityDiscoveryAssets, cityDiscoveryMaterial });
