// Graphics quality levels, starting-level detection, and the adaptive controller
// that keeps the frame rate near the display's refresh rate.
//
// AO is a separate opt-in setting that neither presets nor Auto toggle. It shares
// the drawing buffer, so it shrinks with `density`; `aoQuality` bounds it on
// dense screens. No level changes shader light counts, which would force every
// program to recompile mid-drive.

// `density` is a fraction of the device pixel ratio rather than a cap, so it
// removes pixels on 1x displays too. `chunks` is how many detailed blocks stay
// built behind and ahead; the distant skyline covers the rest.
export const QUALITY_LEVELS = [
  { id: 'high', label: 'High', summary: 'Full detail · sharp shadows', density: 1, shadowMap: 2048, chunks: { behind: 3, ahead: 5 }, antialias: true, aoQuality: 'high' },
  { id: 'balanced', label: 'Balanced', summary: '85% resolution · medium shadows', density: .85, shadowMap: 1536, chunks: { behind: 2, ahead: 4 }, antialias: true, aoQuality: 'high' },
  { id: 'smooth', label: 'Smooth', summary: '70% resolution · softer shadows', density: .7, shadowMap: 1024, chunks: { behind: 2, ahead: 4 }, antialias: true, aoQuality: 'low' },
  { id: 'basic', label: 'Basic', summary: '50% resolution · simple shadows · nearby detail', density: .5, shadowMap: 512, chunks: { behind: 1, ahead: 3 }, antialias: false, aoQuality: 'low' },
];
const WORST = QUALITY_LEVELS.length - 1;
export const levelIndex = id => QUALITY_LEVELS.findIndex(level => level.id === id);

const MIN_DENSITY = .5;
export function renderScale(density, devicePixelRatio = globalThis.devicePixelRatio || 1) {
  return devicePixelRatio * Math.max(MIN_DENSITY, Math.min(1, density));
}

// Scaling native density alone still overloads 3x phones and 4K displays, so
// presets also cap pixel ratio and framebuffer area. A custom density bypasses this.
export const PIXEL_BUDGETS = {
  high: { ratio: 2, pixels: 3840000 }, balanced: { ratio: 1.5, pixels: 2073600 },
  smooth: { ratio: 1.25, pixels: 1280000 }, basic: { ratio: 1, pixels: 640000 },
};
export function drawingPixelRatio(settings, devicePixelRatio, width, height) {
  const native = renderScale(settings.density, devicePixelRatio);
  if (settings.customDensity) return native;
  const budget = PIXEL_BUDGETS[settings.id] ?? PIXEL_BUDGETS.high;
  return Math.min(native, budget.ratio, Math.sqrt(budget.pixels / Math.max(1, width * height)));
}

// Windows are long enough to average out a stutter; the settle time skips the
// moments after a change while buffers, shaders and streaming catch up.
const WINDOW_MS = 1500, SETTLE_MS = 2000, FIRST_SETTLE_MS = 4000;
// 0.92 tolerates 59.94 Hz displays and the odd dropped frame.
const SLOW = .92, FAST = .97;
const SLOW_WINDOWS = 2, FAST_WINDOWS = 4;
// A step down that gains under 4% means something else sets the pace (capped
// display, busy CPU, throttled browser). Give up after two such steps.
const WORTHWHILE = 1.04, GIVE_UP_AFTER = 2;

const STORAGE_KEY = 'citydriver.graphics';

function readStored(storage) {
  try { return JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null') ?? {}; }
  catch { return {}; }
}
function writeStored(storage, value) {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* private mode, quota, or no storage */ }
}
function defaultStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

// CPU rasterizers; always the lowest level.
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render/i;
// Apple silicon is deliberately absent (integrated but fast), as is Mesa, which
// also drives discrete cards on Linux.
const INTEGRATED_RENDERER = /intel|\buhd\b|\biris\b|hd graphics|vega \d|radeon\(tm\) graphics/i;

