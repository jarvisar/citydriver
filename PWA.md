# Install the website

Open [Coastline](https://jarvisar.github.io/coastline/) in your browser:

- **iPhone / iPad:** in Safari, tap **Share → Add to Home Screen**. Leave **Open as Web App** enabled if shown.
- **Android:** in Chrome, choose **Install app** or **Add to Home screen** from the browser menu.
- **Desktop Chrome / Edge:** use the address bar's install icon or the browser menu's install option.

The welcome and pause screens also have an install button. It opens the browser's install prompt when available, or shows instructions.

After the first online load and service worker installation, all six routes work offline. Close all Coastline tabs and app windows, then reopen to activate a downloaded update. Clearing browser storage requires another online load. Driving progress lasts for the current visit.

The app requests fullscreen where supported. Some browsers keep their system bars or need a tap before entering fullscreen. If an existing installation keeps an old display mode, close and reopen it, or reinstall from the updated site.

## Hosting

```sh
npm run build
```

Deploy the entire `dist/` folder to an HTTPS host. For a subdirectory:

```sh
npm run build -- --base=/coastline/
```

Only production builds register the offline service worker. Use `npm run preview` to test it on localhost, on a separate port from the dev server. An HTTP address on your local network doesn't support normal PWA installation; use HTTPS when testing on a phone.

Keep `sw.js` at a stable URL and serve it with `Cache-Control: no-cache`. The [PWA plugin](scripts/pwa-plugin.mjs) generates the precache from the build output, including assets and the chunk worker.

## Assets and tests

Regenerate icons from the favicon with `node scripts/pwa-icons.mjs`. Refresh install screenshots with `node scripts/pwa-screenshots.mjs`.

```sh
node scripts/pwa-test.mjs
node scripts/pwa-banner-test.mjs
node scripts/fullscreen-test.mjs
```

These check installation, offline driving, updates, subdirectory hosting, install controls, and fullscreen fallback. The PWA test creates its own builds and browser profiles under `.artifacts/`. It uses installed Chrome on Windows or Playwright Chromium elsewhere; set `CHROME_PATH` to use another executable.