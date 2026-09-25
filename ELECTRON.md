# Desktop App

The desktop app is the browser build running inside Electron. Saves are stored separately from the browser version.

## Running Locally

```sh
npm install
npm run electron:dev
```

Use `npm run electron:start` to build and run the production version.

The app starts in fullscreen. Press F, F11, or Alt+Enter to toggle it. Escape pauses.

Launch flags: `--windowed`, `--fullscreen`, `--seed=4817`, `--devtools`, `--software-gl`, and `--dev-url=http://127.0.0.1:5173`.

Environment variables: `CITYDRIVER_DEV_URL`, `CITYDRIVER_DEVTOOLS`, `CITYDRIVER_SOFTWARE_GL`, `CITYDRIVER_FULLSCREEN`, and `CITYDRIVER_USER_DATA`.

## Building

```sh
npm run electron:pack
npm run electron:build:win
npm run electron:build:linux
npm run electron:build:mac
```

Build on the platform you're targeting. Output goes to `release/`:

- Windows: installer and portable EXE
- Linux: AppImage (run `chmod +x` on it before launching)
- macOS: DMG and ZIP

Builds are unsigned. Run `npm run electron:icons` after changing `public/favicon.svg`.

## Tests

```sh
npm run test:electron -- --build
npm run test:electron -- --packaged
```

Checks startup, driving, settings, and fullscreen. Reports go to `.artifacts/electron/`.

## Releases

Commit your changes, then create and push a version tag:

```sh
npm version patch
git push --follow-tags
```

Pushing a `v*` tag runs **Build Citydriver desktop** in GitHub Actions. Once the builds finish, the packages show up under **Releases**. Tags created before the release workflow was added won't build.

Running the workflow manually or building locally doesn't publish a release. There is no auto-updater.
