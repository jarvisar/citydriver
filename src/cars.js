import { TRAFFIC_MODELS, SPORTS_MODEL } from './traffic-models.js';
import { FORMULA_SHAPE } from './formula-model.js';

// The player's original car. Its collision box is the footprint the game has
// always used; the extra fields only describe it for the chooser's artwork.
export const CLASSIC_SHAPE = {
  name: 'classic', width: 2, length: 3.92, cabin: [1.77, .81, 1.9], cabinZ: .12,
  cabinY: 1.165, wheelRadius: .48, wheelZ: 1.195,
};

const shape = name => TRAFFIC_MODELS.find(spec => spec.name === name);

// The default car dresses for the scenery; every other car brings its own paint.
export const ROUTE_PAINT = { coast: '#d96143', desert: '#78977b', snow: '#9fc4d5', jungle: '#e0b44a', plains: '#4f8f8b', city: '#7a3b47' };

// Almost every car is the same kind of relaxed tourer. Stats stay within about
// a tenth of the coastal wagon so a choice changes character, not the game. The
// two chooser-only cars are the exceptions: the coupe reaches noticeably
// further, and the formula racer is quicker again by the same margin over it.
//
//   topSpeed            metres per second, the speed the throttle tops out at
//   offRoad             the same off the tarmac: two thirds or so of topSpeed,
//                       and the car eases down to it rather than snapping
//   acceleration        metres per second squared under full throttle
//   braking             metres per second squared on the brakes
//   grip                steering rate against the coastal wagon's
const BASE = { topSpeed: 28, acceleration: 11.3, braking: 20, grip: 1, offRoad: 18.5 };

export const CARS = {
  auto: {
    name: 'Default',
    // No portrait and no meters in the chooser: this card is whichever car the road brings.
    plain: true, kind: 'classic', trim: null, paint: '#d96143', shape: CLASSIC_SHAPE, stats: BASE,
  },
  coast: {
    name: 'Coastline Wagon', kind: 'classic', trim: 'coast', paint: '#d96143', shape: CLASSIC_SHAPE, stats: BASE,
  },
  desert: {
    name: 'Canyon Runner', kind: 'classic', trim: 'desert', paint: '#78977b', shape: CLASSIC_SHAPE,
    stats: { topSpeed: 27.2, acceleration: 11, braking: 19.4, grip: .97, offRoad: 19 },
  },
  snow: {
    name: 'Alpine Tourer', kind: 'classic', trim: 'snow', paint: '#9fc4d5', shape: CLASSIC_SHAPE,
    stats: { topSpeed: 27.4, acceleration: 10.9, braking: 21, grip: 1.06, offRoad: 18.4 },
  },
  jungle: {
    name: 'Jungle Expedition', kind: 'classic', trim: 'jungle', paint: '#e0b44a', shape: CLASSIC_SHAPE,
    stats: { topSpeed: 26.6, acceleration: 11.5, braking: 19.2, grip: .96, offRoad: 18.6 },
  },
  plains: {
    name: 'Prairie Cruiser', kind: 'classic', trim: 'plains', paint: '#4f8f8b', shape: CLASSIC_SHAPE,
    stats: { topSpeed: 27.8, acceleration: 11.2, braking: 19.8, grip: .99, offRoad: 18.8 },
  },
  city: {
    name: 'Rain Commuter', kind: 'classic', trim: 'city', paint: '#7a3b47', shape: CLASSIC_SHAPE,
    stats: { topSpeed: 26.4, acceleration: 11.8, braking: 20.4, grip: 1.02, offRoad: 17.6 },
  },
  hatchback: {
    name: 'City Hatch', kind: 'built', paint: '#6fa9c2', shape: shape('hatchback'),
    stats: { topSpeed: 26.2, acceleration: 12.1, braking: 20.6, grip: 1.1, offRoad: 16.8 },
  },
  sedan: {
    name: 'Highway Sedan', kind: 'built', paint: '#e7e3d5', shape: shape('sedan'),
    stats: { topSpeed: 28.6, acceleration: 11.1, braking: 20.2, grip: 1.01, offRoad: 18 },
  },
  wagon: {
    name: 'Estate Wagon', kind: 'built', paint: '#5f7a5a', shape: shape('wagon'),
    stats: { topSpeed: 28, acceleration: 10.7, braking: 19.6, grip: .97, offRoad: 18.3 },
  },
  pickup: {
    name: 'Work Pickup', kind: 'built', paint: '#b06a3a', shape: shape('pickup'),
    stats: { topSpeed: 26.4, acceleration: 10.3, braking: 18.6, grip: .92, offRoad: 18.4 },
  },
  van: {
    name: 'Delivery Van', kind: 'built', paint: '#9aa6ad', shape: shape('van'),
    stats: { topSpeed: 27, acceleration: 9.9, braking: 18.8, grip: .9, offRoad: 16.7 },
  },
  sports: {
    name: 'Cape GT', kind: 'built', paint: '#b8232f', shape: SPORTS_MODEL,
    stats: { topSpeed: 33, acceleration: 13.5, braking: 23, grip: 1.14, offRoad: 20.1 },
  },
  formula: {
    name: 'Apex Formula', kind: 'formula', badge: 'Track', paint: '#d8452f', shape: FORMULA_SHAPE,
    // 100 mph, with enough power to overcome air drag at that speed.
    stats: { topSpeed: 50, acceleration: 40, braking: 30, grip: 1.32, offRoad: 20 },
  },
};

export const CAR_IDS = Object.keys(CARS);
export const DEFAULT_CAR = 'auto';
export const carEntry = id => CARS[id] ?? CARS[DEFAULT_CAR];

// Rolling and air drag. They live here because the surface figures below are
// sized against them, so how a car slows and what the verge costs stay in step.
export const DRAG = { rolling: .7, air: .0095 };

// One acceleration figure drives the whole throttle and brake feel, so a car is
// described by four numbers and the rest follows the original car's proportions.
export function carStats(id) {
  const { topSpeed, acceleration, braking, grip, offRoad } = carEntry(id).stats;
  return {
    topSpeed, acceleration, braking, grip, offRoad,
    reverseSpeed: topSpeed * .25,
    launch: acceleration * 1.68,   // Pulling out of a reverse roll.
    creep: braking * .325,         // Brake pedal used as reverse throttle.
    handbrake: braking * 1.35,
    touchBraking: braking * 1.2,
    // Loose ground resists exactly hard enough that full throttle settles on
    // the off-road figure, so the number on the card falls out of the physics
    // rather than being clamped on top of it.
    loose: Math.max(0, acceleration - DRAG.rolling - DRAG.air * offRoad * offRoad),
  };
}

// Chooser meters. The ranges sit just outside the road fleet so the slowest car
// still shows a little bar and only the coupe nearly fills one. The formula
// racer is off that scale by design and pegs all three, which is the point.
const METERS = [
  { label: 'Top speed', key: 'topSpeed', low: 24, high: 33.5 },
  { label: 'Acceleration', key: 'acceleration', low: 9, high: 13.8 },
  { label: 'Handling', key: 'grip', low: .85, high: 1.17 },
];
export function carMeters(id) {
  const stats = carEntry(id).stats;
  return METERS.map(({ label, key, low, high }) => ({ label, level: Math.round(Math.min(1, Math.max(.06, (stats[key] - low) / (high - low))) * 100) }));
}
