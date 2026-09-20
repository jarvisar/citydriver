import test from 'node:test';
import assert from 'node:assert/strict';
import { Graphics, QUALITY_LEVELS, detectLevel, levelIndex, renderScale } from '../src/graphics.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), map };
}
const stored = storage => JSON.parse(storage.map.get('coastline.graphics'));

// A stand-in device with a running clock, like requestAnimationFrame has.
// `rates` is either a fixed refresh rate or the frame rate this device reaches
// at each quality level, so dropping a level actually buys frames — the signal
// the controller is reading. A fixed rate models a display or browser cap.
class Device {
  constructor(graphics, rates = 60) { this.graphics = graphics; this.rates = rates; this.time = 0; this.changes = 0; this.levels = []; this.steps = []; }
  get hz() { return typeof this.rates === 'number' ? this.rates : this.rates[levelIndex(this.graphics.levelId)]; }
  run(seconds, { hz, active = true } = {}) {
    for (let remaining = seconds * 1000; remaining > 0;) {
      const step = 1000 / (hz ?? this.hz);
      this.time += step; remaining -= step;
      if (this.graphics.sample(this.time, active)) {
        this.changes++; this.levels.push(this.graphics.levelId);
        this.steps.push(`${this.graphics.levelId}${this.graphics.settings.ambientOcclusion ? '+ao' : '-ao'}`);
      }
    }
    return this;
  }
}
const graphicsAt = (level, options = {}) => new Graphics({ storage: memoryStorage(), detect: () => level, ...options });

test('quality levels get cheaper in every dimension, from high down to basic', () => {
  assert.deepEqual(QUALITY_LEVELS.map(level => level.id), ['high', 'balanced', 'smooth', 'basic']);
  for (let i = 1; i < QUALITY_LEVELS.length; i++) {
    const previous = QUALITY_LEVELS[i - 1], level = QUALITY_LEVELS[i];
    assert.ok(level.density < previous.density, `${level.id} density`);
    assert.ok(level.shadowMap <= previous.shadowMap, `${level.id} shadow map`);
    assert.ok(level.chunks.behind <= previous.chunks.behind, `${level.id} chunks behind`);
    assert.ok(level.chunks.ahead <= previous.chunks.ahead, `${level.id} chunks ahead`);
    assert.ok(Number(level.ambientOcclusion) <= Number(previous.ambientOcclusion), `${level.id} soft shading`);
    assert.ok(Number(level.antialias) <= Number(previous.antialias), `${level.id} antialiasing`);
  }
  // The top level must draw everything, at the density the display asks for.
  assert.deepEqual({ ...QUALITY_LEVELS[0], id: undefined, label: undefined, summary: undefined },
    { id: undefined, label: undefined, summary: undefined, density: 1, shadowMap: 2048, chunks: { behind: 3, ahead: 5 }, ambientOcclusion: true, antialias: true });
});

test('every level removes pixels, on a 1x panel as much as on a dense one', () => {
  // A ceiling on the pixel ratio was the old rule, and it did nothing here:
  // clamping to 3, 2 and 1.5 all leave a 1x laptop panel rendering at 1x, so
  // three of the four levels were the same picture at the same price.
  for (const devicePixelRatio of [1, 1.25, 1.5, 2, 3]) {
    const scales = QUALITY_LEVELS.map(level => renderScale(level.density, devicePixelRatio));
    for (let i = 1; i < scales.length; i++) {
      assert.ok(scales[i] < scales[i - 1], `${devicePixelRatio}x: ${QUALITY_LEVELS[i].id} must draw fewer pixels than ${QUALITY_LEVELS[i - 1].id}`);
    }
    assert.equal(scales[0], devicePixelRatio, `${devicePixelRatio}x: full quality reaches native resolution`);
  }
  assert.equal(renderScale(1, 1), 1, 'full quality on a 1x panel is still 1x');
  assert.equal(renderScale(1, 3), 3, 'a 3x phone panel can render at native resolution');
  assert.equal(renderScale(2, 3), 3, 'density never exceeds native resolution');
  assert.equal(renderScale(.1, 2), 1, 'the minimum density is 50%');
});

