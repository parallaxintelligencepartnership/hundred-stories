const R = '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim';
const { createWorld } = await import(R + '/world.ts');
const { applyCommand } = await import(R + '/build.ts');
const { tick } = await import(R + '/tick.ts');
const { handleEventCommand } = await import(R + '/events.ts');
const { requestHallCall } = await import(R + '/elevators.ts');

function base(seed = 11) {
  const w = createWorld(seed);
  w.cash = 50_000_000;
  for (let x = 100; x < 260; x++) { const r = applyCommand(w, { kind: 'build', room: 'lobby', floor: 1, x }); if (!r.ok) throw new Error('lobby ' + r.reason); }
  return w;
}
function mk(w, over) {
  const s = { id: w.nextId++, kind: 'worker', homeRoomId: null, pos: { floor: 1, x: 120 }, inCarId: null, inRoomId: null, route: [], state: 'outside',
    stress: 0, waitStart: null, schedule: [], nextScheduleIndex: 0, stayUntil: null, wallet: 0, leaveReason: null, ...over };
  w.sims.set(s.id, s); return s;
}
const byKind = (w, k) => [...w.rooms.values()].filter(r => r.kind === k);

// B: demolish a room whose tenant sits in another room
{
  const w = base();
  console.log(applyCommand(w, { kind: 'build', room: 'office', floor: 2, x: 100 }), applyCommand(w, { kind: 'build', room: 'fastFood', floor: 2, x: 140 }));
  const office = byKind(w, 'office')[0], ff = byKind(w, 'fastFood')[0];
  const s = mk(w, { homeRoomId: office.id, inRoomId: ff.id, state: 'inRoom', pos: { floor: 2, x: 148 }, stayUntil: w.time.minute + 30 });
  office.tenants.push(s.id); office.vacant = false; ff.occupancy = 1;
  console.log('B demolish office:', applyCommand(w, { kind: 'demolish', roomId: office.id }), 'ff occupancy after', ff.occupancy, 'sim exists', w.sims.has(s.id));
}

// C + E: fire destroys a home room while a tenant rides a car / sits in another room
{
  const w = base();
  applyCommand(w, { kind: 'build', room: 'office', floor: 2, x: 100 });
  applyCommand(w, { kind: 'build', room: 'fastFood', floor: 2, x: 200 });
  applyCommand(w, { kind: 'build', room: 'office', floor: 3, x: 200 });
  console.log(applyCommand(w, { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 5 }));
  const [office] = byKind(w, 'office'), ff = byKind(w, 'fastFood')[0];
  const shaft = [...w.shafts.values()][0], car = shaft.cars[0];
  const rider = mk(w, { homeRoomId: office.id, state: 'waiting', pos: { floor: 1, x: 150 }, waitStart: w.time.minute,
    route: [{ kind: 'ride', shaftId: shaft.id, fromFloor: 1, toFloor: 5 }, { kind: 'walk', toX: 160 }] });
  const diner = mk(w, { homeRoomId: office.id, inRoomId: ff.id, state: 'inRoom', pos: { floor: 2, x: 208 }, stayUntil: w.time.minute + 600 });
  office.tenants.push(rider.id, diner.id); office.vacant = false; ff.occupancy = 1;
  requestHallCall(w, shaft.id, 1, 1, 'office');
  tick(w);
  console.log('C rider state', rider.state, 'inCar', rider.inCarId, 'car y', car.y);
  office.onFire = true;
  w.events.push({ kind: 'fire', roomIds: [office.id], startedAt: w.time.minute, spreadAt: w.time.minute + 10000 });
  console.log('helicopter', handleEventCommand(w, { kind: 'fire.callHelicopter' }));
  console.log('E ff occupancy right after fire (diner evicted):', ff.occupancy, 'diner state', diner.state, 'diner inRoomId', diner.inRoomId);
  const trace = [];
  for (let i = 0; i < 120; i++) { tick(w); if (i < 12 || i % 20 === 0) trace.push(`${i}:${rider.state}/car=${rider.inCarId}/pos=${rider.pos.floor},${rider.pos.x}/route=${rider.route.map(l=>l.kind).join(',')}/pass=${car.passengers.length}`); }
  console.log(trace.join('\n'));
  console.log('C rider exists', w.sims.has(rider.id), 'passengers', car.passengers, 'ff occ', ff.occupancy, 'diner exists', w.sims.has(diner.id));
}
