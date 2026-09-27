// Watch mode (design pass 2026-09-25, BB-5): for the player who likes to watch the tower run.
// Turning it on steps the chrome aside at once, after WATCH_ENABLE_GRACE_MS so the Watch
// button's own tap does not bring it straight back (Matt, 2026-09-26: the toggle "doesn't seem
// to do much"). After that, WATCH_IDLE_MS with no pointer, key or pad input and nothing open
// (the phone's build sheet at its row does not count; it closes as the chrome goes), the shell takes
// WATCH_CLASS and ui.css fades the top bar (all but the clock), the dock, the goals card, the
// map and the hover card out over --watch-fade, and they take no clicks. Any input takes the
// class off at once, and that first input only brings the chrome back: the key, the tap (its
// press, release and click) or the pad press is not passed on to anything under it. Off by
// default: the round Watch button under Views (createWatchToggle below), remembered in prefs.ts.
// Reduced motion is ui.css's business.
//
// The chrome rule "controls never move or hide" still holds while it is off, which is today's
// behavior, and while anything is open (a panel, a card, a menu), since then the player is busy.

import { icon } from './icons';
import { PREF_KEYS, getFlag, onPrefChange, setFlag } from './prefs';

/** Real milliseconds without input before the chrome steps aside. */
export const WATCH_IDLE_MS = 5_000;
/**
 * Turned on, the chrome steps aside this long after: the rest of the Watch button's tap (a
 * mouse leaving it, a late touch event) lands inside it and is not taken as the player's input.
 */
export const WATCH_ENABLE_GRACE_MS = 600;
/** The fade out, matched to --watch-fade in ui.css. */
export const WATCH_FADE_MS = 400;
/** The class on the ui shell while the chrome is stepped aside. */
export const WATCH_CLASS = 'is-watching';
/** How long after a swallowed release its click may still arrive (a touch's click comes late). */
const CLICK_GRACE_MS = 500;

/** The window events that count as the player's hand on the game. The pad reports itself. */
const INPUT_EVENTS = ['pointerdown', 'pointermove', 'wheel', 'keydown'] as const;
/** The rest of a tap that only restored the chrome, swallowed with it. */
const GESTURE_EVENTS = ['pointerup', 'pointercancel', 'click'] as const;

/** Is Watch mode on? Off by default, and when the store will not answer. */
export function readWatchMode(): boolean {
  return getFlag(PREF_KEYS.watchMode) === true;
}

/** The Watch button's tooltip: what turning it on does. */
export const WATCH_TIP = 'Watch mode: the buttons step aside so you can watch the tower. Any touch or key brings them back, and after 5 seconds with no input they step aside again.';

export interface WatchToggle {
  /** The round Watch button, for under Views. aria-pressed says whether Watch mode is on. */
  button: HTMLButtonElement;
  destroy(): void;
}

/**
 * The Watch button on the game view. A tap writes the same pref the Settings switch used to,
 * so createWatchMode hears it as before; the button follows the pref however it changes.
 */
export function createWatchToggle(): WatchToggle {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hs-icon-btn hs-round hs-watch-btn';
  const label = document.createElement('span');
  label.className = 'hs-btn-label';
  label.textContent = 'Watch';
  button.append(icon('watch', 'hs-icon hs-btn-icon') as unknown as HTMLElement, label);
  button.setAttribute('aria-label', 'Watch');
  button.title = WATCH_TIP;
  const paint = (): void => {
    button.setAttribute('aria-pressed', readWatchMode() ? 'true' : 'false');
  };
  paint();
  button.addEventListener('click', () => setFlag(PREF_KEYS.watchMode, !readWatchMode()));
  const stop = onPrefChange((key) => {
    if (key === PREF_KEYS.watchMode) paint();
  });
  return { button, destroy: stop };
}

export interface WatchModeOptions {
  shell: { classList: { toggle(name: string, on?: boolean): boolean } };
  /** Something is open (a panel, a card, the Views list, the full build sheet): stay. */
  busy(): boolean;
  /** The chrome just stepped aside: put away what may go with it (the build sheet's row). */
  onWatch?(): void;
}

export interface WatchMode {
  /**
   * The player did something: bring the chrome back and start the idle clock over. True when
   * the chrome was hidden, in which case the input only restored it and goes no further.
   */
  input(): boolean;
  /** The ui changed on its own (a panel opened or closed by itself): follow it. */
  sync(): void;
  isWatching(): boolean;
  destroy(): void;
}

/** The little of an Event this reads, so a test can hand it a plain object. */
interface InputEvent {
  type: string;
  pointerId?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  preventDefault?(): void;
  stopPropagation?(): void;
  stopImmediatePropagation?(): void;
}

/** Nothing after this listener hears the event: not the ui's keys, not the tower, not a button. */
function swallow(event: InputEvent, keepDefault = false): void {
  event.stopImmediatePropagation?.();
  event.stopPropagation?.();
  if (!keepDefault) event.preventDefault?.();
}

