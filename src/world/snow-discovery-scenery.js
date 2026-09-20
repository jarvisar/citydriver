import * as THREE from 'three';
import { CHUNK_LENGTH, seededRandom, smoothstep, lerp, clamp } from './route.js';
import { snowPosition, snowGroundHeight } from './snow-route.js';
import { CABLE_ROPE_OFFSET, CABIN_DROP, CABLE_CYCLE, spanSag, cableTravel } from './snow-discoveries.js';
import { SnowDiscoveryParts, snowDiscoveryMaterial, cableCabinGeometry } from './snow-discovery-assets.js';

const up = new THREE.Vector3(0, 1, 0), transform = new THREE.Object3D();
const vector = (x, y, z) => new THREE.Vector3(x, y, z);

// Heights sampled from the rendered mountain, so footings and ice meet the
// facets the player actually sees rather than the smooth analytic surface.
export function terrainSampler(chunk, x, z, reach) {
  const position = chunk.terrain?.geometry.attributes.position, faces = [];
  for (let i = 0; position && i < position.count; i += 3) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let j = 0; j < 3; j++) {
      minX = Math.min(minX, position.getX(i + j)); maxX = Math.max(maxX, position.getX(i + j));
      minZ = Math.min(minZ, position.getZ(i + j)); maxZ = Math.max(maxZ, position.getZ(i + j));
    }
    if (maxX < x - reach || minX > x + reach || maxZ < z - reach || minZ > z + reach) continue;
    faces.push(Array.from({ length: 3 }, (_, j) => [position.getX(i + j), position.getY(i + j), position.getZ(i + j)]));
  }
  return (px, pz) => {
    let height = null;
    for (const [a, b, c] of faces) {
      const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (!d) continue;
      const w0 = ((b[2] - c[2]) * (px - c[0]) + (c[0] - b[0]) * (pz - c[2])) / d;
      const w1 = ((c[2] - a[2]) * (px - c[0]) + (a[0] - c[0]) * (pz - c[2])) / d;
      const w2 = 1 - w0 - w1;
      if (w0 < -.001 || w1 < -.001 || w2 < -.001) continue;
      const y = w0 * a[1] + w1 * b[1] + w2 * c[1];
      // Overhanging strata can cover a spot twice; the visible one is on top.
      if (height === null || y > height) height = y;
    }
    return height;
  };
}

function buildSnowmen(chunk, site) {
  const parts = new SnowDiscoveryParts();
  const figures = site.figures.map((figure, i) => {
    const p = snowPosition(figure.s, figure.u, 0), z = p.z + chunk.start;
    const ground = terrainSampler(chunk, p.x, z, 4);
    const y = ground(p.x, z) ?? snowGroundHeight(figure.s, figure.u);
    // Face the road and approaching drivers. Each figure sits in the rendered
    // snow, including where its triangles differ from the analytic hillside.
    const facing = snowPosition(figure.s - 8, 0, 0);
    const yaw = Math.atan2(facing.x - p.x, facing.z - p.z);
    const first = parts.parts.length;
    const coal = '#28333e', scarf = ['#bd493e', '#d29a44', '#467f83'][i];
    const ball = (position, scale, color) => {
      const geometry = new THREE.IcosahedronGeometry(1, 1); geometry.scale(...scale);
      parts.add(geometry, position, color);
    };
    ball([0, .72, 0], [.94, .88, .88], '#e6edf2');
    ball([0, 1.77, 0], [.7, .7, .66], '#edf2f5');
    ball([0, 2.65, 0], [.49, .5, .47], '#f2f5f6');
    parts.add(new THREE.CylinderGeometry(.49, .55, .16, 10), [0, 2.23, 0], scarf);
    parts.box([.26, 1.92, .64], [.22, .65, .1], scarf, [0, 0, -.12]);
    parts.add(new THREE.CylinderGeometry(.65, .65, .1, 10), [0, 3.05, 0], coal);
    parts.add(new THREE.CylinderGeometry(.37, .4, .53, 8), [0, 3.34, 0], coal);
    parts.add(new THREE.CylinderGeometry(.405, .415, .12, 8), [0, 3.15, 0], scarf);
    for (const x of [-.17, .17]) ball([x, 2.76, .415], [.065, .068, .06], coal);
    parts.beam(vector(0, 2.62, .42), vector(0, 2.59, .94), .11, '#e88c39', 7, .012);
    for (const x of [-.21, -.11, 0, .11, .21]) {
      ball([x, 2.42 + Math.abs(x) * .35, .42], [.035, .035, .035], coal);
    }
    for (const h of [1.48, 1.78, 2.04]) ball([0, h, .65], [.075, .075, .05], coal);
    for (const side of [-1, 1]) {
      const elbow = vector(side * 1.08, 1.96, 0), tip = vector(side * 1.63, 2.28, .05);
      parts.beam(vector(side * .58, 1.85, 0), elbow, .065, '#605044', 5, .05);
      parts.beam(elbow, tip, .05, '#605044', 5, .025);
      parts.beam(vector(side * 1.36, 2.12, .025), vector(side * 1.38, 2.43, .02), .035, '#605044', 5, .015);
    }
    for (const part of parts.parts.slice(first)) {
      part.scale(figure.scale, figure.scale, figure.scale);
      part.rotateY(yaw); part.translate(p.x, y - .12, z);
    }
    return { ...figure, x: p.x, z: p.z, ground: y };
  });
  chunk.addMesh(parts.finish(), snowDiscoveryMaterial, 'snowmen');
  return { ...site, figures };
}

