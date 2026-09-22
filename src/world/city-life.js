import * as THREE from 'three';
import { Parts } from './city-assets.js';

export const WALKER_COLORS = ['#a9cbbb', '#a8c7e3', '#e8b69e', '#e3cc91', '#c7b5d8', '#d5cbb9'];

function walker() {
  const p = new Parts();
  // A floating coat and a detached head. All details share one geometry and
  // material, including the tiny face that makes local -Z read as forward.
  const profile = [[0, .28], [.24, .33], [.31, .84], [.18, 1.12], [0, 1.14]];
  const body = new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 8);
  body.scale(1, 1, .8);
  p.add(body, [0, 0, 0], '#dce4e2');
  p.add(new THREE.SphereGeometry(.26, 8, 4), [0, 1.5, 0], '#ffead5');
  const head = p.parts.at(-1), positions = head.attributes.position, colors = head.attributes.color;
  const hair = new THREE.Color('#4c4745');
  for (let i = 0; i < positions.count; i += 3) {
    const y = (positions.getY(i) + positions.getY(i + 1) + positions.getY(i + 2)) / 3;
    const z = (positions.getZ(i) + positions.getZ(i + 1) + positions.getZ(i + 2)) / 3;
    if (y > 1.62 || (z > .015 && y > 1.4)) {
      for (let j = 0; j < 3; j++) colors.setXYZ(i + j, hair.r, hair.g, hair.b);
    }
  }
  for (const side of [-1, 1]) {
    p.add(new THREE.PlaneGeometry(.036, .052), [side * .078, 1.51, -.244], '#344247', [0, Math.PI, 0]);
  }
  // Keep the lathe/sphere's smooth normals without adding any triangles.
  return p.finish({ preserveNormals: true });
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

// Shared by street residents and waiting passengers. Absolute time means
// culled residents resume in the right place without maintaining a rig.
export function walkerFloat(walker, time, target = {}) {
  const phase = walker.phase + time * (2.6 + walker.speed * 1.4);
  target.lift = .07 + Math.sin(phase) * .075;
  target.roll = Math.sin(phase * .5) * .055;
  target.stretch = 1 + Math.cos(phase) * .018;
  return target;
}

export function walkerPose(walker, time, river = false) {
  const direction = walker.direction ?? 1;
  const travel = walker.phase + time * walker.speed * direction;
  if (river) {
    const offset = ((travel % 144) + 144) % 144;
    const north = offset === 0 || (offset !== 72 && (offset < 72) === (direction > 0));
    return { x: walker.side ? 97.5 : 14.5, s: 20 + (offset < 72 ? offset : 144 - offset), yaw: north ? 0 : Math.PI };
  }
  const offset = ((travel % 332) + 332) % 332, side = Math.floor(offset / 83), along = offset % 83;
  // Ease the quarter-turn over the last/first 80 cm of each pavement edge.
  const turn = .8, blend = along < turn ? (along + turn) / (2 * turn) : (along - 83 + turn) / (2 * turn);
  const eased = THREE.MathUtils.smoothstep(blend, 0, 1);
  const yaw = -(side + (along < turn ? eased - 1 : eased)) * Math.PI / 2 + (direction < 0 ? Math.PI : 0);
  if (side === 0) return { x: 14.5, s: 14.5 + along, yaw };
  if (side === 1) return { x: 14.5 + along, s: 97.5, yaw };
  if (side === 2) return { x: 97.5, s: 97.5 - along, yaw };
  return { x: 97.5 - along, s: 14.5, yaw };
}
