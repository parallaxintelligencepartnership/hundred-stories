import { readFileSync, writeSync } from 'node:fs';
import { deserialize } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/save';
import { tickEvents } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/events';
import { tickPeople } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/people';
import { tickElevators } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/elevators';
const d: any = JSON.parse(readFileSync('/private/tmp/claude-501/-Users-matthew-parallax-private-Projects-hundred-stories/59100aac-82b1-4a98-947c-f0845463d155/scratchpad/audit/probeD/base.json', 'utf8'));
delete d.shafts[0].width;
const r = deserialize(JSON.stringify(d)); if (!r.ok) throw 0;
const w = r.world;
const say = (s: string) => writeSync(1, s + '\n');
for (let i = 0; i < 3; i++) {
  say('minute ' + w.time.minute + ' events'); tickEvents(w);
  say('people'); tickPeople(w);
  say('elevators'); tickElevators(w);
  w.time.minute++;
}
say('three ticks done');
