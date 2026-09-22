import { CITY_BLOCK as B, nearestCityStreet, cityStreetProfile, cityStreetAt } from './world/city-grid.js';
import { nearbyPlaces, routeDistance } from './city-exploration.js';
import { cityLayout, cityLogical, cityLanePose, cityRoutePoints } from './world/city-layout.js';
import { randomAt } from './world/route.js';
import { TaxiFleet } from './taxi-fleet.js';

export const SHIFT_SECONDS = 90;
export const STOP_RADIUS = 8;
export const STOP_SECONDS = .45;
export const GROUP_MAX_LEG = 650;
// How far a hop between drop-offs may wander from the straight line. A grid
// costs about √2 on a diagonal, so anything beyond this is a river, a dead end
// or a hop that doubles back through the block it started on.
export const GROUP_MAX_DETOUR = 1.45;
export const GROUP_MAX_ROUTE = 2200;
export const MAX_SHIFT_SECONDS = 180;
// Cosine of the sharpest turn a party route may take between two drop-offs,
// about 105°. Street routes zigzag, so demanding a strictly forward hop left
// most full cabs with nowhere legal to go.
export const GROUP_MIN_TURN = -.25;
// Each hop samples a handful of the closest unused places; the chain is built
// for every waiting ring, so the route tracing has to stay cheap.
const GROUP_CANDIDATES = 6;
const CUSTOMER_RANGE = B * 3;
const CUSTOMER_COLORS = ['#a4f264', '#54dfe0', '#f8ba55', '#d6adff', '#ffaaa1', '#9dcaff'];
// Long trips should earn back more of their travel time, without making the
// shift self-sustaining simply by completing every fare before its deadline.
export const deliverySeconds = length => 18 + Math.min(12, Math.round(Math.max(0, length - 400) / 60));
const distance = (a, b) => Math.hypot(a.s - b.s, a.u - b.u);
export const turnCosine = (from, via, to) => {
  const ax = via.s - from.s, ay = via.u - from.u, bx = to.s - via.s, by = to.u - via.u;
  return (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1);
};
const PASSENGERS = {
  clock: 'Sightseer', market: 'Market shopper', garden: 'Garden visitor', depot: 'Tram driver', art: 'Art student',
  cinema: 'Moviegoer', hotel: 'Hotel guest', museum: 'Museum visitor', station: 'Rail commuter', library: 'Reader',
  hospital: 'Hospital visitor', observatory: 'Stargazer', music: 'Jazz fan', sports: 'Club member', firehouse: 'Firefighter',
  park: 'Park visitor', plaza: 'Cafe regular',
  postoffice: 'Postal worker', bathhouse: 'Morning swimmer', farmersmarket: 'Market gardener',
  donut: 'Coffee regular',
  cityhall: 'City clerk',
};
const PASSENGER_TYPES = Object.keys(PASSENGERS);

// Parties board in one beat and every rider keeps their own destination: a
// four-seat party is four real drop-offs. The chain is grown one hop at a
// time, always nearby and never doubling back, so a full cab reads as one
// route rather than four errands. A rider whose stop will not fit never
// boards, which keeps the count on the ring equal to the stops ahead.
export function partySize(seed) {
  const roll = randomAt(seed, 20010);
  return roll < .5 ? 1 : roll < .73 ? 2 : roll < .91 ? 3 : 4;
}
// Bigger parties start with a shorter first ride, leaving room in the route
// for everyone else's stop.
const FIRST_LEG_MAX = [0, 1100, 800, 650, 500];

