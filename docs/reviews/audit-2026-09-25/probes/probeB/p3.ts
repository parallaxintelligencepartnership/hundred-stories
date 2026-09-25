const R = '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim';
const { createWorld } = await import(R + '/world.ts');
const { applyCommand } = await import(R + '/build.ts');
const { tick } = await import(R + '/tick.ts');
const { handleEventCommand } = await import(R + '/events.ts');
const { requestHallCall } = await import(R + '/elevators.ts');
const w = createWorld(11); w.cash = 50_000_000;
for (let x = 100; x < 260; x++) applyCommand(w, { kind: 'build', room: 'lobby', floor: 1, x });
for (const f of [2,3,4,5]) applyCommand(w, { kind: 'build', room: 'office', floor: f, x: 100 });
applyCommand(w, { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 5 });
const offices = [...w.rooms.values()].filter(r => r.kind === 'office');
const office5 = offices.find(o => o.floor === 5);
const shaft = [...w.shafts.values()][0], car = shaft.cars[0];
const s = { id: w.nextId++, kind: 'worker', homeRoomId: office5.id, pos: { floor: 3, x: 150 }, inCarId: null, inRoomId: null,
  route: [{ kind: 'ride', shaftId: shaft.id, fromFloor: 3, toFloor: 5 }, { kind: 'walk', toX: 104 }], state: 'waiting', stress: 0, waitStart: w.time.minute,
  schedule: [], nextScheduleIndex: 0, stayUntil: null, wallet: 0, leaveReason: null };
w.sims.set(s.id, s); office5.tenants.push(s.id); office5.vacant = false;
requestHallCall(w, shaft.id, 3, 1, 'office');
for (let i = 0; i < 10 && s.state !== 'riding'; i++) tick(w);
tick(w);
console.log('boarded', s.state, 'car y', car.y);
office5.onFire = true;
w.events.push({ kind: 'fire', roomIds: [office5.id], startedAt: w.time.minute, spreadAt: w.time.minute + 100000 });
handleEventCommand(w, { kind: 'fire.callHelicopter' });
let firstGone = -1;
for (let i = 0; i < 1000; i++) { tick(w); if (!w.sims.has(s.id) && firstGone < 0) firstGone = i; }
console.log('after 1000 min: exists', w.sims.has(s.id), 'state', s.state, 'inCar', s.inCarId, 'pos', s.pos, 'route', JSON.stringify(s.route), 'passengers', car.passengers, 'car y', car.y, 'firstGone', firstGone);
console.log('demolish shaft:', applyCommand(w, { kind: 'shaft.demolish', shaftId: shaft.id }));
