const deadzone = (value = 0, threshold = .18) => Math.abs(value) <= threshold ? 0 : Math.sign(value) * Math.min(1, (Math.abs(value) - threshold) / (1 - threshold));
const buttonValue = (pad, index) => {
  const button = pad.buttons[index];
  return button ? Math.min(1, Math.max(0, button.value ?? Number(button.pressed))) : 0;
};

// Use the browser's standard Xbox / PlayStation layout, with the same indices
// as a best-effort fallback for handhelds exposing an unmapped gamepad.
export class GamepadInput {
  constructor(onAction, onConnection, getGamepads = () => navigator.getGamepads?.() ?? []) {
    this.onAction = onAction; this.onConnection = onConnection; this.getGamepads = getGamepads;
    this.index = null; this.connected = false; this.state = {};
    this.previousButtons = []; this.requireNeutral = false;
  }
  clear() { this.state = {}; this.requireNeutral = true; }
  // `menu` is 'pause' for the pause screen, truthy for a modal chooser, and
  // false during a drive.
  update({ blocked = false, paused = false, menu = false } = {}) {
    let pads;
    try { pads = Array.from(this.getGamepads()).filter(pad => pad?.connected); }
    catch { pads = []; } // Unsupported or restricted Gamepad API: keep other inputs available.
    const pad = pads.find(pad => pad.index === this.index) ?? pads.find(pad => pad.mapping === 'standard') ?? pads[0];
    if ((pad?.index ?? null) !== this.index) {
      this.index = pad?.index ?? null; this.state = {}; this.previousButtons = [];
      // A replacement controller must start at rest; the first can start with Gas.
      this.requireNeutral = this.connected;
    }
    if (Boolean(pad) !== this.connected) {
      this.connected = Boolean(pad); this.onConnection(this.connected);
    }
    if (!pad) { this.state = {}; return; }
    const buttons = pad.buttons.map((_, index) => buttonValue(pad, index) > .5);
    // Treat stick directions as menu buttons so they fire once per tilt. The two
    // axes stay apart so a grid of cards can be crossed by row as well as along.
    buttons[17] = (pad.axes[0] ?? 0) < -.5;
    buttons[18] = (pad.axes[0] ?? 0) > .5;
    buttons[19] = (pad.axes[1] ?? 0) < -.5;
    buttons[20] = (pad.axes[1] ?? 0) > .5;
    const pressed = index => buttons[index] && !this.previousButtons[index];
    const steer = deadzone(pad.axes[0]);
    const state = {
      forward: Math.max(deadzone(buttonValue(pad, 7), .08), buttonValue(pad, 0)),
      brake: Math.max(deadzone(buttonValue(pad, 6), .08), buttonValue(pad, 1)),
      left: Math.max(-steer, buttonValue(pad, 14), 0),
      right: Math.max(steer, buttonValue(pad, 15), 0),
    };
    const active = Object.values(state).some(Boolean) || buttons.some(Boolean);
    if (blocked || this.requireNeutral) {
      this.state = {}; this.previousButtons = buttons;
      this.requireNeutral = blocked || active;
      return;
    }
    // Sample once per display frame, including while paused, so held shortcuts
    // fire once and Start can resume the game without a keyboard or touchscreen.
    this.state = paused ? {} : state;
    const pause = pressed(9), view = pressed(2), reset = pressed(3), nextJourney = pressed(5);
    const journey = pressed(8), fullscreen = pressed(4), fps = pressed(11), car = pressed(10);
    const back = pressed(1), confirm = pressed(0), autodrive = pressed(12);
    const previous = pressed(14) || pressed(17), next = pressed(15) || pressed(18);
    const up = pressed(12) || pressed(19), down = pressed(13) || pressed(20);
    this.previousButtons = buttons;
    if (fps) this.onAction('fps');
    if (fullscreen) { this.onAction('fullscreen'); return; }
    // A chooser takes the whole pad. The pause screen only borrows the
    // directions and A, so the shortcuts below still work from it.
    if (menu && menu !== 'pause') {
      this.state = {};
      if (journey || car || back) this.onAction('menuClose');
      else if (previous) this.onAction('menuPrevious');
      else if (next) this.onAction('menuNext');
      else if (up) this.onAction('menuUp');
      else if (down) this.onAction('menuDown');
      else if (confirm) this.onAction('menuConfirm');
      return;
    }
    if (journey) { this.onAction('journey'); return; }
    if (car) { this.onAction('car'); return; }
    if (pause) { this.onAction('pause'); return; }
    if (nextJourney) { this.onAction('nextJourney'); return; }
    if (paused) {
      // Paused, the D-pad and sticks move the pause screen's focus ring rather
      // than the car, so resume, the garage and the graphics settings are all
      // reachable without a keyboard or a touchscreen.
      if (menu !== 'pause') return;
      if (previous) this.onAction('menuPrevious');
      else if (next) this.onAction('menuNext');
      else if (up) this.onAction('menuUp');
      else if (down) this.onAction('menuDown');
      else if (confirm) this.onAction('menuConfirm');
      else if (back) this.onAction('menuClose');
      return;
    }
    if (state.forward || state.brake) this.onAction('drive');
    if (autodrive) this.onAction('autodrive');
    if (view) this.onAction('view');
    if (reset) this.onAction('reset');
  }
}
