// The landing hero's opening trailer (src/site/hero-trailer.ts) on a stubbed document: the
// sources are attached only when the visitor has not asked for reduced motion or to save data.
import { describe, expect, it } from 'vitest';
import {
  HERO_TRAILER_FADE_MS,
  HERO_TRAILER_STALL_MS,
  bootHeroTrailer,
  playHeroTrailer,
  type TrailerEnv,
} from '../../src/site/hero-trailer';

type Listener = () => void;

class FakeNode {
  attrs: Record<string, string> = {};
  listeners: Record<string, Listener[]> = {};
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }
  addEventListener(type: string, fn: Listener): void {
    (this.listeners[type] ??= []).push(fn);
  }
  fire(type: string): void {
    for (const fn of this.listeners[type] ?? []) fn();
  }
}

class FakeVideo extends FakeNode {
  children: FakeNode[] = [];
  classes = new Set<string>();
  loads = 0;
  plays = 0;
  pauses = 0;
  playResult: Promise<void> = Promise.resolve();
  classList = {
    add: (name: string): void => void this.classes.add(name),
    remove: (name: string): void => void this.classes.delete(name),
  };
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
  }
}

function setup(opts: { reduce?: boolean; saveData?: boolean; readyState?: string; video?: FakeVideo | null } = {}) {
  const video = opts.video === undefined ? new FakeVideo() : opts.video;
  const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
  const docListeners: Record<string, Listener[]> = {};
  const windowListeners: Record<string, Listener[]> = {};
  const env: TrailerEnv = {
    document: {
      readyState: opts.readyState ?? 'complete',
      getElementById: (id) => (id === 'hero-trailer' ? video : null),
      createElement: () => new FakeNode(),
      addEventListener: (type, fn) => void (docListeners[type] ??= []).push(fn),
    },
    window: {
      addEventListener: (type, fn) => void (windowListeners[type] ??= []).push(fn),
    },
    matchMedia: (q) => ({ matches: q === '(prefers-reduced-motion: reduce)' && opts.reduce === true }),
    navigator: { connection: { saveData: opts.saveData === true } },
    setTimeout: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimeout: (handle) => {
      (handle as { cleared: boolean }).cleared = true;
    },
  };
  const runTimers = (ms: number): void => {
    for (const t of timers.filter((x) => !x.cleared && x.ms === ms)) {
      t.cleared = true;
      t.fn();
    }
  };
  return { env, video, timers, docListeners, windowListeners, runTimers };
}

