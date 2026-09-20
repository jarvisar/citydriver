# Coastline on the desktop

Windows, Linux (including the Steam Deck), and macOS builds wrap the web app in [Electron](https://www.electronjs.org/). The desktop app ships the same `vite build` output as the website, with a small optional bridge for native fullscreen and Escape handling. This document covers running it, building it, putting it on a Steam Deck, and keeping it in step with the web app as the game changes. The web install flow is described separately in [PWA.md](PWA.md).

## How the wrapper works

- `electron/main.js` (the only process with Node access) registers a privileged `app://` scheme and serves `dist-electron/` from it at `app://coastline/`. Absolute `/assets/...` URLs, the module Web Worker, `localStorage`, and secure-context APIs therefore behave exactly as on the HTTPS deployment. `file://` is never used.
- The renderer runs with `contextIsolation` and `sandbox`. `electron/preload.cjs` exposes only fullscreen state/toggling and Escape notifications; it does not expose Node or general IPC access.
- The two web-only scripts injected by the PWA plugin, `pwa-register.js` (offline service worker) and `pwa-install.js` (install banners), are served as empty scripts. The build itself is untouched.
- Product name, description, window title, and background color come from `public/manifest.webmanifest`; the icon is rendered from `public/favicon.svg`; the version is `package.json`'s `version`.
- The app starts fullscreen. F, LB / L1, the menu button, F11, and Alt+Enter all toggle the same native window state. Escape opens/closes the pause menu (or dismisses an open chooser) without leaving fullscreen. On Windows this is borderless window fullscreen, not an exclusive display mode. The shell adds F12 for DevTools and remembers the window's size and position between launches.
- Links that leave the app open in the system browser; the window never navigates away from the game.

## Run from source

```sh
npm install
npm run electron:dev        # Vite dev server + Electron window with hot reload
npm run electron:start      # production renderer build (dist-electron/) in Electron
```

`npm run electron:dev -- --url=http://127.0.0.1:5173` attaches to a dev server that is already running. In dev mode the page exposes `window.__coastline` like the browser does; production builds do not.

Editor terminals often export `ELECTRON_RUN_AS_NODE=1`, which turns the Electron binary into plain Node. The repo scripts remove that variable; if you call `npx electron .` yourself, prefix it with `env -u ELECTRON_RUN_AS_NODE`.

### Options

Flags work with `electron .`, the packaged executables, and Steam launch options.

| Flag | Environment variable | Effect |
| --- | --- | --- |
| `--fullscreen` / `--windowed` | `COASTLINE_FULLSCREEN=1` / `0` | Start fullscreen or windowed. Default: fullscreen on every platform. |
| `--seed=<n>` | | Open a specific world, like `?seed=` on the web. |
| `--software-gl` | `COASTLINE_SOFTWARE_GL=1` | Render with SwiftShader instead of the GPU. Slow; for headless tests and diagnosing a black window. |
| `--devtools` | `COASTLINE_DEVTOOLS=1` | Open DevTools at startup. F12 or Ctrl+Shift+I toggles them at any time. |
| `--dev-url=<url>` | `COASTLINE_DEV_URL` | Load a Vite dev server instead of `dist-electron/`. |
| | `COASTLINE_USER_DATA=<dir>` | Use a separate profile directory (window state, local storage). |
| `--help` | | Print the options. |

Profiles live in `%APPDATA%\Coastline` on Windows, `~/.config/Coastline` on Linux, and `~/Library/Application Support/Coastline` on macOS. Deleting `window-state.json` there resets the window; deleting the folder resets stored preferences such as dismissed control help.

## Build packages

All build scripts rebuild `dist-electron/` first and write to `release/` (git-ignored).

| Script | Output | Builds on |
| --- | --- | --- |
| `npm run electron:pack` | `release/win-unpacked/` (or `linux-unpacked/`, `mac*/`): the app without an installer | any OS, for itself |
| `npm run electron:build:win` | `Coastline-<version>-win-x64-setup.exe` (installer: per-user, choose the folder) and `Coastline-<version>-win-x64-portable.exe` | Windows; Linux or macOS with Wine |
| `npm run electron:build:linux` | `Coastline-<version>-linux-x86_64.AppImage` | Linux, WSL, GitHub Actions (see below for Windows) |
| `npm run electron:build:mac` | `Coastline-<version>-mac-arm64.dmg`, `-x64.dmg`, and matching `.zip` files | macOS only (GitHub Actions) |
| `npm run electron:build` | the host OS's targets | any |
| `npm run electron:icons` | regenerates `electron/build/icon.png` from `public/favicon.svg` | any |

Verify any build with `npm run test:electron -- --packaged`, which launches the unpacked app and runs the same checks as CI.

Targets, architectures, and installer options are in `electron/builder.config.cjs`. The packaged app contains no `node_modules`: Vite bundles everything the renderer needs.

Windows notes:

- electron-builder normally extracts Electron into `release/<target>.tmp` and renames it, and antivirus or search indexing on some machines makes that rename fail with `EPERM`. On Windows hosts the config stages Electron by copying instead: `node_modules/electron/dist` for Windows targets, and a cached extraction of the official zip (under `node_modules/.cache/coastline-electron/`) for other targets.
- The Linux AppImage cannot be finished on Windows: the final step needs `mksquashfs`, which electron-builder only ships for Linux and macOS. `npx electron-builder --config electron/builder.config.cjs --linux --dir` still produces `release/linux-unpacked/` for inspection. To build the AppImage locally, use WSL with its own checkout (node_modules are platform-specific, so do not reuse the Windows folder):

  ```sh
  wsl -d Ubuntu
  git clone https://github.com/jarvisar/CarGame.git ~/CarGame && cd ~/CarGame   # Node.js 22.12+ or 24 required inside WSL
  npm ci && npm run electron:build:linux
  cp release/*.AppImage /mnt/c/Users/$USER/Desktop/
  ```

  Otherwise let GitHub Actions build it (a manual run of the *Desktop app* workflow is enough).
- macOS packages require a macOS host; they are only built on GitHub Actions.

### Releases on GitHub Actions

`.github/workflows/desktop.yml` does three things:

1. On every push and pull request it runs the desktop smoke test on Ubuntu against the current web build, so a web change that breaks the shell shows up immediately.
2. On a `v*` tag or a manual run it builds Windows, Linux, and macOS packages on their native runners and smoke-tests each unpacked build. The macOS smoke test is informational only: GPU-less macOS runners have not loaded the WebGL scene reliably, so its report and `failure.png` are uploaded as artifacts without blocking the release.
3. On a tag it attaches the installers to a GitHub release with generated notes.

```sh
npm version minor          # bumps package.json, commits, tags v1.1.0
git push --follow-tags     # triggers the build and release
```

A manual run (Actions → Desktop app → Run workflow) produces the same packages as downloadable artifacts without publishing a release. The website deployment (`main.yml`) is unaffected.

### Unsigned packages

No code signing certificates are used, so first launches show platform warnings:

- **Windows:** SmartScreen says "Windows protected your PC". Click *More info*, then *Run anyway*.
- **macOS:** Gatekeeper reports the app is damaged or from an unidentified developer. Right-click the app and choose *Open*, or run `xattr -cr /Applications/Coastline.app`. Apple silicon uses the `arm64` download, Intel Macs the `x64` one. macOS builds are only exercised by the CI smoke test.
- **Linux:** mark the AppImage executable (`chmod +x Coastline-*.AppImage`). If a distribution disallows unprivileged user namespaces, start it with `--no-sandbox`; if FUSE is missing, run `./Coastline-*.AppImage --appimage-extract` and start `squashfs-root/coastline`.

## Steam Deck

The Linux AppImage is the Steam Deck build. The game already supports controllers through the Gamepad API, so no extra mapping layer is involved.

1. **Desktop Mode:** download the `.AppImage` from the GitHub release, right-click it in Dolphin → *Properties* → *Permissions* → *Is executable* (or `chmod +x` in Konsole), then double-click to check it runs.
2. **Add to Steam:** in Steam (Desktop Mode) choose *Games* → *Add a Non-Steam Game to My Library…* → *Browse*, set the file type to *All Files*, pick the AppImage, and add it. Rename it and add artwork in its *Properties* if you like.
3. **Game Mode:** launch it from the *Non-Steam* tab. The app starts fullscreen by default, and gamescope keeps it there.
4. **Controls:** open the controller settings for the game and pick a *Gamepad* layout (for example *Gamepad with Joystick Trackpad*). The Deck's controls then arrive as a standard gamepad: left stick or D-pad steers, RT accelerates, LT brakes, Start pauses, LB toggles fullscreen, RB switches routes, and the View button opens the route chooser. A *Keyboard (WASD)* layout also works because the game supports keyboard driving, but without analog triggers.
5. **Launch options:** *Properties* → *Launch Options* accepts the flags above, for example `--windowed` or `--seed=4817`.
6. **Quit:** the Steam button → *Exit Game*, or close the window in Desktop Mode.

If the game does not appear in Game Mode, start it from Konsole in Desktop Mode to read the error. A sandbox error means `--no-sandbox` is needed in the launch options; a black window that never loads is a GPU problem, which `--software-gl` confirms (slowly). The Deck's 1280 × 800 screen runs at native pixel density, so the game's automatic density reduction does not engage.

## Keeping the desktop app in sync

Because the wrapper ships the web build as-is, new routes, scenery, cars, audio, and assets reach the desktop app on the next build with no wrapper changes. The wrapper depends on a short list of web-app details; when one of them changes, update the wrapper side rather than the game:

| Web app | Wrapper | When it changes |
| --- | --- | --- |
| `vite build` layout: `index.html` at the root, absolute `/assets/` URLs with the default base | `app://` handler in `electron/main.js`; `npm run electron:web` | Keep `vite build --outDir dist-electron` valid with base `/`. |
| `public/manifest.webmanifest` | product name, window title, colors, artifact names | Nothing to edit; a new `short_name` renames the packages and profile folder. |
| `public/favicon.svg` | `electron/build/icon.png` | Run `npm run electron:icons` and commit the result. |
| `pwa-register.js`, `pwa-install.js` (from `scripts/pwa-plugin.mjs`) | `WEB_ONLY_SCRIPTS` in `main.js` | Add or rename entries, or install UI and a service worker appear on desktop. |
| `#loading`, `#error`, `#welcome`, `#distance`, `#pause-overlay`, `#journey-transition`, `body[data-journey]`, keys W / P / F / N, `?seed=` | `scripts/electron-test.mjs`, `--seed` | Update the smoke test. |
| Files in `public/` with a new extension | MIME table in `main.js` | Add the extension. |
| New browser permissions (clipboard, pointer lock, notifications, camera) | Electron defaults | Add a permission handler in `main.js`. Gamepad, Web Audio, and WebGL need nothing. |
| `package.json` `version` | app version and release tag | `npm version …`. |

Checklist after web changes that touch the table:

1. `npm run test:electron -- --build` and look at `.artifacts/electron/*.png`.
2. Before a release, `npm run electron:pack && npm run test:electron -- --packaged`.
3. Update this document if flags or behaviour changed.

The smoke test verifies: the page is served over `app://` as a secure context, WebGL 2 is available, the chunk worker runs, no install UI or service worker exists, storage works, the window title and default fullscreen start, keyboard driving and pausing, Escape preserving fullscreen, F and the menu button toggling native fullscreen, F11 synchronizing the menu setting, cycling through every route, and the absence of console errors. Pass `--windowed` to check the startup override. Reports and screenshots are written to `.artifacts/electron/`. It uses Playwright's Electron support and the installed `electron` package; no browser download is required.

Claude Code users have matching project skills: `/electron-run`, `/electron-sync`, and `/electron-build` under `.claude/skills/`.

## Troubleshooting

- **"The web build is missing" dialog:** run `npm run electron:web` (or any `electron:*` build script), or start with `--dev-url`.
- **Window opens but the game never loads / black canvas:** check DevTools (F12) for WebGL errors. `--software-gl` rules the GPU in or out. The app already asks Chromium to ignore its GPU blocklist because the game needs WebGL 2.
- **Electron behaves like Node or prints a Node version:** `ELECTRON_RUN_AS_NODE` is set in the shell; see *Run from source*.
- **`EPERM: operation not permitted, rename … .tmp` while packaging on Windows:** see the Windows note under *Build packages*.
- **Window off-screen or oddly sized:** delete `window-state.json` in the profile folder. Positions are only restored when they are still on a connected display.
- **Sound does not start:** as in the browser, audio starts after the first key press or click; use M or the speaker button.
