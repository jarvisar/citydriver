import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { butterflyRoof, pitchedRoof, barrelRoof, roofWedge, mansardGeometry, vaultGeometry } from '../src/world/city-roofs.js';

test('sloped roof infills, mansards and vaulted shells are closed solids without degenerate faces', () => {
  for (const geometry of [roofWedge, mansardGeometry, vaultGeometry]) {
    const points = geometry.attributes.position, edges = new Map();
    const index = geometry.index, count = index?.count ?? points.count;
    const vertex = i => new THREE.Vector3().fromBufferAttribute(points, index ? index.getX(i) : i);
    const key = p => p.toArray().map(v => Math.round(v * 1e6)).join(',');
    for (let i = 0; i < count; i += 3) {
      const a = vertex(i), b = vertex(i + 1), c = vertex(i + 2);
      assert.ok(new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).length() > 1e-8);
      for (const [p, q] of [[a, b], [b, c], [c, a]]) {
        const edge = [key(p), key(q)].sort().join('/'); edges.set(edge, (edges.get(edge) ?? 0) + 1);
      }
    }
    assert.ok([...edges.values()].every(n => n === 2), 'every edge is shared by exactly two faces');
  }
});

function capture() {
  const box = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial(), meshes = [];
  const c = { distant: false, materials: { solid: material },
    item(key, geometry, material, p, scale, color, yaw = 0, roll = 0) {
      const mesh = new THREE.Mesh(geometry, material); mesh.name = key;
      mesh.position.set(...p); mesh.scale.set(...scale); mesh.rotation.set(0, yaw, roll); mesh.updateMatrixWorld(); meshes.push(mesh);
    },
    box(x, y, s, w, h, d, color, kind = 'solid', yaw = 0, roll = 0) { this.item(kind, box, material, [x, y, -s], [w, h, d], color, yaw, roll); },
  };
  return { c, height(x, s = 0) {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 100, -s), new THREE.Vector3(0, -1, 0));
    return ray.intersectObjects(meshes, false)[0]?.point.y;
  }, dispose() { box.dispose(); material.dispose(); } };
}

test('butterfly wings meet a lower gutter without holes or clipping into roofs at any lot width', () => {
  for (const width of [8, 16, 27, 45, 80]) {
    const view = capture();
    try {
      butterflyRoof(view.c, { x: 0, s: 0, width, depth: 24, wall: '#ffffff', accent: '#ffffff' }, 0);
      const valley = view.height(0);
      assert.ok(valley > .8 && valley < 1.4);
      assert.ok(view.height(width / 2 - .2) > valley + 1.2);
      for (const s of [-11.8, 0, 11.8]) for (let i = 0; i <= 100; i++) {
        const x = -width / 2 + i / 100 * width, h = view.height(x, s);
        assert.ok(Number.isFinite(h) && h > .8, `continuous cover above the building at ${width}, ${x}, ${s}`);
        assert.ok(Math.abs(h - view.height(-x, s)) < 1e-4, 'opposing wings join symmetrically');
      }
    } finally { view.dispose(); }
  }
});

test('pitched and barrel covers stay continuous through panel joins and their crowns', () => {
  for (const width of [14, 28, 54]) for (const type of ['pitched', 'vault']) {
    const view = capture();
    try {
      if (type === 'pitched') pitchedRoof(view.c, 0, 0, width, 30, 4, '#ffffff', '#ffffff');
      else barrelRoof(view.c, 0, 0, width, 30, 4, '#ffffff');
      const heights = Array.from({ length: 241 }, (_, i) => view.height(-width * .499 + i / 240 * width * .998));
      assert.ok(heights.every(h => Number.isFinite(h) && h >= 4), 'no exposed gaps across the roof');
      // The vault is steep near its spring line; compare against that facet's
      // actual slope. Only pitched roofs have the intentional raised ridge cap.
      const slope = type === 'pitched' ? Math.tan(.36) : .55 / Math.tan(Math.PI / 24);
      const maximumStep = width * .998 / 240 * slope + (type === 'pitched' ? .21 : .002);
      for (let i = 1; i < heights.length; i++) assert.ok(Math.abs(heights[i] - heights[i - 1]) <= maximumStep, `${type}: no unexpected ledges or floating caps`);
      assert.ok(heights[120] > heights[0] + 2);
    } finally { view.dispose(); }
  }
});
