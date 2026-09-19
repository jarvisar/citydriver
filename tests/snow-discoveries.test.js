import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CHUNK_LENGTH } from '../src/world/route.js';
import { snowDiscoveries, snowDiscoveryClears, cableTravel, CABLE_CYCLE, CABIN_DROP, CABLE_ROPE_OFFSET } from '../src/world/snow-discoveries.js';
import { cableCabinPose, animateSnowDiscoveries } from '../src/world/snow-discovery-scenery.js';
import { snowRoadHeight, snowPosition, alpineLake, snowBridgeAt, lampAt, LAMP_SPACING } from '../src/world/snow-route.js';
import { SnowChunk, SnowWorld } from '../src/world/snow.js';
import { packChunk, unpackChunk } from '../src/world/chunk-transfer.js';

const chunkOf = site => new SnowChunk(Math.floor(site.s / CHUNK_LENGTH));
const nearest = (sites, kind) => sites.filter(site => site.kind === kind).sort((a, b) => Math.abs(a.s) - Math.abs(b.s));
const groundUnder = (chunk, x, z) => {
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 4000, z), new THREE.Vector3(0, -1, 0));
  return ray.intersectObject(chunk.terrain, false)[0]?.point.y ?? null;
};

test('snow discovery sites stay rare and stable when streamed in either direction', () => {
  const sites = snowDiscoveries(-150000, 150000);
  // The existing district chance and terrain requirements keep both types sparse.
  assert.ok(sites.length > 4 && sites.length < 28, `unexpected discovery count ${sites.length}`);
  assert.deepEqual([...new Set(sites.map(site => site.kind))].sort(), ['cable-car', 'snowmen']);
  assert.deepEqual(snowDiscoveries(-150000, 0).concat(snowDiscoveries(0, 150000)), sites);
  // Adjacent populated districts can search toward one another by up to 2 km each.
  for (let i = 1; i < sites.length; i++) assert.ok(sites[i].s - sites[i - 1].s > 2000, 'leave kilometers between encounters');
  for (const site of [...sites].reverse()) {
    const start = Math.floor(site.s / CHUNK_LENGTH) * CHUNK_LENGTH;
    assert.deepEqual(snowDiscoveries(start, start + CHUNK_LENGTH), [site], 'exactly one chunk owns each site');
    // Lines keep clear of the trestles, the lamps and the summit relays.
    assert.ok(Math.abs(site.s - snowBridgeAt(site.s).center) > 72);
    for (let i = Math.floor((site.s - 70) / LAMP_SPACING); i * LAMP_SPACING < site.s + 70; i++) {
      const lamp = lampAt(i);
      assert.ok(lamp.hidden || Math.abs(lamp.s - site.s) > 9, `lamp crowds the discovery at ${site.s}`);
    }
    if (site.kind === 'snowmen') {
      for (const figure of site.figures) {
        assert.ok(figure.u - figure.scale > 9, 'snowmen stand clear of the road and snowbanks');
        assert.equal(snowDiscoveryClears(figure.s, figure.u, [site]), false);
        assert.equal(snowDiscoveryClears(figure.s, figure.u + 4, [site], 2), false, 'clear space for nearby tree crowns');
      }
      assert.ok(snowDiscoveryClears(site.s + 40, site.u, [site]));
      continue;
    }
    // The line runs from the lake shore, over the road, up to a mountain shelf.
    assert.ok(site.lower.u < alpineLake(site.s).near + 9 && site.lower.u > alpineLake(site.s).near);
    assert.equal(snowDiscoveryClears(site.s, site.lower.u, [site]), false);
    assert.ok(snowDiscoveryClears(site.s + 40, site.lower.u, [site]), 'the corridor ends with the line');
    assert.ok(site.upper.ground - snowRoadHeight(site.s) > 30);
    assert.ok(site.points.length >= 3 && site.points.length <= 6);
    const spans = site.points.slice(1).map((point, i) => point.u - site.points[i].u);
    assert.ok(Math.min(...spans) > 20, 'towers never crowd each other');
    assert.ok(Math.max(...spans) < Math.min(...spans) * 2.6, 'towers are spaced evenly along the line');
    for (const point of site.points.slice(1, -1)) {
      assert.ok(point.y - point.ground > 6 && point.y - point.ground < 30, 'pylons stay a believable height');
    }
    for (let i = 1; i < site.points.length - 1; i++) {
      const { u, y } = site.points[i], a = site.points[i - 1], b = site.points[i + 1];
      const chord = a.y + (b.y - a.y) * (u - a.u) / (b.u - a.u);
      assert.ok(y > chord, 'a pylon presses the rope up; it cannot hold it down');
    }
  }
});

