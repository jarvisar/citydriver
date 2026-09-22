import { cityCell } from './world/city-grid.js';
import { CityMapCache } from './city-map.js';
import { CITY_PLACES, PLACE_TYPES } from './world/city-places.js';
import { CityExploration, placeRoute, routeDistance } from './city-exploration.js';
import { taxiRoute } from './taxi-run.js';

const $ = id => document.getElementById(id);
const MAP_SCALE = .36;
export class CityGuide {
  constructor(notify, position) {
    let storage; try { storage = localStorage; } catch { /* Optional storage. */ }
    this.exploration = new CityExploration(storage); this.notify = notify; this.position = position;
    this.mapCache = new CityMapCache();
    this.canvas = $('city-map'); this.ctx = this.canvas.getContext('2d'); this.expanded = true;
    this.canvas.addEventListener('click', event => {
      if (this.taxi?.status !== 'pickup') return;
      const rect = this.canvas.getBoundingClientRect(), vehicle = this.position();
      const x = (event.clientX - rect.left) * 208 / rect.width, y = (event.clientY - rect.top) * 144 / rect.height;
      let closest = null, radius = 12;
      for (const customer of this.taxi.customers) {
        const cx = 104 + (customer.u - vehicle.u) * MAP_SCALE, cy = 72 - (customer.s - vehicle.s) * MAP_SCALE;
        if (cx < 5 || cy < 5 || cx > 203 || cy > 139) continue;
        const d = Math.hypot(cx - x, cy - y);
        if (d < radius) { closest = customer; radius = d; }
      }
      if (closest && this.taxi.select(closest.id)) this.updateTaxi();
    });
    $('city-notebook').innerHTML = PLACE_TYPES.map(type => `<button type="button" class="notebook-place" data-place-type="${type}" title="${CITY_PLACES[type].description}" style="--place-color:${CITY_PLACES[type].color}"><span class="notebook-stamp">${CITY_PLACES[type].symbol}</span><span><strong>${CITY_PLACES[type].name}</strong><small>${CITY_PLACES[type].short}</small></span><span class="notebook-check" aria-hidden="true">○</span></button>`).join('');
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
      ? `${PLACE_TYPES.length} / ${PLACE_TYPES.length} visited`
      : `${found.size} / ${PLACE_TYPES.length} visited`;
    for (const button of document.querySelectorAll('[data-place-type]')) {
      const collected = found.has(button.dataset.placeType);
      button.dataset.found = String(collected);
      button.querySelector('.notebook-check').textContent = collected ? '✓' : '○';
      button.setAttribute('aria-label', `${CITY_PLACES[button.dataset.placeType].name}, ${collected ? 'discovered' : 'undiscovered'}. Set as destination`);
    }
  }
  update(active) {
    const vehicle = this.position(), e = this.exploration;
    const found = e.update(vehicle.s, vehicle.u, active);
    if (found.length) {
      this.notify(e.found.size === PLACE_TYPES.length ? 'All landmarks visited' : `${found[0].name} · ${e.found.size} / ${PLACE_TYPES.length}`);
      this.refreshNotebook();
    }
    if (this.taxi?.running) { this.updateTaxi(); return; }
    $('next-city-stop').disabled = false; $('next-city-stop').textContent = 'Next stop';
    const target = e.target, route = placeRoute(vehicle.s, vehicle.u, target), distance = routeDistance(route);
    $('city-stop-name').textContent = target?.name ?? 'Destination';
    $('city-stop-context').textContent = target ? `${target.short} · ${target.district}` : '';
    $('city-stop-distance').textContent = e.justArrived?.id === target?.id ? 'Visited' : `${distance < 1000 ? `${Math.round(distance / 10) * 10} m` : `${(distance / 1000).toFixed(1)} km`}`;
    if (this.expanded) this.draw(vehicle, route);
  }
  updateTaxi() {
    const run = this.taxi, vehicle = this.position(), target = run.target;
    $('next-city-stop').disabled = run.status !== 'pickup';
    $('next-city-stop').textContent = run.status === 'pickup'
      ? target ? `Next passenger · $${target.fare}` : 'Choose passenger'
      : `Fare $${run.fare.fare + run.tips}`;
    this.canvas.title = run.status === 'pickup' ? 'Tap a customer dot to choose your pickup' : 'Route to the drop-off';
    if (this.expanded) this.draw(vehicle, taxiRoute(vehicle, target), run.status === 'pickup' ? run.customers : [{ ...target, color: '#ffd238' }], target);
  }
  draw(vehicle, route, places = this.exploration.places, target = this.exploration.target) {
    const ctx = this.ctx, width = 208, height = 144, scale = MAP_SCALE;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.floor(width * ratio), pixelHeight = Math.floor(height * ratio);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) { this.canvas.width = pixelWidth; this.canvas.height = pixelHeight; }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#20383e'; ctx.fillRect(0, 0, width, height);
    const point = p => [width / 2 + (p.u - vehicle.u) * scale, height / 2 - (p.s - vehicle.s) * scale];
    const { ix, iz } = cityCell(vehicle.s, vehicle.u);
    this.mapCache.update(ix, iz);
    this.mapCache.draw(ctx, vehicle, scale, width, height);
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
