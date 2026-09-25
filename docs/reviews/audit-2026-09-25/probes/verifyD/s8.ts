const ls = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => void ls.set(k, v) };
const { createGame } = await import('/Users/matthew/parallax-private/Projects/hundred-stories/src/game/game');
let now = 0; let idles = 0;
const game = createGame(11, { now: () => now, hidden: () => true, scheduleIdle: (run) => { idles++; run(); return () => {}; }, today: () => '2026-09-28', freshSeed: () => 77 });
game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
await game.save();
game.setSpeed(0);
for (let x = 100; x < 110; x++) game.apply({ kind: 'build', room: 'lobby', floor: 1, x });
for (let i = 0; i < 2000; i++) { now += 1000; game.stepOnce(); }
await new Promise((r) => setTimeout(r, 0));
const saved = JSON.parse(ls.get('hundred-stories:autosave')!);
console.log('paused: in hand lobby tiles', [...game.world.rooms.values()].length, '| on disk rooms', saved.rooms.length, '| idle autosaves scheduled', idles, '| minute', game.world.time.minute);
