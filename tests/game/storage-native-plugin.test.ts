// The real loader for the Filesystem plugin, against a module mock shaped like a Capacitor
// plugin. A Capacitor plugin object is a Proxy that answers every property, `then` included, with
// a native call; awaiting it (or returning it from an async function) hands the promise machinery
// a bogus `then` that never settles, and boot hangs on a blank page. This pins that the loader
// never resolves a promise with the plugin object itself.
import { describe, expect, it, vi } from 'vitest';

const files = vi.hoisted(() => new Map<string, string>());

vi.mock('@capacitor/filesystem', () => {
  const missing = (): Error => Object.assign(new Error('File does not exist.'), { code: 'OS-PLUG-FILE-0008' });
  const methods: Record<string, (o: { path: string; directory: string; data?: string }) => Promise<unknown>> = {
    writeFile: async ({ path, directory, data }) => {
      files.set(`${directory}/${path}`, data ?? '');
      return { uri: `file:///${directory}/${path}` };
    },
    readFile: async ({ path, directory }) => {
      const data = files.get(`${directory}/${path}`);
      if (data === undefined) throw missing();
      return { data };
    },
    readdir: async ({ path, directory }) => {
      const prefix = `${directory}/${path}`;
      return { files: [...files.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ name: k.slice(prefix.length), type: 'file' })) };
    },
    rename: async (o) => {
      const { from, to, directory } = o as unknown as { from: string; to: string; directory: string };
      const data = files.get(`${directory}/${from}`);
      if (data === undefined) throw missing();
      files.delete(`${directory}/${from}`);
      files.set(`${directory}/${to}`, data);
    },
    deleteFile: async ({ path, directory }) => {
      if (!files.delete(`${directory}/${path}`)) throw missing();
    },
  };
  // Like registerPlugin's proxy: any other property (then included) is a native call that never settles.
  const Filesystem = new Proxy({}, { get: (_t, prop: string) => methods[prop] ?? (() => new Promise(() => {})) });
  return { Filesystem };
});

import { selectStorage } from '../../src/game/storage';

describe('the Filesystem slot with the real plugin loader', () => {
  it('round trips instead of hanging on the plugin proxy', async () => {
    const slot = selectStorage({ global: { Capacitor: { isNativePlatform: () => true } } });
    const settled = Promise.race([
      (async () => {
        expect(await slot.readSave()).toBeNull();
        await slot.writeSave('{"version":1}');
        return slot.readSave();
      })(),
      new Promise((resolve) => setTimeout(() => resolve('hung'), 1000)),
    ]);
    expect(await settled).toBe('{"version":1}');
    expect(files.get('DATA/autosave.json')).toBe('{"version":1}');
  });
});