test('detection tiers pointer devices on what they are, and touch devices cautiously', () => {
  // A tower with a discrete card and room to work starts at the top.
  assert.equal(detectLevel({ mobile: false, gpu: 'NVIDIA GeForce RTX 4070', cores: 16, memory: 8, pixels: 2e6 }), 0);
  assert.equal(detectLevel({ mobile: false, gpu: 'AMD Radeon RX 7800 XT', cores: 12, memory: 8, pixels: 2e6 }), 0);
  // A laptop's integrated chip does not, and neither does a thin machine.
  assert.equal(detectLevel({ mobile: false, gpu: 'Intel(R) UHD Graphics 620', cores: 8, memory: 8, pixels: 2e6 }), levelIndex('balanced'));
  assert.equal(detectLevel({ mobile: false, gpu: 'NVIDIA GeForce RTX 4070', cores: 16, memory: 8, pixels: 8.3e6 }), levelIndex('balanced'), 'a 4K panel is four 1080p frames');
  assert.equal(detectLevel({ mobile: false, gpu: 'Intel(R) HD Graphics 4000', cores: 2, memory: 4, pixels: 1e6 }), levelIndex('basic'));
  // Drawing on the processor needs the cheapest picture there is.
  assert.equal(detectLevel({ mobile: false, gpu: 'ANGLE (Google, SwiftShader Device)', cores: 16, memory: 8, pixels: 1e6 }), levelIndex('basic'));
  assert.equal(detectLevel({ mobile: false, gpu: 'llvmpipe (LLVM 15.0.7, 256 bits)', cores: 16, memory: 8, pixels: 1e6 }), levelIndex('basic'));
  // Mesa drives plenty of discrete cards, and Apple's shared memory is not slow.
  assert.equal(detectLevel({ mobile: false, gpu: 'AMD Radeon RX 6700 XT (radeonsi, navi22, LLVM 15.0.7, DRM 3.49), Mesa 23.0.4', cores: 16, memory: 8, pixels: 2e6 }), 0);
  assert.equal(detectLevel({ mobile: false, gpu: 'Apple M3 Pro', cores: 12, memory: 0, pixels: 2e6 }), 0);
  // Nothing to go on is not a reason to assume the worst.
  assert.equal(detectLevel({ mobile: false, gpu: '', cores: 0, memory: 0, pixels: 0 }), 0);
  assert.equal(detectLevel({ mobile: false, gpu: '', cores: 2, memory: 1, pixels: 0 }), levelIndex('smooth'));
  assert.equal(detectLevel({ mobile: true, cores: 8, memory: 8 }), levelIndex('balanced'));
  assert.equal(detectLevel({ mobile: true, cores: 6, memory: 0 }), levelIndex('balanced'), 'Safari reports no deviceMemory');
  assert.equal(detectLevel({ mobile: true, cores: 4, memory: 4 }), levelIndex('smooth'));
  assert.equal(detectLevel({ mobile: true, cores: 4, memory: 1 }), levelIndex('basic'));
  assert.equal(detectLevel({ mobile: true, cores: 2, memory: 0 }), levelIndex('basic'));
  assert.equal(detectLevel({ mobile: true, cores: 0, memory: 0 }), levelIndex('basic'));
  // A tablet that calls itself a desktop is still a touch device.
  assert.equal(detectLevel({ navigator: { userAgentData: { mobile: false } }, coarsePointer: true, cores: 4, memory: 4 }), levelIndex('smooth'));
  // A touchscreen laptop keeps its fine primary pointer, and is tiered as the
  // laptop it is rather than as a phone.
  assert.equal(detectLevel({ navigator: { userAgentData: { mobile: false } }, coarsePointer: false, gpu: 'Intel(R) Iris(R) Xe Graphics', cores: 4, memory: 4, pixels: 2e6 }), levelIndex('basic'));
});

test('a device that holds the refresh rate keeps its level, and a single hitch changes nothing', () => {
  const graphics = graphicsAt(levelIndex('high'));
  const display = new Device(graphics, 60).run(40);
  assert.equal(display.changes, 0);
  assert.equal(graphics.levelId, 'high');
  display.run(.3, { hz: 12 }).run(40);
  assert.equal(display.changes, 0, 'one slow moment is not a slow device');
  assert.equal(graphics.levelId, 'high');
});

test('a slow device steps down one level at a time and never climbs back', () => {
  const graphics = graphicsAt(levelIndex('high'));
  // An older phone: each step down really does buy frames, and only the
  // cheapest level reaches the display's rate. Soft shading is given up first,
  // before any of the picture's resolution is.
  const phone = new Device(graphics, [22, 31, 43, 61]).run(60);
  assert.deepEqual(phone.steps, ['high-ao', 'balanced-ao', 'smooth-ao', 'basic-ao']);
  assert.equal(graphics.levelId, 'basic');
  // Recovering later must not undo a decision the player has settled into.
  phone.rates = 60;
  phone.run(200);
  assert.equal(graphics.levelId, 'basic');
});

