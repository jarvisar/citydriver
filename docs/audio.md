# Audio

Sound starts off. Press **M** or enable it in the pause menu. **Audio settings** controls master, engine, tires/wind, environment, traffic, and music volumes. Settings are saved locally under Citydriver's own storage keys.

Choose Balanced, Scenic, or Night drive as a starting point, then adjust individual channels. Music is off in Balanced. Soften loud sounds adds compression.

All audio is generated with Web Audio; there are no downloaded recordings. Engine sounds respond to the selected car, speed, and load. Tires and wind respond to driving inputs and road contact. City ambience accompanies the weather. Pause and focus loss fade and suspend audio.

The implementation is in [src/audio.js](../src/audio.js) and [src/audio/](../src/audio/). The traffic channel follows nearby vehicles with stereo panning and speed-dependent sound. Core audio unit checks run through `npm test`.
