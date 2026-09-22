import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityLayout, cityLogical, cityLayoutFrame, cityLanePose } from '../src/world/city-layout.js';
import { cityItemMatrix } from '../src/world/city-layout-render.js';
import { CITY_BLOCK as B, cityStreetAt, cityStreetProfile, cityRiverAt, citydriverRoute } from '../src/world/city-grid.js';
import { CitydriverChunk, CitydriverWorld } from '../src/world/citydriver-world.js';
import { footprintContact } from '../src/collision.js';
import { CityTraffic } from '../src/city-traffic.js';
import { DrivingController } from '../src/vehicle.js';
import { nearbyPlaces, placeRoute } from '../src/city-exploration.js';
import { cityRiverAxes } from '../src/world/city-waterways.js';
import { riverResidentPose } from '../src/world/city-rivers.js';
import { planBuildings } from '../src/world/city-buildings.js';
import { placeCityBuildings, parcelsOverlap, footprintFitsBlock } from '../src/world/city-parcels.js';
import { cityBlock } from '../src/world/city-grid.js';

test('mixed neighborhoods remain invertible, reproducible and joined across positive and negative addresses', () => {
  let rectangular = 0, curved = 0;
  for (let s = -4800; s <= 4800; s += 79) for (let u = -4800; u <= 4800; u += 83) {
    const p = cityLayout(s, u), inverse = cityLogical(p.s, p.u), f = cityLayoutFrame(s, u);
    assert.ok(Math.hypot(inverse.s - s, inverse.u - u) < 1e-6);
    assert.ok(f.ns * f.eu - f.nu * f.es > .5, 'blocks cannot fold over or pinch closed');
    assert.ok(Math.hypot(f.ns, f.nu) > .57 && Math.hypot(f.es, f.eu) > .57, 'lanes retain vehicle clearance');
    if (Math.hypot(p.s - s, p.u - u) < .001) rectangular++;
    if (Math.hypot(p.s - s, p.u - u) > 10) curved++;
  }
  assert.ok(rectangular > 2500 && curved > 2500, 'the city contains substantial regular and organic areas');
  const before = cityLayout(-1234, 6789);
  for (let i = 0; i < 300; i++) cityLayout(i * B * 8, i * B * 7);
  assert.deepEqual(cityLayout(-1234, 6789), before, 'cache eviction and streaming order do not change a city');
  for (let i = -20; i <= 20; i++) {
    const a = cityLayout(i * B - .00001, 392), b = cityLayout(i * B + .00001, 392);
    assert.ok(Math.hypot(a.s - b.s, a.u - b.u) < .0001, 'river banks meet through chunk boundaries');
  }
});

test('rivers meander, their banks stay dry and every crossing retains a complete drivable deck', () => {
  for (const ix of [-11, -4, 3, 10]) {
    const centers = [];
    for (let row = -16; row <= 16; row++) {
      const middle = (row + .5) * B, center = (ix + .5) * B, water = cityLayout(middle, center);
      centers.push(water.u);
      assert.ok(cityRiverAt(water.u, water.s));
      assert.ok(citydriverRoute.water(water.s, water.u));
      for (const bank of [ix * B + 25, ix * B + 87]) {
        const p = cityLayout(middle, bank); assert.equal(citydriverRoute.water(p.s, p.u), cityRiverAxes(ix, row).east);
      }
      for (const direction of [-1, 1]) for (let x = 0; x <= B; x += 4) {
        const profile = cityStreetProfile('east', row), p = cityLayout(row * B - direction * profile.lane, ix * B + x);
        assert.ok(cityStreetAt(p.s, p.u).onRoad); assert.equal(citydriverRoute.water(p.s, p.u), false);
      }
    }
    assert.ok(Math.max(...centers) - Math.min(...centers) > 30, 'each river has visible bends');
  }
});