describe('hero trailer', () => {
  it('attaches no source and plays nothing under reduced motion', () => {
    const { env, video } = setup({ reduce: true });
    playHeroTrailer(env);
    expect(video!.children).toHaveLength(0);
    expect(video!.plays).toBe(0);
    expect(video!.loads).toBe(0);
  });

  it('attaches no source and plays nothing when the visitor saves data', () => {
    const { env, video } = setup({ saveData: true });
    playHeroTrailer(env);
    expect(video!.children).toHaveLength(0);
    expect(video!.plays).toBe(0);
  });

  it('attaches the one mp4 source, no webm, loads, plays, and toggles is-playing on playing and ended', () => {
    const { env, video, runTimers } = setup();
    playHeroTrailer(env);
    expect(video!.children.map((c) => [c.attrs.src, c.attrs.type])).toEqual([
      ['/trailers/site-intro-hero.mp4', 'video/mp4'],
    ]);
    expect(video!.children.some((c) => c.attrs.src?.endsWith('.webm'))).toBe(false);
    expect(video!.loads).toBe(1);
    expect(video!.plays).toBe(1);
    expect(video!.classes.has('is-playing')).toBe(false);
    video!.fire('playing');
    expect(video!.classes.has('is-playing')).toBe(true);
    video!.fire('ended');
    expect(video!.classes.has('is-playing')).toBe(false);
    expect(video!.attrs.hidden).toBeUndefined();
    runTimers(HERO_TRAILER_FADE_MS);
    expect(video!.attrs.hidden).toBe('');
  });

  it('never loops: the markup and the module leave loop off', () => {
    const { env, video } = setup();
    playHeroTrailer(env);
    expect(video!.attrs.loop).toBeUndefined();
  });

  it('fades out on an error', () => {
    const { env, video, runTimers } = setup();
    playHeroTrailer(env);
    video!.fire('playing');
    video!.fire('error');
    expect(video!.classes.has('is-playing')).toBe(false);
    runTimers(HERO_TRAILER_FADE_MS);
    expect(video!.attrs.hidden).toBe('');
  });

  it('fades out when the source fails to load', () => {
    const { env, video } = setup();
    playHeroTrailer(env);
    video!.children[0]!.fire('error');
    video!.fire('playing');
    expect(video!.classes.has('is-playing')).toBe(false);
  });

  it('ends after a stall of four seconds with no playing after it, and not when playing resumes', () => {
    const resumed = setup();
    playHeroTrailer(resumed.env);
    resumed.video!.fire('playing');
    resumed.video!.fire('stalled');
    resumed.video!.fire('playing');
    resumed.runTimers(HERO_TRAILER_STALL_MS);
    expect(resumed.video!.classes.has('is-playing')).toBe(true);

    const stuck = setup();
    playHeroTrailer(stuck.env);
    stuck.video!.fire('playing');
    stuck.video!.fire('stalled');
    expect(stuck.video!.classes.has('is-playing')).toBe(true);
    stuck.runTimers(HERO_TRAILER_STALL_MS);
    expect(stuck.video!.classes.has('is-playing')).toBe(false);
    stuck.runTimers(HERO_TRAILER_FADE_MS);
    expect(stuck.video!.attrs.hidden).toBe('');
  });

  it('fades out when play() is refused', async () => {
    const video = new FakeVideo();
    video.playResult = Promise.reject(new Error('NotAllowedError'));
    const { env, runTimers } = setup({ video });
    playHeroTrailer(env);
    await Promise.resolve();
    await Promise.resolve();
    runTimers(HERO_TRAILER_FADE_MS);
    expect(video.attrs.hidden).toBe('');
    expect(video.classes.has('is-playing')).toBe(false);
  });

  it('waits for the window load event while the document has not finished loading', () => {
    const { env, video, windowListeners } = setup({ readyState: 'loading' });
    bootHeroTrailer(env);
    expect(video!.children).toHaveLength(0);
    for (const fn of windowListeners.load ?? []) fn();
    expect(video!.children).toHaveLength(1);
  });

  it('plays at once when the document has already finished loading', () => {
    const { env, video, windowListeners } = setup({ readyState: 'complete' });
    bootHeroTrailer(env);
    expect(video!.children).toHaveLength(1);
    expect(windowListeners.load ?? []).toHaveLength(0);
  });

  it('sets the poster just before the sources are attached, on the normal path', () => {
    const { env, video } = setup();
    playHeroTrailer(env);
    expect(video!.attrs.poster).toBe('/trailers/site-intro.webp');
  });

  it('never sets the poster when the trailer is declined', () => {
    const { env, video } = setup({ reduce: true });
    playHeroTrailer(env);
    expect(video!.attrs.poster).toBeUndefined();
  });

  it('finishes on a pause that is not part of finishing, so an outside pause never leaves a frozen frame', () => {
    const { env, video, runTimers } = setup();
    playHeroTrailer(env);
    video!.fire('playing');
    video!.fire('pause');
    expect(video!.classes.has('is-playing')).toBe(false);
    runTimers(HERO_TRAILER_FADE_MS);
    expect(video!.attrs.hidden).toBe('');
  });

  it('calling finish twice (ended then error) hides only once', () => {
    const { env, video, timers } = setup();
    playHeroTrailer(env);
    video!.fire('ended');
    video!.fire('error');
    expect(timers.filter((t) => t.ms === HERO_TRAILER_FADE_MS)).toHaveLength(1);
    expect(video!.pauses).toBe(1);
  });

  it('finish calls pause() on the video', () => {
    const { env, video } = setup();
    playHeroTrailer(env);
    video!.fire('ended');
    expect(video!.pauses).toBe(1);
  });

  it('a second stalled while a stall timer is pending does not start a second timer', () => {
    const { env, video, timers } = setup();
    playHeroTrailer(env);
    video!.fire('playing');
    video!.fire('stalled');
    video!.fire('stalled');
    expect(timers.filter((t) => t.ms === HERO_TRAILER_STALL_MS)).toHaveLength(1);
  });

  it('never throws when the video is missing or matchMedia throws', () => {
    expect(() => playHeroTrailer(setup({ video: null }).env)).not.toThrow();
    const { env, video } = setup();
    env.matchMedia = () => {
      throw new Error('no');
    };
    expect(() => bootHeroTrailer(env)).not.toThrow();
    expect(video!.children).toHaveLength(0);
  });
});
