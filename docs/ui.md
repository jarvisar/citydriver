# HUD & UI

## Driving HUD

Shift time and earnings are in the top left. Camera, reset, and pause are in the top right. The navigation card shows distance, destination, fare, and what to do next, with a green 3D arrow pointing to the destination.

- On phones the navigation card sits below the top row. On wider screens it sits between the corners.
- The map starts closed on small screens and open on desktop. If you open or close it yourself, it stays that way when the window is resized.
- Nothing is shown in the navigation card until a passenger boards. Before that, only the nearby pickup rings show on the map.
- The delivery timer reads `Arrive in …s` and is separate from the shift clock.
- Brake and boarding prompts show up when you arrive. Arrival prompts take priority over scoring messages.
- Boost charge is shown on the Boost button.

Phone text sizes are 14px for instructions, 17px for destinations, and 12px for everything else in the navigation card. Touch targets are at least 44px for map and pause and 64px for driving controls. The steering stick is on the right.

The arrow is a single low-poly mesh with no textures or shadows, drawn on its own canvas (104 × 104 max). It only redraws when the direction changes.

## Theme

`src/city-theme.css` loads after the component styles and sets colors, fonts, borders, and hover/focus states. Component styles handle layout and visibility.

| Role | Token / value |
| --- | --- |
| Panel | `--city-panel`: `#263b45` |
| In-game panel | `--city-glass`: panel color at 95% opacity |
| Raised control/card | `--city-raised`: `#304954` |
| Hover | `--city-hover`: `#3b5662` |
| Recessed content | `--city-recessed`: `#1b2d36` |
| Primary text | `--city-text`: `#f5f4e9` |
| Supporting text | `--city-muted`: `#c4d3d8` |
| Primary action/selection | `--city-accent`: `#ffd238` with dark text |
| Section label/focus | `--city-gold`: `#f3d899` |
| Panel/control corners | 16px / 10px |
| Font | Segoe UI, Arial, sans-serif |

Use slate for secondary buttons and yellow for primary buttons and selections. Red and green are for urgency and arrival. Use `--city-muted` for supporting text instead of lowering the opacity.

The district panel has to shrink and cut off its text before it overlaps the action bar.

## Tests

With the dev server running:

```sh
node scripts/hud-test.mjs
node scripts/taxi-test.mjs
```

The HUD test checks for overlap, screen bounds, touch target sizes, and map controls at 320×568, 390×844, 568×320, 667×375, 844×390, 768×1024, and 1440×960. Screenshots go to `.artifacts/hud/`. Run it after changing touch sizes or layout.
