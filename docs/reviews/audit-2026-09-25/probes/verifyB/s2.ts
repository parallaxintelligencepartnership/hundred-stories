import { base, applyCommand, tick, hhmm } from './common.ts';
const w = base();
for (const f of [2,3,4]) console.log('build shop', f, JSON.stringify(applyCommand(w, { kind: 'build', room: f === 4 ? 'fastFood' : 'office', floor: f, x: 100 })));
console.log('shaft', JSON.stringify(applyCommand(w, { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 5 })));
const shaft = [...w.shafts.values()][0], car = shaft.cars[0];
let rider;
for (let i = 0; i < 2000 && !rider; i++) { tick(w); rider = [...w.sims.values()].find(s => (s.kind === 'diner' || s.kind === 'worker') && s.state === 'riding' && s.route[0]?.kind === 'ride' && s.route[0].toFloor === 4); }
if (!rider) throw new Error('no shopper riding to 4');
console.log(`[${hhmm(w.time.minute)}] ${rider.kind} ${rider.id} riding to 4, car y ${car.y}; turning stop 4 off:`, JSON.stringify(applyCommand(w, { kind: 'shaft.setStop', shaftId: shaft.id, floor: 4, stops: false })));
const t0 = w.time.minute;
for (let i = 1; i <= 3 * 1440; i++) {
  tick(w);
  if ([1, 10, 60, 600, 1440, 2880, 4320].includes(i)) console.log(`  +${i} [${hhmm(w.time.minute)}] exists ${w.sims.has(rider.id)} state ${rider.state} inCar ${rider.inCarId} stress ${rider.stress.toFixed(2)} route ${JSON.stringify(rider.route[0])} car y ${car.y} car.state ${car.state} passengers ${JSON.stringify(car.passengers)} calls ${JSON.stringify([...car.calls])}`);
}
console.log('  demolish shaft:', JSON.stringify(applyCommand(w, { kind: 'shaft.demolish', shaftId: shaft.id })));
console.log('  remove car:', JSON.stringify(applyCommand(w, { kind: 'shaft.removeCar', shaftId: shaft.id })));
console.log('  turn stop 4 back on:', JSON.stringify(applyCommand(w, { kind: 'shaft.setStop', shaftId: shaft.id, floor: 4, stops: true })));
for (let i = 1; i <= 30; i++) { tick(w); if (rider.state !== 'riding') { console.log(`  freed after ${i} min: state ${rider.state} pos ${JSON.stringify(rider.pos)}`); break; } }
