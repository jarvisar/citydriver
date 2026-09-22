# Taxi fleet

The fleet adds two permanent purchases without changing fare payouts, boost, timers or passenger capacity. Completed fares and their tips immediately enter a separate saved fleet balance. Restarting or leaving a run keeps completed earnings; an unfinished fare pays nothing. Spending savings never lowers the run score or existing best score. Previous best scores remain intact, but are not converted into money because they do not record actual lifetime earnings.

Open **Pause → Taxi fleet** during a taxi run, or **Taxi fleet** on the results screen. Purchases select the cab for the next run; switching vehicles mid-fare is deliberately unavailable. Players may save directly for Formula, and owned cabs remain selectable. Free Drive exposes all three cabs in its ordinary Garage without spending money or granting taxi-run ownership. The main menu has no fleet button. The pause menu shows Fleet during taxi runs and Garage during Free Drive.

## Handling decisions

The previous taxi was already faster and more agile than the normal GT: 42 versus 33 m/s, 22 versus 13.5 m/s² acceleration, and 1.50 versus 1.14 grip. The Formula had 50 m/s and 40 m/s² acceleration but weaker brakes and grip than that taxi. Copying the normal GT would therefore have produced a downgrade.

| Cab | Price | Speed (m/s / mph) | Acceleration | Braking | Grip | Off-road speed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Taxi | Included | 40 / 89 | 21 | 32 | 1.40 | 28 |
| GT Taxi | $1,500 | 46 / 103 | 29 | 34 | 1.55 | 28 |
| Formula Taxi | $4,500 | 50 / 112 | 40 | 36 | 1.70 | 28 |

Acceleration and braking are in m/s²; grip is relative to the original wagon. The starter loses under 5% speed and acceleration, 6.7% grip, and no braking or off-road speed. Upgrades retain the starter's off-road speed so shortcuts never become a hidden downgrade. Formula uses the original racer's speed and acceleration with stronger city brakes and steering. The ordinary GT and Formula are unchanged. Sports and Formula engine sounds carry over to the taxi variants.

The sports model retains its lowered coupe bodywork and adds a roof sign and checker stripe. Formula widens its tub and halo for two side-by-side seats, moves the driver's first-person eye to the left seat, and adds yellow paint, checkers, taxi signage and headlights. It still carries one passenger at a time.

## Price and pace checks

Normal generated fares span approximately $118–348 before tips and early-arrival bonuses. A seeded sample of 15 nearby fares, delivered with half their fare timer remaining, paid an estimated $170–418 with a median of $293. At that median, the GT takes about six fares, and Formula another sixteen after buying the GT. Poor runs still move the balance forward. There are no fare multipliers, financing, repairs or consumable upgrade costs.

Controlled straight-road measurements at 120 Hz, without boost:

| Cab | 300 m from rest | 0–60 mph | Braking from 67 mph |
| --- | ---: | ---: | ---: |
| Taxi | 8.68 s | 1.51 s | 12.08 m |
| GT Taxi | 7.48 s | 1.04 s | 11.45 m |
| Formula Taxi | 6.73 s | 0.73 s | 10.88 m |

These are arcade physics measurements, not predictions of a human player's fare rate: traffic, braking points, corners and pickup approaches matter. They establish useful acceleration gains rather than relying on top-speed labels alone. Tests repeat the improvement comparison at 30, 60 and 144 Hz.

## Verification

`npm test`, `npm run build`, `npm run test:taxi`, `npm run test:fleet`, and `npm run test:browser` cover the handling, models, cameras, persistence, banking, buying, reloads, free access and existing gameplay. Browser scripts require the dev server. Fleet screenshots and reports go to `.artifacts/fleet/`; touch checks cover portrait and landscape layouts.