test('rendered street surfaces and oblique building footprints use the same layout at both detail levels', () => {
  const world = new CitydriverWorld(new THREE.Scene());
  try {
    for (const [ix, iz] of [[3, 2], [-4, -3], [4, 4]]) {
      const near = new CitydriverChunk(ix, iz, world.materials), far = new CitydriverChunk(ix, iz, world.materials, true);
      try {
        assert.deepEqual(near.features.buildings, far.features.buildings);
        const road = near.group.getObjectByName('citydriver-road'), matrix = new THREE.Matrix4(), point = new THREE.Vector3();
        for (let i = 0; i < road.count; i++) {
          road.getMatrixAt(i, matrix); point.set(1 / 3, 0, -1 / 3).applyMatrix4(matrix);
          const s = near.start - point.z, u = near.east + point.x;
          assert.ok(cityStreetAt(s, u).onRoad, 'the visible road is physically drivable');
        }
        for (const b of near.features.buildings) {
          const collider = near.features.colliders.find(c => c.x === b.x && c.z === -b.s);
          assert.ok(collider);
          const item = { p: [b.logicalU - near.east, 0, near.start - b.logicalS], scale: [b.width, 1, b.depth], frame: b.placement };
          cityItemMatrix(item, near.east, near.start, matrix);
          for (const [x, z] of [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]]) {
            point.set(x, 0, z).applyMatrix4(matrix);
            assert.ok(collider.corners.some(c => Math.hypot(c.x - point.x - near.east, c.z - point.z + near.start) < 1e-7));
          }
          const car = { x: b.x, z: -b.s, halfWidth: 1, halfLength: 2, heading: .4 };
          assert.ok(footprintContact(car, collider), 'cars cannot pass through reshaped buildings');
          car.x += collider.reach + 5; assert.equal(footprintContact(car, collider), null);
        }
      } finally { near.dispose(); far.dispose(); }
    }
  } finally { world.dispose(); }
});

test('horizontal rivers bend, meet vertical rivers without dams, and have north-south bridge crossings', () => {
  const world = new CitydriverWorld(new THREE.Scene());
  try {
    for (const row of [-8, 5, 18]) {
      const centers = [];
      for (let column = -10; column <= 10; column++) {
        const p = cityLayout((row + .5) * B, (column + .5) * B); centers.push(p.s);
        assert.ok(citydriverRoute.water(p.s, p.u)); assert.ok(cityRiverAt(p.u, p.s).east);
        for (const direction of [-1, 1]) for (let s = row * B; s <= (row + 1) * B; s += 4) {
          const profile = cityStreetProfile('north', column);
          const p = cityLayout(s, column * B + direction * profile.lane);
          assert.ok(cityStreetAt(p.s, p.u).onRoad); assert.equal(citydriverRoute.water(p.s, p.u), false);
        }
      }
      assert.ok(Math.max(...centers) - Math.min(...centers) > 30);
    }
    const c = new CitydriverChunk(3, 5, world.materials, true), matrix = new THREE.Matrix4(), p = new THREE.Vector3();
    assert.equal(c.features.bridges.length, 4);
    const center = cityLayout(5.5 * B, 3.5 * B);
    let banks = 0;
    for (const batch of c.batches.values()) for (const item of batch.items) {
      // The old bank slabs would span and obstruct the crossing channel.
      if (item.p[1] !== 20.85) continue;
      banks++;
      cityItemMatrix(item, c.east, c.start, matrix).invert();
      p.set(center.u - c.east, 21, c.start - center.s).applyMatrix4(matrix);
      assert.ok(p.x < 0 || p.z > 0 || p.x - p.z > 1, 'no bank foundation crosses the open confluence');
    }
    assert.ok(banks > 0);
    c.dispose();
  } finally { world.dispose(); }
});

