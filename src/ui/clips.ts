// Clips: the site's four videos (clips/index.html, the trailer then the three short clips) inside
// the game, as a page in the pause card and inside the exited screen (exit-screen.ts). Each is a
// 16:9 player with its poster, the browser's own controls, inline, nothing loaded before a press.
// Only one plays at a time; leaving pauses everything and lets the files go (dispose).
//
// Where the files come from, by platform (storage.ts savePlatform):
// - web (a browser tab and the installed app): the same origin, /trailers/<name>.mp4 and .webp.
//   They are not in the offline cache, so offline a player says it needs a connection.
// - capacitor: the app carries no copy (vite.config.ts drops trailers/ from the app build), so the
//   site's copies, https://hundredstories.xyz/trailers/..., which the site serves in byte ranges.
// - tauri: its content policy refuses media from anywhere else, so the menu entry opens the site's
//   Clips page in the system browser instead, the way How to play does (panels.ts).
//
// A player that cannot play (an error, a stall with nothing loaded, or no connection) is swapped
// for one plain line and a Try again button; the other clips are left as they are. The line says
// the clip needs a connection when the device is offline or the network failed, and only that it
// could not play otherwise (a missing file, a file the browser cannot read). Nothing is written to
// the console. The clips have no sound, and nothing here says they do.
//
// Keys and the controller: each player is in the Tab order (tabindex 0, which the menus' focus
// helper counts), so Tab, the arrow keys and the d-pad reach it; Enter, Space and the
// controller's A play or pause it (toggleClip), and Left and Right stay the player's own.

import { savePlatform, type SavePlatform } from '../game/storage';
import { icon } from './icons';

export interface Clip {
  /** The file name under trailers/, without its extension. */
  name: string;
  /** The title, as the site's Clips page has it. */
  title: string;
}

/** The site's Clips page, in its order: the trailer, then the three short clips. */
export const CLIPS: readonly Clip[] = [
  { name: 'site-intro', title: 'The trailer' },
  { name: 'elevator-vs-stairs', title: 'The elevator is out' },
  { name: 'the-backlog', title: 'The backlog' },
  { name: 'the-wait', title: 'The wait' },
];

/** The site, for the app shells that carry no copy of the clips. */
export const SITE_ORIGIN = 'https://hundredstories.xyz';
/** The site's Clips page, opened in the system browser where the game cannot play the clips. */
export const CLIPS_URL = `${SITE_ORIGIN}/clips/`;

/** The line in place of a player that could not play: offline, or the network failed. */
export const CLIP_OFFLINE_TEXT = 'This clip needs a connection.';
/** The line in place of a player that could not play for any other reason. */
export const CLIP_FAILED_TEXT = 'This clip could not play.';
export const CLIP_RETRY = 'Try again';
/** The page's title, and the menu entry's word. */
export const CLIPS_TITLE = 'Clips';

/** A press with no picture this long after it counts as a stall. */
export const CLIP_STALL_MS = 15_000;

/** Where a clip's video and poster are, for this platform. */
export function clipSources(clip: Clip, platform: SavePlatform = savePlatform()): { video: string; poster: string } {
  const base = platform === 'capacitor' ? `${SITE_ORIGIN}/trailers/` : '/trailers/';
  return { video: `${base}${clip.name}.mp4`, poster: `${base}${clip.name}.webp` };
}

/** In the desktop shell the clips open outside the game, on the site, in the system browser. */
export function clipsOpenOutside(platform: SavePlatform = savePlatform()): boolean {
  return platform === 'tauri';
}

/** Open the site's Clips page in the system browser (a new window the shell hands over). */
export function openClipsOutside(): void {
  const win = (globalThis as { window?: { open?: (url: string, target: string) => unknown } }).window;
  win?.open?.(CLIPS_URL, '_blank');
}

export interface ClipsBody {
  node: HTMLElement;
  /** Pause everything and let the files go. Safe to call twice. */
  dispose(): void;
}

export interface ClipsBodyOptions {
  platform?: SavePlatform;
  /** False when the device says it is offline. Default: navigator.onLine. */
  online?: () => boolean;
}

/** The media calls a player answers, each optional so a test's tree can stand in. */
interface Player {
  pause?(): void;
  play?(): Promise<void> | void;
  load?(): void;
  readyState?: number;
  paused?: boolean;
  error?: { code?: number } | null;
}

/** MediaError.MEDIA_ERR_NETWORK: the file stopped coming. */
const MEDIA_ERR_NETWORK = 2;

/**
 * Enter, Space or the controller's A on a clip: play it, or pause it while it plays. True when
 * `target` is one of the clips' players (and the key is spent), false for anything else.
 */
export function toggleClip(target: unknown): boolean {
  const node = target as (Player & { tagName?: string; classList?: { contains(name: string): boolean } }) | null;
  if (!node || String(node.tagName ?? '').toUpperCase() !== 'VIDEO' || !node.classList?.contains('hs-clip-video')) return false;
  if (node.paused === false) {
    node.pause?.();
    return true;
  }
  // A refused start (no file, no connection) shows on the player's own error; nothing to say here.
  const started = node.play?.();
  if (started && typeof (started as Promise<void>).catch === 'function') (started as Promise<void>).catch(() => {});
  return true;
}

