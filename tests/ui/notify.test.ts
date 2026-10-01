// Opt in notifications (src/ui/notify.ts) and the new version notice: the plain decisions, the
// notifier driven through a fake env, the Settings switches, and the update toast.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALERT_NOTIFY_GAP_MS,
  DAILY_CHECK_MS,
  DAILY_TEXT,
  NOTIFY_BLOCKED,
  NOTIFY_NO_API,
  NOTIFY_NOT_ALLOWED,
  UPDATE_TEXT,
  createAlertGate,
  createNotifier,
  dateRolled,
  isUpdateInstall,
  permissionOf,
  shouldNotify,
  watchForUpdate,
  whyOff,
  type NotificationApi,
  type NotifyEnv,
  type NotifyKind,
} from '../../src/ui/notify';
import { getFlag, PREF_KEYS } from '../../src/ui/prefs';
import { el, settingsBody, type PanelContext } from '../../src/ui/panels';
import { createUi } from '../../src/ui/ui';
import { FakeDom, type FakeElement } from './fake-dom';

/** Settings as the pause menu's Settings page holds them (settingsBody; the old sheet is gone). */
function settingsNode(game: unknown, ctx: PanelContext): FakeElement {
  const root = el('div');
  root.append(settingsBody(game as never, ctx, { openControls() {} }).node);
  return root as unknown as FakeElement;
}

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  dom = new FakeDom();
  uninstall = dom.install();
});
afterEach(() => {
  uninstall();
  vi.useRealTimers();
});

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const click = (node: FakeElement): void => (node.listeners.get('click') ?? []).forEach((f) => f({}));

describe('the decisions', () => {
  it('reads the permission: no API is unsupported, and anything unknown is default', () => {
    expect([permissionOf(undefined), permissionOf({ permission: 'granted' }), permissionOf({ permission: 'denied' }), permissionOf({ permission: 'default' }), permissionOf({})]).toEqual([
      'unsupported',
      'granted',
      'denied',
      'default',
      'default',
    ]);
    expect([whyOff('unsupported'), whyOff('denied'), whyOff('default'), whyOff('granted')]).toEqual([NOTIFY_NO_API, NOTIFY_BLOCKED, NOTIFY_NOT_ALLOWED, null]);
  });

  it('notifies only when on, allowed, and the page is hidden', () => {
    expect(shouldNotify(true, 'granted', true)).toBe(true);
    expect(shouldNotify(true, 'granted', false)).toBe(false); // visible: the toast is the notice
    expect(shouldNotify(false, 'granted', true)).toBe(false);
    expect(shouldNotify(true, 'denied', true)).toBe(false);
    expect(shouldNotify(true, 'unsupported', true)).toBe(false);
  });

  it('lets one alert through per minute and folds the rest into a count', () => {
    const gate = createAlertGate();
    expect(gate.offer('Fire on floor 3.', 0)).toBe('Fire on floor 3.');
    expect(gate.offer('A theft on floor 5.', 1000)).toBe(null);
    expect(gate.offer('Fire on floor 4.', 2000)).toBe(null);
    expect(gate.wait(2000)).toBe(ALERT_NOTIFY_GAP_MS - 2000);
    expect(gate.flush(ALERT_NOTIFY_GAP_MS - 1)).toBe(null);
    expect(gate.flush(ALERT_NOTIFY_GAP_MS)).toBe('2 more alerts in your tower.');
    expect(gate.wait(ALERT_NOTIFY_GAP_MS)).toBe(null);
    expect(gate.offer('A bomb.', ALERT_NOTIFY_GAP_MS + 10)).toBe(null); // the flush started a new minute
    expect(gate.flush(2 * ALERT_NOTIFY_GAP_MS)).toBe('One more alert in your tower.');
  });

  it('sees a new local date, and not a clock set back', () => {
    expect(dateRolled('2026-09-26', '2026-09-27')).toBe(true);
    expect(dateRolled('2026-12-31', '2027-01-01')).toBe(true);
    expect(dateRolled('2026-09-26', '2026-09-26')).toBe(false);
    expect(dateRolled('2026-09-27', '2026-09-26')).toBe(false);
  });

  it('calls an install over a running worker an update, and the first install not', () => {
    const old = {};
    const fresh = {};
    expect(isUpdateInstall('installed', old, fresh)).toBe(true);
    expect(isUpdateInstall('activated', old, fresh)).toBe(true);
    expect(isUpdateInstall('installed', null, fresh)).toBe(false); // first install: no controller yet
    expect(isUpdateInstall('activated', fresh, fresh)).toBe(false); // first install, claimed the page
    expect(isUpdateInstall('installing', old, fresh)).toBe(false);
    expect(isUpdateInstall('redundant', old, fresh)).toBe(false);
  });
});

