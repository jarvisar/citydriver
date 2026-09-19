import test from 'node:test';
import assert from 'node:assert/strict';
import { coastalDiscoveries } from '../src/world/coastal-discoveries.js';
import { CoastalChunk } from '../src/world/environment.js';
import { coastOffset, shorelineOffset, beachWidth, groundHeight, bridgeAt, overlookAt, CHUNK_LENGTH } from '../src/world/route.js';
import { packChunk, unpackChunk } from '../src/world/chunk-transfer.js';

test('Pacific discoveries stay sparse, separated, and independent of streaming order', () => {
  const sites = coastalDiscoveries(-100000, 100000);
  assert.deepEqual(coastalDiscoveries(-100000, 0).concat(coastalDiscoveries(0, 100000)), sites);
  assert.ok(sites.every(site => ['lighthouse', 'dock', 'whale'].includes(site.kind)));
  assert.ok(sites.length > 35 && sites.length < 65, 'roughly one special encounter per 2.5 miles');
  for (const [kind, minimumGap, maximumCount] of [['lighthouse', 900, 35], ['dock', 900, 35], ['whale', 900, 20]]) {
    const group = sites.filter(site => site.kind === kind);
    assert.ok(group.length > 1 && group.length <= maximumCount, `${kind} must be an occasional discovery`);
    for (let i = 1; i < group.length; i++) assert.ok(group[i].s - group[i - 1].s > minimumGap);
  }
  for (let i = 1; i < sites.length; i++) assert.ok(sites[i].s - sites[i - 1].s > 900, 'different kinds also need breathing room');
  for (const site of sites) {
    if (site.kind === 'lighthouse') {
      assert.ok(site.u < -27 && site.u > coastOffset(site.s));
      assert.ok(sites.filter(other => other.kind === 'dock').every(other => Math.abs(site.s - other.s) > 900));
    }
    if (site.kind === 'whale') assert.ok(site.u < shorelineOffset(site.s) - 50);
    const start = Math.floor(site.s / CHUNK_LENGTH) * CHUNK_LENGTH;
    assert.deepEqual(coastalDiscoveries(start, start + CHUNK_LENGTH), sites.filter(other => other.s >= start && other.s < start + CHUNK_LENGTH));
  }
  const overlooks = Array.from({length: 101}, (_, i) => overlookAt((i - 50) * 1936 + 80)).filter(site => site.enabled);
  assert.ok(overlooks.length < 90);
  for (let i = 1; i < overlooks.length; i++) assert.ok(overlooks[i].center - overlooks[i - 1].center > 1400);
});

test('docks find dry beaches independently of inlet locations', () => {
  const docks = coastalDiscoveries(-100000, 100000).filter(site => site.kind === 'dock');
  assert.ok(docks.filter(site => Math.abs(site.s - bridgeAt(site.s).center) > 110).length > docks.length * .6,
    'most docks should have their own stretch of coast, away from inlets');
  for (const site of docks) {
    assert.ok(beachWidth(site.s) >= 16);
    const shore = shorelineOffset(site.s);
    for (const ds of [-4, 0, 4]) {
      assert.ok(groundHeight(site.s + ds, shore + 7) >= .8, 'dock approach needs dry sand');
      assert.ok(Math.abs(shorelineOffset(site.s + ds) - shore) <= 2.5, 'dock must meet a stable bank');
    }
  }
});

test('discovery models and animation materials survive worker transfer without copying shared assets', () => {
  const sites = coastalDiscoveries(-30000, 30000);
  for (const [kind, name] of [['lighthouse', 'coastal-lighthouse'], ['dock', 'moored-rowboat'], ['whale', 'offshore-whale']]) {
    const site = sites.find(site => site.kind === kind);
    const original = new CoastalChunk(Math.floor(site.s / CHUNK_LENGTH));
    const matrices = original.group.getObjectByName(name).instanceMatrix.array.slice();
    const {data, transfers} = packChunk(original);
    const restored = unpackChunk(structuredClone(data, {transfer: transfers}));
    try {
      assert.deepEqual(restored.features, original.features);
      const before = original.group.getObjectByName(name), after = restored.group.getObjectByName(name);
      assert.ok(before && after);
      assert.equal(before.geometry, after.geometry);
      assert.equal(before.material, after.material);
      assert.deepEqual(after.instanceMatrix.array, matrices);
      assert.ok(after.geometry.attributes.position.array.byteLength > 0);
      assert.equal(restored.features.discoveries.filter(other => other.kind === kind && other.index === site.index).length, 1);
    } finally { original.dispose(); restored.dispose(); }
  }
});
