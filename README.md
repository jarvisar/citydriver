# Citydriver

Taxi driving game built with [Three.js](https://threejs.org/). The city generates as you drive.

## How to play

Start a **Taxi run** to pick up passengers and earn money. You start with 90 seconds. Stop in a pickup ring, follow the arrow, then stop in the yellow drop-off ring before the fare timer runs out.

Completed fares add 18–30 seconds; two-stop groups add 4 extra seconds in total, split between their stops. Fast deliveries, drifts, and near misses earn tips; crashes halve your current tips. Boost recharges when released. Resetting costs 5 seconds.

Choose your own fare by stopping in any passenger ring. Pick up a solo rider or a group of 2–4; everyone boards together. Groups usually share one destination, with at most two nearby stops. Approach a ring to preview the riders, destinations, and fare. Numbers on the map show group size.

Once passengers board, a green 3D arrow points to the current drop-off and automatically advances after each stop. A dashed map route previews the second stop. Groups pay more, refill a quarter of your boost at each stop, and award a $25 bonus per extra rider when everyone arrives. Each stop banks its payout immediately, even if you miss the remaining drop-off. One timer covers the whole fare, with extra time allowed for the second stop. You carry one party at a time; boarding never takes longer for a group. Your best score and fleet balance save locally. Pause or switch tabs to stop the clock.

Buy the GT Taxi ($1,500) or Formula Taxi ($4,500) from **Pause → Taxi fleet** or the results screen. Completed fares stay banked even if you restart. Vehicle changes apply to the next run.

**Free drive** has no timer. All three taxis are available in the garage, along with weather settings and city discoveries in the pause menu. Press forward on the main menu to enter free drive, or **R** to generate a new city.

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
| Garage / Taxi fleet | C / G | L3 |
| Autodrive (free drive) | H | D-pad Up |
| Fullscreen | F | LB / L1 |
| Sound | M | Pause menu |

On touch screens, use the stick to drive and hold Boost or Drift. Release the stick to stop.

In taxi mode, holding brake briefly stops the cab before reversing so passengers can board or exit. Release and press brake again to reverse immediately.

## Run locally

Requires Node.js 22.12 or newer.

```sh
npm install
npm run dev
```

Use `?seed=4817` to load the same city again. Run `npm run build` for a production build.

[Desktop setup](ELECTRON.md) · [Offline installation](PWA.md) · [Taxi stats](docs/taxi-fleet.md) · [Development notes](docs/)

## Tests

```sh
npm test
npm run build
npm run test:browser
npm run test:taxi
npm run test:fleet
npm run test:layout
npm run test:spaces
npm run test:performance
npm run test:pwa
```

Browser tests require a running dev server. Set `TEST_URL` to use another URL or `CHROME_PATH` to use another Chrome executable.

Run `npm run benchmark` for rendering and streaming measurements, or `npm run benchmark:cpu` for CPU profiling. See [performance notes](docs/performance.md).

## GitHub Pages

In **Settings → Pages**, set **Source** to **GitHub Actions**. The workflow tests pull requests and deploys successful builds from `main` using `/citydriver/` as the base path.

Commit `package-lock.json` when dependencies change. If `npm ci` reports missing lockfile entries:

```sh
npx --yes --package=npm@11.19.1 npm install --package-lock-only --ignore-scripts
npx --yes --package=npm@11.19.1 npm ci --dry-run --ignore-scripts
```
