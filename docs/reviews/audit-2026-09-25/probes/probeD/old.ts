import { readFileSync } from 'node:fs';
import { tick } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/tick';
import { deserialize, hashWorld } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/save';
import { buildLogOf } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/buildlog';
import { verifySave } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/replay';
const base = readFileSync('/private/tmp/claude-501/-Users-matthew-parallax-private-Projects-hundred-stories/59100aac-82b1-4a98-947c-f0845463d155/scratchpad/audit/probeD/base.json', 'utf8');
for (const v of [1, 2, 3, 4, 5]) {
  const d: any = JSON.parse(base);
  d.version = v;
  if (v < 5) delete d.buildLog;
  if (v < 4) delete d.story;
  if (v < 3) { delete d.quarterStartCash; delete d.dayStartPopulation; }
  if (v < 2) { for (const s of d.shafts) { for (const c of s.cars) { delete c.serves; delete c.range; } s.hallCalls = s.hallCalls.map(([f, c]: any) => [f, { up: c.up.length > 0, down: c.down.length > 0 }]); } delete d.logTotal; }
  const r = deserialize(JSON.stringify(d));
  if (!r.ok) { console.log('v' + v, 'REFUSED', r.reason); continue; }
  let err = '';
  try { for (let i = 0; i < 1500; i++) tick(r.world); } catch (e) { err = String(e); }
  console.log('v' + v, 'loaded; log', buildLogOf(r.world).unavailable, '; story beats', r.world.story.recent.length, '; 1500 ticks', err || 'ok', '; verify', verifySave(JSON.stringify(d)).status);
}