function buildCableCar(chunk, site) {
  const parts = new SnowDiscoveryParts(), random = seededRandom(site.index * 31 + 3151);
  const world = (u, y, ds = 0) => { const p = snowPosition(site.s + ds, u, y); return vector(p.x, y, p.z + chunk.start); };
  const points = site.points.map(point => world(point.u, point.y));
  const line = points.at(-1).clone().sub(points[0]).setY(0).normalize();
  const ground = terrainSampler(chunk, (points[0].x + points.at(-1).x) / 2, (points[0].z + points.at(-1).z) / 2,
    points[0].distanceTo(points.at(-1)) / 2 + 14);
  const groundAt = (p, fallback) => ground(p.x, p.z) ?? fallback;

  function station(anchor, place, facing) {
    // A local frame: +z toward the rope, +x across it, so one layout serves
    // the valley station and the mountain station alike.
    const along = line.clone().multiplyScalar(facing), across = vector(along.z, 0, -along.x);
    const yaw = Math.atan2(along.x, along.z), rotation = [0, yaw, 0];
    const base = anchor.clone().addScaledVector(along, -5.2);
    const at = (x, y, z) => base.clone().addScaledVector(across, x).addScaledVector(along, z).setY(base.y + y);
    const deck = groundAt(base, place.ground), low = Math.min(place.low, deck) - 2.4;
    base.setY(Math.max(place.ground, deck));
    const top = anchor.y - base.y;
    const box = (position, size, color, glow = 0) => parts.box(position, size, color, rotation, glow);
    box(at(0, (low - base.y + .7) / 2, -1), [9.6, base.y + .7 - low, 6.6], '#495365');
    box(at(0, 2.75, -1), [8.9, 4.1, 5.6], '#6b5448');
    for (const x of [-4.48, 4.48]) for (const z of [-2.5, -1, .5]) box(at(x, 3.05, z), [.1, 1, 1.2], '#ffcf8c', 2.1);
    for (const x of [-1.5, 1.5]) box(at(x, 2.95, -3.83), [1.3, 1.1, .1], '#ffcf8c', 2.1);
    // A shallow gable with a snow load, like the lakeside cabins.
    for (const side of [-1, 1]) {
      const roll = new THREE.Quaternion().setFromAxisAngle(up, yaw)
        .multiply(new THREE.Quaternion().setFromAxisAngle(vector(0, 0, 1), -side * .34));
      parts.box(at(side * 2.4, 5.35, -1), [5.4, .34, 6.2], '#57606e', roll);
      parts.box(at(side * 2.42, 5.62, -1), [5.2, .2, 6], '#c7d2df', roll);
    }
    // An open boarding deck, then the sheave gantry: the working end of the
    // line stays visible above the roof from the fixed camera angle.
    box(at(0, 2.05, 4), [9.2, .3, 4.6], '#59636f');
    for (const x of [-4.3, 4.3]) for (const z of [2.4, 5.4]) box(at(x, 2.65, z), [.14, 1, .14], '#7e8899');
    for (const x of [-4.3, 4.3]) box(at(x, 3.15, 3.9), [.1, .12, 6], '#7e8899');
    box(at(0, top - .05, 5.2), [8.4, .34, .34], '#59636f');
    for (const x of [-3.9, 3.9]) {
      const post = at(x, 0, 5.2);
      parts.beam(post.clone().setY(groundAt(post, place.low) - 1), at(x, top + .1, 5.2), .3, '#4f5866', 4, .2);
      parts.beam(at(x, top, 5.2), at(x * .55, 1.9, 1.6), .16, '#5b6574', 4);
    }
    const sheave = new THREE.Quaternion().setFromAxisAngle(up, yaw)
      .multiply(new THREE.Quaternion().setFromAxisAngle(vector(0, 0, 1), Math.PI / 2));
    for (const side of [-1, 1]) {
      parts.add(new THREE.CylinderGeometry(1.5, 1.5, .34, 12), at(side * CABLE_ROPE_OFFSET, top - 1.5, 5.2), '#7a8697', sheave);
      parts.add(new THREE.CylinderGeometry(.42, .42, .5, 8), at(side * CABLE_ROPE_OFFSET, top - 1.5, 5.2), '#4f5866', sheave);
    }
    // A lamp over the platform, the one warm light on the machinery.
    box(at(0, top - .45, 3.4), [.66, .16, .66], '#ffdca4', 2.6);
    box(at(0, top - .2, 3.4), [.3, .35, .3], '#4f5866');
  }

  function pylon(point, place) {
    const across = vector(line.z, 0, -line.x), height = point.y - place.low;
    const at = (x, z, y) => point.clone().addScaledVector(across, x).addScaledVector(line, z).setY(point.y + y);
    const corner = (fraction, y) => {
      const spread = lerp(2.3, .75, fraction), depth = lerp(2, .65, fraction);
      return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => at(sx * spread, sz * depth, y));
    };
    const feet = corner(0, -height), tops = corner(1, -1.6), footings = [];
    feet.forEach((foot, i) => {
      const y = groundAt(foot, place.low);
      // A concrete block on a steep slope has to reach the ground under its
      // downhill edge too, or it juts out of the mountainside.
      const corners = [[-.8, -.8], [.8, -.8], [.8, .8], [-.8, .8]].map(([dx, dz]) => ground(foot.x + dx, foot.z + dz) ?? y);
      const bottom = Math.min(y, ...corners) - .9, top = y + .25;
      parts.box([foot.x, (bottom + top) / 2, foot.z], [1.6, top - bottom, 1.6], '#4b5465');
      parts.beam(foot.clone().setY(y - .3), tops[i], .3, '#6f7c8d', 4, .19);
      footings.push({ x: foot.x, z: foot.z - chunk.start, ground: y, bottom });
    });
    for (let h = 3; h < height - 2; h += 3.6) {
      const ring = corner(h / height, h - height);
      for (let i = 0; i < 4; i++) parts.beam(ring[i], ring[(i + 1) % 4], .12, '#65707f', 4);
      const next = corner(Math.min(1, (h + 3.6) / height), Math.min(-1.6, h + 3.6 - height));
      for (const i of [0, 2]) parts.beam(ring[i], next[(i + 1) % 4], .09, '#5b6574', 4);
    }
    parts.box([point.x, point.y - 1.15, point.z], [5.2, .5, .7], '#6f7c8d', [0, Math.atan2(across.x, across.z), 0]);
    parts.box([point.x, point.y - .85, point.z], [5, .14, .56], '#c7d2df', [0, Math.atan2(across.x, across.z), 0]);
    for (const side of [-1, 1]) {
      const saddle = at(side * CABLE_ROPE_OFFSET, 0, -.62);
      parts.box(saddle, [.36, .5, 2.7], '#4f5866', [0, Math.atan2(line.x, line.z), 0]);
      parts.beam(at(side * 2.4, 0, -1.15), saddle.clone().setY(point.y - 1.15), .12, '#6f7c8d', 4);
    }
    return footings;
  }

  const across = vector(line.z, 0, -line.x);
  const rope = [];
  for (const side of [-1, 1]) {
    const strand = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i].clone().addScaledVector(across, side * CABLE_ROPE_OFFSET);
      const b = points[i + 1].clone().addScaledVector(across, side * CABLE_ROPE_OFFSET);
      const sag = spanSag(site.points[i], site.points[i + 1]), segments = Math.ceil(a.distanceTo(b) / 4);
      const point = t => a.clone().lerp(b, t).addScaledVector(up, -4 * sag * t * (1 - t));
      for (let j = 0; j < segments; j++) parts.beam(point(j / segments), point((j + 1) / segments), .105, '#93a0b1', 4);
      strand.push({ a: a.toArray(), b: b.toArray(), sag, length: a.distanceTo(b) });
    }
    rope.push(strand);
  }
  station(points[0], site.lower, 1);
  station(points.at(-1), site.upper, -1);
  const towers = [];
  for (let i = 1; i < points.length - 1; i++) towers.push({ u: site.points[i].u, footings: pylon(points[i], site.points[i]) });
  // A few boulders shed from the cut below each pylon footing.
  for (let i = 1; i < points.length - 1; i++) for (let k = 0; k < 3; k++) {
    const spot = points[i].clone().addScaledVector(across, (random() - .5) * 9).addScaledVector(line, (random() - .5) * 8);
    const size = .5 + random() * .9;
    parts.lump([spot.x, groundAt(spot, site.points[i].low) + size * .3, spot.z], [size, size * .7, size * .85],
      '#4d5972', [random() * 3, random() * 3, random() * 3]);
  }
  chunk.addMesh(parts.finish(), snowDiscoveryMaterial, 'cable-car-line');

  const cabins = new THREE.InstancedMesh(cableCabinGeometry, snowDiscoveryMaterial, 2);
  cabins.name = 'cable-car-cabins'; cabins.castShadow = true; cabins.receiveShadow = true;
  const feature = { ...site, rope, towers, lateral: [across.x, across.z] };
  poseCabins(cabins, feature, 0);
  // One sphere spans the whole line, so the pair never pops while travelling.
  cabins.boundingSphere = new THREE.Sphere(points[0].clone().lerp(points.at(-1), .5).addScaledVector(up, -CABIN_DROP / 2),
    points[0].distanceTo(points.at(-1)) / 2 + 8);
  chunk.group.add(cabins);
  return feature;
}