test('a cautious start climbs while the device keeps up, one level at a time', () => {
  const graphics = graphicsAt(levelIndex('basic'));
  const display = new Device(graphics, 60).run(60);
  assert.deepEqual(display.levels, ['smooth', 'balanced', 'high']);
  assert.equal(graphics.levelId, 'high');
  assert.equal(display.changes, 3, 'it stops at the top');
});

test('a climb that turns out to be too much settles one level below it, for good', () => {
  const graphics = graphicsAt(levelIndex('smooth'));
  // This device runs the cheaper levels comfortably but cannot hold the two
  // heaviest ones, so the upward probe has to be given back.
  const device = new Device(graphics, [25, 41, 61, 61]).run(200);
  assert.equal(graphics.levelId, 'smooth');
  assert.deepEqual(device.steps, ['balanced+ao', 'balanced-ao', 'smooth-ao'], 'one probe up, then soft shading, then the level back');
  device.run(400);
  assert.equal(graphics.levelId, 'smooth', 'no flicker between two levels');
  assert.equal(device.changes, 3);
});

test('a new route may reclaim one level, but not the whole ladder at once', () => {
  const graphics = graphicsAt(levelIndex('high'));
  const heavy = new Device(graphics, [22, 31, 43, 61]).run(60);
  assert.equal(graphics.levelId, 'basic');
  // A lighter route runs everything comfortably, but only one level comes back
  // per route change, so hopping between routes cannot flap the whole ladder.
  const light = new Device(graphics, 61);
  light.time = heavy.time;
  graphics.relax();
  light.run(200);
  assert.equal(graphics.levelId, 'smooth');
  graphics.relax();
  light.run(200);
  assert.equal(graphics.levelId, 'balanced');
  light.run(400);
  assert.equal(graphics.levelId, 'balanced', 'no further climb without another route change');
});

test('a capped display gets its quality back instead of being stripped for nothing', () => {
  // 30 Hz throughout: nothing the controller gives up can improve a rate the
  // display sets. It probes twice — once for soft shading, once for the level —
  // and hands both back rather than leaving the picture poorer for nothing.
  const graphics = graphicsAt(levelIndex('balanced'));
  const display = new Device(graphics, 30).run(90);
  assert.equal(graphics.levelId, 'balanced');
  assert.equal(graphics.settings.ambientOcclusion, true, 'soft shading comes back with the level');
  assert.deepEqual(display.steps, ['balanced-ao', 'smooth-ao', 'balanced+ao']);
  assert.ok(graphics.target <= 31 && graphics.target >= 29, `target follows the display: ${graphics.target}`);
  display.run(300);
  assert.equal(display.changes, 3, 'and it stops probing once it knows the rate');
});

test('a genuine improvement from stepping down is kept', () => {
  const graphics = graphicsAt(levelIndex('high'));
  // Soft shading goes first and buys nothing on this model device, but one
  // wasted probe is not a reason to stop: the level step that does work still
  // happens, and the controller then stops rather than stripping the rest of
  // the detail to chase the last two frames.
  const device = new Device(graphics, [30, 58, 60, 60]).run(200);
  assert.equal(graphics.levelId, 'balanced');
  assert.deepEqual(device.steps, ['high-ao', 'balanced-ao']);
});

test('paused, hidden and route-change frames are excluded and restart the grace period', () => {
  const graphics = graphicsAt(levelIndex('high'));
  const display = new Device(graphics, 20).run(30, { active: false });
  assert.equal(display.changes, 0);
  assert.equal(graphics.levelId, 'high');
  display.run(3, { hz: 20 });
  assert.equal(display.changes, 0, 'measuring restarts from the grace period');
});

test('a chosen level is pinned, adapts to nothing, and is remembered', () => {
  const storage = memoryStorage();
  const graphics = new Graphics({ storage, detect: () => levelIndex('smooth') });
  assert.equal(graphics.auto, true);
  graphics.setMode('high');
  assert.equal(graphics.auto, false);
  assert.equal(graphics.levelId, 'high');
  new Device(graphics, 8).run(120);
  assert.equal(graphics.levelId, 'high', 'a pinned level stays pinned');
  assert.deepEqual(stored(storage), { mode: 'high', level: 'high', density: null, ambientOcclusion: null, softShading: true });

  const next = new Graphics({ storage, detect: () => levelIndex('basic') });
  assert.equal(next.mode, 'high');
  assert.equal(next.levelId, 'high');
  next.setMode('auto');
  assert.equal(next.auto, true);
  assert.equal(next.levelId, 'high', 'returning to auto continues from where it is');
});

