// The native save slot and the backend selection, driven with a stub Capacitor global and a
// stub Filesystem. The real plugin needs an iOS or Android shell; these stand ins record the
// calls the slot makes so the one-file, app-data-directory contract is pinned.
import { describe, expect, it } from 'vitest';
import { createFileStorage, isNativePlatform, selectStorage, shareSave, FILE_SLOT_NAME, EXPORT_FILE_NAME, type FileSlotFs } from '../../src/game/storage';

interface Call {
  op: 'write' | 'read' | 'list' | 'rename' | 'delete';
  path: string;
  directory: string;
  encoding?: string;
}

type StubFs = FileSlotFs & {
  files: Map<string, string>;
  calls: Call[];
  writeFile(options: { path: string; data: string; directory: string; encoding: string }): Promise<{ uri: string }>;
};

/** The plugin's missing-file error on iOS and Android. */
const missing = (path: string) => Object.assign(new Error(`file at '${path}' does not exist.`), { code: 'OS-PLUG-FILE-0008' });

/** An in memory Filesystem keyed by directory and path; a missing file rejects like the plugin does. */
function stubFs(): StubFs {
  const files = new Map<string, string>();
  const calls: Call[] = [];
  return {
    async readdir({ path, directory }) {
      calls.push({ op: 'list', path, directory });
      const prefix = `${directory}/${path}`;
      return { files: [...files.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ name: k.slice(prefix.length), type: 'file' })) };
    },
    async rename({ from, to, directory, toDirectory }) {
      calls.push({ op: 'rename', path: `${from} -> ${to}`, directory });
      const data = files.get(`${directory}/${from}`);
      if (data === undefined) throw missing(from);
      files.delete(`${directory}/${from}`);
      files.set(`${toDirectory}/${to}`, data);
    },
    async deleteFile({ path, directory }) {
      calls.push({ op: 'delete', path, directory });
      if (!files.delete(`${directory}/${path}`)) throw missing(path);
    },
    files,
    calls,
    async writeFile({ path, data, directory, encoding }) {
      calls.push({ op: 'write', path, directory, encoding });
      files.set(`${directory}/${path}`, data);
      return { uri: `file:///${directory}/${path}` };
    },
    async readFile({ path, directory, encoding }) {
      calls.push({ op: 'read', path, directory, encoding });
      const data = files.get(`${directory}/${path}`);
      if (data === undefined) throw new Error('File does not exist.');
      return { data };
    },
  };
}

const nativeGlobal = { Capacitor: { isNativePlatform: () => true } };
const webGlobal = { Capacitor: { isNativePlatform: () => false } };

describe('isNativePlatform', () => {
  it('is true only when the Capacitor global says so', () => {
    expect(isNativePlatform(nativeGlobal)).toBe(true);
    expect(isNativePlatform(webGlobal)).toBe(false);
    expect(isNativePlatform({})).toBe(false);
    expect(isNativePlatform({ Capacitor: {} })).toBe(false);
  });

  it('reads the real global by default, which in node has no Capacitor', () => {
    expect(isNativePlatform()).toBe(false);
  });
});

describe('selectStorage', () => {
  it('picks the Filesystem slot on a native platform', async () => {
    const fs = stubFs();
    const slot = selectStorage({ global: nativeGlobal, loadFs: async () => fs });
    await slot.writeSave('{"version":1}');
    expect(fs.files.get(`DATA/${FILE_SLOT_NAME}`)).toBe('{"version":1}');
    expect(await slot.readSave()).toBe('{"version":1}');
  });

  it('keeps the browser slot on the web and never loads the plugin', async () => {
    let loaded = false;
    const slot = selectStorage({
      global: webGlobal,
      loadFs: async () => {
        loaded = true;
        return stubFs();
      },
    });
    // node has neither IndexedDB nor localStorage, so the browser slot refuses in its own words
    await expect(slot.writeSave('x')).rejects.toThrow('This browser would not let the game save.');
    expect(await slot.readSave()).toBeNull();
    expect(loaded).toBe(false);
  });
});

describe('the Filesystem slot', () => {
  it('round trips a save through autosave.json in the app data directory as utf8, written by way of autosave.json.tmp', async () => {
    const fs = stubFs();
    const slot = createFileStorage(fs);
    const text = JSON.stringify({ version: 9, tower: 'x'.repeat(4096) });
    await slot.writeSave(text);
    expect(await slot.readSave()).toBe(text);
    expect(fs.files.size).toBe(1);
    expect(fs.calls.map((c) => [c.op, c.path, c.directory, c.encoding])).toEqual([
      ['list', '', 'DATA', undefined],
      ['write', 'autosave.json.tmp', 'DATA', 'utf8'],
      ['rename', 'autosave.json.tmp -> autosave.json', 'DATA', undefined],
      ['list', '', 'DATA', undefined],
      ['read', 'autosave.json', 'DATA', 'utf8'],
    ]);
  });

  it('reads the newest save, keeping the one before it as autosave.json.bak', async () => {
    const fs = stubFs();
    const slot = createFileStorage(fs);
    await slot.writeSave('{"n":"first"}');
    await slot.writeSave('{"n":"second"}');
    expect(await slot.readSave()).toBe('{"n":"second"}');
    expect(fs.files.get('DATA/autosave.json.bak')).toBe('{"n":"first"}');
  });

  it('reads null on first launch, when the file does not exist', async () => {
    expect(await createFileStorage(stubFs()).readSave()).toBeNull();
  });

  it('accepts the plugin as a promise, the way boot loads it lazily', async () => {
    const slot = createFileStorage(Promise.resolve(stubFs()));
    await slot.writeSave('"lazy"');
    expect(await slot.readSave()).toBe('"lazy"');
  });

  it('refuses to write in plain English when the device refuses', async () => {
    const fs = stubFs();
    fs.writeFile = async () => {
      throw new Error('ENOSPC');
    };
    await expect(createFileStorage(fs).writeSave('x')).rejects.toThrow('This device would not let the game save.');
  });

  it('reads a Blob result as text', async () => {
    const fs = stubFs();
    fs.readFile = async () => ({ data: new Blob(['"from a blob"']) });
    expect(await createFileStorage(fs).readSave()).toBe('"from a blob"');
  });
});

describe('shareSave', () => {
  it('writes the export to the cache directory and hands its uri to the share sheet', async () => {
    const fs = stubFs();
    const shared: { title?: string; files?: string[] }[] = [];
    await shareSave('{"version":1}', {
      fs,
      share: {
        share: async (o) => {
          shared.push(o);
        },
      },
    });
    expect(fs.files.get(`CACHE/${EXPORT_FILE_NAME}`)).toBe('{"version":1}');
    expect(shared).toEqual([{ title: 'Hundred Stories save', files: [`file:///CACHE/${EXPORT_FILE_NAME}`] }]);
  });
});
