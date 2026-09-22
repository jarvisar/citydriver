# Gameplay polish

This pass keeps the existing vehicle model, controls, city, boost, fares, and
90-second shift. The focus is predictable corrections, reliable stops, and
rewards that fit city driving.

## Design references

- [Horizon Chase developer retrospective](https://www.gamedeveloper.com/design/making-a-new-game-from-an-old-genre-with-horizon-chase): input filtering and the timing of steering, sliding, and collisions need to balance responsiveness with vehicle weight.
- [Racing implementation trade-offs, by Livio De La Cruz](https://www.gamedeveloper.com/design/implementing-racing-games-an-intro-to-different-approaches-and-their-game-design-trade-offs): arcade handling can use speed-dependent steering and tighter drift turns without a full tire simulation.
- [Crazy Taxi instruction manual](https://segaretro.org/images/e/eb/CrazyTaxi_PS2_US_Manual.pdf): stopping at destinations, driving stunts, and delivery bonuses support the timed fare loop.

The tuning below is specific to this game's code and measurements; these
references inform the approach rather than prescribe its numbers.

## Changes

- Taxi steering uses faster turn-in and still faster release/countersteer. The
  existing speed-dependent turn radius, drift slip, and free-drive handling stay.
- Braking takes priority over throttle and pauses at zero for half a second
  before reversing. This accommodates the 0.45-second boarding/drop-off hold.
  Releasing and pressing brake again bypasses the pause.
- A continuous drift earns tips after 0.65 seconds, so a short city corner can
  count. Separate taps still do not accumulate.
- Contacts in a prolonged crash halve tips once. After 0.8 seconds without a
  meaningful impact, a new crash can penalize again. Stunt scoring pauses during
  recovery, preventing scraping a wall from earning drift/near-miss tips.
- Delivery extensions remain 18 seconds for trips up to 400 m, then gain roughly
  one second per additional 60 m, capped at 30 seconds. This reduces the penalty
  for choosing longer trips. The shift still caps at 120 seconds.
- Pickup offers show their base fare and time reward. At the destination the HUD
  changes to braking, boarding, or drop-off instructions as appropriate.

## Measurements and checks

On flat road at 120 Hz, starting at 25 m/s:

| Measurement | Before | After |
| --- | ---: | ---: |
| Time within boarding speed while holding brake | 0.34 s | 0.83 s |
| Forward distance before stopping | 8.67 m | 8.67 m |
| Additional heading change in 0.5 s after releasing a full turn | 13.85° | 6.00° |
| Time for opposite input to reverse steering direction | 0.10 s | 0.05 s |
| Tips retained from $100 after four consecutive crash contacts | $6 | $50 |

Regression checks exercise braking into actual pickups and drop-offs at 30,
60, and 120 Hz; steering release, reversal, and analog range; intentional
reverse and reset; short drifts; prolonged crashes; and short/long fare payouts.
Full unit suite and production build pass. Browser validation covers desktop
and touch taxi flows. Automated measurements establish behavior, but final
subjective handling and shift difficulty still benefit from human playtesting.