export function createWatchMode(options: WatchModeOptions): WatchMode {
  let enabled = readWatchMode();
  let watching = false;
  let lastInput = Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Something was open at the last look: its closing starts the idle clock over. */
  let wasBusy = false;
  /** The pointer whose press only restored the chrome, until it lets go. */
  let swallowPointer: number | null = null;
  /** The click that press would make, until it comes or its grace runs out. */
  let swallowClick = false;
  let clickTimer: ReturnType<typeof setTimeout> | null = null;
  /** Just turned on: input before this moment is the Watch button's own tap, not the player's. */
  let graceUntil = 0;

  function setWatching(on: boolean): void {
    if (on === watching) return;
    watching = on;
    options.shell.classList.toggle(WATCH_CLASS, on);
  }

  /** One timer at most; input only moves lastInput, so a moving mouse sets no timers. */
  function arm(delay: number): void {
    if (timer !== null) return;
    timer = setTimeout(onTimer, Math.max(0, delay));
  }

  function disarm(): void {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  function onTimer(): void {
    timer = null;
    if (!enabled || watching) return;
    const idle = Date.now() - lastInput;
    if (idle < WATCH_IDLE_MS) {
      arm(WATCH_IDLE_MS - idle);
      return;
    }
    if (options.busy()) {
      // Never over something open: the 5 s start again from now.
      lastInput = Date.now();
      arm(WATCH_IDLE_MS);
      return;
    }
    graceUntil = 0;
    setWatching(true);
    options.onWatch?.();
  }

  function input(): boolean {
    // The rest of the tap that turned Watch on: it neither restores nor restarts the clock.
    if (!watching && Date.now() < graceUntil) return false;
    const restored = watching;
    lastInput = Date.now();
    setWatching(false);
    if (enabled) arm(WATCH_IDLE_MS);
    return restored;
  }

  function endClickGrace(): void {
    swallowClick = false;
    if (clickTimer !== null) clearTimeout(clickTimer);
    clickTimer = null;
  }

  const onInput = (raw: Event): void => {
    const event = raw as unknown as InputEvent;
    // A new press or key is the player's own: a click still owed to an old tap is not.
    if (event.type === 'pointerdown' || event.type === 'keydown') endClickGrace();
    if (!input()) return;
    if (event.type === 'keydown') {
      // A browser shortcut keeps its meaning for the browser; the game still does not hear it.
      swallow(event, event.metaKey === true || event.ctrlKey === true || event.altKey === true);
      return;
    }
    swallow(event);
    if (event.type === 'pointerdown') {
      swallowPointer = typeof event.pointerId === 'number' ? event.pointerId : null;
      swallowClick = true;
    }
  };

  const onGesture = (raw: Event): void => {
    const event = raw as unknown as InputEvent;
    if (event.type === 'click') {
      if (!swallowClick) return;
      endClickGrace();
      swallow(event);
      return;
    }
    if (swallowPointer === null || event.pointerId !== swallowPointer) return;
    swallowPointer = null;
    swallow(event);
    // The click follows the release, on a touch screen a moment later; after that, clicks are
    // the player's again (a key's click included).
    if (clickTimer !== null) clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      clickTimer = null;
      swallowClick = false;
    }, CLICK_GRACE_MS);
  };

  // Capture on the window: this hears every input first, before the ui, the tower or a button.
  // Not passive, so the first wheel turn can be kept from zooming as well.
  for (const type of INPUT_EVENTS) window.addEventListener(type, onInput, { capture: true, passive: false });
  for (const type of GESTURE_EVENTS) window.addEventListener(type, onGesture, { capture: true });

  const stopPrefs = onPrefChange((key) => {
    if (key !== PREF_KEYS.watchMode) return;
    const next = readWatchMode();
    if (next === enabled) return;
    enabled = next;
    disarm();
    if (enabled) {
      // Turned on: the chrome steps aside once the grace is out, as if already idle 5 s.
      const now = Date.now();
      graceUntil = now + WATCH_ENABLE_GRACE_MS;
      lastInput = now + WATCH_ENABLE_GRACE_MS - WATCH_IDLE_MS;
      arm(WATCH_ENABLE_GRACE_MS);
    } else {
      graceUntil = 0;
      setWatching(false);
    }
  });

  if (enabled) arm(WATCH_IDLE_MS);

  return {
    input,
    sync() {
      if (!enabled) return;
      if (options.busy()) {
        // Opened by itself: the chrome comes back and stays while it is open.
        wasBusy = true;
        graceUntil = 0;
        lastInput = Date.now();
        setWatching(false);
        return;
      }
      if (wasBusy) {
        // Closed by itself: the 5 s start from this moment.
        wasBusy = false;
        graceUntil = 0;
        lastInput = Date.now();
      }
      if (!watching) arm(WATCH_IDLE_MS - (Date.now() - lastInput));
    },
    isWatching: () => watching,
    destroy() {
      disarm();
      endClickGrace();
      stopPrefs();
      for (const type of INPUT_EVENTS) window.removeEventListener(type, onInput, { capture: true });
      for (const type of GESTURE_EVENTS) window.removeEventListener(type, onGesture, { capture: true });
    },
  };
}
