import * as THREE from 'three';
import { randomAt, clamp } from './world/route.js';
import { CITY_BLOCK } from './world/city-grid.js';
import { createTrafficModels, TRAFFIC_MODELS, TRAFFIC_COLORS } from './traffic-models.js';
import { trafficContact } from './traffic.js';
import { collisionImpulse, contactPoint } from './impact.js';
import { cityGreen } from './city-autodrive.js';

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
    for (const car of this.vehicles) this.spawn(car, s, u, true);
  }
  setEnabled(enabled, player) {
    this.enabled = enabled; this.group.visible = enabled;
    if (enabled) this.reset(this.route, player.s, 'city', player.u);
  }
  spawn(car, s, u, initial = false) {
    car.generation++;
    car.axis = car.index % 2 ? 'east' : 'north';
    car.direction = Math.floor(car.index / 2) % 2 ? -1 : 1;
    const r = salt => randomAt(car.index + car.generation * 97, 8100 + salt);
    const lateral = Math.round((car.axis === 'north' ? u : s) / CITY_BLOCK) + Math.floor(r(1) * 5) - 2;
    car.lane = lateral * CITY_BLOCK + (car.axis === 'north' ? 3 : -3) * car.direction;
    const center = car.axis === 'north' ? s : u;
    // Place each new car into an empty stretch. A lane can already contain a
    // queue at a red light when it is recycled, so spacing only from the player
    // would allow two traffic models to appear inside one another.
    let along = center + (initial ? (r(2) - .5) * 520 : (r(2) < .5 ? -1 : 1) * (260 + r(3) * 90));
    for (let attempt = 0; attempt < 80; attempt++) {
      car.s = car.axis === 'north' ? along : car.lane;
      car.u = car.axis === 'north' ? car.lane : along;
      const occupied = Math.hypot(car.s - s, car.u - u) < 25 || this.vehicles.some(other =>
        other !== car && Math.hypot(car.s - other.s, car.u - other.u) < 13);
      if (!occupied) break;
      along = center + (initial ? (r(10 + attempt) - .5) * 520 : (attempt % 2 ? -1 : 1) * (260 + (attempt * 17 % 91)));
    }
    car.cruiseSpeed = 11 + r(4) * 5; car.speed = car.cruiseSpeed;
    this.pose(car); car.previousPosition.copy(car.position); car.previousQuaternion.copy(car.quaternion);
  }
  pose(car) {
    const p = this.route.position(car.s, car.u);
    car.position.set(p.x, p.y + .13, p.z);
    car.heading = car.axis === 'north' ? (car.direction > 0 ? 0 : Math.PI) : car.direction * Math.PI / 2;
    car.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -car.heading);
  }
  update(dt, player) {
    if (!this.enabled) return;
    if (Math.hypot(player.s - this.lastS, player.u - this.lastU) > 130) this.reset(this.route, player.s, 'city', player.u);
    this.lastS = player.s; this.lastU = player.u; this.time += dt;
    for (const car of this.vehicles) {
      if (Math.hypot(car.s - player.s, car.u - player.u) > 430) this.spawn(car, player.s, player.u);
      car.previousPosition.copy(car.position); car.previousQuaternion.copy(car.quaternion);
      let target = car.cruiseSpeed;
      const along = car.axis === 'north' ? car.s : car.u;
      const intersection = car.direction > 0 ? Math.ceil(along / CITY_BLOCK) * CITY_BLOCK : Math.floor(along / CITY_BLOCK) * CITY_BLOCK;
      const gap = (intersection - along) * car.direction;
      if (!cityGreen(car.axis, this.time) && gap > 10) target = Math.min(target, Math.sqrt(2 * 7 * Math.max(0, gap - 15)));
      for (const other of [...this.vehicles, player]) {
        if (other === car) continue;
        const ds = other.s - car.s, du = other.u - car.u;
        const ahead = (car.axis === 'north' ? ds : du) * car.direction;
        const beside = Math.abs(car.axis === 'north' ? du : ds);
        if (ahead > 0 && beside < 2.9) target = Math.min(target, Math.sqrt(2 * 8 * Math.max(0, ahead - 9)));
      }
      car.targetSpeed = target;
    }
    for (const car of this.vehicles) {
      car.speed += clamp(car.targetSpeed - car.speed, -16 * dt, 3 * dt);
      if (car.axis === 'north') car.s += car.direction * car.speed * dt;
      else car.u += car.direction * car.speed * dt;
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
