// Controller support through the Gamepad API, standard mapping.
//
// Left stick or d-pad pans, right stick zooms, A picks or places, B goes back or closes, the
// shoulder buttons step the speed, Start opens the Menu. While a sheet, a card or the Views list
// is open the d-pad moves focus through it instead of panning, and A presses what has focus.
//
// It polls on animation frames only while a pad is connected: no pad, no loop. The small
// cursor the ui draws shows while the controller is in use and hides on mouse or touch input.

/** The standard mapping's button indexes. */
export const PAD_BUTTONS = {
  a: 0,
  b: 1,
  lb: 4,
  rb: 5,
  start: 9,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
} as const;

export type PadButton = keyof typeof PAD_BUTTONS;
export type PadDirection = 'up' | 'down' | 'left' | 'right';

/** Stick travel under this is rest, not input. */
export const STICK_DEADZONE = 0.2;
/** Screen pixels a second at full stick, or with the d-pad held. */
export const PAN_SPEED = 900;
/** Zoom doubles in this many seconds at full stick. */
export const ZOOM_DOUBLING_S = 0.7;

/** The little of a Gamepad this reads. */
export interface PadLike {
  connected?: boolean;
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value?: number }[];
}

/** One frame of a pad: the sticks after the dead zone, and what is held. */
export interface PadState {
  panX: number;
  panY: number;
  zoom: number;
  held: ReadonlySet<PadButton>;
}

/** A stick axis with the dead zone taken out and the rest rescaled to 0..1. */
export function deadzone(value: number | undefined): number {
  const v = typeof value === 'number' && Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
  const a = Math.abs(v);
  if (a < STICK_DEADZONE) return 0;
  return (Math.sign(v) * (a - STICK_DEADZONE)) / (1 - STICK_DEADZONE);
}

/** Read one pad on the standard mapping. */
export function readPad(pad: PadLike): PadState {
  const held = new Set<PadButton>();
  for (const [name, index] of Object.entries(PAD_BUTTONS) as [PadButton, number][]) {
    const button = pad.buttons[index];
    if (button && (button.pressed || (button.value ?? 0) > 0.5)) held.add(name);
  }
  return { panX: deadzone(pad.axes[0]), panY: deadzone(pad.axes[1]), zoom: deadzone(pad.axes[3]), held };
}

/** Buttons down now that were up last frame. */
export function newlyPressed(now: ReadonlySet<PadButton>, before: ReadonlySet<PadButton>): PadButton[] {
  return [...now].filter((b) => !before.has(b));
}

/** The pan for a frame of dt seconds, in screen pixels: the stick, else the d-pad. */
export function panStep(state: PadState, dt: number, dpadFree: boolean): { dx: number; dy: number } {
  let x = state.panX;
  let y = state.panY;
  if (dpadFree) {
    if (x === 0) x = (state.held.has('right') ? 1 : 0) - (state.held.has('left') ? 1 : 0);
    if (y === 0) y = (state.held.has('down') ? 1 : 0) - (state.held.has('up') ? 1 : 0);
  }
  return { dx: x * PAN_SPEED * dt, dy: y * PAN_SPEED * dt };
}

/** The zoom factor for a frame: stick up zooms in. 1 at rest. */
export function zoomStep(state: PadState, dt: number): number {
  if (state.zoom === 0) return 1;
  return Math.pow(2, (-state.zoom * dt) / ZOOM_DOUBLING_S);
}

export interface PadHandlers {
  pan(dx: number, dy: number): void;
  zoom(factor: number): void;
  a(): void;
  b(): void;
  speed(step: 1 | -1): void;
  start(): void;
  /** The d-pad on a menu: move focus and answer true, or false to let it pan. */
  dpad(direction: PadDirection): boolean;
  /** The controller took over (show the cursor) or gave way to a mouse or a finger. */
  active(on: boolean): void;
}

interface EventHost {
  addEventListener(type: string, fn: (event: Event) => void): void;
  removeEventListener(type: string, fn: (event: Event) => void): void;
}

export interface PadDeps {
  getGamepads(): readonly (PadLike | null)[];
  events: EventHost;
  raf(fn: (time: number) => void): number;
  caf(id: number): void;
}

export interface GamepadInput {
  /** True while the loop is polling (a pad is connected). */
  polling(): boolean;
  /** Run one frame now (tests). */
  frame(time: number): void;
  destroy(): void;
}

