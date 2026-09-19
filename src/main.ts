import { createRenderer } from './render/renderer';
import { createUi } from './ui/ui';
import { createGame } from './game/game';

async function boot(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) throw new Error('Missing #app');
  if (new URLSearchParams(location.search).has('smoke')) {
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

  const seed = Number(new URLSearchParams(location.search).get('seed')) || Math.floor(Date.now() % 1_000_000);
  const game = createGame(seed);
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
