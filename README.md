# Citydriver

Arcade taxi driving built with Three.js.

## Play

Start a **Taxi run** with 90 seconds. Stop inside a pickup ring to board a passenger. Follow the arrow and map, then stop in the yellow drop-off ring before the fare timer expires.

- Completed fares earn cash and add 18 seconds.
- Fast drop-offs, drifts, and near misses earn tips.
- Combos multiply driving tips up to 3×. Crashes halve current tips.
- Boost recharges when released.
- Resetting the cab costs 5 seconds.
- Best cash total is saved locally. Pause and hidden tabs stop the clock.

**Free drive** has no timer and includes the garage, weather settings, and landmark map.

## Controls

| Action | Keyboard | Controller |
| --- | --- | --- |
| Accelerate | W / Up | RT / R2 or A / Cross |
| Brake / reverse | S / Down | LT / L2 or B / Circle |
| Steer | A D / Left Right | Left stick |
| Boost | Shift | RB / R1 |
| Drift / handbrake | Space | D-pad Down |
| Camera | V | X / Square |
| Pause | P / Escape | Start / Menu |
| Reset | R | Y / Triangle |
| Garage (free drive) | C / G | L3 |
| Autodrive (free drive) | H | D-pad Up |
| Fullscreen | F | LB / L1 |
| Sound | M | Pause menu |

Touch: use the stick to drive and the Boost / Drift buttons. Release the stick to stop.

## Run locally

Node.js 22.12 or newer:

```sh
npm install
npm run dev
```

Use `?seed=4817` for a repeatable city. Production build: `npm run build`.

## Checks

```sh
npm test
npm run build
npm run test:browser
npm run test:taxi
npm run test:pwa
```

Browser checks require a dev server. Set `TEST_URL` for a different URL and `CHROME_PATH` for a different Chrome executable.

[Desktop setup](ELECTRON.md) · [Offline installation](PWA.md)

Work stays in this directory. The original game and its repository are separate. No public deployment is configured.