// Where a cabin hangs at a given point of its run, following the sagging spans.
export function cableCabinPose(feature, side, travel) {
  const strand = feature.rope[side < 0 ? 0 : 1];
  const total = strand.reduce((sum, span) => sum + span.length, 0);
  let distance = clamp(travel, 0, 1) * total, span = strand[0];
  for (const candidate of strand) {
    span = candidate;
    if (distance <= candidate.length) break;
    distance -= candidate.length;
  }
  const t = clamp(distance / span.length, 0, 1);
  const a = vector(...span.a), b = vector(...span.b);
  const position = a.clone().lerp(b, t).addScaledVector(up, -4 * span.sag * t * (1 - t));
  const direction = b.clone().sub(a).setY(0).normalize();
  return { position, yaw: Math.atan2(direction.x, direction.z) + (side < 0 ? Math.PI : 0) };
}

// Pick the point in the existing journey where the uphill cabin crosses the
// road. The crossing is not necessarily halfway between the two stations.
function roadCrossingTime(feature) {
  let distance = 0;
  const length = feature.rope[0].reduce((sum, span) => sum + span.length, 0);
  for (let i = 0; i < feature.points.length - 1; i++) {
    const a = feature.points[i], b = feature.points[i + 1];
    distance += feature.rope[0][i].length * clamp(-a.u / (b.u - a.u), 0, 1);
  }
  // Invert cableTravel's smoothstep, including its eight-second station stop.
  const fraction = .5 - Math.sin(Math.asin(1 - 2 * clamp(distance / length, 0, 1)) / 3);
  return 8 + (CABLE_CYCLE / 2 - 8) * fraction - feature.index * 17.3;
}

