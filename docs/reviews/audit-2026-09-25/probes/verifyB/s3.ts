import { base, applyCommand, tick, hhmm } from './common.ts';
const w = base();
console.log('office 2', JSON.stringify(applyCommand(w, { kind: 'build', room: 'office', floor: 2, x: 100 })));
console.log('ff 3', JSON.stringify(applyCommand(w, { kind: 'build', room: 'fastFood', floor: 3, x: 100 })));
console.log('shaft', JSON.stringify(applyCommand(w, { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 3 })));
const shaft = [...w.shafts.values()][0];
let s;
for (let i = 0; i < 3000 && !s; i++) { tick(w); s = [...w.sims.values()].find(x => x.kind === 'diner' && x.state === 'waiting' && x.exiting && x.pos.floor === 3); }
if (!s) throw new Error('no leaving diner waiting on 3');
console.log(`[${hhmm(w.time.minute)}] diner ${s.id} waiting on 3, exiting ${s.exiting}, route ${JSON.stringify(s.route)}; stop 3 off:`, JSON.stringify(applyCommand(w, { kind: 'shaft.setStop', shaftId: shaft.id, floor: 3, stops: false })));
for (let i = 1; i <= 3 * 1440; i++) {
  tick(w);
  if ([1, 18, 19, 60, 600, 1440, 2880, 4320].includes(i)) console.log(`  +${i} [${hhmm(w.time.minute)}] exists ${w.sims.has(s.id)} state ${s.state} stress ${s.stress.toFixed(2)} leaveReason ${s.leaveReason} exiting ${s.exiting} waitStart ${s.waitStart} route0 ${JSON.stringify(s.route[0])} hallCalls ${JSON.stringify([...shaft.hallCalls.keys()])}`);
}