test('architecture keeps its exact dimensions and right angles, fitting irregular parcels without overlaps', () => {
  let placedCount = 0, plannedCount = 0, openCount = 0;
  for (let ix = -12; ix <= 12; ix++) for (let iz = -12; iz <= 12; iz++) {
    const block = cityBlock(ix, iz); if (block.kind !== 'blocks') continue;
    const original = planBuildings(block), plan = placeCityBuildings(block, original.buildings);
    assert.deepEqual(plan, placeCityBuildings(block, original.buildings));
    plannedCount += original.buildings.length; placedCount += plan.buildings.length; openCount += plan.open.length;
    for (const b of plan.buildings) {
      const template = original.buildings.find(p => p.seed === b.seed);
      assert.equal(b.width, template.width); assert.equal(b.depth, template.depth);
      const f = b.frame;
      assert.ok(Math.abs(f.ns * f.es + f.nu * f.eu) < 1e-12, 'walls stay perpendicular');
      assert.ok(Math.abs(Math.hypot(f.ns, f.nu) - 1) < 1e-12 && Math.abs(Math.hypot(f.es, f.eu) - 1) < 1e-12, 'no stretching or shrinking');
      assert.ok(footprintFitsBlock(block, b.corners));
      for (const other of plan.buildings) if (b !== other) assert.equal(parcelsOverlap(b.corners, other.corners), false);
    }
  }
  assert.ok(placedCount > plannedCount * .8, 'retain the city density and architectural variety');
  assert.ok(openCount > 0, 'awkward spaces become planted courtyards');
});

test('landmark assemblies remain rigid and residents keep to dry banks in both river orientations', () => {
  const world = new CitydriverWorld(new THREE.Scene()), types = new Set();
  try {
    for (let ix = -8; ix <= 8; ix++) for (let iz = 1; iz <= 8; iz++) {
      const block = cityBlock(ix, iz); if (!block.landmark || types.has(block.landmark)) continue;
      const c = new CitydriverChunk(ix, iz, world.materials, true); types.add(block.landmark);
      for (const batch of c.batches.values()) for (const item of batch.items) {
        if (item.p[1] < 25.5) continue;
        const f = item.frame;
        assert.ok(Math.abs(f.ns * f.es + f.nu * f.eu) < 1e-12);
        assert.ok(Math.abs(Math.hypot(f.ns, f.nu) - 1) < 1e-12);
        assert.ok(Math.abs(Math.hypot(f.es, f.eu) - 1) < 1e-12);
      }
      c.dispose();
    }
    assert.equal(types.size, 5);
    for (const [ix, iz] of [[3, 2], [0, 5], [3, 5], [-4, -8]]) {
      const c = new CitydriverChunk(ix, iz, world.materials);
      for (const walker of c.walkers) for (let time = 0; time < 300; time += 3.7) {
        const pose = riverResidentPose(c, walker, time), p = cityLayout(c.start + pose.s, c.east + pose.x);
        assert.equal(citydriverRoute.water(p.s, p.u), false);
        assert.equal(cityStreetAt(p.s, p.u).onRoad, false);
      }
      c.dispose();
    }
  } finally { world.dispose(); }
});

test('traffic follows curved lanes without entering water and landmark guidance samples the actual roads', () => {
  const scene = new THREE.Scene(), car = new DrivingController(citydriverRoute), traffic = new CityTraffic(scene, citydriverRoute, 0);
  try {
    for (const [s, u] of [[400, 350], [-400, -350], [4000, -3500]]) {
      const p = cityLanePose('north', Math.round(u / B) * B + 3, s);
      Object.assign(car, p); car.update(0, {}); traffic.reset(citydriverRoute, car.s, 'city', car.u);
      for (let tick = 0; tick < 600; tick++) {
        traffic.update(1 / 60, car);
        for (const other of traffic.vehicles) {
          const street = cityStreetAt(other.s, other.u);
          assert.ok(street.onRoad && !street.median); assert.equal(citydriverRoute.water(other.s, other.u), false);
        }
      }
      for (const place of nearbyPlaces(car.s, car.u, 3)) {
        const route = placeRoute(car.s, car.u, place);
        assert.deepEqual(route.at(-1), place.entrance);
        for (const p of route) assert.ok(cityStreetAt(p.s, p.u).onRoad);
      }
    }
  } finally { car.disposeModel(); traffic.dispose(); }
});
