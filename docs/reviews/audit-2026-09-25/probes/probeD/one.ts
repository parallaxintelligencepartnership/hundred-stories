import { readFileSync } from 'node:fs';
import { tick } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/tick';
import { serialize, deserialize } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/save';
const name = process.env.MUT!;
const d: any = JSON.parse(readFileSync('/private/tmp/claude-501/-Users-matthew-parallax-private-Projects-hundred-stories/59100aac-82b1-4a98-947c-f0845463d155/scratchpad/audit/probeD/base.json', 'utf8'));
const last = d.rooms.length - 1;
const M: Record<string, () => void> = {
  shaftWidth: () => { delete d.shafts[0].width; },
  shaftCarsEmpty: () => { d.shafts[0].cars = []; },
  guard: () => { d.sims[0].guard = { task: 'respond', respond: 5 }; },
  gameOverEmpty: () => { d.gameOver = {}; },
  logNull: () => { d.log = [null]; },
  hallFloor0: () => { d.shafts[0].hallCalls = [[0, { up: ['office'], down: [] }]]; },
  rngFrac: () => { d.rngState = 1.5; },
  roomHeightBig: () => { d.rooms[last].height = 1e9; },
  roomWidthBig: () => { d.rooms[last].width = 1e9; },
  shaftX: () => { d.shafts[0].width = 1e9; },
  lobbyGone: () => { d.rooms = d.rooms.filter((r: any) => r.kind !== 'lobby'); },
  homeFloorBad: () => { d.shafts[0].homeFloor = 55; },
  schedIdx: () => { d.sims.forEach((s: any) => { s.nextScheduleIndex = 99; }); },
  scheduleNull: () => { d.sims[0].schedule = [null]; },
  statsLastQ: () => { delete d.stats.lastQuarter; },
};
M[name]!();
const t0 = Date.now();
const r = deserialize(JSON.stringify(d));
const tl = Date.now() - t0; console.log(name, 'deserialize returned', (r as any).ok, tl + 'ms');
if (!r.ok) { console.log(name, 'REFUSED', r.reason, tl + 'ms'); process.exit(0); }
let err = '';
let i = 0;
try { for (; i < 1500; i++) { tick(r.world); if (i % 100 === 0) console.log('  tick', i, Date.now() - t0, 'ms'); } } catch (e) { err = String((e as Error).message).slice(0, 100); }
try { serialize(r.world); } catch (e) { err += ' | serialize threw'; }
console.log(name, 'LOADED in', tl + 'ms', err ? 'THROWS at tick ' + i + ': ' + err : 'ran 1500 ticks ok', (Date.now() - t0) + 'ms');
