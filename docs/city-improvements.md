# City destinations and buildings

The city has 22 discovery categories and 66 public-space designs. Discovery stamps save locally and can be collected in taxi runs or free drive. Choose a destination from **Pause → City discoveries** to navigate there.

## Destinations

| Destination | Features |
| --- | --- |
| Clocktower | Reflecting basins, garden court, or open belfry |
| Market | Covered halls and stall courts |
| Botanical garden | Conservatories and water gardens |
| Tram depot | Sheds, platforms, or maintenance yard |
| Sculpture park | Balancing beams, colored gates, or sundial |
| Rivoli Cinema | Marquee, posters, and ticket booth |
| Grand Hotel | Copper crown and roof terrace |
| City Museum | Colonnade, skylight, and sculpture forecourt |
| Union Station | Vaulted train shed, platforms, and parked trains |
| Central Library | Rooftop lantern and reading garden |
| City Hospital | Twin wings and rooftop landing pad |
| Star Observatory | Copper dome and telescope |
| Blue Note Club | Piano-key facade and courtyard stage |
| Athletic Club | Tennis or basketball courts |
| Engine House | Red doors, hose tower, and heritage fire engine |
| Central Post Office | Sorting hall, postal vans, and mailboxes |
| Mosaic Baths | Terracotta vaults, pools, and tiled colonnade |
| Harvest Market | Outdoor produce stalls and bakery |
| Lucky Donut | Rooftop donut and curved cafe terrace |
| City Hall | Limestone portico, steps, and copper clocktower |

Repeating landmarks have three seeded designs. Parks and squares each have four. One landmark is placed per four-by-four neighborhood; 3% of the remaining dry blocks become parks or squares, split 65/35.

City Hall appears once per seed. It replaces a POI 4–6 blocks from the original spawn, expanding the search by two blocks if needed. Resets and revisits keep its address. The notebook can route there from outside the local map.

Passenger offers show the destination and passenger type. Offers favor different categories, and completed trips avoid the three most recent types when alternatives exist. Pickups stay on road lanes, clear of medians and each other.

## Buildings

Ten building styles use eight roof types and ten storefront signs. Neighborhoods have different palettes: terracotta and copper in old town, pastels in garden districts, glass in midtown, and brick in industrial blocks.

Shared roofs are in `src/world/city-roofs.js`. Roof shells close at ends and corners. Buildings keep rigid footprints, finished facades on all sides, and matching near/distant placement. Small signs, flowers, and furniture disappear at distance.

## Screenshots and tests

With the dev server running:

```sh
node scripts/city-tour.mjs after
node scripts/city-tour-gallery.mjs
node scripts/roof-review.mjs
npm run test:spaces
```

The city tour uses seed `4817` and fixed camera positions. Run `node scripts/city-tour.mjs before` to start a new comparison. Set `TEST_URL` for another server URL.

Output:

- `.artifacts/city-tour/gallery.html`: before/after views and destinations.
- `.artifacts/roof-review/gallery.html`: eight building roof types and seven landmark roofs from opposite approaches.
- `.artifacts/public-spaces/`: all 66 designs and three river joins.

`npm test` covers building geometry, entrances, collisions, distant models, discovery saves, and passenger variety. Browser checks cover pickup/payment, discoveries, controls, weather, and streaming.
