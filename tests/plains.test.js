import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CHUNK_LENGTH } from '../src/world/route.js';
import { PLAINS_STEP, PLAINS_COLUMNS, PLAINS_COLUMN_COUNT, plainsVertex, plainsRowStep, plainsHeight, plainsGroundHeight, plainsRoadHeight, plainsDrivingRoute,
  plainsCreekAt, creekCenterS, creekDistance, CREEK_SPACING, CREEK_WATER_HALF_WIDTH, fieldAt, fieldRowAt, fieldBoundary, fieldBands, ROAD_RESERVE,
  stockPondAt, pondsNear, pondEdge, distantRise, farmGate, POND_SPACING, plainsBaseHeight } from '../src/world/plains-route.js';
import { PlainsWorld, PlainsChunk } from '../src/world/plains.js';
import { plainsDiscoveries, plainsDiscoveryClears } from '../src/world/plains-discoveries.js';
import { CoastalWorld } from '../src/world/environment.js';
import { DrivingController } from '../src/vehicle.js';

test('concrete bridge decks stay below the paved road through slopes and chunk seams', () => {
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  let checked = 0;
  for (let index = -4; index <= 4; index++) {
    const bridge = plainsCreekAt(420 + index * CREEK_SPACING);
    for (let ci = Math.floor(bridge.start / 128); ci <= Math.floor(bridge.end / 128); ci++) {
      const chunk = new PlainsChunk(ci);
      try {
        chunk.group.updateMatrixWorld(true);
        const road = chunk.group.getObjectByName('plains-road');
        const concrete = chunk.group.children.filter(mesh => ['creek-bridge', 'creek-bridge-deck'].includes(mesh.name));
        for (let s = Math.max(chunk.start, bridge.start) + .3; s < Math.min(chunk.start + 128, bridge.end); s += .7) {
          for (const u of [-5, 0, 5]) {
            const point = chunk.ground(s, u);
            ray.ray.origin.set(point.x, 100, point.z);
            const pavement = ray.intersectObject(road, false)[0], support = ray.intersectObjects(concrete, false)[0];
            assert.ok(pavement && support, 'the bridge needs a continuous road and deck');
            assert.ok(pavement.point.y - support.point.y > .03, `concrete stripes through road at ${s}, ${u}`);
            checked++;
          }
        }
      } finally { chunk.dispose(); }
    }
  }
  assert.ok(checked > 800);
});

test('plains terrain stays ordered, continuous, flat under the road and below the camera line of sight', () => {
  for (let col = 1; col < PLAINS_COLUMN_COUNT; col++) assert.ok(PLAINS_COLUMNS[col] > PLAINS_COLUMNS[col - 1]);
  for (let s = -10000; s < 10000; s += 13) {
    for (const u of [-7, 0, 7]) assert.equal(plainsHeight(s, u), plainsRoadHeight(s));
    // The near side eases down toward the camera; nothing there may rise into the line of sight to the road.
    for (const u of [-30, -60, -110, -180, -260, -400]) assert.ok(plainsGroundHeight(s, u) - plainsRoadHeight(s) < -u * .55, `near side blocks the road at ${s}, ${u}`);
    for (const u of [-300, -90, -30, -10.8, 9, 30, 90, 300, 520]) assert.ok(Math.abs(plainsGroundHeight(s + .001, u) - plainsGroundHeight(s - .001, u)) < .05, `height jump at ${s}, ${u}`);
    // A drainage ditch runs beside the road on both sides, except where the creek channel cuts through it.
    if (Math.abs(s - plainsCreekAt(s).center) > 40) for (const side of [-1, 1]) assert.ok(plainsGroundHeight(s, side * 10.8) < plainsRoadHeight(s) - .4 && plainsGroundHeight(s, side * 10.8) > plainsRoadHeight(s) - 1.6);
    // The far rises close the horizon in the third-person view, and only there.
    assert.equal(distantRise(s, 250), 0);
  }
  for (let chunk = -20; chunk < 40; chunk++) {
    const rows = CHUNK_LENGTH / PLAINS_STEP;
    for (let col = 0; col < PLAINS_COLUMN_COUNT; col++) assert.deepEqual(plainsVertex(chunk * rows, col), plainsVertex((chunk - 1) * rows + rows, col));
    // Row refinement around a creek must land back on whole rows by the next chunk.
    let row = chunk * rows, steps = 0;
    while (row < (chunk + 1) * rows) { row += plainsRowStep(row); steps++; }
    assert.equal(row, (chunk + 1) * rows); assert.ok(steps >= rows && steps <= rows * 2);
  }
  for (const s of [-10000, -1024, 0, 256, 10000]) {
    const heights = Array.from({ length: 20 }, (_, i) => distantRise(s, 300 + i * 15));
    assert.ok(Math.max(...heights) > 14);
  }
});

