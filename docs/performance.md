# Rendering and streaming performance

This overhaul targets GPU work, city-boundary stalls, memory churn, and startup cost while preserving the generated city, driving physics, collision shapes, traffic rules, weather, and camera coverage. The city still has a complete 11 × 11 block footprint and either 25 or 49 furnished blocks after streaming settles.

## Research and priorities

The implementation follows these primary sources:

- [Three.js responsive rendering](https://threejs.org/manual/pages/responsive.html): high-DPI rendering multiplies pixel cost in both dimensions; limit the drawing buffer's total area as well as its density.
- [Three.js InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html): share geometry and materials, maintain bounds for culling, mark changed instance attributes for upload, and dispose retired instance buffers.
- [MDN WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices): balance batching with work actually visible, bound framebuffer memory, release unused GPU resources, and avoid synchronous GPU queries in the render loop.

The original app already used instancing, fixed-step physics, adaptive quality, and paused rendering. The measured problems were city-wide distant batches that could not be culled locally, synchronous construction of whole incoming strips, rebuilding every distant GPU buffer at each boundary, and optional shading included in the initial bundle. Changes were prioritized around those measured costs.

## Implemented changes

1. **Local distant batches.** `distant-city.js` groups the skyline into fixed 2 × 2 block tiles, still instanced by geometry/material. Three.js can reject tiles outside the camera frustum. Only changed tiles rebuild. Packed block-local matrices and colors replace the retained construction objects; local coordinates also preserve precision away from the origin. Shared geometry and materials outlive individual tiles, while obsolete instance buffers are disposed.
2. **Incremental detail and prefetch.** The live loop gives optional detail a soft 3 ms budget. A complete 3 × 3 collision neighborhood is always ready immediately. Distant versions fill every deferred cell until its detailed replacement is installed in the same update. Spare frames prepare one upcoming skyline block at a time, with a bounded cache of at most 21 blocks. Calls without a budget still finish synchronously for startup, reset, and tooling.
3. **Less recurring CPU work.** Static scene and city matrices are cached and explicitly dirtied when streaming or rebasing changes them. Offscreen residents skip matrix uploads and catch up from absolute time when visible again. Traffic signal phases continue updating everywhere, and XR retains unrestricted resident animation. Conservative per-chunk collision bounds skip irrelevant collider lists without changing contact calculations. Traffic no longer allocates a fleet copy per car per simulation step; unchanged road wetness avoids material work.
4. **Bounded preset resolution.** Density fractions still reduce work on ordinary 1× displays. Presets additionally cap both pixel ratio and framebuffer area:

   | Preset | Maximum pixel ratio | Maximum framebuffer pixels |
   | --- | ---: | ---: |
   | High | 2 | 3,840,000 |
   | Balanced | 1.5 | 2,073,600 |
   | Smooth | 1.25 | 1,280,000 |
   | Basic | 1 | 640,000 |

   An explicit density-slider choice overrides these preset caps and remains remembered. The UI distinguishes a preset limit from a native-resolution override. XR continues using its own framebuffer.
5. **Optional shading loads on demand.** The default path neither imports the AO implementation nor allocates its render targets. Enabling it keeps ordinary rendering active during loading, then redraws even if paused. Disabling it releases its GPU resources. Import completion respects current camera, quality, disabled state, and disposal. The PWA precaches the optional chunk so it remains available offline.

## Measurements

Use `npm run benchmark` against a running dev server. The harness uses seed 4817, a fixed position and weather, close overhead and third-person views, a 1280 × 800 High desktop profile, and a 390 × 844 Basic phone profile at DPR 3. Each view records 30 measured frames after warmup. It also measures six complete strip loads and a continuous 776 m drive with the live streaming budget. Raw reports and screenshots go to `.artifacts/performance/<PERF_LABEL>/`.

The initial JavaScript bundle dropped from **970.17 KB / 313.76 KB gzip** to **814.83 KB / 231.73 KB gzip** (26.1% less compressed JavaScript). Optional shading moved to a separate **162.59 KB / 84.64 KB gzip** chunk. These are production-build sizes; the offline cache still includes both chunks.

The Basic phone framebuffer drops from **585 × 1266** to **390 × 844**, a **55.6% reduction** in pixels. HTML controls and text continue rendering at the device's normal density.

The final comparison used the original checkout archived from Git and the revised app, run sequentially on the same machine. Reports are `.artifacts/performance/baseline-final/report.json` and `.artifacts/performance/after/report.json`.

| Profile / view | Submitted triangles, before → after | Draw calls, before → after | Median frame time, before → after |
| --- | ---: | ---: | ---: |
| Desktop / close overhead | 1,021,994 → 736,682 (−27.9%) | 658 → 648 | 433.4 → 300.0 ms |
| Desktop / third person | 968,526 → 758,458 (−21.7%) | 607 → 646 | 516.6 → 400.0 ms |
| Phone / close overhead | 874,408 → 517,060 (−40.9%) | 422 → 422 | 383.4 → 166.7 ms |
| Phone / third person | 888,958 → 580,664 (−34.7%) | 428 → 472 | 400.0 → 200.0 ms |

Counts include shadow rendering. Increased perspective draw calls are the measured tradeoff for culling smaller batches.

| Continuous-drive streaming metric | Desktop before → after | Phone before → after |
| --- | ---: | ---: |
| Worst update | 70.7 → 22.8 ms | 75.1 → 16.6 ms |
| Updates exceeding 16.67 ms | 7 → 4 | 7 → 0 |

These update times measure city streaming alone, excluding physics and rendering. Complete synchronous strip loads also improved: their median fell from 73.3 to 58.9 ms on the desktop profile and from 95.5 to 53.9 ms on the phone profile.

The captured fixed desktop screenshot is byte-for-byte identical before and after (`SHA-256 EABFE1335517606578CE3DD06E3985EBD4AFEE16829A45844A871E9C10ED8A0F`). This verifies that particular pose and view; the browser checks exercise other cameras and locations separately.

These tests use **Chromium SwiftShader**, not a physical phone GPU. Triangle counts and buffer sizes are deterministic workload measures. Frame timings are useful for comparing these two builds on the same machine; they do not predict a phone's FPS, battery life, or thermal behavior. Small timing differences are also affected by JIT compilation and garbage collection.

## Verification

`npm test` passes all **202 tests**, including nine new performance regressions for uninterrupted coverage during staged loads, immediate nearby collisions, positive/negative coordinates, rebasing, quality changes at rest, immutable tile reuse, instance disposal, matrix/color preservation, bounded prefetch, resident catch-up, collision equivalence, resolution budgets, and asynchronous AO lifetime.

`npm run test:performance` checks AO's lazy request, repeated enable/disable GPU cleanup, both projection types, renderer-state restoration, all six cameras, staged coverage, rebasing, portrait/landscape resizing, and explicit native-density overrides in Chromium.

The broader checks are `npm run test:browser`, `npm run test:taxi`, `npm run test:layout`, `npm run test:pwa`, and `npm run build`. They cover directional driving and bridges, landmarks, weather, resets, taxi pickup/payment/failure, boost, touch drift, pause, saved state, and offline/update behavior at root and subpath deployments.

## Night lighting

Street lamps use glowing lenses and soft ground patches; player and nearby traffic
headlights use ground patches too. There are no additional Three.js lights, shadow
passes, fullscreen effects, or render targets. Three instanced draws share two
64×64 masks, with hard limits of 96 street lamps and 25 headlight patches inside
145 metres. The whole group is hidden in daylight; it fades in through storms
and night using the existing weather light level. Lamp selection and static
instance uploads are cached between movement, streaming, and origin changes.
The meshes also stay out of the optional AO prepass.

These are inexpensive visual approximations: they brighten horizontal ground,
do not illuminate walls or vehicles, and do not cast shadows. Existing sun/moon
shadows retain their current settings. Patches assume the city's level streets
and bridge decks; they do not project onto arbitrary terrain or stop at obstacles.

`node scripts/night-lighting-test.mjs` checks all six cameras, day/night switching,
shader errors, and the added draw budget in Chromium. Its seeded Basic-quality
scene adds three draws and roughly 600 triangles. These counts are not a hardware FPS
guarantee. Unit tests cover caps, lamp alignment, rebasing, disabled traffic,
and the Formula car's rear-only running light.

## Remaining limits and follow-up

The streaming budget is deliberately soft: an individual procedural block is indivisible, and teleports must load nearby collision geometry and complete fallback coverage synchronously. A sufficiently slow device can still hitch during these operations. First startup remains synchronous city generation followed by shader preparation. Moving generation to a worker would be a separate change requiring a tested serialization boundary for shared geometry, materials, and collision data.

Local batching can increase draw calls in perspective views while reducing submitted triangles. Both metrics need tracking when tuning tile size. Shadows, furnished nearby blocks, and opt-in AO remain substantial GPU work. Future visual reductions should be based on real-device captures rather than silently removing architecture or traffic.

Before claiming a supported minimum device or a fixed FPS target, test sustained driving on low-memory Android hardware and iOS Safari, with repeated turns, weather changes, quality changes, and background/resume cycles. Check thermal slowdown and peak memory as well as average frame rate. No physical phone or headset was available for this implementation's verification.
