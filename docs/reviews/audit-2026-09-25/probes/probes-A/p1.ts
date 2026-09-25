import { applyCommand, canBuild } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/build';
import { createWorld } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/world';
import { carCovers } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/types';

const w = createWorld(7); w.cash = 50_000_000; w.stars = 5;
for (let x = 100; x < 140; x++) applyCommand(w, { kind: 'build', room: 'lobby', floor: 1, x });
console.log('parkingRamp -1 @100', applyCommand(w, { kind: 'build', room: 'parkingRamp', floor: -1, x: 100 }));
console.log('parkingRamp -1 @116', applyCommand(w, { kind: 'build', room: 'parkingRamp', floor: -1, x: 116 }));
// recycling covers -3,-2; its top -2 sits right under the ramps on -1
console.log('recycling @-3 x100 (top under B1 ramps):', canBuild(w, 'recycling', -3, 100));
console.log('metro @-4 x100 (top -2, nothing on -2/-3):', canBuild(w, 'metro', -4, 100));
// single basement with nothing above
const w2 = createWorld(7); w2.cash = 50_000_000; w2.stars = 3;
for (let x = 100; x < 110; x++) applyCommand(w2, { kind: 'build', room: 'lobby', floor: 1, x });
console.log('parkingSpace @-2 with empty B1:', canBuild(w2, 'parkingSpace', -2, 100));
// car range across floor 0
const w3 = createWorld(7); w3.cash = 50_000_000;
applyCommand(w3, { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: -1, floorMax: 5 });
const s = [...w3.shafts.values()][0]!;
const r = applyCommand(w3, { kind: 'shaft.setCarRange', shaftId: s.id, carId: s.cars[0]!.id, range: { lo: 0, hi: 1 } });
console.log('setCarRange {0,1}:', r, 'covers floors:', [-1,1,2].filter(f => carCovers(s, s.cars[0]!, f)));