function encounterClock(chunk, feature, time, vehicle) {
  const distance = Math.abs(feature.s - vehicle.s);
  // Schedule a fresh encounter outside the driving view, also on return visits.
  if (distance > 400) { chunk.cableTiming = null; return time; }
  const speed = Math.abs(vehicle.speed ?? 0);
  const arrival = Math.max(0, distance - 30) / Math.max(8, speed);
  if (!chunk.cableTiming) {
    const crossing = roadCrossingTime(feature);
    chunk.cableTiming = { crossing, offset: crossing - arrival - time, time, passed: false };
  }
  const timing = chunk.cableTiming, dt = Math.max(0, time - timing.time);
  timing.time = time;
  if (distance <= 30) timing.passed = true;
  if (!timing.passed && speed > 2 && (feature.s - vehicle.s) * vehicle.speed > 0) {
    const error = timing.crossing - arrival - (time + timing.offset);
    const wrapped = ((error + CABLE_CYCLE / 2) % CABLE_CYCLE + CABLE_CYCLE) % CABLE_CYCLE - CABLE_CYCLE / 2;
    // Accommodate changes in driving speed without jumping the cabins along
    // the rope. Stopping the car lets the lift continue its ordinary cycle.
    timing.offset += clamp(wrapped, -.75 * dt, dt);
  }
  return time + timing.offset;
}

