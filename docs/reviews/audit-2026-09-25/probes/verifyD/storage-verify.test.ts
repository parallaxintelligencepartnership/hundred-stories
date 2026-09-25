import { describe, expect, it } from 'vitest';
import { createStorage } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/game/storage';

function fakeLocalStorage(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get length() { return data.size; }, clear: () => data.clear(), getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => Array.from(data.keys())[i] ?? null, removeItem: (k: string) => void data.delete(k), setItem: (k: string, v: string) => void data.set(k, v) } as any;
}
/** An IndexedDB that opens; put and get settle in a microtask. mode: ok, error (tx.onerror), abort (tx.onabort only). */
function fakeIdb() {
  const data = new Map<string, string>();
  const ctl = { mode: 'ok' as 'ok' | 'error' | 'abort', data };
  const factory = {
    open: () => {
      const db = { transaction: () => {
        const tx: any = { error: null };
        tx.objectStore = () => ({
          put: (v: string, k: string) => { const m = ctl.mode; queueMicrotask(() => {
            if (m === 'ok') { data.set(k, v); tx.oncomplete?.(); }
            else if (m === 'error') { tx.error = new Error('write failed'); tx.onerror?.(); }
            else { tx.error = new DOMException('quota', 'QuotaExceededError'); tx.onabort?.(); } }); },
          get: (k: string) => { const req: any = {}; queueMicrotask(() => { req.result = data.get(k); req.onsuccess?.(); }); return req; },
        });
        return tx;
      } };
      const req: any = { result: db };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
  } as unknown as IDBFactory;
  return { factory, ctl };
}

describe('verify-D S3 and S4', () => {
  it('S3: after an IndexedDB write fails and falls back, the next read returns the newest save', async () => {
    const ls = fakeLocalStorage();
    const { factory, ctl } = fakeIdb();
    const s = createStorage({ indexedDB: factory, localStorage: ls });
    await s.writeSave('{"minute":1000}');
    ctl.mode = 'error';
    await s.writeSave('{"minute":5000}'); // resolves: fell back to localStorage
    console.log('IndexedDB holds:', ctl.data.get('autosave'), '| localStorage holds:', ls.data.get('hundred-stories:autosave'));
    const got = await s.readSave();
    console.log('readSave returns:', got);
    expect(got).toBe('{"minute":5000}');
  });

  it('S4: a transaction abort settles the write (rejects or falls back) instead of hanging', async () => {
    const ls = fakeLocalStorage();
    const { factory, ctl } = fakeIdb();
    ctl.mode = 'abort';
    const s = createStorage({ indexedDB: factory, localStorage: ls });
    const r = await Promise.race([
      s.writeSave('x').then(() => 'resolved', () => 'rejected'),
      new Promise((res) => setTimeout(() => res('PENDING after 500 ms'), 500)),
    ]);
    console.log('writeSave on abort:', r);
    expect(r).not.toBe('PENDING after 500 ms');
  });
});
