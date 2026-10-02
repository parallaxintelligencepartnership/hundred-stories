// Clips in the game (P4d): the site's four videos as a page in the pause card, with sources by
// platform, one playing at a time, a plain line and Try again in place of a player that cannot
// play, and everything paused and let go when the page goes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLIP_OFFLINE_TEXT,
  CLIP_RETRY,
  CLIP_STALL_MS,
  CLIPS,
  CLIPS_URL,
  clipsBody,
  clipSources,
  clipsOpenOutside,
} from '../../src/ui/clips';
import { createUi } from '../../src/ui/ui';
import { FakeDom, choosePauseEntry, pauseEntry, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
});
afterEach(() => {
  uninstall();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const hasClass = (node: FakeElement, name: string): boolean => node.className.split(/\s+/).includes(name);
const fire = (node: FakeElement, type: string): void => (node.listeners.get(type) ?? []).forEach((f) => f({ target: node }));
const videosIn = (node: FakeElement): FakeElement[] => node.descendants().filter((n) => n.tagName === 'VIDEO');

/** A fake video that counts pause and load, and can say how much it has. */
function asPlayer(video: FakeElement): { pauses: number; loads: number } {
  const counts = { pauses: 0, loads: 0 };
  Object.assign(video, {
    pause: () => (counts.pauses += 1),
    load: () => (counts.loads += 1),
    readyState: 0,
  });
  return counts;
}

describe('the clips body', () => {
  it('lists the site\'s four clips in order with their titles, each a 16:9 player with its poster, controls, inline, nothing preloaded', () => {
    const body = clipsBody({ platform: 'web', online: () => true });
    const root = body.node as unknown as FakeElement;
    expect(root.descendants().filter((n) => hasClass(n, 'hs-clip-title')).map((n) => n.textContent)).toEqual([
      'The trailer',
      'The elevator is out',
      'The backlog',
      'The wait',
    ]);
    const videos = videosIn(root);
    expect(videos).toHaveLength(4);
    for (const [i, video] of videos.entries()) {
      expect(video.getAttribute('controls')).not.toBeNull();
      expect(video.getAttribute('playsinline')).not.toBeNull();
      expect(video.getAttribute('preload')).toBe('none');
      expect(video.getAttribute('poster')).toBe(`/trailers/${CLIPS[i]!.name}.webp`);
      expect(video.getAttribute('src')).toBe(`/trailers/${CLIPS[i]!.name}.mp4`);
      expect(video.getAttribute('muted')).toBeNull();
    }
    expect(root.textContent).not.toMatch(/sound|mute/i);
  });

  it('sources by platform: the web same origin, the Capacitor shells the site, Tauri opens the site outside', () => {
    const intro = CLIPS[0]!;
    expect(clipSources(intro, 'web')).toEqual({ video: '/trailers/site-intro.mp4', poster: '/trailers/site-intro.webp' });
    expect(clipSources(intro, 'capacitor')).toEqual({
      video: 'https://hundredstories.xyz/trailers/site-intro.mp4',
      poster: 'https://hundredstories.xyz/trailers/site-intro.webp',
    });
    expect(clipsOpenOutside('tauri')).toBe(true);
    expect(clipsOpenOutside('web')).toBe(false);
    expect(clipsOpenOutside('capacitor')).toBe(false);
    const native = videosIn(clipsBody({ platform: 'capacitor', online: () => true }).node as unknown as FakeElement);
    expect(native[3]?.getAttribute('src')).toBe('https://hundredstories.xyz/trailers/the-wait.mp4');
  });

  it('one plays at a time: starting one pauses the others', () => {
    const root = clipsBody({ platform: 'web', online: () => true }).node as unknown as FakeElement;
    const videos = videosIn(root);
    const counts = videos.map(asPlayer);
    fire(videos[1]!, 'play');
    expect(counts.map((c) => c.pauses)).toEqual([1, 0, 1, 1]);
  });

  it('an error shows one plain line and Try again in that player only; Try again puts the player back', () => {
    const root = clipsBody({ platform: 'web', online: () => true }).node as unknown as FakeElement;
    const videos = videosIn(root);
    videos.forEach(asPlayer);
    fire(videos[2]!, 'error');
    const frames = root.descendants().filter((n) => hasClass(n, 'hs-clip-frame'));
    expect(hasClass(frames[2]!, 'is-failed')).toBe(true);
    expect(frames[2]!.textContent).toContain(CLIP_OFFLINE_TEXT);
    expect(videosIn(frames[2]!)).toHaveLength(0);
    expect(videosIn(root)).toHaveLength(3);
    const retry = frames[2]!.descendants().find((n) => hasClass(n, 'hs-clip-retry'))!;
    expect(retry.textContent).toBe(CLIP_RETRY);
    fire(retry, 'click');
    expect(videosIn(frames[2]!)).toHaveLength(1);
    expect(hasClass(frames[2]!, 'is-failed')).toBe(false);
  });

  it('offline: each player is the line; a stall with no data after a press is the line too', () => {
    let online = false;
    const root = clipsBody({ platform: 'web', online: () => online }).node as unknown as FakeElement;
    expect(videosIn(root)).toHaveLength(0);
    expect(root.descendants().filter((n) => hasClass(n, 'hs-clip-line'))).toHaveLength(4);
    // Try again while still offline keeps the line; once online it is a player again.
    const retry = root.descendants().find((n) => hasClass(n, 'hs-clip-retry'))!;
    fire(retry, 'click');
    expect(videosIn(root)).toHaveLength(0);
    online = true;
    fire(root.descendants().find((n) => hasClass(n, 'hs-clip-retry'))!, 'click');
    expect(videosIn(root)).toHaveLength(1);

    vi.useFakeTimers();
    const fresh = clipsBody({ platform: 'web', online: () => true }).node as unknown as FakeElement;
    const video = videosIn(fresh)[0]!;
    asPlayer(video);
    fire(video, 'stalled');
    expect(videosIn(fresh)).toHaveLength(3);
    const second = videosIn(fresh)[0]!;
    asPlayer(second);
    fire(second, 'play');
    vi.advanceTimersByTime(CLIP_STALL_MS);
    expect(videosIn(fresh)).toHaveLength(2);
  });

  it('dispose pauses every player and lets its file go', () => {
    const body = clipsBody({ platform: 'web', online: () => true });
    const videos = videosIn(body.node as unknown as FakeElement);
    const counts = videos.map(asPlayer);
    body.dispose();
    expect(counts.every((c) => c.pauses === 1 && c.loads === 1)).toBe(true);
    expect(videos.every((v) => v.getAttribute('src') === null)).toBe(true);
    // An error after it is gone says nothing.
    fire(videos[0]!, 'error');
    expect((body.node as unknown as FakeElement).descendants().some((n) => hasClass(n, 'hs-clip-line'))).toBe(false);
  });
});

describe('Clips in the pause menu', () => {
  function mkGame() {
    return {
      world: {
        seed: 1, cash: 1e6, population: 0, stars: 1, time: { minute: 12 * 60 }, log: [], logTotal: 0, rooms: new Map(), shafts: new Map(),
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
      getDaily: () => null,
      getDailyChoice: () => null,
      select() {},
      exportSave: () => '',
    };
  }

  function mountMenu() {
    const root = dom.createElement('div');
    const ui = createUi(root as never, mkGame() as never, {} as never);
    const menuButton = root.descendants().find((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Menu')!;
    fire(menuButton, 'click');
    return { root, ui };
  }

  it('Clips comes after Stories and opens a page of four clips; Back pauses and lets them go', () => {
    const { root, ui } = mountMenu();
    const words = root.descendants().filter((n) => hasClass(n, 'hs-pause-item')).map((n) => n.textContent);
    expect(words.indexOf('Clips')).toBe(words.indexOf('Stories') + 1);
    choosePauseEntry(root, 'clips');
    const card = root.descendants().find((n) => hasClass(n, 'hs-pause-card'))!;
    expect(card.dataset['page'] ?? card.getAttribute('data-page')).toBe('clips');
    const videos = videosIn(card);
    expect(videos).toHaveLength(4);
    const counts = videos.map(asPlayer);
    fire(root.descendants().find((n) => hasClass(n, 'hs-pause-back'))!, 'click');
    expect(counts.every((c) => c.pauses === 1)).toBe(true);
    expect(videos.every((v) => v.getAttribute('src') === null)).toBe(true);
    expect(pauseEntry(root, 'clips')).toBeDefined();
    ui.destroy();
  });

  it('in the desktop shell Clips opens the site\'s Clips page outside and stays in the menu', () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    const opened: string[] = [];
    (globalThis as unknown as { window: Record<string, unknown> }).window['open'] = (url: string) => opened.push(url);
    const { root, ui } = mountMenu();
    choosePauseEntry(root, 'clips');
    expect(opened).toEqual([CLIPS_URL]);
    expect(CLIPS_URL).toBe('https://hundredstories.xyz/clips/');
    expect(videosIn(root)).toHaveLength(0);
    ui.destroy();
  });
});
