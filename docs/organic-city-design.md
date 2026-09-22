# City layout

Grid neighborhoods blend into curved waterfront roads and angled districts. Buildings and props keep their shape: translate or rotate the whole structure, including its collision footprint. Roads, lawns, paths, and riverbanks can bend.

## Generation

1. Generate seeded rivers in both directions. Reserve river blocks before placing landmarks. Join water at confluences and add bridges on both street axes.
2. Blend grid districts with curved corridors. Keep stable street addresses and shared layout/inverse functions for navigation and streaming.
3. Fit rectangular buildings to the available land. Check frontage, setbacks, and neighboring footprints. Leave unsuitable lots as planted space.
4. Place landmarks and furniture with rigid transforms. Fit paths and ground around them. Reuse transforms for collisions and distant rendering.
5. Sample routes through the curves. Traffic, autodrive, taxi stops, and recovery share lane positions.

Cache layout and placement per block. Limit cache sizes and placement attempts. Subdivide surfaces only where they bend; reuse geometry and materials.

## Tests

Run `npm test` and `npm run test:layout` with a dev server.

Check building shape and clearance, both river directions, confluences, bridge elevations, negative coordinates, cache eviction, origin shifts, and near/distant transitions. Driving checks cover eight curved street and bridge configurations.

## Recorded geometry cost

Seed `4817` at `(s: 280, u: 300)`, with 49 detailed and 72 distant blocks:

| Metric | Before | After |
| --- | ---: | ---: |
| Instances | 100,821 | 101,236 |
| Triangles | 1,169,726 | 1,201,762 |
| Scene batches | 806 | 773 |

These record the layout change, not current FPS. Curve evaluation and footprint searches also add CPU generation work.