test('distant rolling hills have rounded crests and continuous slopes across districts', () => {
  let low = Infinity, high = -Infinity;
  // A one-metre cross-section catches sharp pyramid crests and the creases
  // caused by selecting the tallest of two overlapping hills.
  for (let s = -5000; s <= 5000; s += 11) for (let u = 260; u <= 568; u += 13) {
    const height = distantRise(s, u);
    assert.ok(Number.isFinite(height) && height >= 0 && height < 90);
    if (u > 380 && u < 470) { low = Math.min(low, height); high = Math.max(high, height); }
    for (const [ds, du] of [[1, 0], [0, 1]]) {
      const before = distantRise(s - ds, u - du), after = distantRise(s + ds, u + du);
      assert.ok(Math.abs(after - 2 * height + before) < .08, `sharp crest at ${s}, ${u}`);
      assert.ok(Math.abs(after - before) / 2 < 1.1, `cliff in a rolling hill at ${s}, ${u}`);
    }
  }
  assert.ok(high - low > 20, 'the skyline includes both crests and lower saddles');
});

test('the creek crosses under a bridge with a level channel, banks that hold the water, and a road that keeps its deck', () => {
  for (let index = -12; index <= 12; index++) {
    const creek = plainsCreekAt(420 + index * CREEK_SPACING);
    assert.equal(creek.index, index); assert.equal(creek.center, 420 + index * CREEK_SPACING);
    assert.ok(creek.level < plainsRoadHeight(creek.center) - 1.5);
    // Sampled the whole way along the creek, not at a handful of places: the
    // road runs over swells, and a bed cut to a fixed depth below the local
    // ground rose through the flat water wherever the channel wandered onto
    // a rising part of one, which a few spot checks stepped straight over.
    for (let u = -400; u <= 568; u += 4) {
      const center = creekCenterS(creek, u);
      assert.ok(Math.abs(center - creek.center) < 130, `the creek wanders too far at ${u}`);
      // Channel floor under the water, waterline inside the water ribbon, banks above it.
      assert.ok(plainsGroundHeight(center, u) < creek.level - .8, `dry channel at ${index}, ${u}`);
      for (const d of [-CREEK_WATER_HALF_WIDTH, CREEK_WATER_HALF_WIDTH]) assert.ok(plainsGroundHeight(center + d, u) < creek.level, `water ribbon edge floats at ${index}, ${u}`);
      for (const d of [-9, 9]) assert.ok(plainsGroundHeight(center + d, u) > creek.level + .3, `bank under water at ${index}, ${u}`);
    }
    // Driving sees the deck; the channel is only in the terrain.
    for (const s of [creekCenterS(creek, 0) - 3, creekCenterS(creek, 0), creekCenterS(creek, 0) + 3]) {
      assert.equal(plainsHeight(s, 0), plainsRoadHeight(s));
      assert.ok(plainsGroundHeight(s, 0) < creek.level);
      assert.deepEqual(plainsDrivingRoute.bounds(s), [-4.8, 4.8]);
    }
    assert.deepEqual(plainsDrivingRoute.bounds(creek.center + 80), [-11.5, 11.5]);
  }
  for (let s = -5000; s < 5000; s += 7) {
    // The creek keeps to its own crossing: no other point of the road is ever within reach of it.
    if (Math.abs(s - plainsCreekAt(s).center) > 40) assert.ok(creekDistance(s, 0) > 20);
  }
});

test('fields tile the plain as a stable patchwork whose boundaries follow the terrain facets', () => {
  for (let s = -6000; s < 6000; s += 5) {
    const row = fieldRowAt(s);
    assert.ok(s >= fieldBoundary(row) && s < fieldBoundary(row + 1), `wrong field row at ${s}`);
    assert.ok(fieldBoundary(row) % PLAINS_STEP === 0, 'row boundaries sit on terrain rows');
    for (const side of [-1, 1]) {
      const bands = fieldBands(row, side);
      assert.equal(bands[0], ROAD_RESERVE);
      for (let k = 1; k < bands.length; k++) {
        assert.ok(bands[k] > bands[k - 1] + 12, `bands too close in row ${row}`);
        assert.ok(PLAINS_COLUMNS.includes(bands[k]), 'band edges sit on terrain columns');
      }
      const field = fieldAt(s, side * 30);
      assert.equal(field.row, row); assert.equal(field.band, 0); assert.equal(field.side, side);
      assert.ok(['wheat', 'stubble', 'ploughed', 'pasture', 'hay'].includes(field.kind));
      assert.deepEqual(fieldAt(s, side * 30), field);
    }
    assert.equal(fieldAt(s, 5), null);
  }
  const kinds = new Set();
  for (let row = -40; row < 40; row++) for (const side of [-1, 1]) for (let band = 0; band < 4; band++) kinds.add(fieldAt(fieldBoundary(row) + 1, side * (fieldBands(row, side)[band] + 1)).kind);
  assert.equal(kinds.size, 5, 'a long drive shows every crop');
});

