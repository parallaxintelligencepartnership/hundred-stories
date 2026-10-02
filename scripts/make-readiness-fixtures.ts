// Builds the saved towers the readiness shots seed (scripts/make-readiness-shots.mjs), from the real
// sim and save code, into docs/reviews/readiness-2026-10-01/fixtures/ (gitignored).
//
//   npx vite-node@6.0.0 scripts/make-readiness-fixtures.ts
//
// Every tower starts from the committed store tower (store/fixtures/store-tower.json, itself built
// by scripts/make-store-tower.ts through applyCommand and real ticks: 3 stars, offices, two hotel
// floors, security and housekeeping, shops, dining, parking, a recycling center, three elevators).
// From there each state is reached the way it happens in play: real ticks (src/sim/tick.ts), the
// player's own commands (src/sim/build.ts applyCommand: build, shaft.setStop, shaft.removeCar), and
// the sim's own event starters at the 6 AM roll (src/sim/events.ts startFire, startBomb), which are
// what rollDailyEvents calls when its roll comes up. No field is written by hand. Each save is
// serialize()d (src/sim/save.ts), read back with deserialize() and checked before it is written, and
// the towers whose state the shots reach by letting the game run (the VIP booking and the poor VIP
// result) are checked by running that same read-back save forward here, exactly as the game will.
//
// The files, and what each is for:
//   incidents-rich.json    (a) a fire and a bomb threat live at once, cash covers the helicopter and the ransom
//   incidents-poor.json    (b) the same, after the player spent the cash down below both prices
//   vip-booking-soon.json  (c, live) a few minutes before the 6 AM roll that books a VIP (the booking card comes from that live line)
//   vip-booked.json        (c) just after that roll: a VIP booked for tomorrow
//   vip-done-good.json     (d) a finished visit saved in stats.lastVip, rated good or fair
//   vip-poor-soon.json     (d, poor) the booked VIP minutes from arriving at a suite floor the player took the elevator stops off: the visit ends poor on arrival
//   problems.json          (e) a long elevator queue, rooms with no way in, dirty hotel rooms housekeeping cannot reach, a waste backlog with made against collected, a room on the move-out countdown
//   healthy.json           (f) the store tower at the first quiet moment with no tower problem at all; nobody followed, so Stories shows the Following hint
//
// A state the sim does not reach within its search limit is printed as NOT REACHED and that file is
// not written; the shots script reports the shots that need it as NOT-CAPTURED.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCommand } from '../src/sim/build';
import { helicopterCost, startBomb, startFire } from '../src/sim/events';
import { EVENTS, RENT, ROOMS } from '../src/sim/rules';
import { deserialize, hashWorld, serialize } from '../src/sim/save';
import { tick } from '../src/sim/tick';
import { clockOf, type Command, type RoomKind, type World } from '../src/sim/types';
import { towerProblems, type ProblemKind } from '../src/ui/problems';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURE_DIR = join(ROOT, 'docs', 'reviews', 'readiness-2026-10-01', 'fixtures');
const BASE = join(ROOT, 'store', 'fixtures', 'store-tower.json');

const DAY = 1440;
const ROLL = 6 * 60;

// ------------------------------------------------------------------ helpers

function load(text: string): World {
  const r = deserialize(text);
  if (!r.ok) throw new Error(`deserialize refused: ${r.reason}`);
  return r.world;
}

/** A copy through the save format, as the game would have it after a load. */
function copy(world: World): World {
  return load(serialize(world));
}

function ticks(world: World, n: number): void {
  for (let i = 0; i < n; i++) {
    tick(world);
    if (world.gameOver) throw new Error(`game over: ${world.gameOver.reason}`);
  }
}

/** On to the next time this minute of the day comes round (not now). */
function toNext(world: World, minuteOfDay: number): void {
  const now = clockOf(world.time.minute).minuteOfDay;
  ticks(world, ((minuteOfDay - now + DAY) % DAY) || DAY);
}

