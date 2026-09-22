import * as THREE from 'three';
import { cityWalker } from './world/city-life.js';
import { ROAD_LEVEL, PAVEMENT_LEVEL, cityStreetProfile, nearestCityStreet } from './world/city-grid.js';
import { STOP_SECONDS, taxiRoute } from './taxi-run.js';
import { routeDistance } from './city-exploration.js';

const $ = id => document.getElementById(id);
const money = value => `$${Math.round(value ?? 0).toLocaleString('en-US')}`;
export class TaxiView {
  constructor(scene) {
    this.group = new THREE.Group(); this.group.name = 'taxi-markers'; scene.add(this.group);
    this.ring = new THREE.RingGeometry(6, 6.5, 40); this.ring.rotateX(-Math.PI / 2);
    this.beam = new THREE.CylinderGeometry(6.3, 6.3, 5, 32, 1, true);
    this.cone = new THREE.ConeGeometry(1, 2, 4); this.cone.rotateZ(Math.PI);
    this.people = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: .9 });
    this.revision = -1; this.markers = []; this.materials = [];
    this.skidGeometry = new THREE.PlaneGeometry(.22, 1.2); this.skidGeometry.rotateX(-Math.PI / 2);
    this.skidMaterial = new THREE.MeshBasicMaterial({ color: '#202526', transparent: true, opacity: .52, depthWrite: false });
    this.skids = new THREE.InstancedMesh(this.skidGeometry, this.skidMaterial, 160); this.skids.count = 0;
    this.skids.frustumCulled = false; this.skids.userData.ambientOcclusion = false;
    this.group.add(this.skids); this.trails = []; this.trailIndex = 0; this.lastTrail = 0; this.transform = new THREE.Object3D();
  }
  rebuild(run) {
    for (const marker of this.markers) this.group.remove(marker.group);
    for (const material of this.materials) material.dispose();
    this.materials = []; this.markers = []; this.revision = run.revision;
    const stops = run.status === 'pickup' ? run.customers : run.status === 'driving' ? [{ ...run.target, color: '#ffd240' }] : [];
    for (const stop of stops) {
      const street = cityStreetProfile(stop.axis, stop.index ?? nearestCityStreet(stop.s, stop.u).index);
      const acrossScale = Math.min(.65, (street.halfWidth - street.lane - .4) / 6.5);
      const group = new THREE.Group(), solid = new THREE.MeshBasicMaterial({ color: stop.color, side: THREE.DoubleSide });
      group.rotation.y = -(stop.heading ?? (stop.axis === 'north' ? 0 : Math.PI / 2)) + (stop.axis === 'north' ? 0 : Math.PI / 2) + (stop.side < 0 ? Math.PI : 0);
      const glow = new THREE.MeshBasicMaterial({ color: stop.color, transparent: true, opacity: .08, depthWrite: false, side: THREE.DoubleSide });
      this.materials.push(solid, glow);
      const ring = new THREE.Mesh(this.ring, solid); ring.position.y = ROAD_LEVEL + .07; group.add(ring);
      const beam = new THREE.Mesh(this.beam, glow); beam.position.y = ROAD_LEVEL + 2.5; group.add(beam);
      if (stop.axis === 'north') beam.scale.x = acrossScale; else beam.scale.z = acrossScale;
      const arrow = new THREE.Mesh(this.cone, solid); arrow.position.y = ROAD_LEVEL + 7; group.add(arrow);
      if (run.status === 'pickup') {
        const person = new THREE.Mesh(cityWalker, this.people); person.scale.setScalar(1.25); person.position.y = PAVEMENT_LEVEL;
        const curb = street.halfWidth - street.lane + 2;
        if (stop.axis === 'north') person.position.x = stop.side * curb;
        else person.position.z = stop.side * curb;
        group.add(person);
      }
      group.traverse(object => { object.userData.ambientOcclusion = false; });
      this.markers.push({ group, stop, arrow, ring, acrossScale }); this.group.add(group);
    }
  }
  reset() { this.trails = []; this.trailIndex = 0; this.lastTrail = 0; this.skids.count = 0; this.revision = -1; }
  render(run, vehicle, origin, time) {
    this.group.visible = run.running;
    if (!run.running) return;
    if (this.revision !== run.revision) this.rebuild(run);
    this.group.position.z = origin;
    for (const marker of this.markers) {
      marker.group.position.set(marker.stop.u, 0, -marker.stop.s);
      marker.arrow.position.y = ROAD_LEVEL + 7 + Math.sin(time * 3) * .35;
      marker.arrow.visible = run.status === 'driving' || marker.stop.id === run.target?.id;
      const pulse = 1 + Math.sin(time * 4) * .035;
      marker.ring.scale.set(marker.stop.axis === 'north' ? marker.acrossScale * pulse : pulse, 1, marker.stop.axis === 'east' ? marker.acrossScale * pulse : pulse);
    }
    if (vehicle.drifting && time - this.lastTrail > .065) {
      this.lastTrail = time;
      for (const side of [-1, 1]) {
        this.trails[this.trailIndex] = { x: vehicle.u - Math.sin(vehicle.heading) * 1.3 + Math.cos(vehicle.heading) * side * .8,
          z: -vehicle.s + Math.cos(vehicle.heading) * 1.3 + Math.sin(vehicle.heading) * side * .8, heading: vehicle.heading };
        this.trailIndex = (this.trailIndex + 1) % 160;
      }
    }
    this.skids.count = this.trails.length;
    for (let i = 0; i < this.trails.length; i++) {
      const trail = this.trails[i]; this.transform.position.set(trail.x, ROAD_LEVEL + .08, trail.z);
      this.transform.rotation.set(0, -trail.heading, 0); this.transform.updateMatrix(); this.skids.setMatrixAt(i, this.transform.matrix);
    }
    this.skids.instanceMatrix.needsUpdate = true;
  }
  hud(run, vehicle) {
    $('taxi-hud').hidden = !run.running; $('taxi-nav').hidden = !run.running; $('taxi-task').hidden = !run.running;
    $('taxi-buttons').hidden = !run.running;
    if (!run.running) return;
    $('taxi-clock').textContent = Math.ceil(run.timeLeft); $('taxi-clock').dataset.urgent = String(run.timeLeft <= 15);
    $('taxi-cash').textContent = money(run.cash); $('taxi-fares').textContent = `${run.delivered} fare${run.delivered === 1 ? '' : 's'}`;
    $('taxi-speed').textContent = Math.round(Math.abs(vehicle.speed) * 2.23694);
    $('taxi-boost-fill').style.width = `${run.boost * 100}%`;
    $('taxi-boost').setAttribute('aria-valuenow', String(Math.round(run.boost * 100)));
    const stop = run.target;
    const angle = Math.atan2(stop.u - vehicle.u, stop.s - vehicle.s) - vehicle.heading;
    $('taxi-arrow').style.transform = `rotate(${angle}rad)`;
    const length = routeDistance(taxiRoute(vehicle, stop));
    $('taxi-nav-distance').textContent = `${Math.round(length / 10) * 10} m`;
    $('taxi-task-title').textContent = run.status === 'pickup' ? 'PICK UP' : stop.name;
    $('taxi-task-detail').textContent = run.status === 'pickup' ? 'Stop in a pickup ring' : `${Math.ceil(run.fareLeft)}s · ${money(run.fare.fare + run.tips)} · Stop in the yellow ring`;
    $('taxi-stop-progress').style.width = `${Math.min(1, run.hold / STOP_SECONDS) * 100}%`;
    $('taxi-combo').textContent = run.status === 'driving' && run.combo > 1 ? `TIP ×${run.combo}` : '';
    $('taxi-task').dataset.stage = run.status;
  }
  results(run) {
    $('taxi-result-cash').textContent = money(run.cash);
    $('taxi-result-fares').textContent = `${run.delivered} fare${run.delivered === 1 ? '' : 's'} · ${run.failed} missed`;
    $('taxi-result-best').textContent = `Best ${money(run.best)}`;
    $('taxi-results').hidden = false;
  }
  dispose() {
    for (const material of this.materials) material.dispose();
    for (const resource of [this.ring, this.beam, this.cone, this.people, this.skidGeometry, this.skidMaterial]) resource.dispose();
    this.skids.dispose(); this.group.removeFromParent();
  }
}