test('stock ponds are dug basins in the fields, clear of the road and the creek', () => {
  let count = 0;
  for (let index = -40; index < 40; index++) for (const side of [-1, 1]) {
    const pond = stockPondAt(index, side);
    if (!pond) continue;
    count++;
    assert.ok(Math.abs(pond.u) > 24 && Math.abs(pond.u) < 120, 'a pond lies in the near fields, clear of the ditch');
    // The bank, not just the water, keeps well clear of the creek: its
    // floodplain and its willows want the ground a pond's basin would take.
    assert.ok(creekDistance(pond.s, pond.u) - pond.radius * 1.7 > 35, `pond ${index} is dug into the creek's floodplain`);
    // A pond is built by the chunk it stands in, on that chunk's facets, so
    // the whole of it, bank included, keeps inside one chunk.
    const chunk = Math.floor(pond.s / CHUNK_LENGTH);
    let reach = 0;
    for (let i = 0; i < 48; i++) reach = Math.max(reach, pondEdge(pond, i / 48 * Math.PI * 2) * 1.4);
    assert.ok(pond.s - reach > chunk * CHUNK_LENGTH && pond.s + reach < (chunk + 1) * CHUNK_LENGTH, `pond ${index} straddles a chunk seam`);
    // Longer than it is wide: the reach along the long axis, taken over a
    // spread of angles so the lobes on the outline do not decide it, is
    // more than the reach across it.
    const span = axis => [-.5, -.25, 0, .25, .5].reduce((sum, off) => sum + pondEdge(pond, axis + off) + pondEdge(pond, axis + Math.PI + off), 0);
    assert.ok(span(pond.tilt) / span(pond.tilt + Math.PI / 2) > 1.08, `pond ${index} is a disc`);
    const { level } = pond;
    const groundAt = (angle, d) => {
      const reach = pondEdge(pond, angle) * d;
      return plainsGroundHeight(pond.s + Math.cos(angle) * reach, pond.u + Math.sin(angle) * reach);
    };
    let crest = -Infinity;
    for (let i = 0; i < 12; i++) {
      const angle = i / 12 * Math.PI * 2;
      // A flat floor well under the water, a steep bank up to just under the
      // waterline, a crest of spoil round the rim, and the field's own ground
      // again where the bank runs out.
      for (const d of [.3, .7]) assert.ok(groundAt(angle, d) < level - 1, `pond ${index} has no depth at ${d} of its edge`);
      assert.ok(groundAt(angle, .96) < level - .3, `pond ${index} shelves up to the water at ${angle.toFixed(2)}`);
      assert.ok(Math.abs(groundAt(angle, 1) - (level - .45)) < .03, `pond ${index} does not meet its waterline`);
      let bank = -Infinity;
      for (let d = 1.05; d <= 1.2; d += .01) bank = Math.max(bank, groundAt(angle, d));
      crest = Math.max(crest, bank - level);
      assert.ok(bank > level + .1, `pond ${index} has no bank at ${angle.toFixed(2)}`);
      const reach = pondEdge(pond, angle) * 1.4, s = pond.s + Math.cos(angle) * reach, u = pond.u + Math.sin(angle) * reach;
      assert.ok(Math.abs(plainsGroundHeight(s, u) - plainsBaseHeight(s, u, true)) < .01, `pond ${index} disturbs the field past its bank`);
    }
    assert.ok(crest > .35, `pond ${index} has no crest of spoil`);
    assert.ok(pondsNear(pond.s).some(other => other.s === pond.s && other.u === pond.u));
  }
  // Common enough to come upon on a drive, and not so common that the
  // pastures read as a chain of waterholes.
  const every = 80 * POND_SPACING / count;
  assert.ok(every > 380 && every < 720, `a stock pond every ${Math.round(every)} m`);
});

test('a pond stands on facets of its own, and the field never comes up through the water', () => {
  let built = 0;
  for (let index = 0; index < 60 && built < 6; index++) for (const side of [-1, 1]) {
    const pond = stockPondAt(index, side);
    if (!pond) continue;
    built++;
    const chunk = new PlainsChunk(Math.floor(pond.s / CHUNK_LENGTH));
    // The field facets under the water, as rendered, lie under it everywhere:
    // a facet twenty metres wide laid across the basin cut the corner and
    // came up through the water as a beach, so the cells a pond falls in are
    // cut finer, and the finer facets follow the bank.
    let top = -Infinity, reach = 0;
    for (let i = 0; i < 48; i++) reach = Math.max(reach, pondEdge(pond, i / 48 * Math.PI * 2) * 1.45);
    for (let i = 0; i < 48; i++) for (const d of [.2, .5, .8, .95, .98]) {
      const angle = i / 48 * Math.PI * 2, reach = pondEdge(pond, angle) * d;
      top = Math.max(top, chunk.ground(pond.s + Math.cos(angle) * reach, pond.u + Math.sin(angle) * reach).y - pond.level);
    }
    assert.ok(top < -.05, `pond ${index}: the field comes up to ${top.toFixed(2)} m of the water`);
    // The water is one level surface, and the bank rises above it to a crest.
    // The bank's toe can lie below the water on the low side, where the crest
    // is the dam that holds it, but never so far below as to be off the field.
    // A chunk can hold a pond on each side of the road; this pond's water is
    // the surface lying at its level.
    const waters = chunk.group.children.filter(mesh => mesh.name === 'stock-pond').map(mesh => mesh.geometry.attributes.position);
    const water = waters.find(w => Math.abs(w.getY(0) - pond.level) < 1e-3);
    assert.ok(water, `pond ${index} has no water at its level`);
    for (let i = 0; i < water.count; i++) assert.ok(Math.abs(water.getY(i) - pond.level) < 1e-3, 'the water lies level');
    // One chunk can hold a pond on each side of the road, and the far side of
    // the plain lies well below the near one, so only the bank round this
    // pond is measured against this pond's water.
    const bank = chunk.group.getObjectByName('pond-banks').geometry.attributes.position;
    const middle = chunk.ground(pond.s, pond.u);
    let high = -Infinity, low = Infinity;
    for (let i = 0; i < bank.count; i++) {
      if (Math.hypot(bank.getX(i) - middle.x, bank.getZ(i) - middle.z) > reach * 1.2) continue;
      high = Math.max(high, bank.getY(i)); low = Math.min(low, bank.getY(i));
    }
    assert.ok(high > pond.level + .3, `pond ${index}: the bank has no crest`);
    assert.ok(low > pond.level - 4, `pond ${index}: the bank falls off the field`);
    // The waterline is one line: the water's edge vertices are the bank's
    // innermost ring. The water is drawn in five triangles a step, three of
    // whose fifteen vertices lie on the edge, so a fifth of them are shared.
    const edge = new Set();
    for (let i = 0; i < bank.count; i++) edge.add(`${bank.getX(i).toFixed(3)},${bank.getZ(i).toFixed(3)}`);
    let shared = 0;
    for (let i = 0; i < water.count; i++) if (edge.has(`${water.getX(i).toFixed(3)},${water.getZ(i).toFixed(3)}`)) shared++;
    assert.equal(shared, water.count / 5, `pond ${index}: the waterline is not the bank's edge`);
    // The finer facets cost little: the terrain stays within its budget.
    assert.ok(chunk.group.getObjectByName('plains-fields').geometry.attributes.position.count / 3 < 4000, 'terrain stays within the shared budget');
  }
  assert.ok(built >= 4, 'several ponds were built');
});

