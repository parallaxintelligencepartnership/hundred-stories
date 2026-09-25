import { base, applyCommand, tick, hhmm } from '../verifyB/common.ts';
const R = '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim';
const { populationOf } = await import(R + '/stars.ts');
const { ROOMS } = await import(R + '/rules.ts');
const w = base(11, 100);
w.stars = 2;
for (let x = 100; x < 180; x += 4) applyCommand(w, { kind: 'build', room: 'hotelSingle', floor: 2, x });
applyCommand(w, { kind: 'build', room: 'housekeeping', floor: 3, x: 100 });
applyCommand(w, { kind: 'shaft.build', shaft: 'standard', x: 190, floorMin: 1, floorMax: 3 });
const hk = [...w.rooms.values()].find((r: any) => r.kind === 'housekeeping');
// population a guest-based count would give: hotel rooms with a guest physically in
const truePop = () => { let p = 0; for (const r of w.rooms.values() as any) { if (r.kind === 'hotelSingle') { const guestIn = [...w.sims.values()].some((s: any) => s.kind === 'guest' && s.inRoomId === r.id); if (guestIn) p += ROOMS.hotelSingle.capacity; } else if ((r.kind==='office'||r.kind==='condo') && !r.vacant) p += ROOMS[r.kind].capacity; } return p; };
let printedDuring = 0, done = false;
for (let i = 0; i < 6 * 1440 && !done; i++) {
  const keeper = [...w.sims.values()].find((s: any) => s.kind === 'staff' && s.state === 'inRoom' && s.inRoomId !== hk.id) as any;
  const md = w.time.minute % 1440;
  if (keeper && md % 60 === 0 && printedDuring === 0) {
    const room = w.rooms.get(keeper.inRoomId) as any;
    console.log(`[${hhmm(w.time.minute)}] BEFORE recompute tick: keeper ${keeper.id} in hotel room ${room.id} occ=${room.occupancy} tenants=${room.tenants.length} dirty=${room.dirty} stayUntil=${hhmm(keeper.stayUntil)}; world.population=${w.population} populationOf=${populationOf(w)} guestCount=${truePop()}`);
    tick(w); // this tick runs recomputeStars at :00
    console.log(`[${hhmm(w.time.minute - 1)}] DURING (after hourly recompute): world.population=${w.population} populationOf=${populationOf(w)} guestCount=${truePop()} stars=${w.stars}`);
    printedDuring = keeper.stayUntil;
    continue;
  }
  if (printedDuring && w.time.minute > printedDuring + 60 && md % 60 === 1) {
    console.log(`[${hhmm(w.time.minute)}] AFTER (next recompute, keeper gone): world.population=${w.population} populationOf=${populationOf(w)} guestCount=${truePop()}`);
    done = true; continue;
  }
  tick(w);
}
