// Notifications, opt in (Settings, Notifications): three switches, each off by default. Alerts
// (fire, theft, a bomb: the log's 'alert' lines), Today's tower (the local date rolled over while
// the game was open, so a new one is ready), and New version (a new service worker installed
// over the one running this page).
//
// The game runs only while its tab is open, so these only ever fire while the game is open but
// hidden: a visible page already says it with its own toast. Nothing asks for permission on
// load; the browser is asked only when the player turns a switch on, from that click. Where the
// answer is no, or there is no Notification API (iPhone Safari outside a Home Screen install),
// the switch stays off and a short line under it says why. The native shells skip all of this
// (main.ts makes no notifier there).
//
// The decisions are plain functions (permissionOf, shouldNotify, dateRolled, isUpdateInstall and
// the alert gate) so a test can drive them without a browser.

import { localDateKey } from '../game/daily';
import { PREF_KEYS, getFlag, setFlag, type PrefKey } from './prefs';

export type NotifyKind = 'alerts' | 'daily' | 'update';

/** The switches, top to bottom. */
export const NOTIFY_KINDS: readonly NotifyKind[] = ['alerts', 'daily', 'update'];

export const NOTIFY_PREF: Record<NotifyKind, PrefKey> = {
  alerts: PREF_KEYS.notifyAlerts,
  daily: PREF_KEYS.notifyDaily,
  update: PREF_KEYS.notifyUpdate,
};

/** Each switch's words, and its tooltip. */
export const NOTIFY_LABEL: Record<NotifyKind, string> = {
  alerts: 'Alerts',
  daily: "Today's tower",
  update: 'New version',
};

export const NOTIFY_TIP: Record<NotifyKind, string> = {
  alerts: 'A fire, a theft or a bomb in your tower',
  daily: "A new Today's tower is ready",
  update: 'A new version of the game is ready',
};

/** The line under the Notifications title. */
export const NOTIFY_NOTE = 'These only come while the game is open in another tab or window.';

/** One system notification for alerts per this many real milliseconds; the rest are counted. */
export const ALERT_NOTIFY_GAP_MS = 60_000;
/** How often the date is looked at for Today's tower. */
export const DAILY_CHECK_MS = 60_000;

export const NOTIFY_TITLE = 'Hundred Stories';
export const UPDATE_TEXT = 'A new version is ready. Reload to get it.';
export const DAILY_TEXT = "A new Today's tower is ready.";

/** Why a switch stayed off, for the line under it. */
export const NOTIFY_NO_API = 'This browser cannot show notifications. On an iPhone, add the game to your Home Screen first.';
export const NOTIFY_BLOCKED = 'Notifications are blocked for this site. You can allow them in your browser settings.';
export const NOTIFY_NOT_ALLOWED = 'Notifications were not allowed, so this stays off.';

export type Permission = 'unsupported' | 'default' | 'granted' | 'denied';

/** The little of the Notification constructor this reads and calls. */
export interface NotificationApi {
  readonly permission: string;
  requestPermission(callback?: (result: string) => void): Promise<string> | void;
  new (title: string, options?: NotificationOptions): { onclick: unknown; close(): void };
}

/** The little of a service worker registration this uses. */
export interface NotifyRegistration {
  showNotification(title: string, options?: NotificationOptions): Promise<void>;
}