test('plains driving stays grounded and a route swap restores the saved place', () => {
  const car = new DrivingController(plainsDrivingRoute);
  for (let i = 0; i < 7200; i++) {
    car.update(1 / 60, { forward: true });
    assert.ok(Math.abs(car.u) < 4.9);
    assert.ok(Math.abs(car.car.position.y - plainsHeight(car.s, car.u) - .13) < .0001);
  }
  assert.ok(car.distance > 3000);
  for (const side of ['left', 'right']) {
    const wanderer = new DrivingController(plainsDrivingRoute);
    for (let i = 0; i < 3600; i++) {
      wanderer.update(1 / 60, { forward: true, [side]: true });
      assert.ok(Math.abs(wanderer.u) <= 11.5001 && Number.isFinite(wanderer.car.position.y));
    }
  }
  const saved = { s: car.s, distance: car.distance };
  car.setRoute(plainsDrivingRoute, saved);
  assert.equal(car.s, saved.s); assert.equal(car.distance, saved.distance); assert.equal(car.speed, 0);
});

test('plains scenery stands on the rendered facets and the world streams and releases cleanly', () => {
  const scene = new THREE.Scene(), world = new PlainsWorld(scene);
  world.update(420); scene.updateMatrixWorld(true);
  const ground = [...world.chunks.values()].map(chunk => chunk.group.getObjectByName('plains-fields'));
  const ray = new THREE.Raycaster();
  for (const chunk of world.chunks.values()) {
    // A tree or a bale on a chunk's seam stands on the neighbour's facets as
    // often as its own; the outermost chunks loaded have no neighbour beyond
    // them here, so only the chunks with both neighbours loaded are sampled.
    if (!world.chunks.has(chunk.index - 1) || !world.chunks.has(chunk.index + 1)) continue;
    for (const name of ['fence-posts', 'hay-bales', 'plains-trunks', 'utility-poles']) {
      chunk.group.traverse(object => {
        if (object.name !== name || !object.isInstancedMesh) return;
        const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
        for (let i = 0; i < Math.min(object.count, 12); i++) {
          object.getMatrixAt(i, matrix); position.setFromMatrixPosition(matrix); position.z += chunk.group.position.z;
          ray.set(new THREE.Vector3(position.x, position.y + 60, position.z), new THREE.Vector3(0, -1, 0));
          const hit = ray.intersectObjects(ground, false)[0];
          assert.ok(hit, `${name} off the terrain`);
          // Trunks are sunk a little so no root shows on a creek bank's steeper facets.
          assert.ok(position.y - hit.point.y > (name === 'plains-trunks' ? -.6 : -.2) && position.y - hit.point.y < 6, `${name} floats or sinks: ${position.y - hit.point.y}`);
        }
      });
    }
  }
  assert.ok([...world.chunks.values()].some(chunk => chunk.group.getObjectByName('creek-water')), 'the creek is built');
  assert.ok([...world.chunks.values()].some(chunk => chunk.group.getObjectByName('creek-bridge')), 'the bridge is built');
  // The shader draws furrows and headlands from a per-vertex attribute: every
  // terrain vertex carries one, and the worked fields carry rows while the
  // road reserve and the pastures do not.
  for (const mesh of ground) {
    const furrow = mesh.geometry.attributes.furrow;
    assert.equal(furrow.count, mesh.geometry.attributes.position.count);
    let worked = 0, flat = 0;
    for (let i = 0; i < furrow.count; i++) {
      assert.ok(Number.isFinite(furrow.getX(i)) && furrow.getY(i) >= 0 && furrow.getY(i) < .3 && furrow.getZ(i) >= 0);
      if (furrow.getY(i) > 0) worked++; else flat++;
    }
    assert.ok(worked > 0 && flat > 0, 'a chunk has both worked fields and unworked ground');
  }
  // Both fringes are present across the drive, throw no shadow, and stay out
  // of the ambient occlusion prepass.
  const fringes = { 'grass-fringe': 0, 'wheat-fringe': 0 };
  for (const chunk of world.chunks.values()) {
    let stalks = 0;
    chunk.group.traverse(object => {
      if (!(object.name in fringes)) return;
      fringes[object.name] += object.count; stalks += object.count;
      assert.equal(object.castShadow, false); assert.equal(object.userData.ambientOcclusion, false);
    });
    assert.ok(stalks > 20, 'stalks fringe the fields');
  }
  assert.ok(fringes['grass-fringe'] > 20 && fringes['wheat-fringe'] > 20, 'the green fields and the grain fields each grow their own fringe');
  let disposed = 0;
  for (const chunk of world.chunks.values()) for (const source of chunk.owned) source.addEventListener('dispose', () => disposed++);
  for (const s of [250, 1025, 9000, -300]) {
    world.update(s); assert.equal(world.chunks.size, 9); assert.equal(scene.children.length, 9);
    assert.ok(Math.abs(-s + world.origin) <= 1024);
  }
  world.dispose(); assert.equal(scene.children.length, 0); assert.ok(disposed > 30);
  for (const World of [CoastalWorld, PlainsWorld]) { const other = new World(scene); other.update(24); other.dispose(); }
  assert.equal(scene.children.length, 0);
  const chunk = new PlainsChunk(3);
  assert.ok(chunk.group.getObjectByName('plains-fields').geometry.attributes.position.count / 3 < 4000, 'terrain stays within the shared budget');
  chunk.dispose();
});

