import * as THREE from 'three';
import { fitSunShadow, stabilizeShadowFiltering } from './shadows.js';
import { ThirdPersonCamera } from './third-person-camera.js';
import { AmbientOcclusion } from './ambient-occlusion.js';
import { Graphics, renderScale } from './graphics.js';

// How fast the overhead views close on the car, per second. Ground is what the
// player reads as responsiveness, so it settles in about an eighth of a second;
// height keeps the older, gentler rate so the view does not bob over terrain.
const FOLLOW_GROUND = 8, FOLLOW_HEIGHT = 3;

export function createRendering(canvas, graphics = new Graphics()) {
  stabilizeShadowFiltering();
  // Multisampling belongs to the context and cannot be changed later, so the
  // level this page starts on decides it.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: graphics.antialias, powerPreference: 'high-performance' });
  let canvasWidth, canvasHeight, pixelRatio;
  function resizeCanvas() {
    const width = window.innerWidth, height = window.innerHeight, ratio = renderScale(graphics.settings.density, window.devicePixelRatio);
    if (width === canvasWidth && height === canvasHeight && ratio === pixelRatio) return;
    // Update size and density together: setPixelRatio followed by setSize allocates twice.
    renderer.setDrawingBufferSize(width, height, ratio);
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    canvasWidth = width; canvasHeight = height; pixelRatio = ratio;
  }
  resizeCanvas();
  // Frame times only describe the scene while it is actually drawing it.
  const recordFrame = (timestamp, active) => graphics.sample(timestamp, active);
  document.addEventListener('visibilitychange', () => graphics.suspend());
  window.addEventListener('blur', () => graphics.suspend());
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .94;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#b8dfe0'); scene.fog = new THREE.Fog('#c2e2db', 460, 860);
  const sky = new THREE.HemisphereLight('#e4f2f5', '#617149', 1.45); scene.add(sky);
  const sun = new THREE.DirectionalLight('#fff1db', 2.5); sun.castShadow = true;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 650; sun.shadow.normalBias = .65; sun.shadow.bias = -.0003; sun.shadow.radius = 2;
  scene.add(sun); scene.add(sun.target);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1200);
  const thirdPerson = new ThirdPersonCamera();
  const ambientOcclusion = new AmbientOcclusion(renderer, scene, camera);
  // Resolution, sun-shadow detail and soft shading follow the quality level.
  // A new shadow map size only takes effect once the old texture is released.
  function applyQuality(settings) {
    ambientOcclusion.enabled = settings.ambientOcclusion;
    if (sun.shadow.mapSize.x !== settings.shadowMap) {
      sun.shadow.mapSize.set(settings.shadowMap, settings.shadowMap);
      sun.shadow.map?.dispose(); sun.shadow.map = null;
    }
    resizeCanvas();
  }
  applyQuality(graphics.settings);
  graphics.onChange(applyQuality);
  const follow = new THREE.Vector3(); const target = new THREE.Vector3();
  const cameraOffset = new THREE.Vector3(-220, 245, 260);
  const cameraRight = new THREE.Vector3(cameraOffset.z, 0, -cameraOffset.x).normalize();
  const framingOffset = new THREE.Vector3();
  const touchScreen = window.matchMedia('(any-pointer: coarse)');
  const sunOffset = new THREE.Vector3(-110, 240, 100);
  const views = [{ height: 235, label: 'Scenic view' }, { height: 165, label: 'Medium view' }, { height: 115, label: 'Close view' }, { height: 75, label: 'Extra close view' }, { height: 115, label: 'Third-person view', thirdPerson: true }];
  const activeCamera = () => views[view].thirdPerson ? thirdPerson.camera : camera;
  let initialized = false; let view = touchScreen.matches ? 2 : 1; let viewHeight = views[view].height; let previousOrigin = 0;
  let snowy = false;
  let journey = 'coast';
  const fogProfiles = {
    coast: { color: '#b9def3', near: 600, far: 1150, thirdNear: 170, thirdFar: 300 },
    desert: { color: '#dab49b', near: 460, far: 860, thirdNear: 210, thirdFar: 350 },
    snow: { color: '#243949', near: 340, far: 760, thirdNear: 190, thirdFar: 330 },
    jungle: { color: '#9ab89a', near: 320, far: 780, thirdNear: 110, thirdFar: 250 },
    plains: { color: '#e9b360', near: 500, far: 1000, thirdNear: 200, thirdFar: 360 },
    city: { color: '#aab4bc', near: 470, far: 900, thirdNear: 130, thirdFar: 330 },
  };
  function updateFog() {
    const profile = fogProfiles[journey];
    // Keep the miniature views' atmosphere; fade only distant third-person scenery.
    // Matching the sky exactly lets fully faded terrain disappear without a seam.
    if (views[view].thirdPerson) {
      scene.fog.color.copy(scene.background);
      scene.fog.near = profile.thirdNear; scene.fog.far = profile.thirdFar;
    } else {
      scene.fog.color.set(profile.color);
      scene.fog.near = profile.near; scene.fog.far = profile.far;
    }
  }
  const lookAhead = new THREE.Vector3(-24, 0, -46);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function resize() {
    const width = window.innerWidth, height = window.innerHeight;
    const aspect = width / height;
    const size = viewHeight * (aspect < 1 ? 1.12 : 1);
    camera.left = -size * aspect / 2; camera.right = size * aspect / 2; camera.top = size / 2; camera.bottom = -size / 2; camera.updateProjectionMatrix();
    thirdPerson.resize(aspect);
    if (initialized) fitSunShadow(activeCamera(), sun, journey === 'jungle' ? sun.target.position.y : 0, previousOrigin);
  }
  function update(car, dt, origin) {
    const originShift = origin - previousOrigin; follow.z += originShift; previousOrigin = origin;
    if (!initialized) { follow.copy(car.position); initialized = true; }
    // Follow the car across the ground quickly and up the hill slowly. The two
    // used to share one rate, and the slow one won: a steering input moved the
    // car at once but took a third of a second to move the world, which reads
    // as the car itself being late. Height is the one that has to stay gentle,
    // because most of it is terrain rather than driving, and tracking every
    // rise makes the whole miniature view bob. Reduced motion pins both, as
    // before, which leaves the car nearly still on screen.
    const groundRate = 1 - Math.exp(-dt * FOLLOW_GROUND);
    follow.x += (car.position.x - follow.x) * groundRate;
    follow.z += (car.position.z - follow.z) * groundRate;
    follow.y += (car.position.y - follow.y) * (1 - Math.exp(-dt * (reducedMotion ? FOLLOW_GROUND : FOLLOW_HEIGHT)));
    const nextHeight = THREE.MathUtils.damp(viewHeight, views[view].height, 4, dt);
    if (Math.abs(nextHeight - viewHeight) > .01) { viewHeight = nextHeight; resize(); }
    // Shorten the look-ahead in close view so the car stays onscreen in portrait layouts.
    const framing = Math.min(1, viewHeight / 165);
    target.copy(follow).addScaledVector(lookAhead, framing);
    if (snowy) { target.y -= 14 * framing; target.z += 18 * framing; }
    if (touchScreen.matches || window.innerWidth < window.innerHeight) {
      // Ease the desktop framing slightly toward center without changing vertical look-ahead.
      const lateralOffset = framingOffset.copy(target).sub(follow).dot(cameraRight);
      target.addScaledVector(cameraRight, -lateralOffset * .30);
    }
    // Fixed ocean-side azimuth and ~36° elevation preserve the reference's miniature view.
    camera.position.copy(target).add(cameraOffset); camera.lookAt(target);
    if (views[view].thirdPerson) { thirdPerson.update(car, dt); target.copy(car.position); }
    sun.position.copy(target).add(sunOffset); sun.target.position.copy(target);
    fitSunShadow(activeCamera(), sun, journey === 'jungle' ? sun.target.position.y : 0, origin);
  }
  // Zoom only changes the projection; resizing the canvas every zoom frame reallocates its buffers.
  window.addEventListener('resize', () => { graphics.suspend(); resizeCanvas(); resize(); }); resize();
  function setJourney(id) {
    journey = fogProfiles[id] ? id : 'coast';
    snowy = id === 'snow';
    if (id === 'snow') {
      scene.background.set('#111f2b'); updateFog();
      sky.color.set('#91afca'); sky.groundColor.set('#2b3b4c'); sky.intensity = .72;
      sun.color.set('#bbd1ea'); sun.intensity = 1.16; sunOffset.set(-170, 190, -80);
      renderer.toneMappingExposure = .91;
      return;
    }
    if (id === 'jungle') {
      // Light filtered through a canopy: a weak, green-tinted sun almost
      // overhead, so the emergent crowns shade the road, and a strong green bounce.
      scene.background.set('#a9c4a2'); updateFog();
      sky.color.set('#c4dcb0'); sky.groundColor.set('#2f4d28'); sky.intensity = 1.75;
      sun.color.set('#eef2c4'); sun.intensity = 1.35; sunOffset.set(-55, 245, 40);
      renderer.toneMappingExposure = .9;
      return;
    }
    if (id === 'plains') {
      // Golden hour over open country: the sun sits a little over twenty
      // degrees up, so every bale, post and tree lays a long shadow across the
      // fields. A sun that low puts much less light on flat ground than a high
      // one does, so it burns brighter than the noon journeys' to keep the
      // crops lit, and the sky fill stays cool: it is the distance between a
      // warm light and a cool shade that reads as gold, rather than everything
      // alike behind a yellow filter.
      scene.background.set('#eeb85e'); updateFog();
      sky.color.set('#d5dbd0'); sky.groundColor.set('#8b7444'); sky.intensity = 1.12;
      sun.color.set('#ffc368'); sun.intensity = 3.45; sunOffset.set(-188, 92, 127);
      renderer.toneMappingExposure = .98;
      return;
    }
    if (id === 'city') {
      // A daytime storm: a grey sky does most of the lighting, and a weak,
      // cool sun keeps the facets readable with only faint shadows.
      scene.background.set('#adb7bf'); updateFog();
      sky.color.set('#d8e0e6'); sky.groundColor.set('#5c6369'); sky.intensity = 2;
      sun.color.set('#e2e9ef'); sun.intensity = 1.3; sunOffset.set(-150, 210, 110);
      renderer.toneMappingExposure = .52;
      return;
    }
    const desert = id === 'desert';
    // Clear coastal daylight: blue sky fill and a near-neutral sun keep the
    // ocean cyan and separate warm rock faces from cool, deeper shadows.
    scene.background.set(desert ? '#dfb399' : '#b5dff5'); updateFog();
    sky.color.set(desert ? '#e5d8d0' : '#c4e5ff'); sky.groundColor.set(desert ? '#79635a' : '#365544');
    sky.intensity = desert ? 1.27 : 1.12;
    sun.color.set(desert ? '#ffe0bc' : '#fff4df'); sun.intensity = desert ? 2.45 : 2.85;
    sunOffset.set(...(desert ? [-170, 150, 120] : [-145, 230, 95]));
    renderer.toneMappingExposure = desert ? .92 : 1.02;
  }
  setJourney('coast');
  return { renderer, scene, graphics, ambientOcclusion, render() { ambientOcclusion.render(activeCamera()); }, toggleAO() { return graphics.toggleAmbientOcclusion(); }, get camera() { return activeCamera(); }, update, resize, recordFrame, setJourney, get viewLabel() { return views[view].label; }, toggleView() { view = (view + 1) % views.length; updateFog(); thirdPerson.snap(); return views[view].label; }, snap() { initialized = false; thirdPerson.snap(); } };
}
