import { CITY_BLOCK, cityBlock, cityStreetProfile, cityMedianRange } from './world/city-grid.js';
import { CITY_PLACES, PLACE_TYPES } from './world/city-places.js';
import { CityExploration, placeRoute, routeDistance } from './city-exploration.js';
import { taxiRoute } from './taxi-run.js';

const $ = id => document.getElementById(id);
export class CityGuide {
  constructor(notify, position) {
    let storage; try { storage = localStorage; } catch { /* Optional storage. */ }
    this.exploration = new CityExploration(storage); this.notify = notify; this.position = position;
    this.canvas = $('city-map'); this.ctx = this.canvas.getContext('2d'); this.expanded = true;
    $('city-notebook').innerHTML = PLACE_TYPES.map(type => `<button type="button" class="notebook-place" data-place-type="${type}" style="--place-color:${CITY_PLACES[type].color}"><span class="notebook-stamp">${CITY_PLACES[type].symbol}</span><span><strong>${CITY_PLACES[type].name}</strong><small>${CITY_PLACES[type].short}</small></span><span class="notebook-check" aria-hidden="true">○</span></button>`).join('');
    for (const button of document.querySelectorAll('[data-place-type]')) button.addEventListener('click', () => this.next(button.dataset.placeType));
    $('next-city-stop').addEventListener('click', () => { this.next(); $('next-city-stop').blur(); });
    $('city-map-toggle').addEventListener('click', () => {
      this.expanded = !this.expanded; this.canvas.hidden = !this.expanded;
      $('city-map-toggle').setAttribute('aria-expanded', String(this.expanded));
      $('city-map-toggle').textContent = this.expanded ? 'Hide map' : 'Show map';
      $('city-map-toggle').blur();
    });
    this.refreshNotebook();
  }
  next(type = null) {
    if (this.taxi?.running) { this.taxi.next(); this.updateTaxi(); return; }
    const { s, u } = this.position(), place = this.exploration.next(s, u, type);
    if (place) this.notify(place.name);
    else this.notify('No stop nearby');
    this.update(false);
  }
  refreshNotebook() {
    const found = this.exploration.found;
    $('city-stamps').textContent = `${found.size} / ${PLACE_TYPES.length}`;
    $('city-notebook-progress').textContent = found.size === PLACE_TYPES.length
      ? '5 / 5 visited'
      : `${found.size} / ${PLACE_TYPES.length} visited`;
    for (const button of document.querySelectorAll('[data-place-type]')) {
      const collected = found.has(button.dataset.placeType);
      button.dataset.found = String(collected);
      button.querySelector('.notebook-check').textContent = collected ? '✓' : '○';
      button.setAttribute('aria-label', `${CITY_PLACES[button.dataset.placeType].name}, ${collected ? 'discovered' : 'undiscovered'}. Set as destination`);
    }
  }
  update(active) {
    if (this.taxi?.running) { this.updateTaxi(); return; }
    $('next-city-stop').disabled = false; $('next-city-stop').textContent = 'Next stop';
    const vehicle = this.position(), e = this.exploration;
    const found = e.update(vehicle.s, vehicle.u, active);
    if (found.length) {
      this.notify(e.found.size === PLACE_TYPES.length ? 'All landmarks visited' : `${found[0].name} · ${e.found.size} / ${PLACE_TYPES.length}`);
      this.refreshNotebook();
    }
    const target = e.target, route = placeRoute(vehicle.s, vehicle.u, target), distance = routeDistance(route);
    $('city-stop-name').textContent = target?.name ?? 'Destination';
    $('city-stop-distance').textContent = e.justArrived?.id === target?.id ? 'Visited' : `${distance < 1000 ? `${Math.round(distance / 10) * 10} m` : `${(distance / 1000).toFixed(1)} km`}`;
    if (this.expanded) this.draw(vehicle, route);
  }
  updateTaxi() {
    const run = this.taxi, vehicle = this.position(), target = run.target;
    $('next-city-stop').disabled = run.status !== 'pickup';
    $('next-city-stop').textContent = run.status === 'pickup' ? `Next passenger · $${target.fare}` : `Fare $${run.fare.fare + run.tips}`;
    if (this.expanded) this.draw(vehicle, taxiRoute(vehicle, target), run.status === 'pickup' ? run.customers : [{ ...target, color: '#ffd238' }], target);
  }
  draw(vehicle, route, places = this.exploration.places, target = this.exploration.target) {
    const ctx = this.ctx, width = 208, height = 144, scale = .36;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.width !== width * ratio || this.canvas.height !== height * ratio) { this.canvas.width = width * ratio; this.canvas.height = height * ratio; }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#20383e'; ctx.fillRect(0, 0, width, height);
    const point = p => [width / 2 + (p.u - vehicle.u) * scale, height / 2 - (p.s - vehicle.s) * scale];
    const ix = Math.floor(vehicle.u / CITY_BLOCK), iz = Math.floor(vehicle.s / CITY_BLOCK);
    for (let x = ix - 4; x <= ix + 4; x++) for (let z = iz - 3; z <= iz + 3; z++) {
      const west = cityStreetProfile('north', x), east = cityStreetProfile('north', x + 1), south = cityStreetProfile('east', z), north = cityStreetProfile('east', z + 1);
      const b = cityBlock(x, z), [px, py] = point({ u: x * CITY_BLOCK + west.halfWidth, s: (z + 1) * CITY_BLOCK - north.halfWidth });
      const blockWidth = (CITY_BLOCK - west.halfWidth - east.halfWidth) * scale;
      ctx.fillStyle = b.kind === 'river' ? '#477e8b' : b.kind === 'park' || b.landmark === 'garden' ? '#4e705d' : b.landmark ? '#697369' : '#3a5155';
      ctx.fillRect(px, py, blockWidth, (CITY_BLOCK - south.halfWidth - north.halfWidth) * scale);
      if (b.kind === 'river') {
        ctx.fillStyle = '#718e8d'; ctx.fillRect(px, py - 6, blockWidth, 4);
      }
      ctx.fillStyle = '#7c9667';
      if (west.median) {
        const [start, end] = cityMedianRange('north', z), [mx, my] = point({ u: x * CITY_BLOCK, s: z * CITY_BLOCK + end });
        ctx.fillRect(mx - .6, my, 1.2, (end - start) * scale);
      }
      if (south.median && b.kind !== 'river') {
        const [start, end] = cityMedianRange('east', x), [mx, my] = point({ u: x * CITY_BLOCK + start, s: z * CITY_BLOCK });
        ctx.fillRect(mx, my - .6, (end - start) * scale, 1.2);
      }
    }
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = 2; ctx.strokeStyle = '#efca8b';
    ctx.beginPath(); route.forEach((p, i) => { const [x, y] = point(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke();
    for (const place of places) {
      const [x, y] = point(place), selected = place.id === target?.id;
      if (x < 5 || y < 5 || x > width - 5 || y > height - 5) continue;
      ctx.beginPath(); ctx.arc(x, y, selected ? 6 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = selected ? '#f5d69c' : place.color; ctx.fill();
      if (selected) { ctx.strokeStyle = '#fff4dc'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke(); }
    }
    if (target) {
      const [x, y] = point(target), dx = x - width / 2, dy = y - height / 2;
      const factor = Math.min(1, (width / 2 - 12) / Math.max(Math.abs(dx), .001), (height / 2 - 12) / Math.max(Math.abs(dy), .001));
      if (factor < 1) {
        ctx.save(); ctx.translate(width / 2 + dx * factor, height / 2 + dy * factor); ctx.rotate(Math.atan2(dy, dx));
        ctx.fillStyle = '#f5d69c'; ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill(); ctx.restore();
      }
    }
    ctx.save(); ctx.translate(width / 2, height / 2); ctx.rotate(vehicle.heading);
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 2); ctx.lineTo(-5, 5); ctx.closePath();
    ctx.fillStyle = '#fff9e9'; ctx.strokeStyle = '#163038'; ctx.lineWidth = 2; ctx.stroke(); ctx.fill(); ctx.restore();
    ctx.fillStyle = '#e2eee1'; ctx.font = 'bold 9px sans-serif'; ctx.fillText('N ↑', 10, 16);
    ctx.fillStyle = '#b3c4ba'; ctx.font = '8px sans-serif'; ctx.fillText('100 m', width - 37, height - 9);
    ctx.fillRect(width - 43, height - 19, 100 * scale, 1);
  }
}
