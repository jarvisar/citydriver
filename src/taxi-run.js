import { CITY_BLOCK as B, nearestCityStreet, cityStreetProfile, cityStreetAt } from './world/city-grid.js';
import { nearbyPlaces, routeDistance } from './city-exploration.js';
import { cityLayout, cityLogical, cityLanePose, cityRoutePoints } from './world/city-layout.js';
import { randomAt } from './world/route.js';
import { TaxiFleet } from './taxi-fleet.js';

export const SHIFT_SECONDS = 90;
export const STOP_RADIUS = 8;
export const STOP_SECONDS = .45;
export const GROUP_MAX_LEG = 650;
// Max route/straight-line ratio for a hop between drop-offs. A grid costs about
// √2 on a diagonal; beyond this the hop crosses a river, dead-ends or doubles back.
export const GROUP_MAX_DETOUR = 1.45;
export const GROUP_MAX_ROUTE = 2200;
export const MAX_SHIFT_SECONDS = 180;
// Cosine of the sharpest turn allowed between drop-offs (about 105°). Street
// routes zigzag, so requiring strictly forward hops stranded most full cabs.
export const GROUP_MIN_TURN = -.25;
// Chains are built for every waiting ring, so route tracing per hop stays cheap.
const GROUP_CANDIDATES = 6;
const CUSTOMER_RANGE = B * 3;
// Pickups and destinations are placed independently; without this, about one
// drop-off in four landed beside or inside a fresh ring.
export const DROP_OFF_CLEARANCE = 60;
// A waiting fare's colour shows the whole job's length, red short to green long.
export const FARE_BANDS = [
  { id: 'hop', label: 'Quick hop', color: '#ff5a4a', below: 550 },
  { id: 'short', label: 'Short ride', color: '#ff9c33', below: 800 },
  { id: 'medium', label: 'Medium ride', color: '#ffe03d', below: 1100 },
  { id: 'long', label: 'Long ride', color: '#5fe06a', below: Infinity },
];
export const fareBand = length => FARE_BANDS.find(band => length < band.below);
// Arrival ratings by the share of a rider's own clock left. A rider who steps
// out before a group's last stop adds only `riderSeconds`; the group's travel
// time is paid at the last stop.
export const RATINGS = [
  { id: 'speedy', label: 'Speedy', remaining: .5, seconds: 5, riderSeconds: 2 },
  { id: 'normal', label: 'Normal', remaining: .25, seconds: 2, riderSeconds: 1 },
  { id: 'slow', label: 'Slow', remaining: 0, seconds: 0, riderSeconds: 0 },
];
export const arrivalRating = remaining => RATINGS.find(rating => remaining >= rating.remaining);
export const legLimit = length => Math.ceil(18 + length / 14);
export const PICKUP_SECONDS = 6;
export const PICKUP_EXTRA_SECONDS = 2;
export const pickupSeconds = passengers => PICKUP_SECONDS + PICKUP_EXTRA_SECONDS * (passengers - 1);
// A fare pays back its route length in seconds at this pace (m/s), so driving
// slower than this drains the shift regardless of how many riders are aboard.
export const METERS_PER_SECOND_EARNED = 33;
export const deliverySeconds = (length, rating = RATINGS.at(-1)) =>
  Math.round(length / METERS_PER_SECOND_EARNED) + rating.seconds;
// Speedy arrivals in a row add a second each to a fare's time bonus.
export const STREAK_MAX_SECONDS = 3;
export const streakSeconds = streak => Math.min(STREAK_MAX_SECONDS, Math.max(0, streak - 1));
// Metres of route progress needed between tips, so circling a block to drift
// earns nothing once the cab stops closing in.
export const TIP_PROGRESS = 6;
// Each trick tips its base × the chain × the riders aboard.
export const COMBO_MAX = 10;
export const COMBO_SECONDS = 4;
export const TIPS = { drift: 2, nearMiss: 5, crazyStop: 5 };
export const STUNT_BOOST = .08;
// A handbrake stop inside the ring from this speed (m/s) or more is a Crazy stop.
export const CRAZY_STOP_SPEED = 12;
// Pace (m/s) fare clocks are set for. The pickup preview warns when the shift
// would run out before a fare ends at this pace, since a group pays nothing if
// the shift ends with riders still aboard.
export const EASY_PACE = 14;
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

// Every rider in a party has their own drop-off. The chain grows one nearby hop
// at a time without doubling back, and a rider whose stop will not fit never
// boards, so the count on the ring always equals the stops ahead.
export function partySize(seed) {
  const roll = randomAt(seed, 20010);
  return roll < .5 ? 1 : roll < .73 ? 2 : roll < .91 ? 3 : 4;
}
// Bigger parties get a shorter first ride, leaving room for the other stops.
const FIRST_LEG_MAX = [0, 1100, 800, 650, 500];
// Each extra rider adds a fifth to the distance fare. Groups already pay best
// through the per-rider bonus and multiplied tips, so this stays small enough
// that a single rider is still worth stopping for.
export const GROUP_FARE_SHARE = .2;

