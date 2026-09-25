const R = '/Users/matthew/parallax-private/Projects/hundred-stories';
const { tick } = await import(R + '/src/sim/tick.ts');
const { createWorld } = await import(R + '/src/sim/world.ts');
const { serialize, deserialize, hashWorld } = await import(R + '/src/sim/save.ts');
const H = await import(R + '/tests/scenarios/helpers.ts');

function build() {
  const w = createWorld(11);
  w.cash = 500_000_000;
  w.stars = 2 as any;
  H.buildTower(w, [...H.lobbyRun(90, 170), { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 3 },
    ...H.buildRow('hotelSingle', 2, [100, 104, 108, 112, 116])]);
  // make the first one dirty with no housekeeping: it infests after 3 days
  const rooms = [...w.rooms.values()].filter((r: any) => r.kind === 'hotelSingle').sort((a: any, b: any) => a.id - b.id);
  rooms[0].dirty = true; rooms[0].dirtySinceMinute = w.time.minute;
  return w;
}
const infested = (w: any) => [...w.rooms.values()].filter((r: any) => r.infested).map((r: any) => r.id).join(',');
const a = build();
// run until first infestation appears
while (!infested(a)) tick(a);
const infestAt = a.time.minute;
// run one more day minus a bit, then save/load a copy
for (let i = 0; i < 1440 + 60; i++) tick(a);
const res = deserialize(serialize(a));
if (!res.ok) throw new Error(res.reason);
const b = res.world;
console.log('infested first at minute', infestAt, 'saved at', a.time.minute, 'hash equal at save', hashWorld(a) === hashWorld(b));
for (let d = 0; d < 4; d++) {
  for (let i = 0; i < 1440; i++) { tick(a); tick(b); }
  console.log('day+', d + 1, 'continuous:', infested(a), '| reloaded:', infested(b), '| hash equal', hashWorld(a) === hashWorld(b));
}
