import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CARS, CAR_IDS, DEFAULT_CAR, ROUTE_PAINT, carMeters, carStats } from '../src/cars.js';
import { createCar, DrivingController } from '../src/vehicle.js';
import { TRAFFIC_MODELS } from '../src/traffic-models.js';
import { JOURNEYS } from '../src/journeys.js';
import { PAINTS, DEFAULT_PAINT, isPaint, paintName } from '../src/car-paint.js';

const straightRoute = {
  frame: () => ({ angle: 0, scale: 1 }),
  position: (s, u) => ({ x: u, y: 0, z: -s }),
  height: () => 0,
  bounds: () => [-100, 100],
};
const flatOut = (id, seconds = 90) => {
  const car = new DrivingController(straightRoute, {}, id);
  for (let i = 0; i < 60 * seconds; i++) car.update(1 / 60, { forward: true });
  return car;
};

test('every car builds a solid, steerable model', () => {
  for (const id of CAR_IDS) {
    const model = createCar(id);
    assert.equal(model.wheels.length, 4, `${id} needs four wheels`);
    assert.equal(model.wheels.filter(wheel => wheel.front).length, 2, `${id} needs two steered wheels`);
    assert.equal(model.nightLights.length, id === 'formula' ? 1 : 2, `${id} needs its running lamps`);
    let meshes = 0;
    model.car.traverse(object => {
      if (!object.isMesh) return;
      meshes++;
      const position = object.geometry.attributes.position;
      assert.ok(position.count > 0, `${id} has an empty mesh`);
      assert.ok([...position.array].every(Number.isFinite), `${id} has a broken mesh`);
    });
    assert.ok(meshes >= 8, `${id} is missing bodywork`);
    // Wheels rest on the ground the car is placed on.
    const box = new THREE.Box3().setFromObject(model.car);
    assert.ok(Math.abs(box.min.y) < .05, `${id} floats or sinks: ${box.min.y}`);
    model.disposeModel();
  }
});

// The two chooser-only cars are the ones allowed to break the tourer's mould.
const RACERS = ['sports', 'formula'];

test('every car can reverse from rest and after braking off road', () => {
  for (const id of CAR_IDS) for (const fps of [30, 60, 144]) for (const startingSpeed of [0, 12]) {
    const car = new DrivingController(straightRoute, {}, id);
    car.u = 8; car.speed = startingSpeed;
    for (let i = 0; i < fps * 8; i++) {
      car.u = 8; // Keep the whole trial off road, even with lane assistance.
      car.update(1 / fps, { brake: 1 });
    }
    assert.ok(car.speed < -3, `${id} could not reverse off road at ${fps} fps after starting at ${startingSpeed}`);
    car.disposeModel();
  }
});

test('the coastal wagon keeps the original handling and every car stays close to it', () => {
  const base = carStats(DEFAULT_CAR);
  assert.equal(base.topSpeed, 28); assert.equal(base.acceleration, 11.3); assert.equal(base.braking, 20);
  assert.equal(base.grip, 1); assert.equal(base.offRoad, 18.5);
  for (const id of CAR_IDS) {
    if (RACERS.includes(id)) continue;
    const stats = carStats(id);
    assert.ok(Math.abs(stats.topSpeed / base.topSpeed - 1) < .1, `${id} top speed is too far from the original`);
    assert.ok(Math.abs(stats.acceleration / base.acceleration - 1) < .15, `${id} acceleration is too far from the original`);
    assert.ok(Math.abs(stats.grip - 1) < .12, `${id} handling is too far from the original`);
  }
  // The coupe is allowed to feel quick, and the racer quicker again.
  const sports = carStats('sports'), formula = carStats('formula');
  assert.ok(sports.topSpeed > base.topSpeed * 1.13 && sports.topSpeed < base.topSpeed * 1.25);
  assert.ok(sports.acceleration > base.acceleration * 1.15);
  assert.ok(formula.topSpeed > sports.topSpeed * 1.15, 'the racer should clear the coupe by a wide margin');
  assert.ok(formula.acceleration > sports.acceleration * 1.25 && formula.braking > sports.braking);
  assert.ok(formula.grip > sports.grip, 'slicks should turn in harder than the coupe');
  assert.ok(Math.abs(flatOut('formula', 30).speed / .44704 - 100) < .1, 'the Formula car must actually reach 100 mph under throttle');
  // Leaving the tarmac costs every car a third of its top end, give or take,
  // and the order is the character: off-roaders keep most, racers least.
  for (const id of CAR_IDS) {
    const ratio = carStats(id).offRoad / carStats(id).topSpeed;
    assert.ok(ratio >= (id === 'formula' ? .53 : .6) && ratio <= .7, `${id} keeps ${(ratio * 100).toFixed(0)}% off the tarmac`);
  }
  const share = id => carStats(id).offRoad / carStats(id).topSpeed;
  assert.ok(share('pickup') > share('van') && share('jungle') > share('hatchback'));
  assert.ok(share('formula') < share('sports'), 'slicks should be the worst of it');
  assert.ok(share('sports') < share(DEFAULT_CAR));
});

