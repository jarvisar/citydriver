# Audio

Sound starts off. Press **M** or enable it in the pause menu. **Audio settings** has master, engine, tires/wind, environment, traffic, and music volumes. Settings are saved locally.

Choose **Balanced**, **Scenic**, or **Night drive** as a starting point, then adjust individual channels. Music is off in Balanced; set its volume to zero to disable it in any mix. **Soften loud sounds** adds compression.

Use arrow keys or Home/End on sliders. On a controller, up/down moves between controls and left/right adjusts the selected slider. The VR menu can cycle presets.

## How it works

All audio is generated with Web Audio. There are no downloaded recordings.

- Engine sounds blend RPM and load samples for each car. The default car follows the route's sound. Formula's audio gears don't change its driving physics.
- Tires and wind respond to speed, road contact, steering, and braking.
- Each route has its own ambience. City thunder follows lightning.
- Nearby traffic uses stereo panning and Doppler shift. Turning traffic off silences it.
- First-person view filters exterior sound; Formula keeps its open-cockpit sound.

A single AudioContext is created when sound is enabled. Mute, pause, and focus loss fade the sound and suspend it. Car changes replace the engine sources; generated engine banks are cached with a limit of three.

The implementation is in [src/audio.js](../src/audio.js) and [src/audio/](../src/audio/).

## Tests

With the dev server running:

```sh
npm run test:audio
npm run review:audio
```

The test checks controls, all six routes, mixer settings, channel output, compression, and fades. Reports and WAV previews go to `.artifacts/audio/`.

The review script writes volume-matched comparisons to `.artifacts/audio/review/index.html`. It compares against `HEAD` by default; set `AUDIO_BASE_REF` to use another Git revision. Listen to the results on speakers or headphones.

Both scripts use Chrome at the standard Windows path. Set `TEST_URL` to change the dev server address.