# Discovery frequency

To change how often a landmark appears, edit its value in the route's `*_DISCOVERY_MILES` table and reload:

| Route | File |
| --- | --- |
| Pacific Coast | [coastal-discoveries.js](../src/world/coastal-discoveries.js) |
| Red Rock Desert | [desert-discoveries.js](../src/world/desert-discoveries.js) |
| Midnight Alpine | [snow-discoveries.js](../src/world/snow-discoveries.js) |
| Emerald Jungle | [jungle-discoveries.js](../src/world/jungle-discoveries.js) |
| Golden Plains | [plains-discoveries.js](../src/world/plains-discoveries.js) |
| Rainy Downtown | [city-discoveries.js](../src/world/city-discoveries.js) |

`'cable-car': 5` means roughly one cable car encounter every five miles. Lower values make it more frequent; higher values make it rarer. Use `Infinity` to disable a type. Zero and negative values are invalid.

Defaults add up to about one discovery every 2.5 miles per route. Changing one value doesn't rebalance the others. Terrain and the world seed affect placement, so gaps vary. The scheduler enforces minimum spacing even with very frequent settings. Changes can move other discoveries in the same route.

Birds, Alpine lakeside cabins, and ordinary road bridges use separate schedules. A discovery's smaller objects, such as a dock's boat or a farm's tractor, follow the parent discovery.

Check the resulting frequencies from the repo root:

```sh
node scripts/discovery-frequency.mjs
```

The report compares target and measured averages over 2,000 route miles. Pass a number to change the sample length, such as `node scripts/discovery-frequency.mjs 500`. Set `TEST_WORLD_SEED` to check another world. The automated frequency test covers five seeds.