const R = '/Users/matthew/parallax-private/Projects/hundred-stories';
const { applyCommand } = await import(R + '/src/sim/build.ts');
const ev = await import(R + '/src/sim/events.ts');
const { tick, tickMany } = await import(R + '/src/sim/tick.ts');
const { createWorld, setOnFire } = await import(R + '/src/sim/world.ts');
const { fireBurning } = await import(R + '/src/sim/people.ts');
const H = await import(R + '/tests/scenarios/helpers.ts');
const story = await import(R + '/src/sim/story.ts');
const daily = await import(R + '/src/game/daily.ts');
const chron = await import(R + '/src/sim/chronicle.ts');

function base(stars: number) {
  const w = createWorld(7);
  w.stars = stars as any;
  w.cash = 500_000_000;
  H.buildTower(w, [...H.lobbyRun(90, 170), { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 4 }, ...H.buildRow('office', 2, [100, 109, 118, 127])]);
  return w;
}

// A: fire, burning room demolished, no security
{
  const w = base(2);
  const office = [...w.rooms.values()].find((r: any) => r.kind === 'office' && r.x === 127);
  setOnFire(w, office, true);
  w.events.push({ kind: 'fire', roomIds: [office.id], startedAt: w.time.minute, spreadAt: w.time.minute + 30 });
  const res = applyCommand(w, { kind: 'demolish', roomId: office.id });
  console.log('A demolish burning office:', JSON.stringify(res));
  tickMany(w, 3 * 1440);
  const f = w.events.find((e: any) => e.kind === 'fire');
  const burning = [...w.rooms.values()].filter((r: any) => r.onFire).length;
  const inside = [...w.sims.values()].filter((s: any) => s.kind === 'worker' && s.state !== 'outside').length;
  console.log('A after 3 days: fire event', !!f, 'fireBurning', fireBurning(w), 'rooms on fire', burning, 'workers not outside', inside, 'minute', w.time.minute);
}

// B: bomb room demolished, then 13:00
{
  const w = base(3);
  const office = [...w.rooms.values()].find((r: any) => r.kind === 'office' && r.x === 127);
  w.events.push({ kind: 'bomb', roomId: office.id, ransom: 500000, detonateAt: 13 * 60, found: false });
  const res = applyCommand(w, { kind: 'demolish', roomId: office.id });
  console.log('B demolish bomb room:', JSON.stringify(res));
  const before = new Map([...w.rooms.values()].map((r: any) => [r.id, `${r.kind}@${r.floor},${r.x}`]));
  while (w.time.minute <= 13 * 60) tick(w);
  const gone = [...before.entries()].filter(([id]) => !w.rooms.has(id)).map(([, d]) => d);
  console.log('B destroyed:', gone.join(' '), '| last log:', w.log.filter((l: any) => l.text.includes('bomb')).map((l: any) => l.text).slice(-1)[0]);
}

// C: VIP arrives while a fire burns
{
  const w = base(3);
  H.buildTower(w, [{ kind: 'build', room: 'hotelSuite', floor: 3, x: 152 }]);
  ev.startVip(w);
  const visit = w.events.find((e: any) => e.kind === 'vip');
  const cond = [...w.rooms.values()].find((r: any) => r.kind === 'office' && r.x === 100);
  while (w.time.minute < visit.arrivesAt - 1) tick(w);
  setOnFire(w, cond, true);
  w.events.push({ kind: 'fire', roomIds: [cond.id], startedAt: w.time.minute, spreadAt: w.time.minute + 10000 });
  tickMany(w, 3);
  const sim = w.sims.get(visit.simId);
  console.log('C VIP during fire: fireBurning', fireBurning(w), 'vip phase', visit.phase, 'vip state', sim?.state, 'floor', sim?.pos.floor);
}

// D: thief walks in while a fire burns
{
  const w = base(3);
  H.buildTower(w, [{ kind: 'build', room: 'shop', floor: 3, x: 100 }]);
  const cond = [...w.rooms.values()].find((r: any) => r.kind === 'office' && r.x === 127);
  setOnFire(w, cond, true);
  w.events.push({ kind: 'fire', roomIds: [cond.id], startedAt: w.time.minute, spreadAt: w.time.minute + 100000 });
  ev.startTheft(w, 6 * 60 + 5);
  tickMany(w, 10);
  const thief = [...w.sims.values()].find((s: any) => s.kind === 'thief');
  console.log('D thief during fire: fireBurning', fireBurning(w), 'thief', thief ? `${thief.state} floor ${thief.pos.floor}` : 'none', 'theft phase', w.events.find((e: any) => e.kind === 'theft')?.phase);
}

// E: trip.arrived to a room later demolished
{
  const w = base(1);
  const office = [...w.rooms.values()].find((r: any) => r.kind === 'office');
  const beat = { code: 'trip.arrived', minute: 500, simId: 12345, roomId: office.id, value: 7 };
  const before = [0, 1, 2].map(() => story.describeBeat(beat, w));
  w.rooms.delete(office.id);
  const after = story.describeBeat(beat, w);
  console.log('E before:', before[0], '| after demolish:', after);
}

// F: daily opening when the saved daily is from a later date (clock went back / travelled west)
console.log('F', daily.dailyOpening({ date: '2026-09-25', finished: false }, '2026-09-24'), daily.dailyOpening({ date: '2026-09-25', finished: true }, '2026-09-24'));
// F2: date stability across TZ: start and twist depend only on the date string
console.log('F2', daily.dailyStart('2026-11-01'), daily.dailyTwist('2026-11-01').id, daily.localDateKey(new Date(2026, 2, 8, 2, 30)), daily.localDateKey(new Date(2026, 10, 1, 1, 30)));

// G: chronicle tallies from the capped recent list
{
  const w = base(1);
  story.recordBeat(w.story, { code: 'theft.caught', minute: 10, simId: 1, roomId: 1 });
  story.recordBeat(w.story, { code: 'theft.escaped', minute: 20, simId: 2, roomId: 1, value: 2000 });
  for (let i = 0; i < 260; i++) story.recordBeat(w.story, { code: 'wait.long', minute: 100 + i * 10, simId: 1000 + i, value: 6 });
  const hotel = [...w.rooms.values()][0];
  const c = chron.assembleChronicle(w);
  console.log('G', c.lines.filter((l: string) => l.startsWith('Thieves') || l.includes('moved out')).join(' | '));
}
