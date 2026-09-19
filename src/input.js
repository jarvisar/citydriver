import { GamepadInput } from './gamepad.js';
import { TouchStick } from './touch-stick.js';
import { KonamiCode } from './konami-code.js';

export class Input {
  constructor(onAction, onControllerConnection = () => {}, onFreeDriving = () => {}) {
    this.keys = new Set(); this.onAction = onAction;
    this.konami = new KonamiCode();
    this.touchStick = new TouchStick(document.querySelector('#touch-stick'), () => onAction('drive'));
    this.codes = { forward: ['KeyW', 'ArrowUp'], brake: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], handbrake: ['Space'] };
    // The driving simulation reads this up to six times per displayed frame, so
    // it fills one reused record rather than building a fresh object each step.
    this.actions = Object.keys(this.codes);
    this.driving = Object.fromEntries([...this.actions.map(action => [action, false]), ['touchStick', null], ['touchDrive', null]]);
    this.gamepad = new GamepadInput(onAction, connected => {
      this.keys.clear(); this.touchStick.clear();
      document.body.dataset.controller = String(connected);
      onControllerConnection(connected);
    });
    window.addEventListener('keydown', e => {
      // This hidden toggle is reachable only through the keyboard sequence.
      if (this.konami.keydown(e)) {
        e.preventDefault(); this.clear(); onFreeDriving();
        return;
      }
      if (e.code === 'F3' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (!e.repeat) onAction('fps');
        return;
      }
      if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (!e.repeat) onAction('fullscreen');
        return;
      }
      const routeKey = /^(?:Digit|Numpad)([1-6])$/.exec(e.code);
      if (routeKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        if (!e.repeat) onAction('selectJourney', routeKey[1]);
        return;
      }
      if (['KeyC', 'KeyG'].includes(e.code) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (!e.repeat) onAction('car');
        return;
      }
      if (document.querySelector('dialog[open]')) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (!e.repeat) {
        if (['KeyW', 'ArrowUp', 'KeyS', 'ArrowDown'].includes(e.code)) onAction('drive');
        if (['KeyP', 'Escape'].includes(e.code)) onAction('pause');
        if (e.code === 'KeyR') onAction('reset');
        if (e.code === 'KeyV') onAction('view');
        if (e.code === 'KeyM') onAction('sound');
        if (e.code === 'KeyH' && !e.ctrlKey && !e.metaKey && !e.altKey) onAction('autodrive');
        if (e.code === 'KeyO' && !e.ctrlKey && !e.metaKey && !e.altKey) onAction('ambientOcclusion');
        if (e.code === 'KeyN' && !e.ctrlKey && !e.metaKey && !e.altKey) onAction('nextJourney');
      }
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.clear());
  }
  get state() {
    const state = this.driving;
    let held = false;
    for (const action of this.actions) {
      const value = this.codes[action].some(code => this.keys.has(code)) || this.gamepad.state[action] || false;
      state[action] = value;
      if (value) held = true;
    }
    state.touchStick = null; state.touchDrive = null;
    if (held || this.gamepad.connected) this.touchStick.clear();
    else if (this.touchStick.engaged) state.touchStick = this.touchStick.vector;
    return state;
  }
  clear() { this.keys.clear(); this.touchStick.clear(); this.gamepad.clear(); this.konami.reset(); }
}
