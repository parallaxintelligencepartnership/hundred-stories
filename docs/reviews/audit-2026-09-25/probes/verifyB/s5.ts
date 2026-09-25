// S5: a worker coming back from lunch on floor 3 rides toward its office on 5; the office burns mid ride.
import { base, applyCommand, tick, hhmm } from './common.ts';
const R = '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim';
const { handleEventCommand } = await import(R + '/events.ts');
const { setOnFire } = await import(R + '/world.ts');
const { requestHallCall } = await import(R + '/elevators.ts');
const quiet = process.argv[2] === 'quiet';
const w = base(11, 60);
for (const f of [2, 3, 4, 5]) applyCommand(w, { kind: 'build', room: quiet && f !== 5 ? 'lobby' === 'x' ? '' : 'office' : 'office', floor: f, x: 100 });
applyCommand(w, { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 5 });
const shaft = [...w.shafts.values()][0], car = shaft.cars[0];
const office5 = [...w.rooms.values()].find(r => r.kind === 'office' && r.floor === 5);
if (quiet) { // no other traffic: only the one tenant exists and other offices are never leased
  for (const r of w.rooms.values()) if (r.kind === 'office' && r !== office5) { r.vacant = false; }
}
const s = { id: w.nextId++, kind: 'worker', homeRoomId: office5.id, pos: { floor: 3, x: 150 }, inCarId: null, inRoomId: null,
  route: [{ kind: 'ride', shaftId: shaft.id, fromFloor: 3, toFloor: 5 }, { kind: 'walk', toX: 104 }, { kind: 'enter', roomId: office5.id }], state: 'waiting', stress: 0, waitStart: w.time.minute,
  schedule: [], nextScheduleIndex: 0, stayUntil: null, wallet: 0, leaveReason: null };
w.sims.set(s.id, s); office5.tenants.push(s.id); office5.vacant = false;
requestHallCall(w, shaft.id, 3, 1, 'office');
for (let i = 0; i < 10 && s.state !== 'riding'; i++) tick(w);
tick(w);
console.log(`[${hhmm(w.time.minute)}] boarded: state ${s.state} inCar ${s.inCarId} car y ${car.y} passengers ${JSON.stringify(car.passengers)}`);
setOnFire(w, office5, true);
w.events.push({ kind: 'fire', roomIds: [office5.id], startedAt: w.time.minute, spreadAt: w.time.minute + 100000 });
console.log('office 5 burns, helicopter:', JSON.stringify(handleEventCommand(w, { kind: 'fire.callHelicopter' })));
let prev = '';
for (let i = 1; i <= 3 * 1440; i++) {
  tick(w);
  const line = `state ${s.state} inCar ${s.inCarId} pos ${s.pos.floor},${s.pos.x} route0 ${s.route[0] ? s.route[0].kind + (s.route[0].toFloor ? '->' + s.route[0].toFloor : '') : '-'} | car y ${car.y} ${car.state} passengers ${JSON.stringify(car.passengers)}`;
  const key = line.replace(/pos \S+/, '');
  if (!w.sims.has(s.id)) { console.log(`  +${i} [${hhmm(w.time.minute)}] sim removed; passengers ${JSON.stringify(car.passengers)}`); break; }
  if (key !== prev || i % 1440 === 0) { console.log(`  +${i} [${hhmm(w.time.minute)}] ${line}`); prev = key; }
}
console.log('demolish shaft:', JSON.stringify(applyCommand(w, { kind: 'shaft.demolish', shaftId: shaft.id })));