test('loose ground takes the speed instead of the game capping it', () => {
  // Open ground is past the ramp; anything nearer the tarmac costs less.
  const shoulder = (id, seconds, { at = 7, input = { forward: true } } = {}) => {
    const car = new DrivingController(straightRoute, {}, id);
    for (let i = 0; i < 60 * 90; i++) car.update(1 / 60, { forward: true });
    const entry = car.speed, trace = [];
    for (let i = 0; i < 60 * seconds; i++) { car.u = at; car.update(1 / 60, input); trace.push(car.speed); }
    return { car, entry, trace };
  };
  for (const id of CAR_IDS) {
    const { car, entry, trace } = shoulder(id, 12);
    const stats = carStats(id);
    // Full throttle balances on the off-road figure: the number on the card is
    // where the physics settles, not a limit clamped on top of it.
    assert.ok(Math.abs(trace.at(-1) - stats.offRoad) < .35, `${id} settled at ${trace.at(-1)}, not ${stats.offRoad}`);
    // It gets there over seconds, not in the frame that crosses the line.
    assert.ok(trace[0] > entry - .6, `${id} lost ${(entry - trace[0]).toFixed(1)} m/s in one frame`);
    assert.ok(trace[60] > stats.offRoad + .5 && trace[60] < trace[10], `${id} does not ease down`);
    // And never pulls harder than the car's own brakes while it is doing it.
    for (let i = 1; i < trace.length; i++) {
      assert.ok((trace[i - 1] - trace[i]) * 60 < stats.braking, `${id} decelerates harder than it brakes`);
    }
    // Back on the road, the full top speed is available again.
    car.u = 2.4;
    for (let i = 0; i < 60 * 30; i++) car.update(1 / 60, { forward: true });
    assert.ok(Math.abs(car.speed - stats.topSpeed) < .35, `${id} could not recover its road speed`);
  }
  // The throttle is worth holding: a closed one keeps bleeding speed well past
  // the off-road top, where a held one stops there.
  assert.ok(shoulder('auto', 3, { input: {} }).trace.at(-1) < carStats('auto').offRoad * .75);
  // A brief excursion is a glance, not a penalty.
  const { entry, trace } = shoulder('formula', .2);
  assert.ok(entry - trace.at(-1) < (entry - carStats('formula').offRoad) * .25,
    `a fifth of a second off the road cost ${(entry - trace.at(-1)).toFixed(1)} m/s`);
});

