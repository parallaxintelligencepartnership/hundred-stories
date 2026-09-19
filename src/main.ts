import { createRenderer } from './render/renderer';
import { createUi } from './ui/ui';
import { createGame } from './game/game';

async function boot(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) throw new Error('Missing #app');
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('smoke')) {
    const { bootSmoke } = await import('./render/smoke');
    await bootSmoke();
    return;
  }
  app.innerHTML = '';
  const view = document.createElement('div');
  view.id = 'view';
  const uiRoot = document.createElement('div');
  uiRoot.id = 'ui';
  app.append(view, uiRoot);

  const params = new URLSearchParams(location.search);
  const seed = Number(params.get('seed')) || Math.floor(Date.now() % 1_000_000);
  const game = createGame(seed);
  // Resume the autosave unless the player asked for a fresh tower with ?new. The seed only applies to new games.
  if (!params.has('new')) {
    const resumed = await game.load();
    if (resumed.ok) game.world.log.push({ minute: game.world.time.minute, text: 'Welcome back. Your tower was restored from the last autosave.', level: 'info' });
  }
  let renderer;
  try {
    renderer = await createRenderer(view, game.world);
  } catch (e) {
    view.textContent = 'This browser cannot draw the tower. WebGL is required.';
    console.error(e);
    return;
  }
  game.attach(renderer, view);
  const ui = createUi(uiRoot, game);
  game.subscribe(() => ui.update());
  game.start();
}

void boot();
