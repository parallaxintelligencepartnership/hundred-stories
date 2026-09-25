import { applyCommand } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/build';
import { createWorld, setOnFire } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/world';
import { tick } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/tick';
function tower() {
  const w = createWorld(9); w.cash = 50_000_000; w.stars = 2;
  for (let x = 100; x < 160; x++) applyCommand(w, { kind: 'build', room: 'lobby', floor: 1, x });
  applyCommand(w, { kind: 'shaft.build', shaft: 'standard', x: 130, floorMin: 1, floorMax: 6 });
  for (let f = 2; f <= 5; f++) for (const x of [100, 110, 140]) applyCommand(w, { kind: 'build', room: 'office', floor: f, x });
  return w;
}
// FIRE: set a vacant office on floor 5 on fire the way startFire does, then demolish it.
{
  const w = tower();
  const target = [...w.rooms.values()].find(r => r.kind === 'office' && r.floor === 5 && r.x === 140)!;
  setOnFire(w, target, true);
  w.events.push({ kind: 'fire', roomIds: [target.id], startedAt: w.time.minute, spreadAt: w.time.minute + 30 });
  console.log('fire: demolish burning room (occupancy', target.occupancy, '):', applyCommand(w, { kind: 'demolish', roomId: target.id }));
  const simsBefore = w.sims.size;
  for (let i = 0; i < 3 * 1440; i++) tick(w);
  console.log('fire after 3 days: events', JSON.stringify(w.events.map(e => e.kind)), 'sims', simsBefore, '->', w.sims.size, 'pop', w.population);
}
// BOMB: vacant office floor 5 x140, far from the first lobby tiles; demolish it before 13:00.
{
  const w = tower(); w.stars = 3;
  const target = [...w.rooms.values()].find(r => r.kind === 'office' && r.floor === 5 && r.x === 140)!;
  const dayStart = w.time.minute - (w.time.minute % 1440);
  w.events.push({ kind: 'bomb', roomId: target.id, ransom: 500000, detonateAt: dayStart + 13 * 60, found: false });
  console.log('bomb: demolish bomb room:', applyCommand(w, { kind: 'demolish', roomId: target.id }));
  const before = new Set(w.rooms.keys());
  while (w.events.some(e => e.kind === 'bomb')) tick(w);
  const gone = [...before].filter(id => !w.rooms.has(id));
  console.log('bomb destroyed ids', gone, 'lowest ids in tower were', [...before].sort((a,b)=>a-b).slice(0,4));
  console.log(w.log.filter(l => l.text.includes('bomb')).map(l => l.text).join(' | '));
  const f2 = [...w.rooms.values()].filter(r => r.floor === 2).map(r => r.x);
  console.log('floor 2 rooms x', f2);
}
