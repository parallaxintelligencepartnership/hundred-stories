import { applyCommand } from '../../src/sim/build';
import { ROOMS, SHAFTS } from '../../src/sim/rules';
import { createWorld } from '../../src/sim/world';
import { tick } from '../../src/sim/tick';
import { serialize, hashWorld } from '../../src/sim/save';
import type { Command, World } from '../../src/sim/types';

function median(a: number[]) { const s=[...a].sort((x,y)=>x-y); return s[Math.floor(s.length/2)]!; }

function buildTower(officeFloors: number, lobbyWidth: number, shaftXs: number[]): World {
  const world = createWorld(4242);
  world.cash = 5_000_000_000;
  const ok = (c: Command) => applyCommand(world, c).ok;
  for (let x = 0; x < lobbyWidth; x++) ok({ kind: 'build', room: 'lobby', floor: 1, x } as Command);
  const top = officeFloors + 1;
  for (const x of shaftXs) ok({ kind: 'shaft.build', shaft: 'standard', x, floorMin: 1, floorMax: top } as Command);
  for (const shaft of [...world.shafts.values()]) for (let c = 1; c < SHAFTS.standard.maxCars; c++) ok({ kind: 'shaft.addCar', shaftId: shaft.id } as Command);
  const OW = ROOMS.office.width;
  for (let f = 2; f <= top; f++) for (let x = 0; x + OW <= lobbyWidth; x += OW) ok({ kind: 'build', room: 'office', floor: f, x } as Command);
  for (let x = 0; x + 16 <= lobbyWidth; x += 16) ok({ kind: 'build', room: 'fastFood', floor: top, x } as Command);
  return world;
}

console.log('label\tpop\tsims\trooms\ttickMedMs\ttickP95Ms\tserMs\thashMs\tjsonBytes');
const configs: [string, number, number, number[]][] = [
  ['small', 9, 180, [20, 100]],
  ['medium', 14, 280, [20, 100, 180, 260]],
  ['large', 20, 375, [10, 60, 110, 160, 210, 260, 310]],
];
for (const [label, floors, width, xs] of configs) {
  const world = buildTower(floors, width, xs);
  // warm up: two game days, then to 09:00 on day 3 (the morning rush)
  const target = 3 * 1440 + 9 * 60;
  const t0 = performance.now();
  while (world.time.minute < target && !world.gameOver) tick(world);
  const warmMs = performance.now() - t0;
  const json = serialize(world);
  const ser: number[] = [], hsh: number[] = [], tk: number[] = [];
  for (let i=0;i<20;i++){ const t=performance.now(); serialize(world); ser.push(performance.now()-t); }
  for (let i=0;i<20;i++){ const t=performance.now(); hashWorld(world); hsh.push(performance.now()-t); }
  for (let i=0;i<200;i++){ const t=performance.now(); tick(world); tk.push(performance.now()-t); }
  const s=[...tk].sort((a,b)=>a-b);
  console.log([label, world.population, world.sims.size, world.rooms.size, median(tk).toFixed(3), s[190]!.toFixed(3), median(ser).toFixed(2), median(hsh).toFixed(2), json.length].join('\t'));
  console.error(`${label}: warmup ${(warmMs/1000).toFixed(1)}s for ${target} ticks`);
}
