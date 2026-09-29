// The landing splash (src/site/splash.ts) on a stubbed document: it plays only when
// public/splash-init.js marked <html> splash-pending, attaches its source only then, and every
// way it can end (ended, error, a failed source, a refused play(), a stall, Skip, Escape, the cap)
// fades the overlay, takes it out of the DOM and drops the class.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  SPLASH_FADE_MS,
  SPLASH_MAX_MS,
  SPLASH_STALL_MS,
  bootSplash,
  playSplash,
  type SplashEnv,
} from '../../src/site/splash';

type Listener = (event?: unknown) => void;

class FakeNode {
  attrs: Record<string, string> = {};
  listeners: Record<string, Listener[]> = {};
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }
  addEventListener(type: string, fn: Listener): void {
    (this.listeners[type] ??= []).push(fn);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }
  fire(type: string, event?: unknown): void {
    for (const fn of [...(this.listeners[type] ?? [])]) fn(event);
  }
}

class FakeOverlay extends FakeNode {
  classes = new Set<string>();
  removed = 0;
  classList = { add: (name: string): void => void this.classes.add(name) };
  remove(): void {
    this.removed += 1;
  }
}

class FakeVideo extends FakeNode {
  children: FakeNode[] = [];
  loads = 0;
  plays = 0;
  pauses = 0;
  playResult: Promise<void> = Promise.resolve();
  appendChild(child: FakeNode): FakeNode {
    this.children.push(child);
    return child;
  }
  load(): void {
    this.loads += 1;
  }
  play(): Promise<void> {
    this.plays += 1;
    return this.playResult;
  }
  pause(): void {
    this.pauses += 1;
    this.fire('pause');
  }
}

function setup(
  opts: {
    pending?: boolean;
    readyState?: string;
    video?: FakeVideo | null;
    overlay?: FakeOverlay | null;
    /** What matchMedia('(orientation: portrait)') answers; 'absent' leaves matchMedia off the env. */
    portrait?: boolean | 'throws' | 'absent';
  } = {},
) {
  const video = opts.video === undefined ? new FakeVideo() : opts.video;
  const overlay = opts.overlay === undefined ? new FakeOverlay() : opts.overlay;
  const skip = new FakeNode();
  const html = new Set<string>(opts.pending === false ? [] : ['splash-pending']);
  const storage = new Map<string, string>();
  const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
  const doc = new FakeNode();
  const media = { portrait: opts.portrait ?? false, queries: [] as string[] };
  const env: SplashEnv = {
    document: {
      readyState: opts.readyState ?? 'interactive',
      documentElement: {
        classList: { contains: (n) => html.has(n), remove: (n) => void html.delete(n) },
      },
      getElementById: (id) => ({ splash: overlay, 'splash-video': video, 'splash-skip': skip })[id] ?? null,
      createElement: () => new FakeNode(),
      addEventListener: (type, fn) => doc.addEventListener(type, fn),
      removeEventListener: (type, fn) => doc.removeEventListener(type, fn),
    },
    sessionStorage: { setItem: (k, v) => void storage.set(k, v) },
    setTimeout: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimeout: (handle) => {
      (handle as { cleared: boolean }).cleared = true;
    },
  };
  if (media.portrait !== 'absent') {
    env.matchMedia = (query) => {
      media.queries.push(query);
      if (media.portrait === 'throws') throw new Error('no matchMedia');
      return { matches: query === '(orientation: portrait)' && media.portrait === true };
    };
  }
  const runTimers = (ms: number): void => {
    for (const t of timers.filter((x) => !x.cleared && x.ms === ms)) {
      t.cleared = true;
      t.fn();
    }
  };
  const live = (ms: number) => timers.filter((t) => !t.cleared && t.ms === ms);
  return { env, video, overlay, skip, html, storage, timers, doc, media, runTimers, live };
}