export function createGamepadInput(handlers: PadHandlers, deps: PadDeps): GamepadInput {
  let rafId = 0;
  let lastTime: number | null = null;
  let before: ReadonlySet<PadButton> = new Set();
  let active = false;
  /** d-pad directions that moved focus stay out of the pan until they are let go. */
  const spent = new Set<PadDirection>();
  let destroyed = false;

  function pads(): PadLike[] {
    try {
      return [...(deps.getGamepads() ?? [])].filter((p): p is PadLike => !!p && p.connected !== false);
    } catch {
      return [];
    }
  }

  function setActive(on: boolean): void {
    if (on === active) return;
    active = on;
    handlers.active(on);
  }

  function frame(time: number): void {
    rafId = 0;
    if (destroyed) return;
    const list = pads();
    if (list.length === 0) {
      lastTime = null;
      before = new Set();
      setActive(false);
      return; // nothing connected: the loop stops until the next connect
    }
    const dt = lastTime === null ? 1 / 60 : Math.min(0.1, Math.max(0, (time - lastTime) / 1000));
    lastTime = time;
    // Several pads play as one: the first that says anything this frame.
    const states = list.map(readPad);
    const state =
      states.find((s) => s.held.size > 0 || s.panX !== 0 || s.panY !== 0 || s.zoom !== 0) ?? (states[0] as PadState);
    const pressed = newlyPressed(state.held, before);
    before = state.held;
    if (pressed.length > 0 || state.panX !== 0 || state.panY !== 0 || state.zoom !== 0) setActive(true);

    for (const dir of ['up', 'down', 'left', 'right'] as const) if (!state.held.has(dir)) spent.delete(dir);
    for (const button of pressed) {
      if (button === 'a') handlers.a();
      else if (button === 'b') handlers.b();
      else if (button === 'lb') handlers.speed(-1);
      else if (button === 'rb') handlers.speed(1);
      else if (button === 'start') handlers.start();
      else if (handlers.dpad(button)) spent.add(button);
    }
    const dpadFree = spent.size === 0;
    const { dx, dy } = panStep(state, dt, dpadFree);
    if (dx !== 0 || dy !== 0) handlers.pan(dx, dy);
    const factor = zoomStep(state, dt);
    if (factor !== 1) handlers.zoom(factor);
    schedule();
  }

  function schedule(): void {
    if (rafId || destroyed) return;
    rafId = deps.raf(frame);
  }

  const onConnect = (): void => schedule();
  const onDisconnect = (): void => {
    if (pads().length === 0) {
      if (rafId) deps.caf(rafId);
      rafId = 0;
      lastTime = null;
      before = new Set();
      setActive(false);
    }
  };
  // A real mouse or finger hands control back: the cursor goes. The ui's own synthetic
  // pointer events (A on the tower) are not trusted, so they never count.
  const onPointer = (event: Event): void => {
    if (!active || event.isTrusted === false) return;
    const type = (event as PointerEvent).pointerType;
    if (type === 'mouse' || type === 'touch' || type === 'pen') setActive(false);
  };

  deps.events.addEventListener('gamepadconnected', onConnect);
  deps.events.addEventListener('gamepaddisconnected', onDisconnect);
  deps.events.addEventListener('pointerdown', onPointer);
  deps.events.addEventListener('pointermove', onPointer);
  if (pads().length > 0) schedule();

  return {
    polling: () => rafId !== 0,
    frame,
    destroy() {
      destroyed = true;
      if (rafId) deps.caf(rafId);
      rafId = 0;
      deps.events.removeEventListener('gamepadconnected', onConnect);
      deps.events.removeEventListener('gamepaddisconnected', onDisconnect);
      deps.events.removeEventListener('pointerdown', onPointer);
      deps.events.removeEventListener('pointermove', onPointer);
    },
  };
}

/** The page's own gamepads, or null where the browser has no Gamepad API. */
export function pageGamepadDeps(): PadDeps | null {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return null;
  const nav = navigator as { getGamepads?: () => (PadLike | null)[] };
  if (typeof nav.getGamepads !== 'function') return null;
  return {
    getGamepads: () => nav.getGamepads?.() ?? [],
    events: window,
    raf: (fn) => requestAnimationFrame(fn),
    caf: (id) => cancelAnimationFrame(id),
  };
}
