# Audio

The priority is the original driving sounds: engine, road, wind, and environment. The comparison script isolates those layers and matches their RMS levels so added effects and increased volume do not substitute for better source material.

## Design

- Engine: generated combustion pulses, cylinder imbalance, turbulent breath and exhaust resonance. Three RPM bands each have coasting and loaded takes. Samples are level-matched and phase-aligned before blending. This replaces the original main oscillator.
- Cars: individual engine profiles. The default follows the selected route; garage cars retain their sound. Formula has six sound gears and a higher rev range. These gears do not affect physics.
- Tires and wind: separate stereo textures for contact grains and air pressure. Road contact, speed, steering, braking, and reverse control the result. Tire scrub approximates steering load because the driving model has no tire-slip simulation.
- Environment: low wind pressure, granular foam and rain, overlapping swells, and sparse wildlife. City thunder follows visible lightning with a delay. New calls are kept behind the driving sounds.
- Traffic: four reusable voices, distance attenuation, camera-relative stereo panning, and bounded Doppler shift. Disabled traffic is silent.
- Camera: first-person filters exterior high frequencies. Formula retains its open-cockpit sound.
- Music: optional suspended chords and sparse notes, with a route-dependent key. Disabled in the Balanced preset.

## Controls

Pause → Audio settings contains master, engine, tires/wind, environment, traffic, and music volumes. Balanced, Scenic, and Night drive are starting points; each channel remains adjustable. “Soften loud sounds” enables stronger compression. Settings persist locally; sound still requires explicit activation.

Sliders support keyboard arrows and Home/End. On a controller, left/right adjusts a focused slider and up/down moves between controls. The VR menu can cycle presets.

## Runtime

One lazy AudioContext. Continuous layers and event voices are bounded: 191 nodes and 49 sources with the current configuration. Car swaps replace the six engine sources and retain at most three generated engine banks. No audio files or network requests are required.

Parameter transitions use audio-clock smoothing. Mute, pause, and focus loss cancel pending effects, fade the master, and suspend the context. Trusted input retries an interrupted context. Disposal stops and disconnects all sources.

## Verification

`npm run test:audio` runs desktop/mobile checks and renders the real Web Audio graph. It checks all six environments, several engine families, independent channel silence, music, traffic, maximum volume, compression, and fade-out. Unit tests cover blending, sample seams, telemetry, invalid settings, Doppler, and scheduling.

`npm run review:audio` writes a local comparison page and WAV files under `.artifacts/audio/review/`. The engine, driving, surf, and rain comparisons use identical input and matched RMS volume. Added wildlife and traffic are excluded. `AUDIO_BASE_REF` selects the baseline Git revision. Render checks measure signal behavior; listening on speakers and headphones is still needed to judge the sound.

## References

- [BeamNG engine sound tuning](https://docs.beamng.com/modding/vehicle/sections/sounds/engine_audio/): separate engine/exhaust character, RPM/load blending, and tuning through transitions.
- [Wreckfest engine audio guide](https://www.audiokinetic.com/media/blog/LoopBasedCarEngineDesign/vehicle_audio_modding_guide_for_wreckfest-Wwise2019_2_9.pdf): load as a separate control from RPM.
- [Tsugi natural environments](https://tsugi-studio.com/blog/2022/04/05/natural-environments-12/): changing background textures with sparse wildlife and weather details.
- [MDN Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices): user activation, volume controls, and AudioParam scheduling.

These informed the approach. All sound generation code and musical patterns in this implementation are original; no recordings were imported.
