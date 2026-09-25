const R = '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim';
const { createWorld } = await import(R + '/world.ts');
const { applyCommand } = await import(R + '/build.ts');
const { tick } = await import(R + '/tick.ts');
const w = createWorld(11);
for (let x = 100; x < 160; x++) applyCommand(w, { kind: 'build', room: 'lobby', floor: 1, x });
console.log(applyCommand(w, { kind: 'build', room: 'office', floor: 2, x: 100 }), applyCommand(w, { kind: 'build', room: 'office', floor: 3, x: 100 }));
console.log(applyCommand(w, { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 5 }));
const shaft = [...w.shafts.values()][0];
console.log(applyCommand(w, { kind: 'shaft.setCarServes', shaftId: shaft.id, carId: shaft.cars[0].id, serves: 'hotel' }));
const office = [...w.rooms.values()].find(r => r.kind === 'office' && r.floor === 3);
const cash0 = w.cash;
let everIn = 0;
for (let i = 0; i < 4320 + 60; i++) { tick(w); everIn = Math.max(everIn, office.occupancy); }
console.log('office vacant', office.vacant, 'tenants', office.tenants.length, 'max occupancy seen', everIn, 'eval', office.eval.toFixed(2));
console.log('cash delta', w.cash - cash0, 'income', JSON.stringify(w.stats.incomeByKind), 'lastQuarter', JSON.stringify(w.stats.lastQuarter));
const workers = [...w.sims.values()].filter(s => s.kind === 'worker');
console.log('worker states', workers.map(s => s.state).join(','));
