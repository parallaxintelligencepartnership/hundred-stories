import { createWorld, rebuildFloorIndex } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/world';
import { tickCockroaches } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/events';
import { serialize, deserialize, hashWorld } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/save';
import type { Room, World } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/types';
function room(id: number, x: number, dirty: boolean, infested: boolean): Room {
  return { id, kind: 'hotelSingle', floor: 2, x, width: 4, height: 1, eval: 1, tenants: [], occupancy: 0, builtAtMinute: 0, vacant: false, dirty, dirtySinceMinute: dirty ? 0 : null, infested, lowEvalSinceMinute: null, onFire: false, rent: 100 };
}
const w = createWorld(7);
w.rooms.set(1, room(1, 0, true, true));
w.rooms.set(2, room(2, 4, false, false));
w.nextId = 3;
rebuildFloorIndex(w);
const D = 1440;
w.time.minute = 1 * D; tickCockroaches(w);          // day 1: infested exists, lastSpread = day1
w.time.minute = 2 * D; tickCockroaches(w);          // day 2: gap 1 day, no spread
// Save and load here, the way every page reload does
const r = deserialize(serialize(w)); if (!r.ok) throw new Error(r.reason);
const l = r.world;
console.log('hash equal right after load:', hashWorld(w) === hashWorld(l));
for (const day of [3, 4, 5]) {
  w.time.minute = day * D; tickCockroaches(w);
  l.time.minute = day * D; tickCockroaches(l);
  console.log(`day ${day}: continuous room2.infested=${w.rooms.get(2)!.infested} loaded room2.infested=${l.rooms.get(2)!.infested} hashEqual=${hashWorld(w) === hashWorld(l)}`);
}
