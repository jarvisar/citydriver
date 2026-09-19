import * as THREE from 'three';
import { clamp, randomAt } from './world/route.js';
import { createTrafficModels, TRAFFIC_COLORS, TRAFFIC_MODELS } from './traffic-models.js';

const LANE = 2.4;
const BEHIND = 380, AHEAD = 620;
const DENSITY = { coast: 1, snow: .75, desert: .5, jungle: .6, plains: .5, city: 1 };
// The city runs half as many cars again over the same stretch of road.
const FLEET = { city: 9 };
const LIGHTS = { snow: 1, city: .35 };

// Four separating axes give a forgiving rectangular footprint even when the
// player is sideways. All collision coordinates are independent of render origin.
export function trafficContact(a, b) {
  const axes = car => [{ x: Math.cos(car.heading), z: Math.sin(car.heading) }, { x: Math.sin(car.heading), z: -Math.cos(car.heading) }];
  const aa = axes(a), ba = axes(b), dx = a.x - b.x, dz = a.z - b.z;
  const dot = (u, v) => u.x * v.x + u.z * v.z;
  const radius = (car, basis, axis) => car.halfWidth * Math.abs(dot(basis[0], axis)) + car.halfLength * Math.abs(dot(basis[1], axis));
  let contact = null;
  for (const axis of [...aa, ...ba]) {
    const distance = dx * axis.x + dz * axis.z;
    const depth = radius(a, aa, axis) + radius(b, ba, axis) - Math.abs(distance);
    if (depth <= 0) return null;
    if (!contact || depth < contact.depth) {
      const sign = distance < 0 ? -1 : 1;
      contact = { x: axis.x * sign, z: axis.z * sign, depth };
    }
  }
  return contact;
}

