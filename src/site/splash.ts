// The landing splash: the intro trailer plays once per session over the whole viewport, then
// fades away to show the site. public/splash-init.js decides before first paint (no reduced
// motion, no save data, not yet seen this session) and marks <html> splash-pending, which is
// what makes the #splash overlay visible (site.css). This file plays it and takes it away. The
// markup carries the <video> with no sources; they are attached here, so a visitor the gate
// turned away never downloads the file. Decoration, best effort: every DOM access is guarded,
// nothing here throws, and anything going wrong ends the splash so the page is reachable.
// hero.ts imports this file and does not know what it does.

export const SPLASH_SOURCES: ReadonlyArray<{ src: string; type: string }> = [
  { src: '/trailers/site-splash.mp4', type: 'video/mp4' },
];

export const SPLASH_POSTER = '/trailers/site-intro.webp';

/** The class splash-init.js puts on <html> when the splash is to play. */
export const SPLASH_PENDING = 'splash-pending';
/** sessionStorage key and value: set as soon as the splash starts, so it plays once a session. */
export const SPLASH_KEY = 'hs.splash';
export const SPLASH_SEEN = 'seen';
/** This long with no playing event (from the start, or after a stall or pause) ends the splash. */
export const SPLASH_STALL_MS = 4000;
/** The opacity transition in site.css (.splash.is-done); the overlay leaves the DOM after it. */
export const SPLASH_FADE_MS = 400;
/** The splash never outlasts this, whatever the video does (the cut is 18 s). The overlay's CSS
 *  failsafe in site.css hides it at the same mark if this file never runs. */
export const SPLASH_MAX_MS = 30_000;

type Listener = (event?: unknown) => void;

/** The slice of an HTMLVideoElement this file needs: shared by the real DOM and a test's fakes. */
export interface SplashVideo {
  appendChild(child: SplashSource): unknown;
  addEventListener(type: string, fn: Listener): void;
  setAttribute(name: string, value: string): void;
  load(): void;
  play(): Promise<void> | void;
  pause(): void;
}

export interface SplashSource {
  setAttribute(name: string, value: string): void;
  addEventListener?(type: string, fn: Listener): void;
}

export interface SplashElement {
  classList: { add(name: string): void };
  remove(): void;
  addEventListener?(type: string, fn: Listener): void;
}