function cmd(world: World, c: Command): boolean {
  return applyCommand(world, c).ok;
}

function clock(world: World): string {
  const c = clockOf(world.time.minute);
  return `day ${Math.floor(world.time.minute / DAY)} ${String(c.hour).padStart(2, '0')}:${String(c.minuteOfDay % 60).padStart(2, '0')}`;
}

const written: string[] = [];
const notReached: string[] = [];

function write(name: string, world: World, note: string): void {
  const text = serialize(world);
  const back = load(text);
  if (hashWorld(back) !== hashWorld(world)) throw new Error(`${name}: the save does not read back to the same world`);
  writeFileSync(join(FIXTURE_DIR, `${name}.json`), text);
  written.push(name);
  console.log(`wrote ${name}.json at ${clock(world)}, cash ${world.cash}: ${note}`);
}

function miss(name: string, why: string): void {
  notReached.push(name);
  console.log(`NOT REACHED ${name}: ${why}`);
}

/** The player spends: rooms built floor by floor over the top of the tower until cash is under `below`. */
function spendDown(world: World, below: number): void {
  const kinds: RoomKind[] = ['medical', 'cinema', 'partyHall', 'shop', 'office', 'lobby'];
  let top = Math.max(...[...world.rooms.values()].map((r) => r.floor + ROOMS[r.kind].height - 1));
  let left = Math.min(...[...world.rooms.values()].map((r) => r.x));
  let right = Math.max(...[...world.rooms.values()].filter((r) => r.floor === top).map((r) => r.x + r.width));
  for (let guard = 0; guard < 60 && world.cash >= below; guard++) {
    const floor = top + 1;
    let built = 0;
    for (const kind of kinds) {
      const cost = ROOMS[kind].cost;
      // A big room while far over; small ones to land just under.
      if (world.cash - cost < 0) continue;
      if (world.cash - below > 400_000 && cost < 100_000) continue;
      for (let x = left; x + ROOMS[kind].width <= right && world.cash >= below; x += 1) {
        if (cmd(world, { kind: 'build', room: kind, floor, x })) built++;
      }
    }
    if (built === 0) break;
    const onFloor = [...world.rooms.values()].filter((r) => r.floor === floor);
    top = Math.max(top, ...onFloor.map((r) => r.floor + ROOMS[r.kind].height - 1));
    left = Math.min(...onFloor.map((r) => r.x));
    right = Math.max(...onFloor.map((r) => r.x + r.width));
  }
}

// ------------------------------------------------------------------ (a) and (b): fire and bomb

function incidents(base: World, poor: boolean): void {
  const name = poor ? 'incidents-poor' : 'incidents-rich';
  const world = copy(base);
  // On to the 6 AM roll; a fire or bomb the roll itself starts is kept, the other is started as
  // the roll would start it.
  toNext(world, ROLL);
  if (poor) spendDown(world, Math.min(EVENTS.fire.helicopterCost, EVENTS.bomb.ransom) - 20_000);
  if (!world.events.some((e) => e.kind === 'fire')) startFire(world);
  if (!world.events.some((e) => e.kind === 'bomb')) startBomb(world);
  ticks(world, 2);
  const fire = world.events.find((e) => e.kind === 'fire');
  const bomb = world.events.find((e) => e.kind === 'bomb');
  if (!fire || fire.kind !== 'fire' || !bomb || bomb.kind !== 'bomb') {
    miss(name, 'the fire or the bomb did not start (no room for it to pick)');
    return;
  }
  const heli = helicopterCost(world, fire);
  const ransom = bomb.ransom;
  const covers = world.cash >= heli && world.cash >= ransom;
  const short = world.cash < heli && world.cash < ransom;
  if (poor ? !short : !covers) {
    miss(name, `cash ${world.cash} against a helicopter at ${heli} and a ransom of ${ransom}`);
    return;
  }
  write(name, world, `fire in room ${fire.roomIds.join(',')}, bomb in room ${bomb.roomId}, helicopter ${heli}, ransom ${ransom}`);
}