test('snowmen and cable cars occur at comparable rarity over a long route', () => {
  const sites = snowDiscoveries(-1500000, 1500000);
  const snowmen = sites.filter(site => site.kind === 'snowmen').length;
  assert.ok(snowmen / sites.length > .35 && snowmen / sites.length < .65,
    `${snowmen} snowman discoveries among ${sites.length} encounters`);
});

test('snowmen sit on rendered snow and survive worker transfer', () => {
  const sites = nearest(snowDiscoveries(-150000, 150000), 'snowmen');
  assert.ok(sites.length > 0);
  for (const site of sites.slice(0, 3)) {
    const original = chunkOf(site);
    let restored;
    try {
      const feature = original.features.discoveries[0];
      assert.equal(feature.kind, 'snowmen');
      assert.equal(feature.figures.length, 3);
      for (const figure of feature.figures) {
        const ground = groundUnder(original, figure.x, figure.z + original.start);
        assert.ok(ground !== null && Math.abs(ground - figure.ground) < .001, 'snowmen meet the visible terrain');
      }
      const mesh = original.group.getObjectByName('snowmen');
      const positions = mesh.geometry.attributes.position.array.slice();
      assert.ok([...positions].every(Number.isFinite));
      const { data, transfers } = packChunk(original);
      restored = unpackChunk(structuredClone(data, { transfer: transfers }));
      assert.deepEqual(restored.features, original.features);
      assert.deepEqual(restored.group.getObjectByName('snowmen').geometry.attributes.position.array, positions);
      assert.equal(restored.group.getObjectByName('snowmen').material, mesh.material);
      animateSnowDiscoveries([restored], 20, { s: site.s, speed: 10 });
    } finally { original.dispose(); restored?.dispose(); }
  }
});

test('cable cars carry lit cabins clear of the mountain, the road and the lamps', () => {
  for (const site of nearest(snowDiscoveries(-90000, 90000), 'cable-car').slice(0, 3)) {
    const chunk = chunkOf(site);
    try {
      const feature = chunk.features.discoveries[0];
      assert.equal(feature.kind, 'cable-car');
      const line = chunk.group.getObjectByName('cable-car-line');
      // Two stations, the ropes, and a braced lattice tower per pylon: a build
      // that stopped early (bare legs, say) falls well short of this.
      assert.ok(line.geometry.attributes.position.count > 3000 + feature.towers.length * 2600,
        `the line is missing structure (${line.geometry.attributes.position.count} vertices)`);
      const cabins = chunk.group.getObjectByName('cable-car-cabins');
      assert.equal(cabins.count, 2);
      const road = snowRoadHeight(site.s), crossing = snowPosition(site.s, 0, road);
      let overRoad = null;
      for (let step = 0; step <= 60; step++) {
        const pose = cableCabinPose(feature, 1, step / 60), floor = pose.position.y - CABIN_DROP;
        const ground = groundUnder(chunk, pose.position.x, pose.position.z);
        if (ground !== null) assert.ok(floor > ground, `a cabin scrapes the mountain at ${site.s}`);
        const across = Math.hypot(pose.position.x - crossing.x, pose.position.z - (crossing.z + chunk.start));
        if (!overRoad || across < overRoad.across) overRoad = { across, floor };
      }
      assert.ok(overRoad.across < 12, 'the line crosses the road');
      assert.ok(overRoad.floor > road + 4, 'cabins pass well above the traffic and the lamp heads');
      // The two cabins share the line, one on each rope, always moving oppositely.
      for (const time of [0, 7, 23, 44, 61, 88]) {
        const travel = cableTravel(time, feature.index);
        const [left, right] = [-1, 1].map(side => cableCabinPose(feature, side, side < 0 ? travel : 1 - travel));
        assert.ok(left.position.distanceTo(right.position) >= 2 * CABLE_ROPE_OFFSET - .001, 'the cabins ride separate ropes');
        assert.ok(Math.abs(cableTravel(time, feature.index) + (1 - travel) - 1) < 1e-9, 'one climbs as the other descends');
        assert.ok(Math.abs(cableTravel(time + CABLE_CYCLE, feature.index) - travel) < 1e-9, 'the run repeats on a fixed cycle');
      }
      const run = Array.from({ length: CABLE_CYCLE * 2 }, (_, i) => cableTravel(i / 2, feature.index));
      assert.ok(run.filter(travel => travel === 0).length >= 12, 'cabins wait at the valley station');
      assert.ok(run.filter(travel => travel === 1).length >= 12, 'cabins wait at the mountain station');
      assert.ok(run.some(travel => travel > .2 && travel < .8), 'and spend most of the cycle underway');
      // Every tower leg reaches the rendered snow it stands on.
      assert.equal(feature.towers.length, site.points.length - 2);
      for (const tower of feature.towers) {
        const p = snowPosition(site.s, tower.u, 0), below = groundUnder(chunk, p.x, p.z + chunk.start);
        assert.ok(below !== null && site.points.find(point => point.u === tower.u).y - below > 6,
          `pylon at u ${tower.u} is too short for its ground`);
        assert.equal(tower.footings.length, 4);
        for (const foot of tower.footings) {
          const ground = groundUnder(chunk, foot.x, foot.z + chunk.start);
          assert.ok(ground !== null, 'a tower leg stands off the rendered mountain');
          assert.ok(Math.abs(foot.ground - ground) < .001, 'each leg samples the snow it stands on');
          assert.ok(foot.bottom < ground - .8 && foot.bottom > ground - 9, 'footings sit in the ground, not on stilts');
        }
      }
    } finally { chunk.dispose(); }
  }
});

