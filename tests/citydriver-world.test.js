import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  CITY_BLOCK, ROAD_HALF_WIDTH, ROAD_LEVEL, WATER_LEVEL, RIVER_PERIOD,
  cityCell, cityBlock, cityRiverAt, cityStreetAt, citydriverRoute, cityStreetProfile,
} from '../src/world/city-grid.js';
import { CitydriverWorld, DISTANT_CITY_RADIUS } from '../src/world/citydriver-world.js';
import { residentWindow, setResidentWindow } from '../src/world/resident.js';
import { cityLayout } from '../src/world/city-layout.js';

test('the city has connected, level streets in all four directions through negative coordinates', () => {
  assert.deepEqual(cityCell(-1, -1), { ix: -1, iz: -1, key: '-1,-1' });
  assert.equal(citydriverRoute.laneAssist, false);
  assert.deepEqual(citydriverRoute.bounds(0), [-Infinity, Infinity]);
  for (let index = -15; index <= 15; index++) {
    const line = index * CITY_BLOCK;
    for (let along = -CITY_BLOCK * 4; along <= CITY_BLOCK * 4; along += 3.5) {
      for (const lane of [-cityStreetProfile('north', index).halfWidth + .1, -cityStreetProfile('north', index).lane, cityStreetProfile('north', index).lane, cityStreetProfile('north', index).halfWidth - .1]) {
        for (const address of [[along, line + lane], [line + lane, along]]) {
          const { s, u } = cityLayout(...address);
          assert.equal(cityStreetAt(s, u).onRoad, true);
          assert.equal(citydriverRoute.height(s, u), ROAD_LEVEL);
          assert.equal(citydriverRoute.water(s, u), false);
          assert.equal(citydriverRoute.looseness(s, u), 0);
          assert.deepEqual(citydriverRoute.position(s, u), { x: u, y: ROAD_LEVEL, z: -s });
        }
      }
    }
  }
});

test('every recurring river is crossed by safe east-west bridges', () => {
  for (let ix = -22; ix <= 24; ix++) {
    const block = cityBlock(ix, 0), center = (ix + .5) * CITY_BLOCK, water = cityLayout(CITY_BLOCK / 2, center), u = water.u;
    assert.deepEqual(cityBlock(ix, -7), cityBlock(ix, -7), 'block generation is repeatable');
    if (block.kind !== 'river') { assert.equal(cityRiverAt(u, water.s), null); continue; }
    assert.equal(cityBlock(ix + RIVER_PERIOD, -11).kind, 'river');
    assert.equal(citydriverRoute.height(water.s, u), WATER_LEVEL);
    assert.equal(citydriverRoute.water(water.s, u), true);
    for (let row = -4; row <= 4; row++) for (const lane of [-cityStreetProfile('east', row).halfWidth + .1, -3, 0, 3, cityStreetProfile('east', row).halfWidth - .1]) {
      const { s, u } = cityLayout(row * CITY_BLOCK + lane, center);
      assert.equal(cityStreetAt(s, u).bridge, true);
      assert.equal(citydriverRoute.height(s, u), ROAD_LEVEL);
      assert.equal(citydriverRoute.water(s, u), false);
    }
  }
});

test('streamed blocks are bounded, move in both axes, and retain collision coordinates across origin shifts', () => {
  const previous = residentWindow(); setResidentWindow({ behind: 1, ahead: 3 });
  const scene = new THREE.Scene(), world = new CitydriverWorld(scene);
  try {
    const locations = [[24, 2.4], [-210, -150], [2150, 980], [-4200, -3100]];
    for (const [s, u] of locations) {
      for (let frame = 0; frame < 8; frame++) world.update(s, u);
      assert.equal(world.chunks.size, 9);
      assert.equal(scene.children.length, 10);
      assert.equal(world.chunks.size + world.distantChunks.size, (2 * DISTANT_CITY_RADIUS + 1) ** 2);
      assert.ok(world.distantGroup.children.length <= 36, 'the distant city is bounded to local two-by-two tiles');
      // Basin rims, canopies and planet sculptures are shared, not per-site meshes.
      for (const tile of world.distantGroup.children) {
        const kinds = new Set(tile.children.map(mesh => mesh.name.replace('citydriver-structure-', 'citydriver-')));
        assert.ok(kinds.size <= 17, 'each tile batches by geometry and material');
        assert.ok(tile.children.length <= 20, 'structure separation adds only a few batches per tile');
      }
      assert.equal([...world.collisionChunks(s, u)].length, 9);
      const cell = cityCell(s, u);
      assert.ok(world.chunks.has(cell.key));
      for (let ix = cell.ix - DISTANT_CITY_RADIUS; ix <= cell.ix + DISTANT_CITY_RADIUS; ix++) for (let iz = cell.iz - DISTANT_CITY_RADIUS; iz <= cell.iz + DISTANT_CITY_RADIUS; iz++) {
        const key = `${ix},${iz}`;
        assert.notEqual(world.chunks.has(key), world.distantChunks.has(key), 'each visible cell has exactly one level of detail');
      }
      assert.equal(world.distantGroup.position.z, world.origin);
      for (const chunk of world.distantChunks.values()) assert.equal(chunk.features.colliders.length, 0);
      for (const chunk of world.chunks.values()) {
        assert.ok(Math.abs(chunk.ix - cell.ix) <= 1 && Math.abs(chunk.iz - cell.iz) <= 1);
        assert.equal(chunk.group.position.x, chunk.ix * CITY_BLOCK);
        assert.equal(chunk.group.position.z, world.origin - chunk.iz * CITY_BLOCK);
        for (const collider of chunk.features.colliders) {
          assert.ok(collider.logicalU >= chunk.east && collider.logicalU <= chunk.east + CITY_BLOCK);
          assert.ok(collider.logicalS >= chunk.start && collider.logicalS <= chunk.start + CITY_BLOCK);
          assert.ok(collider.kind === 'median-tree' ? cityStreetAt(-collider.z, collider.x).median : !cityStreetAt(-collider.z, collider.x).onRoad, 'street furniture leaves the travel lanes clear');
        }
        for (const building of chunk.features.buildings) {
          assert.equal(building.facadeSides, 4); assert.ok(building.windows >= 8, 'even the smallest shop has windows on every side');
          assert.ok(chunk.features.colliders.some(solid => solid.x === building.x && solid.z === -building.s));
        }
      }
    }
    const dryRoughness = world.materials.road.roughness;
    world.setWetness(1); assert.ok(world.materials.road.roughness < .3);
    world.setWetness(0); assert.equal(world.materials.road.roughness, dryRoughness);
  } finally { world.dispose(); setResidentWindow(previous); }
  assert.equal(scene.children.length, 0);
  assert.equal(world.chunks.size, 0);
  assert.equal(world.distantChunks.size, 0);
});