// ------------------------------------------------------------------ (c) and (d): the VIP

function vip(base: World): void {
  // The first 6 AM roll that books a VIP: tried on a copy each day, so the tower saved before it
  // carries the very rng state that books it.
  const world = copy(base);
  let soon: World | null = null;
  let booked: World | null = null;
  for (let day = 0; day < 30 && !booked; day++) {
    toNext(world, ROLL - 6);
    const trial = copy(world);
    ticks(trial, 7);
    const visit = trial.events.find((e) => e.kind === 'vip');
    if (visit && visit.kind === 'vip' && visit.phase === 'notice' && trial.log.some((l) => l.minute >= world.time.minute && /^A VIP, /.test(l.text))) {
      soon = copy(world);
      booked = trial;
    }
  }
  if (!soon || !booked) {
    miss('vip-booking-soon', 'no 6 AM roll booked a VIP in 30 days');
    miss('vip-booked', 'as above');
    miss('vip-done-good', 'as above');
    miss('vip-poor-soon', 'as above');
    return;
  }
  // The save the game will load books the VIP in the same minutes: checked from its own text.
  const replay = load(serialize(soon));
  ticks(replay, 7);
  if (!replay.events.some((e) => e.kind === 'vip')) miss('vip-booking-soon', 'the saved tower did not book the VIP when run forward from its own save');
  else write('vip-booking-soon', soon, 'the VIP is booked at the 6 AM roll, 6 minutes on');
  write('vip-booked', booked, 'a VIP booked for tomorrow');

  // (d) good or fair: visits run to their end as they come, this one and the ones booked after it,
  // until one is rated fair or good. First as the tower stands; then with the player giving the
  // hotel two cars of its own in every elevator (shaft.setCarServes), as a player chasing a better
  // visit would.
  const outcomes: string[] = [];
  let found = false;
  for (const dedicate of [false, true]) {
    if (found) break;
    const done = copy(booked);
    if (dedicate) {
      for (const shaft of done.shafts.values()) {
        for (const car of shaft.cars.slice(0, 2)) cmd(done, { kind: 'shaft.setCarServes', shaftId: shaft.id, carId: car.id, serves: 'hotel' });
      }
    }
    let seen = -1;
    for (let i = 0; i < 90 * DAY && !found; i++) {
      ticks(done, 1);
      const last = done.stats.lastVip;
      if (!last || last.minute === seen) continue;
      seen = last.minute;
      outcomes.push(`${dedicate ? 'hotel cars' : 'as built'}: ${last.rating} (wait ${last.longestWait})`);
      if (last.rating !== 'poor') {
        ticks(done, 5);
        write('vip-done-good', done, `lastVip rated ${last.rating}${dedicate ? ', with two hotel cars per elevator' : ''}`);
        found = true;
      }
    }
  }
  if (!found) miss('vip-done-good', `every visit in 90 days ended poor: ${outcomes.join('; ')}`);

  // (d) poor: the player takes the stops off the suite's floor on every elevator, so on arrival the
  // VIP finds no way up and leaves. Saved a few minutes before the arrival.
  const poor = copy(booked);
  const visit = poor.events.find((e) => e.kind === 'vip');
  if (!visit || visit.kind !== 'vip' || visit.suiteId === null) {
    miss('vip-poor-soon', 'no booked suite');
    return;
  }
  const suite = poor.rooms.get(visit.suiteId);
  if (!suite) {
    miss('vip-poor-soon', 'the booked suite is gone');
    return;
  }
  const lead = 4;
  ticks(poor, Math.max(0, visit.arrivesAt - lead - poor.time.minute));
  for (const shaft of poor.shafts.values()) {
    if (shaft.stops.has(suite.floor)) cmd(poor, { kind: 'shaft.setStop', shaftId: shaft.id, floor: suite.floor, stops: false });
  }
  const check = load(serialize(poor));
  for (let i = 0; i < 60 && !check.stats.lastVip; i++) ticks(check, 1);
  const result = check.stats.lastVip;
  if (!result || result.rating !== 'poor') miss('vip-poor-soon', `run forward from its save, the visit ${result ? `ended ${result.rating}` : 'had not ended within an hour'}`);
  else write('vip-poor-soon', poor, `arrives in ${visit.arrivesAt - poor.time.minute} minutes at suite floor ${suite.floor}, stops off; ends poor: ${result.reason ?? ''}`);
}

