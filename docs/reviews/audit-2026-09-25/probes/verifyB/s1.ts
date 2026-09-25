const R = '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim';
const { createWorld } = await import(R + '/world.ts');
const { applyCommand } = await import(R + '/build.ts');
const { tick } = await import(R + '/tick.ts');
const { clockOf } = await import(R + '/types.ts');
const { serialize, deserialize } = await import(R + '/save.ts').catch(() => ({}));

function run(serves) {
  const w = createWorld(11);
  for (let x = 100; x < 160; x++) applyCommand(w, { kind: 'build', room: 'lobby', floor: 1, x });
  for (const f of [2, 3]) { const r = applyCommand(w, { kind: 'build', room: 'office', floor: f, x: 100 }); if (!r.ok) throw new Error(r.reason); }
  applyCommand(w, { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 3 });
  const shaft = [...w.shafts.values()][0];
  if (serves !== 'any') console.log('setCarServes', JSON.stringify(applyCommand(w, { kind: 'shaft.setCarServes', shaftId: shaft.id, carId: shaft.cars[0].id, serves })));
  const offices = [...w.rooms.values()].filter(r => r.kind === 'office');
  const cash0 = w.cash;
  let maxOcc = 0; const rows = [];
  const END = 4320 + 300 + 61; // past the next quarter start (day 3, 05:00)
  while (w.time.minute < END) {
    const c = clockOf(w.time.minute);
    tick(w);
    for (const o of offices) maxOcc = Math.max(maxOcc, o.occupancy);
    if (c.minuteOfDay === 12 * 60 || (c.dayOfQuarter === 0 && c.minuteOfDay === 301)) {
      const states = {}; for (const s of w.sims.values()) if (s.kind === 'worker') states[s.state] = (states[s.state] ?? 0) + 1;
      rows.push(`  min ${w.time.minute} day ${Math.floor(w.time.minute/1440)} ${String(Math.floor(c.minuteOfDay/60)).padStart(2,'0')}:${String(c.minuteOfDay%60).padStart(2,'0')} cash ${w.cash} (delta ${w.cash - cash0}) population ${w.population} stars ${w.stars} vacant ${offices.map(o=>o.vacant).join('/')} occ ${offices.map(o=>o.occupancy).join('/')} eval ${offices.map(o=>o.eval.toFixed(2)).join('/')} workers ${JSON.stringify(states)}`);
    }
  }
  console.log(`== car serves ${serves}`);
  console.log(rows.join('\n'));
  console.log(`  lastQuarter ${JSON.stringify(w.stats.lastQuarter)} maxOfficeOccupancySeen ${maxOcc}`);
  console.log('  log:', w.log.filter(l => /office|quarter/i.test(l.text)).map(l => `[${l.minute}] ${l.text}`).join(' | '));
}
run('hotel');
run('any');