/** The overlay faded, left the DOM, and the page scrolls again. */
function expectEnded(s: ReturnType<typeof setup>): void {
  expect(s.overlay!.classes.has('is-done')).toBe(true);
  expect(s.overlay!.removed).toBe(0);
  expect(s.html.has('splash-pending')).toBe(true);
  s.runTimers(SPLASH_FADE_MS);
  expect(s.overlay!.removed).toBe(1);
  expect(s.html.has('splash-pending')).toBe(false);
  expect(s.video!.pauses).toBeGreaterThanOrEqual(1);
}

describe('splash', () => {
  it('without splash-pending, removes the overlay and touches nothing else', () => {
    const s = setup({ pending: false });
    playSplash(s.env);
    expect(s.overlay!.removed).toBe(1);
    expect(s.video!.children).toHaveLength(0);
    expect(s.video!.loads).toBe(0);
    expect(s.video!.plays).toBe(0);
    expect(s.storage.size).toBe(0);
    expect(s.timers).toHaveLength(0);
    expect(s.video!.attrs.poster).toBeUndefined();
  });

  it('sets the poster on the play path only, before the source is attached', () => {
    const s = setup();
    let posterAtAppend: string | undefined;
    const append = s.video!.appendChild.bind(s.video!);
    s.video!.appendChild = (child) => {
      posterAtAppend = s.video!.attrs.poster;
      return append(child);
    };
    playSplash(s.env);
    expect(posterAtAppend).toBe('/trailers/site-intro.webp');
    expect(s.video!.attrs.poster).toBe('/trailers/site-intro.webp');
  });

  it('with splash-pending, marks the session seen, attaches the one mp4 source, loads and plays', () => {
    const s = setup();
    playSplash(s.env);
    expect(s.storage.get('hs.splash')).toBe('seen');
    expect(s.video!.children.map((c) => [c.attrs.src, c.attrs.type])).toEqual([['/trailers/site-splash.mp4', 'video/mp4']]);
    expect(s.video!.loads).toBe(1);
    expect(s.video!.plays).toBe(1);
    expect(s.overlay!.classes.has('is-done')).toBe(false);
    expect(s.overlay!.removed).toBe(0);
  });

  it('in a portrait viewport, attaches the portrait cut, its poster and its 720x1280 size', () => {
    const s = setup({ portrait: true });
    let posterAtAppend: string | undefined;
    const append = s.video!.appendChild.bind(s.video!);
    s.video!.appendChild = (child) => {
      posterAtAppend = s.video!.attrs.poster;
      return append(child);
    };
    playSplash(s.env);
    expect(s.media.queries).toEqual(['(orientation: portrait)']);
    expect(s.video!.children.map((c) => [c.attrs.src, c.attrs.type])).toEqual([['/trailers/site-splash-portrait.mp4', 'video/mp4']]);
    expect(posterAtAppend).toBe('/trailers/site-splash-portrait.webp');
    expect(s.video!.attrs.poster).toBe('/trailers/site-splash-portrait.webp');
    expect([s.video!.attrs.width, s.video!.attrs.height, s.video!.attrs['data-cut']]).toEqual(['720', '1280', 'portrait']);
    expect(s.video!.loads).toBe(1);
    expect(s.video!.plays).toBe(1);
  });

  it('in a landscape viewport, attaches the landscape cut and leaves the markup size alone', () => {
    const s = setup({ portrait: false });
    playSplash(s.env);
    expect(s.media.queries).toEqual(['(orientation: portrait)']);
    expect(s.video!.children.map((c) => c.attrs.src)).toEqual(['/trailers/site-splash.mp4']);
    expect(s.video!.attrs.poster).toBe('/trailers/site-intro.webp');
    expect(s.video!.attrs.width).toBeUndefined();
    expect(s.video!.attrs.height).toBeUndefined();
    expect(s.video!.attrs['data-cut']).toBeUndefined();
  });

  it('falls back to the landscape cut when matchMedia is missing or throws', () => {
    for (const portrait of ['absent', 'throws'] as const) {
      const s = setup({ portrait });
      playSplash(s.env);
      expect(s.video!.children.map((c) => c.attrs.src)).toEqual(['/trailers/site-splash.mp4']);
      expect(s.video!.attrs.poster).toBe('/trailers/site-intro.webp');
      expect(s.video!.plays).toBe(1);
      expect(s.overlay!.classes.has('is-done')).toBe(false);
    }
  });

  it('chooses once at attach: turning the phone later changes nothing', () => {
    const s = setup({ portrait: true });
    playSplash(s.env);
    s.media.portrait = false;
    s.video!.fire('playing');
    s.video!.fire('waiting');
    s.video!.fire('playing');
    expect(s.media.queries).toHaveLength(1);
    expect(s.video!.children.map((c) => c.attrs.src)).toEqual(['/trailers/site-splash-portrait.mp4']);
    expect(s.video!.loads).toBe(1);
  });

  it('never asks the orientation when the gate turned the visitor away', () => {
    const s = setup({ pending: false, portrait: true });
    playSplash(s.env);
    expect(s.media.queries).toHaveLength(0);
    expect(s.video!.children).toHaveLength(0);
    expect(s.video!.attrs.poster).toBeUndefined();
  });

  it('the portrait cut ends the same ways: ended, a failed source, a stall', () => {
    const ended = setup({ portrait: true });
    playSplash(ended.env);
    ended.video!.fire('playing');
    ended.video!.fire('ended');
    expectEnded(ended);

    const failed = setup({ portrait: true });
    playSplash(failed.env);
    failed.video!.children[0]!.fire('error');
    expectEnded(failed);

    const stuck = setup({ portrait: true });
    playSplash(stuck.env);
    stuck.runTimers(SPLASH_STALL_MS);
    expectEnded(stuck);
  });

  it('ends on ended', () => {
    const s = setup();
    playSplash(s.env);
    s.video!.fire('playing');
    s.video!.fire('ended');
    expectEnded(s);
  });

  it('ends on a video error', () => {
    const s = setup();
    playSplash(s.env);
    s.video!.fire('error');
    expectEnded(s);
  });

  it('ends when the source fails to load', () => {
    const s = setup();
    playSplash(s.env);
    s.video!.children[0]!.fire('error');
    expectEnded(s);
  });

  it('ends when play() is refused', async () => {
    const video = new FakeVideo();
    video.playResult = Promise.reject(new Error('NotAllowedError'));
    const s = setup({ video });
    playSplash(s.env);
    await Promise.resolve();
    await Promise.resolve();
    expectEnded(s);
  });

  it('ends after 4 s with no playing event from the start', () => {
    const s = setup();
    playSplash(s.env);
    expect(s.live(SPLASH_STALL_MS)).toHaveLength(1);
    s.runTimers(SPLASH_STALL_MS);
    expectEnded(s);
  });

  it('a stall that playing follows within 4 s carries on; one that it does not ends the splash', () => {
    const resumed = setup();
    playSplash(resumed.env);
    resumed.video!.fire('playing');
    expect(resumed.live(SPLASH_STALL_MS)).toHaveLength(0);
    resumed.video!.fire('stalled');
    resumed.video!.fire('waiting');
    expect(resumed.live(SPLASH_STALL_MS)).toHaveLength(1);
    resumed.video!.fire('playing');
    resumed.runTimers(SPLASH_STALL_MS);
    expect(resumed.overlay!.classes.has('is-done')).toBe(false);

    const stuck = setup();
    playSplash(stuck.env);
    stuck.video!.fire('playing');
    stuck.video!.fire('stalled');
    stuck.runTimers(SPLASH_STALL_MS);
    expectEnded(stuck);
  });

  it('an outside pause counts as a stall, so a frozen frame never holds the page', () => {
    const s = setup();
    playSplash(s.env);
    s.video!.fire('playing');
    s.video!.fire('pause');
    s.runTimers(SPLASH_STALL_MS);
    expectEnded(s);
  });

  it('ends on a click on Skip', () => {
    const s = setup();
    playSplash(s.env);
    s.video!.fire('playing');
    s.skip.fire('click');
    expectEnded(s);
  });

  it('ends on Escape and ignores other keys', () => {
    const s = setup();
    playSplash(s.env);
    s.video!.fire('playing');
    s.doc.fire('keydown', { key: 'Enter' });
    expect(s.overlay!.classes.has('is-done')).toBe(false);
    s.doc.fire('keydown', { key: 'Escape' });
    expectEnded(s);
    expect(s.doc.listeners.keydown ?? []).toHaveLength(0);
  });

  it('never outlasts the cap, whatever the video does', () => {
    const s = setup();
    playSplash(s.env);
    s.video!.fire('playing');
    s.runTimers(SPLASH_MAX_MS);
    expectEnded(s);
  });

  it('ending twice fades and tears down once', () => {
    const s = setup();
    playSplash(s.env);
    s.video!.fire('ended');
    s.video!.fire('error');
    s.skip.fire('click');
    expect(s.timers.filter((t) => t.ms === SPLASH_FADE_MS)).toHaveLength(1);
    s.runTimers(SPLASH_FADE_MS);
    expect(s.overlay!.removed).toBe(1);
  });

  it('with no video element, drops the overlay and the class at once', () => {
    const s = setup({ video: null });
    expect(() => playSplash(s.env)).not.toThrow();
    expect(s.overlay!.removed).toBe(1);
    expect(s.html.has('splash-pending')).toBe(false);
  });

  it('with no overlay, still drops the class so the page scrolls', () => {
    const s = setup({ overlay: null });
    expect(() => playSplash(s.env)).not.toThrow();
    expect(s.html.has('splash-pending')).toBe(false);
  });

  it('when sessionStorage throws, plays anyway', () => {
    const s = setup();
    s.env.sessionStorage = {
      setItem: () => {
        throw new Error('private mode');
      },
    };
    playSplash(s.env);
    expect(s.video!.plays).toBe(1);
  });

  it('when load() throws, ends rather than leaving the overlay up', () => {
    const video = new FakeVideo();
    video.load = () => {
      throw new Error('no');
    };
    const s = setup({ video });
    expect(() => playSplash(s.env)).not.toThrow();
    expectEnded(s);
  });

  it('starts at once when the markup is parsed, never on window load', () => {
    const s = setup({ readyState: 'interactive' });
    bootSplash(s.env);
    expect(s.video!.plays).toBe(1);

    const done = setup({ readyState: 'complete' });
    bootSplash(done.env);
    expect(done.video!.plays).toBe(1);
  });

  it('waits on DOMContentLoaded while the document is still loading', () => {
    const s = setup({ readyState: 'loading' });
    bootSplash(s.env);
    expect(s.video!.plays).toBe(0);
    s.doc.fire('DOMContentLoaded');
    expect(s.video!.plays).toBe(1);
  });
});