// ------------------------------------------------------------------ a fake browser

interface Fake {
  env: NotifyEnv;
  shown: { title: string; body: string | undefined; kind: unknown }[];
  asked: number;
  view: { hidden: boolean; today: string; answer: string; permission: string; api: boolean; worker: boolean };
  taps: ((kind: NotifyKind) => void)[];
  constructed: { onclick: unknown; close(): void }[];
  focused: number;
}

function fakeEnv(): Fake {
  const view = { hidden: true, today: '2026-09-26', answer: 'granted', permission: 'default', api: true, worker: true };
  const fake: Fake = { env: null as never, shown: [], asked: 0, view, taps: [], constructed: [], focused: 0 };
  const Api = function (this: { onclick: unknown; close(): void }, title: string, options?: NotificationOptions) {
    fake.shown.push({ title, body: options?.body, kind: (options?.data as { kind?: unknown })?.kind });
    this.onclick = null;
    this.close = () => {};
    fake.constructed.push(this);
  } as unknown as NotificationApi;
  Object.defineProperty(Api, 'permission', { get: () => view.permission });
  (Api as unknown as { requestPermission: () => Promise<string> }).requestPermission = () => {
    fake.asked += 1;
    view.permission = view.answer;
    return Promise.resolve(view.answer);
  };
  fake.env = {
    notification: () => (view.api ? Api : undefined),
    hidden: () => view.hidden,
    registration: async () =>
      view.worker
        ? {
            showNotification: async (title: string, options?: NotificationOptions) => {
              fake.shown.push({ title, body: options?.body, kind: (options?.data as { kind?: unknown })?.kind });
            },
          }
        : null,
    focus: () => {
      fake.focused += 1;
    },
    onWorkerTap: (listener) => {
      fake.taps.push(listener);
      return () => {};
    },
    now: () => Date.now(),
    today: () => view.today,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as never),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id as never),
  };
  return fake;
}