test('the edge of the road is a ramp, not a line', () => {
  const stats = carStats('auto');
  // Two wheels on the verge costs real speed, but nothing like leaving.
  const settled = at => {
    const car = new DrivingController(straightRoute, {}, 'auto');
    for (let i = 0; i < 60 * 102; i++) { if (i > 60 * 90) car.u = at; car.update(1 / 60, { forward: true }); }
    return car.speed;
  };
  const verge = settled(5.35), open = settled(7);
  assert.ok(Math.abs(settled(4.6) - stats.topSpeed) < .35, 'the shoulder itself is still road');
  assert.ok(verge < stats.topSpeed - 1 && verge > open + 3, `the verge (${verge}) should sit between road and open ground`);
  assert.ok(Math.abs(open - stats.offRoad) < .35);
  // Riding the line is steady rather than flickering between two surfaces.
  const car = new DrivingController(straightRoute, {}, 'auto');
  for (let i = 0; i < 60 * 90; i++) car.update(1 / 60, { forward: true });
  const speeds = [];
  for (let i = 0; i < 120; i++) { car.u = 5.1 + Math.sin(i / 4) * .35; car.update(1 / 60, { forward: true }); speeds.push(car.speed); }
  assert.ok(Math.max(...speeds) - Math.min(...speeds) < .6, 'skimming the edge should not jitter the car');
  // What the surface does and what it sounds like come from the same number.
  car.u = 7; car.update(1 / 60, { forward: true });
  assert.equal(car.audioTelemetry.offRoad, 1);
  car.u = 4.8; car.update(1 / 60, { forward: true });
  assert.equal(car.audioTelemetry.offRoad, 0);
});

test('loose ground costs grip as well as speed', () => {
  // Same car, same speed, same lock: the only difference is the surface.
  const turnIn = at => {
    const car = new DrivingController(straightRoute, {}, 'auto');
    car.u = at; car.speed = 20; car.update(0, {});
    const heading = car.heading;
    for (let i = 0; i < 30; i++) { car.u = at; car.speed = 20; car.update(1 / 60, { right: 1 }); }
    return Math.abs(car.heading - heading);
  };
  const road = turnIn(2.4), verge = turnIn(5.35), open = turnIn(7);
  assert.ok(verge < road && open < verge, 'turn-in should fall away with the surface');
  // A quarter of it, so the car still answers the wheel out there.
  assert.ok(open > road * .7 && open < road * .8, `open ground turns in at ${(open / road * 100).toFixed(0)}% of the road`);
});

test('choosing a car keeps the drive going and swaps the model in the scene', () => {
  const scene = new THREE.Scene();
  const car = new DrivingController(straightRoute, { s: 400 }, 'auto');
  scene.add(car.car);
  for (let i = 0; i < 300; i++) car.update(1 / 60, { forward: true });
  const { s, u, distance } = car, previous = car.car;
  car.setCar('sports');
  assert.equal(car.carId, 'sports');
  assert.equal(car.s, s); assert.equal(car.u, u); assert.equal(car.distance, distance);
  assert.equal(previous.parent, null); assert.equal(car.car.parent, scene);
  assert.equal(scene.children.filter(child => child.isGroup).length, 1);
  assert.equal(car.stats.topSpeed, carStats('sports').topSpeed);
  // A slower car cannot inherit a faster one's speed.
  car.speed = 33; car.setCar('van');
  assert.ok(car.speed <= carStats('van').topSpeed);
  assert.equal(car.spec.width, CARS.van.shape.width);
});

const palette = car => {
  const colors = new Set();
  car.car.traverse(object => { if (object.isMesh) colors.add(object.material.color.getHexString()); });
  return [...colors].sort().join(' ');
};

test('a chosen car keeps its own paint and kit on every route', () => {
  for (const id of CAR_IDS.filter(id => id !== 'auto')) {
    const car = new DrivingController(straightRoute, {}, id), own = palette(car);
    for (const journey of Object.keys(JOURNEYS)) { car.setAppearance(journey); assert.equal(palette(car), own, `${id} changed with the scenery`); }
  }
  // Route Match is the one that still dresses for the scenery.
  const matching = new DrivingController(straightRoute, {}, 'auto'), paints = new Set();
  for (const journey of Object.keys(JOURNEYS)) { matching.setAppearance(journey); paints.add(palette(matching)); }
  assert.equal(paints.size, Object.keys(JOURNEYS).length);
});