// The scene clock still controls movement and pausing; approaching the lift
// schedules a road crossing shortly before the driver passes underneath.
export function animateSnowDiscoveries(chunks, time, vehicle) {
  for (const chunk of chunks) {
    for (const feature of chunk.features?.discoveries ?? []) {
      if (feature.kind !== 'cable-car') continue;
      chunk.cabins ??= chunk.group.getObjectByName('cable-car-cabins');
      const clock = Number.isFinite(vehicle?.s) ? encounterClock(chunk, feature, time, vehicle)
        : time + (chunk.cableTiming?.offset ?? 0);
      if (chunk.cabins) poseCabins(chunk.cabins, feature, clock);
    }
  }
}

export function poseCabins(mesh, feature, time) {
  for (let i = 0; i < 2; i++) {
    const side = i ? 1 : -1, travel = i ? 1 - cableTravel(time, feature.index) : cableTravel(time, feature.index);
    const pose = cableCabinPose(feature, side, travel);
    transform.position.copy(pose.position);
    // A slow pendulum swing, strongest just after leaving a station.
    const swing = Math.sin(time * .9 + feature.index) * .035 * (1 - Math.abs(travel * 2 - 1)) ** .5;
    transform.rotation.set(0, pose.yaw, swing);
    transform.updateMatrix(); mesh.setMatrixAt(i, transform.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

export function buildSnowDiscoveries(chunk, discoveries) {
  chunk.features = { discoveries: [] };
  for (const site of discoveries) {
    if (site.s < chunk.start || site.s >= chunk.start + CHUNK_LENGTH) continue;
    chunk.features.discoveries.push(site.kind === 'snowmen' ? buildSnowmen(chunk, site) : buildCableCar(chunk, site));
  }
}
