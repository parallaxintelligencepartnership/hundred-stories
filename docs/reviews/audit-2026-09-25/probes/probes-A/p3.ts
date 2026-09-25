import { readFileSync } from 'node:fs';
import { deserialize } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/save';
import { tick } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/tick';
const text = readFileSync('/Users/matthew/parallax-private/Projects/hundred-stories/store/fixtures/demo-tower.json', 'utf8');
const r = deserialize(text); if (!r.ok) throw new Error(r.reason);
const w = r.world;
const kinds: Record<string, number> = {};
for (const room of w.rooms.values()) kinds[room.kind] = (kinds[room.kind] ?? 0) + 1;
console.log(kinds);
const out: string[] = [];
for (let i = 0; i < 2 * 1440; i++) { tick(w); if (w.time.minute % 120 === 1) out.push(`${Math.floor((w.time.minute % 1440)/60)}h:${w.population}`); }
console.log(out.join(' '));