// ------------------------------------------------------------------ (e): tower problems

const WANTED: ProblemKind[] = ['wait', 'noWayIn', 'housekeepingReach', 'wasteBehind', 'moveOut'];

function problems(base: World): void {
  const world = copy(base);
  const keeping = [...world.rooms.values()].find((r) => r.kind === 'housekeeping');
  if (!keeping) {
    miss('problems', 'the base tower has no housekeeping office');
    return;
  }
  // The player takes the elevator stops off the housekeeping floor (its hotel rooms lose their way
  // in, and housekeeping its way to the other hotel floor), and sells cars down to two a shaft.
  for (const shaft of world.shafts.values()) {
    if (shaft.stops.has(keeping.floor)) cmd(world, { kind: 'shaft.setStop', shaftId: shaft.id, floor: keeping.floor, stops: false });
    while (shaft.cars.length > 2 && cmd(world, { kind: 'shaft.removeCar', shaftId: shaft.id }));
  }
  // And raises the rent to the top of the range on the offices of the lowest office floor, so
  // their rating drops and their tenants start the move-out countdown.
  const officeFloor = Math.min(...[...world.rooms.values()].filter((r) => r.kind === 'office').map((r) => r.floor));
  for (const room of world.rooms.values()) {
    if (room.kind === 'office' && room.floor === officeFloor) cmd(world, { kind: 'room.setRent', roomId: room.id, rent: RENT.max });
  }
  let best: { have: ProblemKind[]; world: World | null } = { have: [], world: null };
  for (let i = 0; i < 6 * DAY; i += 10) {
    ticks(world, 10);
    const list = towerProblems(world);
    const have = WANTED.filter((k) => list.some((p) => p.kind === k));
    const tally = list.find((p) => p.kind === 'wasteBehind')?.text.includes('Today the tower made') ?? false;
    if (have.length > best.have.length) best = { have, world: copy(world) };
    if (have.length === WANTED.length && tally) {
      write('problems', world, list.map((p) => p.kind).join(', '));
      return;
    }
  }
  const missing = WANTED.filter((k) => !best.have.includes(k));
  if (best.world) {
    write('problems', best.world, `best found, without ${missing.join(', ')}`);
    console.log(`  problems.json lacks: ${missing.join(', ')}`);
  } else miss('problems', `none of ${WANTED.join(', ')} came up in six days`);
}

// ------------------------------------------------------------------ (f): a healthy tower

function healthy(base: World): void {
  const world = copy(base);
  for (let i = 0; i < 3 * DAY; i += 10) {
    ticks(world, 10);
    if (towerProblems(world).length === 0 && !world.events.some((e) => e.kind === 'fire' || e.kind === 'bomb' || e.kind === 'theft')) {
      write('healthy', world, 'no tower problem, no incident, nobody followed');
      return;
    }
  }
  miss('healthy', 'no moment in three days with no tower problem');
}

// ------------------------------------------------------------------ run

{
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const base = load(readFileSync(BASE, 'utf8'));
  if (base.story.followed.length > 0) console.log(`note: the base tower follows ${base.story.followed.length} people`);
  incidents(base, false);
  incidents(base, true);
  vip(base);
  problems(base);
  healthy(base);
  console.log(`${written.length} written to ${FIXTURE_DIR}${notReached.length ? `; NOT REACHED: ${notReached.join(', ')}` : ''}`);
}
