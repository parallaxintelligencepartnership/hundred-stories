// The Send feedback card: opened from the menu (Help, Send feedback), in the panel pattern. The
// player types what broke or what they would like, and an email only if they want a reply. Send
// posts one small JSON body to the site's /api/feedback route (src/worker): the text, the reply
// address, the game version, the platform, the screen size, and the hidden "website" field that
// only bots fill in. Nothing else about the player goes with it, and nothing is sent until Send.
//
// Where it goes: on the web, the page's own origin (same-origin, so no CORS and nothing for the
// site's CSP to allow; localhost dev and the pi3 fallback post to themselves too). In the iOS,
// Android and desktop shells the page is served from the app bundle, not the site, so there it is
// the absolute https://hundredstories.xyz/api/feedback, which the Worker allows by origin.

import { version as GAME_VERSION } from '../../package.json';
import { savePlatform } from '../game/storage';
import { SITE_URL } from '../share/share';
import { button, el, panelShell, type PanelContext, type PanelElement } from './panels';

/** The address the app shells post to. */
export const FEEDBACK_URL = new URL('api/feedback', SITE_URL).href;
export const FEEDBACK_PATH = '/api/feedback';
/** The worker takes at most this many characters of text (src/worker LIMITS.text). */
export const FEEDBACK_MAX = 2000;
/** The worker takes a reply address up to this long (src/worker LIMITS.replyTo). */
export const FEEDBACK_EMAIL_MAX = 200;
/** No answer by then counts as a failure. */
export const FEEDBACK_TIMEOUT_MS = 10_000;

export const FEEDBACK_TITLE = 'Send feedback';
export const FEEDBACK_INTRO = 'Tell us what broke or what you would like. No account needed.';
export const FEEDBACK_EMAIL_LABEL = 'Email, if you want a reply';
export const FEEDBACK_EMAIL_CHECK = 'Check the email, or leave it empty.';
export const FEEDBACK_SENT = 'Sent. Thank you.';
export const FEEDBACK_FAILED = 'Could not send. Try again in a minute, or email requests@hundredstories.xyz.';
/** A 413: the body is over the worker's byte limit, so sending it again can never pass. */
export const FEEDBACK_TOO_LONG = 'That message is too long. Shorten it and send again.';
/** The Worker's 507: its storage refused the write, most likely the day's write cap. */
export const FEEDBACK_FULL = 'Feedback is full for today. Try again tomorrow.';
/** The status the Worker answers when its KV write fails (src/worker/feedback.ts STORE_FAILED_STATUS). */
export const FEEDBACK_FULL_STATUS = 507;

/** How a send ended: stored, refused as too large (413), storage full for the day (507), or anything else. */
export type FeedbackOutcome = 'sent' | 'too-long' | 'full' | 'failed';

/** Exactly what goes to the server, and nothing more. */
export interface FeedbackBody {
  text: string;
  replyTo: string;
  version: string;
  platform: string;
  screen: string;
  website: string;
}

interface PlatformGlobal {
  Capacitor?: { getPlatform?: () => string };
  navigator?: { userAgent?: string };
}

