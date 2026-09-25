import * as THREE from 'three';

// Shared by every shop and both detail levels. Forty sections keep a 25 m
// rooftop sign round; ten tube sections retain the city's faceted silhouette.
export const DONUT_RADIUS = 9;
export const DONUT_TUBE = 3.3;
const sections = 40, rows = 6, glazeTube = DONUT_TUBE + .2;
export const donutDough = new THREE.TorusGeometry(DONUT_RADIUS, DONUT_TUBE, 10, sections);

// Front-facing icing with uneven edges. Its lip wraps back to the dough so it
// does not read as a floating decal.
const positions = [], indices = [];
function point(a, b, tube) {
  const r = DONUT_RADIUS + tube * Math.cos(b);
  return [r * Math.cos(a), r * Math.sin(a), tube * Math.sin(b)];
}
const edge = a => [.12 + .13 * Math.sin(a * 5 + .7) + .07 * Math.sin(a * 9),
  Math.PI - .18 + .12 * Math.sin(a * 6 - .4)];
for (let i = 0; i <= sections; i++) {
  const a = i / sections * Math.PI * 2, [outer, inner] = edge(a);
  for (let j = 0; j <= rows; j++) positions.push(...point(a, outer + (inner - outer) * j / rows, glazeTube));
}
for (let i = 0; i < sections; i++) for (let j = 0; j < rows; j++) {
  const a = i * (rows + 1) + j, b = a + rows + 1;
  indices.push(a, b, a + 1, b, b + 1, a + 1);
}
for (const j of [0, rows]) for (let i = 0; i < sections; i++) {
  const a = i / sections * Math.PI * 2, b = (i + 1) / sections * Math.PI * 2;
  const k = positions.length / 3, side = j === 0 ? 0 : 1;
  positions.push(...point(a, edge(a)[side], glazeTube), ...point(b, edge(b)[side], glazeTube),
    ...point(a, edge(a)[side], DONUT_TUBE - .015), ...point(b, edge(b)[side], DONUT_TUBE - .015));
  if (j === 0) indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
  else indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
}
export const donutGlaze = new THREE.BufferGeometry();
donutGlaze.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
donutGlaze.setIndex(indices); donutGlaze.computeVertexNormals();

// The icing has six rows of facets. Interpolate its actual front face
// when seating sprinkles so none float above or sink beneath the icing.
export function sprinklePosition(i) {
  const a = (i + .37) / 28 * Math.PI * 2;
  const t = [.28, .48, .68, .39, .59][i % 5] * rows;
  const j = Math.floor(t), f = t - j, [outer, inner] = edge(a);
  const p = point(a, outer + (inner - outer) * j / rows, glazeTube);
  const q = point(a, outer + (inner - outer) * (j + 1) / rows, glazeTube);
  return { x: p[0] + (q[0] - p[0]) * f, y: p[1] + (q[1] - p[1]) * f,
    z: p[2] + (q[2] - p[2]) * f + .055, roll: a + Math.PI / 2 + (i % 3 - 1) * .4 };
}
