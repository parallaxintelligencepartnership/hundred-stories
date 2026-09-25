import { createTauriStorage } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/game/storage';
const files = new Map<string, string>();
const tick = () => new Promise((r) => setTimeout(r, 1));
const fs = {
  ensureDir: async () => {},
  writeTextFile: async (p: string, d: string) => { await tick(); files.set(p, d); },
  readTextFile: async (p: string) => { const v = files.get(p); if (v === undefined) throw new Error('ENOENT'); return v; },
  rename: async (a: string, b: string) => { await tick(); const v = files.get(a); if (v === undefined) throw new Error('ENOENT ' + a); files.delete(a); files.set(b, v); },
};
const s = createTauriStorage(fs);
const results = await Promise.allSettled([s.writeSave('autosave text'), s.writeSave('save now text')]);
console.log(results.map((r) => r.status === 'fulfilled' ? 'ok' : 'rejected: ' + (r.reason as Error).message));
console.log('autosave.json holds:', files.get('autosave.json'));
