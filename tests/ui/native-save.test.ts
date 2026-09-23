// The settings panel's Export and Import on each save platform: the browser download and file
// input, the desktop save and open dialogs, the phone share sheet. storage.ts picks the platform
// off the globals; the plugin calls are stubbed so no dialog or share sheet is loaded.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettingsPanel, type PanelContext } from '../../src/ui/panels';
import { FakeDom, type FakeElement } from './fake-dom';

const plugins = vi.hoisted(() => ({
  exportSaveWithDialog: vi.fn<(text: string) => Promise<boolean>>(),
  importSaveWithDialog: vi.fn<() => Promise<string | null>>(),
  shareSave: vi.fn<(text: string) => Promise<void>>(),
}));

vi.mock('../../src/game/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/game/storage')>()),
  ...plugins,
}));

const SAVE = '{"version":2}';
let dom: FakeDom;
let uninstall: () => void;
const g = globalThis as Record<string, unknown>;

beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
  plugins.exportSaveWithDialog.mockReset().mockResolvedValue(true);
  plugins.importSaveWithDialog.mockReset().mockResolvedValue(SAVE);
  plugins.shareSave.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  uninstall();
  delete g['__TAURI_INTERNALS__'];
  delete g['Capacitor'];
  vi.restoreAllMocks();
});

type ImportResult = { ok: true } | { ok: false; reason: string };

function setup(importResult: ImportResult = { ok: true }) {
  const notices: string[] = [];
  const imported: string[] = [];
  const game = {
    world: { seed: 1, log: [], logTotal: 0 },
    exportSave: () => SAVE,
    importSave: (text: string) => {
      imported.push(text);
      return importResult;
    },
  } as never;
  const ctx: PanelContext = {
    apply: () => ({ ok: true }) as never,
    notice: (text: string) => notices.push(text),
    close: () => {},
    reducedMotion: false,
    setReducedMotion: () => {},
  };
  const panel = createSettingsPanel(game, ctx) as unknown as FakeElement;
  const all = panel.descendants();
  const exportBtn = all.find((n) => n.tagName === 'BUTTON' && n.textContent === 'Export');
  const importCtl = all.find((n) => n.id === 'hs-import');
  if (!exportBtn || !importCtl) throw new Error('no export or import control');
  return { notices, imported, exportBtn, importCtl };
}

const fire = (target: FakeElement, type: string): void => {
  for (const fn of target.listeners.get(type) ?? []) fn({});
};
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('settings panel export and import by platform', () => {
  it('web export uses the download link and no native plugin', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:save');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const { notices, exportBtn, importCtl } = setup();
    fire(exportBtn, 'click');
    await settle();
    const link = dom.clicked[0] as FakeElement & { download?: string; href?: string };
    expect(link?.tagName).toBe('A');
    expect([link.download, link.href]).toEqual(['hundred-stories.json', 'blob:save']);
    expect(plugins.exportSaveWithDialog).not.toHaveBeenCalled();
    expect(plugins.shareSave).not.toHaveBeenCalled();
    expect(notices).toEqual(['Save exported.']);
    expect(importCtl.tagName).toBe('INPUT');
  });

  it('Tauri export calls the dialog export with the save', async () => {
    g['__TAURI_INTERNALS__'] = {};
    const { notices, exportBtn } = setup();
    fire(exportBtn, 'click');
    await settle();
    expect(plugins.exportSaveWithDialog).toHaveBeenCalledWith(SAVE);
    expect(plugins.shareSave).not.toHaveBeenCalled();
    expect(dom.clicked).toEqual([]);
    expect(notices).toEqual(['Save exported.']);
  });

  it('Capacitor export calls shareSave with the save and keeps the file input', async () => {
    g['Capacitor'] = { isNativePlatform: () => true };
    const { notices, exportBtn, importCtl } = setup();
    fire(exportBtn, 'click');
    await settle();
    expect(plugins.shareSave).toHaveBeenCalledWith(SAVE);
    expect(plugins.exportSaveWithDialog).not.toHaveBeenCalled();
    expect(dom.clicked).toEqual([]);
    expect(notices).toEqual(['Save exported.']);
    expect(importCtl.tagName).toBe('INPUT');
  });

  it('a dismissed share sheet shows no toast', async () => {
    g['Capacitor'] = { isNativePlatform: () => true };
    plugins.shareSave.mockRejectedValue(new Error('Share canceled'));
    const { notices, exportBtn } = setup();
    fire(exportBtn, 'click');
    await settle();
    expect(notices).toEqual([]);
  });

  it('Tauri import feeds the dialog text to importSave and says so', async () => {
    g['__TAURI_INTERNALS__'] = {};
    const { notices, imported, importCtl } = setup();
    expect(importCtl.tagName).toBe('BUTTON');
    fire(importCtl, 'click');
    await settle();
    expect(plugins.importSaveWithDialog).toHaveBeenCalledTimes(1);
    expect(imported).toEqual([SAVE]);
    expect(notices).toEqual(['Game imported.']);
  });

  it('a cancelled Tauri dialog (null) imports nothing and shows no toast', async () => {
    g['__TAURI_INTERNALS__'] = {};
    plugins.importSaveWithDialog.mockResolvedValue(null);
    plugins.exportSaveWithDialog.mockResolvedValue(false);
    const { notices, imported, importCtl, exportBtn } = setup();
    fire(importCtl, 'click');
    fire(exportBtn, 'click');
    await settle();
    expect(plugins.importSaveWithDialog).toHaveBeenCalledTimes(1);
    expect(imported).toEqual([]);
    expect(notices).toEqual([]);
  });

  it('a refused Tauri import shows the refusal reason', async () => {
    g['__TAURI_INTERNALS__'] = {};
    const { notices, importCtl } = setup({ ok: false, reason: 'That is not a Hundred Stories save.' });
    fire(importCtl, 'click');
    await settle();
    expect(notices).toEqual(['That is not a Hundred Stories save.']);
  });
});
