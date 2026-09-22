# River water

Water uses a teal base, moving highlights, and a sky sheen. Flow follows both river axes and their bends.

`src/world/river-water.js` owns the material and 16-triangle patch template. Patches use a 14 m lattice with shared boundary vertices. Two small sine waves displace the surface by up to 0.12 m; analytic normals follow the displacement.

Highlights move downstream. At confluences, the north current takes over as the side current fades. The sky sheen follows weather and lighting but doesn't reflect buildings.

Each triangle carries its original logical addresses through near/distant batching, keeping flow aligned through curves and origin shifts. Batches own and dispose their geometry and address buffers; they share the material and game time. Pausing freezes animation. Only time and origin uniforms update per frame.

## Tests

With a dev server running:

```sh
node scripts/river-water-test.mjs
```

Set `TEST_URL` for another server or `WATER_OUTPUT` for another output folder. Default captures go to `.artifacts/river-water/after`; earlier sets use `before` and `flow`.

Views cover both river axes, a confluence, lighting conditions, camera angles, animation, and phone proportions. Pixel checks cover motion, paused frames, near/distant matching, and a 1024 m origin shift. Shader or browser errors fail the check.

`tests/river-water.test.js` checks packed flow coordinates and buffer disposal. Browser checks use software WebGL and don't measure phone GPU performance.
