// The kept copy of a later-dated Today's tower (checkpoint 2026-09-25): "Start today's tower
// instead" promises "We keep a copy of it first", and the daily card is where that copy comes
// back out, byte for byte, through the same export path as Save to a file. The desktop dialog is
// stubbed so no plugin is loaded; the game, the browser slots and the card are the real ones.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../../src/game/game';
import { createDailyPanel, SAVE_KEPT_DAILY, type DailyPanelActions } from '../../src/ui/daily';
import type { PanelContext } from '../../src/ui/panels';
import { FakeDom, type FakeElement } from './fake-dom';

const plugins = vi.hoisted(() => ({
  exportSaveWithDialog: vi.fn<(text: string) => Promise<boolean>>(),
}));

vi.mock('../../src/game/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/game/storage')>()),
  ...plugins,
}));

const g = globalThis as Record<string, unknown>;
let uninstall: () => void;
let data: Map<string, string>;

beforeEach(() => {
  uninstall = new FakeDom().install();
  data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    get length(): number {
      return data.size;
    },
    clear: (): void => data.clear(),
    getItem: (key: string): string | null => data.get(key) ?? null,
    key: (index: number): string | null => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string): void => {
      data.delete(key);
    },
    setItem: (key: string, value: string): void => {
      data.set(key, value);
    },
  } as Storage);
  plugins.exportSaveWithDialog.mockReset().mockResolvedValue(true);
});
afterEach(() => {
  uninstall();
  delete g['__TAURI_INTERNALS__'];
  vi.unstubAllGlobals();
});

const task = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
async function settle(n = 5): Promise<void> {
  for (let i = 0; i < n; i++) await task();
}

function gameOn(today: string) {
  return createGame(11, {
    now: () => 0,
    hidden: () => true,
    scheduleIdle: (run) => {
      run();
      return () => {};
    },
    today: () => today,
    freshSeed: () => 77,
  });
}

const ctx: PanelContext = { apply: () => ({ ok: true }) as never, notice: () => {}, close: () => {}, reducedMotion: false, setReducedMotion: () => {} };
const actions: DailyPanelActions = { share: () => {}, myTower: () => {}, choose: () => {}, startToday: () => {} };

function keptButton(game: ReturnType<typeof createGame>, today: string): FakeElement | undefined {
  const panel = createDailyPanel(game, ctx, actions, today) as unknown as FakeElement;
  return panel.descendants().find((n) => n.tagName === 'BUTTON' && n.textContent === SAVE_KEPT_DAILY);
}

describe("the kept copy of a later-dated Today's tower", () => {
  it('comes back out of the daily card as the same bytes, and stays across a reload', async () => {
    const later = gameOn('2026-09-25');
    await later.openDaily();
    later.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    await later.save();
    const stored = data.get('hundred-stories:daily')!;
    expect(stored).toBeTruthy();

    const game = gameOn('2026-09-24');
    await game.openDaily();
    await settle();
    expect(game.getDailyChoice()?.ahead).toBe(true);
    expect(keptButton(game, '2026-09-24')).toBeUndefined(); // nothing kept yet

    await game.chooseDaily('today');
    expect(game.getDaily()?.date).toBe('2026-09-24');
    expect(game.getKeptDailyCopy()).toBe(stored);

    const found = keptButton(game, '2026-09-24');
    expect(found).toBeDefined();
    // The desktop shell for the export only: the slots were picked (the browser ones) on first use.
    g['__TAURI_INTERNALS__'] = {};
    for (const fn of found!.listeners.get('click') ?? []) fn({} as never);
    await settle();
    expect(plugins.exportSaveWithDialog).toHaveBeenCalledTimes(1);
    expect(plugins.exportSaveWithDialog).toHaveBeenCalledWith(stored);

    delete g['__TAURI_INTERNALS__'];

    // A reload: the copy is still there until the next replacement.
    const reloaded = gameOn('2026-09-24');
    await reloaded.openDaily();
    await settle();
    expect(reloaded.getKeptDailyCopy()).toBe(stored);
    expect(keptButton(reloaded, '2026-09-24')).toBeDefined();
  });
});