test('river deck meshes match the physical road height and keep their piers outside the road', () => {
  const world = new CitydriverWorld(new THREE.Scene());
  try {
    world.update(34, 3.5 * CITY_BLOCK);
    const chunk = world.chunks.get('3,0');
    assert.equal(chunk.plan.kind, 'river');
    assert.ok(chunk.features.bridges.length);
    const road = chunk.group.getObjectByName('citydriver-road'), matrix = new THREE.Matrix4();
    const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
    for (let i = 0; i < road.count; i++) {
      road.getMatrixAt(i, matrix); matrix.decompose(position, rotation, scale);
      assert.ok(Math.abs(position.y + scale.y / 2 - ROAD_LEVEL) < .00001);
    }
    for (const collider of chunk.features.colliders) {
      const s = -collider.z, u = collider.x;
      assert.ok(collider.kind === 'median-tree' ? cityStreetAt(s, u).median : !cityStreetAt(s, u).onRoad);
      if (cityRiverAt(u, s)) assert.ok(cityStreetAt(s, u).eastDistance > ROAD_HALF_WIDTH + 1);
    }
  } finally { world.dispose(); }
});

test('rendered upper-storey glazing covers every building facade', () => {
  const world = new CitydriverWorld(new THREE.Scene());
  try {
    world.update(24, 2.4);
    const chunk = [...world.chunks.values()].find(candidate => candidate.features.buildings.length);
    assert.ok(chunk);
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
    const glass = ['citydriver-structure-glass', 'citydriver-structure-lit'].map(name => chunk.group.getObjectByName(name)).filter(Boolean);
    for (const building of chunk.features.buildings) {
      const sides = new Set(), frame = building.placement;
      const determinant = frame.eu * frame.ns - frame.nu * frame.es;
      for (const mesh of glass) for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix); position.setFromMatrixPosition(matrix);
        if (position.y < 28.5 || position.y > ROAD_LEVEL + building.height) continue;
        const duWorld = position.x + chunk.east - building.x, dsWorld = -position.z + chunk.start - building.s;
        const dx = (duWorld * frame.ns - dsWorld * frame.nu) / determinant;
        const ds = (dsWorld * frame.eu - duWorld * frame.es) / determinant;
        if (Math.abs(Math.abs(dx) - building.width / 2 - .17) < .002 && Math.abs(ds) < building.depth / 2) sides.add(dx < 0 ? 'west' : 'east');
        if (Math.abs(Math.abs(ds) - building.depth / 2 - .17) < .002 && Math.abs(dx) < building.width / 2) sides.add(ds < 0 ? 'south' : 'north');
      }
      assert.deepEqual([...sides].sort(), ['east', 'north', 'south', 'west']);
    }
  } finally { world.dispose(); }
});

test('approaching the distant city preserves building footprints, heights and window layout', () => {
  const world = new CitydriverWorld(new THREE.Scene());
  try {
    world.update(24, 2.4);
    const distant = [...world.distantChunks.values()].find(chunk => chunk.features.buildings.length);
    assert.ok(distant);
    const expected = structuredClone(distant.features.buildings), key = distant.index;
    world.update(distant.start + 30, distant.east + 3);
    assert.ok(!world.distantChunks.has(key));
    assert.deepEqual(world.chunks.get(key).features.buildings, expected);
  } finally { world.dispose(); }
});
