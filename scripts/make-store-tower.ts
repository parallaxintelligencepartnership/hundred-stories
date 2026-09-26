// Builds the store tower (store/fixtures/store-tower.json), the save the store screenshots seed
// (scripts/make-store-shots.mjs FIXTURE). Design pass D-44: a tower a player could build, so every
// room is placed through applyCommand the way scripts/bench/bench3.ts buildTower does, the star
// rating is earned by ticking the sim, and every kind in it needs three stars or fewer. It ticks
// across a quarter boundary, so the status bar's quarter and day baselines are both set, and saves
// with save.ts serialize at 13:00 on a weekday.
//
//   npx vite-node@6.0.0 scripts/make-store-tower.ts
//
// vite-node is not a repo dependency; npx fetches that pinned version on demand. The demo tower
// (store/fixtures/demo-tower.json, every room kind) stays for the art captures.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCommand } from '../src/sim/build';
import { ROOMS, SHAFTS } from '../src/sim/rules';
import { serialize } from '../src/sim/save';
import { tick } from '../src/sim/tick';
import { clockOf, type Command, type RoomKind, type World } from '../src/sim/types';
import { createWorld } from '../src/sim/world';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'store', 'fixtures', 'store-tower.json');

const SEED = 4242; // the bench towers' seed
const START_CASH = 20_000_000; // enough to build it all, so the readout ends on a believable figure
const LEFT = 112; // the lobby spans the middle of the lot, where the game's opening shot looks
const WIDTH = 144; // sixteen offices
const OFFICE_TOP = 12; // offices on floors 2 to 12
const HOTEL = OFFICE_TOP + 1;
const SERVICES = OFFICE_TOP + 2;
const SHOPS = [OFFICE_TOP + 3, OFFICE_TOP + 4];
const DINING = OFFICE_TOP + 5;
const SHAFT_XS = [140, 186, 232];
const CARS = 8; // every shaft full (24 cars), so nobody in the shots gives up waiting
const SAVE_MINUTE_OF_DAY = 13 * 60;

function builder(world: World) {
  const refused: string[] = [];
  const cmd = (c: Command): boolean => {
    const r = applyCommand(world, c);
    if (!r.ok) refused.push(`${JSON.stringify(c)}: ${r.reason}`);
    return r.ok;
  };
  /** A row of one kind from x to the lobby's right edge. */
  const row = (room: RoomKind, floor: number, from = LEFT, to = LEFT + WIDTH): number => {
    let x = from;
    let n = 0;
    for (; x + ROOMS[room].width <= to; x += ROOMS[room].width) if (cmd({ kind: 'build', room, floor, x })) n++;
    return n;
  };
  const one = (room: RoomKind, floor: number, x: number): number => {
    cmd({ kind: 'build', room, floor, x });
    return x + ROOMS[room].width;
  };
  return { cmd, row, one, refused };
}

function tickUntil(world: World, done: (w: World) => boolean, limitMinutes: number): void {
  for (let i = 0; i < limitMinutes && !done(world) && !world.gameOver; i++) tick(world);
  if (world.gameOver) throw new Error(`game over: ${world.gameOver.reason}`);
}

function buildStoreTower(): World {
  const world = createWorld(SEED);
  world.cash = START_CASH;
  const { cmd, row, one, refused } = builder(world);

  // One star: the lobby, standard shafts with cars, the office floors and the hotel floor's frame.
  row('lobby', 1);
  for (const x of SHAFT_XS) cmd({ kind: 'shaft.build', shaft: 'standard', x, floorMin: -3, floorMax: DINING });
  for (const shaft of [...world.shafts.values()]) for (let c = 1; c < CARS; c++) cmd({ kind: 'shaft.addCar', shaftId: shaft.id });
  for (let f = 2; f <= OFFICE_TOP; f++) row('office', f);

  // Two stars at 300 people: the hotel floor with a suite, and security and housekeeping on a
  // second hotel floor.
  tickUntil(world, (w) => w.stars >= 2, 20 * 1440);
  let x = one('hotelSuite', HOTEL, LEFT);
  x = one('hotelTwin', HOTEL, x);
  x = one('hotelTwin', HOTEL, x);
  row('hotelSingle', HOTEL, x);
  x = one('security', SERVICES, LEFT);
  x = one('housekeeping', SERVICES, x);
  x = one('hotelTwin', SERVICES, x);
  row('hotelSingle', SERVICES, x);

  // Three stars at 1,000 people with a security office: shops, dining, parking, recycling.
  tickUntil(world, (w) => w.stars >= 3, 30 * 1440);
  if (world.stars < 3) throw new Error(`stuck at ${world.stars} stars, population ${world.population}`);
  for (const f of SHOPS) row('shop', f);
  x = one('restaurant', DINING, LEFT);
  x = one('fastFood', DINING, x);
  row('shop', DINING, x);
  x = one('parkingRamp', -1, LEFT);
  row('parkingSpace', -1, x);
  one('recycling', -3, LEFT);

  // On across the next quarter boundary, to 13:00 on a weekday.
  const quarterStart = (Math.floor(world.time.minute / 4320) + 1) * 4320;
  tickUntil(world, (w) => w.time.minute >= quarterStart, 10 * 1440);
  tickUntil(world, (w) => {
    const c = clockOf(w.time.minute);
    return !c.isWeekend && c.minuteOfDay === SAVE_MINUTE_OF_DAY;
  }, 3 * 1440);

  if (refused.length > 0) console.error(`${refused.length} commands refused:\n${refused.join("\n")}`);
  return world;
}

{
  const world = buildStoreTower();
  const kinds = new Map<string, number>();
  for (const r of world.rooms.values()) kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1);
  writeFileSync(OUT, serialize(world));
  const c = clockOf(world.time.minute);
  console.log(`stars ${world.stars}, population ${world.population} (day start ${world.dayStartPopulation}), cash ${world.cash} (quarter start ${world.quarterStartCash})`);
  console.log(`day ${Math.floor(world.time.minute / 1440)} ${c.hour}:00, weekend ${c.isWeekend}, cars ${[...world.shafts.values()].reduce((n, s) => n + s.cars.length, 0)} of max ${SHAFTS.standard.maxCars * SHAFT_XS.length}`);
  console.log([...kinds].map(([k, n]) => `${k} ${n}`).join(', '));
  console.log('wrote', OUT);
}
