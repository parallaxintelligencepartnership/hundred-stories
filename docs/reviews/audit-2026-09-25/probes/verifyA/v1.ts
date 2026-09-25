import { applyCommand } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/build';
import { createWorld } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/world';
import { tick } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/tick';
import { startFire } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/events';
import { serialize, deserialize } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/save';
import { clockOf } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/types';
import type { World } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/types';

const ok = (r: any) => { if (!r.ok) throw new Error(JSON.stringify(r)); };
function tower(seed: number): World {
  const w = createWorld(seed); w.cash = 60_000_000;
  for (let x = 100; x < 300; x++) ok(applyCommand(w, { kind: 'build', room: 'lobby', floor: 1, x }));
  ok(applyCommand(w, { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 9 }));
  ok(applyCommand(w, { kind: 'shaft.build', shaft: 'standard', x: 250, floorMin: 1, floorMax: 9 }));
  for (const s of w.shafts.values()) { ok(applyCommand(w, { kind: 'shaft.addCar', shaftId: s.id })); ok(applyCommand(w, { kind: 'shaft.addCar', shaftId: s.id })); }
  for (let f = 2; f <= 7; f++) for (let x = 100; x + 9 <= 300; x += 9) ok(applyCommand(w, { kind: 'build', room: 'office', floor: f, x }));
  ok(applyCommand(w, { kind: 'build', room: 'fastFood', floor: 8, x: 100 }));
  ok(applyCommand(w, { kind: 'build', room: 'fastFood', floor: 8, x: 200 }));
  for (let x = 100; x + 16 <= 300; x += 16) if (x < 300) applyCommand(w, { kind: 'build', room: 'condo', floor: 9, x });
  return w;
}
function toMinuteOfDay(w: World, mod: number) { do tick(w); while (clockOf(w.time.minute).minuteOfDay !== mod); }
function clone(w: World): World { const r = deserialize(serialize(w)); if (!r.ok) throw new Error(r.reason); return r.world; }
const day = (w: World) => Math.floor(w.time.minute / 1440);
const fmt = (w: World) => `day ${day(w)} ${String(clockOf(w.time.minute).minuteOfDay/60|0).padStart(2,'0')}:${String(clockOf(w.time.minute).minuteOfDay%60).padStart(2,'0')}`;

let w!: World; let target: any;
for (let seed = 1; seed < 400; seed++) {
  const t = tower(seed);
  // one weekday so offices fill and stars rise to 2 naturally
  for (let i = 0; i < 1440; i++) tick(t);
  toMinuteOfDay(t, 6 * 60 + 1);
  if (t.stars < 2 || t.events.length) continue;
  const c = clone(t);
  startFire(c);
  const ev = c.events.find(e => e.kind === 'fire') as any;
  if (!ev) continue;
  const room = c.rooms.get(ev.roomIds[0]);
  if (!room || room.kind !== 'office') continue;
  const r = applyCommand(c, { kind: 'demolish', roomId: room.id });
  if (!r.ok) continue;
  w = c; target = { ...room, seed }; break;
}
console.log(`seed ${target.seed}: startFire picked ${target.kind} id ${target.id} floor ${target.floor} x ${target.x} occupancy ${target.occupancy}; demolish accepted at ${fmt(w)}`);
console.log('fire event after demolish:', JSON.stringify(w.events.filter(e => e.kind === 'fire')), 'room exists:', w.rooms.has(target.id), 'onFire rooms:', [...w.rooms.values()].filter(r => r.onFire).length);
console.log('stars', w.stars, 'pop', w.population, 'cash', w.cash, 'security offices', [...w.rooms.values()].filter(r => r.kind === 'security').length);
const snap = clone(w);

// Control: same tower, same moment, no fire at all (drop the event) to compare arrivals/income.
const ctrl = clone(w); ctrl.events = ctrl.events.filter(e => e.kind !== 'fire');
function runDays(x: World, n: number, label: string) {
  for (let d = 0; d < n; d++) {
    const id0 = x.nextId; const cond0 = [...x.rooms.values()].filter(r => r.kind === 'condo' && !r.vacant).length;
    const cash0 = x.cash;
    for (let i = 0; i < 1440; i++) tick(x);
    const inRoom = [...x.sims.values()].filter(s => s.state === 'inRoom' && s.kind === 'worker').length;
    const outside = [...x.sims.values()].filter(s => s.state === 'outside').length;
    const shoppers = [...x.sims.values()].filter(s => s.kind === 'diner' || s.kind === 'shopper').length;
    const cond1 = [...x.rooms.values()].filter(r => r.kind === 'condo' && !r.vacant).length;
    console.log(`${label} ${fmt(x)} events=${JSON.stringify(x.events.map(e => e.kind))} newIds=${x.nextId - id0} condosSold=${cond0}->${cond1} workersInRoom@06:01=${inRoom} outside=${outside} diners=${shoppers} stars=${x.stars} pop=${x.population} cashDelta=${x.cash - cash0} gameOver=${!!x.gameOver}`);
  }
}
runDays(w, 10, 'FIRE');
runDays(ctrl, 3, 'CTRL');
console.log('fire log lines:', w.log.filter(l => /fire|Fire/.test(l.text)).map(l => `[${l.minute}] ${l.text}`).join(' | '));

// Escape A: build a security office (star 2, $100,000)
const a = clone(snap); for (let i = 0; i < 3 * 1440; i++) tick(a);
console.log('A before: stars', a.stars, 'cash', a.cash, 'events', JSON.stringify(a.events.map(e => e.kind)));
const sec = applyCommand(a, { kind: 'build', room: 'security', floor: 8, x: 140 });
console.log('A build security office:', JSON.stringify(sec));
const m0 = a.time.minute; while (a.events.some(e => e.kind === 'fire') && a.time.minute - m0 < 300) tick(a);
console.log(`A fire ended after ${a.time.minute - m0} min:`, !a.events.some(e => e.kind === 'fire'), '| last log:', a.log.filter(l => /fire/.test(l.text)).slice(-1).map(l => l.text));
// Escape B: helicopter
const b = clone(snap); for (let i = 0; i < 3 * 1440; i++) tick(b);
const cashB = b.cash; const hel = applyCommand(b, { kind: 'fire.callHelicopter' });
console.log('B helicopter:', JSON.stringify(hel), 'cash', cashB, '->', b.cash, 'events', JSON.stringify(b.events.map(e => e.kind)), '| log:', b.log.slice(-2).map(l => l.text).join(' / '));
