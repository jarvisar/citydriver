# Install Coastline

Build with `npm run build` and deploy the entire `dist/` folder to an HTTPS host. No backend or additional packages are needed. Localhost also supports installation and offline testing via `npm run preview`.

- **iPhone / iPad:** open in Safari, tap Share, then Add to Home Screen. Leave Open as Web App enabled if shown, then tap Add.
- **Android:** open in Chrome and use the browser menu's Install app or Add to Home screen option.
- **Desktop Chrome / Edge:** use the install icon in the address bar or the browser menu's install option.

Browser wording and availability vary. The manifest requests `fullscreen` on launch, allowing Chrome on Android to hide the status and navigation bars. Unsupported browsers fall back to standalone mode. Android may temporarily reveal system controls following a swipe. Existing installations may take time to receive the updated manifest; after deploying, close and reopen the installed app. If it still uses the old display mode, reinstall from the updated HTTPS site. The existing touch and keyboard controls are unchanged. Install invitations are hidden in both fullscreen and standalone modes.

When an installed app launches in standalone/minimal-UI mode, Coastline requests fullscreen on the first tap or keypress. Browsers require a user gesture for this fallback, so startup fullscreen cannot be forced on every platform. This happens only once per launch, leaves ordinary browser tabs alone, and does not re-enter fullscreen after you exit it. Platforms without the Fullscreen API retain their supported app display mode. Run `node scripts/fullscreen-test.mjs` to check the fallback behavior.

The welcome and pause screens include an **Add to home screen** button. When Chrome offers a native install prompt, it changes to **Install Coastline** and opens that prompt on tap. Otherwise it shows browser-menu instructions; on iPhone/iPad it explains the Share flow. Automatic browser prompts are not guaranteed, and an already installed app hides these controls.

After the initial loading screen fades, an install invitation appears at the bottom right when the viewport is at least 1200 × 760 CSS pixels. Smaller screens use the inline install links on the welcome and pause screens so the invitation cannot cover controls. The invitation disappears after eight seconds, when the user clicks **×**, or when driving starts. Hovering or focusing its controls pauses the timer. Only explicit dismissal (×, Escape, or completing the native install prompt) is remembered for seven days; timing out or starting a drive only hides it for the current visit. The existing install buttons remain available. Old automatic-dismissal records are ignored. The invitation does not appear in standalone/fullscreen mode. A tap opens Chrome's native installation dialog when available; otherwise it shows manual installation instructions.

Run `node scripts/pwa-banner-test.mjs` to check the banner's loading, dismissal, driving, keyboard-focus, and install-button behavior independently of scene rendering.

The install menu link and banner are included in both `npm run dev` and production builds. Only production registers the offline worker. In a normal browser tab, the welcome and pause screens keep their install link even when the automatic banner has been dismissed. An installed fullscreen/standalone window hides all install controls. Chrome still decides whether a native install prompt is available; the link provides manual instructions otherwise.

The manifest includes real desktop (`wide`) and mobile (`narrow`) screenshots for Chrome's richer install UI. Refresh them with `node scripts/pwa-screenshots.mjs` after significant visual changes. These metadata warnings are separate from basic installation eligibility.

For phone testing, open the deployed **HTTPS** URL in Chrome directly. A local network URL such as `http://192.168.x.x:5173` is not a secure context and does not qualify for the normal PWA install flow. After deploying a new build, close all existing Coastline tabs and installed windows and reopen the site to allow a downloaded worker update to activate; a second close/reopen may be needed if the first visit downloads the update. Check Chrome's menu for **Install app** or **Add to home screen** if no automatic prompt appears.

After the first successful online load and service worker installation, the production build works offline, including all bundled journeys. Closing all app windows/tabs and reopening lets a downloaded update activate without interrupting a drive. Browser storage eviction or clearing site data requires another online visit. Journey progress retains its existing per-visit behavior.

The Vite plugin injects manifest links and registration without editing scene files or `index.html`. It generates a versioned precache from all build output, including future scene assets. Development mode does not register a worker; use a separate preview origin/port when testing production so an installed worker does not cache development pages. Serve `sw.js` with `Cache-Control: no-cache` if configuring host caching rules, and keep its URL stable. The plugin also supports a path base such as `vite build --base=/coastline/`.

Icons reuse the existing favicon road mark. Regenerate them with `node scripts/pwa-icons.mjs` (installed Chrome on Windows; otherwise Playwright Chromium, or set `CHROME_PATH`). Run `node scripts/pwa-test.mjs` to check Chrome installability, offline journey switching and driving, worker updates, subdirectory hosting, and disabled development registration. The test creates isolated builds and browser profiles under `.artifacts/`.

References: [MDN installation requirements](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable), [Apple home-screen instructions](https://support.apple.com/en-nz/guide/iphone/iphea86e5236/ios).
