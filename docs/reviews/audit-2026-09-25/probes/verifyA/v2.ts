import { applyCommand } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/build';
import { createWorld } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/world';
import { tick } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/tick';
import { startBomb } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/events';
import { clockOf, MAX_FLOOR, MIN_FLOOR } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/types';
import type { World } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/types';
const ok = (r: any) => { if (!r.ok) throw new Error(JSON.stringify(r)); };
function tower(seed: number, security: boolean): World {
  const w = createWorld(seed); w.cash = 60_000_000; w.stars = 3;
  for (let x = 100; x < 200; x++) ok(applyCommand(w, { kind: 'build', room: 'lobby', floor: 1, x }));
  ok(applyCommand(w, { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 6 }));
  for (let f = 2; f <= 5; f++) for (let x = 100; x + 9 <= 200; x += 9) ok(applyCommand(w, { kind: 'build', room: 'office', floor: f, x }));
  if (security) ok(applyCommand(w, { kind: 'build', room: 'security', floor: 6, x: 100 }));
  return w;
}
for (const security of [false, true]) {
  for (let seed = 1; seed < 500; seed++) {
    const w = tower(seed, security);
    startBomb(w);
    const ev = w.events.find(e => e.kind === 'bomb') as any;
    const room = w.rooms.get(ev.roomId)!;
    if (room.kind !== 'office' || room.floor !== 5) continue;
    const d = applyCommand(w, { kind: 'demolish', roomId: room.id });
    if (!d.ok) continue;
    console.log(`security=${security} seed ${seed}: bomb in office id ${room.id} floor 5 x ${room.x}; demolish at ${clockOf(w.time.minute).minuteOfDay/60}:00 ->`, JSON.stringify(d), 'event still there:', w.events.some(e => e.kind === 'bomb'));
    const before = new Map([...w.rooms.values()].map(r => [r.id, `${r.kind}@${r.floor}x${r.x}`]));
    const cash0 = w.cash;
    while (w.events.some(e => e.kind === 'bomb')) tick(w);
    const gone = [...before.keys()].filter(id => !w.rooms.has(id)).map(id => `${id}:${before.get(id)}`);
    console.log(`  ended at ${clockOf(w.time.minute).minuteOfDay}min-of-day; destroyed: ${JSON.stringify(gone)}; cash delta ${w.cash - cash0}`);
    console.log('  log:', w.log.filter(l => /bomb/i.test(l.text)).map(l => l.text).join(' | '));
    break;
  }
}
console.log('MIN_FLOOR', MIN_FLOOR, 'MAX_FLOOR', MAX_FLOOR, 'worst search minutes', (MAX_FLOOR - MIN_FLOOR) * 3, 'window 06:00->13:00 =', 7 * 60);
