# Mobile performance follow-up

This follow-up builds on the [existing streaming/rendering optimizations](performance.md). The priorities were to reduce Basic's GPU workload, move collision-block construction ahead of boundary crossings, and remove repeated CPU work without changing driving, collisions, traffic rules, taxi rewards, city generation, or saved preferences.

## Research and decisions

- [Three.js responsive rendering](https://threejs.org/manual/pages/responsive.html) and [MDN WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices) recommend bounding pixel cost, batching, and controlling resource lifetime. The app already capped its drawing buffer; profiling showed that geometry remained expensive even at Basic resolution. Further reducing resolution would not address that workload.
- [Three.js BufferGeometry](https://threejs.org/docs/pages/BufferGeometry.html) supports indexed vertices. Sharing vertices must preserve *all* attributes, including normals and UV seams, rather than merging positions alone. The new compactor uses exact attribute values (including signed zero), preserves triangle order and groups, and only applies an index when the total buffer size shrinks.
- [Three.js BufferAttribute](https://threejs.org/docs/pages/BufferAttribute.html) supports partial update ranges. Skid marks now upload only the two newly written transforms, instead of recomposing and uploading as many as 160 transforms every frame.
- [MDN canvas optimization guidance](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas) recommends reusing repeated drawing work. The minimap now caches vector paths for static streets and blocks. Vector paths preserve smooth scrolling and avoid a large offscreen bitmap cache.

## Changes and tradeoffs

1. **Basic now has a distinct geometry budget.** It previously built the same 25 detailed blocks as Balanced and Smooth. It now builds 9, with the existing distant models covering the remaining 112 blocks. Every adjacent collision block stays complete. Buildings, roads, waterways, bridges, and destination locations retain their layout. Decorative detail and distant shadows transition closer to the player on Basic; High, Balanced, and Smooth keep their existing ranges. Camera coverage and rendering resolution are unchanged.
2. **Prefetch nearby detail.** Spare frames prepare one upcoming collision block at a time before the car crosses a boundary. At most five detailed blocks are retained outside the live scene, alongside the existing limit of 21 packed skyline blocks. Crossing reuses the prepared objects; turning away or disposing the world releases unused instance buffers. This cache does not add visible objects or active colliders. Construction still has a soft budget: one procedural block is indivisible, and teleports must load their neighborhood synchronously.
3. **Cache the minimap's static geometry.** A bounded 63-block cache reuses paths until a block leaves the map footprint. An axial crossing builds only 7 or 9 new blocks. Routes, passengers, selection, and the car arrow still update normally. Blocks draw in the original order; coordinates are local to each block to preserve precision away from the origin. Fractional display densities no longer cause repeated canvas resizing.
4. **Compact shared scenery buffers.** Street furniture, trees, residents, roofs, public-space surfaces, and river water share exact duplicate vertices where doing so saves memory. Materials, triangle topology, lighting normals, and colors are retained. Compaction runs once for shared templates, outside streaming and render loops. Independently owned river buffers retain their existing disposal behavior.
5. **Reuse known traffic coordinates.** Normal traffic movement passes its already known lane coordinate directly to pose calculation, avoiding an inverse layout solve and duplicate lane mapping for every car at every simulation step. The original inverse-mapping path remains available for externally repositioned cars.
6. **Upload skid marks only when they change.** Track transforms remain in absolute world coordinates under the existing floating-origin group. Buffer updates cover only the newly inserted tracks, including ring-buffer wraparound; idle frames and rebasing need no instance upload.

No new dependencies or storage migrations are required.

## Reproducing the measurements

Start the development server, then run:

```sh
npm run benchmark
npm run benchmark:cpu
```

Set `TEST_URL` if the server uses a different port, `CHROME_PATH` for another Chromium executable, and `PERF_LABEL` to choose `.artifacts/performance/<label>/`. The rendering benchmark uses seed 4817, fixed weather and poses, 30 sampled frames after warmup, desktop High at 1280 × 800/DPR 1, and phone Basic at 390 × 844/DPR 3. The CPU profiler uses the Basic phone configuration and reports the median of seven batches after warmup.

The comparison uses the untouched starting revision and the revised app on the same machine. Baseline reports are in `overhaul-before`; final reports are in `overhaul-final`. These measurements use **Chromium SwiftShader**, not a physical phone GPU. Triangle and draw counts describe workload; frame times do not establish a supported device or an FPS guarantee.

| Profile / view | Draw calls, before → after | Triangles, before → after | Median frame time, before → after |
| --- | ---: | ---: | ---: |
| Phone Basic / close overhead | 526 → 372 (−29.3%) | 709,546 → 506,672 (−28.6%) | 233.3 → 200.0 ms |
| Phone Basic / third person | 548 → 355 (−35.2%) | 749,962 → 507,530 (−32.3%) | 250.1 → 200.0 ms |
| Desktop High / close overhead | 791 → 791 | 1,012,512 → 1,012,512 | 383.3 → 383.3 ms |
| Desktop High / third person | 756 → 756 | 1,085,850 → 1,085,850 | 516.7 → 516.7 ms |

Draw and triangle counts include shadows. Basic's framebuffer remains 390 × 844: the reduction comes from scenery workload, not a blurrier picture. Its detailed blocks fall from 25 to 9 (64% fewer); up to five additional prefetched blocks can temporarily occupy CPU memory without entering the scene.

The continuous 776 m drive's worst Basic streaming update fell from **21.1 to 11.2 ms**, with updates over 16.67 ms falling from **2 to 0**. These timings exclude physics and drawing and do not impose a hard maximum on other routes. High's worst update changed from 34.9 to 29.2 ms; it still had six updates above 16.67 ms.

| CPU operation, Basic profile | Median before → after |
| --- | ---: |
| Minimap / guide update | 1.013 → 0.278 ms (−72.6%) |
| Visible resident animation | 0.061 → 0.035 ms |
| Traffic simulation step | 0.073 → 0.046 ms |

CPU figures are microbenchmarks on this machine and include browser/JIT noise. The resident improvement also reflects Basic's smaller live neighborhood.

An independent comparison against an archived baseline expanded all **40 shared geometry templates** back into triangles and confirmed identical attributes. Twenty templates compacted; their combined buffers shrank from **256,392 to 201,748 bytes (21.3%)**, including index buffers. Across all 40 templates the reduction was 11.5%. River water uses 22 unique vertices instead of 48 while retaining the same 16 triangles and wave behavior. These are shared-template buffer sizes, not total application memory.

## Verification

Passed on the final implementation:

- `npm test`: **244/244** tests.
- `npm run build -- --base=/citydriver/`.
- `npm run test:browser`, `test:taxi`, `test:layout`, `test:spaces`, `test:performance`, and `test:pwa`.
- `node scripts/river-water-test.mjs` and `node scripts/night-lighting-test.mjs`.
- Both rendering and CPU benchmarks, without browser errors.

The production build retains Vite's existing large-bundle warning; this work targets runtime performance and does not eliminate the Three.js bundle size.

The new unit regressions cover exact geometry attributes, minimap cache bounds/order, prefetch reuse and disposal in both axes and diagonals, lane-position equivalence, and skid uploads through rebasing and wraparound. Existing streaming tests now explicitly cover 9-, 25-, and 49-block detail ranges, retaining complete world coverage and nearby collisions.

The performance browser check compares cached minimap output with the original direct polygon drawing algorithm at normal, fractional, and high density, including curved and negative-coordinate locations. It also checks AO loading/disposal, both camera projections, all six views, teleports, origin rebasing, portrait/landscape resizing, and native-density overrides.

The general browser check had a pre-existing failure on both the original and revised app: five simulated seconds were insufficient to obtain every discovery stamp. Its time allowance now covers a full signal cycle and ends as soon as the stamp is collected. The requirement to obtain all 17 stamps is unchanged.

## Remaining work

Basic still submits substantial building geometry. Higher-quality presets intentionally preserve their scene detail, so their GPU workload is largely unchanged. Physical Android and iOS testing is still needed for sustained FPS, thermal throttling, memory pressure, touch responsiveness, and Safari behavior. Further reductions should follow those captures. A worker-based generator would require a separate serialization/refactoring effort; it is not part of this change.