function partyOffer(stop, destination, length, wanted) {
  const stops = [{ destination, passengers: 1, length }];
  let previous = stop, from = destination, totalLength = length;
  while (stops.length < wanted) {
    const taken = new Set(stops.map(leg => leg.destination.id));
    // Look around the rider who just got out, not around the pickup: a long
    // chain would otherwise run off the edge of the pickup's own window.
    const candidates = nearbyPlaces(from.s, from.u, 6).map(place => ({ ...placeStop(place), id: place.id }))
      .filter(next => !taken.has(next.id)
      && distance(from, next) >= 45 && distance(from, next) <= GROUP_MAX_LEG
      // Keep roughly heading the way the cab is already pointed.
      && turnCosine(previous, from, next) >= GROUP_MIN_TURN)
      .sort((a, b) => distance(from, a) - distance(from, b) || a.id.localeCompare(b.id))
      .slice(0, GROUP_CANDIDATES);
    let chosen = null;
    for (const next of candidates) {
      const leg = routeDistance(taxiRoute(from, next));
      if (leg > GROUP_MAX_LEG || leg > distance(from, next) * GROUP_MAX_DETOUR) continue;
      if (totalLength + leg > GROUP_MAX_ROUTE) continue;
      chosen = { destination: next, passengers: 1, length: leg };
      break;
    }
    if (!chosen) break;
    stops.push(chosen); previous = from; from = chosen.destination; totalLength += chosen.length;
  }
  const passengers = stops.length;
  const fare = Math.round((40 + totalLength * .28) * (1 + (passengers - 1) * .35));
  // Allocate integer dollars once, so the riders split the fare exactly. Each
  // drop-off banks its own share immediately if the party later runs out.
  let allocated = 0;
  for (const [index, leg] of stops.entries()) {
    leg.fare = index === stops.length - 1 ? fare - allocated : Math.round(fare / passengers);
    allocated += leg.fare;
  }
  return { passengers, stops, destination: stops[0].destination, length: totalLength, fare,
    limit: Math.ceil(18 + totalLength / 14 + (stops.length - 1) * 10),
    groupBonus: (passengers - 1) * 25 };
}

export function taxiRoute(player, target) {
  if (!target) return [];
  const address = p => { const n = nearestCityStreet(p.s, p.u); return { s: n.logicalS, u: n.logicalU, axis: n.axis }; };
  const a = address(player), b = address(target);
  player = cityLogical(player.s, player.u); target = cityLogical(target.s, target.u);
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
  return cityRoutePoints(points);
}

export function leadStop(player) {
  const road = nearestCityStreet(player.s, player.u), north = road.axis === 'north';
  const along = north ? road.logicalS : road.logicalU;
  const tangent = cityLanePose(road.axis, road.index * B, along);
  const direction = Math.cos(player.heading - tangent.heading) >= 0 ? 1 : -1;
  let middle = Math.floor(along / B) * B + B / 2;
  if ((middle - along) * direction < 30) middle += direction * B;
  const street = cityStreetProfile(road.axis, road.index);
  const lane = road.index * B + (north ? 1 : -1) * street.lane * direction;
  let pose = cityLanePose(road.axis, lane, middle, direction);
  if ((pose.s - player.s) * Math.cos(player.heading) + (pose.u - player.u) * Math.sin(player.heading) < 30) {
    middle += direction * B; pose = cityLanePose(road.axis, lane, middle, direction);
  }
  return { ...pose, axis: road.axis, index: road.index, side: direction };
}
const placeStop = place => {
  const p = place.logicalS === undefined ? cityLogical(place.s, place.u) : { s: place.logicalS, u: place.logicalU };
  const center = p.s - B / 2, index = Math.round(center / B), street = cityStreetProfile('east', index);
  return { ...cityLanePose('east', center - street.lane, p.u), axis: 'east', index, side: 1, name: place.name, type: place.type, district: place.district };
};

