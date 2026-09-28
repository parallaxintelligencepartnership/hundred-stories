// The landing hero's opening: the intro trailer plays once over the hero, then fades away to show
// the live tower (hero.ts) or the still under it. The markup carries the <video> with no sources;
// they are attached here, so a visitor who asks for reduced motion or saves data never downloads
// the file. Decoration, best effort: every DOM access is guarded and nothing here ever throws.
// hero.ts and hero-ready.ts do not know this file exists.

export const HERO_TRAILER_SOURCES: ReadonlyArray<{ src: string; type: string }> = [
  { src: '/trailers/site-intro-hero.mp4', type: 'video/mp4' },
];

/** A stall this long with no playing event after it ends the trailer. */
export const HERO_TRAILER_STALL_MS = 4000;
/** The opacity transition in site.css (.hero-trailer); hidden is set once it has run. */
export const HERO_TRAILER_FADE_MS = 300;

/** The slice of an HTMLVideoElement this file needs: shared by the real DOM and a test's fakes. */
export interface TrailerVideo {
  classList: { add(name: string): void; remove(name: string): void };
  appendChild(child: TrailerSource): unknown;
  addEventListener(type: string, fn: () => void): void;
  setAttribute(name: string, value: string): void;
  load(): void;
  play(): Promise<void> | void;
  pause(): void;
}

export interface TrailerSource {
  setAttribute(name: string, value: string): void;
  addEventListener?(type: string, fn: () => void): void;
}

export interface TrailerEnv {
  document: {
    readyState: string;
    getElementById(id: string): unknown;
    createElement(tag: 'source'): TrailerSource;
    addEventListener(type: string, fn: () => void): void;
  };
  matchMedia?: ((query: string) => { matches: boolean }) | undefined;
  navigator?: { connection?: { saveData?: boolean | undefined } | undefined } | undefined;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** True when the visitor asked for reduced motion or to save data: the trailer stays off. */
export function trailerDeclined(env: TrailerEnv): boolean {
  try {
    if (env.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true;
  } catch {
    return true;
  }
  try {
    return env.navigator?.connection?.saveData === true;
  } catch {
    return true;
  }
}

/** Attaches the sources to the hero video and plays it once. Exported for tests. */
export function playHeroTrailer(env: TrailerEnv): void {
  try {
    if (trailerDeclined(env)) return;
    const video = env.document.getElementById('hero-trailer') as TrailerVideo | null;
    if (!video || typeof video.play !== 'function') return;

    let done = false;
    let stallTimer: unknown = null;
    const clearStall = (): void => {
      if (stallTimer !== null) env.clearTimeout(stallTimer);
      stallTimer = null;
    };
    const finish = (): void => {
      if (done) return;
      done = true;
      clearStall();
      try {
        video.classList.remove('is-playing');
        video.pause();
      } catch {
        // decoration: a video that will not pause is still faded out
      }
      env.setTimeout(() => {
        try {
          video.setAttribute('hidden', '');
        } catch {
          // nothing left to do
        }
      }, HERO_TRAILER_FADE_MS);
    };

    video.addEventListener('playing', () => {
      clearStall();
      if (!done) video.classList.add('is-playing');
    });
    video.addEventListener('ended', finish);
    video.addEventListener('error', finish);
    video.addEventListener('stalled', () => {
      if (done || stallTimer !== null) return;
      stallTimer = env.setTimeout(finish, HERO_TRAILER_STALL_MS);
    });

    HERO_TRAILER_SOURCES.forEach(({ src, type }, i) => {
      const source = env.document.createElement('source');
      source.setAttribute('src', src);
      source.setAttribute('type', type);
      // A source that fails fires error on itself, not on the video: the last one failing means
      // none will play.
      if (i === HERO_TRAILER_SOURCES.length - 1) source.addEventListener?.('error', finish);
      video.appendChild(source);
    });
    video.load();
    const started = video.play();
    if (started && typeof started.catch === 'function') started.catch(finish);
  } catch {
    // decoration: the still or the live tower underneath carries the hero
  }
}

/** Plays the trailer once the document is parsed (at once if it already is). */
export function bootHeroTrailer(env: TrailerEnv): void {
  try {
    if (env.document.readyState === 'loading') {
      env.document.addEventListener('DOMContentLoaded', () => playHeroTrailer(env));
    } else {
      playHeroTrailer(env);
    }
  } catch {
    // decoration
  }
}

try {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    bootHeroTrailer({
      document,
      matchMedia: typeof window.matchMedia === 'function' ? (q) => window.matchMedia(q) : undefined,
      navigator: navigator as TrailerEnv['navigator'],
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (handle) => window.clearTimeout(handle as number),
    });
  }
} catch {
  // decoration
}
