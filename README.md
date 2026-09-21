# Citydriver

Every street leads somewhere.

Citydriver is a free-driving game built with Three.js. It turns the original sixth city scene into a world of its own: a procedural city that extends north, south, east, and west. Turn at intersections, cross river bridges, and explore at your own pace.

This is the first playable foundation, version 0.1.0. The city has connected streets, buildings detailed on every side, a choice of weather and lighting, and the existing garage, camera views, audio, keyboard, touch, and controller support. Traffic runs along both street axes, follows other vehicles, and waits at timed intersections. The initial world uses a rectangular street grid; missions and more district variety remain future work.

## Run locally

Use Node.js 22.12 or newer. From this directory:

```sh
npm install
npm run dev
```

Open the local URL Vite prints. To build and preview the production game:

```sh
npm run build
npm run preview
```

Add `?seed=4817` to the URL to return to the same generated layout. Without a seed, a new session chooses a new world. Reset moves to a fresh area of the same seeded city and clears the distance driven.

## Driving

| Action | Keyboard | Controller |
| --- | --- | --- |
| Accelerate | W / Up | RT / R2 or A / Cross |
| Brake, then reverse | S / Down | LT / L2 or B / Circle |
| Steer | A D / Left Right | Left stick or D-pad |
| Strong brake | Space | — |
| Change camera | V | X / Square |
| Pause / resume | P / Escape | Start / Menu |
| Garage | C / G | Left stick press |
| Reset in a new area | R | Y / Triangle |
| Cruise along the current street | H | D-pad Up |
| Fullscreen | F | LB / L1 |
| Sound | M | Pause menu |

On touchscreens, drag the virtual joystick to drive and release to stop. The pause menu holds the garage, sound, graphics, and weather settings. Choose changing skies, clear day, overcast, rain, storm, golden hour, or night.

Autodrive cruises along the nearest street in your current cardinal direction, obeying traffic and signals. Turn it off to choose a turn at an intersection.

The compass and neighbourhood readout help you keep your bearings. Roads continue in both axes, including connected bridge crossings. Your chosen car is saved locally; garage paint applies across the fleet for the current visit.

## Checks

```sh
npm test
npm run build
npm run test:browser
npm run test:pwa
```

The browser check uses the running development server; set `TEST_URL` if it is not at the default address. `CHROME_PATH` selects a Chrome executable when needed. The PWA check starts its own local servers and checks installation assets and offline loading.

## Desktop and offline play

[Desktop setup](ELECTRON.md) describes the Electron shell and local packages. [PWA setup](PWA.md) describes browser installation and offline caching. The new city mark is a local SVG; `npm run pwa:icons` and `npm run electron:icons` regenerate installation icons.

No public Citydriver deployment or release feed is configured. Desktop automatic updates are disabled, and GitHub workflows only validate or produce downloadable build artifacts. They do not publish the game.

## Project scope

All work for this project belongs inside the `citydriver` directory. The separate original game, its backup, and its GitHub repository must remain untouched. This copy uses its own app identity, browser storage, offline cache, desktop origin, and package name.
