import { base, applyCommand, tick, hhmm, realOcc } from './common.ts';
const R = '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim';
const { handleEventCommand } = await import(R + '/events.ts');
const { setOnFire } = await import(R + '/world.ts');
const mode = process.argv[2] ?? 'demolish';
const w = base(11, 100);
const HOME = process.argv[3] ?? 'office', EAT = HOME === 'condo' ? 'restaurant' : 'fastFood';
w.stars = 3;
for (let x = 100; x < 196 - (HOME === 'condo' ? 15 : 8); x += HOME === 'condo' ? 16 : 9) applyCommand(w, { kind: 'build', room: HOME, floor: 2, x });
console.log('eat', JSON.stringify(applyCommand(w, { kind: 'build', room: EAT, floor: 3, x: 100 })));
applyCommand(w, { kind: 'shaft.build', shaft: 'standard', x: 197, floorMin: 1, floorMax: 3 });
const ff = [...w.rooms.values()].find(r => r.kind === EAT);
const offices = [...w.rooms.values()].filter(r => r.kind === HOME);
let hit;
for (let i = 0; i < 4 * 1440 && !hit; i++) {
  tick(w);
  for (const o of offices) {
    if (mode === 'demolish' && o.occupancy !== 0) continue;
    const t = o.tenants.map(id => w.sims.get(id)).find(s => s && s.state === 'inRoom' && s.inRoomId === ff.id);
    if (t) { hit = { o, t }; break; }
  }
}
if (!hit) throw new Error('no hit');
const { o, t } = hit;
console.log(`[${hhmm(w.time.minute)}] worker ${t.id} is in the fast food (ff occupancy ${ff.occupancy}, real ${realOcc(w, ff)}); its office ${o.id} occupancy ${o.occupancy}`);
if (mode === 'demolish') console.log('  demolish office:', JSON.stringify(applyCommand(w, { kind: 'demolish', roomId: o.id })));
else {
  setOnFire(w, o, true);
  w.events.push({ kind: 'fire', roomIds: [o.id], startedAt: w.time.minute, spreadAt: w.time.minute + 100000 });
  console.log('  fire in its office, helicopter:', JSON.stringify(handleEventCommand(w, { kind: 'fire.callHelicopter' })), 'office exists', w.rooms.has(o.id));
}
console.log(`  right after: worker exists ${w.sims.has(t.id)} state ${t.state} inRoomId ${t.inRoomId}; ff occupancy ${ff.occupancy} real ${realOcc(w, ff)}`);
for (let i = 1; i <= 3 * 1440; i++) {
  tick(w);
  const md = w.time.minute % 1440;
  if (md === 3 * 60 || i === 60) console.log(`  [${hhmm(w.time.minute)}] ff occupancy ${ff.occupancy} real ${realOcc(w, ff)}  worker exists ${w.sims.has(t.id)}`);
}
console.log('  demolish the', EAT, 'at night with nobody really inside:', JSON.stringify(applyCommand(w, { kind: 'demolish', roomId: ff.id })), 'occ', ff.occupancy, 'real', realOcc(w, ff));