// Cores and memory cannot tell an integrated chip from a discrete card, so ask
// the GPU for its name.
export function probeRenderer(createCanvas = () => globalThis.document?.createElement('canvas')) {
  try {
    const canvas = createCanvas();
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    if (!gl) return '';
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const name = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    // Browsers allow only a handful of live contexts; release this one at once.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return typeof name === 'string' ? name : '';
  } catch { return ''; }
}

// Native pixel count. A 4K panel is four 1080p frames, often a bigger cost
// difference between desktops than their processors.
function displayPixels() {
  const screen = globalThis.screen;
  if (!screen?.width) return 0;
  const ratio = globalThis.devicePixelRatio || 1;
  return screen.width * screen.height * ratio * ratio;
}

// Deliberately cautious starting guess: the controller raises the level within
// a few seconds on a quick device, which beats stuttering through the first corner.
export function detectLevel(hints = {}) {
  const nav = hints.navigator ?? globalThis.navigator ?? {};
  // Catches tablets that report themselves as desktops; touchscreen laptops
  // still have a fine primary pointer and are tiered as laptops.
  const coarsePointer = hints.coarsePointer ?? Boolean(globalThis.matchMedia?.('(pointer: coarse)').matches);
  const mobile = hints.mobile ?? (nav.userAgentData?.mobile === true || coarsePointer);
  const cores = hints.cores ?? nav.hardwareConcurrency ?? 0;
  // Safari reports no deviceMemory, so 0 means unknown, not small.
  const memory = hints.memory ?? nav.deviceMemory ?? 0;
  if (mobile) {
    if (cores >= 6 && (memory === 0 || memory >= 4)) return 1;
    if (cores >= 4 && memory !== 0 && memory < 2) return WORST;
    if (cores >= 4) return 2;
    return WORST;
  }
  const gpu = hints.gpu ?? probeRenderer();
  if (SOFTWARE_RENDERER.test(gpu)) return WORST;
  // One level down per weak-hardware signal.
  let steps = 0;
  if (INTEGRATED_RENDERER.test(gpu)) steps++;
  if (cores !== 0 && cores <= 4) steps++;
  if (memory !== 0 && memory <= 4) steps++;
  if ((hints.pixels ?? displayPixels()) >= 4e6) steps++;
  return Math.min(steps, WORST);
}

export class Graphics {
  constructor({ storage = defaultStorage(), ambientOcclusion = null, detect = detectLevel } = {}) {
    const stored = readStored(storage);
    this.storage = storage;
    this.listeners = new Set();
    this.detected = detect();
    const storedLevel = levelIndex(stored.level);
    this.level = storedLevel === -1 ? this.detected : storedLevel;
    this.mode = QUALITY_LEVELS.some(level => level.id === stored.mode) ? stored.mode : 'auto';
    if (this.mode !== 'auto') this.level = levelIndex(this.mode);
    // AO defaults off; only a saved `true` opts in. `?ao=0` overrides the saved
    // choice for this visit.
    this.ambientOcclusion = ambientOcclusion ?? (stored.ambientOcclusion === true);
    this.densityOverride = Number.isFinite(stored.density) && stored.density >= MIN_DENSITY && stored.density <= 1 ? stored.density : null;
    // Best level Auto may climb back to; stops flicker between two levels.
    this.ceiling = 0;
    this.target = 60;
    this.cascade = null;
    this.suspend(FIRST_SETTLE_MS);
  }

  get auto() { return this.mode === 'auto'; }
  get levelId() { return QUALITY_LEVELS[this.level].id; }
  get settings() {
    return { ...QUALITY_LEVELS[this.level], density: this.densityOverride ?? QUALITY_LEVELS[this.level].density,
      customDensity: this.densityOverride !== null, ambientOcclusion: this.ambientOcclusion };
  }
  // Antialiasing is fixed at context creation, so it follows the starting level.
  get antialias() { return QUALITY_LEVELS[this.level].antialias; }