describe('the notifier', () => {
  it('never asks on load; turning a switch on asks once, and a yes stores it on', async () => {
    const fake = fakeEnv();
    const n = createNotifier(fake.env);
    expect(fake.asked).toBe(0);
    expect(n.isOn('alerts')).toBe(false);
    expect(await n.turnOn('alerts')).toBe(null);
    expect(fake.asked).toBe(1);
    expect([getFlag(PREF_KEYS.notifyAlerts), n.isOn('alerts')]).toEqual([true, true]);
    // Already allowed: the next switch does not ask again.
    expect(await n.turnOn('daily')).toBe(null);
    expect(fake.asked).toBe(1);
    n.destroy();
  });

  it('a no, a block or a missing API leaves the switch off and says why', async () => {
    const fake = fakeEnv();
    const n = createNotifier(fake.env);
    fake.view.answer = 'default';
    expect(await n.turnOn('alerts')).toBe(NOTIFY_NOT_ALLOWED);
    fake.view.permission = 'denied';
    expect(await n.turnOn('alerts')).toBe(NOTIFY_BLOCKED);
    expect(fake.asked).toBe(1); // blocked: the browser is not asked again
    fake.view.api = false;
    expect(await n.turnOn('update')).toBe(NOTIFY_NO_API);
    expect([getFlag(PREF_KEYS.notifyAlerts), getFlag(PREF_KEYS.notifyUpdate)]).toEqual([null, null]);
    n.destroy();
  });

  it('shows alerts only while hidden, at most one a minute, then the rest as one count', async () => {
    const fake = fakeEnv();
    const n = createNotifier(fake.env);
    n.alert('Fire on floor 3.'); // off: nothing
    await n.turnOn('alerts');
    fake.view.hidden = false;
    n.alert('Fire on floor 3.'); // visible: the in-page card says it
    await settle();
    expect(fake.shown).toEqual([]);
    fake.view.hidden = true;
    n.alert('Fire on floor 3.');
    n.alert('A theft on floor 5.');
    n.alert('Fire on floor 4.');
    await settle();
    expect(fake.shown.map((s) => s.body)).toEqual(['Fire on floor 3.']);
    expect(fake.shown[0]).toMatchObject({ title: 'Hundred Stories', kind: 'alerts' });
    vi.advanceTimersByTime(ALERT_NOTIFY_GAP_MS);
    await settle();
    expect(fake.shown.map((s) => s.body)).toEqual(['Fire on floor 3.', '2 more alerts in your tower.']);
    n.destroy();
  });

  it('says a new Today\'s tower is ready when the date rolls over while hidden, once', async () => {
    const fake = fakeEnv();
    const n = createNotifier(fake.env);
    await n.turnOn('daily');
    vi.advanceTimersByTime(DAILY_CHECK_MS);
    await settle();
    expect(fake.shown).toEqual([]);
    fake.view.today = '2026-09-27';
    vi.advanceTimersByTime(DAILY_CHECK_MS);
    await settle();
    vi.advanceTimersByTime(DAILY_CHECK_MS);
    await settle();
    expect(fake.shown.map((s) => s.body)).toEqual([DAILY_TEXT]);
    n.destroy();
  });

  it('says a new version is ready only while hidden and switched on', async () => {
    const fake = fakeEnv();
    const n = createNotifier(fake.env);
    n.updateReady();
    await n.turnOn('update');
    fake.view.hidden = false;
    n.updateReady();
    fake.view.hidden = true;
    n.updateReady();
    await settle();
    expect(fake.shown.map((s) => s.body)).toEqual([UPDATE_TEXT]);
    n.destroy();
  });

  it('without a worker shows the page\'s own notification, and a tap focuses the game and tells the ui', async () => {
    const fake = fakeEnv();
    fake.view.worker = false;
    const n = createNotifier(fake.env);
    const tapped: NotifyKind[] = [];
    n.onTap((kind) => tapped.push(kind));
    await n.turnOn('alerts');
    n.alert('Fire on floor 3.');
    await settle();
    expect(fake.constructed).toHaveLength(1);
    (fake.constructed[0]!.onclick as () => void)();
    expect([fake.focused, tapped]).toEqual([1, ['alerts']]);
    // A tap on the worker's notification comes back as a message: the same handler.
    fake.taps[0]!('alerts');
    expect(tapped).toEqual(['alerts', 'alerts']);
    n.destroy();
  });
});

describe('the update watch', () => {
  function worker(state: string) {
    const listeners: (() => void)[] = [];
    return {
      state,
      addEventListener: (_type: 'statechange', fn: () => void) => listeners.push(fn),
      move(next: string) {
        this.state = next;
        for (const fn of listeners) fn();
      },
    };
  }

  function container(controller: unknown) {
    const found: (() => void)[] = [];
    const registration = {
      installing: null as ReturnType<typeof worker> | null,
      waiting: null,
      addEventListener: (_type: 'updatefound', fn: () => void) => found.push(fn),
      update: async () => undefined,
    };
    const sw = { controller, getRegistration: async () => registration };
    return { sw, registration, found };
  }

  it('says nothing for the first install', async () => {
    const { sw, registration, found } = container(null);
    let told = 0;
    watchForUpdate(sw, () => (told += 1));
    await settle();
    const first = worker('installing');
    registration.installing = first;
    found.forEach((f) => f());
    first.move('installed');
    first.move('activated');
    expect(told).toBe(0);
  });

  it('says it once for a new worker over a running one, found now or already installing', async () => {
    const { sw, registration, found } = container({});
    const early = worker('installing');
    registration.installing = early;
    let told = 0;
    watchForUpdate(sw, () => (told += 1));
    await settle();
    early.move('installed');
    expect(told).toBe(1);
    const later = worker('installing');
    registration.installing = later;
    found.forEach((f) => f());
    later.move('installed');
    expect(told).toBe(1);
  });

  // A new version with skipWaiting and clientsClaim can take the page over while boot is still
  // loading, before the watch attaches: installing and waiting are both empty by then.
  function withActive(controller: unknown, active: ReturnType<typeof worker>) {
    const made = container(controller);
    const changes: (() => void)[] = [];
    const reg = Object.assign(made.registration, { active });
    const sw = Object.assign(made.sw, {
      addEventListener: (_type: 'controllerchange', fn: () => void) => changes.push(fn),
    });
    return { sw, reg, changes };
  }
  const timers = { setInterval: () => 0, clearInterval: () => {} };

  it('says it for a new version that already claimed the page before the watch attached', async () => {
    const old = { old: true };
    const fresh = worker('activated');
    const { sw } = withActive(fresh, fresh);
    let told = 0;
    watchForUpdate(sw, () => (told += 1), timers, old);
    await settle();
    expect(told).toBe(1);
  });

  it('says it for a new version still activating, not yet in control, when the watch attached', async () => {
    const old = { old: true };
    const fresh = worker('activating');
    const { sw } = withActive(old, fresh);
    let told = 0;
    watchForUpdate(sw, () => (told += 1), timers, old);
    await settle();
    expect(told).toBe(1);
  });

  it('says it once when the controller changes later on a page that had one', async () => {
    const old = worker('activated');
    const box = { controller: old as unknown };
    const { sw, changes } = withActive(old, old);
    Object.defineProperty(sw, 'controller', { get: () => box.controller });
    let told = 0;
    watchForUpdate(sw, () => (told += 1), timers, old);
    await settle();
    expect(told).toBe(0);
    box.controller = { fresh: true };
    changes.forEach((f) => f());
    changes.forEach((f) => f());
    expect(told).toBe(1);
  });

  it('says nothing for a first install that claimed the page, nor for the running worker itself', async () => {
    const first = worker('activated');
    const claimed = withActive(first, first);
    let told = 0;
    watchForUpdate(claimed.sw, () => (told += 1), timers, null);
    await settle();
    claimed.changes.forEach((f) => f());
    const running = worker('activated');
    const same = withActive(running, running);
    watchForUpdate(same.sw, () => (told += 1), timers, running);
    await settle();
    expect(told).toBe(0);
  });
});

