import { CITY_BLOCK as B, nearestCityStreet } from './world/city-grid.js';
import { nearbyPlaces, routeDistance } from './city-exploration.js';

export const SHIFT_SECONDS = 90;
export const STOP_RADIUS = 8;
export const STOP_SECONDS = .45;
const distance = (a, b) => Math.hypot(a.s - b.s, a.u - b.u);

export function taxiRoute(player, target) {
  if (!target) return [];
  const a = nearestCityStreet(player.s, player.u), b = nearestCityStreet(target.s, target.u);
  const points = [{ s: player.s, u: player.u }, { s: a.s, u: a.u }];
  if (a.axis !== b.axis) points.push(a.axis === 'north' ? { s: b.s, u: a.u } : { s: a.s, u: b.u });
  else if (a.axis === 'north' && a.u !== b.u) {
    const s = Math.round((a.s + b.s) / (2 * B)) * B;
    points.push({ s, u: a.u }, { s, u: b.u });
  } else if (a.axis === 'east' && a.s !== b.s) {
    const u = Math.round((a.u + b.u) / (2 * B)) * B;
    points.push({ s: a.s, u }, { s: b.s, u });
  }
  points.push({ s: b.s, u: b.u }, { s: target.s, u: target.u });
  return points;
}

export function leadStop(player) {
  const road = nearestCityStreet(player.s, player.u), north = road.axis === 'north';
  const direction = (north ? Math.cos(player.heading) : Math.sin(player.heading)) >= 0 ? 1 : -1;
  const along = north ? player.s : player.u;
  let middle = Math.floor(along / B) * B + B / 2;
  if ((middle - along) * direction < 30) middle += direction * B;
  return north ? { s: middle, u: road.u + 3 * direction, axis: 'north', side: direction }
    : { s: road.s - 3 * direction, u: middle, axis: 'east', side: direction };
}
const placeStop = place => ({ s: place.s - B / 2 - 3, u: place.u, axis: 'east', side: 1, name: place.name });

