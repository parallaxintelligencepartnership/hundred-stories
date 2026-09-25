// S4 extension: a housekeeper cleaning a hotel room when the housekeeping office burns
import { base, applyCommand, tick, hhmm, realOcc } from './common.ts';
const R = '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim';
const { handleEventCommand } = await import(R + '/events.ts');
const { setOnFire } = await import(R + '/world.ts');
const { populationOf } = await import(R + '/stars.ts');
const w = base(11, 100);
w.stars = 2;
for (let x = 100; x < 180; x += 4) applyCommand(w, { kind: 'build', room: 'hotelSingle', floor: 2, x });
console.log('hk', JSON.stringify(applyCommand(w, { kind: 'build', room: 'housekeeping', floor: 3, x: 100 })));
applyCommand(w, { kind: 'shaft.build', shaft: 'standard', x: 190, floorMin: 1, floorMax: 3 });
const hk = [...w.rooms.values()].find(r => r.kind === 'housekeeping');
let keeper, hotel;
for (let i = 0; i < 4 * 1440 && !keeper; i++) {
  tick(w);
  keeper = [...w.sims.values()].find(s => s.kind === 'staff' && s.state === 'inRoom' && s.inRoomId !== hk.id);
}
if (!keeper) throw new Error('no keeper cleaning');
hotel = w.rooms.get(keeper.inRoomId);
console.log(`[${hhmm(w.time.minute)}] keeper ${keeper.id} cleaning hotel room ${hotel.id} (occ ${hotel.occupancy}, real ${realOcc(w, hotel)}, tenants ${hotel.tenants.length}); population ${populationOf(w)}`);
setOnFire(w, hk, true);
w.events.push({ kind: 'fire', roomIds: [hk.id], startedAt: w.time.minute, spreadAt: w.time.minute + 100000 });
console.log('  fire in housekeeping, helicopter:', JSON.stringify(handleEventCommand(w, { kind: 'fire.callHelicopter' })));
console.log(`  right after: keeper state ${keeper.state} inRoomId ${keeper.inRoomId}; hotel occ ${hotel.occupancy} real ${realOcc(w, hotel)}`);
for (let i = 1; i <= 3 * 1440; i++) {
  tick(w);
  if (w.time.minute % 1440 === 16 * 60) console.log(`  [${hhmm(w.time.minute)}] hotel room ${hotel.id} occ ${hotel.occupancy} real ${realOcc(w, hotel)} tenants ${hotel.tenants.length} dirty ${hotel.dirty}; populationOf ${populationOf(w)} vs rooms with real guests ${[...w.rooms.values()].filter(r => r.kind === 'hotelSingle' && realOcc(w, r) > 0).length}; world.population ${w.population}`);
}
console.log('  demolish that hotel room:', JSON.stringify(applyCommand(w, { kind: 'demolish', roomId: hotel.id })));
