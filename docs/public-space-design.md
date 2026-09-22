# Parks and squares

There are 66 designs across 22 discovery categories. Parks and squares each have four layouts; repeating landmarks have three. City Hall has one design at one seeded address. See [destinations](city-improvements.md) for the full list.

## Layouts

| Site | Designs |
| --- | --- |
| Park | Pond and deck; orchard and cafe; meadow walk; flower terraces |
| Square | Fountain court; pergolas and pool; stepped forum; mosaic promenade |
| Clocktower | Reflecting basins; garden court; open belfry |
| Market | Covered hall; twin halls; hall and stall court |
| Gardens | Palm house; twin conservatories; glasshouse and water garden |
| Tram depot | Three sheds; paired platforms; maintenance yard |
| Sculpture park | Balancing beams; colored gates; sundial |

Block addresses select park/square layouts so adjacent sites differ, including at negative coordinates. The world seed changes the pattern. Parks and squares also rotate through four orientations; paths, structures, and colliders rotate together.

One dry block per four-by-four neighborhood is a landmark. Parks and squares use 3% of the remaining dry blocks, split 65/35. Planting uses a separate seed stream so small details can't change the main layout.

## Paths and planting

Paths share corners and join across closed loops. Entrances meet the full width of the actual doorway or steps, including on curved blocks. Storefront paving connects fitted building facades to the sidewalk.

Flower beds must fit as complete shapes, clear of paths, pools, seating, and structures. Try a narrower bed or leave it out if it doesn't fit. Soil and flowers stay inside the rim; collisions use the same footprint.

Park paths use light stone against grass. Square paths use darker paving against pale stone. Route/ground luminance contrast stays above 1.7:1.

Grass uses a shared 12-triangle tuft, capped at 64 instances per nearby block. Keep it clear of structures, paving, and seating. It has no shadows or animation and is omitted at distance.

## Geometry

Use shared geometry and existing city materials:

- Round forms use 24-sided cylinders; ponds use a 32-point shore.
- Basins have open rims and recessed water. Water uses 24- or 32-triangle fans.
- Ground panels share boundary vertices. Curbs and riverbanks keep side walls.
- Distant 2×2 tiles have a budget of 17 geometry/material batches.
- Major structures and tree crowns match at both detail levels. Flowers, furniture, produce, and small labels are near-only.

Post Office, Baths, Harvest Market, Lucky Donut, and City Hall each have a 6,000-triangle nearby budget and 4,000-triangle distant budget, excluding roads and street furniture.

Lucky Donut's dough and frosting meshes total 1,440 triangles. Sprinkles reuse the box batch and disappear at distance. The open hole and frosting surface have raycast checks.

City Hall replaces one existing POI near the original spawn and is excluded from repeating landmark selection. Its gallery capture uses that seeded address.

## Tests

```sh
npm test
npm run build
npm run test:spaces
npm run test:layout
```

Browser tests require a dev server. Set `TEST_URL` for another URL.

`test:spaces` writes galleries and geometry counts to `.artifacts/public-spaces/`. It captures all 66 designs and three river joins, with entrance, rear, and evening views for the newer venues.

Unit tests cover seeded revisits, rotations, matching detail levels, road clearance, planting collisions, full-width entrances, joined paths, water rims, and geometry budgets. Repeat with `TEST_WORLD_SEED=2026` to check another world.
