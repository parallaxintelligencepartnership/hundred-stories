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
}

const defaultDeps: BootDeps = {
  createRenderer,
  createGame,
  createUi,
  createElement: (tag: string) => document.createElement(tag),
  online: () => navigator.onLine,
  hasController: () => !!navigator.serviceWorker?.controller,
  search: () => location.search,
};

export async function boot(app: HTMLElement, deps: BootDeps = defaultDeps): Promise<void> {
  if (import.meta.env.DEV && new URLSearchParams(deps.search()).has('smoke')) {
    const { bootSmoke } = await import('./render/smoke');
    await bootSmoke();
    return;
  }
  app.innerHTML = '';
  if (!deps.online() && !deps.hasController()) {
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
    view.textContent = 'This browser cannot draw the tower. WebGL is required.';
    console.error(e);
    return;
  }
  game.attach(renderer, view);
  const ui = deps.createUi(uiRoot, game);
  game.subscribe(() => ui.update());
  game.start();
}

if (!import.meta.env.TEST) {
  void boot(document.getElementById('app')!);
}
