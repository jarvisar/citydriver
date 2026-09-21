# Install Citydriver for offline play

The production build includes a web app manifest, installation icons, and a service worker. After a complete online load, the cached game can run offline. On a hosted site, HTTPS is required; localhost also works for development checks.

Open the pause menu and choose **Install Citydriver**. Where the browser supports an installation prompt, it opens directly. Otherwise, the button shows the appropriate browser-menu instructions. On iPhone or iPad, use Safari's Share menu and Add to Home Screen.

## Local production check

```sh
npm run build
npm run preview
```

Open the preview URL and wait for the city to finish loading before going offline. The offline bundle includes the city generator, garage, audio, and rendering code. Generation does not fetch map data from a server.

Development with `npm run dev` shows the install help but does not register a service worker, so edits are not hidden behind an older cached build.

## Updating and hosting

The build hashes the generated files into a cache version. A new service worker waits while the current game is open; closing the game's tabs allows the new version to become active. Cache cleanup only removes old Citydriver caches within the same scope.

The manifest and generated asset URLs work at the site root or under a subdirectory. The GitHub Pages workflow builds with `npm run build -- --base=/citydriver/` and deploys successful builds from `main`. Use the same command to preview the hosted layout locally.

## Assets and checks

```sh
npm run pwa:icons
npm run pwa:screenshots
npm run test:pwa
```

Icon generation rasterizes the local city SVG using a browser. Screenshot generation captures the game at desktop and mobile sizes. Set `CHROME_PATH` when Chrome is installed outside the default location. Checks cover the manifest, icon dimensions, installation UI, offline startup and driving, and safe cache updates at root and subdirectory URLs.
