# Organic city layout

## Visual direction

Keep the existing low-poly architecture and legible driving streets. The city
should read as planned neighborhoods interrupted by waterways and older, looser
districts: substantial rectangular areas, gentle riverfront bends, and angled
junctions where patterns meet. Curves should have a neighborhood-scale reason,
rather than independent random offsets at every junction.

Buildings, trams, boats, fountains, signs and other assembled structures retain
their shapes. Placement can translate or rotate an entire asset. Its walls,
windows, roofs and collision footprint must move together, without shear or
nonuniform scaling. Ground, roads, parks and riverbanks can change shape.

## Generation order

1. Generate deterministic waterways in both north–south and east–west directions.
   Use long, smoothly blended bends, continuous water at confluences, and dry
   bridge crossings on both street axes. Reserve river blocks before landmarks.
2. Blend regular street districts with local curving corridors. Retain stable
   street addresses and connectivity so navigation and streaming remain cheap.
   The layout function and its inverse are shared by all gameplay systems.
3. Plan existing rectangular building types, then fit rigid footprints to the
   actual available land. Align with the nearest frontage; check setbacks and
   neighboring footprints. Try bounded placement adjustments. Leave unsuitable
   lots as planted open space instead of distorting their buildings.
4. Place landmark structures and street furniture with rigid transforms. Adapt
   paths, lawns and bank surfaces around them. Carry the same transforms into
   collision and distant rendering.
5. Sample navigation and minimap paths through the actual curves. Traffic,
   autodrive, taxi stops and recovery positions use shared lane poses.

## Performance

- Preserve shared geometry, instanced materials, and the combined distant ring.
- Generate layout and parcel decisions only when a block is constructed.
- Bound layout caches and candidate placement attempts; no city-wide solver.
- Keep straight ground and roads inexpensive; subdivide flexible surfaces only
  where curvature requires it. Avoid subdividing rigid structures.
- Reuse near/distant placement decisions to prevent buildings moving or changing
  dimensions at the streaming boundary.
- Measure world construction, instance/triangle counts and browser rendering;
  preserve the existing bounded residency window.

## Acceptance checks

- Original building dimensions, orthogonal walls and facade alignment survive
  placement; no overlaps or intrusion into travel lanes.
- Both river orientations bend; confluences contain water, not hidden land;
  bridge decks, railings, pedestrians and boats agree with physical terrain.
- Reproducibility and continuity hold for multiple seeds, negative coordinates,
  cache eviction, origin shifts and detail transitions.
- Traffic and actual player/autodrive simulations traverse curves and all bridge
  directions without scenery impacts or off-road excursions.
- Inspect overhead, street-level and minimap captures in the running browser.

## Research basis

- Chen et al., [Interactive Procedural Street Modeling](https://asu.elsevierpure.com/en/publications/interactive-procedural-street-modeling/),
  SIGGRAPH 2008: direction fields and local controls can guide coherent street
  patterns. This implementation borrows the pattern-blending principle; it is
  not a full tensor-field street generator.
- Esri, [CityEngine block parameters](https://doc.arcgis.com/en/cityengine/latest/help/help-layers-block-parameters.htm):
  blocks and lots are separate from streets; street-facing subdivisions and
  setbacks inform rigid frontage placement here.

The bounded address-based approach is a deliberate arcade-game tradeoff: a
connected, inexpensive network with varied geometry rather than a full urban
growth or traffic-planning simulation.

## Implementation measurements

For seed 4817 around world position `(s: 280, u: 300)`, with the same 49 detailed
and 72 distant blocks, the original city used 100,821 instances, 1,169,726
triangles and 806 scene batches. The revised city uses approximately 101,236
instances, 1,201,762 triangles and 773 batches: about 0.4% more instances and
2.7% more triangles, with fewer draw calls. Counts vary by seed and neighborhood.

Curve evaluation and the bounded footprint search add CPU generation work.
Unchanged distant blocks cache their physical matrices, and straight surfaces
avoid subdivision. These counts are geometry measurements, not an FPS guarantee.
Browser validation includes actual controller/collision drives through eight
curved street and bridge configurations, plus overhead and street-level captures.
