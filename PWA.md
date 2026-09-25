# Offline Install

Citydriver can be installed as a Progressive Web App (PWA) and played offline.

Open the pause menu and click **Install Citydriver**. If your browser doesn't support the install prompt, the button shows instructions instead. On iPhone or iPad, use Safari's **Share → Add to Home Screen**.

Let the game fully load while online before playing offline. Hosting requires HTTPS, but localhost also works.

## Testing Locally

```sh
npm run build
npm run preview
```

Open the preview URL and wait for the city to load before disconnecting. `npm run dev` doesn't register a service worker, so use the preview build for this.

To test with the same base path as GitHub Pages:

```sh
npm run build -- --base=/citydriver/
npm run preview
```

## Updates

Close all Citydriver tabs to apply a downloaded update. Old caches are removed automatically.

## Icons & Tests

```sh
npm run pwa:icons
npm run pwa:screenshots
npm run test:pwa
```

These generate the app icons, capture the desktop and mobile screenshots, and test installing, offline driving, and updates. Set `CHROME_PATH` if Chrome isn't in the default location.