// The service worker's tap handler (public/notify-sw.js), run against a fake worker global.
describe('a tap on a notification', () => {
  const source = readFileSync(new URL('../../public/notify-sw.js', import.meta.url), 'utf8');
  async function tap(urls: string[]) {
    const log: string[] = [];
    let handler: ((event: unknown) => void) | null = null;
    let done: Promise<unknown> = Promise.resolve();
    const self = {
      addEventListener: (_type: string, fn: (event: unknown) => void) => (handler = fn),
      clients: {
        matchAll: async () =>
          urls.map((url) => ({
            url,
            focus: async () => log.push(`focus ${url}`),
            postMessage: (msg: { kind: string }) => log.push(`post ${url} ${msg.kind}`),
          })),
        openWindow: async (url: string) => log.push(`open ${url}`),
      },
    };
    new Function('self', source)(self);
    handler!({
      notification: { data: { kind: 'alerts' }, close: () => log.push('close') },
      waitUntil: (p: Promise<unknown>) => (done = p),
    });
    await done;
    return log;
  }

  it('opens the game when only a landing or clips tab is open', async () => {
    expect(await tap(['https://hundredstories.xyz/', 'https://hundredstories.xyz/clips/'])).toEqual([
      'close',
      'open /play/',
    ]);
  });

  it('brings a game tab forward and tells it the kind, even with other tabs open', async () => {
    expect(await tap(['https://hundredstories.xyz/', 'https://hundredstories.xyz/play/'])).toEqual([
      'close',
      'focus https://hundredstories.xyz/play/',
      'post https://hundredstories.xyz/play/ alerts',
    ]);
  });

  it('opens the game when no tab is open', async () => {
    expect(await tap([])).toEqual(['close', 'open /play/']);
  });
});

// ------------------------------------------------------------------ in the page

function stubNotifications(reason: string | null) {
  const calls: string[] = [];
  return {
    calls,
    notifications: {
      isOn: () => false,
      turnOn: async (kind: NotifyKind) => {
        calls.push(`on:${kind}`);
        return reason;
      },
      turnOff: (kind: NotifyKind) => calls.push(`off:${kind}`),
    },
  };
}

function settings(extra: Partial<PanelContext>): FakeElement {
  const ctx = { apply: () => ({ ok: true }), notice() {}, close() {}, reducedMotion: false, setReducedMotion() {}, ...extra } as unknown as PanelContext;
  return settingsNode({ world: { seed: 1, log: [], logTotal: 0 } }, ctx);
}

