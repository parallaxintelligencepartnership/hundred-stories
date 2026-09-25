// The real storage module on a fake localStorage (the web path with no IndexedDB).
const ls = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => void ls.set(k, v) };
const { createGame } = await import('/Users/matthew/parallax-private/Projects/hundred-stories/src/game/game');
let now = 0;
const game = createGame(11, { now: () => now, hidden: () => true, scheduleIdle: (run) => { run(); return () => {}; }, today: () => '2026-09-28', freshSeed: () => 77 });
game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
await game.save();
const seedOf = (k: string) => JSON.parse(ls.get('hundred-stories:' + k)!).seed;
console.log('My tower slot seed before:', seedOf('autosave'), 'rooms:', JSON.parse(ls.get('hundred-stories:autosave')!).rooms.length);
await game.openFriend(4242);
console.log('in slot', game.getSlot(), 'world seed', game.world.seed);
// The friend tower plays on at 1x and is one minute short of 06:00 on its second morning.
game.world.time.minute = 360 + 1440 - 1;
const opening = game.openMyTower(); // the player taps My tower
now += 1000; game.stepOnce();       // one timer step (or frame) lands while the read is pending
await opening;
await new Promise((r) => setTimeout(r, 0));
console.log('after: slot', game.getSlot(), 'world in hand seed', game.world.seed, 'rooms', game.world.rooms.size);
console.log('My tower slot seed after:', seedOf('autosave'), 'rooms:', JSON.parse(ls.get('hundred-stories:autosave')!).rooms.length);
