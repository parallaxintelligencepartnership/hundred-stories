import { base, applyCommand, tick, hhmm } from '../verifyB/common.ts';
const R = '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim';
const { setOnFire } = await import(R + '/world.ts');
const { fireBurning } = await import(R + '/people.ts');
function run(demolish: boolean) {
  const w: any = base(11, 100); w.stars = 2;
  applyCommand(w, { kind: 'shaft.build', shaft: 'standard', x: 190, floorMin: 1, floorMax: 3 });
  applyCommand(w, { kind: 'build', room: 'office', floor: 2, x: 120 });
  const office = [...w.rooms.values()].find((r: any) => r.kind === 'office');
  // same shape startFire pushes (events.ts:155-161)
  setOnFire(w, office, true);
  w.events.push({ kind: 'fire', roomIds: [office.id], startedAt: w.time.minute, spreadAt: w.time.minute + 30 });
  const cash0 = w.cash;
  if (demolish) console.log('  demolish burning office (occ ' + office.occupancy + '):', JSON.stringify(applyCommand(w, { kind: 'demolish', roomId: office.id })));
  console.log('  build security:', JSON.stringify(applyCommand(w, { kind: 'build', room: 'security', floor: 2, x: 150 })));
  const cashAfterBuild = w.cash;
  for (let i = 0; i < 200 && fireBurning(w); i++) tick(w);
  const line = w.log.filter((l: any) => /burned down/.test(l.text)).map((l: any) => l.text);
  console.log(`  [${hhmm(w.time.minute)}] fireBurning=${fireBurning(w)} cash change after building=${w.cash - cashAfterBuild} total=${w.cash - cash0} log=${JSON.stringify(line)}`);
}
console.log('A: demolish then security'); run(true);
console.log('B: control, security only'); run(false);