function defaultOnline(): boolean {
  const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
  return nav?.onLine !== false;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The list of clips: a title over each player. */
export function clipsBody(options: ClipsBodyOptions = {}): ClipsBody {
  const platform = options.platform ?? savePlatform();
  const online = options.online ?? defaultOnline;
  const root = el('div', 'hs-clips');
  let disposed = false;

  interface Slot {
    clip: Clip;
    frame: HTMLElement;
    video: HTMLVideoElement | null;
    timer: ReturnType<typeof setTimeout> | null;
    off: (() => void) | null;
    /** Try again, while the line stands in the player's place. */
    retry: HTMLElement | null;
  }
  const slots: Slot[] = [];

  const clearTimer = (slot: Slot): void => {
    if (slot.timer !== null) clearTimeout(slot.timer);
    slot.timer = null;
  };

  /** Let a player go: paused, its file dropped, its listeners off. */
  function release(slot: Slot): void {
    clearTimer(slot);
    slot.off?.();
    slot.off = null;
    const video = slot.video as (HTMLVideoElement & Player) | null;
    if (!video) return;
    video.pause?.();
    video.removeAttribute('src');
    video.load?.();
    slot.video = null;
  }

  /** The line and Try again, in the player's place: `network` when the connection is to blame. */
  function fail(slot: Slot, network: boolean): void {
    if (disposed) return;
    release(slot);
    const line = el('p', 'hs-clip-line', network || !online() ? CLIP_OFFLINE_TEXT : CLIP_FAILED_TEXT);
    const retry = el('button', 'hs-face hs-clip-retry');
    retry.type = 'button';
    retry.append(icon('reload', 'hs-icon hs-face-icon') as unknown as HTMLElement, el('span', 'hs-face-word', CLIP_RETRY));
    retry.addEventListener('click', () => {
      if (disposed) return;
      play(slot);
      // Focus stays in the slot: on the player, or on the new Try again when it is still offline.
      const next = (slot.video ?? slot.retry) as HTMLElement | null;
      next?.focus?.({ preventScroll: true });
    });
    slot.retry = retry;
    const box = el('div', 'hs-clip-failed');
    box.append(line, retry);
    slot.frame.replaceChildren(box);
    slot.frame.classList.add('is-failed');
  }

  /** A player in the slot, or the line when the device is offline. */
  function play(slot: Slot): void {
    if (!online()) {
      fail(slot, true);
      return;
    }
    slot.frame.classList.remove('is-failed');
    slot.retry = null;
    const { video: src, poster } = clipSources(slot.clip, platform);
    const video = el('video', 'hs-clip-video');
    video.setAttribute('controls', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('preload', 'none');
    video.setAttribute('poster', poster);
    video.setAttribute('src', src);
    video.setAttribute('aria-label', slot.clip.title);
    // In the Tab order, so the keys and the d-pad reach it (focusablesIn counts tabindex).
    video.setAttribute('tabindex', '0');
    const player = video as HTMLVideoElement & Player;
    // The browser's error says whether the file stopped coming (the network) or could not be read.
    const failNow = (): void => fail(slot, player.error?.code === MEDIA_ERR_NETWORK);
    const onPlay = (): void => {
      // One at a time: starting this one pauses every other.
      for (const other of slots) if (other !== slot) (other.video as (HTMLVideoElement & Player) | null)?.pause?.();
      if (!online()) {
        fail(slot, true);
        return;
      }
      // A press that brings no picture in time is a stall: the connection, as far as anyone can tell.
      clearTimer(slot);
      slot.timer = setTimeout(() => {
        slot.timer = null;
        if ((player.readyState ?? 0) < 2) fail(slot, true);
      }, CLIP_STALL_MS);
    };
    const onData = (): void => clearTimer(slot);
    // The browser gave up fetching with nothing in hand.
    const onStalled = (): void => {
      if ((player.readyState ?? 0) === 0) fail(slot, true);
    };
    video.addEventListener('error', failNow);
    video.addEventListener('play', onPlay);
    video.addEventListener('loadeddata', onData);
    video.addEventListener('playing', onData);
    video.addEventListener('stalled', onStalled);
    slot.off = () => {
      video.removeEventListener('error', failNow);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('loadeddata', onData);
      video.removeEventListener('playing', onData);
      video.removeEventListener('stalled', onStalled);
    };
    slot.video = video;
    slot.frame.replaceChildren(video);
  }

  for (const clip of CLIPS) {
    const item = el('section', 'hs-clip');
    item.dataset['clip'] = clip.name;
    const title = el('h3', 'hs-clip-title', clip.title);
    const frame = el('div', 'hs-clip-frame');
    item.append(title, frame);
    root.append(item);
    const slot: Slot = { clip, frame, video: null, timer: null, off: null, retry: null };
    slots.push(slot);
    play(slot);
  }

  return {
    node: root,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const slot of slots) release(slot);
    },
  };
}
