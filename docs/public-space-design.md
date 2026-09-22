# Public-space variation

The old park and plaza generators repeated the same central fountain and tree
rows. Each discovery type also repeated a single composition. Give each site a
clear identity through its footprint, circulation, planting and skyline, while
keeping the existing low-poly palette and rigid architectural assemblies.

## Compositions

| Site | Designs |
| --- | --- |
| Park | Faceted pond with a viewing deck; orchard and café; winding meadow walk; formal flower terraces |
| Plaza | Fountain court; paired pergolas and reflecting pool; stepped performance forum; diagonal mosaic promenade |
| Clocktower | Twin reflecting basins; garden court with a stepped tower crown; open belfry and shaded seating |
| Market | Single covered hall; twin flower-market halls; long hall beside a lantern-lit stall court |
| Gardens | Central palm house; twin conservatories; transverse glasshouse above a water garden |
| Tram depot | Three sheds; paired platforms and planted center; maintenance yard and elevated water tank |
| Sculpture park | Balancing beams; nested colored gates; monumental sundial |

Four address colours distribute ordinary park/plaza layouts so edge-adjacent
sites cannot share the same design, including negative addresses. A world-seeded
phase changes that distribution between worlds. Landmarks choose from three
compositions using their block seed, preserving the five existing discovery
types, stamps, names, signs and destinations. Three restrained palettes, flower
planting, tree species and sizes provide variation within the compositions.
Ordinary parks and plazas also choose one of four orientations, moving the
paths, structures and colliders together so recurring designs face differently.

All choices occur during chunk construction. Planting uses an independent seeded
stream; detail-only flowers, benches and produce cannot change the main layout.
Buildings, roofs, pergolas, decks and fountains use rigid assembly frames.
Flexible lawns, paths and landscape beds follow the street layout. Keep the
perimeter sidewalks and driving lanes clear.

## Connections and planting

Paths use joined ribbons with shared corners. Closed loops have a joined closing
edge; diagonal entrances extend through the boundary before being cut flush with
the lawn. Footpaths reach the pond deck's steps, conservatory forecourts, pergola
paving and café terraces. Seating bays align with the path tangent. The terrace
garden's paths circulate around its fountain. Discovery signs sit beside their
entrances instead of obstructing them.

Curving flower beds use continuous authored ribbons, including offsets derived
from the footpath itself. Placement reserves walking clearance and space around
pools, pergolas, seating and other beds. Polygon subtraction checks whether the
whole proposed bed fits. **Clipped remnants are never rendered**: try a modestly
narrower complete bed, or leave open space. This avoids spikes, thin leftovers
and irregular scraps. Soil and flowers stay inside the stone rim. Planting
collisions use the same convex footprints, testing every edge.

The audit also aligns depot sheds/trams/rails and forum stair tiers within common
rigid frames, lowers the sculpture park's paving to match surrounding ground, and
joins bridge parapets to the actual bank-rail endpoints in both river directions.

## Rendering budget

Reuse the existing box instances and city materials. One shared eight-sided
cylinder supplies basins, umbrella canopies and round paving. Its stone and
water instances share two batches across the entire distant city. Ground uses
shared triangular surfaces with matching boundary vertices instead of overlapping
tangent tiles; thick curbs and riverbanks retain side walls. Flat overlays avoid
hidden side/bottom triangles, and the redundant buried land slab is removed.
Straight regions skip subdivision and mapped vertices are cached during block
construction. The combined outer ring is bounded at fourteen draw calls. Major forms and
tree crowns stay identical across detail levels. Small flowers, furniture and
produce disappear at distance. No new animation, per-frame generation, textures
or per-site material allocations are needed.

In the same seed-4817 neighborhood view, this seam pass changes geometry from
865,478 to 744,910 triangles (about 14% fewer). Instances increase from 79,040 to
106,577 and batches from 404 to 457 because shared triangular ground panels
replace box surfaces. This is a geometry tradeoff, not a measured FPS gain.
The fountain court's paving also uses the ground batch, avoiding self-shadow
stripes from a shallow raised disk.

## Verification

- Generate all 23 designs at three real addresses each, with a fourth address
  for ordinary parks and plazas to cover every orientation. Check deterministic
  revisits, matching near/far structures, orthogonal transforms, street
  clearance and bounded instance counts. Verify planting clears paths, other
  plots and reserved structures, rejects thin scraps, and keeps trees/benches
  beside walking routes.
- Run the complete unit suite with multiple world seeds and build production.
- `npm run test:spaces` renders all designs in the real browser renderer and
  saves a labelled visual gallery, a close-up gallery of all 23 designs and three
  river junctions, plus geometry counts under
  `.artifacts/public-spaces/`. Set `TEST_URL` for a non-default dev-server port.
- Inspect both the design gallery and the spaces within the surrounding city.
- Check shared ground edges across positive/negative chunk addresses and both
  river directions, full-width path entrances, loop joins, actual bridge/bank
  endpoints, and polygon collisions. Run the controller through eight curved
  street/bridge configurations and the browser/taxi regressions.

The variants are authored families, not a promise that no two parks anywhere
in the infinite city will ever resemble one another. Distinct adjacent layouts
and a consistent visual language are the intended balance.
