import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { addSurfacePolygon, pathPanels, rectanglePolygon, signedArea, subtractPolygon, containsPoint } from '../src/world/city-surfaces.js';
import { cityLogical, cityLayout } from '../src/world/city-layout.js';
import { CitydriverChunk, CitydriverWorld } from '../src/world/citydriver-world.js';
import { cityItemMatrix } from '../src/world/city-layout-render.js';
import { blockStreets } from '../src/world/city-streets.js';
import { footprintContact } from '../src/collision.js';

const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-7;
test('path bends share complete mitred joins and diagonal entrances meet the lawn boundary flush', () => {
  for (const width of [3, 4.5, 14]) {
    const panels = pathPanels([[16, 28], [42, 46], [68, 58], [96, 84]], width);
    assert.equal(panels.length, 3);
    for (let i = 1; i < panels.length; i++) assert.equal(panels[i].filter(p => panels[i - 1].some(q => same(p, q))).length, 2);
    for (const panel of panels) for (const [x, s] of panel) assert.ok(x >= 16 && x <= 96 && s >= 16 && s <= 96);
    assert.equal(panels[0].filter(p => p[0] === 16).length, 2, 'full-width entrance has a flush end cap');
    assert.equal(panels.at(-1).filter(p => p[0] === 96).length, 2);
    assert.ok(panels.every(p => signedArea(p) > 0));
  }
  const loop = pathPanels([[35, 30], [72, 30], [80, 56], [60, 82], [30, 70], [35, 30]], 4);
  assert.equal(loop[0].filter(p => loop.at(-1).some(q => same(p, q))).length, 2, 'closed paths have no cap or wedge at the closing join');
  assert.deepEqual(pathPanels([[30, 30], [30, 30]], 4), []);
});

test('planting subtraction preserves area and makes real space for crossing paths', () => {
  const bed = rectanglePolygon(30, 30, 20, 20), path = rectanglePolygon(30, 30, 4, 60);
  const pieces = subtractPolygon(bed, path);
  assert.ok(Math.abs(pieces.reduce((n, p) => n + Math.abs(signedArea(p)), 0) - 320) < 1e-8);
  for (const p of pieces) assert.equal(containsPoint(p, 30, 30), false);
  assert.deepEqual(subtractPolygon(bed, rectanglePolygon(80, 80, 4, 4)), [bed]);
  assert.deepEqual(subtractPolygon(bed, rectanglePolygon(30, 30, 40, 40)), []);
});

test('polygon collision checks every edge of a shaped flower bed', () => {
  const solid = { corners: [{ x: 0, z: 0 }, { x: 10, z: 2 }, { x: 4, z: 12 }] };
  const car = { x: 1, z: 7, heading: 0, halfWidth: .2, halfLength: .2 };
  assert.equal(footprintContact(car, solid), null, 'the third slanted edge leaves the path clear');
  car.x = 4; car.z = 6; assert.ok(footprintContact(car, solid));
});

test('curved ground tiles and neighbouring chunks use identical boundary positions', () => {
  const material = new THREE.MeshBasicMaterial();
  try {
    for (const [ix, iz] of [[3, 2], [-4, -3], [2, 5], [-5, -8]]) for (const axis of [0, 1]) {
      const boundary = (axis === 0 ? ix + 1 : iz + 1) * 112, edges = [];
      for (const side of [0, 1]) {
        const c = { east: (ix + (axis === 0 ? side : 0)) * 112, start: (iz + (axis === 1 ? side : 0)) * 112, batches: new Map(), materials: { solid: material } };
        addSurfacePolygon(c, rectanglePolygon(56, 56, 112, 112), 24.06, .12, '#ffffff');
        const found = [];
        for (const batch of c.batches.values()) for (const { frame: f } of batch.items) {
          const vertices = [[f.u, f.s], [f.u + f.eu, f.s + f.es], [f.u + f.nu, f.s + f.ns]];
          for (let i = 0; i < 3; i++) {
            const a = vertices[i], b = vertices[(i + 1) % 3], pa = cityLogical(a[1], a[0]), pb = cityLogical(b[1], b[0]);
            if (Math.abs((axis === 0 ? pa.u : pa.s) - boundary) < 1e-6 && Math.abs((axis === 0 ? pb.u : pb.s) - boundary) < 1e-6) found.push([a, b]);
          }
        }
        assert.ok(found.length); edges.push(found);
      }
      for (const side of [0, 1]) for (const edge of edges[side]) for (const p of edge) {
        assert.ok(edges[1 - side].some(([a, b]) => {
          const dx = b[0] - a[0], ds = b[1] - a[1], len = dx * dx + ds * ds;
          const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * ds) / len));
          return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * ds) < 1e-7;
        }), `joined boundary ${ix},${iz}/${axis}`);
      }
    }
  } finally { material.dispose(); }
});

test('rigid bridge parapets terminate on the actual curved bank rail junctions', () => {
  const world = new CitydriverWorld(new THREE.Scene()), matrix = new THREE.Matrix4(), point = new THREE.Vector3();
  try {
    for (const [ix, iz] of [[3, 2], [-4, -3], [2, 5], [3, 5]]) {
      const c = new CitydriverChunk(ix, iz, world.materials, true), streets = blockStreets(ix, iz), expected = [];
      for (const axis of ['north', 'east']) if (c.plan.rivers[axis]) {
        const profiles = axis === 'north' ? [streets.south, streets.north] : [streets.west, streets.east];
        for (const [edge, sign, p] of [[0, 1, profiles[0]], [112, -1, profiles[1]]]) for (const x of [27.6, 84.4]) {
          const s = edge + sign * (Math.max(10.8, p.halfWidth + 2.8) - .2), address = axis === 'north' ? [x, s] : [s, 112 - x];
          expected.push(cityLayout(c.start + address[1], c.east + address[0]));
        }
      }
      let endpoints = 0;
      for (const item of c.batches.get('solid').items) if (item.color === '#c9bd9f' && item.scale[1] === 1.1) {
        cityItemMatrix(item, c.east, c.start, matrix);
        for (const sign of [-.5, .5]) {
          point.set(item.scale[0] > item.scale[2] ? sign : 0, 0, item.scale[0] > item.scale[2] ? 0 : sign).applyMatrix4(matrix);
          assert.ok(expected.some(p => Math.hypot(p.u - point.x - c.east, p.s + point.z - c.start) < 1e-7)); endpoints++;
        }
      }
      assert.equal(endpoints, expected.length); c.dispose();
    }
  } finally { world.dispose(); }
});
