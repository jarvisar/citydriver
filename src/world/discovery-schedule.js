import { randomAt } from './route.js';

export const METERS_PER_MILE = 1609.344;

// One landmark per district keeps different kinds from crowding each other.
// Compensate for measured terrain rejection so the editable miles describe
// encounters, not failed placement attempts. Actual gaps still vary by seed.
export function createDiscoverySchedule(miles, suitability, salt, place) {
  const rates = Object.entries(miles).map(([kind, distance]) => {
    if (!(distance > 0)) throw new RangeError(`${kind}: discovery miles must be positive (or Infinity to disable)`);
    const success = suitability[kind] ?? 1;
    if (!(success > 0 && success <= 1)) throw new RangeError(`${kind}: invalid terrain suitability`);
    return { kind, rate: 1 / (distance * success) };
  }).filter(entry => entry.rate > 0);
  const total = rates.reduce((sum, entry) => sum + entry.rate, 0);
  // Very small user settings saturate here instead of overlapping structures.
  const spacing = Math.max(3072, METERS_PER_MILE / total);
  const cache = new Map();

  function district(index) {
    if (cache.has(index)) return cache.get(index);
    let pick = randomAt(index, salt) * total;
    const selected = rates.find(entry => (pick -= entry.rate) < 0) ?? rates.at(-1);
    const center = (index + .5) * spacing;
    const desired = center + (randomAt(index, salt + 1) - .5) * spacing / 5;
    let site = place(selected.kind, index, desired);
    // Keep every search in its own district, including snapped terrain sites.
    // This guarantees at least 0.3 districts of clear road between landmarks.
    if (site && Math.abs(site.s - center) > spacing * .35) site = null;
    cache.set(index, site);
    if (cache.size > 128) cache.delete(cache.keys().next().value);
    return site;
  }

  return {
    spacing,
    discoveries(first, last) {
      if (!total || last <= first) return [];
      const result = [];
      for (let index = Math.floor(first / spacing); index <= Math.floor(last / spacing); index++) {
        const site = district(index);
        if (site && site.s >= first && site.s < last) result.push(site);
      }
      return result;
    },
  };
}
