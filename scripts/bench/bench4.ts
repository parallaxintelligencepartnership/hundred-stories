// Replay game.ts step() exactly, with real ticks, on a medium tower at 4x.
import { applyCommand } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/build';
import { ROOMS, SHAFTS, SCHEDULES } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/rules';
import { createWorld } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/world';
import { tick } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/tick';
import { serialize } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/save';
import { clockOf, type Command, type World } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/types';

function buildTower(officeFloors: number, lobbyWidth: number, shaftXs: number[]): World {
  const world = createWorld(4242);
  world.cash = 5_000_000_000;
  const ok = (c: Command) => applyCommand(world, c).ok;
  for (let x = 0; x < lobbyWidth; x++) ok({ kind: 'build', room: 'lobby', floor: 1, x } as Command);
  const top = officeFloors + 1;
  for (const x of shaftXs) ok({ kind: 'shaft.build', shaft: 'standard', x, floorMin: 1, floorMax: top } as Command);
  for (const s of [...world.shafts.values()]) for (let c = 1; c < SHAFTS.standard.maxCars; c++) ok({ kind: 'shaft.addCar', shaftId: s.id } as Command);
  const OW = ROOMS.office.width;
  for (let f = 2; f <= top; f++) for (let x = 0; x + OW <= lobbyWidth; x += OW) ok({ kind: 'build', room: 'office', floor: f, x } as Command);
  for (let x = 0; x + 16 <= lobbyWidth; x += 16) ok({ kind: 'build', room: 'fastFood', floor: top, x } as Command);
  return world;
}

const world = buildTower(14, 280, [20, 100, 180, 260]);
while (world.time.minute < 3 * 1440 + 8 * 60) tick(world);
console.log(`tower: pop ${world.population}, rooms ${world.rooms.size}, sims ${world.sims.size}`);

const TICKS_PER_SECOND_AT_1X = 10, NIGHT_MULTIPLIER = 8, MAX_TICKS_PER_FRAME = 240;
const MAX_STEP_MS = Number(process.env.STEP_MS ?? 8) || Infinity;
const speed = 4;
const isNight = () => { const m = clockOf(world.time.minute).minuteOfDay; return m >= SCHEDULES.nightStart || m < SCHEDULES.nightEnd; };

let accumulator = 0;
let last = performance.now();
let worstStepMs = 0, worstN = 0, steps = 0, totalTicks = 0;
const stepMs: number[] = [];
const startedAt = performance.now();
// run ~20 real seconds of the loop, sleeping the remainder of each 50 ms slot
while (performance.now() - startedAt < 20000) {
  const slotStart = performance.now();
  const now = performance.now();
  const dt = Math.min(1, (now - last) / 1000 || 0);
  last = now;
  const rate = TICKS_PER_SECOND_AT_1X * speed * (isNight() ? NIGHT_MULTIPLIER : 1);
  accumulator += dt * rate;
  let n = 0;
  while (accumulator >= 1 && n < MAX_TICKS_PER_FRAME) {
    tick(world);
    accumulator -= 1;
    n++;
    if (performance.now() - now >= MAX_STEP_MS) {
      accumulator -= Math.floor(accumulator); // drop the whole missed ticks, keep the fraction
      break;
    }
  }
  if (accumulator > MAX_TICKS_PER_FRAME) accumulator = 0;
  const ms = performance.now() - slotStart;
  stepMs.push(ms);
  steps++; totalTicks += n;
  if (ms > worstStepMs) { worstStepMs = ms; worstN = n; }
  // emulate the 50 ms timer: busy-wait the remainder (a real browser would be idle here)
  const until = slotStart + 50;
  while (performance.now() < until) { /* idle */ }
}
const s = [...stepMs].sort((a, b) => a - b);
console.log(`steps ${steps}, ticks ${totalTicks}, sim minutes ${totalTicks}`);
console.log(`step ms: median ${s[Math.floor(s.length/2)]!.toFixed(2)}, p95 ${s[Math.floor(s.length*0.95)]!.toFixed(2)}, max ${worstStepMs.toFixed(1)} (${worstN} ticks in that step)`);
console.log(`steps over the 50 ms budget: ${stepMs.filter((m) => m > 50).length} of ${steps}`);
console.log(`steps over 200 ms (a visible hitch): ${stepMs.filter((m) => m > 200).length}`);
console.log(`serialize now: ${serialize(world).length} bytes`);
