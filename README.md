# Citydriver

Taxi driving game built with [Three.js](https://threejs.org/). The city is procedurally generated and keeps going in every direction as you drive.

![Main menu](screenshots-showcase/main-menu.png)

| City overview | Lucky Donut |
| --- | --- |
| ![City blocks and waterfront](screenshots-showcase/share-jpg/01-golden-city.jpg) | ![Taxi outside Lucky Donut](screenshots-showcase/share-jpg/13-taxi-donut.jpg) |

## Features

- Taxi runs based on Crazy Taxi and Crazy Taxi 2
- Free drive with no timer
- Seeded city with rivers, bridges, parks, squares, and 20 types of landmarks
- Three taxis to buy with your fare earnings, plus other cars in free drive
- Weather and lighting options, including rain, snow, sunset, and night
- Keyboard, controller, and touch controls
- VR support in browsers that support WebXR
- Desktop app and offline install

## How to Play

### Taxi Run

Start a **Taxi run** from the main menu. The shift starts with 90 seconds on the clock.

Stop inside a passenger ring to pick up a fare, follow the green arrow, then stop in the yellow ring to drop them off. The ring color shows how long the trip is: red for short trips, then orange and yellow, up to green for long trips that pay the most. Drive up to a ring to see the distance, riders, and fare before stopping.

- Picking up a fare adds 6 seconds, plus 2 for each extra rider.
- Dropping off adds 1 second for every 24 m of the trip, plus a bonus based on the rider's timer: **Speedy** (+5 s), **Normal** (+2 s), or **Slow** (no bonus).
- Speedy arrivals in a row add up to 5 more seconds per fare. Steady Speedy driving keeps the clock level; Normal and Slow arrivals drain it.
- The clock maxes out at 180 seconds. Resetting the car costs 5 seconds.
- Pausing or switching tabs stops the clock.

Fares pay by distance plus a bonus for time left on arrival. Drifts and near misses earn tips while you have passengers. Chaining tricks raises the tip multiplier up to ×10, and tips are multiplied by the number of riders. Sliding into a ring with the handbrake at speed is a **Crazy stop** and also earns a tip. Tricks refill boost. Crashing ends the chain but you keep your tips. Circling around to farm tips doesn't count.

### Groups

Some rings have 2-4 riders. The number on the map shows the group size. Each rider has their own stop, and the arrow moves to the next stop after each drop-off. Stops are picked to turn corners and visit different kinds of places. Each extra rider adds 20% to the fare plus a $25 bonus, and every stop refills a quarter of your boost. Groups only pay at the last stop, so if the clock runs out first the group pays nothing.

### Shift Goals

Every shift sets three goals, such as delivering five fares, completing a group fare, landing a Speedy streak, or chaining a stunt combo. They change each shift and get harder as your rank goes up, and the third is always a stretch. Each completed goal adds a bonus to your fleet balance right away. See them in **Pause → Shift goals**, on the map card, and on the results screen.

### Licenses, Career & Taxis

At the end of a shift you get a license based on your earnings: Class E at $250, then D, C, B, A, and S (each double the last), and Legend at $16,000. The results screen also shows the shift's stats and highlights new personal records in gold.

Career earnings add up across shifts and raise your driver rank: Rookie, Cabbie ($2,000), Regular ($6,000), Pro ($15,000), Veteran ($35,000), Ace ($75,000), and City Legend ($150,000). Each rank unlocks a cab livery in the taxi fleet.

Completed fares and goal bonuses go into your fleet balance, even if you restart. Buy the GT Taxi ($1,500) or Formula Taxi ($4,500) from **Pause → Taxi fleet** or the results screen. New taxis are used starting next run; a livery repaints the cab right away. See [taxi stats](docs/taxi-fleet.md) and [progression](docs/taxi-progression.md).

Best score, career, and fleet balance are saved locally.

### Free Drive

Press forward on the main menu to start free drive, or **R** to generate a new city. Every car is available in the garage. Open **Pause → City discoveries** to pick a landmark and navigate there.

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
| Map | Map button | View / Share |
| Menus | Tab, Enter | D-pad or left stick, A / Cross to select, B / Circle to go back |

Tap Drift while steering to start a slide, then keep accelerating and steering to hold it. Straighten out, countersteer, let off the gas, or brake to recover. Slow down for tight turns since the turning circle gets wider at higher speeds.

In taxi runs, holding brake stops the cab for a moment before reversing so passengers can get in or out. Let go and press brake again to reverse right away.

On touch screens, use the stick to drive, hold Boost, and tap Drift while steering. Let go of the stick to stop.

Sound is off by default. Press **M** or turn it on in the pause menu. **Audio settings** has separate volume sliders and a few presets.

## Local Installation

Requires Node.js 22.12 or newer.

1. Clone the repository:

   `git clone https://github.com/jarvisar/citydriver.git`

2. Install dependencies:

   `npm install`

3. Start the dev server:

   `npm run dev`

Add `?seed=4817` to the URL to load the same city again. Run `npm run build` for a production build.

See [ELECTRON.md](ELECTRON.md) for the desktop app and [PWA.md](PWA.md) for offline install.

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

Browser tests need the dev server running. Set `TEST_URL` to use a different URL or `CHROME_PATH` to use a different Chrome install.

Run `npm run benchmark` or `npm run benchmark:cpu` for performance numbers. See [performance](docs/performance.md).

## GitHub Pages

In **Settings → Pages**, set **Source** to **GitHub Actions**. The workflow tests pull requests and deploys `main` using `/citydriver/` as the base path.

Commit `package-lock.json` when dependencies change. If `npm ci` complains about missing lockfile entries, run:

```sh
npx --yes --package=npm@11.19.1 npm install --package-lock-only --ignore-scripts
npx --yes --package=npm@11.19.1 npm ci --dry-run --ignore-scripts
```

## Development Notes

- [City](docs/city.md)
- [Handling](docs/handling.md)
- [Taxi fleet](docs/taxi-fleet.md)
- [Taxi progression](docs/taxi-progression.md)
- [HUD & UI](docs/ui.md)
- [Performance](docs/performance.md)
