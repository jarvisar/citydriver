import * as THREE from 'three';
import { CHUNK_LENGTH, roadFrame, randomAt } from './route.js';
import { buildPlainsRailway } from './plains-railway.js';
import { solidModel } from './colliders.js';
import { plainsDiscoveryAssets as assets, plainsDiscoveryMaterial as material, plainsFoundationMaterial, plainsWindmillMaterial, plainsTurbineMaterial } from './plains-discovery-assets.js';

const transform = new THREE.Object3D();

// Three arrangements of the one farm, as offsets along the road and away
// from it, so a second farmstead down the road does not read as the first one
// stamped again. The house keeps the road frontage and the machine shed the
// back of the yard in all of them; what moves is which end of the yard each
// building takes, and whether the barn stands across the yard from the house
// or square in the middle of it with the silo beside it.
const FARM_LAYOUTS = [
  { barn: [-9, 5], silo: [-23, 5], house: [13, -8], mill: [20, 12], shed: [1, 16], tractor: [4, 5] },
  { barn: [9, 5], silo: [23, 5], house: [-13, -8], mill: [-20, 12], shed: [-2, 16], tractor: [-5, 5] },
  { barn: [-3, 7], silo: [-17, 9], house: [15, -8], mill: [-21, -7], shed: [14, 14], tractor: [3, -4] },
];
const HOUSE_LAYOUT = { house: [0, 1] };
const BARN_LAYOUT = { barn: [-5, 3], silo: [10, 5], tractor: [10, -6] };
// The yard's trees stand outside its fence, so no arrangement of the
// buildings puts a crown through a roof: a conifer windbreak along the back
// and the two ends, where a farm plants its shelter, and oaks out on the
// corners of the road frontage.
const FARM_TREES = [
  ['conifer', -18, 22, 10], ['conifer', -7, 23, 8.5], ['conifer', 6, 22, 9], ['conifer', 17, 23, 9.5],
  ['conifer', -30, 9, 9], ['conifer', 29, 6, 8.5],
  ['oak', -29, -13, 10], ['oak', 28, -14, 8.5], ['oak', -9, -21, 10.5],
];

