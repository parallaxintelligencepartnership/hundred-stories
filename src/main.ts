import { createRenderer } from './render/renderer';
import { createUi } from './ui/ui';
import { createGame } from './game/game';
import { createSteam } from './steam/steam';
import { parseWeatherQuery, setForcedWeather } from './render/weather';
import { MAX_START } from './share/share';

export interface BootDeps {
  createRenderer: typeof createRenderer;
  createGame: typeof createGame;
  createUi: typeof createUi;
  createElement: (tag: string) => HTMLElement;
  online: () => boolean;
  hasController: () => boolean;
  search: () => string;
  /** True inside the iOS, Android or desktop shell, where the game ships in the app bundle. */
  native?: () => boolean;
  /** Steam achievements; inert outside the Tauri desktop shell. Called once the game runs. */
  createSteam?: (game: ReturnType<typeof createGame>) => unknown;
}

// The globals the shells inject before the page loads, read directly so the web bundle imports
// neither Capacitor nor Tauri (src/game/storage.ts asks the same questions for the save backend).
export function inShell(global: object = globalThis): boolean {
  const g = global as { Capacitor?: { isNativePlatform?: () => boolean }; __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown };
  return g.__TAURI__ != null || g.__TAURI_INTERNALS__ != null || g.Capacitor?.isNativePlatform?.() === true;
}

/**
 * The capture path, dev only like ?smoke: ?weather=clear|overcast|rain|storm pins the weather
 * the renderer and the status bar show, and ?hour=0..23 moves the clock forward to that hour.
 * `dev` is import.meta.env.DEV at the call; with it false nothing is read and nothing changes.
 */
export function applyDevWeather(search: string, dev: boolean, world: { time: { minute: number } }): boolean {
  if (!dev) return false;
  const { kind, hour } = parseWeatherQuery(search);
  if (kind !== null) setForcedWeather({ kind, from: kind, blend: 1, intensity: 0.85 });
  if (hour !== null) {
    const now = world.time.minute;
    let minute = Math.floor(now / 1440) * 1440 + hour * 60;
    if (minute < now) minute += 1440;
    world.time.minute = minute;
  }
  return kind !== null || hour !== null;
}

/** The dev listening module's surface; a type only, so production imports nothing. */
type DevAudio = Pick<typeof import('./audio/presets'), 'armDevAudio'>;

/**
 * The listening path, dev only like ?smoke: ?audio=<preset> turns sound on for this load without
 * saving it, pins the preset, and music starts on the first pointer or key press; with
 * &render=<seconds> it renders offline to window.__audioSample instead. Unknown presets are
 * ignored. `dev` is import.meta.env.DEV at the call; with it false nothing is read or loaded.
 */
export async function applyDevAudio(search: string, dev: boolean, load: () => Promise<DevAudio>): Promise<boolean> {
  if (!dev) return false;
  const params = new URLSearchParams(search);
  const name = params.get('audio');
  if (name === null) return false;
  const { armDevAudio } = await load();
  return armDevAudio(name, params.get('render'));
}

/**
 * Which tower the page address asks for. `?daily` (any value: `today`, or the date a friend
 * shared) is today's tower in its own slot. `?seed=N` is a friend's link: the same tower they
 * started, in the Friend's tower slot, never over My tower. Anything else is My tower, fresh
 * with `?new`. The number can sit in the address; the player never sees it.
 */
export type BootTarget = { kind: 'daily' } | { kind: 'friend'; seed: number } | { kind: 'mine'; fresh: boolean };

export function bootTarget(search: string): BootTarget {
  const params = new URLSearchParams(search);
  if (params.has('daily')) return { kind: 'daily' };
  // The same range a share link's tower number may carry (src/share/share.ts): plain digits up
  // to the 32 bit rng state. Past it the number wraps onto another tower, so it is refused.
  const seedParam = params.get('seed');
  if (seedParam !== null && /^\d+$/.test(seedParam)) {
    const seed = Number(seedParam);
    if (Number.isSafeInteger(seed) && seed <= MAX_START) return { kind: 'friend', seed };
  }
  return { kind: 'mine', fresh: params.has('new') };
}

const defaultDeps: BootDeps = {
  createRenderer,
  createGame,
  createUi,
  createElement: (tag: string) => document.createElement(tag),
  online: () => navigator.onLine,
  hasController: () => !!navigator.serviceWorker?.controller,
  search: () => location.search,
  native: () => inShell(),
  createSteam,
};

export async function boot(app: HTMLElement, deps: BootDeps = defaultDeps): Promise<void> {
  if (import.meta.env.DEV && new URLSearchParams(deps.search()).has('smoke')) {
    const { bootSmoke } = await import('./render/smoke');
    await bootSmoke();
    return;
  }
  app.innerHTML = '';
  // The shells serve the game from the app bundle, so offline is fine without a service worker.
  if (!deps.native?.() && !deps.online() && !deps.hasController()) {
    app.textContent = 'Hundred Stories needs to load once while you are online. After that it works offline.';
    return;
  }
  const view = deps.createElement('div');
  view.id = 'view';
  const uiRoot = deps.createElement('div');
  uiRoot.id = 'ui';
  app.append(view, uiRoot);

  const target = bootTarget(deps.search());
  const game = deps.createGame(target.kind === 'friend' ? target.seed : Math.floor(Date.now() % 1_000_000));
  if (target.kind === 'daily') await game.openDaily();
  else if (target.kind === 'friend') await game.openFriend(target.seed);
  else if (!target.fresh) {
    // Resume My tower unless the player asked for a fresh one with ?new.
    const resumed = await game.load();
    if (resumed.ok) game.world.log.push({ minute: game.world.time.minute, text: 'Welcome back. Your tower is just as it was when it last saved.', level: 'info' });
  }
  applyDevWeather(deps.search(), import.meta.env.DEV, game.world);
  if (import.meta.env.DEV) await applyDevAudio(deps.search(), import.meta.env.DEV, () => import('./audio/presets'));
  let renderer;
  try {
    renderer = await deps.createRenderer(view, game.world);
  } catch (e) {
    const message = String((e as { message?: unknown })?.message ?? e);
    view.textContent = message.includes('unsafe-eval')
      ? 'Something on our site stopped the tower from loading. It is our mistake, not your browser. Please try again later.'
      : 'This browser cannot draw the tower. It needs WebGL, which is turned off or missing here.';
    console.error(e);
    return;
  }
  game.attach(renderer, view);
  // The ui subscribes its own update() to the game and drops it on destroy, so boot adds
  // no second subscription: one notify is one HUD refresh.
  deps.createUi(uiRoot, game, renderer);
  game.start();
  deps.createSteam?.(game);
}

if (!import.meta.env.TEST) {
  void boot(document.getElementById('app')!);
}
