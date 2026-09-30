// The Send feedback card on the fake DOM: opened from the menu, Send held back until there is
// text, exactly six fields in the request (the honeypot among them), the words for sent and for
// not sent, Escape and focus, and watch mode seeing the card as something open.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FEEDBACK_FAILED,
  FEEDBACK_FULL,
  FEEDBACK_INTRO,
  FEEDBACK_SENT,
  FEEDBACK_TIMEOUT_MS,
  FEEDBACK_TOO_LONG,
  FEEDBACK_URL,
  feedbackPlatform,
  feedbackUrl,
} from '../../src/ui/feedback';
import { PREF_KEYS, setFlag } from '../../src/ui/prefs';
import { createUi } from '../../src/ui/ui';
import { WATCH_CLASS, WATCH_IDLE_MS } from '../../src/ui/watch';
import { FakeDom, choosePauseEntry, type FakeElement } from './fake-dom';

const PKG_VERSION = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  dom = new FakeDom();
  uninstall = dom.install();
  const win = (globalThis as unknown as { window: Record<string, unknown> & { localStorage: { setItem(k: string, v: string): void } } }).window;
  win.localStorage.setItem('hs.intro.seen', 'true');
  win.localStorage.setItem('hs.guide.done', 'true');
  win['innerWidth'] = 1280;
  win['innerHeight'] = 720;
  vi.stubGlobal('navigator', { userAgent: CHROME_UA });
});
afterEach(() => {
  uninstall();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mkGame(): never {
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
    togglePause: () => {},
    getTool: () => ({ kind: 'none' }),
    setTool: () => {},
    getPlacement: () => null,
    getPlacementRect: () => null,
    getSelection: () => null,
    setChrome: () => {},
    setReducedMotion: () => {},
    getSlot: () => 'mine',
    select() {},
  } as never;
}

const click = (node: FakeElement): void => (node.listeners.get('click') ?? []).forEach((f) => f({}));
const fire = (node: FakeElement, type: string): void => (node.listeners.get(type) ?? []).forEach((f) => f({ target: node }));
const buttonNamed = (root: FakeElement, text: string): FakeElement | undefined =>
  root.descendants().find((n) => n.tagName === 'BUTTON' && n.textContent === text);
const menuButton = (root: FakeElement): FakeElement =>
  root.descendants().find((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Menu')!;
const pauseItems = (root: FakeElement): string[] =>
  root.descendants().filter((n) => n.className.split(/\s+/).includes('hs-pause-item')).map((n) => n.textContent);
const card = (root: FakeElement): FakeElement | undefined =>
  root.descendants().find((n) => n.className.split(/\s+/).includes('hs-feedback'));
/** The page the pause card is on (Settings, a page inside it since 2026-09-30), or null at the root or closed. */
const pausePage = (root: FakeElement): string | null =>
  root.descendants().find((n) => n.className.split(/\s+/).includes('hs-pause-card'))?.getAttribute('data-page') ?? null;
/** Back to the menu's entries from its page. */
const backToEntries = (root: FakeElement): void =>
  click(root.descendants().find((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Back')!);
const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};
type Field = FakeElement & { value: string };
const byId = (root: FakeElement, id: string): Field => root.descendants().find((n) => n.id === id) as Field;
const honeypot = (root: FakeElement): Field => root.descendants().find((n) => (n as unknown as { name?: string }).name === 'website') as Field;
const type = (field: Field, text: string): void => {
  field.value = text;
  fire(field, 'input');
};

/** The ui with the card open, the way a player gets there: Menu, Settings, then Send feedback. */
function openCard(): { root: FakeElement; shell: FakeElement; menu: FakeElement; node: FakeElement } {
  const root = dom.createElement('div');
  createUi(root as never, mkGame(), {} as never);
  const menu = menuButton(root);
  menu.focus();
  click(menu);
  choosePauseEntry(root, 'settings');
  const row = buttonNamed(root, 'Send feedback');
  if (!row) throw new Error('no Send feedback row in the menu');
  click(row);
  const node = card(root);
  if (!node) throw new Error('the card did not open');
  return { root, shell: root.children[0] as FakeElement, menu, node };
}

type Call = { url: string; init: { method: string; headers: Record<string, string>; body: string } };
function stubFetch(answer: () => Promise<unknown>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', (url: string, init: Call['init']) => {
    calls.push({ url, init });
    return answer();
  });
  return calls;
}
const reply = (status: number, json: unknown) => () => Promise.resolve({ status, json: () => Promise.resolve(json) });

describe('the Send feedback card', () => {
  it('opens from the menu with its heading, its line, and the text box focused', () => {
    const { root, node } = openCard();
    expect(node.getAttribute('role')).toBe('dialog');
    expect(node.textContent).toContain('Send feedback');
    expect(node.textContent).toContain(FEEDBACK_INTRO);
    expect(node.textContent).toContain('Email, if you want a reply');
    const text = byId(root, 'hs-feedback-text');
    expect(text.tagName).toBe('TEXTAREA');
    expect((text as unknown as { required: boolean }).required).toBe(true);
    expect((text as unknown as { maxLength: number }).maxLength).toBe(2000);
    expect(dom.activeElement).toBe(text);
    expect(byId(root, 'hs-feedback-email').type).toBe('email');
    const trap = honeypot(root);
    expect(trap.getAttribute('tabindex')).toBe('-1');
    expect(trap.getAttribute('autocomplete')).toBe('off');
    expect(trap.parentNode?.getAttribute('aria-hidden')).toBe('true');
    expect(buttonNamed(node, 'Send')).toBeDefined();
    expect(buttonNamed(node, 'Cancel')).toBeDefined();
  });

  it('keeps Send disabled until there is text, and counts it', () => {
    const { root, node } = openCard();
    const send = buttonNamed(node, 'Send')!;
    const text = byId(root, 'hs-feedback-text');
    expect(send.disabled).toBe(true);
    type(text, '   ');
    expect(send.disabled).toBe(true);
    type(text, 'Elevator stuck');
    expect(send.disabled).toBe(false);
    expect(byId(root, 'hs-feedback-count').textContent).toBe('14 / 2000');
    type(text, '');
    expect(send.disabled).toBe(true);
  });

  it('posts exactly six fields as JSON to its own origin on the web, honeypot included', async () => {
    vi.stubGlobal('location', { origin: 'https://hundredstories.xyz' });
    const calls = stubFetch(reply(200, { ok: true }));
    const { root, node } = openCard();
    type(byId(root, 'hs-feedback-text'), '  The lobby floods  ');
    type(byId(root, 'hs-feedback-email'), 'me@example.com');
    honeypot(root).value = 'bot was here';
    click(buttonNamed(node, 'Send')!);
    await flush();
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe('https://hundredstories.xyz/api/feedback');
    expect(call.init.method).toBe('POST');
    expect(call.init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(call.init.body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['platform', 'replyTo', 'screen', 'text', 'version', 'website']);
    expect(body).toEqual({
      text: 'The lobby floods',
      replyTo: 'me@example.com',
      version: PKG_VERSION,
      platform: 'web-chrome',
      screen: '1280x720',
      website: 'bot was here',
    });
  });

  it('on www posts to www itself, same-origin, not to the bare domain', async () => {
    vi.stubGlobal('location', { origin: 'https://www.hundredstories.xyz' });
    const calls = stubFetch(reply(200, { ok: true }));
    const { root, node } = openCard();
    type(byId(root, 'hs-feedback-text'), 'From www');
    click(buttonNamed(node, 'Send')!);
    await flush();
    expect(calls[0]!.url).toBe('https://www.hundredstories.xyz/api/feedback');
    expect(node.textContent).toContain(FEEDBACK_SENT);
  });

  it('in the Android shell (https://localhost) posts to the site, not to the app bundle', async () => {
    vi.stubGlobal('location', { origin: 'https://localhost' });
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true, getPlatform: () => 'android' });
    const calls = stubFetch(reply(200, { ok: true }));
    const { root, node } = openCard();
    type(byId(root, 'hs-feedback-text'), 'From the phone');
    click(buttonNamed(node, 'Send')!);
    await flush();
    expect(calls[0]!.url).toBe('https://hundredstories.xyz/api/feedback');
    expect(FEEDBACK_URL).toBe('https://hundredstories.xyz/api/feedback');
  });

  it('sends an empty replyTo when no email was typed', async () => {
    const calls = stubFetch(reply(200, { ok: true }));
    const { root, node } = openCard();
    type(byId(root, 'hs-feedback-text'), 'Hi');
    click(buttonNamed(node, 'Send')!);
    await flush();
    const body = JSON.parse(calls[0]!.init.body) as Record<string, unknown>;
    expect(body['replyTo']).toBe('');
    expect(body['website']).toBe('');
  });

  it('reads Sending while it waits, then says Sent. Thank you. with a Close button', async () => {
    let answer: (value: unknown) => void = () => {};
    stubFetch(() => new Promise((resolve) => (answer = resolve)));
    const { root, node, menu } = openCard();
    type(byId(root, 'hs-feedback-text'), 'Great game');
    click(buttonNamed(node, 'Send')!);
    const sending = buttonNamed(node, 'Sending')!;
    expect(sending).toBeDefined();
    expect(sending.disabled).toBe(true);
    answer({ status: 200, json: () => Promise.resolve({ ok: true }) });
    await flush();
    expect(node.textContent).toContain(FEEDBACK_SENT);
    expect(buttonNamed(node, 'Send')).toBeUndefined();
    // The sheet's own head has a Close too; this is the one in the body, under the words.
    const closes = node.descendants().filter((n) => n.tagName === 'BUTTON' && n.textContent === 'Close');
    expect(closes).toHaveLength(2);
    const close = closes[1]!;
    expect(close.className).toBe('hs-btn is-primary');
    expect(dom.activeElement).toBe(close);
    click(close);
    expect(card(root)).toBeUndefined();
    // Back in the pause menu it was opened from, on its Settings page; Resume puts focus back on Menu.
    expect(pausePage(root)).toBe('settings');
    backToEntries(root);
    choosePauseEntry(root, 'resume');
    expect(dom.activeElement).toBe(menu);
  });

  const FAILURES: [string, () => Promise<unknown>][] = [
    ['a 500', reply(500, { ok: false })],
    ['a 200 without ok true', reply(200, { ok: false })],
    ['a 200 that is not JSON', () => Promise.resolve({ status: 200, json: () => Promise.reject(new Error('not json')) })],
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
  ];
  it.each(FAILURES)('says it could not send after %s, and gives the buttons back', async (_name, answer) => {
    stubFetch(answer);
    const { root, node } = openCard();
    type(byId(root, 'hs-feedback-text'), 'Bug');
    click(buttonNamed(node, 'Send')!);
    await flush();
    expect(node.textContent).toContain(FEEDBACK_FAILED);
    expect(FEEDBACK_FAILED).toBe('Could not send. Try again in a minute, or email requests@hundredstories.xyz.');
    const send = buttonNamed(node, 'Send')!;
    expect(send.disabled).toBe(false);
    expect(buttonNamed(node, 'Cancel')).toBeDefined();
    expect(node.textContent).not.toContain(FEEDBACK_SENT);
  });

  it('a 413 says the message is too long, without the try-again-in-a-minute advice', async () => {
    stubFetch(reply(413, { ok: false, reason: 'too large' }));
    const { root, node } = openCard();
    type(byId(root, 'hs-feedback-text'), 'Bug');
    click(buttonNamed(node, 'Send')!);
    await flush();
    expect(FEEDBACK_TOO_LONG).toBe('That message is too long. Shorten it and send again.');
    expect(node.textContent).toContain(FEEDBACK_TOO_LONG);
    expect(node.textContent).not.toContain(FEEDBACK_FAILED);
    expect(buttonNamed(node, 'Send')!.disabled).toBe(false);
  });

  it('a 507 (the store is full for the day) says try again tomorrow, not in a minute', async () => {
    stubFetch(reply(507, { ok: false, reason: 'full for today' }));
    const { root, node } = openCard();
    type(byId(root, 'hs-feedback-text'), 'Bug');
    click(buttonNamed(node, 'Send')!);
    await flush();
    expect(FEEDBACK_FULL).toBe('Feedback is full for today. Try again tomorrow.');
    expect(node.textContent).toContain(FEEDBACK_FULL);
    expect(node.textContent).not.toContain(FEEDBACK_FAILED);
    expect(buttonNamed(node, 'Send')!.disabled).toBe(false);
  });

  it('a 429 still says try again in a minute', async () => {
    stubFetch(reply(429, { ok: false, reason: 'slow down' }));
    const { root, node } = openCard();
    type(byId(root, 'hs-feedback-text'), 'Bug');
    click(buttonNamed(node, 'Send')!);
    await flush();
    expect(node.textContent).toContain(FEEDBACK_FAILED);
    expect(FEEDBACK_FAILED).toContain('Try again in a minute');
  });

  it('gives up after 10 seconds with no answer', async () => {
    stubFetch(() => new Promise(() => {}));
    const { root, node } = openCard();
    type(byId(root, 'hs-feedback-text'), 'Slow');
    click(buttonNamed(node, 'Send')!);
    await flush();
    vi.advanceTimersByTime(FEEDBACK_TIMEOUT_MS - 1);
    await flush();
    expect(node.textContent).not.toContain(FEEDBACK_FAILED);
    vi.advanceTimersByTime(1);
    await flush();
    expect(FEEDBACK_TIMEOUT_MS).toBe(10_000);
    expect(node.textContent).toContain(FEEDBACK_FAILED);
    expect(buttonNamed(node, 'Send')!.disabled).toBe(false);
  });

  it('closes on Escape and on Cancel, back to the pause menu it came from; Escape there puts focus back on Menu', () => {
    const escape = (target: unknown): void =>
      dom.fireWindow('keydown', {
        key: 'Escape', code: 'Escape', target, defaultPrevented: false,
        preventDefault() { (this as { defaultPrevented: boolean }).defaultPrevented = true; },
        stopImmediatePropagation() {},
      });
    const first = openCard();
    escape(byId(first.root, 'hs-feedback-text'));
    expect(card(first.root)).toBeUndefined();
    // Back on the Settings page, focus where it was on the page.
    expect(pausePage(first.root)).toBe('settings');
    expect(first.root.descendants().find((n) => n.className.split(/\s+/).includes('hs-pause-card'))?.contains(dom.activeElement)).toBe(true);
    escape(dom.activeElement);
    expect(pauseItems(first.root)).toContain('Settings');
    escape(dom.activeElement);
    expect(pauseItems(first.root)).toEqual([]);
    expect(dom.activeElement).toBe(first.menu);

    const second = openCard();
    click(buttonNamed(second.node, 'Cancel')!);
    expect(card(second.root)).toBeUndefined();
    expect(pausePage(second.root)).toBe('settings');
    backToEntries(second.root);
    choosePauseEntry(second.root, 'resume');
    expect(dom.activeElement).toBe(second.menu);
  });

  it('counts as open for watch mode: the chrome stays up until it closes', () => {
    setFlag(PREF_KEYS.watchMode, true);
    const { root, shell, node } = openCard();
    vi.advanceTimersByTime(3 * WATCH_IDLE_MS);
    expect(shell.classList.contains(WATCH_CLASS)).toBe(false);
    click(buttonNamed(node, 'Cancel')!);
    expect(card(root)).toBeUndefined();
    backToEntries(root); // back in the pause menu on its Settings page, which counts as open too
    choosePauseEntry(root, 'resume');
    vi.advanceTimersByTime(2 * WATCH_IDLE_MS);
    expect(shell.classList.contains(WATCH_CLASS)).toBe(true);
  });
});

describe('the daily card and the feedback card', () => {
  const DAILY = { date: '2026-09-27', twist: { name: 'x', line: 'y' }, endMinute: 0, finished: false };

  function mountWithDaily() {
    let daily: typeof DAILY | null = null;
    const subscribers = new Set<() => void>();
    const game = Object.assign(mkGame() as object, {
      subscribe(cb: () => void) {
        subscribers.add(cb);
        return () => subscribers.delete(cb);
      },
      getDaily: () => daily,
      getDailyChoice: () => null,
    });
    const root = dom.createElement('div');
    createUi(root as never, game as never, {} as never);
    const setDaily = (next: typeof DAILY | null): void => {
      daily = next;
      subscribers.forEach((cb) => cb());
    };
    return { root, setDaily };
  }
  const openFeedback = (root: FakeElement): void => {
    click(menuButton(root));
    choosePauseEntry(root, 'settings');
    click(buttonNamed(root, 'Send feedback')!);
  };
  const dailyHeading = (root: FakeElement) =>
    root.descendants().find((n) => /^H[1-6]$/.test(n.tagName) && n.textContent === "Today's tower");

  it('a daily card due while the player types does not replace the feedback card', () => {
    const { root, setDaily } = mountWithDaily();
    openFeedback(root);
    type(byId(root, 'hs-feedback-text'), 'half a thought');
    setDaily({ ...DAILY });
    expect(card(root)).toBeDefined();
    expect(byId(root, 'hs-feedback-text').value).toBe('half a thought');
    expect(dailyHeading(root)).toBeUndefined();
    // Skipped, not queued: closing the feedback card does not bring it up by itself.
    click(buttonNamed(card(root)!, 'Cancel')!);
    setDaily({ ...DAILY });
    expect(dailyHeading(root)).toBeUndefined();
  });

  it('with nothing open, the daily card still comes up on its own', () => {
    const { root, setDaily } = mountWithDaily();
    setDaily({ ...DAILY });
    expect(dailyHeading(root)).toBeDefined();
  });
});

describe('the feedback address', () => {
  const SITE = 'https://hundredstories.xyz/api/feedback';
  it('is the page origin on the web: both site hostnames, localhost dev, the pi3 fallback', () => {
    expect(feedbackUrl({ location: { origin: 'https://hundredstories.xyz' } })).toBe(SITE);
    expect(feedbackUrl({ location: { origin: 'https://www.hundredstories.xyz' } })).toBe('https://www.hundredstories.xyz/api/feedback');
    expect(feedbackUrl({ location: { origin: 'http://localhost:5173' } })).toBe('http://localhost:5173/api/feedback');
    expect(feedbackUrl({ location: { origin: 'https://hs.example.net' } })).toBe('https://hs.example.net/api/feedback');
  });

  it('is the site address in every app shell, whatever origin the bundle is served from', () => {
    const ios = { isNativePlatform: () => true, getPlatform: () => 'ios' };
    const android = { isNativePlatform: () => true, getPlatform: () => 'android' };
    expect(feedbackUrl({ Capacitor: ios, location: { origin: 'capacitor://localhost' } })).toBe(SITE);
    expect(feedbackUrl({ Capacitor: android, location: { origin: 'https://localhost' } })).toBe(SITE);
    expect(feedbackUrl({ __TAURI_INTERNALS__: {}, location: { origin: 'tauri://localhost' } })).toBe(SITE);
    expect(feedbackUrl({ __TAURI_INTERNALS__: {}, location: { origin: 'http://tauri.localhost' } })).toBe(SITE);
  });

  it('falls back to the site when the page has no http origin', () => {
    expect(feedbackUrl({})).toBe(SITE);
    expect(feedbackUrl({ location: { origin: 'null' } })).toBe(SITE);
    expect(feedbackUrl({ location: { origin: 'file://' } })).toBe(SITE);
  });
});

describe('the platform label', () => {
  it('names the phone shells, the desktop shell and the browser', () => {
    expect(feedbackPlatform({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } })).toBe('ios');
    expect(feedbackPlatform({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } })).toBe('android');
    expect(feedbackPlatform({ __TAURI_INTERNALS__: {}, navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' } })).toBe('macos');
    expect(feedbackPlatform({ navigator: { userAgent: CHROME_UA } })).toBe('web-chrome');
    expect(feedbackPlatform({ navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' } })).toBe('web-safari');
    expect(feedbackPlatform({ navigator: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0' } })).toBe('web-firefox');
    expect(feedbackPlatform({})).toBe('web');
  });
});

// The Worker's rate limits (wrangler.jsonc), read here because the Worker's tsconfig has no node
// types. The per-IP limit must sit well below the shared one, or one address holds everyone at 429.
describe("the Worker's feedback limits", () => {
  const conf = readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8');
  const limitOf = (name: string): { limit: number; period: number } => {
    const m = new RegExp(`"name":\\s*"${name}"[^}]*"simple":\\s*\\{\\s*"limit":\\s*(\\d+),\\s*"period":\\s*(\\d+)`).exec(conf);
    expect(m, name).not.toBeNull();
    return { limit: Number(m![1]), period: Number(m![2]) };
  };

  it('per IP 2 and shared 3 per 60 s, so one address alone never fills the shared bucket', () => {
    const perIp = limitOf('FEEDBACK_LIMIT');
    const shared = limitOf('FEEDBACK_GLOBAL');
    expect(perIp).toEqual({ limit: 2, period: 60 });
    expect(shared).toEqual({ limit: 3, period: 60 });
    expect(perIp.limit).toBeLessThan(shared.limit);
  });

  it('says plainly that the limiters cannot hold the daily KV cap, and what the player sees', () => {
    expect(conf).toContain('3 x 1,440 = 4,320 writes a day, over the cap');
    expect(conf).toContain('unconfirmed');
    expect(conf).toContain(FEEDBACK_FULL);
  });
});
