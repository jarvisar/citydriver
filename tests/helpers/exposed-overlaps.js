import * as THREE from 'three';
import { cityItemMatrix } from '../../src/world/city-layout-render.js';

// Intersect projected faces, then look toward their shared plane. Buried
// construction joints are fine; two visible faces competing for depth are not.
function intersection(subject, boundary) {
  const area = p => p.reduce((sum, a, i) => {
    const b = p[(i + 1) % p.length]; return sum + a[0] * b[1] - a[1] * b[0];
  }, 0) / 2;
  const sign = Math.sign(area(boundary));
  let out = subject;
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i], b = boundary[(i + 1) % boundary.length], input = out;
    const side = p => sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length], sp = side(p), sq = side(q);
      if (sp >= -1e-8) out.push(p);
      if ((sp > 0) !== (sq > 0)) {
        const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    if (out.length < 3) return null;
  }
  return Math.abs(area(out)) > .002 ? out : null;
}

export function exposedOverlaps(chunk) {
  const material = new THREE.MeshBasicMaterial(), entries = [], planes = new Map();
  const raycaster = new THREE.Raycaster(), ray = new THREE.Ray(), hit = new THREE.Vector3();
  const unit = new THREE.Box3(new THREE.Vector3(-.5, -.5, -.5), new THREE.Vector3(.5, .5, .5));
  const issues = [];
  function face(entry, points, normal) {
    if (normal.length() < .5) return;
    const d = normal.dot(points[0]);
    const drop = [0, 1, 2].sort((a, b) => Math.abs(normal.getComponent(b)) - Math.abs(normal.getComponent(a)))[0];
    const axes = [0, 1, 2].filter(i => i !== drop), poly = points.map(p => axes.map(i => p.getComponent(i)));
    const key = [...normal, d].map(v => Math.round(v * 1e4)).join(',');
    if (!planes.has(key)) planes.set(key, []);
    planes.get(key).push({ entry, normal, d, drop, axes, poly });
  }
  try {
    for (const [key, batch] of chunk.batches) for (const item of batch.items) {
      // Foliage intentionally intersects. Road markings and animated water have
      // separate coverage tests; this sweep targets architecture and furniture.
      if (key.includes('tree-') || key.includes('grass') || key.startsWith('road') || key === 'water') continue;
      const matrix = cityItemMatrix(item, chunk.east, chunk.start, new THREE.Matrix4());
      const box = batch.geometry.type === 'BoxGeometry' && key !== 'structure-roof-mansard';
      const mesh = new THREE.Mesh(batch.geometry, material);
      mesh.matrix.copy(matrix); mesh.matrixWorld.copy(matrix); mesh.matrixAutoUpdate = false;
      const entry = { key, item, matrix, inverse: matrix.clone().invert(), box, mesh }; entries.push(entry);
      if (box) {
        for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
          const other = [0, 1, 2].filter(i => i !== axis);
          const points = [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]].map(([a, b]) => {
            const p = [0, 0, 0]; p[axis] = sign * .5; p[other[0]] = a; p[other[1]] = b;
            return new THREE.Vector3(...p).applyMatrix4(matrix);
          });
          face(entry, points, new THREE.Vector3().setComponent(axis, sign).transformDirection(matrix));
        }
      } else {
        const attr = batch.geometry.attributes.position, index = batch.geometry.index, count = index?.count ?? attr.count;
        for (let i = 0; i < count; i += 3) {
          const points = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(attr, index ? index.getX(i + j) : i + j).applyMatrix4(matrix));
          face(entry, points, points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize());
        }
      }
    }
    for (const faces of planes.values()) for (let i = 0; i < faces.length; i++) for (let j = i + 1; j < faces.length; j++) {
      const a = faces[i], b = faces[j];
      if (a.entry === b.entry && a.entry.box) continue;
      const overlap = intersection(a.poly, b.poly);
      if (!overlap) continue;
      const center = overlap.reduce((s, p) => [s[0] + p[0] / overlap.length, s[1] + p[1] / overlap.length], [0, 0]);
      const point = new THREE.Vector3(); a.axes.forEach((axis, k) => point.setComponent(axis, center[k]));
      point.setComponent(a.drop, (a.d - a.normal.dot(point)) / a.normal.getComponent(a.drop));
      // The underside of a prop resting on pavement is outside the camera's world.
      if (a.normal.y < -.5 && point.y <= 24.15) continue;
      raycaster.set(point.clone().addScaledVector(a.normal, 500), a.normal.clone().negate());
      const hidden = entries.some(e => {
        if (e.box) {
          if (e === a.entry || e === b.entry) return false;
          ray.copy(raycaster.ray).applyMatrix4(e.inverse);
          return ray.intersectBox(unit, hit) && hit.applyMatrix4(e.matrix).distanceTo(raycaster.ray.origin) < 499.99;
        }
        const hits = raycaster.intersectObject(e.mesh, false);
        return hits.length && hits[0].distance < 499.99;
      });
      if (!hidden) issues.push({ point: point.toArray(), items: [a.entry, b.entry].map(e => ({ batch: e.key, color: e.item.color, p: e.item.p })) });
    }
    return issues;
  } finally { material.dispose(); }
}