test('approaching from either direction brings a cabin across the road without changing the lift', () => {
  for (const site of nearest(snowDiscoveries(-90000, 90000), 'cable-car').slice(0, 3)) {
    const original = chunkOf(site);
    const { data, transfers } = packChunk(original);
    const chunk = unpackChunk(structuredClone(data, { transfer: transfers }));
    try {
      const cabins = chunk.group.getObjectByName('cable-car-cabins');
      assert.equal(cabins.count, 2);
      const road = snowPosition(site.s, 0, 0), matrix = new THREE.Matrix4();
      const position = () => {
        cabins.getMatrixAt(0, matrix);
        return new THREE.Vector3().setFromMatrixPosition(matrix);
      };
      for (const direction of [-1, 1]) for (const speed of [8, 20, 40, 65]) for (const start of [0, 137]) {
        const vehicle = { s: site.s - direction * 401, speed: direction * speed };
        animateSnowDiscoveries([chunk], start, vehicle);
        // Revisit the same streamed chunk, exercising encounter reset too.
        const duration = 370 / speed, steps = Math.ceil(duration * 20);
        let previous;
        for (let step = 0; step <= steps; step++) {
          const elapsed = duration * step / steps;
          vehicle.s = site.s - direction * (400 - elapsed * speed);
          animateSnowDiscoveries([chunk], start + elapsed, vehicle);
          const current = position();
          if (previous) assert.ok(current.distanceTo(previous) < 1, 'cabins never jump during an approach');
          previous = current;
        }
        const cabin = position();
        assert.ok(Math.hypot(cabin.x - road.x, cabin.z - road.z - chunk.start) < 4,
          `cabin misses the drive-by at ${site.s}, speed ${vehicle.speed}, clock ${start}`);
        const frozen = cabins.instanceMatrix.array.slice();
        animateSnowDiscoveries([chunk], start + duration, vehicle);
        assert.deepEqual(cabins.instanceMatrix.array, frozen, 'pausing freezes the scheduled lift');
        vehicle.speed = 0;
        animateSnowDiscoveries([chunk], start + duration + 5, vehicle);
        assert.notDeepEqual(cabins.instanceMatrix.array, frozen, 'stopping the car does not stop the lift');
      }
    } finally { original.dispose(); chunk.dispose(); }
  }
});

test('snow discovery geometry, features and cabin motion survive worker transfer', () => {
  const sites = snowDiscoveries(-90000, 90000);
  {
    const site = nearest(sites, 'cable-car')[0], original = chunkOf(site);
    const name = 'cable-car-line';
    const before = original.group.getObjectByName(name);
    const positions = before.geometry.attributes.position.array.slice();
    const glow = before.geometry.attributes.discoveryGlow.array.slice();
    const { data, transfers } = packChunk(original);
    const restored = unpackChunk(structuredClone(data, { transfer: transfers }));
    try {
      const after = restored.group.getObjectByName(name);
      assert.deepEqual(restored.features, original.features);
      assert.equal(after.material, before.material, 'shared materials survive by name');
      assert.deepEqual(after.geometry.attributes.position.array, positions);
      assert.deepEqual(after.geometry.attributes.discoveryGlow.array, glow);
      assert.ok([...positions].every(Number.isFinite));
      // The world animates the transferred cabins, and freezes them when paused.
      const scene = new THREE.Scene(), world = new SnowWorld(scene);
      try {
        world.chunks.set(restored.index ?? 0, restored);
        const cabins = restored.group.getObjectByName('cable-car-cabins');
        const first = cabins.instanceMatrix.array.slice();
        world.animate(12.5); const moved = cabins.instanceMatrix.array.slice();
        assert.notDeepEqual(moved, first);
        world.animate(12.5);
        assert.deepEqual(cabins.instanceMatrix.array, moved, 'a frozen clock leaves the cabins still');
        world.animate(26); assert.notDeepEqual(cabins.instanceMatrix.array, moved);
        assert.ok([...cabins.instanceMatrix.array].every(Number.isFinite));
      } finally { world.chunks.delete(restored.index ?? 0); world.dispose(); }
    } finally { original.dispose(); restored.dispose(); }
  }
});
