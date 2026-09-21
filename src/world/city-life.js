import { Parts } from './city-assets.js';

function walker() {
  const p = new Parts();
  p.box([0, 1.06, 0], [.46, .58, .28], '#b67b58');
  p.box([0, 1.54, 0], [.29, .34, .28], '#d7ad88');
  p.box([0, 1.71, -.02], [.31, .09, .3], '#4e4b44');
  for (const side of [-1, 1]) {
    p.box([side * .12, .4, side * .1], [.16, .72, .18], '#405b66', [side * .18, 0, 0]);
    p.box([side * .12, .08, side * .15 - .08], [.2, .14, .33], '#414947');
    p.box([side * .3, 1.02, -side * .08], [.14, .54, .17], '#b67b58', [-side * .2, 0, 0]);
    p.box([side * .3, .73, -side * .14], [.13, .14, .14], '#d7ad88');
  }
  return p.finish();
}
function canalBoat() {
  const p = new Parts();
  p.box([0, .42, 0], [4, .9, 13], '#46626b');
  p.box([0, .93, 0], [4.15, .15, 13.3], '#dbcdb0');
  p.box([0, 1.42, 1.4], [3.1, .9, 7.7], '#b6634c');
  p.box([0, 2.04, 1.4], [3, .5, 7.6], '#e9d4ad');
  for (const side of [-1, 1]) for (const z of [-1, 1.2, 3.4]) p.box([side * 1.52, 2.03, z], [.03, .34, 1.3], '#537b87');
  p.box([0, 2.39, 1.4], [3.4, .2, 8.1], '#49655f');
  p.box([.7, 2.8, 3.5], [.38, .75, .38], '#4f5755');
  for (const side of [-1, 1]) p.box([side * 1.7, 1.23, -4.5], [.12, .6, 3], '#b4b7a4');
  p.box([0, 1.3, -5.6], [1.4, .6, 1], '#9eaa7c');
  return p.finish();
}
export const cityWalker = walker();
export const cityBoat = canalBoat();

export function walkerPose(walker, time, river = false) {
  const travel = walker.phase + time * walker.speed;
  if (river) {
    const offset = ((travel % 144) + 144) % 144;
    return { x: walker.side ? 97.5 : 14.5, s: 20 + (offset < 72 ? offset : 144 - offset), yaw: offset < 72 ? 0 : Math.PI };
  }
  const offset = ((travel % 332) + 332) % 332, side = Math.floor(offset / 83), along = offset % 83;
  return [
    { x: 14.5, s: 14.5 + along, yaw: 0 },
    { x: 14.5 + along, s: 97.5, yaw: -Math.PI / 2 },
    { x: 97.5, s: 97.5 - along, yaw: Math.PI },
    { x: 97.5 - along, s: 14.5, yaw: Math.PI / 2 },
  ][side];
}