function partyOffer(stop, destination, length, wanted) {
  const stops = [{ destination, passengers: 1, length }];
  let previous = stop, from = destination, totalLength = length;
  while (stops.length < wanted) {
    const taken = new Set(stops.map(leg => leg.destination.id));
    // Search around the last drop-off, not the pickup: a long chain would
    // otherwise run off the edge of the pickup's own window.
    const candidates = nearbyPlaces(from.s, from.u, 6).map(place => ({ ...placeStop(place), id: place.id }))
      .filter(next => !taken.has(next.id)
      && distance(from, next) >= 45 && distance(from, next) <= GROUP_MAX_LEG
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
  const fare = Math.round((40 + totalLength * .28) * (1 + (passengers - 1) * GROUP_FARE_SHARE));
  // Whole-dollar shares that sum exactly to the fare; the last rider takes the remainder.
  let allocated = 0;
  for (const [index, leg] of stops.entries()) {
    leg.fare = index === stops.length - 1 ? fare - allocated : Math.round(fare / passengers);
    allocated += leg.fare;
    leg.limit = legLimit(leg.length);
  }
  const band = fareBand(totalLength);
  return { passengers, stops, destination: stops[0].destination, length: totalLength, fare,
    band: band.id, color: band.color, groupBonus: (passengers - 1) * 25 };
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
    // One pickup site per two blocks, with seeded street, curb and position.
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
  // Share of the current rider's own window left. Ratings judge each leg alone,
  // so time carried over from a fast earlier stop protects the group without
  // inflating later ratings.
  get legRemaining() { return this.status === 'driving' ? Math.max(0, 1 - this.legElapsed / this.currentStop.limit) : 0; }
  // What the cab collects if everyone aboard arrives, including the held group fare.
  get remainingFare() { return this.status === 'driving' ? this.held + this.fare.stops.slice(this.stopIndex).reduce((sum, stop) => sum + stop.fare, 0) + this.fare.groupBonus : 0; }
  start(player) {
    this.status = 'pickup'; this.timeLeft = SHIFT_SECONDS; this.cash = 0; this.delivered = 0; this.failed = 0;
    this.boost = 1; this.boostActive = false; this.elapsed = 0; this.combo = 1; this.comboTime = 0;
    this.tips = 0; this.hold = 0; this.fare = null; this.events = []; this.driftTime = 0; this.crashCooldown = 0;
    this.recentDestinations = []; this.customers = []; this.boarding = null; this.blockedPickup = null;
    this.servedCustomers = new Map();
    this.stopIndex = 0; this.onboard = 0; this.deliveredPassengers = 0; this.held = 0; this.lastDropOff = null;
    this.streak = 0; this.ring = null;
    this.ratings = Object.fromEntries(RATINGS.map(rating => [rating.id, 0])); this.previousBest = this.best;
    this.lastImpact = player.audioTelemetry?.impactSerial ?? 0; this.makeCustomers(player);
    // Starting inside a ring must not choose the first fare for the driver.
    this.blockedPickup = this.customers.find(p => distance(p, player) < STOP_RADIUS) ?? null;
  }
  stop() { this.status = 'idle'; this.customers = []; this.servedCustomers?.clear(); this.fare = null; this.boarding = null; this.hold = 0; this.onboard = 0; this.stopIndex = 0; this.boostActive = false; this.revision++; }
  makeCustomers(player) {
    const previous = this.customers;
    for (const [id, until] of this.servedCustomers) if (until <= this.elapsed) this.servedCustomers.delete(id);
    const waiting = new Map(previous.map(customer => [customer.id, customer]));
    const stops = nearbyCustomerStops(player).filter(stop => !this.servedCustomers.has(stop.id)
      && !(this.lastDropOff && distance(stop, this.lastDropOff) < DROP_OFF_CLEARANCE))
      .map(stop => waiting.get(stop.id) ?? stop);
    this.customers = stops.map(stop => {
      if (stop.destination) return stop;
      // Derive the entire offer from this pickup, not the driver's approach
      // or trip history, so unloading and revisiting recreates the same fare.
      const wanted = partySize(stop.fareSeed), maxLength = FIRST_LEG_MAX[wanted];
      const destinations = nearbyPlaces(stop.s, stop.u, 6).map(place => ({ ...placeStop(place), id: place.id }));
      // Rank cheaply before tracing streets; usually only one or two routes need sampling.
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
      return { ...stop, name: PASSENGERS[party.destination.type] ?? 'Passenger', ...party };
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
  get tipMultiplier() { return this.combo * Math.max(1, this.onboard); }
  // Lowest the shift clock would fall carrying this fare at EASY_PACE, counting
  // time added back by boarding and Normal drop-offs.
  shiftAfter(offer) {
    let clock = this.timeLeft + pickupSeconds(offer.passengers), lowest = clock;
    for (const [index, leg] of offer.stops.entries()) {
      clock -= leg.length / EASY_PACE + 3; lowest = Math.min(lowest, clock);
      clock += index === offer.stops.length - 1 ? deliverySeconds(offer.length, RATINGS[1]) : RATINGS[1].riderSeconds;
    }
    return lowest;
  }
  // Records how the cab entered the ring, to tell a sliding stop from a gentle one.
  trackRing(stop, player) {
    if (stop !== this.ring?.stop) this.ring = stop ? { stop, speed: Math.abs(player.speed), slid: false } : null;
    if (this.ring && (player.drifting || player.audioTelemetry?.handbrake > 0)) this.ring.slid = true;
  }
  get crazyStop() { return Boolean(this.ring?.slid && this.ring.speed >= CRAZY_STOP_SPEED); }
  onTheWay(player) {
    const left = routeDistance(taxiRoute(player, this.target));
    if (left > this.tipMark - TIP_PROGRESS) return false;
    this.tipMark = left; return true;
  }
  reward(kind, amount, announce = true) {
    const tip = amount * this.tipMultiplier; this.tips += tip;
    this.boost = Math.min(1, this.boost + STUNT_BOOST);
    if (announce) this.events.push({ kind: 'tip', text: `${kind} +$${tip}`, combo: this.combo, riders: this.onboard });
    this.combo = Math.min(COMBO_MAX, this.combo + 1); this.comboTime = COMBO_SECONDS;
    return tip;
  }
  finish() {
    this.status = 'over'; this.boostActive = false; this.boarding = null; this.hold = 0; this.onboard = 0; this.revision++;
    this.previousBest = this.best; this.best = Math.max(this.best, this.cash);
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
        // A crash breaks the chain but keeps earned tips. Scrapes and pileups
        // report contacts every tick, so stunts stay suspended during the cooldown.
        if (this.crashCooldown === 0 && this.combo > 1) this.events.push({ kind: 'crash', text: `Crash · ×${this.combo} combo lost` });
        this.combo = 1; this.comboTime = 0; this.driftTime = 0; this.crashCooldown = .8;
      }
    }
    if (this.status === 'pickup') {
      if (this.elapsed >= this.nextCustomerRefresh) {
        this.nextCustomerRefresh = this.elapsed + 1;
        if (distance(player, this.customerCenter) > B / 2) this.makeCustomers(player);
      }
      // The driver picks a fare by stopping in its ring; boarding progress
      // never carries between passengers.
      if (this.blockedPickup && distance(this.blockedPickup, player) >= STOP_RADIUS) this.blockedPickup = null;
      const inside = this.customers.find(p => p.id !== this.blockedPickup?.id && distance(p, player) < STOP_RADIUS) ?? null;
      this.trackRing(inside, player);
      const passenger = Math.abs(player.speed) < 2.5 ? inside : null;
      if (passenger?.id !== this.boarding?.id) this.hold = 0;
      this.boarding = passenger;
      this.hold = passenger ? this.hold + dt : 0;
      if (this.hold >= STOP_SECONDS) {
        this.fare = passenger; this.fareLeft = passenger.stops[0].limit; this.legElapsed = 0; this.tipMark = Infinity; this.held = 0; this.status = 'driving'; this.boarding = null;
        const seconds = pickupSeconds(passenger.passengers);
        this.timeLeft = Math.min(MAX_SHIFT_SECONDS, this.timeLeft + seconds);
        this.stopIndex = 0; this.onboard = passenger.passengers;
        this.customers = this.customers.filter(customer => customer !== passenger);
        this.servedCustomers.set(passenger.id, this.elapsed + 60);
        this.hold = 0; this.tips = 0; this.combo = 1; this.driftTime = 0; this.passed = new WeakSet(); this.revision++;
        // A Crazy stop is the fare's first trick and starts its chain.
        const stunt = this.crazyStop ? this.reward('Crazy stop', TIPS.crazyStop, false) : 0; this.ring = null;
        this.events.push({ kind: 'pickup', seconds, stunt, text: `${stunt ? `Crazy stop +$${stunt} · ` : ''}${passenger.passengers > 1 ? `${passenger.passengers} riders aboard` : 'Rider aboard'} · +${seconds}s` });
      }
      return;
    }
    this.fareLeft = Math.max(0, this.fareLeft - dt); this.legElapsed += dt;
    if (this.fareLeft <= 0) {
      // All or nothing: the held group fare leaves with whoever is still aboard.
      const riders = this.onboard, lost = this.remainingFare + this.tips;
      this.failed++; this.status = 'pickup'; this.fare = null; this.hold = 0; this.onboard = 0; this.stopIndex = 0; this.tips = 0; this.held = 0; this.combo = 1;
      this.streak = 0; this.ring = null; this.revision++; this.makeCustomers(player);
      this.blockedPickup = this.customers.find(p => distance(p, player) < STOP_RADIUS) ?? null;
      const who = riders === 1 ? 'Rider' : `${riders} riders`;
      this.events.push({ kind: 'missed', text: `Too slow · ${who} jumped out · $${lost} lost`, lost }); return;
    }
    if (player.drifting && Math.abs(player.speed) > 10 && this.crashCooldown === 0) {
      this.driftTime += dt;
      if (this.driftTime >= .65) { this.driftTime -= .65; if (this.onTheWay(player)) this.reward('Drift', TIPS.drift); }
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
          this.passed.add(car); if (this.onTheWay(player)) this.reward('Near miss', TIPS.nearMiss);
        }
      }
    }
    const atStop = distance(this.target, player) < STOP_RADIUS;
    this.trackRing(atStop ? this.currentStop : null, player);
    this.hold = atStop && Math.abs(player.speed) < 2.5 ? this.hold + dt : 0;
    if (this.hold >= STOP_SECONDS) {
      const stop = this.currentStop, last = this.stopIndex === this.fare.stops.length - 1;
      const remaining = this.legRemaining, rating = arrivalRating(remaining);
      // Tipped while this rider is still aboard, so it counts every rider.
      const stunt = this.crazyStop ? this.reward('Crazy stop', TIPS.crazyStop, false) : 0; this.ring = null;
      this.streak = rating.id === 'speedy' ? this.streak + 1 : 0;
      // Base fare plus a time bonus for the clock left, held until the last
      // rider is out and then paid with tips and the group bonus.
      this.held += stop.fare + Math.round(stop.fare * .5 * remaining);
      const bonus = last ? this.fare.groupBonus : 0, paid = last ? this.held + this.tips + bonus : 0;
      // The route's time is paid at the last stop, plus the Speedy streak;
      // earlier drop-offs add only a small rating bonus.
      const streak = last ? streakSeconds(this.streak) : 0;
      const seconds = last ? deliverySeconds(this.fare.length, rating) + streak : rating.riderSeconds;
      this.ratings[rating.id]++;
      this.deliveredPassengers += stop.passengers; this.onboard -= stop.passengers;
      this.timeLeft = Math.min(MAX_SHIFT_SECONDS, this.timeLeft + seconds);
      if (paid) { this.cash += paid; this.fleet.credit(paid); }
      this.recentDestinations = [...this.recentDestinations, stop.destination.type].slice(-3);
      const group = this.fare.passengers > 1;
      const lead = !group ? '' : last ? 'Group complete · ' : `Rider ${this.stopIndex + 1} of ${this.fare.passengers} · `;
      const verdict = rating.id === 'speedy' ? `${rating.label}!` : rating.label;
      const text = [`${lead}${verdict}`, streak && `Streak ×${this.streak}`, stunt && `Crazy stop +$${stunt}`, paid && `+$${paid}`, `+${seconds}s`];
      this.events.push({ kind: last ? 'paid' : 'dropoff', text: text.filter(Boolean).join(' · '), paid, bonus, seconds, streak, stunt,
        rating: rating.id, passengers: stop.passengers, destination: stop.destination, groupComplete: last && group });
      if (group) this.boost = Math.min(1, this.boost + .25);
      if (!last) {
        // The group shares one clock: the next rider's allowance is added on
        // top, so time saved on an early stop carries forward.
        this.stopIndex++; this.fareLeft += this.currentStop.limit; this.legElapsed = 0; this.tipMark = Infinity;
        this.hold = 0; this.driftTime = 0; this.revision++;
        // Keep the combo alive long enough to pull away.
        this.comboTime = Math.max(this.comboTime, COMBO_SECONDS);
        return;
      }
      this.delivered++; this.stopIndex = 0; this.held = 0; this.lastDropOff = { s: stop.destination.s, u: stop.destination.u };
      this.status = 'pickup'; this.fare = null; this.tips = 0; this.combo = 1; this.hold = 0;
      this.revision++; this.makeCustomers(player);
      // Overlapping pickups wait until the driver leaves the ring.
      this.blockedPickup = this.customers.find(p => distance(p, player) < STOP_RADIUS) ?? null;
    }
  }
  drainEvents() { return this.events.splice(0); }
}
