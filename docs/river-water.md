# River water

The water uses a consistent teal body color, narrow angular highlights that travel downstream, and a soft sky sheen. Flow follows the river's bends and both river axes. There are no splotchy color patches or intersecting wave trains across the surface.

## Research and plan

- [Catlike Coding: Waves](https://catlikecoding.com/unity/tutorials/flow/waves/) explains combining directional waves, matching wavelengths to mesh resolution, and updating surface normals. Here two small sine waves move a coarse mesh by at most 0.12 metres above or below its original height.
- [Catlike Coding: Directional Flow](https://catlikecoding.com/unity/tutorials/flow/directional-flow/) explores animated surface detail. This implementation moves angular ribbons along the river's address coordinates.
- [Three.js: MeshStandardMaterial](https://threejs.org/docs/pages/MeshStandardMaterial.html) provides the existing lighting, roughness, shadows, fog, and tone mapping. Extending that material keeps the water consistent with the city's weather and day/night lighting.

The intended scope is gentle movement, visible but quiet facets, and a little grazing-angle brightness. There are no reflection render targets, new textures, transparent layers, or changes to river footprints, bridges, boats, and collision rules.

## Implementation

`src/world/river-water.js` owns a 16-triangle patch template and the material. Patches use the existing 14-metre surface lattice, including in otherwise affine areas. Interior vertices are slightly irregular; boundary vertices remain shared. Analytic normals follow the gentle displacement without exposing the triangulation as a lattice.

Narrow, tapered ribbons move steadily downstream at slightly different speeds. Their lengths and offsets vary, while piecewise straight edges preserve the low poly style. Highlights do not randomly appear and disappear. At confluences the north current takes over as the side current fades, avoiding crossed patterns at the center. A Fresnel-weighted approximation of sky reflection uses the existing hemisphere light, so its brightness and tint follow the weather and time of day. It does not reflect buildings.

Each water triangle carries its three original logical addresses through near and distant batching. Interpolation maps the current around bends without seams or jumps after an origin shift. Each batch owns its geometry and address buffer and releases them when it streams out; all batches share the material and game time. Pausing freezes animation. Only time and origin uniforms change per frame. Water continues to use one draw per existing water batch and the same triangle count. Highlights use pixel filtering and fade at distance.

## Repeatable review

With the dev server running:

```powershell
$env:TEST_URL = 'http://127.0.0.1:5173'
node scripts/river-water-test.mjs
```

Captures go to `.artifacts/river-water/after`; set `WATER_OUTPUT` to choose another folder. The original captures are in `.artifacts/river-water/before`. Nine views cover both river axes, a confluence, day, golden hour, night, a low camera angle, a second animation time, the normal game camera, and phone proportions.

The browser check also renders water in isolation and compares pixels. It verifies visible animation, an identical repeated paused frame, matching near/distant rendering, and stable appearance after a 1024-metre origin shift. Browser and shader compilation errors fail the check. These checks use headless Chrome's software WebGL renderer; they do not establish a hardware frame-rate guarantee.

The current flow captures are in `.artifacts/river-water/flow`. `tests/river-water.test.js` checks that distant packing retains every triangle's flow coordinates and that streaming releases the batch-owned geometry.