// Stable street addresses make pickups agree across overlapping neighborhoods.
// Only the nearby window is materialized; the city has no finite offer list.
function nearbyCustomerStops(player) {
  const address = cityLogical(player.s, player.u), ix = Math.floor(address.u / B), iz = Math.floor(address.s / B);
  const stops = [];
  for (let x = ix - 3; x <= ix + 3; x++) for (let z = iz - 3; z <= iz + 3; z++) {
    // One pickup site per two blocks, with a seeded street, curb and position.
    if ((x + z) % 2 !== 0) continue;
    const axis = randomAt(x, z + 19110) < .5 ? 'north' : 'east';
    const north = axis === 'north', index = north ? x : z, segment = north ? z : x;
    const variation = randomAt(x, z + (north ? 19210 : 19310));
    const side = variation < .5 ? -1 : 1, street = cityStreetProfile(axis, index);
    const along = (segment + .3 + randomAt(x, z + (north ? 19410 : 19510)) * .4) * B;
    const lane = index * B + (north ? 1 : -1) * street.lane * side;
    const stop = { ...cityLanePose(axis, lane, along, side), axis, index, side, id: `${axis}:${index}:${segment}`,
      fareSeed: Math.floor(randomAt(x, z + 19610) * 0xffffffff) };
    if (distance(stop, player) <= CUSTOMER_RANGE && !cityStreetAt(stop.s, stop.u).bridge) stops.push(stop);
  }
  return stops.sort((a, b) => distance(a, player) - distance(b, player) || a.id.localeCompare(b.id));
}