/** Everything the notifier touches in the page, so a test can hand in plain objects. */
export interface NotifyEnv {
  /** The Notification API, or undefined where there is none. */
  notification(): NotificationApi | undefined;
  hidden(): boolean;
  /** The service worker registration, when there is one: its notifications focus the game. */
  registration(): Promise<NotifyRegistration | null>;
  /** Bring the game's tab to the front. */
  focus(): void;
  /** Hear a tap on a notification the service worker showed (public/notify-sw.js). */
  onWorkerTap(listener: (kind: NotifyKind) => void): () => void;
  now(): number;
  /** The local date, YYYY-MM-DD. */
  today(): string;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

// ------------------------------------------------------------------ the decisions

/** What the browser says about notifications for this site. */
export function permissionOf(api: { permission?: unknown } | undefined): Permission {
  if (!api) return 'unsupported';
  const p = api.permission;
  return p === 'granted' || p === 'denied' ? p : 'default';
}

/** The line under a switch that stayed off, or null when nothing stands in the way. */
export function whyOff(permission: Permission): string | null {
  if (permission === 'unsupported') return NOTIFY_NO_API;
  if (permission === 'denied') return NOTIFY_BLOCKED;
  if (permission === 'default') return NOTIFY_NOT_ALLOWED;
  return null;
}

/** A system notification goes out only when the switch is on, the browser allows it, and the page is hidden. */
export function shouldNotify(on: boolean, permission: Permission, hidden: boolean): boolean {
  return on && permission === 'granted' && hidden;
}

/** The local date moved on (YYYY-MM-DD keys compare as text). A clock set back is not a new day. */
export function dateRolled(previous: string, next: string): boolean {
  return next > previous;
}

/**
 * A new service worker reached installed (or went on past it) while another one already runs
 * this page: that is an update. The very first install has no controller yet, or, once it has
 * claimed the page, is the controller itself; neither is an update.
 */
export function isUpdateInstall(state: string, controller: unknown, worker: unknown): boolean {
  if (state !== 'installed' && state !== 'activating' && state !== 'activated') return false;
  return controller != null && controller !== worker;
}

/** The words for alerts that came in while the last notification's minute ran. */
export function foldedAlertText(count: number): string {
  return count === 1 ? 'One more alert in your tower.' : `${count} more alerts in your tower.`;
}

export interface AlertGate {
  /** An alert now: its own words when the minute since the last one has run, else null (counted). */
  offer(text: string, now: number): string | null;
  /** The counted alerts as one line, once the minute has run; null when there are none or it has not. */
  flush(now: number): string | null;
  /** Milliseconds until flush can say something, or null when nothing is counted. */
  wait(now: number): number | null;
  /** Forget what was counted (the player is looking at the page now). */
  clear(): void;
}

/** At most one alert notification per gap; the ones in between fold into a count. */
export function createAlertGate(gap = ALERT_NOTIFY_GAP_MS): AlertGate {
  let lastAt = -Infinity;
  let folded = 0;
  return {
    offer(text, now) {
      if (now - lastAt >= gap) {
        lastAt = now;
        folded = 0;
        return text;
      }
      folded += 1;
      return null;
    },
    flush(now) {
      if (folded === 0 || now - lastAt < gap) return null;
      const text = foldedAlertText(folded);
      folded = 0;
      lastAt = now;
      return text;
    },
    wait(now) {
      return folded === 0 ? null : Math.max(0, lastAt + gap - now);
    },
    clear() {
      folded = 0;
    },
  };
}

// ------------------------------------------------------------------ the notifier

export interface Notifier {
  permission(): Permission;
  /** The switch reads on: the player turned it on and the browser still allows it. */
  isOn(kind: NotifyKind): boolean;
  /**
   * The player turned a switch on. Call straight from the click: the browser is asked here, and
   * only here. Resolves null when it is on, or the line to show under the switch when it stayed off.
   */
  turnOn(kind: NotifyKind): Promise<string | null>;
  turnOff(kind: NotifyKind): void;
  /** An alert line reached the log. */
  alert(text: string): void;
  /** A new version is ready. */
  updateReady(): void;
  /** What a tap on a notification does beyond bringing the game forward (an alert opens Stories). */
  onTap(handler: (kind: NotifyKind) => void): void;
  destroy(): void;
}

export function createNotifier(env: NotifyEnv): Notifier {
  const gate = createAlertGate();
  let flushTimer: unknown = null;
  let tapHandler: (kind: NotifyKind) => void = () => {};
  let lastDate = env.today();

  const permission = (): Permission => permissionOf(env.notification());
  const prefOn = (kind: NotifyKind): boolean => getFlag(NOTIFY_PREF[kind]) === true;
  const may = (kind: NotifyKind): boolean => shouldNotify(prefOn(kind), permission(), env.hidden());

  function tapped(kind: NotifyKind): void {
    env.focus();
    tapHandler(kind);
  }

  async function show(kind: NotifyKind, body: string): Promise<void> {
    const options: NotificationOptions = { body, tag: `hs-${kind}`, icon: '/icons/icon-192.png', data: { kind } };
    try {
      const registration = await env.registration();
      if (registration) {
        await registration.showNotification(NOTIFY_TITLE, options);
        return;
      }
    } catch {
      // No worker to show it: the page shows it itself below.
    }
    const Api = env.notification();
    if (!Api) return;
    try {
      const shown = new Api(NOTIFY_TITLE, options);
      shown.onclick = () => {
        shown.close();
        tapped(kind);
      };
    } catch {
      // Some browsers only show them from a worker: nothing more to try.
    }
  }

  function armFlush(): void {
    if (flushTimer !== null) return;
    const wait = gate.wait(env.now());
    if (wait === null) return;
    flushTimer = env.setTimeout(() => {
      flushTimer = null;
      if (!may('alerts')) {
        gate.clear();
        return;
      }
      const text = gate.flush(env.now());
      if (text !== null) void show('alerts', text);
      else armFlush();
    }, wait);
  }

  const stopWorkerTaps = env.onWorkerTap((kind) => tapHandler(kind));

  const dailyTimer = env.setInterval(() => {
    const today = env.today();
    if (!dateRolled(lastDate, today)) return;
    lastDate = today;
    if (may('daily')) void show('daily', DAILY_TEXT);
  }, DAILY_CHECK_MS);

  return {
    permission,
    isOn: (kind) => prefOn(kind) && permission() === 'granted',
    turnOn(kind) {
      const Api = env.notification();
      const now = permissionOf(Api);
      if (!Api || now === 'denied') return Promise.resolve(whyOff(now));
      const settle = (answer: string): string | null => {
        const result = permissionOf({ permission: answer });
        if (result !== 'granted') return whyOff(result);
        setFlag(NOTIFY_PREF[kind], true);
        return null;
      };
      if (now === 'granted') return Promise.resolve(settle('granted'));
      // Asked now, inside the click, never on load. Older Safari answers by callback only.
      return new Promise((resolve) => {
        let done = false;
        const finish = (answer: string): void => {
          if (done) return;
          done = true;
          resolve(settle(answer));
        };
        try {
          const asked = Api.requestPermission(finish);
          if (asked && typeof asked.then === 'function') asked.then(finish, () => finish('default'));
        } catch {
          finish('default');
        }
      });
    },
    turnOff(kind) {
      setFlag(NOTIFY_PREF[kind], false);
      if (kind === 'alerts') gate.clear();
    },
    alert(text) {
      if (!may('alerts')) {
        gate.clear();
        return;
      }
      const words = gate.offer(text, env.now());
      if (words !== null) void show('alerts', words);
      else armFlush();
    },
    updateReady() {
      if (may('update')) void show('update', UPDATE_TEXT);
    },
    onTap(handler) {
      tapHandler = handler;
    },
    destroy() {
      stopWorkerTaps();
      env.clearInterval(dailyTimer);
      if (flushTimer !== null) env.clearTimeout(flushTimer);
      flushTimer = null;
    },
  };
}

// ------------------------------------------------------------------ the page

/** The page's own env: the browser's Notification, document.hidden and the service worker. */
export function pageNotifyEnv(): NotifyEnv {
  const g = globalThis as {
    Notification?: NotificationApi;
    document?: { hidden?: boolean };
    navigator?: { serviceWorker?: ServiceWorkerContainer };
    focus?: () => void;
  };
  const sw = g.navigator?.serviceWorker;
  return {
    notification: () => g.Notification,
    hidden: () => g.document?.hidden === true,
    async registration() {
      if (!sw || typeof sw.getRegistration !== 'function') return null;
      return (await sw.getRegistration()) ?? null;
    },
    focus() {
      try {
        g.focus?.();
      } catch {
        // The browser brings the tab forward itself, or will not: either way nothing to do.
      }
    },
    onWorkerTap(listener) {
      if (!sw || typeof sw.addEventListener !== 'function') return () => {};
      const onMessage = (event: MessageEvent): void => {
        const data = event.data as { type?: unknown; kind?: unknown } | null;
        if (data?.type !== 'hs-notification') return;
        if (data.kind === 'alerts' || data.kind === 'daily' || data.kind === 'update') listener(data.kind);
      };
      sw.addEventListener('message', onMessage);
      return () => sw.removeEventListener('message', onMessage);
    },
    now: () => Date.now(),
    today: () => localDateKey(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
  };
}

// ------------------------------------------------------------------ updates

/** How often an open game asks the server for a new version. */
export const UPDATE_CHECK_MS = 60 * 60 * 1000;

interface WorkerLike {
  state: string;
  addEventListener(type: 'statechange', listener: () => void): void;
}

interface RegistrationLike {
  installing: WorkerLike | null;
  waiting: WorkerLike | null;
  /** Absent in older fakes; the browser always has it (null before the first activation). */
  active?: WorkerLike | null;
  addEventListener(type: 'updatefound', listener: () => void): void;
  update(): Promise<unknown>;
}

/** The little of navigator.serviceWorker the update watch reads. */
export interface WorkerContainerLike {
  readonly controller: unknown;
  getRegistration(): Promise<RegistrationLike | undefined>;
  addEventListener?(type: 'controllerchange', listener: () => void): void;
}

// The worker that controlled this page when this module first ran, early in boot, before the
// slow loads. A new version with skipWaiting and clientsClaim can take the page over before the
// update watch attaches, and by then sw.controller already is the new worker; this remembers the
// one the page started under. Undefined where there is no service worker API at all.
const PAGE_START_CONTROLLER: unknown = (() => {
  try {
    const nav = (globalThis as { navigator?: { serviceWorker?: { controller?: unknown } } }).navigator;
    return nav?.serviceWorker ? (nav.serviceWorker.controller ?? null) : undefined;
  } catch {
    return undefined;
  }
})();

/**
 * Tell onReady, once, when a new version has installed over the one running this page. The first
 * install is not an update. An open game asks for a new version every UPDATE_CHECK_MS, since a
 * tab left open never navigates and so would never look. Returns the way to stop.
 *
 * startedUnder is the worker that controlled the page when it loaded (null: none, a first
 * install). A new version that is already active, or already took the page over, when the watch
 * attaches is an update too, and so is a later change of controller on a page that had one.
 */
export function watchForUpdate(
  sw: WorkerContainerLike | undefined,
  onReady: () => void,
  timers: Pick<NotifyEnv, 'setInterval' | 'clearInterval'> = {
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
  },
  startedUnder: unknown = PAGE_START_CONTROLLER,
): () => void {
  if (!sw || typeof sw.getRegistration !== 'function') return () => {};
  // Not known (no capture): the controller now is the best there is.
  const started = startedUnder === undefined ? (sw.controller ?? null) : startedUnder;
  let told = false;
  let stopped = false;
  let checker: unknown = null;
  const tell = (): void => {
    if (told || stopped) return;
    told = true;
    onReady();
  };
  const follow = (worker: WorkerLike | null | undefined, controller: () => unknown = () => sw.controller): void => {
    if (!worker) return;
    const look = (): void => {
      if (isUpdateInstall(worker.state, controller(), worker)) tell();
    };
    worker.addEventListener('statechange', look);
    look();
  };
  if (started != null && typeof sw.addEventListener === 'function') {
    sw.addEventListener('controllerchange', () => {
      if (sw.controller != null && sw.controller !== started) tell();
    });
  }
  void sw
    .getRegistration()
    .then((registration) => {
      if (!registration || stopped) return;
      follow(registration.installing);
      follow(registration.waiting);
      // Measured against the page's first controller, so one that already claimed the page counts.
      follow(registration.active, () => started);
      registration.addEventListener('updatefound', () => follow(registration.installing));
      checker = timers.setInterval(() => {
        if (!told) void registration.update().catch(() => {});
      }, UPDATE_CHECK_MS);
    })
    .catch(() => {});
  return () => {
    stopped = true;
    if (checker !== null) timers.clearInterval(checker);
  };
}
