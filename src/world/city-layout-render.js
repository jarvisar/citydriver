import * as THREE from 'three';
import { cityRigidFrame } from './city-layout.js';

const transform = new THREE.Object3D();

// Objects default to a pure rotation/translation. Only explicitly flexible
// ground and road surfaces receive affine frames from the chunk builder.
export function cityItemMatrix(item, east = 0, start = 0, target = new THREE.Matrix4()) {
  const [x, y, z] = item.p;
  const anchor = item.anchor ?? { s: start - z, u: east + x };
  const f = item.frame ?? cityRigidFrame(anchor.s, anchor.u);
  transform.position.set(x, y, z); transform.scale.set(...item.scale);
  transform.rotation.set(0, item.yaw ?? 0, item.roll ?? 0); transform.updateMatrix();
  target.copy(transform.matrix);
  const e = target.elements;
  for (let column = 0; column <= 8; column += 4) {
    const x = e[column], z = e[column + 2];
    e[column] = f.eu * x - f.nu * z;
    e[column + 2] = -f.es * x + f.ns * z;
  }
  const du = east + x - anchor.u, ds = start - z - anchor.s;
  e[12] = f.u - east + f.eu * du + f.nu * ds;
  e[14] = start - f.s - f.es * du - f.ns * ds;
  return target;
}

export function cityAffinePoint(s, u, anchor, frame = cityRigidFrame(anchor.s, anchor.u)) {
  const ds = s - anchor.s, du = u - anchor.u;
  return { s: frame.s + ds * frame.ns + du * frame.es, u: frame.u + ds * frame.nu + du * frame.eu };
}