test('trees retain their green palette in fields before the world origin', () => {
  let checked = 0;
  for (const index of [-4, -3, -2, -1]) {
    const chunk = new PlainsChunk(index);
    try {
      chunk.group.traverse(mesh => {
        if (mesh.name !== 'plains-crowns') return;
        assert.ok(mesh.instanceColor, 'every crown has a foliage tint');
        const color = new THREE.Color();
        for (let i = 0; i < mesh.count; i++) {
          mesh.getColorAt(i, color);
          assert.ok(color.g > color.r && color.g > color.b, `untinted tree in chunk ${index}`);
          checked++;
        }
      });
    } finally { chunk.dispose(); }
  }
  assert.ok(checked > 40);
});

test('the cow wears its patches proud of its hide, so no two faces flicker against each other', async () => {
  const { cowGeometry } = await import('../src/world/plains-assets.js');
  // Two faces of different colours on one plane have no stable depth order,
  // so the renderer picks between them per pixel and per frame: the cow's
  // back patch once ended exactly level with its back and blinked there.
  const position = cowGeometry.attributes.position, color = cowGeometry.attributes.color, count = position.count / 3;
  const corners = i => [0, 1, 2].map(k => [position.getX(i * 3 + k), position.getY(i * 3 + k), position.getZ(i * 3 + k)]);
  const plane = triangle => {
    const [a, b, c] = triangle, u = b.map((v, k) => v - a[k]), v = c.map((w, k) => w - a[k]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(...n), unit = n.map(value => value / length);
    return { unit, offset: unit.reduce((sum, value, k) => sum + value * a[k], 0) };
  };
  const span = (triangle, k) => [Math.min(...triangle.map(p => p[k])), Math.max(...triangle.map(p => p[k]))];
  const triangles = Array.from({ length: count }, (_, i) => corners(i));
  const shades = Array.from({ length: count }, (_, i) => color.getX(i * 3));
  for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
    if (Math.abs(shades[i] - shades[j]) < 1e-6) continue;
    const a = plane(triangles[i]), b = plane(triangles[j]);
    const dot = a.unit.reduce((sum, value, k) => sum + value * b.unit[k], 0);
    if (Math.abs(Math.abs(dot) - 1) > 1e-6) continue;
    if (Math.abs(a.offset - (dot > 0 ? b.offset : -b.offset)) > 1e-6) continue;
    const axis = a.unit.map(Math.abs).indexOf(Math.max(...a.unit.map(Math.abs)));
    const overlap = [0, 1, 2].filter(k => k !== axis).every(k => {
      const [low, high] = span(triangles[i], k), [start, end] = span(triangles[j], k);
      return low < end - 1e-4 && start < high - 1e-4;
    });
    assert.ok(!overlap, `two differently shaded faces share a plane on ${'xyz'[axis]} at ${a.offset.toFixed(3)}`);
  }
});

test('no two fence posts stand in the same spot, where their faces would flicker', () => {
  const scene = new THREE.Scene(), world = new PlainsWorld(scene);
  let checked = 0;
  for (const s of [420, 3960, 9102, 21692]) {
    world.update(s);
    for (const chunk of world.chunks.values()) {
      const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), seen = new Set();
      chunk.group.traverse(object => {
        if (object.name !== 'fence-posts' || !object.isInstancedMesh) return;
        for (let i = 0; i < object.count; i++) {
          object.getMatrixAt(i, matrix);
          position.setFromMatrixPosition(matrix); scale.setFromMatrixScale(matrix);
          const key = `${position.x.toFixed(2)},${position.y.toFixed(2)},${position.z.toFixed(2)}/${scale.y.toFixed(2)}`;
          assert.ok(!seen.has(key), `two posts share ${key} in chunk ${chunk.index}`);
          seen.add(key); checked++;
        }
      });
    }
  }
  world.dispose();
  assert.ok(checked > 400, 'the drive must actually carry fences to check');
});

