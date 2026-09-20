import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CHUNK_LENGTH } from '../src/world/route.js';
import { alpineLanding, alpineRelay, nearAlpineRelay } from '../src/world/alpine-landmarks.js';
import { snowRoadHeight, alpineLake, LAKE_LEVEL } from '../src/world/snow-route.js';
import { SnowChunk } from '../src/world/snow.js';
import { packChunk, unpackChunk } from '../src/world/chunk-transfer.js';

test('alpine landmarks stay sparse, deterministic and clear of the road', () => {
  const landings = [], relays = [];
  for (let i = -60; i < 60; i++) {
    const landing = alpineLanding(i), relay = alpineRelay(i);
    assert.deepEqual(alpineLanding(i), landing); assert.deepEqual(alpineRelay(i), relay);
    if (landing) {
      landings.push(landing);
      assert.ok(landing.u < -30 && landing.u > alpineLake(landing.s).near);
      assert.ok(landing.u - landing.length < alpineLake(landing.s).near - 12, 'pier reaches open water');
    }
    if (relay) {
      relays.push(relay);
      assert.ok(relay.u > 55);
      assert.ok(nearAlpineRelay(relay.s, relay.u));
      assert.ok(!nearAlpineRelay(relay.s, 7), 'the driving corridor stays clear');
    }
  }
  assert.ok(landings.length > 10 && landings.length < 40, 'only a minority of cabins have landings');
  assert.equal(relays.length, 40);
});

test('relay footings and fishing piers meet the rendered terrain on both sides of the origin', () => {
  let docks = 0, towers = 0;
  for (let i = -18; i <= 18; i += 3) for (const site of [alpineRelay(i), alpineLanding(i)].filter(Boolean)) {
    const chunk = new SnowChunk(Math.floor(site.s / CHUNK_LENGTH));
    try {
      const feature = chunk.features.alpineLandmarks.find(f => f.index === site.index && f.kind === (site.kind || 'summit-relay'));
      if (site.kind && chunk.discoveries.some(other => Math.abs(other.s - site.s) < 32)) {
        assert.equal(feature, undefined, 'a landing yields to an existing discovery');
        continue;
      }
      assert.ok(feature, `missing landmark ${site.index}`);
      const dock = feature.kind === 'fishing-landing';
      if (dock) { docks++; assert.ok(feature.deck > LAKE_LEVEL + .8 && feature.deck < LAKE_LEVEL + 3); }
      else towers++;
      for (const foot of feature.footings) {
        const ray = new THREE.Raycaster(new THREE.Vector3(foot.x, 1000, foot.z), new THREE.Vector3(0, -1, 0));
        const hit = ray.intersectObject(chunk.terrain, false)[0];
        assert.ok(hit, 'footing must remain over the owning terrain');
        assert.ok(Math.abs(hit.point.y - foot.ground) < .001, 'grounding uses the rendered faces');
        assert.ok(foot.bottom < hit.point.y && foot.top > hit.point.y, 'supports enter the ground');
        if (!dock) assert.ok(foot.top > snowRoadHeight(site.s) + 30, 'relay belongs on the mountain');
      }
    } finally { chunk.dispose(); }
  }
  assert.ok(docks >= 5 && towers >= 10);
});

test('alpine landmark geometry and shared glowing material survive worker transfer and disposal', () => {
  const sites = [alpineRelay(0), ...Array.from({ length: 7 }, (_, i) => alpineLanding(i - 3)).filter(Boolean).slice(0, 1)];
  for (const site of sites) {
    const original = new SnowChunk(Math.floor(site.s / CHUNK_LENGTH));
    let restored;
    try {
      const name = site.kind ? 'alpine-fishing-landing' : 'summit-relay';
      const mesh = original.group.getObjectByName(name);
      assert.ok(mesh);
      const vertices = mesh.geometry.attributes.position.array.slice();
      assert.ok(vertices.every(Number.isFinite));
      const { data, transfers } = packChunk(original);
      restored = unpackChunk(structuredClone(data, { transfer: transfers }));
      const after = restored.group.getObjectByName(name);
      assert.deepEqual(restored.features, original.features);
      assert.deepEqual(after.geometry.attributes.position.array, vertices);
      assert.equal(after.material, mesh.material);
      assert.ok(after.geometry.attributes.discoveryGlow.array.some(value => value > 2));
      let disposed = false;
      after.geometry.addEventListener('dispose', () => { disposed = true; });
      restored.dispose(); restored = null;
      assert.ok(disposed, 'streaming releases landmark buffers');
    } finally { original.dispose(); restored?.dispose(); }
  }
});
