const ls = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => void ls.set(k, v) };
const { createGame } = await import('/Users/matthew/parallax-private/Projects/hundred-stories/src/game/game');
let now = 0;
const game = createGame(11, { now: () => now, hidden: () => true, scheduleIdle: (run) => { run(); return () => {}; }, today: () => '2026-09-28', freshSeed: () => 77 });
game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
game.world.time.minute = 20 * 1440; // a My tower twenty game days old
const myFile = game.exportSave();   // Save to a file
await game.save();
await game.openDaily();
game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 100 });
await game.save();
console.log('daily slot mode before:', JSON.parse(ls.get('hundred-stories:daily')!).buildLog.mode);
console.log('import in daily slot:', JSON.stringify(game.importSave(myFile)), 'slot', game.getSlot(), 'getDaily', JSON.stringify(game.getDaily()));
const m = game.world.time.minute; now += 5000; game.stepOnce();
console.log('clock moved:', game.world.time.minute !== m, '| build:', JSON.stringify(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 10 })));
await game.openMyTower();
console.log('daily slot after leaving: seed', JSON.parse(ls.get('hundred-stories:daily')!).seed, 'mode', JSON.parse(ls.get('hundred-stories:daily')!).buildLog.mode);