test('the racers stay in the chooser, and traffic keeps its own five shapes', () => {
  for (const id of RACERS) {
    assert.ok(CARS[id], `the chooser needs the ${id} car`);
    assert.ok(!TRAFFIC_MODELS.some(spec => spec.name === CARS[id].shape.name), `${id} must not join traffic`);
    assert.ok(!Object.values(JOURNEYS).some(data => data.car === id), `no route may default to ${id}`);
  }
  assert.equal(DEFAULT_CAR, 'auto');
  for (const id of CAR_IDS) {
    assert.equal(carMeters(id).length, 3);
    for (const { level } of carMeters(id)) assert.ok(level >= 6 && level <= 100, `${id} meter out of range`);
  }
  // The meters are scaled for the road fleet, so the racer pegs all three and
  // the coupe leads everything that is still an ordinary tourer.
  assert.ok(carMeters('formula').every(({ level }) => level === 100));
  for (const [index, meter] of carMeters('sports').entries()) {
    const road = CAR_IDS.filter(id => id !== 'formula');
    assert.ok(road.every(id => carMeters(id)[index].level <= meter.level), `${meter.label} should top out at the coupe`);
  }
});

test('the racer is an open-wheeler, not a road car with new numbers', () => {
  const formula = createCar('formula'), wagon = createCar('coast');
  const bounds = model => { const box = new THREE.Box3().setFromObject(model.car); return box.max.clone().sub(box.min); };
  const racer = bounds(formula), tourer = bounds(wagon);
  assert.ok(racer.z > tourer.z, 'the racer should be the longer car');
  assert.ok(racer.y < tourer.y * .6, 'and much lower');
  assert.equal(CARS.formula.shape.name, 'formula');
  assert.ok(Math.abs(racer.x - CARS.formula.shape.width) < .1, 'its exposed wheels set the collision width');
  formula.disposeModel(); wagon.disposeModel();
});

test('one colour dresses the whole garage and follows the car swap', () => {
  const blue = '#2f4a6d', wears = (car, color) => palette(car).includes(color.slice(1));
  const car = new DrivingController(straightRoute, {}, 'sports', blue);
  assert.ok(wears(car, blue), 'the chosen colour should reach the model');
  // It is the garage's colour, not the car's: every car picked up wears it.
  for (const id of CAR_IDS) {
    car.setCar(id, { paint: blue });
    assert.ok(wears(car, blue), `${id} ignored the garage colour`);
    assert.equal(car.paintColor, blue);
  }
  // And it stays on through a route change, kit and all.
  for (const journey of Object.keys(JOURNEYS)) { car.setAppearance(journey); assert.ok(wears(car, blue)); }
  // Clearing it hands every car the finish it arrived in back. The default
  // car's own finish is the route's, so put it back on the coast road first.
  car.setAppearance('coast');
  for (const id of CAR_IDS) {
    car.setCar(id); car.setPaint(null);
    assert.equal(car.paintColor, null);
    assert.ok(wears(car, CARS[id].paint), `${id} did not get its own colour back`);
  }
  // The default car goes back to dressing for the scenery, not to one colour.
  car.setCar('auto');
  const scenic = new Set();
  for (const journey of Object.keys(JOURNEYS)) { car.setAppearance(journey); scenic.add(palette(car)); }
  assert.equal(scenic.size, Object.keys(JOURNEYS).length);
  car.setAppearance('desert');
  assert.ok(wears(car, ROUTE_PAINT.desert));
});

test('the paint counter offers usable colours, and one swatch that is not one', () => {
  assert.ok(PAINTS.length >= 8);
  for (const { name, color } of PAINTS) {
    assert.ok(name && isPaint(color), `${name} is not a usable swatch`);
    assert.equal(paintName(color), name);
  }
  assert.equal(new Set(PAINTS.map(paint => paint.color)).size, PAINTS.length, 'no two swatches may share a colour');
  assert.equal(paintName('#010203'), null, 'a mixed colour has no catalogue name');
  // Default clears the garage rather than naming a colour, so it must never
  // read as one or collide with a swatch.
  assert.equal(isPaint(DEFAULT_PAINT), false);
  assert.ok(!PAINTS.some(paint => paint.color === DEFAULT_PAINT));
  for (const value of ['red', '#fff', '#12345g', '', null, 42]) assert.equal(isPaint(value), false);
});
