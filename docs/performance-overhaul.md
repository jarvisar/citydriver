# Performance measurements

See [rendering and streaming](performance.md) for preset limits and benchmark commands. The measurements below record separate optimization passes.

## Basic detail and CPU work

Basic uses 9 detailed blocks and 112 distant blocks. Up to five prefetched detailed blocks stay outside the live scene.

The minimap caches static vector paths for up to 63 blocks. An axial crossing adds 7 or 9 blocks; routes, passengers, and the car update normally. Coordinates stay local to each block.

Shared scenery templates merge vertices only when every attribute matches and the indexed buffer is smaller. Compaction runs outside streaming and render loops. Traffic reuses known lane coordinates. Skid marks upload only newly added transforms, including ring-buffer wraparound.

### Recorded results

The initial comparison uses `overhaul-before` and `overhaul-final` under `.artifacts/performance/`. Desktop is High at 1280×800/DPR 1; phone is Basic at 390×844/DPR 3. Both use seed `4817`, fixed poses/weather, and 30 frames after warmup.

| View | Draw calls, before → after | Triangles, before → after | Median frame time, before → after |
| --- | ---: | ---: | ---: |
| Phone / close overhead | 526 → 372 | 709,546 → 506,672 | 233.3 → 200.0 ms |
| Phone / third person | 548 → 355 | 749,962 → 507,530 | 250.1 → 200.0 ms |
| Desktop / close overhead | 791 → 791 | 1,012,512 → 1,012,512 | 383.3 → 383.3 ms |
| Desktop / third person | 756 → 756 | 1,085,850 → 1,085,850 | 516.7 → 516.7 ms |

Counts include shadows. Basic's framebuffer stayed at 390×844.

On the 776 m drive, Basic's worst streaming update fell from 21.1 to 11.2 ms; updates over 16.67 ms fell from two to zero. High changed from 34.9 to 29.2 ms, with six updates over 16.67 ms.

CPU medians use seven batches after warmup:

| Operation, Basic | Before → after |
| --- | ---: |
| Minimap / guide | 1.013 → 0.278 ms |
| Visible residents | 0.061 → 0.035 ms |
| Traffic step | 0.073 → 0.046 ms |

Twenty of 40 shared geometry templates compacted, reducing their buffers from 256,392 to 201,748 bytes including indices. Across all 40 templates, the reduction was 11.5%. Water went from 48 vertices to 22 with the same 16 triangles.

These browser measurements use SwiftShader. CPU timings include JIT/GC variation; buffer sizes describe shared templates, not total memory.

## Boundary stutter

Outgoing detailed blocks are prefetched as distant scenery. This cache holds up to seven axial or thirteen diagonal blocks on High, and three or five on Basic.

Background construction yields between ground, roads, buildings, furniture, residents, grass, mesh batches, and packing batches. Partial blocks stay outside the scene and are disposed if abandoned. Needed collision blocks finish immediately. The 3 ms budget is soft.

Seed `4817`, continuous 776 m drive:

| Streaming metric | Before | After |
| --- | ---: | ---: |
| High worst update | 25.4 ms | 10.7 ms |
| High updates over 16.67 ms | 3 | 0 |
| Basic worst update | 18.1 ms | 4.9 ms |
| Basic updates over 16.67 ms | 1 | 0 |

Reports: `.artifacts/performance/stutter-before` and `stutter-after`. Timings exclude physics and rendering; draw and triangle counts stayed unchanged.

`tests/city-streaming-budget.test.js` checks incremental/synchronous geometry and collisions, eight crossing directions at every detail radius, prepared crossings, cancellation, and urgent completion.

The recorded browser smoke test failed at `scripts/citydriver-test.mjs:144`: it expected the first mobile map tap to close a map, while the HUD started it collapsed.

## Buffer reuse and fog culling

Distant tiles reuse instance buffers while capacity allows. Unchanged ranges stay in place; changed ranges merge before upload. Growing or retired buffers are disposed, including river address attributes. Cached block bounds avoid transforming every instance during tile rebuilds.

Perspective cameras clip one metre past opaque fog. Overhead and XR keep their previous ranges.

Three alternating before/after Node trials used a 2.4 km route at seed `4817`:

