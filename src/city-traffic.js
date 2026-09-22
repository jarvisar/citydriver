import * as THREE from 'three';
import { randomAt, clamp } from './world/route.js';
import { CITY_BLOCK, cityStreetProfile } from './world/city-grid.js';
import { cityLogical, cityLanePose } from './world/city-layout.js';
import { createTrafficModels, TRAFFIC_MODELS, TRAFFIC_COLORS } from './traffic-models.js';
import { trafficContact } from './traffic.js';
import { collisionImpulse, contactPoint } from './impact.js';
import { junctionSpeed } from './city-junctions.js';
const up = new THREE.Vector3(0, 1, 0);
const SPAWN_CLEARANCE = 170, RECYCLE_BEHIND = 190, LOCAL_RADIUS = 380;

// A bounded fleet on both street axes. Vehicles obey a shared intersection
// cycle, yield to the player, and recycle beyond the local view in any direction.
export class CityTraffic {
  constructor(scene, route, s) {
    this.route = route; this.enabled = true; this.time = 0;
    this.group = new THREE.Group(); this.group.name = 'city-traffic'; scene.add(this.group);
    this.models = createTrafficModels();
    this.vehicles = Array.from({ length: 24 }, (_, index) => {
      const model = this.models.create(index % TRAFFIC_MODELS.length, TRAFFIC_COLORS[index % TRAFFIC_COLORS.length]);
      this.group.add(model.car);
      return { ...model, index, generation: 0, position: new THREE.Vector3(), previousPosition: new THREE.Vector3(), quaternion: new THREE.Quaternion(), previousQuaternion: new THREE.Quaternion() };
    });
    this.reset(route, s);
  }
  reset(route, s, journey = 'city', u = 2.4) {
    this.route = route; this.journey = journey; this.time = 0; this.lastS = s; this.lastU = u;
    this.travelS = 0; this.travelU = 0; this.lookAhead = 0;
    this.junctionReservations = new Map();
    for (const car of this.vehicles) this.spawn(car, s, u, true);
  }
  setEnabled(enabled, player) {
    this.enabled = enabled; this.group.visible = enabled;
    if (enabled) this.reset(this.route, player.s, 'city', player.u);
  }
  spawn(car, s, u, initial = false) {
    car.generation++;
    const axis = car.index % 2 ? 'east' : 'north';
    const direction = Math.floor(car.index / 2) % 2 ? -1 : 1;
    const r = salt => randomAt(car.index + car.generation * 97, 8100 + salt);
    // Populate where the player will be in a few seconds, favoring the nearest
    // street while retaining traffic on neighboring and crossing streets.
    const address = cityLogical(s + this.travelS * this.lookAhead, u + this.travelU * this.lookAhead);
    for (let attempt = 0; attempt < 80; attempt++) {
      const choice = r(10 + attempt * 2);
      const lateral = Math.round((axis === 'north' ? address.u : address.s) / CITY_BLOCK) + (choice < .65 ? 0 : choice < .825 ? -1 : 1);
      const street = cityStreetProfile(axis, lateral);
      const lane = lateral * CITY_BLOCK + (axis === 'north' ? 1 : -1) * street.lane * direction;
      const along = (axis === 'north' ? address.s : address.u) + (r(11 + attempt * 2) - .5) * 520;
      const pose = cityLanePose(axis, lane, along, direction);
      const ds = pose.s - s, du = pose.u - u, distance = Math.hypot(ds, du);
      if (distance < (initial ? 25 : SPAWN_CLEARANCE) || distance > LOCAL_RADIUS) continue;
      if (!initial && this.lookAhead && ds * this.travelS + du * this.travelU < 90) continue;
      if (this.vehicles.some(other => other !== car && Math.hypot(pose.s - other.s, pose.u - other.u) < 13)) continue;
      Object.assign(car, pose, { axis, direction, lane });
      car.stopKey = null; car.stopWait = 0; car.stopReleased = false;
      car.cruiseSpeed = street.speed * (.75 + r(4) * .25); car.speed = car.cruiseSpeed;
      this.pose(car); car.previousPosition.copy(car.position); car.previousQuaternion.copy(car.quaternion);
      return true;
    }
    // A crowded area can wait until the next update; never force an overlap.
    return false;
  }
  pose(car) {
    const address = cityLogical(car.s, car.u), along = car.axis === 'north' ? address.s : address.u;
    Object.assign(car, cityLanePose(car.axis, car.lane, along, car.direction));
    car.logicalS = car.axis === 'north' ? along : car.lane;
    car.logicalU = car.axis === 'north' ? car.lane : along;
    const p = this.route.position(car.s, car.u);
    car.position.set(p.x, p.y + .13, p.z);
    car.quaternion.setFromAxisAngle(up, -car.heading);
  }
  update(dt, player) {
    if (!this.enabled) return;
    if (Math.hypot(player.s - this.lastS, player.u - this.lastU) > 130) this.reset(this.route, player.s, 'city', player.u);
    const ds = player.s - this.lastS, du = player.u - this.lastU, moved = Math.hypot(ds, du);
    const speed = dt > 0 ? moved / dt : 0;
    this.travelS = speed > 2 ? ds / moved : 0;
    this.travelU = speed > 2 ? du / moved : 0;
    this.lookAhead = Math.min(180, speed > 2 ? speed * 3.5 : 0);
    this.lastS = player.s; this.lastU = player.u; this.time += dt;
    for (const car of this.vehicles) {
      const ds = car.s - player.s, du = car.u - player.u;
      const behind = ds * this.travelS + du * this.travelU < -RECYCLE_BEHIND;
      const beside = Math.abs(du * this.travelS - ds * this.travelU) > 260;
      if (Math.hypot(ds, du) > LOCAL_RADIUS || behind || beside) this.spawn(car, player.s, player.u);
      car.previousPosition.copy(car.position); car.previousQuaternion.copy(car.quaternion);
      let target = car.cruiseSpeed;
      const along = car.axis === 'north' ? car.logicalS : car.logicalU;
      target = Math.min(target, junctionSpeed(car, this, car.axis, car.direction, car.lane, along, car.speed, dt));
      const cos = Math.cos(car.heading), sin = Math.sin(car.heading);
      for (let i = 0; i <= this.vehicles.length; i++) {
        const other = i === this.vehicles.length ? player : this.vehicles[i];
        if (other === car) continue;
        const ds = other.s - car.s, du = other.u - car.u;
        const ahead = ds * cos + du * sin;
        const beside = Math.abs(du * cos - ds * sin);
        if (ahead > 0 && beside < 2.9) target = Math.min(target, Math.sqrt(2 * 8 * Math.max(0, ahead - 9)));
      }
      car.targetSpeed = target;
    }
    for (const car of this.vehicles) {
      car.speed += clamp(car.targetSpeed - car.speed, -16 * dt, 3 * dt);
      const along = (car.axis === 'north' ? car.logicalS : car.logicalU) + car.direction * car.speed * dt / car.stretch;
      Object.assign(car, cityLanePose(car.axis, car.lane, along, car.direction));
      this.pose(car);
      const p = player.groundedPosition;
      if (Math.abs(car.position.x - p.x) > 7 || Math.abs(car.position.z - p.z) > 7) continue;
      const v = player.velocity;
      const a = { x: p.x, z: p.z, heading: player.heading, halfWidth: player.spec.width / 2, halfLength: player.spec.length / 2, mass: player.spec.mass, vx: v.x, vz: v.z };
      const b = { x: car.position.x, z: car.position.z, heading: car.heading, halfWidth: car.spec.width / 2, halfLength: car.spec.length / 2, mass: car.spec.mass, vx: Math.sin(car.heading) * car.speed, vz: -Math.cos(car.heading) * car.speed };
      const contact = trafficContact(a, b);
      if (contact) {
        const blow = collisionImpulse(a, b, contact, contactPoint(a, b));
        player.resolveTrafficCollision(contact.x * (contact.depth + .025), contact.z * (contact.depth + .025), blow?.a.x ?? 0, blow?.a.z ?? 0, blow?.a.spin ?? 0);
        car.speed = Math.max(0, car.speed + (blow?.b.x ?? 0) * Math.sin(car.heading) - (blow?.b.z ?? 0) * Math.cos(car.heading));
      }
    }
  }
  render(alpha, origin = 0) {
    this.group.position.z = origin;
    for (const car of this.vehicles) {
      car.car.position.lerpVectors(car.previousPosition, car.position, clamp(alpha, 0, 1));
      car.car.quaternion.slerpQuaternions(car.previousQuaternion, car.quaternion, clamp(alpha, 0, 1));
    }
  }
  dispose() { this.group.removeFromParent(); this.models.dispose(); }
}
