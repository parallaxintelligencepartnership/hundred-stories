// The desktop (Tauri) save slot, the backend selection order, and export and import through the
// dialog plugin, driven with a stub Tauri global and a stub fs. The real plugins need the Tauri
// shell; these stand ins record the calls so the one-file, app-data-directory contract is pinned.
import { describe, expect, it, vi } from 'vitest';
import {
  createTauriStorage,
  exportSaveWithDialog,
  importSaveWithDialog,
  isTauri,
  selectStorage,
  EXPORT_FILE_NAME,
  FILE_SLOT_NAME,
  type FileSlotFs,
  type TauriDialog,
  type TauriSlotFs,
} from '../../src/game/storage';

type StubTauriFs = TauriSlotFs & { files: Map<string, string>; dirs: number; log: string[] };

/** An in memory app data directory; readTextFile rejects a missing file like the plugin does. */
function stubTauriFs(): StubTauriFs {
  const files = new Map<string, string>();
  const log: string[] = [];
  const fs: StubTauriFs = {
    files,
    dirs: 0,
    log,
    async ensureDir() {
      fs.dirs += 1;
      log.push('mkdir');
    },
    async writeTextFile(path, data) {
      log.push(`write ${path}`);
      files.set(path, data);
    },
    async readTextFile(path) {
      log.push(`read ${path}`);
      const data = files.get(path);
      if (data === undefined) throw new Error('No such file or directory (os error 2)');
      return data;
    },
    async rename(from, to) {
      log.push(`rename ${from} ${to}`);
      const data = files.get(from);
      if (data === undefined) throw new Error('missing');
      files.delete(from);
      files.set(to, data);
    },
  };
  return fs;
}

function capacitorFs(): FileSlotFs & { used: boolean } {
  const fs = {
    used: false,
    async writeFile() {
      fs.used = true;
      return {};
    },
    async readFile() {
      fs.used = true;
      return { data: 'capacitor' };
    },
  };
  return fs;
}

const nativeCapacitor = { Capacitor: { isNativePlatform: () => true } };

describe('isTauri', () => {
  it('is true when the __TAURI__ global or the Tauri internals global exists', () => {
    expect(isTauri({ __TAURI__: {} })).toBe(true);
    expect(isTauri({ __TAURI_INTERNALS__: {} })).toBe(true);
    expect(isTauri({})).toBe(false);
    expect(isTauri(nativeCapacitor)).toBe(false);
  });

  it('reads the real global by default, which in node has no Tauri', () => {
    expect(isTauri()).toBe(false);
  });
});

describe('selectStorage order: Tauri, then Capacitor, then the browser', () => {
  it('picks the Tauri slot inside the desktop shell', async () => {
    const fs = stubTauriFs();
    const slot = selectStorage({ global: { __TAURI_INTERNALS__: {} }, loadTauriFs: async () => fs });
    await slot.writeSave('{"version":1}');
    expect(fs.files.get(FILE_SLOT_NAME)).toBe('{"version":1}');
    expect(await slot.readSave()).toBe('{"version":1}');
  });

  it('checks Tauri before Capacitor, and never loads the Capacitor plugin in Tauri', async () => {
    const tauri = stubTauriFs();
    const cap = capacitorFs();
    const loadFs = vi.fn(async () => cap);
    const slot = selectStorage({ global: { __TAURI__: {}, ...nativeCapacitor }, loadTauriFs: async () => tauri, loadFs });
    await slot.writeSave('desktop');
    expect(tauri.files.get(FILE_SLOT_NAME)).toBe('desktop');
    expect(loadFs).not.toHaveBeenCalled();
    expect(cap.used).toBe(false);
  });

  it('keeps the Capacitor slot on a phone and never loads the Tauri fs', async () => {
    const loadTauriFs = vi.fn(async () => stubTauriFs());
    const cap = capacitorFs();
    const slot = selectStorage({ global: nativeCapacitor, loadTauriFs, loadFs: async () => cap });
    expect(await slot.readSave()).toBe('capacitor');
    expect(loadTauriFs).not.toHaveBeenCalled();
  });

  it('keeps the browser slot on the web and loads neither plugin', async () => {
    const loadTauriFs = vi.fn(async () => stubTauriFs());
    const loadFs = vi.fn(async () => capacitorFs());
    const slot = selectStorage({ global: {}, loadTauriFs, loadFs });
    await expect(slot.writeSave('x')).rejects.toThrow('The browser refused to store the save.');
    expect(loadTauriFs).not.toHaveBeenCalled();
    expect(loadFs).not.toHaveBeenCalled();
  });
});