export function buildPlainsDiscoveries(chunk, discoveries) {
  const batches = new Map(), inChunk = s => s >= chunk.start && s < chunk.start + CHUNK_LENGTH;
  const point = (s, u, height) => {
    const p = chunk.ground(s, u);
    return [p.x, height ?? p.y, p.z];
  };
  function add(name, geometry, paint, p, rotation = [0, 0, 0], scale = [1, 1, 1]) {
    if (!batches.has(name)) batches.set(name, { geometry, paint, items: [] });
    batches.get(name).items.push({ p, rotation, scale });
  }
  // A building or a machine: drawn like the rest, and it stops the car.
  function solid(name, geometry, p, rotation, scale = [1, 1, 1], round = false) {
    add(name, geometry, material, p, rotation, scale);
    solidModel(chunk, geometry, p, rotation[1], scale[0], round);
  }
  // A footing spans the ground's highs and lows, so buildings stand level on
  // a plain that still rolls a little.
  function foundation(s, u, halfU, halfS, angle) {
    const samples = [-halfS, 0, halfS].flatMap(ds => [-halfU, 0, halfU].map(du => chunk.ground(s + ds, u + du).y));
    const low = Math.min(...samples) - .35, high = Math.max(...samples) + .05;
    add('plains-discovery-footings', assets.box, plainsFoundationMaterial, point(s, u, (low + high) / 2), [0, angle, 0], [halfU * 2, high - low, halfS * 2]);
    return high;
  }
  // Rotate a local offset into world space around a placement's yaw.
  const offset = (root, angle, x, y, z) => {
    const v = new THREE.Vector3(x, y, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    return [root[0] + v.x, root[1] + v.y, root[2] + v.z];
  };
  for (const site of discoveries) {
    const { s, u, side, kind } = site;
    if (kind === 'grain-elevator') buildPlainsRailway(chunk, site);
    if (kind === 'wind-turbines') {
      for (const [k, tower] of site.towers.entries()) {
        if (!inChunk(tower.s)) continue;
        // Rotors face roughly along the road, into the prevailing wind, so the
        // fixed camera sees the blades sweep rather than a thin disc edge-on.
        const yaw = -roadFrame(tower.s).angle + (randomAt(site.index, 2931 + k) - .5) * .9;
        const ground = foundation(tower.s, tower.u, 2.2, 2.2, yaw);
        const root = point(tower.s, tower.u, ground);
        solid('plains-wind-turbines', assets.turbineTower, root, [0, yaw, 0], undefined, true);
        add('plains-turbine-rotors', assets.turbineRotor, plainsTurbineMaterial, offset(root, yaw, 0, 38.6, -3.3), [0, yaw, 0]);
      }
      if (inChunk(s)) chunk.features.discoveries.push({ ...site });
      continue;
    }
    if (!inChunk(s)) continue;
    // Compounds face the road across their drive.
    const angle = -roadFrame(s).angle + (side < 0 ? 0 : Math.PI);
    const local = (ds, du) => [s + ds, u + du * side];
    // The drive runs from the highway to the gate, and the yard's own earth
    // opens out to meet it there, so a farm is reached over one piece of
    // ground rather than over a track that stops short of a fence.
    const farm = ['farmstead', 'farmhouse', 'barn-silo'].includes(kind);
    const drive = chunk.track(s + site.drive, side, Math.abs(u) - site.halfU + (farm ? 4 : 2), 5.8, true);
    let ground;
    if (farm) {
      chunk.dirtPatch(s, u, site.halfS - 5, site.halfU - 4, drive);
      const layout = kind === 'farmhouse' ? HOUSE_LAYOUT : kind === 'barn-silo' ? BARN_LAYOUT
        : FARM_LAYOUTS[Math.floor(randomAt(site.index, 2938) * FARM_LAYOUTS.length)];
      // No farm sets its buildings out on a drawing board. Each stands a pace
      // off where the plan puts it and a few degrees off square with the rest,
      // which is most of what keeps a yard from reading as a stamped copy.
      const stand = (name, k) => {
        const [ds, du] = layout[name], shift = salt => (randomAt(site.index, salt + k) - .5) * 1.2;
        const [standS, standU] = local(ds + shift(2940), du + shift(2950));
        return { s: standS, u: standU, yaw: angle + (randomAt(site.index, 2960 + k) - .5) * .22 };
      };
      // Buildings are drawn well over life size, as the miniature style does
      // with the cabins and the lighthouse, so a barn holds its own against
      // the trees round it and reads from the road.
      const big = [1.4, 1.4, 1.4];
      if (layout.barn) {
        const barn = stand('barn', 0);
        ground = foundation(barn.s, barn.u, 5.8, 9.2, barn.yaw);
        solid('plains-barns', assets.barn, point(barn.s, barn.u, ground), [0, barn.yaw + Math.PI, 0], big);
        const silo = stand('silo', 1);
        const siloGround = foundation(silo.s, silo.u, 3.5, 3.5, silo.yaw);
        solid('plains-silos', assets.silo, point(silo.s, silo.u, siloGround), [0, silo.yaw, 0], big, true);
        // Feed and tools sit beside the silo, away from the working doorway.
        for (let k = 0; k < 3; k++) {
          const [bs, bu] = local(layout.silo[0] - 2 + k * 2, layout.silo[1] + 5);
          chunk.scenery.painted.push({ p: point(bs, bu, chunk.ground(bs, bu).y + .65), scale: [1.7, 1.3, 2.2], r: [0, angle, 0], color: '#c1a25b' });
        }
      }
      if (layout.house) {
        const house = stand('house', 2);
        const houseGround = foundation(house.s, house.u - side * 1.6, 6.6, 6.2, house.yaw);
        ground ??= houseGround;
        solid('plains-farmhouses', assets.farmhouse, point(house.s, house.u, houseGround), [0, house.yaw + Math.PI, 0], big);
        // A small kitchen garden beside the house, with timber-edged beds.
        for (let k = 0; k < 3; k++) {
          const [gs, gu] = local(layout.house[0] + (layout.house[0] < 0 ? -1 : 1) * 9, layout.house[1] - 3 + k * 2.5);
          const bed = chunk.ground(gs, gu);
          chunk.scenery.painted.push({ p: [bed.x, bed.y + .18, bed.z], scale: [1.8, .36, 3.8], r: [0, angle, 0], color: '#786044' });
          chunk.scenery.painted.push({ p: [bed.x, bed.y + .42, bed.z], scale: [1.35, .35, 3.3], r: [0, angle, 0], color: k % 2 ? '#6e8545' : '#56733c' });
        }
      }
      if (layout.mill) {
        const mill = stand('mill', 3);
        const millGround = foundation(mill.s, mill.u, 1.4, 1.4, mill.yaw);
        const millRoot = point(mill.s, mill.u, millGround), millYaw = angle + (randomAt(site.index, 2932) - .5) * 1.2;
        solid('plains-windmill-towers', assets.windmillTower, millRoot, [0, millYaw, 0]);
        add('plains-windmill-rotors', assets.windmillRotor, plainsWindmillMaterial, offset(millRoot, millYaw, 0, 8.65, -.55), [0, millYaw, 0]);
      }
      if (layout.tractor) {
        const tractor = stand('tractor', 4);
        solid('plains-tractors', assets.tractor, point(tractor.s, tractor.u), [0, angle + .5 + randomAt(site.index, 2933) * .6, 0]);
      }
      // Oaks on the road frontage, and conifers to shelter the yard the way a
      // farm's windbreak does.
      const trees = kind === 'farmstead' ? FARM_TREES : [
        ['oak', -site.halfS + 2, -7, 8], ['oak', site.halfS - 2, -8, 7.5],
        ['conifer', -10, site.halfU + 1, 8], ['conifer', 2, site.halfU + 2, 9], ['conifer', 13, site.halfU + 1, 8],
      ];
      for (const [species, ds, du, height] of trees) {
        const drift = salt => (randomAt(site.index, salt + ds) - .5) * 3;
        const [treeS, treeU] = local(ds + drift(2970), du + drift(2990));
        const greens = species === 'oak' ? ['#4d7434', '#587f3a', '#43682e'] : ['#4c7c3e', '#427037', '#558544'];
        chunk.tree(species, treeS, treeU, height, greens[Math.abs(ds) % 3], randomAt(site.index, 3010 + ds) * 6.28);
      }
      // A machine shed at the back, and a fence round the yard with its gate
      // where the drive comes in.
      if (layout.shed) {
        const shed = stand('shed', 5);
        const shedGround = foundation(shed.s, shed.u, 3, 4.2, shed.yaw);
        solid('plains-farm-sheds', assets.shed, point(shed.s, shed.u, shedGround), [0, shed.yaw, 0]);
      }
      // A mailbox marks the entrance without narrowing the access road.
      const [mailS, mailU] = [s + site.drive + 4.5, side * 9];
      const mail = chunk.ground(mailS, mailU);
      chunk.scenery.painted.push({ p: [mail.x, mail.y + .7, mail.z], scale: [.18, 1.4, .18], r: [0, angle, 0], color: '#897258' });
      chunk.scenery.painted.push({ p: [mail.x, mail.y + 1.45, mail.z], scale: [.5, .4, .8], r: [0, angle, 0], color: '#535e60' });
      // Half the farms fence their yard and half leave it open, with the worn
      // earth the only boundary it has. Both are common enough in the country,
      // and a fence round every last one of them read as one design repeated.
      if (randomAt(site.index, 2939) > .5) {
        const yardS = site.halfS - 2, yardU = site.halfU - 3, ring = [];
        for (let ds = -yardS; ds <= yardS; ds += 4) ring.push([ds, -yardU]);
        for (let du = -yardU + 4; du < yardU; du += 4) ring.push([yardS, du]);
        for (let ds = yardS; ds >= -yardS; ds -= 4) ring.push([ds, yardU]);
        for (let du = yardU - 4; du > -yardU; du -= 4) ring.push([-yardS, du]);
        // Start just after the gate and walk around to just before it. Simply
        // filtering posts out of a closed ring joins rails across the opening.
        const gap = ([ds, du]) => du === -yardU && Math.abs(ds - site.drive) < 4.5;
        const firstGap = ring.findIndex(gap);
        const open = [...ring.slice(firstGap), ...ring.slice(0, firstGap)].filter(p => !gap(p));
        chunk.fence(open.map(([ds, du]) => ({ s: s + ds, u: u + du * side })), false);
      }
    } else {
      chunk.dirtPatch(s + 1, u, 15, 11, drive);
      ground = foundation(s, u, 5, 8, angle);
      solid('plains-grain-elevators', assets.grainElevator, point(s, u, ground), [0, angle + Math.PI / 2, 0], [1.25, 1.25, 1.25]);
    }
    chunk.features.discoveries.push({ ...site, ground });
  }
  for (const [name, { geometry, paint, items }] of batches) {
    const mesh = new THREE.InstancedMesh(geometry, paint, items.length); mesh.name = name;
    items.forEach((item, i) => {
      transform.position.set(...item.p); transform.rotation.set(...item.rotation); transform.scale.set(...item.scale);
      transform.updateMatrix(); mesh.setMatrixAt(i, transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    const rotor = name.endsWith('-rotors');
    mesh.castShadow = !rotor; mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    if (rotor) mesh.boundingSphere.radius = Math.max(mesh.boundingSphere.radius, name.startsWith('plains-turbine') ? 22 : 3);
    chunk.group.add(mesh);
  }
}