test('auto remembers the level it settled on so the next visit starts there', () => {
  const storage = memoryStorage();
  const graphics = new Graphics({ storage, detect: () => levelIndex('high') });
  new Device(graphics, [22, 31, 43, 61]).run(60);
  assert.equal(graphics.levelId, 'basic');
  // The player never touched soft shading, so their override stays empty; what
  // is remembered is the controller's own decision to stop drawing it.
  assert.deepEqual(stored(storage), { mode: 'auto', level: 'basic', density: null, ambientOcclusion: null, softShading: false });
  const next = new Graphics({ storage, detect: () => levelIndex('high') });
  assert.equal(next.auto, true);
  assert.equal(next.levelId, 'basic');
  assert.equal(next.settings.ambientOcclusion, false, 'and it is still off on the next visit');
});

test('soft shading can be turned on or off against the level, and is remembered', () => {
  const storage = memoryStorage();
  const graphics = new Graphics({ storage, detect: () => levelIndex('high') });
  assert.equal(graphics.settings.ambientOcclusion, true);
  assert.equal(graphics.toggleAmbientOcclusion(), false);
  assert.equal(graphics.settings.ambientOcclusion, false);
  assert.equal(stored(storage).ambientOcclusion, false);
  const next = new Graphics({ storage, detect: () => levelIndex('high') });
  assert.equal(next.settings.ambientOcclusion, false);
  // Back to the level's own answer, which is no longer an override.
  assert.equal(next.toggleAmbientOcclusion(), true);
  assert.equal(stored(storage).ambientOcclusion, null);
  // A level without soft shading can still have it switched on by hand.
  next.setMode('basic');
  assert.equal(next.settings.ambientOcclusion, false);
  assert.equal(next.toggleAmbientOcclusion(), true);
  assert.equal(next.settings.ambientOcclusion, true);
});

test('custom density is remembered, survives Auto adjustments, and resets with presets', () => {
  const storage = memoryStorage();
  const graphics = graphicsAt(0, { storage });
  graphics.setDensity(.83);
  assert.equal(graphics.settings.density, .83);
  assert.equal(graphics.mode, 'auto');
  new Device(graphics, [22, 31, 43, 61]).run(60);
  assert.equal(graphics.levelId, 'basic');
  assert.equal(graphics.settings.density, .83);
  const next = graphicsAt(0, { storage });
  assert.equal(next.settings.density, .83);
  next.toggleAmbientOcclusion();
  assert.equal(next.settings.density, .83, 'AO does not reset density');
  for (const level of QUALITY_LEVELS) {
    next.setDensity(.83);
    next.setMode(level.id);
    assert.equal(next.settings.density, level.density);
    assert.equal(stored(storage).density, null);
  }
  next.setDensity(1);
  next.setMode('auto');
  assert.equal(next.settings.density, .55, 'Auto restores the current level default');
});

test('density validates saved values and clamps user choices to the slider limits', () => {
  for (const density of [null, '0.8', -1, .49, 1.01]) {
    const storage = memoryStorage({ 'coastline.graphics': JSON.stringify({ density }) });
    assert.equal(graphicsAt(1, { storage }).settings.density, .85);
  }
  const graphics = graphicsAt(0);
  graphics.setDensity(5);
  assert.equal(graphics.settings.density, 1);
  graphics.setDensity(0);
  assert.equal(graphics.settings.density, .5);
  assert.equal(graphics.setDensity(NaN), false);
  assert.equal(graphics.setDensity(Infinity), false);
  assert.equal(graphics.settings.density, .5);
});

test('?ao=0 starts every level without soft shading, and can still be switched back', () => {
  const storage = memoryStorage({ 'coastline.graphics': JSON.stringify({ mode: 'auto', level: 'high', ambientOcclusion: true }) });
  const graphics = new Graphics({ storage, detect: () => 0, ambientOcclusion: false });
  assert.equal(graphics.settings.ambientOcclusion, false, 'the URL beats a remembered choice');
  assert.equal(graphics.toggleAmbientOcclusion(), true);
  assert.equal(graphics.settings.ambientOcclusion, true);
});

