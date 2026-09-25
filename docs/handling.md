# Handling

The driving model is arcade style with normal grip driving and a powerslide. The car tracks its facing direction and travel direction separately, with a limit on how far apart they can get. There is no suspension or tire simulation. Keyboard, controller, VR, and the touch stick all use the same controller.

## Steering

- Steering reaches 90% in about 38 ms and returns to center in about 26 ms. Countersteering switches direction immediately.
- If two steering keys are held, the newest one wins.
- The controller deadzone is 12%. Small stick movements are more precise.
- Full lock is tight enough for slow city corners. The turning circle gets wider as speed goes up.
- Launch torque is up to 22% stronger on pavement and fades out by 12 m/s. Top speed, grip, and off-road speed for each car are in `src/cars.js`.

## Drifting

- Above 8 m/s, tap Drift while steering to start a slide. Holding Drift also works.
- Keep the gas down and keep steering into the corner to hold the slide.
- Straighten out, countersteer, let off the gas, or brake to recover.
- Slides end below 6 m/s and can't start in reverse.
- The slide angle maxes out at about 32 degrees.

Brake always overrides gas. Handbraking in a straight line stops and holds the car, even with gas or boost held.

In a slide, the chase camera looks partly toward the direction of travel so the exit stays in view.

## Turning Radius

Side streets are 13 m wide, avenues 18 m, and boulevards 22 m. The full-lock radius is:

```
hypot(lowSpeedRadius, speed² / (32 × grip))
```

This blends from the parking radius at low speed into a cornering limit at high speed. Most cars use the default low-speed radius. The Micro uses 3.2 m, the Formula cars 3.6 m, and the truck 5.4 m.

Full-lock radius in metres on pavement:

| Car | 10 m/s (22 mph) | 15 m/s (34 mph) | 20 m/s (45 mph) |
| --- | ---: | ---: | ---: |
| Default wagon | 5.56 | 8.40 | 13.32 |
| Taxi | 4.48 | 6.35 | 9.74 |
| GT Taxi | 4.21 | 5.85 | 8.87 |
| Formula Taxi | 3.87 | 4.81 | 6.73 |
| Formula | 3.86 | 4.77 | 6.62 |
| Micro | 4.05 | 6.43 | 10.42 |
| Truck | 6.72 | 10.51 | 16.91 |

At 50 m/s a turn still needs about 35 m, so brake before tight corners. The game doesn't steer or brake for you.

## Timing

Physics runs at a fixed 120 Hz. Input is read every tick, and controllers are polled before each frame. Rendering interpolates between ticks.

## Tests

```sh
npm test
npm run test:handling
node scripts/handling-sweep.mjs
```

`npm test` covers steering, drifting, braking, collisions, camera, sound, touch, and controller input for every car at 30-240 Hz. `test:handling` needs the dev server running and drives real keyboard input through 264 city corners. `handling-sweep.mjs` prints each car's turning radius at different speeds. Reports go to `.artifacts/handling/`.
