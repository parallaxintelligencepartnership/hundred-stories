// S1 with browser-like ordering: IndexedDB fake where open() and each transaction settle in later
// tasks, and transactions run in creation order (the IndexedDB rule for overlapping scopes).
// No requestIdleCallback in node, so the game's own scheduleIdle uses setTimeout(run, 0) (Safari path).
// A "frame" is a separate task (setTimeout), never between a call and its microtasks.
const store = new Map<string, string>();
let queue: Promise<void> = Promise.resolve();
const task = () => new Promise<void>((r) => setTimeout(r, 0));
const trace: string[] = [];
(globalThis as any).indexedDB = {
  open() {
    const req: any = {};
    const db = {
      transaction() {
        const tx: any = {};
        tx.objectStore = () => ({
          put(v: string, k: string) { queue = queue.then(task).then(() => { store.set(k, v); trace.push('IDB put ' + k + ' seed ' + JSON.parse(v).seed); tx.oncomplete?.(); }); },
          get(k: string) { const g: any = {}; queue = queue.then(task).then(() => { g.result = store.get(k); trace.push('IDB get ' + k + ' -> seed ' + (g.result ? JSON.parse(g.result).seed : null)); g.onsuccess?.(); }); return g; },
        });
        return tx;
      },
    };
    req.result = db;
    setTimeout(() => req.onsuccess?.(), 0);
    return req;
  },
};
const { createGame } = await import('/Users/matthew/parallax-private/Projects/hundred-stories/src/game/game');
let now = 0;
const game = createGame(11, { now: () => now, hidden: () => false, today: () => '2026-09-28', freshSeed: () => 77 });
game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
await game.save();
await game.openFriend(4242);
const mode = process.env.ORDER ?? 'frameDuringRead';
game.world.time.minute = 360 + 1440 - 1;
if (mode === 'idlePendingAtTap') {
  now += 1000; game.frameOnce(); trace.push('frame crossed 06:00 in friend slot; idle autosave queued');
}
trace.push('tap My tower');
const opening = game.openMyTower();
if (mode === 'frameDuringRead') {
  await task(); now += 1000; game.frameOnce(); trace.push('frame (separate task) crossed 06:00 while read pending, slot=' + game.getSlot());
}
await opening;
for (let i = 0; i < 10; i++) await task();
console.log(mode); for (const t of trace) console.log('  ' + t);
console.log('  memory: slot', game.getSlot(), 'world seed', game.world.seed, 'rooms', game.world.rooms.size);
console.log('  disk My tower (autosave key): seed', JSON.parse(store.get('autosave')!).seed);