/** The browser family from a user agent, or '' when it is not plain. Order matters: Edge says Chrome too, Chrome says Safari. */
export function browserFamily(ua: string): string {
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'edge';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'firefox';
  if (/Chrome\/|CriOS\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return '';
}

/**
 * A short label for where the game runs: "ios" or "android" in the phone shells, "macos",
 * "windows" or "linux" in the desktop shell, else "web" with the browser family ("web-safari").
 * The shell is found the way saves find it (savePlatform, src/game/storage.ts).
 */
export function feedbackPlatform(g: object = globalThis): string {
  const pg = g as PlatformGlobal;
  const ua = typeof pg.navigator?.userAgent === 'string' ? pg.navigator.userAgent : '';
  const shell = savePlatform(g);
  if (shell === 'capacitor') {
    let name = '';
    try {
      name = pg.Capacitor?.getPlatform?.() ?? '';
    } catch {
      name = '';
    }
    if (name === 'ios' || name === 'android') return name;
    return /Android/.test(ua) ? 'android' : 'ios';
  }
  if (shell === 'tauri') {
    if (/Mac/.test(ua)) return 'macos';
    if (/Windows/.test(ua)) return 'windows';
    return 'linux';
  }
  const family = browserFamily(ua);
  return family ? `web-${family}` : 'web';
}

/**
 * The address to post to: the site's absolute address in the Capacitor and Tauri shells (found
 * the way saves find them, savePlatform), else the page's own origin when it is http or https.
 * A web page on any other scheme (a file opened from disk) falls back to the site.
 */
export function feedbackUrl(g: object = globalThis): string {
  if (savePlatform(g) !== 'web') return FEEDBACK_URL;
  let origin = '';
  try {
    const o = (g as { location?: { origin?: unknown } }).location?.origin;
    origin = typeof o === 'string' ? o : '';
  } catch {
    origin = '';
  }
  return /^https?:\/\/[^/]+$/.test(origin) ? `${origin}${FEEDBACK_PATH}` : FEEDBACK_URL;
}

/** The window's size in CSS pixels, "390x844". */
export function feedbackScreen(): string {
  const w = typeof window === 'undefined' ? undefined : (window as { innerWidth?: number; innerHeight?: number });
  const side = (n: number | undefined): number => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 0);
  return `${side(w?.innerWidth)}x${side(w?.innerHeight)}`;
}

export function feedbackBody(text: string, replyTo: string, website: string): FeedbackBody {
  return {
    text: text.trim(),
    replyTo: replyTo.trim(),
    version: GAME_VERSION,
    platform: feedbackPlatform(),
    screen: feedbackScreen(),
    website,
  };
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  status: number;
  json(): Promise<unknown>;
}>;

export interface FeedbackDeps {
  fetch?: FetchLike;
  timeoutMs?: number;
}

/**
 * POST the body. 'sent' only for a 200 whose JSON is {"ok":true}; 'too-long' for a 413; 'full'
 * for a 507; anything else, a network error or the timeout is 'failed'.
 */