test('a gabled building is closed from both ends, not open from one of them', async () => {
  const { plainsDiscoveryAssets, plainsDiscoveryMaterial } = await import('../src/world/plains-discovery-assets.js');
  // The two ends of a roof have to be wound to face out of the building.
  // Wound the same way round, one of them is a back face, the renderer culls
  // it, and the roof stands over a gable you see the far wall through.
  const ends = { barn: 6, farmhouse: 4.8, shed: 3.9, grainElevator: 6.4 };
  for (const [name, height] of Object.entries(ends)) {
    const mesh = new THREE.Mesh(plainsDiscoveryAssets[name], plainsDiscoveryMaterial);
    mesh.updateMatrixWorld();
    for (const from of [-60, 60]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(0, height, from), new THREE.Vector3(0, 0, from > 0 ? -1 : 1));
      assert.ok(ray.intersectObject(mesh, false).length > 0, `${name} has no wall facing z=${from} at ${height}`);
    }
  }
});

test('every plains asset is built from real geometry, so no part is silently missing', async () => {
  const { plainsDiscoveryAssets } = await import('../src/world/plains-discovery-assets.js');
  const { plainsTrees, baleGeometry, squareBaleGeometry, cowGeometry, rushGeometry, stalkGeometry, wheatGeometry, crowGeometry } = await import('../src/world/plains-assets.js');
  // A colour passed where a segment count belongs yields an empty geometry that
  // merges away without complaint, which is how the turbines lost their towers.
  const expected = { barn: 400, silo: 900, farmhouse: 400, windmillTower: 900, windmillRotor: 600,
    tractor: 400, grainElevator: 1500, turbineTower: 200, turbineRotor: 300, shed: 200, box: 24 };
  for (const [name, geometry] of Object.entries(plainsDiscoveryAssets)) {
    const count = geometry.attributes.position.count;
    assert.ok(count >= expected[name], `${name} has ${count} vertices, expected at least ${expected[name]}`);
    for (let i = 0; i < count * 3; i++) assert.ok(Number.isFinite(geometry.attributes.position.array[i]), `${name} has a non-finite vertex`);
  }
  // The tower must be tall enough to carry its own nacelle, and the nacelle must
  // sit at the top of it rather than in the air.
  const tower = plainsDiscoveryAssets.turbineTower;
  tower.computeBoundingBox();
  assert.ok(tower.boundingBox.max.y > 38 && tower.boundingBox.min.y < .6, 'the turbine tower must reach the ground and the hub');
  let lowest = Infinity;
  for (let i = 1; i < tower.attributes.position.count * 3; i += 3) lowest = Math.min(lowest, tower.attributes.position.array[i]);
  assert.ok(lowest < .6, 'the turbine tower must stand on the ground');
  for (const list of Object.values(plainsTrees)) for (const variant of list) {
    // Trunk limbs overlap at their joints, so the bark is one connected solid.
    // A conifer is a single bare stem, so the floor is one closed cylinder.
    assert.ok(variant.bark.attributes.position.count >= 30, 'a tree needs a trunk');
    variant.bark.computeBoundingBox(); variant.leaves.computeBoundingBox();
    assert.ok(variant.bark.boundingBox.min.y < -.05, 'the trunk must reach below the ground it stands on');
    assert.ok(variant.bark.boundingBox.max.y > variant.leaves.boundingBox.min.y, 'the trunk must reach into its crown');
    // Every crown vertex carries a finite baked shade: a bake that read past
    // the end of an indexed tier once left whole faces black.
    const colors = variant.leaves.attributes.color;
    assert.equal(colors.count, variant.leaves.attributes.position.count, 'one colour per crown vertex');
    for (let i = 0; i < colors.array.length; i++) assert.ok(Number.isFinite(colors.array[i]) && colors.array[i] > .4, `crown colour ${i} is ${colors.array[i]}`);
  }
  for (const geometry of [baleGeometry, squareBaleGeometry, cowGeometry, rushGeometry, stalkGeometry, wheatGeometry, crowGeometry]) assert.ok(geometry.attributes.position.count > 12);
  // Wheat carries its pale ear in its vertex colours, which a per-instance
  // gold multiplies; without them every stalk would be one flat tone.
  const grain = wheatGeometry.attributes.color;
  assert.equal(grain.count, wheatGeometry.attributes.position.count);
  const shades = new Set(); for (let i = 0; i < grain.count; i++) shades.add(grain.getX(i).toFixed(3));
  assert.ok(shades.size >= 2, 'the ear must be a different tone from the straw');
});

