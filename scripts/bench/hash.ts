// Determinism check for the three bench towers: same seed, same ticks, same hash.
// Run with `npx vite-node scripts/bench/hash.ts`. The six hashes it prints must not
// change when the simulation is optimized; a different hash means different behaviour.
import { applyCommand } from '../../src/sim/build';
import { ROOMS, SHAFTS } from '../../src/sim/rules';
import { createWorld } from '../../src/sim/world';
import { tick } from '../../src/sim/tick';
import { hashWorld } from '../../src/sim/save';
import type { Command, World } from '../../src/sim/types';

// Copied from scripts/bench/bench3.ts so the two scripts build the same towers.
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

const configs: [string, number, number, number[]][] = [
  ['small', 9, 180, [20, 100]],
  ['medium', 14, 280, [20, 100, 180, 260]],
  ['large', 20, 375, [10, 60, 110, 160, 210, 260, 310]],
];

const runTo = (world: World, target: number): void => {
  while (world.time.minute < target && !world.gameOver) tick(world);
};

console.log('label\tstage\tminute\tpop\thash');
for (const [label, floors, width, xs] of configs) {
  const world = buildTower(floors, width, xs);
  const first = 3 * 1440 + 8 * 60;
  runTo(world, first);
  console.log([label, 'day4-0800', world.time.minute, world.population, hashWorld(world)].join('\t'));
  runTo(world, first + 1440);
  console.log([label, 'day5-0800', world.time.minute, world.population, hashWorld(world)].join('\t'));
}
