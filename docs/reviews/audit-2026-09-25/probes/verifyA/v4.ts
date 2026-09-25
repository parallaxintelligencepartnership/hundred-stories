import { applyCommand } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/build';
import { createWorld } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/world';
import { tick } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/tick';
import { clockOf } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/types';
import { canBuild } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/build';
const w = createWorld(3); w.stars = 2;
for (let x = 100; x < 120; x++) applyCommand(w, { kind: 'build', room: 'lobby', floor: 1, x });
applyCommand(w, { kind: 'build', room: 'security', floor: 2, x: 100 });
applyCommand(w, { kind: 'shaft.build', shaft: 'standard', x: 110, floorMin: 1, floorMax: 3 });
w.cash = 10_000; // below the upkeep
// run through to the next quarter start via the real tick
let n = 0; while (!w.log.some(l => l.text.startsWith('The quarter is over')) && n++ < 5 * 1440) tick(w);
console.log('S8:', w.log.filter(l => l.text.startsWith('The quarter is over')).map(l => l.text));
const c = createWorld(3); c.cash = 10; c.stars = 1;
console.log('S7 fast food short:', JSON.stringify(canBuild(c, 'fastFood', 1, 100)));
c.stars = 3; c.cash = 1e6;
console.log('S7 sky lobby at B1:', JSON.stringify(canBuild(c, 'skyLobby', -1, 100)));
