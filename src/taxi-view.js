import * as THREE from 'three';
import { cityWalker, walkerFloat, createWalkerMaterial, walkerAppearance, setWalkerAppearance, taxiGroupAppearance } from './world/city-life.js';
import { ROAD_LEVEL, PAVEMENT_LEVEL, cityStreetProfile, nearestCityStreet } from './world/city-grid.js';
import { STOP_RADIUS, STOP_SECONDS, RATINGS, taxiRoute, fareBand, arrivalRating } from './taxi-run.js';
import { taxiLicense } from './taxi-license.js';
import { routeDistance } from './city-exploration.js';
import { DestinationArrow } from './destination-arrow.js';
import { applyWalkerHop } from './world/pedestrian-reactions.js';

const $ = id => document.getElementById(id);
const money = value => `$${Math.round(value ?? 0).toLocaleString('en-US')}`;
const distanceLabel = meters => meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters / 10) * 10} m`;
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
    this.people = createWalkerMaterial();
    this.partyBadges = new Map();
    this.revision = -1; this.markers = []; this.materials = [];
    this.skidGeometry = new THREE.PlaneGeometry(.22, 1.2); this.skidGeometry.rotateX(-Math.PI / 2);
    this.skidMaterial = new THREE.MeshBasicMaterial({ color: '#202526', transparent: true, opacity: .52, depthWrite: false });
    this.skids = new THREE.InstancedMesh(this.skidGeometry, this.skidMaterial, 160); this.skids.count = 0;
    this.skids.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.skids.frustumCulled = false; this.skids.userData.ambientOcclusion = false;
    this.group.add(this.skids); this.trails = []; this.trailIndex = 0; this.lastTrail = 0; this.transform = new THREE.Object3D();
  }
  // Every waiting fare gets a badge: a dollar sign in the ring's distance
  // colour, as in Crazy Taxi, plus a white ×N when a group shares the ride.
  badge(count, color) {
    const key = `${count}${color}`;
    if (!this.partyBadges.has(key) && globalThis.document) {
      const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#17262f'; ctx.beginPath(); ctx.roundRect(2, 2, 124, 60, 18); ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke();
      const suffix = count > 1 ? `×${count}` : '';
      ctx.font = 'bold 42px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const dollar = ctx.measureText('$').width, tail = suffix ? ctx.measureText(suffix).width : 0;
      const left = 64 - (dollar + tail) / 2;
      ctx.fillStyle = color; ctx.fillText('$', left, 34);
      if (suffix) { ctx.fillStyle = '#fff8e7'; ctx.fillText(suffix, left + dollar, 34); }
      const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
      this.partyBadges.set(key, new THREE.SpriteMaterial({ map, depthTest: false, depthWrite: false }));
    }
    return this.partyBadges.get(key);
  }
  rebuild(run) {
    const previousReactions = new Map(this.markers.map(marker => [marker.stop.id, marker.reactions]));
    for (const marker of this.markers) { marker.person?.dispose(); this.group.remove(marker.group); }
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
      const badgeMaterial = run.status === 'pickup' && this.badge(stop.passengers, stop.color);
      if (badgeMaterial) {
        const badge = new THREE.Sprite(badgeMaterial); badge.position.y = ROAD_LEVEL + 9;
        badge.scale.set(3.6, 1.8, 1); badge.renderOrder = 1; group.add(badge);
      }
      let person = null;
      const float = { phase: this.markers.length * 2.4, speed: .2 };
      if (run.status === 'pickup') {
        person = new THREE.InstancedMesh(cityWalker, this.people, stop.passengers);
        const seed = Math.imul(Math.round(stop.s * 10), 73856093) ^ Math.imul(Math.round(stop.u * 10), 19349663);
        for (let i = 0; i < stop.passengers; i++) {
          setWalkerAppearance(person, i, stop.passengers > 1 ? taxiGroupAppearance(seed, i) : walkerAppearance(seed));
        }
        person.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        // All riders share a draw call and stay in a compact line on the curb.
        const curb = street.halfWidth - street.lane + 2;
        person.boundingSphere = new THREE.Sphere(new THREE.Vector3(stop.axis === 'north' ? stop.side * curb : 0,
          PAVEMENT_LEVEL + 1.5, stop.axis === 'north' ? 0 : stop.side * curb), 5);
        group.add(person);
      }
      group.traverse(object => { object.userData.ambientOcclusion = false; });
      const previous = previousReactions.get(stop.id), count = person?.count ?? 0;
      const reactions = previous?.length === count ? previous : Array.from({ length: count }, (_, i) => previous?.[i] ?? {});
      this.markers.push({ group, stop, arrow, ring, beam, person, float, reactions, curb: street.halfWidth - street.lane + 2 }); this.group.add(group);
    }
  }
  reset() {
    this.trails = []; this.trailIndex = 0; this.lastTrail = 0; this.skids.count = 0; this.revision = -1;
    for (const marker of this.markers) marker.reactions = null;
  }
  render(run, vehicle, origin, time, contacts = null) {
    this.group.visible = run.running;
    if (!run.running) return;
    if (this.revision !== run.revision) this.rebuild(run);
    this.group.position.z = origin;
    for (const marker of this.markers) {
      const selected = run.status === 'driving' || marker.stop.id === run.boarding?.id;
      marker.group.position.set(marker.stop.u, 0, -marker.stop.s);
      if (marker.person) {
        const { stop, person, curb } = marker;
        const cos = Math.cos(marker.group.rotation.y), sin = Math.sin(marker.group.rotation.y);
        for (let i = 0; i < person.count; i++) {
          const motion = walkerFloat(marker.float, time + i * .7, passengerFloat);
          const along = (i - (person.count - 1) / 2) * 1.35;
          this.transform.position.set(stop.axis === 'north' ? stop.side * curb : along,
            PAVEMENT_LEVEL + motion.lift, stop.axis === 'north' ? along : stop.side * curb);
          this.transform.rotation.set(0, stop.axis === 'north' ? stop.side * Math.PI / 2 : stop.side < 0 ? Math.PI : 0, motion.roll);
          this.transform.scale.set(1.25, 1.25 * motion.stretch, 1.25); this.transform.updateMatrix();
          const p = this.transform.position, reaction = marker.reactions[i];
          contacts?.hit(reaction, stop.u + cos * p.x + sin * p.z, p.y, -stop.s - sin * p.x + cos * p.z, .35, time);
          applyWalkerHop(reaction, this.transform.matrix, time);
          person.setMatrixAt(i, this.transform.matrix);
        }
        person.instanceMatrix.needsUpdate = true;
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
        this.transform.rotation.set(0, -trail.heading, 0); this.transform.scale.setScalar(1); this.transform.updateMatrix();
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
    text('taxi-stage', pickup ? 'Pick up' : run.fare.stops.length > 1 ? `Stop ${run.stopIndex + 1} of ${run.fare.stops.length}` : 'Drop off');
    $('taxi-task').dataset.stage = run.status;
    // Pulse only in the red, just before the riders give up.
    // Pulse in the last seconds before the riders give up.
    $('taxi-task').dataset.urgent = String(!pickup && run.fareLeft <= 10);
    // Tips multiply by the combo and by every rider aboard.
    text('taxi-combo', !pickup && run.tipMultiplier > 1 ? `Tips ×${run.tipMultiplier}` : '');
    const track = $('taxi-stop-progress').parentElement;
    track.hidden = run.hold <= 0;
    track.setAttribute('aria-label', pickup ? 'Passenger boarding' : 'Passenger drop-off');
    track.setAttribute('aria-valuenow', String(Math.round(Math.min(1, run.hold / STOP_SECONDS) * 100)));
    $('taxi-nav').hidden = !stop;
    if (!stop) {
      const nearby = run.boarding ?? run.customers.reduce((best, customer) => {
        const d = Math.hypot(customer.s - vehicle.s, customer.u - vehicle.u);
        return d < 32 && (!best || d < Math.hypot(best.s - vehicle.s, best.u - vehicle.u)) ? customer : best;
      }, null);
      $('taxi-task').dataset.arriving = String(Boolean(run.boarding));
      text('taxi-task-title', nearby ? nearby.destination.name : 'Find a passenger');
      const band = nearby && fareBand(nearby.length);
      text('taxi-party', band ? `${band.label} · ${distanceLabel(nearby.length)}` : 'Red rings are close by · green rings go far');
      $('taxi-party').dataset.band = band?.id ?? '';
      text('taxi-next-stop', !nearby ? 'Groups ride together · one stop each'
        : nearby.passengers > 1 ? `${nearby.passengers} riders · ${nearby.stops.length} stops · paid when all arrive` : '');
      $('taxi-timer').hidden = true; $('taxi-timer-fill').parentElement.hidden = true;
      const risky = Boolean(nearby) && !run.boarding && run.shiftAfter(nearby) < 0;
      $('taxi-task').dataset.risky = String(risky);
      this.instruction(run.boarding ? `Hold still · boarding${run.boarding.passengers > 1 ? ` ${run.boarding.passengers} riders` : ''}…`
        : risky ? `Risky · your shift may end before ${nearby.passengers > 1 ? 'everyone arrives' : 'the drop-off'}` : nearby ? 'Stop in the ring to pick up' : '');
      text('taxi-fare-status', nearby ? `${money(nearby.fare + nearby.groupBonus)} + tips` : '');
      $('taxi-stop-progress').style.width = `${Math.min(1, run.hold / STOP_SECONDS) * 100}%`;
      return;
    }
    $('taxi-task').dataset.risky = 'false';
    const length = routeDistance(taxiRoute(vehicle, stop));
    const nearStop = Math.hypot(stop.s - vehicle.s, stop.u - vehicle.u) < STOP_RADIUS;
    text('taxi-nav-distance', nearStop ? 'Here' : `${Math.max(10, Math.round(length / 10) * 10)} m`);
    $('taxi-nav').setAttribute('aria-label', `Drop-off ${Math.round(length)} meters by road; the green arrow points directly to the destination`);
    text('taxi-task-title', stop.name);
    // The pill counts down to the riders giving up; its colour and the bar
    // show this rider's own window, so they always say what stopping now earns.
    const remaining = run.legRemaining, rating = arrivalRating(remaining);
    $('taxi-timer').hidden = false; $('taxi-timer-fill').parentElement.hidden = false;
    text('taxi-timer', `${Math.ceil(run.fareLeft)}s ${rating.label}`);
    $('taxi-timer').dataset.rating = rating.id; $('taxi-timer-fill').dataset.rating = rating.id;
    $('taxi-timer').setAttribute('aria-label', `${Math.ceil(run.fareLeft)} seconds left; arriving now rates ${rating.label}`);
    $('taxi-timer-fill').style.width = `${remaining * 100}%`;
    text('taxi-fare-status', money(run.remainingFare + run.tips));
    $('taxi-party').dataset.band = '';
    text('taxi-party', run.fare.passengers > 1 ? `${run.onboard} aboard · ${run.onboard === 1 ? 'last rider off here' : '1 off here'}` : '');
    const next = run.fare.stops[run.stopIndex + 1];
    text('taxi-next-stop', next ? `Then ${next.destination.name} · ${Math.round(next.length / 10) * 10} m further`
      : run.fare.passengers > 1 ? `Last stop · the group pays ${money(run.remainingFare + run.tips)}` : '');
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
    const license = taxiLicense(run.cash), best = taxiLicense(run.best);
    $('taxi-result-cash').textContent = money(run.cash);
    $('taxi-result-license').dataset.license = license.id;
    $('taxi-license-badge').textContent = license.badge;
    $('taxi-license-name').textContent = license.id === 'none' ? license.name : `${license.name} license`;
    const improved = run.cash > 0 && license.rank > taxiLicense(run.previousBest).rank;
    $('taxi-license-next').textContent = [improved && 'New best license!',
      license.next ? `${money(license.next.min - run.cash)} more for ${license.next.name}` : 'The top license'].filter(Boolean).join(' · ');
    $('taxi-result-fares').textContent = `${run.delivered} fare${run.delivered === 1 ? '' : 's'} · ${run.deliveredPassengers} riders delivered · ${run.failed} missed`;
    const rated = RATINGS.filter(rating => run.ratings?.[rating.id]);
    $('taxi-result-ratings').textContent = rated.map(rating => `${rating.label} ${run.ratings[rating.id]}`).join(' · ');
    $('taxi-result-best').textContent = `Best ${money(run.best)} · ${best.name}`;
    $('taxi-results').hidden = false;
  }
  dispose() {
    this.navigation.dispose();
    this.taskObserver?.disconnect(); globalThis.window?.removeEventListener('resize', this.measureTask);
    for (const material of this.materials) material.dispose();
    for (const material of this.partyBadges.values()) { material.map.dispose(); material.dispose(); }
    for (const marker of this.markers) marker.person?.dispose();
    for (const resource of [this.ring, this.beam, this.cone, this.people, this.skidGeometry, this.skidMaterial]) resource.dispose();
    this.skids.dispose(); this.group.removeFromParent();
  }
}
