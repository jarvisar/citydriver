import * as THREE from 'three';
import { cityWalker, walkerFloat } from './world/city-life.js';
import { ROAD_LEVEL, PAVEMENT_LEVEL, cityStreetProfile, nearestCityStreet } from './world/city-grid.js';
import { STOP_RADIUS, STOP_SECONDS, taxiRoute } from './taxi-run.js';
import { routeDistance } from './city-exploration.js';
import { DestinationArrow } from './destination-arrow.js';

const $ = id => document.getElementById(id);
const money = value => `$${Math.round(value ?? 0).toLocaleString('en-US')}`;
const compactCash = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
const text = (id, value) => { const element = $(id), next = String(value); if (element.textContent !== next) element.textContent = next; };
const passengerFloat = {};
const markerScale = 1.3;
export class TaxiView {
  constructor(scene) {
    this.navigation = new DestinationArrow(globalThis.document ? $('taxi-arrow') : null);
    this.measureTask = () => {
      const task = $('taxi-task');
      if (!task.hidden) $('app').style.setProperty('--taxi-task-bottom', `${task.getBoundingClientRect().bottom}px`);
    };
    this.taskObserver = globalThis.ResizeObserver && globalThis.document ? new ResizeObserver(this.measureTask) : null;
    this.taskObserver?.observe($('taxi-task'));
    globalThis.window?.addEventListener('resize', this.measureTask);
    this.group = new THREE.Group(); this.group.name = 'taxi-markers'; scene.add(this.group);
    this.ring = new THREE.RingGeometry(6 * markerScale, 6.5 * markerScale, 40); this.ring.rotateX(-Math.PI / 2);
    this.beam = new THREE.CylinderGeometry(6.3 * markerScale, 6.3 * markerScale, 5, 32, 1, true);
    this.cone = new THREE.ConeGeometry(1, 2, 4); this.cone.rotateZ(Math.PI);
    this.people = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: .9 });
    this.revision = -1; this.markers = []; this.materials = [];
    this.skidGeometry = new THREE.PlaneGeometry(.22, 1.2); this.skidGeometry.rotateX(-Math.PI / 2);
    this.skidMaterial = new THREE.MeshBasicMaterial({ color: '#202526', transparent: true, opacity: .52, depthWrite: false });
    this.skids = new THREE.InstancedMesh(this.skidGeometry, this.skidMaterial, 160); this.skids.count = 0;
    this.skids.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
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
      const group = new THREE.Group(), solid = new THREE.MeshBasicMaterial({ color: stop.color, side: THREE.DoubleSide });
      group.rotation.y = -(stop.heading ?? (stop.axis === 'north' ? 0 : Math.PI / 2)) + (stop.axis === 'north' ? 0 : Math.PI / 2) + (stop.side < 0 ? Math.PI : 0);
      const glow = new THREE.MeshBasicMaterial({ color: stop.color, transparent: true, opacity: .08, depthWrite: false, side: THREE.DoubleSide });
      this.materials.push(solid, glow);
      // Keep the full radius across the street and visible over the adjacent curb.
      const ring = new THREE.Mesh(this.ring, solid); ring.position.y = PAVEMENT_LEVEL + .07; group.add(ring);
      const beam = new THREE.Mesh(this.beam, glow); beam.position.y = ROAD_LEVEL + 2.5; group.add(beam);
      const arrow = new THREE.Mesh(this.cone, solid); arrow.position.y = ROAD_LEVEL + 7; group.add(arrow);
      let person = null;
      const float = { phase: this.markers.length * 2.4, speed: .2 };
      if (run.status === 'pickup') {
        person = new THREE.Mesh(cityWalker, this.people); person.scale.setScalar(1.25); person.position.y = PAVEMENT_LEVEL;
        const curb = street.halfWidth - street.lane + 2;
        if (stop.axis === 'north') person.position.x = stop.side * curb;
        else person.position.z = stop.side * curb;
        person.rotation.y = stop.axis === 'north' ? stop.side * Math.PI / 2 : stop.side < 0 ? Math.PI : 0;
        group.add(person);
      }
      group.traverse(object => { object.userData.ambientOcclusion = false; });
      this.markers.push({ group, stop, arrow, ring, beam, person, float }); this.group.add(group);
    }
  }
  reset() { this.trails = []; this.trailIndex = 0; this.lastTrail = 0; this.skids.count = 0; this.revision = -1; }
  render(run, vehicle, origin, time) {
    this.group.visible = run.running;
    if (!run.running) return;
    if (this.revision !== run.revision) this.rebuild(run);
    this.group.position.z = origin;
    for (const marker of this.markers) {
      const selected = run.status === 'driving' || marker.stop.id === run.boarding?.id;
      marker.group.position.set(marker.stop.u, 0, -marker.stop.s);
      if (marker.person) {
        const motion = walkerFloat(marker.float, time, passengerFloat);
        marker.person.position.y = PAVEMENT_LEVEL + motion.lift;
        marker.person.rotation.z = motion.roll;
        marker.person.scale.y = 1.25 * motion.stretch;
      }
      marker.arrow.position.y = ROAD_LEVEL + 7 + Math.sin(time * 3) * .35;
      marker.arrow.scale.setScalar(selected ? 1 : .65);
      marker.beam.visible = selected;
      const pulse = selected ? 1 + Math.sin(time * 4) * .035 : 1;
      marker.ring.scale.set(pulse, 1, pulse);
    }
    if (vehicle.drifting && time - this.lastTrail > .065) {
      this.lastTrail = time;
      for (const side of [-1, 1]) {
        const trail = { x: vehicle.u - Math.sin(vehicle.heading) * 1.3 + Math.cos(vehicle.heading) * side * .8,
          z: -vehicle.s + Math.cos(vehicle.heading) * 1.3 + Math.sin(vehicle.heading) * side * .8, heading: vehicle.heading };
        this.trails[this.trailIndex] = trail;
        this.transform.position.set(trail.x, ROAD_LEVEL + .08, trail.z);
        this.transform.rotation.set(0, -trail.heading, 0); this.transform.updateMatrix();
        this.skids.setMatrixAt(this.trailIndex, this.transform.matrix);
        this.skids.instanceMatrix.addUpdateRange(this.trailIndex * 16, 16);
        this.trailIndex = (this.trailIndex + 1) % 160;
      }
      this.skids.instanceMatrix.needsUpdate = true;
    }
    this.skids.count = this.trails.length;
  }
  hud(run, vehicle) {
    $('taxi-hud').hidden = !run.running; $('taxi-nav').hidden = !run.running; $('taxi-task').hidden = !run.running;
    $('taxi-buttons').hidden = !run.running;
    $('taxi-dash').hidden = !run.running;
    if (!run.running) return;
    text('taxi-clock', Math.ceil(run.timeLeft)); $('taxi-clock').dataset.urgent = String(run.timeLeft <= 15);
    text('taxi-cash', run.cash >= 1000 ? compactCash.format(run.cash) : money(run.cash));
    $('taxi-cash').setAttribute('aria-label', `Total earned ${money(run.cash)}`);
    text('taxi-fares', `${run.delivered} fare${run.delivered === 1 ? '' : 's'}`);
    text('taxi-speed', Math.round(Math.abs(vehicle.speed) * 2.23694));
    $('taxi-boost-fill').style.width = `${run.boost * 100}%`;
    $('taxi-boost').setAttribute('aria-valuenow', String(Math.round(run.boost * 100)));
    $('taxi-controller-boost').value = run.boost;
    text('taxi-boost-state', run.boostActive ? 'Boosting' : run.boost < .1 ? 'Release to fill' : 'Hold');
    $('taxi-buttons').dataset.boosting = String(run.boostActive);
    $('taxi-buttons').dataset.drifting = String(vehicle.drifting);
    const stop = run.target;
    const pickup = run.status === 'pickup';
    text('taxi-stage', pickup ? 'Pick up' : 'Drop off');
    $('taxi-task').dataset.stage = run.status;
    $('taxi-task').dataset.urgent = String(!pickup && run.fareLeft <= 10);
    text('taxi-combo', !pickup && run.combo > 1 ? `Tip ×${run.combo}` : '');
    const track = $('taxi-stop-progress').parentElement;
    track.hidden = run.hold <= 0;
    track.setAttribute('aria-label', pickup ? 'Passenger boarding' : 'Passenger drop-off');
    track.setAttribute('aria-valuenow', String(Math.round(Math.min(1, run.hold / STOP_SECONDS) * 100)));
    $('taxi-nav').hidden = !stop;
    if (!stop) {
      $('taxi-task').dataset.arriving = String(Boolean(run.boarding));
      text('taxi-task-title', 'Find a passenger');
      this.instruction(run.boarding ? 'Hold still · boarding…' : '');
      text('taxi-fare-status', '');
      $('taxi-stop-progress').style.width = `${Math.min(1, run.hold / STOP_SECONDS) * 100}%`;
      return;
    }
    const length = routeDistance(taxiRoute(vehicle, stop));
    const nearStop = Math.hypot(stop.s - vehicle.s, stop.u - vehicle.u) < STOP_RADIUS;
    text('taxi-nav-distance', nearStop ? 'Here' : `${Math.max(10, Math.round(length / 10) * 10)} m`);
    $('taxi-nav').setAttribute('aria-label', `Drop-off ${Math.round(length)} meters by road; the green arrow points directly to the destination`);
    text('taxi-task-title', stop.name);
    text('taxi-fare-status', `Arrive in ${Math.ceil(run.fareLeft)}s · ${money(run.fare.fare + run.tips)}`);
    const instruction = nearStop
      ? Math.abs(vehicle.speed) >= 2.5 ? 'Brake to drop off' : 'Hold still · dropping off…'
      : '';
    this.instruction(instruction);
    $('taxi-task').dataset.arriving = String(nearStop);
    $('taxi-stop-progress').style.width = `${Math.min(1, run.hold / STOP_SECONDS) * 100}%`;
  }
  instruction(text) {
    // Announce state changes, not every HUD refresh or countdown tick.
    if ($('taxi-task-detail').textContent !== text) $('taxi-task-detail').textContent = text;
  }
  results(run) {
    $('taxi-result-cash').textContent = money(run.cash);
    $('taxi-result-fares').textContent = `${run.delivered} fare${run.delivered === 1 ? '' : 's'} · ${run.failed} missed`;
    $('taxi-result-best').textContent = `Best ${money(run.best)}`;
    $('taxi-results').hidden = false;
  }
  dispose() {
    this.navigation.dispose();
    this.taskObserver?.disconnect(); globalThis.window?.removeEventListener('resize', this.measureTask);
    for (const material of this.materials) material.dispose();
    for (const resource of [this.ring, this.beam, this.cone, this.people, this.skidGeometry, this.skidMaterial]) resource.dispose();
    this.skids.dispose(); this.group.removeFromParent();
  }
}