  onChange(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  // `reason` is 'auto' when the controller changed the level, so the UI can say so.
  announce(reason) { for (const listener of this.listeners) listener(this.settings, reason, this); }

  save() {
    writeStored(this.storage, { mode: this.mode, level: this.levelId, density: this.densityOverride, ambientOcclusion: this.ambientOcclusion });
  }

  setMode(mode) {
    const index = levelIndex(mode);
    if (mode !== 'auto' && index === -1) return false;
    this.mode = mode === 'auto' ? 'auto' : mode;
    // Clears adaptive history and the density override, but not AO.
    this.ceiling = 0; this.cascade = null; this.target = 60;
    this.densityOverride = null;
    if (index !== -1) this.level = index;
    this.suspend();
    this.save();
    this.announce('mode');
    return true;
  }

  setDensity(density) {
    if (!Number.isFinite(density)) return false;
    // Survives later Auto level changes.
    this.densityOverride = Math.max(MIN_DENSITY, Math.min(1, density));
    this.suspend();
    this.save();
    this.announce('density');
    return true;
  }

  toggleAmbientOcclusion() {
    const enabled = !this.ambientOcclusion;
    this.ambientOcclusion = enabled;
    this.suspend();
    this.save();
    this.announce('ambient-occlusion');
    return enabled;
  }

  // Undo a descent that proved not to help.
  restore({ level }) {
    const next = Math.max(0, Math.min(WORST, level));
    const changed = next !== this.level;
    this.level = next;
    this.ceiling = next;
    if (!changed) return false;
    this.suspend();
    this.save();
    this.announce('auto');
    return true;
  }

  // A new route is a different workload, so allow one level above the ceiling.
  // One step at a time keeps route hopping from walking the whole ladder. The
  // measured target is kept, since the display's limit has not changed.
  relax() {
    if (this.ceiling > 0) this.ceiling--;
    this.cascade = null;
    this.suspend();
  }

  suspend(settle = SETTLE_MS) {
    this.settle = settle; this.startedAt = null; this.windowStart = null;
    this.frames = 0; this.slow = 0; this.fast = 0;
  }

  // One sample per displayed frame. `active` is false while paused, hidden or
  // changing route, when frame times are meaningless.
  sample(timestamp, active) {
    if (!this.auto) return false;
    if (!active) { this.startedAt = null; this.windowStart = null; this.frames = 0; return false; }
    this.startedAt ??= timestamp;
    if (timestamp - this.startedAt < this.settle) return false;
    if (this.windowStart === null) { this.windowStart = timestamp; this.frames = 0; return false; }
    this.frames++;
    const elapsed = timestamp - this.windowStart;
    if (elapsed < WINDOW_MS) return false;
    const fps = this.frames * 1000 / elapsed;
    this.windowStart = timestamp; this.frames = 0;
    this.fps = fps;
    return this.judge(fps);
  }

  judge(fps) {
    if (fps < this.target * SLOW) {
      this.fast = 0;
      if (++this.slow < SLOW_WINDOWS) return false;
      this.slow = 0;
      if (this.cascade) {
        if (fps >= this.cascade.fps * WORTHWHILE) {
          // Judge the next step against this one, so a big early gain does not
          // excuse later steps that gain nothing.
          this.cascade = { level: this.level, fps, failures: 0 };
        } else if (++this.cascade.failures >= GIVE_UP_AFTER) {
          // Two useless steps: return to the last worthwhile level and target
          // the rate this device actually delivers.
          const cascade = this.cascade;
          this.cascade = null;
          this.target = Math.max(24, fps);
          return this.restore(cascade);
        }
      }
      if (this.level < WORST) {
        this.cascade ??= { level: this.level, fps, failures: 0 };
        return this.change(this.level + 1);
      }
      this.cascade = null;
      this.target = Math.max(24, fps);
      return false;
    }
    this.slow = 0;
    if (fps < this.target * FAST) { this.fast = 0; this.cascade = null; return false; }
    this.cascade = null;
    if (++this.fast < FAST_WINDOWS || this.level <= this.ceiling) return false;
    this.fast = 0;
    return this.change(this.level - 1);
  }

  change(level) {
    const next = Math.max(0, Math.min(WORST, level));
    if (next === this.level) return false;
    if (next > this.level) this.ceiling = next;
    this.level = next;
    this.suspend();
    this.save();
    this.announce('auto');
    return true;
  }
}
