import { applyCommand } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/build';
import { ROOMS } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/rules';
import { createWorld } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/world';
import { tick } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/tick';
import { serialize, deserialize } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/save';
import type { Command } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/types';
const world = createWorld(4242);
world.cash = 50_000_000;
const ok = (c: Command) => applyCommand(world, c).ok;
for (let x = 0; x < 120; x++) ok({ kind: 'build', room: 'lobby', floor: 1, x });
ok({ kind: 'shaft.build', shaft: 'standard', x: 20, floorMin: 1, floorMax: 6 });
for (let f = 2; f <= 6; f++) for (let x = 0; x + ROOMS.office.width <= 120; x += ROOMS.office.width) ok({ kind: 'build', room: 'office', floor: f, x });
while (world.time.minute < 1440 + 9 * 60) tick(world);
const base = JSON.parse(serialize(world));
console.log('sims', base.sims.length, 'rooms', base.rooms.length, 'cars', base.shafts[0].cars.length);
type M = [string, (d: any) => void];
const riding = () => base.sims.find((s: any) => s.state === 'riding');
const muts: M[] = [
  ['events fire with no roomIds', (d) => { d.events = [{ kind: 'fire' }]; }],
  ['events bomb with no fields', (d) => { d.events = [{ kind: 'bomb' }]; }],
  ['events unknown kind', (d) => { d.events = [{ kind: 'meteor' }]; }],
  ['events theft no fields', (d) => { d.events = [{ kind: 'theft' }]; }],
  ['event null', (d) => { d.events = [null]; }],
  ['stats {}', (d) => { d.stats = {}; }],
  ['sim schedule missing', (d) => { delete d.sims[0].schedule; }],
  ['sim route missing', (d) => { delete d.sims[0].route; }],
  ['sim route leg bogus', (d) => { d.sims.forEach((s: any) => { s.route = [{ kind: 'ride', shaftId: 999999, fromFloor: 1, toFloor: 5 }]; s.state = 'walking'; }); }],
  ['sim homeRoomId dangling', (d) => { d.sims.forEach((s: any) => { s.homeRoomId = 999999; }); }],
  ['sim inCarId dangling', (d) => { d.sims.forEach((s: any) => { s.inCarId = 999999; s.state = 'riding'; }); }],
  ['car passengers dangling', (d) => { d.shafts[0].cars[0].passengers = [999999]; }],
  ['car passengers missing', (d) => { delete d.shafts[0].cars[0].passengers; }],
  ['car calls missing', (d) => { delete d.shafts[0].cars[0].calls; }],
  ['car dir 5', (d) => { d.shafts[0].cars[0].dir = 5; }],
  ['room tenants missing', (d) => { delete d.rooms[d.rooms.length-1].tenants; }],
  ['room tenants dangling', (d) => { d.rooms[d.rooms.length-1].tenants = [999999]; }],


  ['shaft width missing', (d) => { delete d.shafts[0].width; }],
  ['shaft cars missing ok?', (d) => { d.shafts[0].cars = []; }],
  ['sim guard garbage', (d) => { d.sims[0].guard = { task: 'respond', respond: 5 }; }],
  ['population string', (d) => { d.population = -5; }],
  ['stars 3.0 ok', (d) => { d.stars = 3; }],
  ['gameOver {}', (d) => { d.gameOver = {}; }],
  ['log entries null', (d) => { d.log = [null]; }],
  ['hallCalls floor 0', (d) => { d.shafts[0].hallCalls = [[0, { up: ['office'], down: [] }]]; }],
  ['rngState 1.5', (d) => { d.rngState = 1.5; }],
  ['seed NaN-ish 1e300', (d) => { d.seed = 1e300; }],
];
for (const [name, fn] of muts) {
  const d = structuredClone(base); fn(d);
  const r = deserialize(JSON.stringify(d));
  if (!r.ok) { console.log('REFUSED  ', name, '->', r.reason); continue; }
  let err = '';
  try { for (let i = 0; i < 3000; i++) tick(r.world); } catch (e) { err = String((e as Error).message ?? e).slice(0, 90); }
  try { serialize(r.world); } catch (e) { err += ' | serialize: ' + String(e).slice(0,60); }
  console.log(err ? 'LOADS+THROWS' : 'LOADS ok  ', name, err ? '-> ' + err : '');
}