test('changes reach listeners, and unusable storage never breaks the game', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const graphics = new Graphics({ storage: broken, detect: () => levelIndex('smooth') });
  const seen = [];
  const stop = graphics.onChange(settings => seen.push(settings.density));
  graphics.setMode('high');
  assert.deepEqual(seen, [1]);
  stop();
  graphics.setMode('basic');
  assert.deepEqual(seen, [1], 'listeners can be removed');
  assert.equal(graphics.levelId, 'basic');
});

test('a stored level that no longer exists falls back to detection', () => {
  const storage = memoryStorage({ 'coastline.graphics': JSON.stringify({ mode: 'ludicrous', level: 'ludicrous' }) });
  const graphics = new Graphics({ storage, detect: () => levelIndex('smooth') });
  assert.equal(graphics.auto, true);
  assert.equal(graphics.levelId, 'smooth');
  assert.equal(graphics.setMode('ludicrous'), false);
  assert.equal(graphics.levelId, 'smooth');
});

test('a machine that only draw calls hold back is not stranded at full quality', () => {
  // The case this ladder exists for. A 1x panel limited by draw calls gets
  // nothing from a smaller drawing buffer, so every level costs it the same;
  // only soft shading, a second pass over every object in the scene, is worth
  // anything. Giving up a level first and reading "that bought nothing" as
  // "quality is not the problem" used to park this device at full quality,
  // soft shading and all, for the rest of the drive.
  const graphics = graphicsAt(levelIndex('high'));
  const laptop = new Device(graphics, 60);
  laptop.rates = [38, 38, 38, 38];
  const withoutSoftShading = [57, 57, 57, 57];
  const original = Object.getOwnPropertyDescriptor(Device.prototype, 'hz');
  Object.defineProperty(laptop, 'hz', { get() { return graphics.settings.ambientOcclusion ? 38 : withoutSoftShading[0]; } });
  laptop.run(120);
  assert.equal(graphics.settings.ambientOcclusion, false, 'soft shading is given up, and stays up');
  assert.equal(graphics.levelId, 'high', 'and nothing else had to be');
  assert.ok(original, 'Device still defines hz for the other tests');
});

test('soft shading survives the level being handed back', () => {
  // Soft shading buys this device real frames; the levels below it buy nothing.
  // The guard therefore hands the levels back — and must leave soft shading
  // off while it does, because that part of the descent was worth it.
  const graphics = graphicsAt(levelIndex('high'));
  const laptop = new Device(graphics, 60);
  Object.defineProperty(laptop, 'hz', { get: () => graphics.settings.ambientOcclusion ? 30 : 40 });
  laptop.run(120);
  assert.equal(graphics.levelId, 'high', 'the levels that bought nothing are given back');
  assert.equal(graphics.settings.ambientOcclusion, false, 'the one that bought something is not');
  assert.ok(graphics.target <= 41 && graphics.target >= 39, `target follows the device: ${graphics.target}`);
});

test('a route change offers soft shading back last, and not forever', () => {
  const graphics = graphicsAt(levelIndex('high'));
  const device = new Device(graphics, 60);
  Object.defineProperty(device, 'hz', { get: () => graphics.settings.ambientOcclusion ? 30 : 61 });
  device.run(60);
  assert.equal(graphics.settings.ambientOcclusion, false);
  // A lighter route may be able to afford it, so one is allowed to ask again.
  graphics.relax();
  assert.equal(graphics.settings.ambientOcclusion, true);
  device.run(60);
  assert.equal(graphics.settings.ambientOcclusion, false, 'this route still cannot');
  // But a player hopping between routes must not watch it flicker all evening.
  graphics.relax();
  assert.equal(graphics.settings.ambientOcclusion, false, 'twice is enough to settle it');
});

test('the controller never singles out a player\'s own soft shading', () => {
  const graphics = graphicsAt(levelIndex('high'));
  assert.equal(graphics.toggleAmbientOcclusion(), false);
  assert.equal(graphics.toggleAmbientOcclusion(), true, 'and it can be switched straight back on');
  // Back on is back to the level's own answer, so the level still decides it —
  // but the controller may no longer take it away on its own, which is what it
  // would otherwise do first and fastest.
  new Device(graphics, [20, 20, 61, 61]).run(90);
  assert.equal(graphics.levelId, 'smooth');
  assert.equal(graphics.settings.ambientOcclusion, false, 'a level without soft shading still has none');
  // Asking for it against the level's answer is absolute, at any frame rate.
  assert.equal(graphics.toggleAmbientOcclusion(), true);
  new Device(graphics, 8).run(120);
  assert.equal(graphics.settings.ambientOcclusion, true);
});