describe('the Tauri slot', () => {
  it('writes autosave.json in the app data directory through a temporary file and a rename', async () => {
    const fs = stubTauriFs();
    const slot = createTauriStorage(fs);
    const text = JSON.stringify({ version: 9, tower: 'x'.repeat(4096) });
    await slot.writeSave(text);
    expect(await slot.readSave()).toBe(text);
    expect([...fs.files.keys()]).toEqual([FILE_SLOT_NAME]);
    expect(fs.log).toEqual(['mkdir', `write ${FILE_SLOT_NAME}.tmp`, `rename ${FILE_SLOT_NAME}.tmp ${FILE_SLOT_NAME}`, `read ${FILE_SLOT_NAME}`]);
  });

  it('keeps the newest save only, and makes the directory once', async () => {
    const fs = stubTauriFs();
    const slot = createTauriStorage(fs);
    await slot.writeSave('first');
    await slot.writeSave('second');
    expect(await slot.readSave()).toBe('second');
    expect(fs.dirs).toBe(1);
  });

  it('reads null on first launch, when the file does not exist', async () => {
    expect(await createTauriStorage(stubTauriFs()).readSave()).toBeNull();
  });

  it('accepts the fs as a promise, the way boot loads it lazily', async () => {
    const slot = createTauriStorage(Promise.resolve(stubTauriFs()));
    await slot.writeSave('lazy');
    expect(await slot.readSave()).toBe('lazy');
  });

  it('refuses in plain English when the disk refuses, and leaves the last good save alone', async () => {
    const fs = stubTauriFs();
    const slot = createTauriStorage(fs);
    await slot.writeSave('good');
    fs.writeTextFile = async () => {
      throw new Error('ENOSPC');
    };
    await expect(slot.writeSave('new')).rejects.toThrow('The device refused to store the save.');
    expect(await slot.readSave()).toBe('good');
  });
});

describe('export and import through the dialog plugin', () => {
  function stubDialog(pick: string | null): TauriDialog & { asked: unknown[] } {
    const asked: unknown[] = [];
    return {
      asked,
      async save(options) {
        asked.push(['save', options]);
        return pick;
      },
      async open(options) {
        asked.push(['open', options]);
        return pick;
      },
    };
  }

  it('exports to the path the save dialog returns, offering hundred-stories.json', async () => {
    const fs = stubTauriFs();
    const dialog = stubDialog('/Users/p/Desktop/tower.json');
    expect(await exportSaveWithDialog('{"version":1}', { fs, dialog })).toBe(true);
    expect(fs.files.get('/Users/p/Desktop/tower.json')).toBe('{"version":1}');
    expect(dialog.asked[0]).toEqual(['save', expect.objectContaining({ defaultPath: EXPORT_FILE_NAME })]);
  });

  it('writes nothing when the player cancels the save dialog', async () => {
    const fs = stubTauriFs();
    expect(await exportSaveWithDialog('x', { fs, dialog: stubDialog(null) })).toBe(false);
    expect(fs.files.size).toBe(0);
  });

  it('imports the text of the file the open dialog returns, and null on cancel', async () => {
    const fs = stubTauriFs();
    fs.files.set('/Users/p/tower.json', '{"version":2}');
    expect(await importSaveWithDialog({ fs, dialog: stubDialog('/Users/p/tower.json') })).toBe('{"version":2}');
    expect(await importSaveWithDialog({ fs, dialog: stubDialog(null) })).toBeNull();
  });
});