export class TaxiRun {
  constructor(storage = null) {
    this.storage = storage; this.best = 0; this.status = 'idle'; this.events = []; this.revision = 0;
    try { const best = Number(storage?.getItem('citydriver-taxi-best')); if (Number.isFinite(best) && best > 0) this.best = Math.floor(best); } catch { /* Optional storage. */ }
  }
  get running() { return this.status === 'pickup' || this.status === 'driving'; }
  get target() { return this.status === 'driving' ? this.fare.destination : this.customers?.[this.selected] ?? null; }
  start(player) {
    this.status = 'pickup'; this.timeLeft = SHIFT_SECONDS; this.cash = 0; this.delivered = 0; this.failed = 0;
    this.boost = 1; this.boostActive = false; this.elapsed = 0; this.combo = 1; this.comboTime = 0;
    this.tips = 0; this.hold = 0; this.fare = null; this.events = []; this.driftTime = 0;
    this.lastImpact = player.audioTelemetry?.impactSerial ?? 0; this.makeCustomers(player);
  }
  stop() { this.status = 'idle'; this.customers = []; this.fare = null; this.boostActive = false; this.revision++; }
  makeCustomers(player) {
    const places = nearbyPlaces(player.s, player.u, 6);
    const stops = [leadStop(player), ...places.slice(0, 2).map(placeStop)];
    this.customers = stops.map((stop, i) => {
      const choices = places.map(place => ({ ...placeStop(place), id: place.id }))
        .map(destination => ({ destination, length: routeDistance(taxiRoute(stop, destination)) }))
        .filter(route => route.length >= 280 && route.length <= 1100);
      const route = choices[(this.delivered * 3 + this.failed + i * 2) % choices.length];
      // A grid fallback keeps a fare valid even if a future map has no POIs.
      const destination = route?.destination ?? { s: Math.round(stop.s / B) * B - 3, u: Math.round(stop.u / B) * B + 3.5 * B, axis: 'east', side: 1, name: 'Downtown' };
      const length = route?.length ?? routeDistance(taxiRoute(stop, destination));
      return { ...stop, id: `${this.revision}-${i}`, name: 'Passenger', destination, length,
        fare: Math.round(40 + length * .28), limit: Math.ceil(18 + length / 14), color: i === 0 ? '#a4f264' : i === 1 ? '#54dfe0' : '#f8ba55' };
    });
    this.selected = 0; this.hold = 0; this.revision++;
  }
  next() { if (this.status === 'pickup') this.selected = (this.selected + 1) % this.customers.length; }
  controls(dt, input) {
    const gas = input.forward > 0 || input.touchDrive?.amount > .1;
    this.boostActive = this.running && Boolean(input.boost) && gas && !input.brake && !input.handbrake && this.boost > .01;
    if (this.running) this.boost = Math.max(0, Math.min(1, this.boost + dt * (this.boostActive ? -.44 : input.boost ? 0 : .16)));
    return { ...input, boost: this.boostActive };
  }
  reward(kind, amount) {
    const tip = amount * this.combo; this.tips += tip;
    this.events.push({ kind: 'tip', text: `${kind} +$${tip}`, combo: this.combo });
    this.combo = Math.min(3, this.combo + 1); this.comboTime = 4;
  }
  finish() {
    this.status = 'over'; this.boostActive = false; this.hold = 0; this.revision++;
    this.best = Math.max(this.best, this.cash);
    try { this.storage?.setItem('citydriver-taxi-best', String(this.best)); } catch { /* Optional storage. */ }
    this.events.push({ kind: 'over' });
  }
  update(dt, player, traffic = []) {
    if (!this.running || !Number.isFinite(dt) || dt <= 0) return;
    this.elapsed += dt; this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft <= 0) { this.finish(); return; }
    this.comboTime -= dt; if (this.comboTime <= 0) this.combo = 1;
    const impact = player.audioTelemetry?.impactSerial ?? 0;
    const collided = impact !== this.lastImpact;
    if (collided) {
      this.lastImpact = impact;
      if (this.status === 'driving' && (player.audioTelemetry?.impact ?? 0) > 3) {
        const lost = Math.ceil(this.tips / 2); this.tips -= lost; this.combo = 1; this.driftTime = 0;
        this.events.push({ kind: 'crash', text: lost ? `Crash −$${lost} tips` : 'Crash · Combo lost' });
      }
    }
    if (this.status === 'pickup') {
      const passenger = this.customers.find(p => distance(p, player) < STOP_RADIUS);
      if (passenger) this.selected = this.customers.indexOf(passenger);
      this.hold = passenger && Math.abs(player.speed) < 2.5 ? this.hold + dt : 0;
      if (this.hold >= STOP_SECONDS) {
        this.fare = passenger; this.fareLeft = passenger.limit; this.status = 'driving';
        this.hold = 0; this.tips = 0; this.combo = 1; this.driftTime = 0; this.passed = new WeakSet(); this.revision++;
        this.events.push({ kind: 'pickup', text: passenger.destination.name });
      }
      return;
    }
    this.fareLeft = Math.max(0, this.fareLeft - dt);
    if (this.fareLeft <= 0) {
      this.failed++; this.status = 'pickup'; this.tips = 0; this.combo = 1; this.makeCustomers(player);
      this.events.push({ kind: 'missed', text: 'Fare lost' }); return;
    }
    if (player.drifting && Math.abs(player.speed) > 10) {
      this.driftTime += dt;
      if (this.driftTime >= 1) { this.driftTime -= 1; this.reward('Drift', 5); }
    } else this.driftTime = 0;
    if (Math.abs(player.speed) > 14 && !collided) {
      for (const car of traffic) {
        const carHeading = car.axis === 'east' ? car.direction * Math.PI / 2 : car.direction < 0 ? Math.PI : 0;
        if (this.passed.has(car) || Math.abs(player.speed - car.speed * Math.cos(carHeading - player.heading)) < 7) continue;
        const ds = car.s - player.s, du = car.u - player.u;
        const along = ds * Math.cos(player.heading) + du * Math.sin(player.heading);
        const across = Math.abs(du * Math.cos(player.heading) - ds * Math.sin(player.heading));
        const clearance = (player.spec?.width ?? 2) / 2 + (car.spec?.width ?? 2) / 2 + .4;
        if (Math.abs(along) < 2.5 && across > clearance && across < clearance + 2.5) {
          this.passed.add(car); this.reward('Near miss', 10);
        }
      }
    }
    this.hold = distance(this.fare.destination, player) < STOP_RADIUS && Math.abs(player.speed) < 2.5 ? this.hold + dt : 0;
    if (this.hold >= STOP_SECONDS) {
      const speedBonus = Math.round(this.fare.fare * .5 * this.fareLeft / this.fare.limit);
      const paid = this.fare.fare + this.tips + speedBonus, seconds = 18;
      this.cash += paid; this.delivered++; this.timeLeft = Math.min(120, this.timeLeft + seconds);
      this.events.push({ kind: 'paid', text: `+$${paid} · +${seconds}s`, paid });
      this.status = 'pickup'; this.fare = null; this.tips = 0; this.combo = 1; this.makeCustomers(player);
    }
  }
  drainEvents() { return this.events.splice(0); }
}
