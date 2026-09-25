const ls = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => void ls.set(k, v) };
const { createGame } = await import('/Users/matthew/parallax-private/Projects/hundred-stories/src/game/game');
const g0 = createGame(11, { now: () => 0, hidden: () => true, scheduleIdle: (r) => { r(); return () => {}; }, today: () => '2026-09-28', freshSeed: () => 77 });
g0.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
const d = JSON.parse(g0.exportSave()); d.version = 99; // a save this build cannot read (a newer version)
ls.set('hundred-stories:autosave', JSON.stringify(d));
const game = createGame(5, { now: () => 0, hidden: () => true, scheduleIdle: (r) => { r(); return () => {}; }, today: () => '2026-09-28', freshSeed: () => 77 });
await game.openFriend(4242);            // e.g. booted from a friend's link
await game.openMyTower();               // then taps My tower
const after = JSON.parse(ls.get('hundred-stories:autosave')!);
console.log('My tower slot now: version', after.version, 'seed', after.seed, '| stash written:', ls.has('hs.save.unreadable'), '| warn lines:', game.world.log.filter((l: any) => l.level === 'warn').map((l: any) => l.text));
