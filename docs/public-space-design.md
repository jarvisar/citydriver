# Public-space variation

The old park and plaza generators repeated the same central fountain and tree
rows. Each discovery type also repeated a single composition. Give each site a
clear identity through its footprint, circulation, planting and skyline, while
keeping the existing low-poly palette and rigid architectural assemblies.

## Compositions

| Site | Designs |
| --- | --- |
| Park | Gently asymmetric pond with a viewing deck; orchard and café; winding meadow walk; formal flower terraces |
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

Public spaces are separated by more ordinary city blocks: dedicated landmarks
occupy one dry block per four-by-four neighborhood, and 3% of the remaining dry
blocks become parks/squares. Parks retain 65% of that allocation. This produces
about 30% more normal building blocks than the former three-by-three / 20%
distribution, without increasing individual building footprints or changing
streets. All 17 discovery categories and 53 designs remain available.

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

Reuse the existing box instances and city materials. Broad round forms use a
shared 24-sided cylinder; natural ponds have a shared 32-point asymmetric shore.
Basins use open rings with recessed water, avoiding hidden floors and bottoms.
Water is a single triangle fan (24 or 32 triangles). Twelve-panel peaked café
canopies and 80-triangle faceted planet sculptures retain the low-poly style.
These templates are shared across sites and detail levels. Ground uses
shared triangular surfaces with matching boundary vertices instead of overlapping
tangent tiles; thick curbs and riverbanks retain side walls. Flat overlays avoid
hidden side/bottom triangles, and the redundant buried land slab is removed.
Straight regions skip subdivision and mapped vertices are cached during block
construction. Distant two-by-two tiles have a regression budget of seventeen
geometry/material batches. Major forms and
tree crowns stay identical across detail levels. Small flowers, furniture and
produce disappear at distance. No new animation, per-frame generation, textures
or per-site material allocations are needed.

In the same seed-4817 neighborhood view, this seam pass changes geometry from
865,478 to 744,910 triangles (about 14% fewer). Instances increase from 79,040 to
106,577 and batches from 404 to 457 because shared triangular ground panels
replace box surfaces. This is a geometry tradeoff, not a measured FPS gain.
The fountain court's paving also uses the ground batch, avoiding self-shadow
stripes from a shallow raised disk.

## Silhouette, entrance and contrast audit

The refinement pass covers all 53 current public-space/destination designs:
rounded fountains and paving, softly sampled pond/meadow/conservatory walks,
properly shaped café umbrellas, and round observatory walls and sculpture bases.
Trees, angular sculptures and rectilinear architecture keep their deliberate
facets. Three near-only lily pads reuse the pond's water batch.

Entrance paths terminate at actual rigid threshold corners, inverse-mapped into
the flexible ground layout. This joins the whole width on curved blocks instead
of stopping at an approximate address or canopy edge. Conservatories have steps
to their raised foundations; destination halls have visible doors and thresholds;
cinema approaches split around the ticket booth. The pond deck, pergolas, museum
steps and observatory stairs use the same connection helper. Regular buildings
have paving aprons from their positioned facades to the sidewalk, including lots
that moved inward during placement.

Park paths use light limestone against green lawns; plaza routes use darker warm
paving against pale stone. Every palette maintains a luminance contrast above
1.7:1 between route and ground. Storefront aprons and service paving also differ
from the surrounding gray sidewalk. This is an art-direction check, not a UI
accessibility claim.

Seed-4817 neighborhood measurements, including entrance and contrast changes:

| Metric | Before | After |
| --- | ---: | ---: |
| Triangles | 938,152 | 957,226 |
| Instances | 118,704 | 123,734 |
| Batches | 824 | 835 |
| Distant batches | 360 | 367 |

That is about 2.0% more triangles and 1.3% more batches. No new textures,
materials, animation or per-frame generation are added. These are geometry
measurements, not a hardware FPS guarantee. The browser performance regression
also exercises phone layouts, all six cameras, quality changes and streaming.

Lawn borders and walking-route edges also receive small, broken clusters of
faceted grass. Parks, conservatory lawns and open grassy building lots share a
12-triangle, three-blade tuft, capped at 64 instances per nearby block. An
independent seed varies spacing, heading, height and the existing lawn tint.
Actual structure footprints, paving, entrance paths and seating stay clear;
most lawn interiors remain open. Grass uses the existing vertex-color material,
casts no shadows, requires no animation/textures and is omitted at distance.
The seed-4817 neighborhood adds roughly 0.4% triangles and one batch per nearby
grassy block; distant batches are unchanged.

## Verification

- Generate all 53 designs at three real addresses each, with a fourth address
  for ordinary parks and plazas to cover every orientation. Check deterministic
  revisits, matching near/far structures, orthogonal transforms, street
  clearance and bounded instance counts. Verify planting clears paths, other
  plots and reserved structures, rejects thin scraps, and keeps trees/benches
  beside walking routes.
- Run the complete unit suite with multiple world seeds and build production.
- `npm run test:spaces` renders all designs in the real browser renderer and
  saves a labelled visual gallery, a close-up gallery of all 53 designs and three
  river junctions, plus geometry counts under
  `.artifacts/public-spaces/`. Set `TEST_URL` for a non-default dev-server port.
- Inspect both the design gallery and the spaces within the surrounding city.
- Raycast entrance paving across the full threshold width on curved blocks;
  check recessed water, continuous rim faces, silhouette error, shared geometry
  budgets and paving contrast. Repeat public-space/building/streaming checks with
  `TEST_WORLD_SEED=2026` as well as the default seed.
- Check shared ground edges across positive/negative chunk addresses and both
  river directions, full-width path entrances, loop joins, actual bridge/bank
  endpoints, and polygon collisions. Run the controller through eight curved
  street/bridge configurations and the browser/taxi regressions.

The variants are authored families, not a promise that no two parks anywhere
in the infinite city will ever resemble one another. Distinct adjacent layouts
and a consistent visual language are the intended balance.
