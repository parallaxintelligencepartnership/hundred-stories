import { readFileSync } from 'node:fs';
import { deserialize, serialize, hashWorld } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/save';
import { tick } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/tick';
const text = readFileSync('/Users/matthew/parallax-private/Projects/hundred-stories/store/fixtures/demo-tower.json', 'utf8');
const a0 = deserialize(text); if (!a0.ok) throw new Error(a0.reason);
let a = a0.world;
const b0 = deserialize(text); if (!b0.ok) throw new Error(b0.reason);
let b = b0.world;
console.log('start minute', a.time.minute, 'sims', a.sims.size, 'rooms', a.rooms.size);
const MIN = 5 * 1440;
let firstDiff = -1;
for (let i = 0; i < MIN; i++) {
  tick(a); tick(b);
  if (i % 97 === 0) { const r = deserialize(serialize(b)); if (!r.ok) throw new Error(r.reason); b = r.world; }
  if (i % 60 === 0 && firstDiff < 0 && hashWorld(a) !== hashWorld(b)) { firstDiff = a.time.minute; }
}
console.log('continuous', hashWorld(a), 'reloaded', hashWorld(b), 'firstDiff', firstDiff, 'cash', a.cash, b.cash, 'stars', a.stars, 'pop', a.population, 'gameOver', a.gameOver);
