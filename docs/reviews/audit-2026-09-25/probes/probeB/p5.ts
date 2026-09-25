const R = '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim';
const { createWorld } = await import(R + '/world.ts');
const { applyCommand } = await import(R + '/build.ts');
const { tick } = await import(R + '/tick.ts');
const w = createWorld(11); w.cash = 50_000_000;
for (let x = 100; x < 160; x++) applyCommand(w, { kind: 'build', room: 'lobby', floor: 1, x });
for (const f of [2,3]) console.log(applyCommand(w, { kind: 'build', room: 'fastFood', floor: f, x: 100 }));
console.log(applyCommand(w, { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 5 }));
const shaft = [...w.shafts.values()][0];
// a diner finished its visit on floor 3, heading out: exiting, waiting for the car down
const s = { id: w.nextId++, kind: 'diner', homeRoomId: null, pos: { floor: 3, x: 150 }, inCarId: null, inRoomId: null,
  route: [{ kind: 'ride', shaftId: shaft.id, fromFloor: 3, toFloor: 1 }, { kind: 'walk', toX: 100 }], state: 'waiting', stress: 0, waitStart: null,
  schedule: [], nextScheduleIndex: 1, stayUntil: null, wallet: 0, leaveReason: null, exiting: true };
w.sims.set(s.id, s);
console.log(applyCommand(w, { kind: 'shaft.setStop', shaftId: shaft.id, floor: 3, stops: false }));
s.waitStart = w.time.minute;
for (let i = 0; i < 3000; i++) tick(w);
console.log('after 3000 min: exists', w.sims.has(s.id), 'state', s.state, 'stress', s.stress, 'reason', s.leaveReason, 'waited', w.time.minute - (s.waitStart ?? 0));
