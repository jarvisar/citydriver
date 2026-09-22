# Citydriver

Arcade taxi driving built with Three.js.

## Play

Start a **Taxi run** with 90 seconds. Stop inside a pickup ring to board a passenger. Follow the arrow and map, then stop in the yellow drop-off ring before the fare timer expires.

Customers appear at procedural street locations every few blocks throughout the endless city. Nearby customers load as you drive and distant ones unload. Choose a map dot, use **Next passenger**, or stop in any pickup ring. Carry one passenger at a time, then choose another after the trip.

Returning to a pickup in the same seeded city recreates its destination, fare and colour. Collected customers have a 60-second cooldown before that pickup becomes available again.

- Completed fares earn cash and add 18–30 seconds, with more time for longer trips.
- Fast drop-offs, drifts, and near misses earn tips.
- Combos multiply driving tips up to 3×. Crashes halve current tips; repeated contacts in one scrape count as one crash.
- Boost recharges when released.
- Resetting the cab costs 5 seconds.
- Best cash total is saved locally. Pause and hidden tabs stop the clock.

**Free drive** has no timer and includes the garage, weather settings, and landmark map.

On the main menu, press forward to enter free drive, or press **R** to generate a new city. **Start run** starts a taxi run.

Explore **17 discovery categories**, including a cinema, grand hotel, museum, railway station, library, hospital, observatory, jazz club, athletic club, and historic firehouse. Parks and city squares are destinations too. Passenger offers show the customer and destination, favor varied trips, and collect discovery stamps during taxi runs as well as free drive. Choose any destination from **Pause → City discoveries**; existing stamps stay saved.

Blocks mix ten architectural styles: shops, brick buildings, balcony apartments, glass offices, Art Deco towers, warehouses, mansard townhouses, factory lofts, pavilions with butterfly roofs, and glazed atrium buildings. Neighborhood palettes, ten storefront signs, roof gardens and eight roof types give the streets distinct character. Weather defaults to Auto, starting at golden hour and cycling through conditions; your selected weather is saved.

The [city improvement notes](docs/city-improvements.md) describe the destinations, art direction, and repeatable before/after screenshot tour.

Side streets have stop signs. Avenues connect to wider boulevards with grass and trees in the medians. Traffic stops and yields at smaller junctions.

Gridded neighborhoods blend into curved waterfront roads and looser districts. Rivers bend in both directions and meet at open confluences, with bridges on both street axes. Buildings retain their rectangular shapes; awkward lots become planted courtyards. [Layout design and research](docs/organic-city-design.md).

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

In a taxi run, holding brake brings the cab to a brief stop before reversing, giving passengers time to board or exit. Release and press brake again to reverse immediately. Steer while holding Drift for tight corners, then release it to regain grip.

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
npm run test:layout
npm run test:performance
npm run test:pwa
```

Browser checks require a dev server. Set `TEST_URL` for a different URL and `CHROME_PATH` for a different Chrome executable.

`npm run benchmark` captures repeatable rendering and streaming measurements at desktop and phone sizes. See [performance design, research, and measurements](docs/performance.md) for the methodology and device-testing limits.

[Desktop setup](ELECTRON.md) · [Offline installation](PWA.md)

## GitHub Pages

In repository **Settings → Pages**, set **Source** to **GitHub Actions**. The workflow tests and builds each pull request, then deploys successful builds from `main` to Pages. The production build uses `/citydriver/` as its base path.

Commit `package-lock.json` whenever dependencies change. If `npm ci` reports missing lockfile entries, regenerate the lockfile with a current npm 11 version:

```sh
npx --yes --package=npm@11.19.1 npm install --package-lock-only --ignore-scripts
npx --yes --package=npm@11.19.1 npm ci --dry-run --ignore-scripts
```

Work stays in this directory. The original game and its repository are separate.