test('a farmyard wears an outline with no straight run in it, and fades into the field it stands in', () => {
  // The first chunk whose bare earth is one compact patch: a farm's yard
  // rather than a track running across the fields.
  let yard = null;
  for (let index = 0; index < 120 && !yard; index++) {
    const chunk = new PlainsChunk(index), mesh = chunk.group.getObjectByName('farm-tracks');
    const dirt = mesh && mesh.geometry.attributes, points = [];
    for (let i = 0; dirt && i < dirt.position.count; i++) {
      points.push({ x: dirt.position.getX(i), z: dirt.position.getZ(i), color: [dirt.color.getX(i), dirt.color.getY(i), dirt.color.getZ(i)] });
    }
    const centre = k => points.reduce((sum, p) => sum + p[k], 0) / points.length;
    if (points.length) {
      const x = centre('x'), z = centre('z');
      if (points.every(p => Math.hypot(p.x - x, p.z - z) < 22)) yard = { chunk, points, x, z };
    }
    if (!yard) chunk.dispose();
  }
  assert.ok(yard, 'no farmyard in the first fifteen kilometres');
  // Walk the patch's boundary: the edges that belong to one triangle only.
  const key = p => `${Math.round(p.x * 100)},${Math.round(p.z * 100)}`, spot = new Map(), edges = new Map(), neighbours = new Map();
  for (const p of yard.points) if (!spot.has(key(p))) spot.set(key(p), p);
  for (let i = 0; i < yard.points.length; i += 3) for (let k = 0; k < 3; k++) {
    const a = key(yard.points[i + k]), b = key(yard.points[i + (k + 1) % 3]), id = a < b ? `${a}|${b}` : `${b}|${a}`;
    edges.set(id, (edges.get(id) ?? 0) + 1);
  }
  for (const [id, count] of edges) {
    if (count !== 1) continue;
    for (const [a, b] of [id.split('|'), id.split('|').reverse()]) neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
  }
  assert.ok(neighbours.size > 12, 'the yard needs an outline to test');
  for (const [, ends] of neighbours) assert.equal(ends.length, 2, 'the outline must be one closed loop');
  const loop = [[...neighbours.keys()][0]];
  for (let previous = null, at = loop[0]; ;) {
    const step = neighbours.get(at).find(other => other !== previous);
    if (step === loop[0]) break;
    loop.push(step); previous = at; at = step;
  }
  assert.equal(loop.length, neighbours.size, 'the outline must close on itself');
  const ring = loop.map(id => spot.get(id));
  // A yard worn by the traffic round it turns at nearly every step. The
  // bare rectangle this replaced ran straight down four long sides.
  const straight = ring.filter((p, i) => {
    const a = ring[(i + ring.length - 1) % ring.length], c = ring[(i + 1) % ring.length];
    const turn = Math.atan2(c.z - p.z, c.x - p.x) - Math.atan2(p.z - a.z, p.x - a.x);
    return Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) < .035;
  }).length;
  assert.ok(straight * 3 < ring.length, `${straight} of ${ring.length} steps round the yard run straight on`);
  // The rim is drawn in the crop's own colour, so the yard has no edge to
  // see; the middle of it is a different earth altogether.
  const field = yard.chunk.group.getObjectByName('plains-fields').geometry.attributes;
  const beside = p => {
    let best = Infinity, color = null;
    for (let i = 0; i < field.position.count; i++) {
      const d = (field.position.getX(i) - p.x) ** 2 + (field.position.getZ(i) - p.z) ** 2;
      if (d < best) { best = d; color = [field.color.getX(i), field.color.getY(i), field.color.getZ(i)]; }
    }
    return color;
  };
  const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const middle = yard.points.reduce((best, p) =>
    Math.hypot(p.x - yard.x, p.z - yard.z) < Math.hypot(best.x - yard.x, best.z - yard.z) ? p : best);
  const mean = list => list.reduce((sum, value) => sum + value, 0) / list.length;
  const crops = ring.map(beside);
  const rim = mean(crops.map((crop, i) => gap(ring[i].color, crop))), core = mean(crops.map(crop => gap(middle.color, crop)));
  assert.ok(rim * 2 < core, `the rim stands ${rim.toFixed(2)} from the crop's colour and the middle of the yard only ${core.toFixed(2)}`);
  // And the ground between the two is neither: a yard laid in one flat tone
  // has an edge wherever it stops, however its outline runs.
  const tones = new Set(yard.points.map(p => p.color.map(value => value.toFixed(2)).join()));
  assert.ok(tones.size > 20, `the yard is laid in ${tones.size} tones`);
  yard.chunk.dispose();
});

