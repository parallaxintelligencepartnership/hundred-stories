// The boot sequence, driven through injected deps so it runs in node: no real DOM, no
// real network, no real renderer. See src/main.ts for the browser wiring these deps stand in for.
import { describe, expect, it, vi } from 'vitest';
import { boot, inShell, type BootDeps } from '../../src/main';
import { createGame } from '../../src/game/game';

vi.mock('../../src/game/storage', () => ({
  writeSave: async (): Promise<void> => {},
  readSave: async (): Promise<string | null> => null,
}));

/** A host element in the pointer.test.ts style: just enough of the DOM shape to inspect. */
function fakeApp(): HTMLElement & { children: HTMLElement[] } {
  const children: HTMLElement[] = [];
  const el = {
    children,
    get innerHTML() {
      return '';
    },
    set innerHTML(_v: string) {
      children.length = 0;
    },
    textContent: null as string | null,
    append(...nodes: HTMLElement[]) {
      children.push(...nodes);
    },
    querySelector(sel: string) {
      const id = sel.replace('#', '');
      return children.find((c) => c.id === id) ?? null;
    },
  };
  return el as unknown as HTMLElement & { children: HTMLElement[] };
}

function fakeElement(): HTMLElement {
  return { id: '', textContent: null } as unknown as HTMLElement;
}

function baseDeps(overrides: Partial<BootDeps> = {}): BootDeps {
  return {
    createRenderer: async () => ({}) as never,
    createGame,
    createUi: (() => ({ update: () => {} })) as never,
    createElement: () => fakeElement(),
    online: () => true,
    hasController: () => false,
    search: () => '',
    ...overrides,
  };
}

describe('boot', () => {
  it('shows the WebGL message and leaves app non-blank when the renderer rejects', async () => {
    const app = fakeApp();
    await boot(
      app,
      baseDeps({
        createRenderer: async () => {
          throw new Error('no webgl in this browser');
        },
      }),
    );
    const view = (app as unknown as { querySelector(s: string): HTMLElement | null }).querySelector('#view');
    expect(view?.textContent).toBe('This browser cannot draw the tower. It needs WebGL, which is turned off or missing here.');
    expect(app.children.length).toBeGreaterThan(0);
  });

  it('shows a security-policy message (not the WebGL message) when the renderer rejects with a CSP unsafe-eval error', async () => {
    const app = fakeApp();
    await boot(
      app,
      baseDeps({
        createRenderer: async () => {
          throw new Error('Current environment does not allow unsafe-eval, please use pixi.js/unsafe-eval module');
        },
      }),
    );
    const view = (app as unknown as { querySelector(s: string): HTMLElement | null }).querySelector('#view');
    expect(view?.textContent).toBe(
      'Something on our site stopped the tower from loading. It is our mistake, not your browser. Please try again later.',
    );
    expect(view?.textContent).not.toBe('This browser cannot draw the tower. It needs WebGL, which is turned off or missing here.');
  });

  it('one notify is one ui update: boot leaves the subscription to the ui', async () => {
    const subscribers = new Set<() => void>();
    const notify = (): void => subscribers.forEach((cb) => cb());
    const game = {
      world: { log: [], time: { minute: 0 } },
      load: async () => ({ ok: false, reason: 'none' }),
      attach: () => {},
      start: () => {},
      subscribe(cb: () => void) {
        subscribers.add(cb);
        return () => subscribers.delete(cb);
      },
    };
    let updates = 0;
    await boot(
      fakeApp(),
      baseDeps({
        createGame: (() => game) as never,
        // Stands in for the real createUi, which subscribes its own update() once.
        createUi: ((_root: HTMLElement, g: typeof game) => {
          const update = (): void => {
            updates += 1;
          };
          g.subscribe(update);
          return { update, destroy: () => {} };
        }) as never,
      }),
    );
    updates = 0;
    notify();
    expect(updates).toBe(1);
  });

  it('shows the offline first-load message when offline with no service worker controller', async () => {
    const app = fakeApp();
    await boot(app, baseDeps({ online: () => false, hasController: () => false }));
    expect(app.textContent).toBe('Hundred Stories needs to load once while you are online. After that it works offline.');
  });

  it('boots offline in the native shell, which serves the game from the app bundle and has no service worker', async () => {
    const app = fakeApp();
    let rendererAsked = false;
    const deps = baseDeps({
      online: () => false,
      hasController: () => false,
      native: () => true,
      // Stops boot at the renderer: reaching it proves the offline gate let the shell through.
      createRenderer: async () => {
        rendererAsked = true;
        throw new Error('stop here');
      },
    });
    await boot(app, deps);
    expect(app.textContent).not.toBe('Hundred Stories needs to load once while you are online. After that it works offline.');
    expect(rendererAsked).toBe(true);
    expect((app as unknown as { querySelector(s: string): HTMLElement | null }).querySelector('#view')).not.toBeNull();
  });

  it('counts the Tauri desktop shell as a shell for the offline gate, beside Capacitor', () => {
    expect(inShell({ __TAURI_INTERNALS__: {} })).toBe(true);
    expect(inShell({ __TAURI__: {} })).toBe(true);
    expect(inShell({ Capacitor: { isNativePlatform: () => true } })).toBe(true);
    expect(inShell({ Capacitor: { isNativePlatform: () => false } })).toBe(false);
    expect(inShell({})).toBe(false);
  });

  it('hands the running game to the Steam hook once, after it starts', async () => {
    const order: string[] = [];
    const game = {
      world: { log: [], time: { minute: 0 } },
      load: async () => ({ ok: false, reason: 'none' }),
      attach: () => {},
      start: () => order.push('start'),
    };
    const seen: unknown[] = [];
    await boot(
      fakeApp(),
      baseDeps({
        createGame: (() => game) as never,
        createSteam: (g) => {
          order.push('steam');
          seen.push(g);
        },
      }),
    );
    expect(seen).toEqual([game]);
    expect(order).toEqual(['start', 'steam']);
  });
});
