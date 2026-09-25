import { applyCommand, canBuild, isHeldUp } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/build';
import { createWorld } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/world';
import type { World } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/types';
const base = (): World => { const w = createWorld(7); w.cash = 50_000_000; w.stars = 5;
  for (let x = 100; x < 160; x++) applyCommand(w, { kind: 'build', room: 'lobby', floor: 1, x });
  for (const x of [100, 116, 132]) console.assert(applyCommand(w, { kind: 'build', room: 'parkingRamp', floor: -1, x }).ok);
  return w; };
let w = base();
console.log('S3 B1 ramps x100-147. recycling base -3 (covers B3,B2) x100:', JSON.stringify(canBuild(w, 'recycling', -3, 100)));
console.log('S3 metro base -4 (covers B4..B2) x100:', JSON.stringify(canBuild(w, 'metro', -4, 100)));
console.log('S3 recycling base -2 (covers B2,B1) x100 [collides with ramps]:', JSON.stringify(canBuild(w, 'recycling', -2, 100)));
// workaround 1: something on B2 first
w = base();
console.log('  workaround: parkingSpace -2 x140:', JSON.stringify(applyCommand(w, { kind: 'build', room: 'parkingSpace', floor: -2, x: 140 })));
console.log('  then recycling -3 x100:', JSON.stringify(canBuild(w, 'recycling', -3, 100)), ' metro -4 x100:', JSON.stringify(canBuild(w, 'metro', -4, 100)));
// workaround 2: a shaft through B2..B3
w = base();
console.log('  workaround: shaft -3..1 x200:', JSON.stringify(applyCommand(w, { kind: 'shaft.build', shaft: 'standard', x: 200, floorMin: -3, floorMax: 1 })));
console.log('  then recycling -3 x100:', JSON.stringify(canBuild(w, 'recycling', -3, 100)), ' metro -4 x100:', JSON.stringify(canBuild(w, 'metro', -4, 100)));
// S4
const u = createWorld(7); u.cash = 5_000_000; u.stars = 3;
console.log('S4 parkingSpace B1 no lobby:', JSON.stringify(canBuild(u, 'parkingSpace', -1, 100)));
for (let x = 100; x < 110; x++) applyCommand(u, { kind: 'build', room: 'lobby', floor: 1, x });
console.log('S4 parkingSpace B2 with empty B1:', JSON.stringify(canBuild(u, 'parkingSpace', -2, 100)));
// S5
const s = createWorld(11);
const r1 = applyCommand(s, { kind: 'shaft.build', shaft: 'standard', x: 200, floorMin: 40, floorMax: 69 });
const r2 = applyCommand(s, { kind: 'build', room: 'office', floor: 41, x: 198 });
const r3 = applyCommand(s, { kind: 'build', room: 'office', floor: 42, x: 190 });
const r4 = applyCommand(s, { kind: 'build', room: 'office', floor: 41, x: 300 });
console.log('S5 empty lot, no lobby. shaft 40..69 x200:', JSON.stringify(r1), '| office 41 x198:', JSON.stringify(r2), '| office 42 x190:', JSON.stringify(r3), '| office 41 x300 (off the shaft):', JSON.stringify(r4));
console.log('S5 rooms', [...s.rooms.values()].map(r => `${r.kind}@${r.floor}x${r.x} heldUp=${isHeldUp(s, r)}`).join(', '), 'lobby present:', [...s.rooms.values()].some(r => r.kind === 'lobby'));
const sh = [...s.shafts.values()][0]!;
console.log('S5 demolish the shaft now:', JSON.stringify(applyCommand(s, { kind: 'shaft.demolish', shaftId: sh.id })));
