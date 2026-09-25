# Taxi Fleet

Completed fares, tips, and shift goal bonuses go into your fleet balance, which is saved locally. Restarting a run keeps money from completed fares; unfinished fares pay nothing. Buying a taxi doesn't affect your score or best score.

Open **Pause → Taxi fleet** during a run or **Taxi fleet** on the results screen. Buying a taxi selects it for the next run. You can also switch back to a taxi you already own.

All three taxis are free to drive in the free drive garage, but that doesn't unlock them for taxi runs.

## Liveries

Each driver rank unlocks a livery, picked in the taxi fleet: Checker Cream, Signal Red, Sea Glass, Forest Green, Midnight Blue, and Graphite at City Legend. Locked liveries show which rank unlocks them. A livery applies to every taxi, repaints the cab right away (even mid-run), and is saved with the fleet. Free drive keeps its own garage paint. See [progression](taxi-progression.md) for the ranks.

## Stats

| Taxi | Price | Top speed (m/s / mph) | Acceleration | Braking | Grip | Off-road speed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Taxi | Included | 40 / 89 | 21 | 32 | 1.4 | 28 |
| GT Taxi | $1,500 | 46 / 103 | 29 | 34 | 1.55 | 28 |
| Formula Taxi | $4,500 | 50 / 112 | 40 | 36 | 2.2 | 28 |

Acceleration and braking are in m/s². Off-road speed is in m/s. Grip is relative to the default wagon.

Fares, boost, timers, and passenger capacity are the same for every taxi. The Formula Taxi has two seats, and the first-person camera sits in the left one.

Straight-line times without boost:

| Taxi | 300 m from rest | 0-60 mph | Braking from 67 mph |
| --- | ---: | ---: | ---: |
| Taxi | 8.68 s | 1.51 s | 12.08 m |
| GT Taxi | 7.48 s | 1.04 s | 11.45 m |
| Formula Taxi | 6.73 s | 0.73 s | 10.88 m |

## Tests

`npm test` checks handling and saved balances. With the dev server running, use `npm run test:taxi`, `npm run test:fleet`, and `npm run test:browser`. Fleet screenshots go to `.artifacts/fleet/`.
