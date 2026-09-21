import './style.css';
import './journey.css';
import './ui.css';
import './layout.css';
import './car.css';
import './menu.css';
import './audio/mixer.css';
import './pause.css';
import './city-ui.css';
import './taxi.css';
import { createRendering } from './rendering.js';
import { Graphics } from './graphics.js';
import { JOURNEYS } from './journeys.js';
import { CARS, CAR_IDS, DEFAULT_CAR, ROUTE_PAINT, carEntry, carMeters } from './cars.js';
import { carArt } from './car-art.js';
import { PAINTS, DEFAULT_PAINT, DEFAULT_PAINT_NAME, paintName, readPaint } from './car-paint.js';
import { SEED, journeyStart } from './world/route.js';
import { freshSceneStart } from './world/generation.js';
import { CityWeather } from './world/city-weather.js';
import { cityCell, cityDistrict, nearestCityStreet } from './world/city-grid.js';
import { CityGuide } from './city-guide.js';
import { TaxiRun } from './taxi-run.js';
import { TaxiView } from './taxi-view.js';
import { setResidentWindow } from './world/resident.js';
import { DrivingController } from './vehicle.js';
import { CityTraffic as Traffic } from './city-traffic.js';
import { TRAFFIC_CRUISE_SPEED } from './traffic.js';
import { collideScenery } from './collision.js';
import { CityAutodrive as Autodrive } from './city-autodrive.js';
import { Input } from './input.js';
import { touchDrivingInput, thirdPersonDrivingInput } from './touch-stick.js';
import { DriveAudio } from './audio.js';
import { setupAudioMixer } from './audio/mixer.js';
import { FrameClock } from './timing.js';
import { setupControlHelp, controlHelpDismissed } from './control-help.js';
import { BrowserVR } from './vr.js';
import { VRStatus } from './vr-status.js';
import { setupPwaFullscreen } from './pwa-fullscreen.js';

setupControlHelp();
setupPwaFullscreen();

const $ = selector => document.querySelector(selector);
const MENU_MOVES = ['menuNext', 'menuPrevious', 'menuUp', 'menuDown'];
const MENU_CRUISE_SPEED = TRAFFIC_CRUISE_SPEED * 1.4;
// A chooser's ring holds its cards and paint chips; the pause screen's holds
// resume, the garage and every driving, sound and graphics setting.
const MENU_CARDS = '[data-journey], [data-car], [data-paint]';
const PAUSE_CONTROLS = '#resume, #restart-run, #switch-mode, #change-car, #autodrive, #traffic, #city-weather, [data-place-type], #sound, #audio-mixer-toggle, #audio-mixer button, #audio-mixer input, #fullscreen, #graphics-toggle, [data-quality], #pixel-density, #soft-shading, #enter-vr-pause, .update-entry, .pwa-install-button';
const mileageFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
let paused = false, started = false, time = 0, hudTime = 0, gameMode = 'taxi';
document.body.dataset.mode = gameMode;
const frameClock = new FrameClock();
let toastTimer; let sceneReady = false;
// The chosen car and scene outlive the visit; positions and mileage do not.
const carStorageKey = 'citydriver-car';
const journeyStorageKey = 'citydriver-journey';
let carId = DEFAULT_CAR;
try { const saved = localStorage.getItem(carStorageKey); if (saved && CARS[saved]) carId = saved; } catch { /* Storage is optional. */ }
// One colour dresses the whole garage and follows the player from car to car.
// It lasts the visit and is not stored: the fleet's own finishes are the thing
// worth keeping, and Default hands them straight back.
let paint = null;
const toast = message => { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 2200); };

