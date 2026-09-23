import { createRenderer } from './render/renderer';
import { createUi } from './ui/ui';
import { createGame } from './game/game';

export interface BootDeps {
  createRenderer: typeof createRenderer;
  createGame: typeof createGame;
  createUi: typeof createUi;
  createElement: (tag: string) => HTMLElement;
  online: () => boolean;
  hasController: () => boolean;
  search: () => string;
  /** True inside the iOS or Android shell, where the game ships in the app bundle. */
  native?: () => boolean;
}

const defaultDeps: BootDeps = {
  createRenderer,
  createGame,
  createUi,
  createElement: (tag: string) => document.createElement(tag),
  online: () => navigator.onLine,
  hasController: () => !!navigator.serviceWorker?.controller,
  search: () => location.search,
  // The Capacitor global the native bridge injects; read directly so the web bundle does not
  // import Capacitor (src/game/storage.ts asks the same question for the save backend).
  native: () => (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() === true,
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
}

if (!import.meta.env.TEST) {
  void boot(document.getElementById('app')!);
}