export interface SplashEnv {
  document: {
    readyState: string;
    documentElement: { classList: { contains(name: string): boolean; remove(name: string): void } };
    getElementById(id: string): unknown;
    createElement(tag: 'source'): SplashSource;
    addEventListener(type: string, fn: Listener): void;
    removeEventListener?(type: string, fn: Listener): void;
  };
  sessionStorage?: { setItem(key: string, value: string): void } | undefined;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

function pending(env: SplashEnv): boolean {
  try {
    return env.document.documentElement.classList.contains(SPLASH_PENDING);
  } catch {
    return false;
  }
}

function dropPending(env: SplashEnv): void {
  try {
    env.document.documentElement.classList.remove(SPLASH_PENDING);
  } catch {
    // nothing left to do
  }
}

function removeOverlay(overlay: SplashElement | null): void {
  try {
    overlay?.remove();
  } catch {
    // nothing left to do
  }
}

/** Plays the splash if splash-init.js asked for it, else takes the overlay out. Exported for tests. */
export function playSplash(env: SplashEnv): void {
  let overlay: SplashElement | null = null;
  try {
    overlay = env.document.getElementById('splash') as SplashElement | null;
  } catch {
    overlay = null;
  }
  if (!pending(env)) {
    removeOverlay(overlay);
    return;
  }

  let done = false;
  let stallTimer: unknown = null;
  let maxTimer: unknown = null;
  let video: SplashVideo | null = null;

  const clear = (handle: unknown): void => {
    try {
      if (handle !== null) env.clearTimeout(handle);
    } catch {
      // a timer that will not clear only calls finish again, which is a no-op
    }
  };
  const clearStall = (): void => {
    clear(stallTimer);
    stallTimer = null;
  };
  const onKey: Listener = (event) => {
    try {
      if ((event as { key?: string } | undefined)?.key === 'Escape') finish();
    } catch {
      finish();
    }
  };
  const teardown = (): void => {
    removeOverlay(overlay);
    dropPending(env);
    try {
      video?.pause();
    } catch {
      // gone from the DOM already
    }
  };
  function finish(): void {
    if (done) return;
    done = true;
    clearStall();
    clear(maxTimer);
    try {
      env.document.removeEventListener?.('keydown', onKey);
    } catch {
      // the listener only calls finish, which is a no-op now
    }
    try {
      overlay?.classList.add('is-done');
    } catch {
      teardown();
      return;
    }
    try {
      env.setTimeout(teardown, SPLASH_FADE_MS);
    } catch {
      teardown();
    }
  }
  const armStall = (): void => {
    if (done || stallTimer !== null) return;
    try {
      stallTimer = env.setTimeout(finish, SPLASH_STALL_MS);
    } catch {
      finish();
    }
  };

  try {
    env.sessionStorage?.setItem(SPLASH_KEY, SPLASH_SEEN);
  } catch {
    // private mode: the gate may play it again next load, which is harmless
  }

  try {
    if (!overlay) {
      dropPending(env);
      return;
    }
    video = env.document.getElementById('splash-video') as SplashVideo | null;
    if (!video || typeof video.play !== 'function') {
      teardown();
      return;
    }
    maxTimer = env.setTimeout(finish, SPLASH_MAX_MS);
    env.document.addEventListener('keydown', onKey);
    try {
      (env.document.getElementById('splash-skip') as SplashElement | null)?.addEventListener?.('click', () => finish());
    } catch {
      // Escape, the stall timer and the cap still end it
    }

    video.addEventListener('playing', () => clearStall());
    video.addEventListener('ended', () => finish());
    video.addEventListener('error', () => finish());
    video.addEventListener('stalled', armStall);
    video.addEventListener('waiting', armStall);
    // A pause this file did not ask for (the browser parking a background tab, say) counts as a
    // stall: a playing event within 4 s carries on, else the splash ends.
    video.addEventListener('pause', armStall);

    // Set here, not in the markup, so a visitor the gate turned away downloads nothing at all.
    // Until the poster lands, the overlay's own background is the fill.
    video.setAttribute('poster', SPLASH_POSTER);
    SPLASH_SOURCES.forEach(({ src, type }, i) => {
      const source = env.document.createElement('source');
      source.setAttribute('src', src);
      source.setAttribute('type', type);
      // A source that fails fires error on itself, not on the video: the last one failing means
      // none will play.
      if (i === SPLASH_SOURCES.length - 1) source.addEventListener?.('error', () => finish());
      video!.appendChild(source);
    });
    armStall();
    video.load();
    const started = video.play();
    if (started && typeof started.catch === 'function') started.catch(() => finish());
  } catch {
    finish();
  }
}

/** Starts the splash as soon as the markup is parsed (at once if it already is): the video is
 *  meant to be the first thing seen, so this never waits on the window load event. */
export function bootSplash(env: SplashEnv): void {
  try {
    if (env.document.readyState === 'loading') {
      env.document.addEventListener('DOMContentLoaded', () => playSplash(env));
    } else {
      playSplash(env);
    }
  } catch {
    dropPending(env);
  }
}

try {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    let storage: SplashEnv['sessionStorage'];
    try {
      storage = window.sessionStorage;
    } catch {
      storage = undefined;
    }
    bootSplash({
      document: document as unknown as SplashEnv['document'],
      sessionStorage: storage,
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (handle) => window.clearTimeout(handle as number),
    });
  }
} catch {
  // decoration
}