async function boot() {
  try {
    // `?ao=0` still forces the soft shading off, whatever the quality level is.
    const graphics = new Graphics({ ambientOcclusion: new URLSearchParams(window.location.search).get('ao') === '0' ? false : null });
    // How much of the route stays built is a quality setting too, so it has to
    // be in place before the first world is streamed.
    setResidentWindow(graphics.settings.chunks);
    graphics.onChange(settings => setResidentWindow(settings.chunks));
    const rendering = createRendering($('#scene'), graphics);
    const { renderer, scene } = rendering;
    let vr;
    const vrStatus = new VRStatus(rendering.vrCamera.camera);
    const hidden = () => vr?.active ? !vr.visible : document.hidden;
    const fpsCounter = $('#fps-counter');
    let fpsStart = null, fpsFrames = 0;
    function updateFPS(timestamp, rendered) {
      if (fpsCounter.hidden) return;
      if (paused || document.hidden || changingJourney) {
        fpsCounter.textContent = 'FPS: paused'; fpsStart = null; fpsFrames = 0; return;
      }
      if (fpsStart === null) { fpsStart = timestamp; fpsFrames = 0; return; }
      if (rendered) fpsFrames++;
      const elapsed = timestamp - fpsStart;
      if (elapsed >= 500) {
        fpsCounter.textContent = `${Math.round(fpsFrames * 1000 / elapsed)} FPS`;
        fpsStart = timestamp; fpsFrames = 0;
      }
    }
    let needsRender = true;
    window.addEventListener('resize', () => { needsRender = true; });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) needsRender = true; });
    let journey = 'city';
    try { const saved = localStorage.getItem(journeyStorageKey); if (saved && Object.hasOwn(JOURNEYS, saved)) journey = saved; } catch { /* Storage is optional. */ }
    let world = new JOURNEYS[journey].World(scene);
    const weather = new CityWeather(scene);
    try { weather.setMode(localStorage.getItem('citydriver-weather') ?? 'auto', { immediate: true }); } catch { /* Storage is optional. */ }
    let changingJourney = true, journeyWasPaused = false;
    const savedJourneys = Object.fromEntries(Object.entries(JOURNEYS).map(([id, data]) => [id, journeyStart(Number(data.routeNumber))]));
    const vehicle = new DrivingController(JOURNEYS[journey].route, savedJourneys[journey], DEFAULT_CAR); const audio = new DriveAudio();
    const refreshAudioMixer = setupAudioMixer(audio);
    // Free driving starts on for now, while off-road collision is being tried
    // out. The hidden code only changes the paint.
    vehicle.toggleFreeDriving();
    vehicle.setAppearance(journey);
    vehicle.setLights(weather.state.lightLevel);
    rendering.setJourney(journey); audio.setJourney(journey);
    const journeyDialog = $('#journey-dialog'), carDialog = $('#car-dialog'), pauseOverlay = $('#pause-overlay');
    const openChooser = () => [journeyDialog, carDialog].find(dialog => dialog.open) ?? null;
    // The pause screen is a menu too: it is up whenever the drive is paused
    // with no chooser over it, and the controller walks it the same way.
    const openPauseMenu = () => !$('#taxi-results').hidden ? $('#taxi-results') : paused && !pauseOverlay.hidden ? pauseOverlay : null;
    scene.add(vehicle.car);
    const traffic = new Traffic(scene, vehicle.route, vehicle.s, journey);
    const cityGuide = new CityGuide(toast, () => vehicle);
    let taxiStorage; try { taxiStorage = localStorage; } catch { /* Optional storage. */ }
    const taxi = new TaxiRun(taxiStorage), taxiView = new TaxiView(scene); cityGuide.taxi = taxi;
    const soundScene = { player: vehicle, traffic, interior: false, heading: 0 };
    const autodrive = new Autodrive();
    const touchControls = $('.touch-controls');
    let touchControlsTimer;
    function revealTouchControls() {
      clearTimeout(touchControlsTimer);
      touchControls.classList.remove('autodrive-hidden');
      touchControls.inert = false;
      if (autodrive.enabled) touchControlsTimer = setTimeout(() => {
        touchControls.classList.add('autodrive-hidden');
        touchControls.inert = true;
      }, 3000);
    }
    // Capture taps even when a menu or the joystick handles the event itself.
    window.addEventListener('pointerdown', () => {
      if (autodrive.enabled) revealTouchControls();
    }, { capture: true, passive: true });
    $('#autodrive').addEventListener('click', () => action('autodrive'));
    const trafficStorageKey = 'citydriver-traffic';
    try { traffic.setEnabled(localStorage.getItem(trafficStorageKey) !== 'false', vehicle); } catch { /* Storage is optional. */ }
    primeMenuDrive();
    $('#traffic').setAttribute('aria-pressed', String(traffic.enabled));
    $('#traffic').addEventListener('click', () => {
      traffic.setEnabled(!traffic.enabled, vehicle);
      traffic.render(1, world.origin);
      $('#traffic').setAttribute('aria-pressed', String(traffic.enabled));
      try { localStorage.setItem(trafficStorageKey, String(traffic.enabled)); } catch { /* Keep the setting for this visit. */ }
      needsRender = true;
    });
    function primeMenuDrive() {
      if (started) return;
      // Reveal the menu already cruising, at a speed that respects traffic.
      vehicle.speed = MENU_CRUISE_SPEED;
      const state = autodrive.update(vehicle, traffic, MENU_CRUISE_SPEED, 0);
      vehicle.speed = state.touchDrive.amount * vehicle.stats.topSpeed;
      vehicle.update(0, state);
    }
    let freeTraffic;
    function modeUi() {
      document.body.dataset.mode = gameMode;
      for (const id of ['change-car', 'autodrive', 'traffic']) $(`#${id}`).disabled = gameMode === 'taxi';
      $('#restart-run').hidden = gameMode !== 'taxi';
      $('#switch-mode span').textContent = gameMode === 'taxi' ? 'Free drive' : 'Taxi run';
      $('#reset').title = gameMode === 'taxi' ? 'Reset car: −5 seconds (R)' : 'Reset city (R)';
      $('#reset').setAttribute('aria-label', $('#reset').title);
      updateCarUi();
    }
    function recoverTaxi(penalty = false) {
      const street = nearestCityStreet(vehicle.s, vehicle.u);
      vehicle.s = street.s - (street.axis === 'east' ? 3 : 0);
      vehicle.u = street.u + (street.axis === 'north' ? 3 : 0);
      vehicle.heading = street.axis === 'north' ? 0 : Math.PI / 2;
      vehicle.speed = 0; vehicle.knock.x = vehicle.knock.z = vehicle.knock.spin = 0; vehicle.update(0, {});
      if (penalty) { taxi.timeLeft = Math.max(0, taxi.timeLeft - 5); toast('Reset −5s'); }
      taxi.hold = 0;
      world.update(vehicle.s, vehicle.u); vehicle.render(1, world.origin); rendering.snap(); needsRender = true;
    }
    function beginTaxi() {
      if (changingJourney) return;
      if (freeTraffic === undefined || gameMode === 'free') freeTraffic = traffic.enabled;
      started = true; gameMode = 'taxi'; autodrive.reset(); vehicle.arcade = true;
      vehicle.setCar('taxi'); recoverTaxi(); traffic.setEnabled(true, vehicle);
      $('#traffic').setAttribute('aria-pressed', 'true'); $('#autodrive').setAttribute('aria-pressed', 'false');
      taxi.start(vehicle); taxiView.reset(); $('#taxi-results').hidden = true; $('#welcome').classList.add('hidden');
      rendering.setView(4); updateViewUi(); setPaused(false); modeUi(); updateHud();
      taxiView.render(taxi, vehicle, world.origin, time); rendering.update(vehicle.car, 1, world.origin);
      toast('Stop in a ring to pick up');
    }
    function beginFree() {
      if (changingJourney) return;
      const wasTaxi = taxi.status !== 'idle'; taxi.stop(); started = true; gameMode = 'free';
      autodrive.reset(); vehicle.arcade = false; vehicle.setCar(carId, { paint }); vehicle.speed = 0; vehicle.update(0, {});
      if (wasTaxi && freeTraffic !== undefined) traffic.setEnabled(freeTraffic, vehicle);
      $('#traffic').setAttribute('aria-pressed', String(traffic.enabled)); $('#autodrive').setAttribute('aria-pressed', 'false');
      $('#taxi-results').hidden = true; $('#welcome').classList.add('hidden');
      taxiView.render(taxi, vehicle, world.origin, time); setPaused(false); modeUi(); updateHud();
    }
    function start() {
      if (paused || changingJourney) return;
      if (!started) {
        if (gameMode === 'taxi') beginTaxi(); else beginFree();
      }
    }
    function setPaused(value) {
      paused = value; input.clear(); frameClock.suspend();
      if (!paused && autodrive.enabled) start();
      if (paused) { clearTimeout(toastTimer); $('#toast').classList.remove('show'); }
      audio.setPaused(paused);
      pauseOverlay.hidden = !paused; $('#pause').setAttribute('aria-pressed', String(paused)); $('#pause').setAttribute('aria-label', paused ? 'Resume' : 'Pause');
      $('#pause .control-label').textContent = paused ? 'resume' : 'pause';
      if (paused) $('#resume').focus(); else $('#pause').blur();
    }
    function updateJourneyUi() {
      const data = JOURNEYS[journey];
      document.body.dataset.journey = journey;
      $('.location-title').textContent = data.label;
      $('.location svg text').textContent = data.routeNumber;
      $('#menu-route').textContent = 'TAXI';
      $('#scene').setAttribute('aria-label', data.canvas);
      document.querySelector('meta[name="theme-color"]').content = '#263b47';
      document.querySelectorAll('button[data-journey]').forEach(button => button.setAttribute('aria-current', String(button.dataset.journey === journey)));
    }
    function buildCarCards() {
      const current = '<span class="chooser-current">CURRENT CAR</span>';
      $('.car-options').innerHTML = CAR_IDS.map(id => {
        const entry = CARS[id];
        // The plain row stands for whichever car the road brings: no portrait
        // and no meters, so it sits above the fleet as a single line.
        if (entry.plain) return `<button type="button" class="chooser-card car-card car-card-plain" data-car="${id}" aria-current="false">`
          + `<span class="chooser-card-title">${entry.name}</span>${current}</button>`;
        const meters = carMeters(id).map(({ label, level }) =>
          `<span class="car-meter"><span>${label}</span><span class="car-meter-track"><span style="width:${level}%"></span></span></span>`).join('');
        // The portrait is drawn in whatever the garage is wearing, so the grid
        // doubles as the preview: one colour repaints the whole fleet at once.
        return `<button type="button" class="chooser-card car-card" data-car="${id}" aria-label="${entry.name}" aria-current="false" style="--car-paint:${cardPaint(id)}">`
          + carArt(id)
          + `<span class="chooser-card-copy"><span class="chooser-card-title">${entry.name}</span>`
          + `<span class="car-meters">${meters}</span>${current}</span></button>`;
      }).join('');
      for (const button of carDialog.querySelectorAll('[data-car]')) button.addEventListener('click', () => chooseCar(button.dataset.car));
    }
    const paintSwatches = $('#paint-swatches'), paintWell = $('#paint-custom-well'), paintInput = $('#paint-custom');
    function buildPaintSwatches() {
      paintSwatches.innerHTML = [`<button type="button" class="paint-swatch paint-default" role="radio" aria-checked="false" data-paint="${DEFAULT_PAINT}" aria-label="${DEFAULT_PAINT_NAME}" title="${DEFAULT_PAINT_NAME}"><span class="paint-chip" aria-hidden="true"></span></button>`,
        ...PAINTS.map(({ name, color }) => `<button type="button" class="paint-swatch" role="radio" aria-checked="false" data-paint="${color}" style="--swatch:${color}" aria-label="${name}" title="${name}"><span class="paint-chip" aria-hidden="true"></span></button>`)].join('');
      for (const swatch of paintSwatches.querySelectorAll('[data-paint]')) {
        swatch.addEventListener('click', () => applyPaint(swatch.dataset.paint));
        // A row of bare colours says nothing on its own, so the one under the
        // pointer or the keyboard focus names itself beside the heading.
        for (const event of ['pointerenter', 'focus']) swatch.addEventListener(event, () => { $('#paint-current').textContent = swatch.getAttribute('aria-label'); });
        for (const event of ['pointerleave', 'blur']) swatch.addEventListener(event, showPaintName);
      }
      paintInput.addEventListener('input', () => applyPaint(paintInput.value));
    }
    // With no garage colour set, every car shows the finish it arrived in. The
    // default car has none of its own, so it shows whatever the road it is on
    // would give it.
    const ownPaint = id => (carEntry(id).plain ? ROUTE_PAINT[journey] ?? ROUTE_PAINT.coast : carEntry(id).paint);
    const cardPaint = id => paint ?? ownPaint(id);
    const paintCards = () => { for (const card of carDialog.querySelectorAll('[data-car]')) card.style.setProperty('--car-paint', cardPaint(card.dataset.car)); };
    function showPaintName() {
      $('#paint-current').textContent = paint ? paintName(paint) ?? paint.toUpperCase() : DEFAULT_PAINT_NAME;
    }
    function updatePaintUi() {
      for (const swatch of paintSwatches.querySelectorAll('[data-paint]')) {
        const value = swatch.dataset.paint;
        swatch.setAttribute('aria-checked', String(value === DEFAULT_PAINT ? !paint : value === paint));
      }
      paintWell.dataset.active = String(Boolean(paint) && !PAINTS.some(swatch => swatch.color === paint));
      paintWell.style.setProperty('--swatch', paint ?? ownPaint(carId));
      paintInput.value = paint ?? ownPaint(carId);
      showPaintName();
    }
    // Repainting needs no new scenery either: the colour lands on the car where
    // it stands and on every card at once, and the drive carries on. Default
    // clears it, and the fleet goes back to its own finishes.
    function applyPaint(value) {
      const color = value === DEFAULT_PAINT ? null : readPaint(value);
      if (value !== DEFAULT_PAINT && !color) return;
      paint = color;
      if (started) vehicle.setPaint(paint);
      paintCards(); updatePaintUi();
      vehicle.render(1, world.origin); rendering.update(vehicle.car, 0, world.origin); needsRender = true;
    }
    function updateCarUi() {
      for (const button of carDialog.querySelectorAll('[data-car]')) button.setAttribute('aria-current', String(button.dataset.car === carId));
      $('#current-car').textContent = started && gameMode === 'taxi' ? 'Taxi' : carEntry(carId).name;
      $('#change-car').setAttribute('aria-label', started && gameMode === 'taxi' ? 'Garage: free drive only' : `Garage: ${carEntry(carId).name}`);
      updatePaintUi();
    }
    // Swapping cars needs no new scenery, so the drive simply carries on.
    function chooseCar(id) {
      carDialog.close();
      if (id === carId || !CARS[id]) return;
      carId = id;
      try { localStorage.setItem(carStorageKey, id); } catch { /* Still drive it for this visit. */ }
      if (started) { vehicle.setCar(id, { paint }); vehicle.render(1, world.origin); }
      autodrive.reset();
      rendering.update(vehicle.car, 0, world.origin);
      updateCarUi(); updateHud(); needsRender = true;
      toast(`${carEntry(id).name} selected`);
    }
    function openCars() {
      if (started && gameMode === 'taxi') { toast('Garage: free drive only'); return; }
      if (changingJourney || openChooser()) return;
      journeyWasPaused = paused; setPaused(true); pauseOverlay.hidden = true;
      carDialog.showModal();
      carDialog.querySelector(`[data-car="${carId}"]`).focus();
    }
    function openJourneys() {
      if (changingJourney || openChooser()) return;
      journeyWasPaused = paused; setPaused(true); pauseOverlay.hidden = true;
      journeyDialog.showModal();
      journeyDialog.querySelector(`[data-journey="${journey}"]`).focus();
    }
    async function changeJourney(id, { regenerate = false } = {}) {
      if (changingJourney || !JOURNEYS[id]) return;
      if (id === journey && !regenerate) { journeyDialog.close(); return; }
      if (!openChooser()) journeyWasPaused = paused;
      changingJourney = true; paused = true; input.clear(); frameClock.suspend();
      // Building and compiling the next route says nothing about how it runs,
      // and the new route may afford a level the last one could not.
      graphics.relax();
      audio.setPaused(true);
      $('#journey-transition').classList.add('active'); journeyDialog.close(); carDialog.close();
      pauseOverlay.hidden = true;
      savedJourneys[journey] = { s: vehicle.s, distance: vehicle.distance };
      const nextState = regenerate ? freshSceneStart(vehicle.s) : savedJourneys[id];
      let nextWorld;
      try {
        await new Promise(resolve => setTimeout(resolve, 320));
        nextWorld = new JOURNEYS[id].World(scene);
        nextWorld.update(nextState.s, 2.4);
        while (nextWorld.pending.length) nextWorld.update(nextState.s, 2.4);
        if (renderer.extensions.has('KHR_parallel_shader_compile')) await renderer.compileAsync(scene, rendering.camera);
        else renderer.compile(scene, rendering.camera);
        world.dispose(); world = nextWorld; journey = id;
        savedJourneys[id] = nextState;
        if (regenerate) { time = 0; hudTime = 0; vehicle.wheelSpin = 0; }
        vehicle.setRoute(JOURNEYS[id].route, nextState);
        autodrive.reset();
        vehicle.setAppearance(id);
        vehicle.setLights(weather.state.lightLevel);
        traffic.reset(vehicle.route, vehicle.s, id); traffic.render(1, world.origin);
        primeMenuDrive();
        rendering.setJourney(id); audio.setJourney(id); updateJourneyUi(); paintCards(); updatePaintUi();
        vehicle.render(1, world.origin);
        rendering.snap(); rendering.update(vehicle.car, 1, world.origin); world.animate(time, vehicle);
        weather.update(time, vehicle, world.origin); rendering.setWeather(weather.state, 0);
        world.setWetness(weather.state.wetness); vehicle.setLights(weather.state.lightLevel); traffic.models.setLights(weather.state.lightLevel);
        updateHud();
        if (renderer.xr.isPresenting) needsRender = true;
        else rendering.render();
        try { localStorage.setItem(journeyStorageKey, id); } catch { /* Still drive it for this visit. */ }
        toast(regenerate ? 'City reset' : `${JOURNEYS[id].title} selected`);
      } catch (error) {
        if (nextWorld && nextWorld !== world) nextWorld.dispose();
        console.error('Could not change journey:', error); toast('Loading failed');
      } finally {
        input.clear(); frameClock.reset(); changingJourney = false;
        setPaused(journeyWasPaused || hidden());
        $('#journey-transition').classList.remove('active');
      }
    }
    // Cards are laid out in a grid that changes with the viewport and holds one
    // full-width row, so up and down follow the rendered geometry rather than a
    // column count. A single row of cards steps along itself instead, and the
    // pause screen's stack of settings is walked by the same rules.
    function moveMenuFocus(menu, name) {
      // Everything in the menu's ring that is laid out is reachable.
      const cards = [...menu.querySelectorAll(menu.id === 'taxi-results' ? 'button' : menu === pauseOverlay ? PAUSE_CONTROLS : MENU_CARDS)].filter(card => card.offsetParent && !card.disabled);
      if (!cards.length) return;
      const index = cards.indexOf(document.activeElement);
      if (index < 0) { cards[0].focus(); return; }
      const current = cards[index];
      const step = name === 'menuNext' || name === 'menuDown' ? 1 : -1;
      if (current.matches('[data-audio-channel]') && (name === 'menuNext' || name === 'menuPrevious')) {
        current.value = Math.max(0, Math.min(100, Number(current.value) + step * 5));
        current.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      if (current.matches('input[type="range"]') && ['menuNext', 'menuPrevious'].includes(name)) {
        if (step > 0) current.stepUp(); else current.stepDown();
        current.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      if (name === 'menuUp' || name === 'menuDown') {
        const box = current.getBoundingClientRect();
        const x = box.left + box.width / 2, y = box.top + box.height / 2;
        let best = null, bestCost = Infinity;
        for (const card of cards) {
          if (card === current) continue;
          const other = card.getBoundingClientRect();
          const dy = other.top + other.height / 2 - y;
          if (Math.abs(dy) < 4 || Math.sign(dy) !== step) continue;
          // Nearest row first, then the card closest to the same column.
          const cost = Math.abs(dy) + Math.abs(other.left + other.width / 2 - x) * 2;
          if (cost < bestCost) { bestCost = cost; best = card; }
        }
        if (best) { best.focus(); return; }
      }
      cards[(index + step + cards.length) % cards.length].focus();
    }
    async function action(name, routeNumber) {
      if (name === 'exitVR') { if (vr?.active) await vr.toggle(); return; }
      if (name === 'recenterVR') { rendering.vrCamera.recenter(); return; }
      if (vr?.active && name.startsWith('vrMenu')) {
        if (name === 'vrMenuConfirm') vrStatus.activate();
        else vrStatus.move(name === 'vrMenuNext' ? 1 : -1);
        return;
      }
      if (name === 'fps') {
        fpsCounter.hidden = !fpsCounter.hidden;
        fpsCounter.textContent = 'FPS: …'; fpsStart = null; fpsFrames = 0;
        return;
      }
      if (name === 'fullscreen') { await toggleFullscreen(); return; }
      if (changingJourney) return;
      if (name === 'selectJourney') {
        const id = Object.keys(JOURNEYS).find(id => JOURNEYS[id].routeNumber === routeNumber);
        await changeJourney(id);
        return;
      }
      const chooser = openChooser();
      if (chooser) {
        if (name === 'menuClose' || (vr?.active && name === 'pause') || (name === 'car' && chooser === carDialog)) chooser.close();
        if (MENU_MOVES.includes(name)) moveMenuFocus(chooser, name);
        if (name === 'menuConfirm' && chooser.contains(document.activeElement)) document.activeElement.click();
        return;
      }
      // The pause screen is not modal, so it takes the menu actions and leaves
      // the drive's own shortcuts — the garage, the routes, the next scene — to
      // the handling below. B closes it the way it closes a chooser.
      const pauseMenu = openPauseMenu();
      if (pauseMenu && name.startsWith('menu')) {
        if (name === 'menuClose') { if (taxi.status !== 'over') setPaused(false); }
        else if (name !== 'menuConfirm') moveMenuFocus(pauseMenu, name);
        else if (pauseMenu.contains(document.activeElement)) document.activeElement.click();
        else $('#resume').focus();
        return;
      }
      if (name === 'nextJourney' || name === 'journey') return;
      if (taxi.status === 'over') { if (name === 'reset') beginTaxi(); return; }
      if (name === 'car') { openCars(); return; }
      if (name === 'autodrive') {
        if (started && gameMode === 'taxi') { toast('Autodrive: free drive only'); return; }
        if (!autodrive.enabled && !autodrive.canStart(vehicle)) { toast('Autodrive requires a street'); return; }
        const enabled = autodrive.toggle();
        revealTouchControls();
        // D-pad Up also begins the hidden code, so this shortcut must keep its progress.
        if (enabled) input.clear({ preserveKonami: true });
        $('#autodrive').setAttribute('aria-pressed', String(enabled));
        if (enabled) start();
        toast(`Autodrive ${enabled ? 'on' : 'off'}`);
        return;
      }
      if (name === 'drive') start();
      if (name === 'pause') setPaused(!paused);
      if (name === 'reset') { if (taxi.running) { recoverTaxi(true); return; } await changeJourney(journey, { regenerate: true }); return; }
      if (name === 'view') {
        toast(rendering.toggleView()); updateViewUi();
        rendering.update(vehicle.car, 0, world.origin);
        needsRender = true;
      }
      if (name === 'ambientOcclusion') {
        const enabled = rendering.toggleAO();
        needsRender = true; toast(`Soft shading ${enabled ? 'on' : 'off'}`);
        return;
      }
      if (name === 'sound') {
        try {
          const enabled = await audio.toggle(); $('#sound').setAttribute('aria-pressed', String(enabled));
          $('#sound').setAttribute('aria-label', enabled ? 'Turn sound off' : 'Turn sound on'); $('#sound').title = `${enabled ? 'Turn sound off' : 'Turn sound on'} (M)`;
          toast(enabled ? JOURNEYS[journey].sound : 'Sound off');
        } catch { toast('Sound unavailable'); }
      }
    }
    const input = new Input(action, connected => {
      toast(connected ? controlHelpDismissed() ? 'Controller connected' : 'Controller connected · RT / R2 to drive' : 'Controller disconnected');
      if (!connected && started && !paused) setPaused(true);
    }, () => {
      if (changingJourney) return;
      const enabled = vehicle.toggleRainbow();
      needsRender = true;
      toast(`Rainbow paint ${enabled ? 'on' : 'off'}`);
    });
    vr = new BrowserVR({
      renderer, buttons: [$('#enter-vr'), $('#enter-vr-pause')], canEnter: () => !changingJourney && !openChooser(),
      onStart() {
        $('#vr-error').hidden = true;
        input.xrActive = true; input.clear();
        rendering.enterVR(); rendering.update(vehicle.car, 0, world.origin); updateViewUi();
        rendering.vrCamera.recenter(); graphics.suspend();
        setPaused(false); start();
        audio.setHidden(!vr.visible); needsRender = true;
        document.body.dataset.vr = 'true';
      },
      onEnd() {
        input.xrActive = false; input.clear();
        vrStatus.update(null); graphics.suspend();
        rendering.exitVR(); rendering.update(vehicle.car, 0, world.origin); updateViewUi();
        audio.setHidden(document.hidden); setPaused(true); needsRender = true;
        document.body.dataset.vr = 'false';
      },
      onVisibility(visible) {
        input.clear(); frameClock.suspend(); audio.setHidden(!visible);
        if (!visible) { if (changingJourney) journeyWasPaused = true; setPaused(true); }
        needsRender = true;
      },
      onError(error) {
        const message = error.name === 'NotAllowedError' ? 'VR permission was declined. Select Enter VR to try again.' : 'Could not enter VR. Try again in your headset browser.';
        $('#vr-error').textContent = message; $('#vr-error').hidden = false;
      },
    });
    $('#change-journey').addEventListener('click', openJourneys);
    // The route button rides the title screen's stack and leads the toolbar
    // for the drive, however the menu comes and goes.
    function placeJourneyButton() {
      const button = $('#change-journey'), onMenu = !$('#welcome').classList.contains('hidden');
      for (const name of ['start-button', 'menu-secondary']) button.classList.toggle(name, onMenu);
      if (onMenu) $('#enter-vr').before(button); else $('.drive-actions').prepend(button);
    }
    new MutationObserver(placeJourneyButton).observe($('#welcome'), { attributeFilter: ['class'] });
    placeJourneyButton();
    $('#change-car').addEventListener('click', openCars);
    $('#close-cars').addEventListener('click', () => carDialog.close());
    $('#next-journey').addEventListener('click', event => {
      if (event.pointerType !== 'touch') action('nextJourney');
    });
    let fullscreenPending = false;
    const desktop = window.citydriverDesktop;
    let desktopFullscreen = false;
    const fullscreenDisplay = window.matchMedia('(display-mode: fullscreen)');
    function updateFullscreenUi() {
      const active = desktop ? desktopFullscreen : Boolean(document.fullscreenElement || document.webkitFullscreenElement || fullscreenDisplay.matches);
      $('#fullscreen').setAttribute('aria-pressed', String(active));
      $('#fullscreen').setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
      $('#fullscreen').title = `${active ? 'Exit' : 'Enter'} fullscreen (F / LB / L1)`;
    }
    async function toggleFullscreen() {
      if (fullscreenPending) return;
      fullscreenPending = true;
      try {
        if (desktop) {
          desktopFullscreen = await desktop.toggleFullscreen();
        } else if (document.fullscreenElement || document.webkitFullscreenElement) {
          await (document.exitFullscreen ?? document.webkitExitFullscreen).call(document);
        } else {
          const request = document.documentElement.requestFullscreen ?? document.documentElement.webkitRequestFullscreen;
          if (!request) { toast('Fullscreen unavailable'); return; }
          await request.call(document.documentElement);
        }
      } catch {
        toast('Press F for fullscreen');
      } finally { fullscreenPending = false; updateFullscreenUi(); }
    }
    document.addEventListener('fullscreenchange', updateFullscreenUi);
    document.addEventListener('webkitfullscreenchange', updateFullscreenUi);
    fullscreenDisplay.addEventListener('change', updateFullscreenUi);
    if (desktop) {
      desktop.onFullscreenChange(active => { desktopFullscreen = active; updateFullscreenUi(); });
      desktop.getFullscreen().then(active => { desktopFullscreen = active; updateFullscreenUi(); });
      desktop.onEscape(() => {
        const chooser = openChooser();
        if (chooser) chooser.close(); else action('pause');
      });
      // Desktop builds that cannot update themselves get a download button on both menus.
      let updateShown = false;
      const showUpdate = update => {
        if (!update || updateShown) return;
        updateShown = true;
        for (const [anchor, classes] of [['#enter-vr', 'start-button menu-secondary'], ['#enter-vr-pause', 'panel-button']]) {
          const button = document.createElement('button');
          button.type = 'button'; button.className = `${classes} update-entry`;
          button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 15v5h14v-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span></span>';
          button.lastChild.textContent = `Get version ${update.version}`;
          button.title = 'Opens the download page';
          button.addEventListener('click', () => window.open(update.url)); // the wrapper hands it to the system browser
          $(anchor).after(button);
        }
      };
      desktop.onUpdate(showUpdate);
      desktop.getUpdate().then(showUpdate);
    }
    updateFullscreenUi();
    $('#fullscreen').addEventListener('click', event => {
      if (event.pointerType !== 'touch') action('fullscreen');
    });
    $('#fullscreen').addEventListener('pointerup', event => {
      if (event.pointerType === 'touch') { event.preventDefault(); action('fullscreen'); }
    });
    $('#next-journey').addEventListener('pointerup', event => {
      if (event.pointerType === 'touch') { event.preventDefault(); action('nextJourney'); }
    });
    $('#close-journeys').addEventListener('click', () => journeyDialog.close());
    for (const dialog of [journeyDialog, carDialog]) {
      dialog.addEventListener('close', () => { if (!changingJourney) setPaused(journeyWasPaused || document.hidden); });
      dialog.addEventListener('click', event => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
      });
    }
    document.querySelectorAll('button[data-journey]').forEach(button => button.addEventListener('click', () => changeJourney(button.dataset.journey)));
    for (const name of ['pause', 'reset', 'view', 'sound']) $(`#${name}`).addEventListener('click', event => {
      if (['pause', 'view'].includes(name) && event.pointerType === 'touch') return;
      action(name);
    });
    // A secondary finger may not synthesize a click while the stick is held.
    for (const name of ['pause', 'view']) $(`#${name}`).addEventListener('pointerup', event => {
      if (event.pointerType === 'touch') { event.preventDefault(); action(name); }
    });
    $('#start').addEventListener('click', start);
    $('#free-drive').addEventListener('click', beginFree);
    $('#taxi-retry').addEventListener('click', beginTaxi);
    $('#taxi-free').addEventListener('click', beginFree);
    $('#restart-run').addEventListener('click', beginTaxi);
    $('#switch-mode').addEventListener('click', () => gameMode === 'taxi' ? beginFree() : beginTaxi());
    window.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      if (started || paused || changingJourney || document.querySelector('dialog[open]')) return;
      if (event.target.closest?.('button, a, input, select, textarea, [contenteditable]') && event.target !== $('#start')) return;
      event.preventDefault();
      if (!event.repeat) $('#start').click();
    });
    $('#resume').addEventListener('click', () => setPaused(false));
    document.addEventListener('visibilitychange', () => { if (vr.active || vr.pending) return; audio.setHidden(document.hidden); if (document.hidden) { if (openChooser() || changingJourney) journeyWasPaused = true; if (started) setPaused(true); input.clear(); } frameClock.suspend(); });
    window.addEventListener('blur', () => { if (vr.active || vr.pending) return; audio.setHidden(true); if (openChooser() || changingJourney) journeyWasPaused = true; if (started) setPaused(true); });
    window.addEventListener('focus', () => audio.setHidden(hidden()));
    window.addEventListener('pointerdown', () => audio.unlock(), { capture: true, passive: true });
    window.addEventListener('keydown', () => audio.unlock(), { capture: true });
    window.addEventListener('pagehide', event => { audio.setHidden(true); if (!event.persisted) { world.dispose(); weather.dispose(); traffic.dispose(); taxiView.dispose(); void audio.dispose().catch(() => {}); } });
    window.addEventListener('pageshow', () => { audio.setHidden(document.hidden); needsRender = true; });
    $('#scene').addEventListener('webglcontextlost', event => { event.preventDefault(); setPaused(true); toast('Graphics lost. Reload to restart.'); });
    $('#scene').addEventListener('webglcontextrestored', () => { needsRender = true; });
    const qualityButtons = [...document.querySelectorAll('[data-quality]')];
    const graphicsToggle = $('#graphics-toggle'), graphicsPanel = $('#graphics-settings');
    graphicsToggle.addEventListener('click', () => {
      graphicsPanel.hidden = !graphicsPanel.hidden;
      graphicsToggle.setAttribute('aria-expanded', String(!graphicsPanel.hidden));
    });
    const softShading = $('#soft-shading'), graphicsStatus = $('#graphics-status');
    const pixelDensity = $('#pixel-density'), pixelDensityValue = $('#pixel-density-value');
    function updateGraphicsUi(settings = graphics.settings) {
      for (const button of qualityButtons) button.setAttribute('aria-checked', String(button.dataset.quality === graphics.mode));
      softShading.setAttribute('aria-pressed', String(settings.ambientOcclusion));
      const densityPercent = Math.round(settings.density * 100);
      $('#graphics-summary').textContent = `${graphics.auto ? 'Auto' : settings.label} · ${densityPercent}%`;
      pixelDensity.value = String(densityPercent);
      pixelDensityValue.textContent = `${densityPercent}%${densityPercent === 100 ? ' · Native' : ''}`;
      pixelDensity.setAttribute('aria-valuetext', `${densityPercent}% of native resolution`);
      // The drawing buffer is the thing the quality level actually changes, so
      // show it: it explains a softer picture without any further digging.
      graphicsStatus.textContent = `${graphics.auto ? 'Auto · ' : ''}${settings.label} · ${renderer.domElement.width} × ${renderer.domElement.height} · soft shading ${settings.ambientOcclusion ? 'on' : 'off'}`;
    }
    graphics.onChange((settings, reason) => {
      // A frozen canvas keeps its old buffer until something asks for a frame.
      needsRender = true;
      updateGraphicsUi(settings);
      if (reason === 'auto') toast(`Graphics · ${settings.label}${settings.ambientOcclusion ? '' : ' · soft shading off'}`);
    });
    for (const button of qualityButtons) button.addEventListener('click', () => graphics.setMode(button.dataset.quality));
    softShading.addEventListener('click', () => action('ambientOcclusion'));
    pixelDensity.addEventListener('input', () => graphics.setDensity(Number(pixelDensity.value) / 100));
    const hud = { distance: $('#distance') };
    const weatherSelect = $('#city-weather');
    weatherSelect.value = weather.mode;
    weatherSelect.addEventListener('change', () => {
      weather.setMode(weatherSelect.value, { immediate: paused });
      weather.update(time, vehicle, world.origin); rendering.setWeather(weather.state, 0);
      world.setWetness(weather.state.wetness); vehicle.setLights(weather.state.lightLevel); traffic.models.setLights(weather.state.lightLevel);
      try { localStorage.setItem('citydriver-weather', weather.mode); } catch { /* Storage is optional. */ }
      updateHud(); needsRender = true;
    });
    function updateHud() {
      // Physics uses meters; convert only the displayed measurement. The drive
      // itself shows nothing, so this is read on the pause screen.
      const distance = mileageFormat.format(vehicle.distance / 1609.344);
      // Replacing unchanged text still invalidates layout, including while paused.
      if (hud.distance.textContent !== distance) hud.distance.textContent = distance;
      const degrees = ((vehicle.heading * 180 / Math.PI) % 360 + 360) % 360;
      $('#city-heading').textContent = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(degrees / 45) % 8];
      const cell = cityCell(vehicle.s, vehicle.u);
      $('#city-location').textContent = `${cityDistrict(vehicle.s, vehicle.u)} · ${cell.ix}, ${cell.iz}`;
      $('#weather-label').textContent = weather.state.label;
      cityGuide.update(started && !paused && !changingJourney);
      taxiView.hud(taxi, vehicle);
    }
    function updateViewUi() {
      $('#view').title = `${rendering.viewLabel} · Change camera (V)`;
      $('#view').setAttribute('aria-label', `${rendering.viewLabel}. Change camera`);
      const thirdPerson = rendering.camera.isPerspectiveCamera;
      $('.stick-help-copy').firstChild.textContent = thirdPerson ? '↑ Drive · ↔ Steer' : 'Drag to drive';
      $('.stick-help-line').textContent = thirdPerson ? '↓ Brake · Release to stop' : 'Release to stop';
      $('#touch-stick').setAttribute('aria-label', thirdPerson ? 'Virtual joystick: up to accelerate, left and right to steer, down to brake or reverse, release to stop' : 'Virtual joystick');
    }
    function vrMenuModel() {
      if (!vr.active) return null;
      if (changingJourney) return { id: 'loading', title: 'Loading road…', items: [] };
      const item = (label, name) => ({ label, activate: () => action(name) });
      const chooser = openChooser();
      if (chooser) {
        const cars = chooser === carDialog;
        const buttons = [...chooser.querySelectorAll(cars ? '[data-car], [data-paint]' : '[data-journey]')];
        return { id: chooser.id, title: cars ? 'Garage & paint' : 'Choose a route', items: [
          { label: 'Back', activate: () => chooser.close() },
          ...buttons.map(button => ({
            label: (button.hasAttribute('data-paint') ? 'Paint: ' : '') + (button.getAttribute('aria-label') ?? button.querySelector('.chooser-card-title')?.textContent ?? button.textContent).trim() + (button.getAttribute('aria-current') === 'true' || button.getAttribute('aria-checked') === 'true' ? ' ✓' : ''),
            activate: () => button.click(),
          })),
        ] };
      }
      if (taxi.status === 'over') return { id: 'taxi-results', title: `Time up · $${taxi.cash}`, items: [
        { label: 'Play again', activate: beginTaxi }, { label: 'Free drive', activate: beginFree }, item('Exit VR', 'exitVR'),
      ] };
      if (!paused) return { id: 'driving', title: taxi.running ? `${Math.ceil(taxi.timeLeft)}s · $${taxi.cash} · ${taxi.status === 'pickup' ? 'Pick up' : taxi.target.name}` : '', items: [item('Pause', 'pause')] };
      const modes = ['auto', 'high', 'balanced', 'smooth', 'basic'];
      return { id: 'pause', title: 'Paused', items: [
        { label: gameMode === 'taxi' ? 'Restart run' : 'Taxi run', activate: beginTaxi },
        ...(gameMode === 'taxi' ? [{ label: 'Free drive', activate: beginFree }] : []),
        item('Resume', 'pause'), item(`Camera: ${rendering.viewLabel}`, 'view'),
        item('Garage & paint', 'car'),
        item(`Autodrive: ${autodrive.enabled ? 'on' : 'off'}`, 'autodrive'),
        { label: `Traffic: ${traffic.enabled ? 'on' : 'off'}`, activate: () => $('#traffic').click() },
        item(`Sound: ${$('#sound').getAttribute('aria-pressed') === 'true' ? 'on' : 'off'}`, 'sound'),
        { label: `Sound mix: ${audio.preset}`, activate: () => { const presets = ['balanced', 'scenic', 'night']; audio.setPreset(presets[(presets.indexOf(audio.preset) + 1) % presets.length]); refreshAudioMixer(); } },
        { label: `Graphics: ${graphics.mode}`, activate: () => graphics.setMode(modes[(modes.indexOf(graphics.mode) + 1) % modes.length]) },
        item('Reset car', 'reset'), item('Recenter view', 'recenterVR'), item('Exit VR', 'exitVR'),
      ] };
    }
    const simulate = dt => {
      let state = started ? input.state : {};
      if (autodrive.enabled && (state.forward || state.brake || state.left || state.right || state.handbrake || state.touchStick)) action('autodrive');
      // Cruise behind the welcome menu without toggling the player's setting
      // or showing a notification. Starting hands control straight to input.
      if (!started || autodrive.enabled) state = autodrive.update(vehicle, traffic, started ? vehicle.stats.topSpeed : MENU_CRUISE_SPEED, dt);
      if (state.touchStick) {
        if (rendering.camera.isPerspectiveCamera) Object.assign(state, thirdPersonDrivingInput(state.touchStick));
        else state.touchDrive = touchDrivingInput(state.touchStick, rendering.camera, vehicle.route, vehicle.s, vehicle.u, world.origin);
      }
      if (paused || changingJourney) return;
      if (taxi.running) state = taxi.controls(dt, state);
      vehicle.update(dt, state);
      collideScenery(vehicle, world.chunks, dt);
      traffic.update(dt, vehicle);
      if (started && taxi.running) {
        taxi.update(dt, vehicle, traffic.enabled ? traffic.vehicles : []);
        for (const event of taxi.drainEvents()) {
          if (event.kind === 'over') {
            vehicle.speed = 0; vehicle.knock.x = vehicle.knock.z = vehicle.knock.spin = 0; vehicle.update(0, {});
            setPaused(true); pauseOverlay.hidden = true; taxiView.hud(taxi, vehicle); taxiView.results(taxi); $('#taxi-retry').focus();
          } else toast(event.text);
        }
      }
    };
    function frame(timestamp, xrFrame) {
      vrStatus.update(vrMenuModel());
      if (vr.active) input.xr.update(vr.session.inputSources, { blocked: !vr.visible || changingJourney, paused });
      else input.gamepad.update({ blocked: document.hidden || !document.hasFocus() || changingJourney, paused, menu: openChooser() ? 'chooser' : openPauseMenu() ? 'pause' : false });
      const running = !paused && !hidden();
      frameClock.tick(timestamp, running, simulate);
      const dt = frameClock.dt;
      if (running) {
        time += dt;
        world.update(vehicle.s, vehicle.u); vehicle.render(frameClock.alpha, world.origin);
        traffic.render(frameClock.alpha, world.origin);
        rendering.update(vehicle.car, dt, world.origin); world.animate(time, vehicle);
        taxiView.render(taxi, vehicle, world.origin, time);
        weather.update(time, vehicle, world.origin); rendering.setWeather(weather.state, dt);
        world.setWetness(weather.state.wetness); vehicle.setLights(weather.state.lightLevel); traffic.models.setLights(weather.state.lightLevel);
      }
      soundScene.interior = rendering.viewLabel === 'First-person view';
      soundScene.lightning = weather.flash; soundScene.rain = weather.state.rain; soundScene.wetness = weather.state.wetness;
      const cameraMatrix = (vr.active ? rendering.vrCamera.camera : rendering.camera).matrixWorld.elements;
      soundScene.heading = Math.atan2(cameraMatrix[2], cameraMatrix[0]);
      audio.update(vehicle.audioTelemetry, dt, false, soundScene);
      hudTime += dt; if (hudTime > .1) { updateHud(); hudTime = 0; }
      // The desktop quality sampler targets 60 Hz and resizes a canvas, whereas
      // the headset owns its framebuffer and refresh rate.
      rendering.recordFrame(timestamp, !vr.active && !paused && !document.hidden && document.hasFocus() && !changingJourney);
      // A paused desktop canvas only redraws when invalidated. In VR, keep
      // drawing every headset frame so head tracking continues while stopped.
      const rendered = vr.active ? Boolean(xrFrame) : !document.hidden && (!paused || needsRender);
      if (rendered) {
        vrStatus.update(vrMenuModel());
        rendering.render(xrFrame, () => {
          vrStatus.point(xrFrame, renderer.xr.getReferenceSpace(), rendering.vrCamera.rig, vr.visible && !changingJourney);
          vrStatus.update(vrMenuModel());
        }); needsRender = false;
        if (!sceneReady) { sceneReady = true; $('#loading').classList.add('loaded'); }
      }
      updateFPS(timestamp, rendered);
    }
    world.update(vehicle.s, vehicle.u);
    while (world.pending.length) world.update(vehicle.s, vehicle.u);
    weather.update(time, vehicle, world.origin); rendering.setWeather(weather.state, 0);
    world.setWetness(weather.state.wetness); vehicle.setLights(weather.state.lightLevel); traffic.models.setLights(weather.state.lightLevel);
    buildCarCards(); buildPaintSwatches(); updateCarUi();
    vehicle.render(1, world.origin); traffic.render(1, world.origin); rendering.update(vehicle.car, 1, world.origin); updateHud(); updateJourneyUi(); updateViewUi(); updateGraphicsUi();
    if (renderer.extensions.has('KHR_parallel_shader_compile')) await renderer.compileAsync(scene, rendering.camera);
    else renderer.compile(scene, rendering.camera);
    changingJourney = false;
    renderer.setAnimationLoop(frame);
    void vr.detect();
    // Development-only inspection surface for automated driving and streaming checks.
    if (import.meta.env.DEV) window.__citydriver = { seed: SEED, vehicle, traffic, weather, autodrive, audio, graphics, vr, cityGuide, taxi, taxiView, beginTaxi, beginFree, get gameMode() { return gameMode; }, get world() { return world; }, rendering, input, action, changeJourney, chooseCar, applyPaint, get carId() { return carId; }, get paint() { return paint; }, get journey() { return journey; }, get changingJourney() { return changingJourney; }, get paused() { return paused; }, get started() { return started; } };
  } catch (error) { console.error('Could not start Citydriver:', error); $('#loading').classList.add('loaded'); $('#error').hidden = false; }
}
boot();
