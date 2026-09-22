import { CITY_BLOCK, cityBlock, cityCell, cityStreetAt, nearestCityStreet } from './world/city-grid.js';
import { CITY_PLACES, PLACE_TYPES } from './world/city-places.js';
import { cityLayout, cityLogical, cityRoutePoints } from './world/city-layout.js';

export function nearbyPlaces(s, u, radius = 8) {
  const cell = cityCell(s, u), places = [];
  for (let ix = cell.ix - radius; ix <= cell.ix + radius; ix++) for (let iz = cell.iz - radius; iz <= cell.iz + radius; iz++) {
    const block = cityBlock(ix, iz);
    if (block.landmark) {
      const logicalS = (iz + .5) * CITY_BLOCK, logicalU = (ix + .5) * CITY_BLOCK;
      places.push({ id: block.key, type: block.landmark, ...CITY_PLACES[block.landmark], logicalS, logicalU,
        ...cityLayout(logicalS, logicalU), entrance: cityLayout(iz * CITY_BLOCK, logicalU) });
    }
  }
  return places.sort((a, b) => Math.hypot(a.s - s, a.u - u) - Math.hypot(b.s - s, b.u - u) || a.id.localeCompare(b.id));
}

// The last leg ends on the street beside the entrance. Every preceding leg
// follows a connected street, sampled through every bend.
export function placeRoute(s, u, place) {
  if (!place) return [];
  const nearest = nearestCityStreet(s, u), street = { s: nearest.logicalS, u: nearest.logicalU, axis: nearest.axis };
  const logicalPlace = place.logicalS === undefined ? cityLogical(place.s, place.u) : { s: place.logicalS, u: place.logicalU };
  ({ s, u } = cityLogical(s, u));
  const end = { s: logicalPlace.s - CITY_BLOCK / 2, u: logicalPlace.u };
  const points = [{ s, u }, { s: street.s, u: street.u }];
  if (street.axis === 'north') points.push({ s: end.s, u: street.u });
  else if (street.s !== end.s) {
    const west = logicalPlace.u - CITY_BLOCK / 2, east = logicalPlace.u + CITY_BLOCK / 2;
    const line = Math.abs(u - west) < Math.abs(u - east) ? west : east;
    points.push({ s: street.s, u: line }, { s: end.s, u: line });
  }
  points.push(end);
  return cityRoutePoints(points);
}
export function routeDistance(points) {
  return points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.s - points[i].s, p.u - points[i].u), 0);
}

export class CityExploration {
  constructor(storage = null) {
    this.storage = storage; this.key = 'citydriver-city-notebook-v1';
    this.found = new Set(); this.target = null; this.places = []; this.cell = null;
    this.justArrived = null;
    try {
      const saved = JSON.parse(storage?.getItem(this.key) ?? '[]');
      if (Array.isArray(saved)) for (const type of saved) if (PLACE_TYPES.includes(type)) this.found.add(type);
    } catch { /* Exploration also works with storage disabled. */ }
  }
  refresh(s, u) {
    const cell = cityCell(s, u).key;
    if (this.cell !== cell) {
      this.cell = cell; this.places = nearbyPlaces(s, u);
      if (this.target && Math.hypot(this.target.s - s, this.target.u - u) > CITY_BLOCK * 12) this.target = null;
    }
    if (!this.target) this.target = this.places.find(p => !this.found.has(p.type)) ?? this.places[0] ?? null;
  }
  next(s, u, type = null) {
    this.refresh(s, u);
    const choices = [...this.places].sort((a, b) => Math.hypot(a.s - s, a.u - u) - Math.hypot(b.s - s, b.u - u));
    const selected = type ? choices.find(p => p.type === type)
      : choices[(choices.findIndex(p => p.id === this.target?.id) + 1) % choices.length];
    if (!selected) return null;
    this.target = selected;
    this.justArrived = null;
    return this.target;
  }
  update(s, u, active = true) {
    this.refresh(s, u);
    if (!active) return [];
    const discoveries = [];
    if (cityStreetAt(s, u).onRoad) for (const place of this.places) {
      if (Math.hypot(place.s - s, place.u - u) > 69 && Math.hypot(place.entrance.s - s, place.entrance.u - u) > 24) continue;
      if (place.id === this.target?.id) this.justArrived = place;
      if (this.found.has(place.type)) continue;
      this.found.add(place.type); discoveries.push(place);
    }
    if (discoveries.length) {
      try { this.storage?.setItem(this.key, JSON.stringify([...this.found])); } catch { /* Keep stamps for this visit. */ }
    }
    // Keep the arrival visible until the driver has passed the block, then
    // suggest a new uncollected stop without changing their driving controls.
    if (this.justArrived && Math.hypot(this.justArrived.s - s, this.justArrived.u - u) > 125) {
      const previous = this.justArrived.id;
      this.target = this.places.find(p => !this.found.has(p.type)) ?? this.places.find(p => p.id !== previous) ?? null;
      this.justArrived = null;
    }
    return discoveries;
  }
}
