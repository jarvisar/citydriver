# Discovery frequency

Each scene lists all its special encounters in a `*_DISCOVERY_MILES` table
at the top of its discovery file:

| Scene | File |
| --- | --- |
| Pacific Coast | [coastal-discoveries.js](../src/world/coastal-discoveries.js) |
| Red Rock Desert | [desert-discoveries.js](../src/world/desert-discoveries.js) |
| Midnight Alpine | [snow-discoveries.js](../src/world/snow-discoveries.js) |
| Emerald Jungle | [jungle-discoveries.js](../src/world/jungle-discoveries.js) |
| Golden Plains | [plains-discoveries.js](../src/world/plains-discoveries.js) |
| Rainy Downtown | [city-discoveries.js](../src/world/city-discoveries.js) |

Change **one value** to set that discovery's approximate average miles between
sightings, then reload the game. For example, `'cable-car': 5` means about one
cable-car encounter every five miles. Change it to `8` for fewer, or `4` for
more. Use `Infinity` to disable a type; zero and negative values are invalid.

The defaults combine to about **one special encounter every 2.5 miles** per
scene. Individual discoveries remain rarer: two types at five miles each
combine to an encounter about every 2.5 miles. Changing a value changes that
scene's combined rate; it does not automatically rebalance the other values.

These are long-run averages, not fixed gaps. Terrain suitability and seed
affect placement. The shared scheduler compensates for typical failed sites,
keeps one encounter per district, and leaves breathing room between them.
Very frequent settings eventually reach a safety limit instead of packing
structures together. Settings changes regenerate discovery locations, including
other kinds in the same scene, but do not reset saved driving progress.

Birds and Alpine lakeside cabins keep their existing schedules and are excluded
from these targets. Regular scenery such as ordinary road bridges is also
excluded. Objects belonging to a discovery—such as a dock's boat, a farmstead's
tractor, or a grain elevator's rail siding—share that discovery's setting.

To measure actual frequencies after editing:

```sh
node scripts/discovery-frequency.mjs
```

The report samples a long route, accounts for road bends, and shows targets and
observed averages in miles. An optional numeric argument changes the sampled
route length; `TEST_WORLD_SEED` selects another world. The automated frequency
test checks five different seeds.
