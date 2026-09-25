import { base, applyCommand, tick, hhmm } from './common.ts';
const R = '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim';
const { requestHallCall } = await import(R + '/elevators.ts');
function mk(w, over) { const s = { id: w.nextId++, kind: 'shopper', homeRoomId: null, pos: { floor: 1, x: 150 }, inCarId: null, inRoomId: null, route: [], state: 'walking', stress: 0, waitStart: null, schedule: [], nextScheduleIndex: 0, stayUntil: null, wallet: 0, leaveReason: null, ...over }; w.sims.set(s.id, s); return s; }
// S7
{
  const w = base();
  console.log('stairs', JSON.stringify(applyCommand(w, { kind: 'build', room: 'stairs', floor: 1, x: 120 })));
  console.log('office', JSON.stringify(applyCommand(w, { kind: 'build', room: 'office', floor: 2, x: 100 })));
  console.log('shaft', JSON.stringify(applyCommand(w, { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 2 })));
  const stairs = [...w.rooms.values()].find(r => r.kind === 'stairs');
  const office = [...w.rooms.values()].find(r => r.kind === 'office');
  const s = mk(w, { pos: { floor: 1, x: 110 }, route: [{ kind: 'walk', toX: 124 }, { kind: 'stairs', roomId: stairs.id, toFloor: 2 }, { kind: 'walk', toX: 104 }] });
  console.log('S7 demolish stairs:', JSON.stringify(applyCommand(w, { kind: 'demolish', roomId: stairs.id })), 'stairs exist', w.rooms.has(stairs.id));
  for (let i = 1; i <= 5; i++) { tick(w); console.log(`  +${i} pos ${JSON.stringify(s.pos)} route ${JSON.stringify(s.route.map(l => l.kind))} state ${s.state}`); }
}
// S8
{
  const w = base();
  applyCommand(w, { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 5 });
  const shaft = [...w.shafts.values()][0], car = shaft.cars[0];
  // a hall call at 1 going up whose caller walked away: the car opens at 1, heading up, empty
  for (let i = 0; i < 3; i++) tick(w);
  requestHallCall(w, shaft.id, 1, 1, 'other');
  const a = { state: 'n/a' };
  for (let i = 0; i < 5 && car.state !== 'doorsOpen'; i++) tick(w);
  console.log(`S8 car y ${car.y} dir ${car.dir} state ${car.state} doorTimer ${car.doorTimer} passengers ${car.passengers.length}, rider a state ${a.state}`);
  const b = mk(w, { pos: { floor: 1, x: 150 }, state: 'waiting', waitStart: w.time.minute, route: [{ kind: 'ride', shaftId: shaft.id, fromFloor: 1, toFloor: 5 }, { kind: 'walk', toX: 100 }] });
  console.log('  setCarRange 4..5:', JSON.stringify(applyCommand(w, { kind: 'shaft.setCarRange', shaftId: shaft.id, carId: car.id, range: { lo: 4, hi: 5 } })));
  tick(w);
  console.log(`  after one tick: b state ${b.state} inCar ${b.inCarId}; car y ${car.y} passengers ${JSON.stringify(car.passengers)}`);
  for (let i = 0; i < 12 && b.state === 'riding'; i++) tick(w);
  console.log(`  later: b state ${b.state} pos ${JSON.stringify(b.pos)}`);
  console.log(`  after one tick: b state ${b.state} inCar ${b.inCarId} boarded at floor ${b.pos.floor}; car y ${car.y} (range 4..5)`);
}
