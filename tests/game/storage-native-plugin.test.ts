// The real loader for the Filesystem plugin, against a module mock shaped like a Capacitor
// plugin. A Capacitor plugin object is a Proxy that answers every property, `then` included, with
// a native call; awaiting it (or returning it from an async function) hands the promise machinery
// a bogus `then` that never settles, and boot hangs on a blank page. This pins that the loader
// never resolves a promise with the plugin object itself.
import { describe, expect, it, vi } from 'vitest';

const files = vi.hoisted(() => new Map<string, string>());

vi.mock('@capacitor/filesystem', () => {
  const methods: Record<string, (o: { path: string; directory: string; data?: string }) => Promise<unknown>> = {
    writeFile: async ({ path, directory, data }) => {
      files.set(`${directory}/${path}`, data ?? '');
      return { uri: `file:///${directory}/${path}` };
    },
    readFile: async ({ path, directory }) => {
      const data = files.get(`${directory}/${path}`);
      if (data === undefined) throw new Error('File does not exist.');
      return { data };
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