export async function sendFeedback(body: FeedbackBody, deps: FeedbackDeps = {}): Promise<FeedbackOutcome> {
  const doFetch = deps.fetch ?? (typeof fetch === 'function' ? (fetch as unknown as FetchLike) : null);
  if (!doFetch) return 'failed';
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<FeedbackOutcome>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve('failed');
    }, deps.timeoutMs ?? FEEDBACK_TIMEOUT_MS);
  });
  const request = (async (): Promise<FeedbackOutcome> => {
    const response = await doFetch(feedbackUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (response.status === 413) return 'too-long';
    if (response.status === FEEDBACK_FULL_STATUS) return 'full';
    if (response.status !== 200) return 'failed';
    const data = (await response.json()) as { ok?: unknown } | null;
    return data !== null && typeof data === 'object' && data.ok === true ? 'sent' : 'failed';
  })().catch((): FeedbackOutcome => 'failed');
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** The card. The ui mounts it as the 'feedback' panel, so watch mode counts it as open. */
export function createFeedbackPanel(ctx: Pick<PanelContext, 'close'>, deps: FeedbackDeps = {}): PanelElement {
  const { panel, body } = panelShell(FEEDBACK_TITLE, 'help', ctx);
  panel.classList.add('hs-feedback');
  let closed = false;
  const close = (): void => {
    closed = true;
    ctx.close();
  };

  const intro = el('p', 'hs-intro-line', FEEDBACK_INTRO);
  intro.id = 'hs-feedback-intro';

  const text = el('textarea', 'hs-feedback-text');
  text.id = 'hs-feedback-text';
  text.name = 'text';
  text.required = true;
  text.maxLength = FEEDBACK_MAX;
  text.rows = 5;
  text.value = '';
  text.setAttribute('aria-label', 'Your feedback');
  text.setAttribute('aria-describedby', 'hs-feedback-intro hs-feedback-count');
  const count = el('span', 'hs-feedback-count hs-card-meta', `0 / ${FEEDBACK_MAX}`);
  count.id = 'hs-feedback-count';
  const textField = el('div', 'hs-field');
  textField.append(text, count);

  const email = el('input', 'hs-feedback-email');
  email.id = 'hs-feedback-email';
  email.type = 'email';
  email.name = 'email';
  email.maxLength = FEEDBACK_EMAIL_MAX;
  email.value = '';
  email.setAttribute('autocomplete', 'email');
  email.setAttribute('inputmode', 'email');
  const emailLabel = el('label', 'hs-row-label', FEEDBACK_EMAIL_LABEL);
  emailLabel.htmlFor = email.id;
  const emailField = el('div', 'hs-field');
  emailField.append(emailLabel, email);

  // The honeypot: off screen, out of the tab order and hidden from screen readers, so only a bot
  // that fills every field it finds ever puts anything in it.
  const trap = el('div', 'hs-feedback-trap');
  trap.setAttribute('aria-hidden', 'true');
  const website = el('input');
  website.type = 'text';
  website.name = 'website';
  website.value = '';
  website.setAttribute('tabindex', '-1');
  website.setAttribute('autocomplete', 'off');
  trap.append(website);

  const status = el('p', 'hs-feedback-status hs-intro-line');
  status.setAttribute('role', 'status');
  status.hidden = true;

  const send = button('Send', 'hs-btn is-primary', () => void submit());
  const cancel = button('Cancel', 'hs-btn', close);
  const actions = el('div', 'hs-actions');
  actions.append(send, cancel);

  let sending = false;
  let sent = false;
  const emailLooksWrong = (): boolean => {
    const value = email.value.trim();
    return value !== '' && !/^[^\s@]+@[^\s@]+$/.test(value);
  };
  const paint = (): void => {
    count.textContent = `${text.value.length} / ${FEEDBACK_MAX}`;
    send.disabled = sending || text.value.trim() === '';
    send.textContent = sending ? 'Sending' : 'Send';
  };
  const say = (line: string | null): void => {
    status.textContent = line ?? '';
    status.hidden = line === null;
  };

  async function submit(): Promise<void> {
    if (sending || text.value.trim() === '') return;
    if (emailLooksWrong()) {
      say(FEEDBACK_EMAIL_CHECK);
      email.focus();
      return;
    }
    sending = true;
    say(null);
    paint();
    const outcome = await sendFeedback(feedbackBody(text.value, email.value, website.value), deps);
    sending = false;
    if (closed) return;
    if (outcome === 'sent') {
      sent = true;
      const done = button('Close', 'hs-btn is-primary', close);
      const doneActions = el('div', 'hs-actions');
      doneActions.append(done);
      body.replaceChildren(el('p', 'hs-intro-line hs-feedback-sent', FEEDBACK_SENT), doneActions);
      done.focus();
      return;
    }
    say(outcome === 'too-long' ? FEEDBACK_TOO_LONG : outcome === 'full' ? FEEDBACK_FULL : FEEDBACK_FAILED);
    paint();
  }

  text.addEventListener('input', paint);
  email.addEventListener('input', () => {
    if (!status.hidden && status.textContent === FEEDBACK_EMAIL_CHECK) say(null);
  });
  paint();

  body.append(intro, textField, emailField, trap, status, actions);
  // Unsent words (the message or the reply address) are the player's work: Watch leaves the card
  // open for them. Once sent, the form is gone and nothing is left to lose.
  panel.holdsWork = () => !sent && (text.value.trim() !== '' || email.value.trim() !== '');
  // The ui focuses this once the card is up (ui.ts refreshPanel).
  panel.initialFocus = text;
  return panel;
}