describe('the Notifications settings', () => {
  it('shows three switches, all off, and none at all without a notifier (the shells)', () => {
    expect(settings({}).descendants().some((n) => n.id === 'hs-notify-alerts')).toBe(false);
    const panel = settings({ notifications: stubNotifications(null).notifications });
    const labels = panel.descendants().filter((n) => n.tagName === 'LABEL' && /^hs-notify-/.test((n as unknown as { htmlFor: string }).htmlFor));
    expect(labels.map((n) => n.textContent)).toEqual(['Alerts', "Today's tower", 'New version']);
    for (const kind of ['alerts', 'daily', 'update']) {
      const control = panel.descendants().find((n) => n.id === `hs-notify-${kind}`)!;
      expect([control.getAttribute('role'), control.getAttribute('aria-checked')]).toEqual(['switch', 'false']);
    }
  });

  it('a switch the browser refuses goes back off with the reason under it', async () => {
    const stub = stubNotifications(NOTIFY_BLOCKED);
    const panel = settings({ notifications: stub.notifications });
    const control = panel.descendants().find((n) => n.id === 'hs-notify-alerts')!;
    const why = panel.descendants().find((n) => n.id === 'hs-notify-alerts-why')!;
    expect(why.hidden).toBe(true);
    click(control);
    expect(stub.calls).toEqual(['on:alerts']);
    await settle();
    expect([control.getAttribute('aria-checked'), why.hidden, why.textContent]).toEqual(['false', false, NOTIFY_BLOCKED]);
  });

  it('a switch the browser allows stays on, and turns off again', async () => {
    const stub = stubNotifications(null);
    const panel = settings({ notifications: stub.notifications });
    const control = panel.descendants().find((n) => n.id === 'hs-notify-update')!;
    click(control);
    await settle();
    expect(control.getAttribute('aria-checked')).toBe('true');
    click(control);
    expect(stub.calls).toEqual(['on:update', 'off:update']);
    expect(control.getAttribute('aria-checked')).toBe('false');
  });
});

describe('the new version notice', () => {
  function mkGame(order: string[]) {
    return {
      world: {
        seed: 1, cash: 1e6, population: 0, stars: 1, time: { minute: 0 }, log: [], logTotal: 0, rooms: new Map(), shafts: new Map(),
        sims: new Map(), events: [], stats: { lastQuarter: null, vipRating: 'none', weddingsHeld: 0 },
        story: { followed: [], threads: {}, recent: [], seq: 0 },
      },
      subscribe: () => () => {},
      getHover: () => null,
      getSpeed: () => 1,
      setSpeed: () => {},
      getTool: () => ({ kind: 'none' }),
      setTool: () => {},
      getPlacement: () => null,
      getPlacementRect: () => null,
      getSelection: () => null,
      setChrome: () => {},
      setReducedMotion: () => {},
      getSlot: () => 'mine',
      select() {},
      leave: async () => {
        order.push('leave');
        return { ok: true, wrote: true };
      },
    } as never;
  }

  it('puts up one toast that stays, and its tap saves first and then reloads', async () => {
    const order: string[] = [];
    const root = dom.createElement('div');
    const ui = createUi(root as never, mkGame(order), {} as never, { reload: () => order.push('reload') });
    ui.updateReady();
    ui.updateReady();
    const toasts = root.descendants().filter((n) => n.className.split(/\s+/).includes('is-update'));
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.textContent).toBe(`${UPDATE_TEXT}Reload`);
    vi.advanceTimersByTime(60_000);
    expect(toasts[0]!.className).not.toContain('is-leaving'); // sticky: no fade on its own
    click(toasts[0]!);
    await settle();
    expect(order).toEqual(['leave', 'reload']);
    ui.destroy();
  });

  it('hands each new alert line to the notifier, and a tapped alert opens the news', () => {
    const texts: string[] = [];
    let tap: (kind: NotifyKind) => void = () => {};
    const notifier = {
      alert: (text: string) => texts.push(text),
      onTap: (fn: (kind: NotifyKind) => void) => (tap = fn),
      updateReady() {},
      isOn: () => false,
      turnOn: async () => null,
      turnOff() {},
      permission: () => 'granted',
      destroy() {},
    };
    const game = mkGame([]) as unknown as { world: { log: unknown[]; logTotal: number } };
    const root = dom.createElement('div');
    const ui = createUi(root as never, game as never, {} as never, { notifier: notifier as never });
    game.world.log.push({ minute: 10, text: 'A theft on floor 5.', level: 'alert' }, { minute: 10, text: 'Office rented.', level: 'info' });
    game.world.logTotal = 2;
    ui.update();
    expect(texts).toEqual(['A theft on floor 5.']);
    tap('alerts');
    expect(root.descendants().some((n) => n.getAttribute('role') === 'dialog')).toBe(true);
    ui.destroy();
  });
});
