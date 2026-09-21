# Citydriver desktop

The Electron shell runs the same Citydriver build as the browser. It serves local assets from `app://citydriver/`, supports native fullscreen, and keeps its own application data.

## Develop

```sh
npm install
npm run electron:dev
```

To run a production renderer build locally:

```sh
npm run electron:start
```

Useful launch flags are `--windowed`, `--fullscreen`, `--seed=4817`, `--devtools`, and `--software-gl`. Fullscreen is the default. F, F11, or Alt+Enter changes fullscreen; Escape pauses the game. Use `--dev-url=http://127.0.0.1:5173` to attach directly to a running Vite server.

Environment overrides use the `CITYDRIVER_` prefix: `DEV_URL`, `DEVTOOLS`, `SOFTWARE_GL`, `FULLSCREEN`, and `USER_DATA`.

## Build local packages

```sh
npm run electron:pack
npm run electron:build:win
npm run electron:build:linux
npm run electron:build:mac
```

Packages are written to `release/`. Build the target platform on a suitable host. Windows produces an installer and portable executable, Linux an AppImage, and macOS DMG/ZIP packages. These are unsigned local builds. On Linux, make the AppImage executable before launching; it can also be added as a non-Steam game.

The desktop icon comes from `public/favicon.svg`. Regenerate it with `npm run electron:icons` after editing the mark.

## Check the shell

```sh
npm run test:electron -- --build
npm run test:electron -- --packaged
```

The smoke check launches Electron, verifies the local renderer, driving, city settings, fullscreen, and isolation from browser-only installation helpers. Reports and screenshots go to `.artifacts/electron/`.

## Releases

There is no Citydriver release destination configured yet. The shell has no updater and makes no requests to the original game's release feed. The builder uses `publish: null`; npm packaging commands also pass `--publish never`. The desktop GitHub workflow runs manually and uploads build artifacts only.
