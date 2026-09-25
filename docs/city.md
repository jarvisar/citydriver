# City

The city extends in all four directions. The seed determines the streets, rivers, buildings, and landmarks. Nearby blocks load in as you drive and distant blocks unload.

Changing the weather keeps the same city and player position. Resetting moves the player to another district in the same city.

## Layout

Grid neighborhoods blend into curved waterfront roads and angled districts. Roads, lawns, paths, and riverbanks can bend. Buildings and props can't. They're moved or rotated as a whole, collision box included.

Generation runs in this order:

1. Generate rivers in both directions, with bridges on both street axes. River blocks are reserved before landmarks are placed.
2. Blend grid districts with curved corridors. Street addresses stay stable so navigation and streaming work.
3. Fit rectangular buildings to each lot. Lots that don't fit a building become planted space.
4. Place landmarks and street furniture, then fit paths and ground around them.
5. Sample lanes through the curves. Traffic, autodrive, taxi stops, and resets all use the same lanes.

Layout and placement are cached per block.

Roads, scenery, and car physics all use the same bridge heights and lane positions. Props need to stay clear of lanes and bridge approaches.

## Buildings

There are ten building styles, eight roof types, and ten storefront signs. Each neighborhood has its own palette: terracotta and copper in old town, pastels in garden districts, glass in midtown, and brick in industrial areas.

Buildings have finished facades on all sides and look the same up close and at a distance. Small signs, flowers, and furniture are hidden at a distance. Shared roofs are in `src/world/city-roofs.js`.

## Landmarks

| Landmark | Features |
| --- | --- |
| Clocktower | Reflecting basins, garden court, or open belfry |
| Market | Covered halls and stall courts |
| Botanical garden | Conservatories and water gardens |
| Tram depot | Sheds, platforms, or maintenance yard |
| Sculpture park | Balancing beams, colored gates, or sundial |
| Rivoli Cinema | Marquee, posters, and ticket booth |
| Grand Hotel | Copper crown and roof terrace |
| City Museum | Colonnade, skylight, and sculpture forecourt |
| Union Station | Train shed, platforms, and parked trains |
| Central Library | Rooftop lantern and reading garden |
| City Hospital | Twin wings and rooftop landing pad |
| Star Observatory | Copper dome and telescope |
| Blue Note Club | Piano-key facade and courtyard stage |
| Athletic Club | Tennis or basketball courts |
| Engine House | Red doors, hose tower, and fire engine |
| Central Post Office | Sorting hall, postal vans, and mailboxes |
| Mosaic Baths | Terracotta vaults, pools, and tiled colonnade |
| Harvest Market | Produce stalls and bakery |
| Lucky Donut | Rooftop donut and cafe terrace |
| City Hall | Portico, steps, and clocktower |

With parks and squares, that makes 22 discovery categories and 66 designs. Repeating landmarks have three designs each, and parks and squares have four. Discovery stamps are saved locally and can be collected in taxi runs or free drive.

Each four-by-four neighborhood gets one landmark. Of the remaining dry blocks, 3% become parks or squares (65% parks, 35% squares). Parks and squares also rotate, so neighboring sites look different.

City Hall appears once per seed, 4-6 blocks from the starting point. It replaces a regular landmark there and keeps the same address after resets.

Passenger destinations mix categories and avoid the last three types you delivered to when possible.

### Parks & Squares

| Site | Designs |
| --- | --- |
| Park | Pond and deck, orchard and cafe, meadow walk, flower terraces |
| Square | Fountain court, pergolas and pool, stepped forum, mosaic promenade |
| Clocktower | Reflecting basins, garden court, open belfry |
| Market | Covered hall, twin halls, hall and stall court |
| Gardens | Palm house, twin conservatories, glasshouse and water garden |
| Tram depot | Three sheds, paired platforms, maintenance yard |
| Sculpture park | Balancing beams, colored gates, sundial |

Paths connect to the full width of each entrance and to the sidewalk. Flower beds are only placed if they fit completely without overlapping paths, pools, seating, or structures. Planting uses its own random seed, so it can't change the main layout.

Park paths use light stone on grass. Square paths use darker paving on pale stone.

Grass tufts are capped at 64 per nearby block and aren't drawn at a distance.

The newer landmarks (Post Office, Baths, Harvest Market, Lucky Donut, City Hall) each have a budget of 6,000 triangles up close and 4,000 at a distance, not counting roads and street furniture.

## River Water

The water shader and patch geometry are in `src/world/river-water.js`. Two small sine waves move the surface up to 0.12 m. Highlights move downstream and follow bends and confluences. The sky sheen follows the weather and lighting but doesn't reflect buildings. Pausing freezes the water.

## Tests

```sh
npm test
npm run test:layout
npm run test:spaces
node scripts/city-tour.mjs after
node scripts/city-tour-gallery.mjs
node scripts/roof-review.mjs
node scripts/river-water-test.mjs
```

Everything except `npm test` needs the dev server running. Set `TEST_URL` for a different URL. Run `TEST_WORLD_SEED=2026 npm test` to test a different world.

The city tour uses seed `4817` and fixed camera positions. Run `node scripts/city-tour.mjs before` first to start a new before/after comparison.

Output:

- `.artifacts/city-tour/gallery.html`: before and after views
- `.artifacts/roof-review/gallery.html`: every roof type from two sides
- `.artifacts/public-spaces/`: all 66 designs and three river crossings
- `.artifacts/river-water/after`: water captures
