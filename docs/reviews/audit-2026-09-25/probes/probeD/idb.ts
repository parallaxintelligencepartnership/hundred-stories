import { createStorage } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/game/storage';
// A fake IndexedDB: one object store in memory. mode 'ok' works; 'failWrite' fires tx.onerror;
// 'abortWrite' fires only tx.onabort, the way a commit-time QuotaExceededError is delivered.
const store = new Map<string, string>();
let mode: 'ok' | 'failWrite' | 'abortWrite' = 'ok';
function fakeIdb(): IDBFactory {
  return { open: () => {
    const db: any = {
      transaction: (_s: string, m: string) => {
        const tx: any = { oncomplete: null, onerror: null, onabort: null, error: null };
        tx.objectStore = () => ({
          put: (v: string, k: string) => {
            const write = mode;
            setTimeout(() => {
              if (write === 'ok') { store.set(k, v); tx.oncomplete?.(); }
              else if (write === 'failWrite') { tx.error = new Error('UnknownError'); tx.onerror?.(); }
              else { tx.error = new DOMException('quota', 'QuotaExceededError'); tx.onabort?.(); }
            }, 0);
          },
          get: (k: string) => { const req: any = { result: undefined }; setTimeout(() => { req.result = store.get(k); req.onsuccess?.(); }, 0); return req; },
        });
        return tx;
      },
    };
    const req: any = { result: db };
    setTimeout(() => req.onsuccess?.(), 0);
    return req;
  } } as unknown as IDBFactory;
}
const ls = new Map<string, string>();
const localStorage = { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => void ls.set(k, v) } as unknown as Storage;
const s = createStorage({ indexedDB: fakeIdb(), localStorage });
await s.writeSave('save at minute 1000 (IDB ok)');
mode = 'failWrite';
await s.writeSave('save at minute 5000 (IDB write failed, fell back)');
console.log('writeSave after IDB error resolved without throwing; localStorage holds:', ls.get('hundred-stories:autosave'));
console.log('readSave returns:', await s.readSave());
mode = 'abortWrite';
const r = await Promise.race([s.writeSave('save at minute 9000').then(() => 'settled'), new Promise((res) => setTimeout(() => res('STILL PENDING after 2 s'), 2000))]);
console.log('writeSave on a transaction abort:', r);