test('most field gates are only gates, so a track worn out into a field and stopping is something to come upon', () => {
  const span = 200000, rows = [];
  for (let row = fieldRowAt(0); fieldBoundary(row) < span; row++) for (const side of [-1, 1]) {
    const gate = farmGate(row, side);
    if (gate) rows.push({ row, side, gate });
  }
  const worn = rows.filter(({ gate }) => gate.worn);
  // The roadside keeps its gates and its mailboxes; what became rare is the
  // bare earth running away from them into a field and petering out.
  assert.ok(span / rows.length < 700, `a field gate only every ${Math.round(span / rows.length)} m`);
  assert.ok(span / worn.length > 1100, `a track off the road every ${Math.round(span / worn.length)} m`);
  // And the chunk draws what the route decided: bare earth behind the gates
  // that are used, and none at all behind the gates that are not.
  const behind = ({ row, side, gate }) => {
    const chunk = new PlainsChunk(Math.floor(gate.s / CHUNK_LENGTH));
    const mesh = chunk.group.getObjectByName('farm-tracks'), found = [];
    const p = chunk.ground(gate.s, side * (ROAD_RESERVE + 8));
    for (let i = 0; mesh && i < mesh.geometry.attributes.position.count; i++) {
      const dirt = mesh.geometry.attributes.position;
      found.push(Math.hypot(dirt.getX(i) - p.x, dirt.getZ(i) - p.z));
    }
    chunk.dispose();
    return Math.min(...found, Infinity);
  };
  // Gates well clear of any compound, so nothing else can lay earth near them.
  const lone = list => list.filter(({ gate }) => Math.abs(gate.s) > 2000 && Math.abs(gate.s) < 60000
    && plainsDiscoveryClears(gate.s, gate.side * 30, plainsDiscoveries(gate.s - 400, gate.s + 400), 60)).slice(0, 6);
  for (const gate of lone(worn)) assert.ok(behind(gate) < 6, `no track behind a worn gate at ${gate.gate.s}`);
  for (const gate of lone(rows.filter(({ gate }) => !gate.worn))) assert.ok(behind(gate) > 12, `a track behind a gate that has none at ${gate.gate.s}`);
  assert.ok(worn.length > rows.length * .2, 'some gates must still be driven through');
});

test('a worn track runs as far as it likes, keeps its ruts clear, and some of them end at a shed', () => {
  const span = 200000, worn = [];
  for (let row = fieldRowAt(0); fieldBoundary(row) < span; row++) for (const side of [-1, 1]) {
    const gate = farmGate(row, side);
    if (gate?.worn) worn.push({ row, side, gate });
  }
  // The first field boundary is as short as a track ever was, and stays the
  // shortest one there is; past that they run as far as they please.
  for (const { row, side, gate } of worn) {
    assert.ok(gate.reach >= fieldBands(row, side)[1] - 6.01, `a track stops short of the first boundary at ${gate.s}`);
  }
  const reaches = worn.map(({ gate }) => gate.reach);
  assert.ok(reaches.filter(reach => reach > 150).length > worn.length * .15, 'some tracks cross more than one field');
  assert.ok(Math.max(...reaches) > 300, 'and one now and then runs right out past the view');
  assert.ok(worn.filter(({ gate }) => gate.shed).length > worn.length * .25, 'some tracks are how a farm reaches a shed');
  // Nothing is planted in the ruts: a boundary fence, a hedge or a line of
  // trees that meets a track stops either side of it.
  const drive = worn.find(({ gate }) => gate.shed && gate.reach > 55), { gate, side } = drive;
  const chunk = new PlainsChunk(Math.floor(gate.s / CHUNK_LENGTH));
  const ruts = [];
  for (let cross = 20; cross < gate.reach - 14; cross += 3) ruts.push(chunk.ground(gate.s, side * cross));
  assert.ok(ruts.length > 4, 'not enough track to test');
  const matrix = new THREE.Matrix4(), stood = new THREE.Vector3();
  chunk.group.traverse(object => {
    // The shed at the end of the track and what belongs to it stand on it by design.
    if (!object.isInstancedMesh || object.name === 'field-sheds' || object.name === 'water-tanks') return;
    for (let i = 0; i < object.count; i++) {
      object.getMatrixAt(i, matrix); stood.setFromMatrixPosition(matrix);
      for (const rut of ruts) {
        assert.ok(Math.hypot(stood.x - rut.x, stood.z - rut.z) > 1.6, `${object.name} stands in the ruts at ${Math.round(gate.s)}`);
      }
    }
  });
  // And where a shed stands at the end of one, the track and the shed's yard
  // are the one piece of bare earth, as a farm's drive and its yard are.
  const dirt = chunk.group.getObjectByName('farm-tracks').geometry.attributes.position;
  const parent = [], root = t => parent[t] === t ? t : (parent[t] = root(parent[t]));
  const seen = new Map(), middle = [];
  for (let t = 0; t * 3 < dirt.count; t++) {
    parent[t] = t;
    let x = 0, z = 0;
    for (let k = 0; k < 3; k++) {
      const i = t * 3 + k, key = `${Math.round(dirt.getX(i) * 100)},${Math.round(dirt.getZ(i) * 100)}`;
      x += dirt.getX(i) / 3; z += dirt.getZ(i) / 3;
      if (seen.has(key)) parent[root(t)] = root(seen.get(key)); else seen.set(key, t);
    }
    middle.push([x, z]);
  }
  const nearest = (s, u) => {
    const p = chunk.ground(s, u), gap = t => Math.hypot(middle[t][0] - p.x, middle[t][1] - p.z);
    const best = middle.reduce((found, _, t) => gap(t) < gap(found) ? t : found, 0);
    assert.ok(gap(best) < 4, `no bare earth at ${Math.round(s)}, ${Math.round(u)}`);
    return best;
  };
  assert.equal(root(nearest(gate.s, side * 20)), root(nearest(gate.s, side * gate.reach)),
    'the track stops short of the shed it runs to');
  chunk.dispose();
});