describe('splash-init.js, the before-paint gate', () => {
  const source = readFileSync(join(__dirname, '..', '..', 'public', 'splash-init.js'), 'utf8');

  function gate(opts: { reduce?: boolean; saveData?: boolean; seen?: boolean; throws?: 'matchMedia' | 'storage' } = {}): boolean {
    const classes = new Set<string>();
    const context = {
      window: {
        matchMedia: (q: string) => {
          if (opts.throws === 'matchMedia') throw new Error('no');
          return { matches: q === '(prefers-reduced-motion: reduce)' && opts.reduce === true };
        },
      },
      navigator: { connection: { saveData: opts.saveData === true } },
      sessionStorage: {
        getItem: (k: string) => {
          if (opts.throws === 'storage') throw new Error('no');
          return k === 'hs.splash' && opts.seen ? 'seen' : null;
        },
      },
      document: { documentElement: { classList: { add: (n: string) => void classes.add(n) } } },
    };
    runInNewContext(source, context);
    return classes.has('splash-pending');
  }

  it('marks a first visit this session', () => {
    expect(gate()).toBe(true);
  });

  it('stays off under reduced motion, save data, a second visit, or any read that throws', () => {
    expect(gate({ reduce: true })).toBe(false);
    expect(gate({ saveData: true })).toBe(false);
    expect(gate({ seen: true })).toBe(false);
    expect(gate({ throws: 'matchMedia' })).toBe(false);
    expect(gate({ throws: 'storage' })).toBe(false);
  });
});