| Metric | Before | After |
| --- | ---: | ---: |
| High median crossing | 4.16–4.41 ms | 1.88–1.99 ms |
| Basic median crossing | 3.49–3.53 ms | 1.30–1.42 ms |
| New skyline meshes, High | 3,776 | 2,265 |
| New skyline meshes, Basic | 3,039 | 1,701 |

Third-person browser counts, including shadows:

| Preset | Draw calls, before → after | Triangles, before → after |
| --- | ---: | ---: |
| High | 756 → 639 | 1,086,922 → 971,998 |
| Basic | 355 → 310 | 507,894 → 411,448 |

One High run still had a 25.4 ms streaming outlier. Reports are under `.artifacts/performance/` in `smooth-before`, `smooth-after`, and `smoothing/streaming.json`.

With a dev server, run `node scripts/smoothing-test.mjs` for 36 image comparisons across two qualities, three cameras, day/night, a boundary crossing, and a negative-coordinate rebase. Its reference uses the original far plane, recomputed bounds, and full uploads. Unit tests cover buffer resizing, pending uploads, disposal, water bounds, and fog projection updates.

## Shader warm-up and draw calls

Mid-drive stutter came mostly from shader compilation. Loading compiled only the overhead view's fogless programs, so the first chase-camera frame compiled a fog variant of every material. Rivers and fare markers compiled when first seen, and fare markers compiled again after each fare disposed their materials. Loading now compiles every variant, and marker materials persist.

Walker batches carry a morph texture, so three's shared depth material switched programs at every block's walkers. It now takes the dedicated depth materials already used by vehicles. Traffic casts one shadow draw per car instead of four. `cityLayout` hashes its river and district indices directly instead of building string cache keys, which is 2.2× faster with identical output over 208,656 sampled points.

Seed `4817`, phone Basic at 390×844/DPR 3, hardware GPU, 4× CPU throttling:

| Metric | Before | After |
| --- | ---: | ---: |
| Worst frame when a taxi run starts | 350 ms | 116 ms |
| Programs compiled after loading (start plus 25 s of driving) | 8–9 | 0 |
| Frames over 40 ms in 20 s of autodrive | 3–17 | 1 |
| Worst autodrive frame | 200–400 ms | 50–67 ms |
| Idle main thread while driving | 46% | 52–58% |
| Style recalculation, 15 s of taxi pickup | 373 ms, 145 recalcs | 38 ms, 15 recalcs |
| Draw calls, Basic third person | 355 | 302 |
| Draw calls, High third person | 630 | 577 |

Draw calls include the shadow pass. Deterministic frames at 54 poses (two levels, three cameras, sunset, night and rain) match the previous build pixel for pixel. The one exception is a single pixel that varies by one level between sessions of the same build.

## Merged furniture batches

Each block drew 15–22 instanced batches. Most held a handful of trees, lamps, benches, signals or bins, and each cost one draw in the colour pass and one in the shadow pass. `BatchedMesh` was measured first and rejected. In three r186 it issues one multi-draw entry per instance, so a 1,200-box batch becomes 1,200 sub-draws. Without `WEBGL_multi_draw` it issues one JavaScript draw call per instance. It also reads instance matrices from a texture in the vertex shader. In a city-shaped benchmark it cut calls from 360 to 157, but CPU submit time rose from 2.6 to 3.1 ms. Merging small same-material batches into one mesh per block cut calls to 144 and submit time to 2.3 ms.

Merged batches keep their instance transforms and colours in vertices, using 16-bit normals and colours. Large batches stay instanced. Merged geometry adds about 190 KB per detailed block. Build work rises about 12%, with per-step p99 and maximum unchanged.

Seed `4817`, hardware GPU, 4× CPU throttling, six fixed poses per level:

| Level | Draw calls, before → after | Render CPU, sum of poses |
| --- | ---: | ---: |
| Basic | 244–344 → 199–272 | 15.0 → 13.8 ms |
| Balanced | 385–483 → 282–349 | 20.1 → 17.1 ms |
| High | 496–553 → 374–401 | 24.8 → 21.2 ms |

Across 54 deterministic frames, 3,642 pixels changed by one level and about 70 edge pixels changed by more, from rasterization rounding. `tests/city-merged-batches.test.js` checks each baked vertex against the instancing shader's transform, normal and colour. It also checks that every batch draws once and that live batches stay instanced.