export class TaxiRun {
  constructor(storage = null) {
    this.fleet = new TaxiFleet(storage);
    this.storage = storage; this.best = 0; this.status = 'idle'; this.events = []; this.revision = 0;
    try { const best = Number(storage?.getItem('citydriver-taxi-best')); if (Number.isFinite(best) && best > 0) this.best = Math.floor(best); } catch { /* Optional storage. */ }
  }
  get running() { return this.status === 'pickup' || this.status === 'driving'; }
  get currentStop() { return this.status === 'driving' ? this.fare.stops[this.stopIndex] : null; }
  get target() { return this.currentStop?.destination ?? null; }
  get remainingFare() { return this.status === 'driving' ? this.fare.stops.slice(this.stopIndex).reduce((sum, stop) => sum + stop.fare, 0) + this.fare.groupBonus : 0; }
  start(player) {
    this.status = 'pickup'; this.timeLeft = SHIFT_SECONDS; this.cash = 0; this.delivered = 0; this.failed = 0;
    this.boost = 1; this.boostActive = false; this.elapsed = 0; this.combo = 1; this.comboTime = 0;
    this.tips = 0; this.hold = 0; this.fare = null; this.events = []; this.driftTime = 0; this.crashCooldown = 0;
    this.recentDestinations = []; this.customers = []; this.boarding = null; this.blockedPickup = null;
    this.servedCustomers = new Map();
    this.stopIndex = 0; this.onboard = 0; this.deliveredPassengers = 0;
    this.lastImpact = player.audioTelemetry?.impactSerial ?? 0; this.makeCustomers(player);
    // Starting inside a ring must not choose the first fare for the driver.
    this.blockedPickup = this.customers.find(p => distance(p, player) < STOP_RADIUS) ?? null;
  }
  stop() { this.status = 'idle'; this.customers = []; this.servedCustomers?.clear(); this.fare = null; this.boarding = null; this.hold = 0; this.onboard = 0; this.stopIndex = 0; this.boostActive = false; this.revision++; }
  makeCustomers(player) {
    const previous = this.customers;
    for (const [id, until] of this.servedCustomers) if (until <= this.elapsed) this.servedCustomers.delete(id);
    const waiting = new Map(previous.map(customer => [customer.id, customer]));
    const stops = nearbyCustomerStops(player).filter(stop => !this.servedCustomers.has(stop.id))
      .map(stop => waiting.get(stop.id) ?? stop);
    this.customers = stops.map(stop => {
      if (stop.destination) return stop;
      // Derive the entire offer from this pickup, not the driver's approach
      // or trip history, so unloading and revisiting recreates the same fare.
      const wanted = partySize(stop.fareSeed), maxLength = FIRST_LEG_MAX[wanted];
      const destinations = nearbyPlaces(stop.s, stop.u, 6).map(place => ({ ...placeStop(place), id: place.id }));
      // Rank cheaply before tracing any streets. Usually only one or two
      // routes need sampling, even when many new blocks enter the window.
      const choices = destinations.filter(destination => distance(stop, destination) <= 1100)
        .map((destination, j) => ({ destination, variety: randomAt(stop.fareSeed, j + 19710),
          rank: randomAt(stop.fareSeed, PASSENGER_TYPES.indexOf(destination.type) + 19810) }))
        .sort((a, b) => a.rank - b.rank || a.variety - b.variety);
      // A party prefers a shorter first ride but settles for any ordinary fare.
      let route, fallback;
      for (const { destination } of choices) {
        const length = routeDistance(taxiRoute(stop, destination));
        if (length < 280 || length > 1100) continue;
        fallback ??= { destination, length };
        if (length <= maxLength) { route = { destination, length }; break; }
      }
      route ??= fallback;
      const address = cityLogical(stop.s, stop.u);
      const destination = route?.destination ?? placeStop({ ...cityLayout(Math.round(address.s / B) * B + B / 2, Math.round(address.u / B) * B + 3.5 * B), name: 'Downtown' });
      const length = route?.length ?? routeDistance(taxiRoute(stop, destination));
      const party = partyOffer(stop, destination, length, wanted);
      return { ...stop, name: PASSENGERS[party.destination.type] ?? 'Passenger', ...party,
        color: CUSTOMER_COLORS[Math.floor(randomAt(stop.fareSeed, 19910) * CUSTOMER_COLORS.length)] };
    });
    this.customerCenter = { s: player.s, u: player.u };
    this.nextCustomerRefresh = this.elapsed + 1;
    if (previous.length !== this.customers.length || previous.some((stop, i) => stop !== this.customers[i])) this.revision++;
  }
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
    this.status = 'over'; this.boostActive = false; this.boarding = null; this.hold = 0; this.onboard = 0; this.revision++;
    this.best = Math.max(this.best, this.cash);
    try { this.storage?.setItem('citydriver-taxi-best', String(this.best)); } catch { /* Optional storage. */ }
    this.events.push({ kind: 'over' });
  }
  update(dt, player, traffic = []) {
    if (!this.running || !Number.isFinite(dt) || dt <= 0) return;
    this.elapsed += dt; this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft <= 0) { this.finish(); return; }
    this.comboTime -= dt; if (this.comboTime <= 0) this.combo = 1;
    this.crashCooldown = Math.max(0, this.crashCooldown - dt);
    const impact = player.audioTelemetry?.impactSerial ?? 0;
    const collided = impact !== this.lastImpact;
    if (collided) {
      this.lastImpact = impact;
      if (this.status === 'driving' && (player.audioTelemetry?.impact ?? 0) > 3) {
        // A wall scrape or traffic pileup can report contacts every tick. Charge
        // once until the cab has been clear for a moment, and suspend stunt tips.
        if (this.crashCooldown === 0) {
          const lost = Math.ceil(this.tips / 2); this.tips -= lost;
          this.events.push({ kind: 'crash', text: lost ? `Crash −$${lost} tips` : 'Crash · Combo lost' });
        }
        this.combo = 1; this.comboTime = 0; this.driftTime = 0; this.crashCooldown = .8;
      }
    }
    if (this.status === 'pickup') {
      if (this.elapsed >= this.nextCustomerRefresh) {
        this.nextCustomerRefresh = this.elapsed + 1;
        if (distance(player, this.customerCenter) > B / 2) this.makeCustomers(player);
      }
      // The driver chooses a fare by stopping in its ring. Boarding is never
      // a navigation target and cannot carry progress between passengers.
      if (this.blockedPickup && distance(this.blockedPickup, player) >= STOP_RADIUS) this.blockedPickup = null;
      const passenger = Math.abs(player.speed) < 2.5
        ? this.customers.find(p => p.id !== this.blockedPickup?.id && distance(p, player) < STOP_RADIUS) : null;
      if (passenger?.id !== this.boarding?.id) this.hold = 0;
      this.boarding = passenger;
      this.hold = passenger ? this.hold + dt : 0;
      if (this.hold >= STOP_SECONDS) {
        this.fare = passenger; this.fareLeft = passenger.limit; this.status = 'driving'; this.boarding = null;
        this.stopIndex = 0; this.onboard = passenger.passengers;
        this.customers = this.customers.filter(customer => customer !== passenger);
        this.servedCustomers.set(passenger.id, this.elapsed + 60);
        this.hold = 0; this.tips = 0; this.combo = 1; this.driftTime = 0; this.passed = new WeakSet(); this.revision++;
        this.events.push({ kind: 'pickup', text: passenger.destination.name });
      }
      return;
    }
    this.fareLeft = Math.max(0, this.fareLeft - dt);
    if (this.fareLeft <= 0) {
      const partial = this.stopIndex > 0;
      this.failed++; this.status = 'pickup'; this.fare = null; this.hold = 0; this.onboard = 0; this.stopIndex = 0; this.tips = 0; this.combo = 1; this.revision++; this.makeCustomers(player);
      this.blockedPickup = this.customers.find(p => distance(p, player) < STOP_RADIUS) ?? null;
      this.events.push({ kind: 'missed', text: partial ? 'Group unfinished · earned cash kept' : 'Fare lost' }); return;
    }
    if (player.drifting && Math.abs(player.speed) > 10 && this.crashCooldown === 0) {
      this.driftTime += dt;
      if (this.driftTime >= .65) { this.driftTime -= .65; this.reward('Drift', 5); }
    } else this.driftTime = 0;
    if (Math.abs(player.speed) > 14 && !collided && this.crashCooldown === 0) {
      for (const car of traffic) {
        const carHeading = car.heading ?? (car.axis === 'east' ? car.direction * Math.PI / 2 : car.direction < 0 ? Math.PI : 0);
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
    this.hold = distance(this.target, player) < STOP_RADIUS && Math.abs(player.speed) < 2.5 ? this.hold + dt : 0;
    if (this.hold >= STOP_SECONDS) {
      const stop = this.currentStop, last = this.stopIndex === this.fare.stops.length - 1;
      const speedBonus = Math.round(stop.fare * .5 * this.fareLeft / this.fare.limit);
      const bonus = last ? this.fare.groupBonus : 0;
      const paid = stop.fare + this.tips + speedBonus + bonus;
      // Every rider delivered is their own time bonus, as in Crazy Taxi 2: a
      // full cab is the fastest way to keep the shift clock alive.
      const seconds = deliverySeconds(stop.length);
      this.cash += paid; this.deliveredPassengers += stop.passengers; this.onboard -= stop.passengers;
      this.timeLeft = Math.min(MAX_SHIFT_SECONDS, this.timeLeft + seconds);
      this.fleet.credit(paid);
      this.recentDestinations = [...this.recentDestinations, stop.destination.type].slice(-3);
      const celebration = bonus ? 'Group complete! ' : !last ? `Rider ${this.stopIndex + 1} of ${this.fare.passengers} · ` : '';
      this.events.push({ kind: 'paid', text: `${celebration}+$${paid} · +${seconds}s`, paid, bonus, seconds, passengers: stop.passengers, destination: stop.destination, groupComplete: last && this.fare.passengers > 1 });
      if (this.fare.passengers > 1) this.boost = Math.min(1, this.boost + .25);
      if (!last) {
        this.stopIndex++; this.tips = 0; this.hold = 0; this.driftTime = 0; this.revision++;
        // Preserve the stunt combo and timer, with enough grace to pull away.
        this.comboTime = Math.max(this.comboTime, 4);
        return;
      }
      this.delivered++; this.stopIndex = 0;
      this.status = 'pickup'; this.fare = null; this.tips = 0; this.combo = 1; this.hold = 0;
      this.revision++; this.makeCustomers(player);
      // Overlapping pickups wait until the driver leaves the ring.
      this.blockedPickup = this.customers.find(p => distance(p, player) < STOP_RADIUS) ?? null;
    }
  }
  drainEvents() { return this.events.splice(0); }
}
