import { createRenderer } from './render/renderer';
import { createUi } from './ui/ui';
import { createGame } from './game/game';
import { createSteam } from './steam/steam';
import { parseWeatherQuery, setForcedWeather } from './render/weather';

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
    app.textContent = 'Hundred Stories needs one online load before it can play offline.';
    return;
  }
  const view = deps.createElement('div');
  view.id = 'view';
  const uiRoot = deps.createElement('div');
  uiRoot.id = 'ui';
  app.append(view, uiRoot);

  const params = new URLSearchParams(deps.search());
  const seedParam = params.get('seed');
  const seed = seedParam !== null && Number.isFinite(Number(seedParam)) ? Number(seedParam) : Math.floor(Date.now() % 1_000_000);
  const game = deps.createGame(seed);
  // Resume the autosave unless the player asked for a fresh tower with ?new. The seed only applies to new games.
  if (!params.has('new')) {
    const resumed = await game.load();
    if (resumed.ok) game.world.log.push({ minute: game.world.time.minute, text: 'Welcome back. Your tower was restored from the last autosave.', level: 'info' });
  }
  applyDevWeather(deps.search(), import.meta.env.DEV, game.world);
  let renderer;
  try {
    renderer = await deps.createRenderer(view, game.world);
  } catch (e) {
    const message = String((e as { message?: unknown })?.message ?? e);
    view.textContent = message.includes('unsafe-eval')
      ? "The page's security policy blocked the tower renderer. This is a site bug, not your browser. Please reload later."
      : 'This browser cannot draw the tower. WebGL is required.';
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