export class Traffic {
  constructor(scene, route, s, journey = 'coast') {
    this.enabled = true;
    this.group = new THREE.Group(); this.group.name = 'traffic'; scene.add(this.group);
    this.models = createTrafficModels();
    this.poseRotation = new THREE.Euler(0, 0, 0, 'YXZ');
    // A small shared pool illuminates nearby traffic without shadow-map passes.
    this.headlightRigs = Array.from({ length: 3 }, () => {
      const rig = new THREE.Group();
      const light = new THREE.SpotLight('#ffe0a6', 170, 24, .64, .8, 1.5);
      light.castShadow = false;
      rig.add(light, light.target);
      return { rig, light };
    });
    // Three cars in each direction over a kilometer: usually one or two in
    // view. The pool holds a few more for the routes that run heavier traffic.
    this.pool = Array.from({ length: 9 }, (_, index) => {
      const model = this.models.create(index % TRAFFIC_MODELS.length, TRAFFIC_COLORS[0]);
      this.group.add(model.car);
      return { ...model, index, direction: index % 2 ? -1 : 1, position: new THREE.Vector3(), previousPosition: new THREE.Vector3(), quaternion: new THREE.Quaternion(), previousQuaternion: new THREE.Quaternion() };
    });
    this.vehicles = this.pool.slice(0, 6);
    this.nearest = [];
    this.reset(route, s, journey);
  }
  random(car, salt) { return randomAt(car.index + car.generation * 31, salt + this.salt); }
  setEnabled(enabled, player) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.group.visible = enabled;
    if (enabled) {
      this.reset(this.route, player.s);
      this.clearNear(player);
    }
  }
  reset(route, s, journey = this.journey) {
    this.route = route; this.journey = journey; this.salt = { coast: 2100, desert: 2200, snow: 2300, jungle: 2400, plains: 2500, city: 2600 }[journey];
    this.spacing = 1 / (DENSITY[journey] ?? 1);
    const fleet = FLEET[journey] ?? 6;
    this.vehicles = this.pool.slice(0, fleet);
    for (const car of this.pool) car.car.visible = car.index < fleet;
    for (const { rig } of this.headlightRigs) {
      rig.removeFromParent();
      if (journey === 'snow') this.group.add(rig);
    }
    this.lastPlayerS = s; this.models.setLights(LIGHTS[journey] ?? 0);
    const span = 1080 / Math.ceil(fleet / 2);
    for (const car of this.vehicles) {
      car.generation = 0; car.u = car.direction * LANE;
      car.s = s + (-280 + Math.floor(car.index / 2) * span + (car.direction < 0 ? 80 : 0) + this.random(car, 1) * 35) * this.spacing;
      this.respawn(car, car.s);
    }
  }
  respawn(car, s) {
    car.s = s; car.generation++;
    car.cruiseSpeed = car.direction > 0 ? 16 : 20; car.speed = car.cruiseSpeed;
    car.paint.color.set(TRAFFIC_COLORS[Math.floor(this.random(car, 2) * TRAFFIC_COLORS.length)]);
    this.pose(car); car.previousPosition.copy(car.position); car.previousQuaternion.copy(car.quaternion);
  }
  recycle(car, playerS) {
    // Pick a clear spot outside the camera, including when reversing or resetting.
    let bestS = playerS + (AHEAD - 30) * this.spacing, bestGap = -Infinity;
    for (const offset of [-360, -300, 460, 530, 600]) {
      const s = playerS + (offset + this.random(car, 3) * 12) * this.spacing;
      const gap = Math.min(...this.vehicles.filter(other => other !== car && other.direction === car.direction).map(other => Math.abs(other.s - s)));
      if (gap > bestGap) { bestGap = gap; bestS = s; }
    }
    this.respawn(car, bestS);
  }
  clearNear(player) {
    for (const car of this.vehicles) if (Math.abs(car.s - player.s) < 18) this.recycle(car, player.s);
  }
  pose(car) {
    const route = this.route, frame = route.frame(car.s), p = route.position(car.s, car.u);
    car.position.set(p.x, p.y + .13, p.z);
    car.heading = frame.angle + (car.direction < 0 ? Math.PI : 0);
    const slope = (route.height(car.s + 1.5, car.u) - route.height(car.s - 1.5, car.u)) / (3 * frame.scale);
    const crossSlope = (route.height(car.s, car.u + .7) - route.height(car.s, car.u - .7)) / 1.4;
    car.quaternion.setFromEuler(this.poseRotation.set(Math.atan(slope * car.direction), -car.heading, Math.atan(crossSlope * car.direction)));
  }
  update(dt, player) {
    if (!this.enabled) return;
    if (Math.abs(player.s - this.lastPlayerS) > 120) this.reset(this.route, player.s);
    this.lastPlayerS = player.s;
    for (const car of this.vehicles) {
      if (car.s < player.s - BEHIND * this.spacing || car.s > player.s + AHEAD * this.spacing) this.recycle(car, player.s);
      car.previousPosition.copy(car.position); car.previousQuaternion.copy(car.quaternion);
      let target = car.cruiseSpeed;
      const scale = this.route.frame(car.s).scale;
      car.routeScale = scale;
      // Basic following/braking prevents the few cars from driving through a
      // stopped player or piling into one another. No passing or pathfinding.
      for (let i = 0; i <= this.vehicles.length; i++) {
        const other = i < this.vehicles.length ? this.vehicles[i] : player;
        if (other === car || Math.abs(other.u - car.u) > 2.2) continue;
        const ahead = (other.s - car.s) * car.direction * scale;
        if (ahead <= 0 || ahead > 70) continue;
        const gap = ahead - (car.spec.length + (other.spec?.length ?? 4)) / 2;
        target = Math.min(target, Math.sqrt(2 * 7 * Math.max(0, gap - 6)));
      }
      car.targetSpeed = target;
    }
    for (const car of this.vehicles) {
      car.speed += clamp(car.targetSpeed - car.speed, -14 * dt, 3 * dt);
      car.s += car.direction * car.speed * dt / car.routeScale;
      this.pose(car);
    }
    this.collide(player);
  }
  collide(player) {
    if (!this.enabled) return;
    for (const car of this.vehicles) {
      if (Math.abs(car.s - player.s) > 9) continue;
      const p = player.groundedPosition;
      const contact = trafficContact({ x: p.x, z: p.z, heading: player.heading, halfWidth: player.spec.width / 2, halfLength: player.spec.length / 2 },
        { x: car.position.x, z: car.position.z, heading: car.heading, halfWidth: car.spec.width / 2, halfLength: car.spec.length / 2 });
      if (!contact) continue;
      const vx = Math.sin(player.heading) * player.speed - Math.sin(car.heading) * car.speed;
      const vz = -Math.cos(player.heading) * player.speed + Math.cos(car.heading) * car.speed;
      const closing = vx * contact.x + vz * contact.z < 0;
      // Arcade response: separate the bodies and scrub speed on impact.
      player.resolveTrafficCollision(contact.x * (contact.depth + .025), contact.z * (contact.depth + .025), closing ? player.speed * .22 : player.speed);
      if (closing) car.speed *= .22;
    }
  }
  render(alpha, origin = 0) {
    if (!this.enabled) return;
    this.group.position.z = origin;
    for (const car of this.vehicles) {
      car.car.position.lerpVectors(car.previousPosition, car.position, clamp(alpha, 0, 1));
      car.car.quaternion.slerpQuaternions(car.previousQuaternion, car.quaternion, clamp(alpha, 0, 1));
    }
    if (this.journey === 'snow') {
      // Reused, so ranking the fleet each frame allocates nothing.
      const nearest = this.nearest;
      for (let i = 0; i < this.vehicles.length; i++) nearest[i] = this.vehicles[i];
      nearest.sort((a, b) => Math.abs(a.s - this.lastPlayerS) - Math.abs(b.s - this.lastPlayerS));
      for (const [index, { rig, light }] of this.headlightRigs.entries()) {
        const car = nearest[index];
        rig.position.copy(car.car.position); rig.quaternion.copy(car.car.quaternion);
        light.position.set(0, 1.01, -car.spec.length / 2 - .05);
        light.target.position.set(0, -1, -car.spec.length / 2 - 10);
        // Fade in from 225 to 150 meters; every vehicle retains its glowing lamps.
        light.intensity = 170 * clamp((225 - Math.abs(car.s - this.lastPlayerS)) / 75, 0, 1);
      }
    }
  }
  dispose() {
    this.group.removeFromParent(); this.models.dispose();
    for (const { light } of this.headlightRigs) light.dispose();
  }
}
