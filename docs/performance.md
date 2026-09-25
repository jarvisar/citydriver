# Performance

The city is 11×11 blocks around the player. Blocks close to the player are fully detailed and the rest use simpler distant models.

| Preset | Detailed blocks | Max pixel ratio | Max framebuffer pixels |
| --- | ---: | ---: | ---: |
| High | 49 | 2 | 3,840,000 |
| Balanced | 25 | 1.5 | 2,073,600 |
| Smooth | 25 | 1.25 | 1,280,000 |
| Basic | 9 | 1 | 640,000 |

Moving the density slider overrides the preset and is saved locally. VR uses its own framebuffer.

## Rendering

- Distant scenery is grouped into 2×2 tiles and culled when off screen. Tiles reuse their buffers when they change.
- In detailed blocks, small batches (32 or fewer) of trees, lamps, benches, bins, signals, and roof parts are merged into one mesh per block. Walkers, signal lights, boats, and water stay instanced since they change after building. `blockBatches()` lists a block's batches.
- Residents that are off screen skip updates until they're visible again.
- Perspective cameras stop drawing just past where the fog is fully opaque.
- Ambient occlusion only loads when turned on.
- Smooth and Basic turn off the HUD's backdrop blur.

`BatchedMesh` was tried for the furniture batches but was slower. In three r186 it issues one sub-draw per instance, so the draw call count went down but CPU time went up. Merging into a regular mesh was faster.

### Shader Warm-up

Most mid-drive stutter came from shaders compiling the first time something was seen. Loading now compiles every shader before the first frame, including fog and no-fog versions and stand-ins for fare markers that aren't on screen yet. Fare marker materials are kept between fares so they don't recompile.

### Night Lighting

Street lamps and headlights use glowing lenses and light patches on the ground. They're capped at 96 lamps and 25 headlights within 145 m and hidden during the day. They only light the ground, not walls, and don't cast shadows.

## Streaming

The 3×3 blocks around the car are needed for collision and are always built right away. Everything else is built in the background with a 3 ms budget per frame and only added to the scene when finished. Distant models cover blocks that aren't done yet.

Detailed blocks that are about to come into view are prefetched, and blocks you drive away from are turned into distant models ahead of time. Startup, resets, and teleports can still stall while blocks build.

## Benchmarks

With the dev server running:

```sh
npm run benchmark
npm run benchmark:cpu
npm run test:performance
node scripts/night-lighting-test.mjs
node scripts/smoothing-test.mjs
```

Set `TEST_URL`, `CHROME_PATH`, or `PERF_LABEL` to change the server, browser, or report folder. Reports go to `.artifacts/performance/<PERF_LABEL>/`.

The benchmark uses seed `4817`, fixed weather and camera positions, desktop High at 1280×800, and phone Basic at 390×844. It also measures a 776 m drive. `benchmark:cpu` profiles the minimap, residents, and traffic.

## Known Issues

Benchmarks use Chrome's software renderer, so they're only useful for comparing builds on the same machine. They don't reflect real phone performance, and the game hasn't been tested much on actual phones.
