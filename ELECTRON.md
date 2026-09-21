# Desktop app

The desktop app packages the web game with Electron. Download builds from [Releases](https://github.com/jarvisar/coastline/releases):

- **Windows:** installer (`-setup.exe`) or portable executable (`-portable.exe`).
- **Linux / Steam Deck:** AppImage.
- **macOS:** DMG or ZIP; `arm64` for Apple silicon, `x64` for Intel.

Packages are unsigned. Windows may require **More info → Run anyway**; macOS may require right-clicking the app and choosing **Open**. On Linux, make the AppImage executable before running it:

```sh
chmod +x Coastline-*.AppImage
```

The app starts fullscreen. F, F11, Alt+Enter, LB / L1, or the pause menu toggle fullscreen. Escape opens or closes menus without leaving fullscreen. F12 opens DevTools.

## Run from source

Requires Node.js 22.12 or newer.

```sh
npm install
npm run electron:dev
```

This starts Vite and opens an Electron window with hot reload. Use `npm run electron:start` to build and open the production version, or `npm run electron:dev -- --url=http://127.0.0.1:5173` to use an existing dev server.

## Launch options

Pass these to the executable, through Steam launch options, or after `npm run electron:dev --`.

| Flag | Environment variable | Effect |
| --- | --- | --- |
| `--fullscreen` / `--windowed` | `COASTLINE_FULLSCREEN=1` / `0` | Set the starting window mode. Default: fullscreen. |
| `--seed=<n>` | | Open a specific world. |
| `--software-gl` | `COASTLINE_SOFTWARE_GL=1` | Use SwiftShader for testing GPU problems. Runs slowly. |
| `--devtools` | `COASTLINE_DEVTOOLS=1` | Open DevTools on launch. |
| `--dev-url=<url>` | `COASTLINE_DEV_URL` | Load a dev server instead of the built game. |
| | `COASTLINE_USER_DATA=<dir>` | Use a separate profile directory. |
| `--help` | | Print the options. |

Profiles are stored in `%APPDATA%\Coastline` on Windows, `~/.config/Coastline` on Linux, and `~/Library/Application Support/Coastline` on macOS. Delete `window-state.json` there to reset window size and position.

## Steam Deck

1. In Desktop Mode, download the AppImage and mark it executable in **Properties → Permissions**.
2. Open it once to check it runs.
3. In Steam, choose **Games → Add a Non-Steam Game → Browse**. Select **All Files** and add the AppImage.
4. Set its controller layout to **Gamepad** or **Gamepad with Joystick Trackpad**.
5. Launch it from the **Non-Steam** tab in Game Mode. Use the Steam menu's **Exit Game** to quit.

See the [controller mapping](README.md#controls). Steam's **Properties → Launch Options** accepts flags such as `--windowed` or `--seed=4817`.

## Build packages

Build commands rebuild the web game into `dist-electron/` and write packages to `release/`.

| Command | Output |
| --- | --- |
| `npm run electron:pack` | Unpacked app for the current OS |
| `npm run electron:build` | Packages for the current OS |
| `npm run electron:build:win` | Windows x64 installer and portable executable |
| `npm run electron:build:linux` | Linux x64 AppImage |
| `npm run electron:build:mac` | macOS arm64 and x64 DMG and ZIP |
| `npm run electron:icons` | Regenerate the icon from `public/favicon.svg` |

Use a macOS host for macOS packages. Build the Linux AppImage on Linux or in WSL; Windows can produce an unpacked Linux build, but can't finish the AppImage. For WSL, use a separate checkout and install Node inside WSL:

```sh
git clone https://github.com/jarvisar/coastline.git ~/coastline
cd ~/coastline
npm ci
npm run electron:build:linux
```

Package targets and installer options are in [builder.config.cjs](electron/builder.config.cjs).

## Releases

The [Desktop app workflow](.github/workflows/desktop.yml) tests pushes to `main` and pull requests. A `v*` tag builds packages on Windows, Linux, and macOS and attaches them to a GitHub release. A manual workflow run builds downloadable artifacts without publishing a release.

To bump the patch version and publish:

```sh
npm version patch
git push --follow-tags
```

The macOS smoke test is informational and doesn't block releases; its CI runner hasn't loaded the WebGL scene reliably.

## Wrapper and tests

[main.js](electron/main.js) serves `dist-electron/` at `app://coastline/`. The renderer is sandboxed, with a [preload bridge](electron/preload.cjs) for fullscreen and Escape. PWA installation and service worker scripts are disabled in Electron. External links open in the system browser.

Web changes reach the desktop app on the next build. If asset paths or extensions change, check the protocol handler and MIME table. If PWA script names change, update `WEB_ONLY_SCRIPTS`. The manifest supplies app metadata; `package.json` supplies the version. Regenerate the desktop icon after changing the favicon.

Check the current source:

```sh
npm run test:electron -- --build
```

Check a packaged app:

```sh
npm run electron:pack
npm run test:electron -- --packaged
```

These tests cover loading, the chunk worker, storage, controls, fullscreen, and route switching. Reports and screenshots go to `.artifacts/electron/`. Pass `--windowed` to test that startup option. The tests use the installed Electron package and don't need a separate browser download.

## Troubleshooting

- **Missing web build:** run `npm run electron:web`, or use `npm run electron:dev`.
- **Black window:** open DevTools with F12 and check for WebGL errors. Try `--software-gl` to check whether the GPU is the cause.
- **Electron prints a Node version:** unset `ELECTRON_RUN_AS_NODE`, or use the repo's launch scripts, which remove it.
- **Linux sandbox error:** try `--no-sandbox` if the system blocks user namespaces.
- **Missing FUSE:** run `./Coastline-*.AppImage --appimage-extract`, then `squashfs-root/coastline`.
- **macOS still blocks the app:** for the downloaded app in `/Applications`, run `xattr -cr /Applications/Coastline.app`.
- **Windows packaging fails with `EPERM` during rename:** use the repo's build scripts and config, which stage Electron by copying.
- **No sound:** sound starts off. Press M or enable it in the pause menu.
