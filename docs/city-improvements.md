# City destinations and architecture

The visual audit used city seed `4817`, photographing the starting neighborhood, waterfront, midtown, street level, and actual gameplay before editing. The main opportunities were repeated flat rooflines, similar storefronts, and only five landmark categories.

The implementation gives the city more recognizable places to drive to and more distinct silhouettes. All scenery is procedural Three.js geometry using the existing instance batches and city materials; it requires no downloaded assets or new dependencies.

## Places with a purpose

The original clocktower, market, botanical garden, tram depot and sculpture park are joined by ten landmark types:

| Destination | Recognizable features |
| --- | --- |
| Rivoli Cinema | Art Deco blade sign, illuminated marquee, posters, ticket booth and cafe tables |
| Grand Hotel | Copper crown, sheltered entrance, reflecting pools and planted roof terrace |
| City Museum | Colonnade, pediment, skylight and sculpture forecourt |
| Union Station | Vaulted train shed, clock, platforms and parked trains |
| Central Library | Glass rooftop lantern, timber facade fins and shaded reading garden |
| City Hospital | Twin wings, red cross, entrance canopy and rooftop landing pad |
| Star Observatory | Slotted copper dome, telescope and orbit garden |
| Blue Note Club | Piano-key facade, illuminated sign, courtyard stage and cafe tables |
| Athletic Club | Tennis or basketball courts, clubhouse and seating |
| Engine House | Red engine doors, hose tower and parked heritage fire engine |

Each landmark has three seeded variations. The four park designs and four square designs also become named destinations, for **17 saved discovery categories and 53 public-space designs**. One dedicated landmark still appears in every three-by-three neighborhood; ordinary parks and squares add more stops between them. Existing discovery IDs and the storage key stay compatible with collected stamps.

Customer pickup options preview their destination and passenger type. Three offers favor different destination categories, and completed fares avoid repeating the three most recent types when alternatives exist. Stops stay on road lanes, outside medians and away from one another. Routes continue to use the connected streets and bridges. Discoveries now update during active taxi runs as well as free drive.

The notebook scrolls within the pause panel. Choosing a category searches farther than the local minimap when needed; navigation also shows the neighborhood and kind of place.

## Architecture

Four new styles join the original six: mansard townhouses with dormers and shutters, industrial lofts with monitor roofs and chimneys, low pavilions with butterfly roofs, and stepped atrium buildings with glazed rooftop lanterns. There are eight roof families and ten storefront signs. Palettes favor terracotta and copper in old town, pastel walls in garden districts, glass and pale trim in midtown, and warmer brickwork in industrial blocks.

The roof integration pass keeps the butterfly profile, with glazed end infills, a continuous fascia, a narrow central gutter and downpipes. Eave heights now follow the building support height and roof width. Pitched roofs have closed triangular infills and ridge caps, mansards use a continuous tapered solid, factory sawteeth have closed ends, and the station vault uses a single closed shell. Parapet corners meet without overlapping coplanar faces. Shared roof geometry is defined in `src/world/city-roofs.js` and used by ordinary buildings and landmarks at both detail levels.

`node scripts/roof-review.mjs` captures all eight building roof families and seven landmark roof sites from opposite approaches. The local review is `.artifacts/roof-review/gallery.html`, with 30 full-resolution images. Geometry checks verify closed solids and uninterrupted roof coverage across narrow and wide lots.

Existing parcel fitting, rigid transforms, street clearance, four-sided facades, and near/distant geometry remain shared. Small sign lettering, flowers and furnishings disappear at distance; building silhouettes and main materials remain consistent. The new landmark dome shares one reusable geometry; signs share textures by label.

## Visual review and checks

The local review is `.artifacts/city-tour/gallery.html`, with an interactive before/after slider and a gallery of the destinations and architecture. PNG originals are in the `before` and `after` subdirectories. These generated artifacts are intentionally outside version control.

With the Vite server running, capture an updated tour:

```powershell
$env:TEST_URL = 'http://127.0.0.1:5173'
node scripts/city-tour.mjs after
node scripts/city-tour-gallery.mjs
```

The existing baseline is preserved; `node scripts/city-tour.mjs before` is only needed when beginning a new comparison. Both phases use fixed city coordinates, camera positions, and daylight for the four city studies. The gameplay shot uses the live game camera. A separate night study checks the cinema lighting.

Validation covers all building families, every public-space variant, dry road access and collisions, distant silhouettes, old discovery saves, all 17 notebook destinations, and a sequence of varied passenger trips. Browser suites exercise real pickup/payment, discoveries, saved progress, desktop/touch controls, weather, and city streaming. The public-space gallery also renders all 53 designs plus three river joins.

The roof integration pass finished with 212 passing unit tests and a successful production build. Its 30 roof review images, all 53 public-space variants, and rendering regression browser checks completed without errors; city and taxi browser checks also passed during the original city expansion. Rendering checks include all six cameras, both phone orientations, staged streaming, and repeated optional-shading cleanup. That cleanup test now uploads the shared sign textures before measuring; seeing a new shop in a different camera must not be confused with a leaked shading target.

The initial city-improvement pass recorded the following geometry cost, before the subsequent roof integration refinements. These counts include the screenshot lighting/shadow passes; they are not frame-rate measurements. Current captures write their measurements to `.artifacts/city-tour/after/report.json`:

| View | Draw calls before → after | Triangles before → after |
| --- | --- | --- |
| Starting neighborhood | 953 → 972 | 1,042,832 → 1,167,378 |
| Waterfront | 992 → 1,030 | 816,840 → 970,062 |
| Midtown | 986 → 1,029 | 833,772 → 926,968 |
| Street level | 801 → 821 | 749,902 → 825,302 |
