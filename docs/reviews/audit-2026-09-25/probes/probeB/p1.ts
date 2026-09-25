const R = '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim';
const { createWorld } = await import(R + '/world.ts');
const { applyCommand } = await import(R + '/build.ts');
const { tick } = await import(R + '/tick.ts');
const { requestHallCall } = await import(R + '/elevators.ts');

function base() {
  const w = createWorld(11);
  for (let x = 100; x < 160; x++) { const r = applyCommand(w, { kind: 'build', room: 'lobby', floor: 1, x }); if (!r.ok) throw new Error('lobby ' + r.reason); }
  return w;
}

// Probe A: setStop removes a rider's destination while aboard.
{
  const w = base();
  let r = applyCommand(w, { kind: 'shaft.build', shaft: 'standard', x: 120, floorMin: 1, floorMax: 5 }); console.log('shaft', r);
  const shaft = [...w.shafts.values()][0];
  const car = shaft.cars[0];
  // a worker waiting on 1 for floor 4
  const sim = { id: w.nextId++, kind: 'shopper', homeRoomId: null, pos: { floor: 1, x: 120 }, inCarId: null, inRoomId: null,
    route: [{ kind: 'ride', shaftId: shaft.id, fromFloor: 1, toFloor: 4 }, { kind: 'walk', toX: 130 }], state: 'waiting', stress: 0, waitStart: w.time.minute,
    schedule: [], nextScheduleIndex: 0, stayUntil: null, wallet: 0, leaveReason: null };
  w.sims.set(sim.id, sim);
  requestHallCall(w, shaft.id, 1, 1, 'other');
  for (let i = 0; i < 2 && sim.state !== 'riding'; i++) tick(w);
  console.log('A boarded:', sim.state, 'car y', car.y);
  r = applyCommand(w, { kind: 'shaft.setStop', shaftId: shaft.id, floor: 4, stops: false }); console.log('setStop', r);
  for (let i = 0; i < 600; i++) tick(w);
  console.log('A after 600 min:', sim.state, 'inCar', sim.inCarId, 'car y', car.y, 'passengers', car.passengers.length, 'simExists', w.sims.has(sim.id));
  console.log('A demolish shaft:', applyCommand(w, { kind: 'shaft.demolish', shaftId: shaft.id }));
}
