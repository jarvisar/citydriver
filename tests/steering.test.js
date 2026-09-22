import test from 'node:test';
import assert from 'node:assert/strict';
import { CAR_IDS, DRAG } from '../src/cars.js';
import { DrivingController } from '../src/vehicle.js';

const road = {
  frame: () => ({ angle: 0, scale: 1 }),
  position: (s, u) => ({ x: u, y: 0, z: -s }),
  height: () => 0,
  bounds: () => [-1000, 1000],
  looseness: () => 0,
  laneAssist: false,
};

// Balance drag with the pedals so each trial measures steering at a known
// speed, including the distance spent taking up steering and arcade slip.
function holdSpeed(car, speed, dt, input) {
  car.speed = speed;
  const drag = DRAG.rolling + DRAG.air * speed * speed;
  const pedals = speed === 0 ? {} : speed < 0 ? { brake: drag / car.stats.creep } : { forward: drag / car.stats.acceleration };
  car.update(dt, { ...pedals, ...input });
}

test('every car makes a compact quarter turn at city speeds in both driving modes', () => {
  for (const id of CAR_IDS) for (const arcade of [false, true]) {
    const car = new DrivingController(road, {}, id);
    car.arcade = arcade;
    try {
      for (const hz of [30, 60, 144]) for (const speed of [3, 6, 10]) for (const direction of [-1, 1]) {
        car.reset(); car.s = 0; car.u = 0; car.update(0, {});
        const input = direction > 0 ? { right: 1 } : { left: 1 };
        let ticks = 0;
        while (Math.abs(car.heading) < Math.PI / 2 && ticks++ < hz * 8) holdSpeed(car, speed, 1 / hz, input);
        const label = `${id}, arcade=${arcade}, ${speed} m/s, ${hz} Hz, direction=${direction}`;
        assert.ok(car.heading * direction >= Math.PI / 2, `${label}: did not complete the turn`);
        const limit = speed <= 6 ? 6 : 8;
        assert.ok(car.s < limit && Math.abs(car.u) < limit,
          `${label}: turn needs ${car.s.toFixed(2)} by ${Math.abs(car.u).toFixed(2)} metres`);
      }
    } finally { car.disposeModel(); }
  }
});

test('every car keeps proportional steering, reverse steering and highway stability', () => {
  for (const id of CAR_IDS) {
    const car = new DrivingController(road, {}, id);
    try {
      const yaw = (speed, steering) => {
        car.reset(); car.steer = steering;
        holdSpeed(car, speed, 1 / 60, { right: Math.max(0, steering), left: Math.max(0, -steering) });
        return car.heading * 60;
      };
      assert.equal(yaw(0, 1), 0, `${id}: turns while stationary`);
      assert.ok(Math.abs(yaw(-3, 1) + yaw(3, 1)) < 1e-10, `${id}: reverse turn differs from forward`);
      assert.ok(Math.abs(yaw(6, .5) * 2 - yaw(6, 1)) < 1e-10, `${id}: analog steering lost its range`);
      assert.ok(Math.abs(yaw(6, -1) + yaw(6, 1)) < 1e-10, `${id}: left and right differ`);
      for (const speed of [20, car.stats.topSpeed]) {
        const highwayYaw = speed / 3.3 * .55 * car.stats.grip / (1 + speed * .105);
        assert.ok(Math.abs(yaw(speed, 1) - highwayYaw) < 1e-10, `${id}: highway steering changed`);
      }
    } finally { car.disposeModel(); }
  }
});

test('steering responds within 100 ms and releases or reverses promptly in both modes', () => {
  for (const id of CAR_IDS) for (const arcade of [false, true]) {
    const car = new DrivingController(road, {}, id); car.arcade = arcade;
    try {
      for (const hz of [30, 60, 120, 144]) for (const amount of [.25, 1]) for (const direction of [-1, 1]) {
        car.reset();
        const label = `${id}, arcade=${arcade}, ${hz} Hz, input=${amount * direction}`;
        const turn = direction > 0 ? { right: amount } : { left: amount };
        const advance = (seconds, input) => {
          for (let elapsed = 0; elapsed < seconds - 1e-10;) {
            const dt = Math.min(1 / hz, seconds - elapsed);
            holdSpeed(car, 6, dt, input); elapsed += dt;
          }
        };
        advance(.1, turn);
        assert.ok(car.heading * direction > 0, `${label}: heading follows input`);
        assert.ok(car.steer * direction >= amount * .9, `${label}: turn-in exceeds 100 ms`);
        assert.ok(car.steer * direction <= amount, `${label}: steering overshoots`);
        advance(1 / 15, {});
        assert.ok(Math.abs(car.steer) < amount * .1, `${label}: release carries on turning`);
        advance(.3, turn);
        advance(1 / 30, direction > 0 ? { left: amount } : { right: amount });
        assert.ok(car.steer * direction < 0, `${label}: countersteering stays in the old direction`);
      }
    } finally { car.disposeModel(); }
  }
});

test('taxi tires recover direction promptly after releasing a handbrake drift', () => {
  for (const hz of [30, 60, 120, 144]) {
    const car = new DrivingController(road, {}, 'taxi'); car.arcade = true;
    try {
      for (let i = 0; i < hz; i++) holdSpeed(car, 15, 1 / hz, { right: 1, handbrake: true });
      const slip = Math.abs(car.heading - car.slideHeading);
      assert.ok(car.drifting && slip > .1, `${hz} Hz: handbrake still creates a drift`);
      // Center the wheels to isolate tire recovery from steering release.
      car.steer = 0;
      for (let elapsed = 0; elapsed < .1 - 1e-10;) {
        const dt = Math.min(1 / hz, .1 - elapsed);
        holdSpeed(car, 15, dt, {}); elapsed += dt;
      }
      assert.equal(car.drifting, false);
      assert.ok(Math.abs(car.heading - car.slideHeading) < slip * .1, `${hz} Hz: tires still sliding after 100 ms`);
    } finally { car.disposeModel(); }
  }
});
