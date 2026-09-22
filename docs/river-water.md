# River water

The original rivers used a single flat teal material and six static highlight strips per river arm. Baseline screenshots were captured before editing, using seed 4817. The update keeps the low poly style with small moving facets, restrained teal variation, and sparse drifting ripple strokes.

## Research and plan

- [Catlike Coding: Waves](https://catlikecoding.com/unity/tutorials/flow/waves/) explains combining directional waves, matching wavelengths to mesh resolution, and updating surface normals. Here two small sine waves move a coarse, flat-shaded mesh by at most 0.12 metres above or below its original height.
- [Catlike Coding: Directional Flow](https://catlikecoding.com/unity/tutorials/flow/directional-flow/) explores animated surface detail. This implementation uses slow procedural strokes as a lightweight artistic approximation of wind ripples.
- [Three.js: MeshStandardMaterial](https://threejs.org/docs/pages/MeshStandardMaterial.html) provides the existing lighting, roughness, shadows, fog, and tone mapping. Extending that material keeps the water consistent with the city's weather and day/night lighting.

The intended scope was gentle movement, visible but quiet facets, and a little grazing-angle brightness. There are no reflection render targets, new textures, transparent layers, or changes to river footprints, bridges, boats, and collision rules.

## Implementation

`src/world/river-water.js` owns one shared 16-triangle patch and the material. Patches use the existing 14-metre surface lattice, including in otherwise affine areas. Interior vertices are slightly irregular; boundary vertices remain shared. Standard flat shading uses the displaced surface, so each small face catches light independently.

Wave and ripple positions use absolute world coordinates, with the floating origin removed. Near and distant batches share geometry, material, and game time. Pausing freezes animation. The material needs only time and origin uniform updates; CPU meshes are not rebuilt per frame. Water continues to use one draw per existing water batch, while the old separate highlight geometry is removed. The geometry costs 16 triangles per previous surface triangle. Fine strokes fade at distance to limit aliasing.

## Repeatable review

With the dev server running:

```powershell
$env:TEST_URL = 'http://127.0.0.1:5173'
node scripts/river-water-test.mjs
```

Captures go to `.artifacts/river-water/after`; set `WATER_OUTPUT` to choose another folder. The original captures are in `.artifacts/river-water/before`. Eight views cover both river axes, a confluence, day, golden hour, night, a low camera angle, a second animation time, and phone proportions.

The browser check also renders water in isolation and compares pixels. It verifies visible animation, an identical repeated paused frame, matching near/distant rendering, and stable appearance after a 1024-metre origin shift. Browser and shader compilation errors fail the check. These checks use headless Chrome's software WebGL renderer; they do not establish a hardware frame-rate guarantee.

Validation: all 209 unit tests, the production build, the eight-view water check, and the performance regression suite passed. The performance script now waits for the application's resize event to finish before measuring a newly rotated phone viewport.
