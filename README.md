# Coastline

Endless driving game built with [Three.js](https://threejs.org/). Drive yourself or turn on autodrive. Supports keyboard, touch, controllers, and browser VR.

[Play in your browser](https://jarvisar.github.io/coastline/) or download a [desktop build](https://github.com/jarvisar/coastline/releases). See [desktop setup](ELECTRON.md) for Windows, Linux, macOS, and Steam Deck, or [PWA.md](PWA.md) to install the website for offline use.

## Run locally

Requires Node.js 22.12 or newer.

```sh
npm install
npm run dev
```

Open the URL printed by Vite. Use its Network URL to play on a phone on the same Wi-Fi. On Windows, allow Node through the firewall for private networks if prompted.

To build and preview:

```sh
npm run build
npm run preview
```

## Routes and cars

Use **Change Route** or press **1–6**:

1. Pacific Coast
2. Red Rock Desert
3. Midnight Alpine
4. Emerald Jungle
5. Golden Plains
6. Rainy Downtown

Each route keeps your position and mileage for the current visit. Reset starts the current route in a new area with zero mileage. Reloading generates a new world; add `?seed=4817` to the URL to revisit or share one. Seeds can be any unsigned 32-bit integer.

Open **Garage** to change cars or paint. **Default** uses the route's car. Cars have different handling and lose speed and grip off-road. Your car choice is saved; paint applies to all cars for the current visit and resets on reload.

## Controls

Controller labels below use Xbox / PlayStation names.

| Action | Keyboard | Controller |
| --- | --- | --- |
| Accelerate | W / ↑ | RT / R2, or A / Cross |
| Brake, then reverse | S / ↓ | LT / L2, or B / Circle |
| Steer | A D / ← → | Left stick / D-pad left and right |
| Strong brake | Space | — |
| Change view | V | X / Square |
| Autodrive | H | D-pad Up |
| Pause / resume | P / Escape | Start / Menu / Options |
| Garage | C / G | Left stick press (L3) |
| Next route | N | RB / R1 |
| Choose route | 1–6 | Select / Back / View |
| Reset | R | Y / Triangle |
| Sound | M | Pause menu |
| Soft shading | O | Pause menu |
| Fullscreen | F | LB / L1 |
| FPS counter | F3 | Right stick press (R3) |

Numpad 8 / 2 / 4 / 6 also work for driving, with Num Lock on or off. Views include four overhead distances, third-person, and first-person.

Autodrive follows the road and passes slower traffic when there's room. Steering, accelerating, or braking gives control back to you.

On a controller, use the D-pad or stick to move through menus, A / Cross to select, and B / Circle to go back. Press a button if the browser hasn't detected the controller. Disconnecting or leaving the tab pauses the game; release held controls before resuming. If a browser blocks controller fullscreen, use F or the pause menu's Fullscreen button.

On touchscreens, tap **Let's drive**, then drag the joystick in the direction you want to move on screen. Drag farther to go faster; release to stop. In first-person and third-person views, push up to accelerate, left/right to steer, and down to brake or reverse.

For free driving off-road, enter **↑ ↑ ↓ ↓ ← → ← → B A** on the keyboard. On a controller, use the same D-pad sequence, then B and A (Circle and Cross), while driving. Enter it again to return to the road. Reloading turns it off.

## Settings

The pause menu has traffic, sound, fullscreen, and graphics controls. **Auto** adjusts graphics quality while driving; High, Balanced, Smooth, and Basic set a fixed level. Lower levels reduce resolution, shadow detail, and view distance. The pixel-density slider adjusts resolution separately. Changes to multisampling take effect on the next load.

**Soft shading** adds ambient occlusion and starts off. It is saved separately from graphics quality; `?ao=0` disables it for a visit. Sound also starts off. Press **M** to enable it, and use **Audio settings** for channel volumes, presets, and optional music. See [audio.md](docs/audio.md).

## Quest / browser VR

Open the HTTPS site in the Quest browser, then choose **Enter VR** on the title screen or in the pause menu. The button appears when immersive WebXR is available. A plain HTTP local-network URL won't work; local headset development needs HTTPS with a trusted certificate. VR is only available in the browser build.

- **Left stick:** steer. The right stick works if only the right controller is connected.
- **Right trigger:** accelerate. **Left trigger:** brake, then reverse. **Either grip:** strong brake.
- **A:** change view. **B / left stick press:** pause or resume.
- **X:** reset. **Y:** exit VR. **Right stick press:** recenter.

VR starts in third-person and supports all six views. In menus, use stick up/down and A, or point at a button and pull a trigger. B goes back. Exiting VR pauses the game and restores the previous camera. Custom paint entry remains on the regular page.

## Development

Route generation and scenery live in [src/world/](src/world/), driving in [vehicle.js](src/vehicle.js), and scene setup in [main.js](src/main.js). Geometry and audio are generated in code; there are no external model, texture, or audio downloads.

```sh
npm test
```

With the dev server running, `npm run test:browser` checks driving and streaming. Other checks are listed in [package.json](package.json) and [scripts/](scripts/). Browser scripts generally use Chrome installed at the standard Windows path and accept `TEST_URL` to change the server address. Reports go to `.artifacts/`. Emulated browser and VR checks don't measure performance on physical phones or headsets.

See [discovery frequency](docs/discoveries.md) to change how often landmarks appear.
