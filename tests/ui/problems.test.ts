// Tower problems (src/ui/problems.ts): what is wrong in the tower right now, read from real worlds
// built with the sim's own commands and ticked. Each kind appears with the right floors and numbers
// and is gone once it stops being true; a move-out that already happened is not a problem.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyCommand } from '../../src/sim/build';
import { EVENT_TEST_HOOKS, resetEventTestHooks } from '../../src/sim/events';
import { tickMany } from '../../src/sim/tick';
import type { Command, Room, Sim, World } from '../../src/sim/types';
import { ROOMS } from '../../src/sim/rules';
import { addRoom, addSim, allocId, createWorld, log, LONG_WAIT_MINUTES } from '../../src/sim/world';
import { OPEN_CENTER, OPEN_ELEVATOR, SHOW_FLOOR, SHOW_ROOM, timeLeftWords, towerProblems, type TowerProblem } from '../../src/ui/problems';
import { atOnDay, buildRow, buildTower, lobbyRun, onlyShaft, roomsMatching } from '../scenarios/helpers';

beforeEach(() => {
  resetEventTestHooks();
  EVENT_TEST_HOOKS.chance = { fire: 0, bomb: 0, vip: 0, theft: 0 };
});
afterEach(() => resetEventTestHooks());

const ofKind = (world: World, kind: TowerProblem['kind']): TowerProblem[] => towerProblems(world).filter((p) => p.kind === kind);
const noDashes = (text: string): void => {
  expect(text).not.toMatch(/—|–| - /);
  expect(text).not.toMatch(/\bday \d/i);
  expect(text).not.toMatch(/\bseed\b/i);
};

function rich(world: World): World {
  world.cash = 500_000_000;
  world.stars = 3;
  return world;
}

describe('tower problems: an empty tower', () => {
  it('has none', () => {
    expect(towerProblems(createWorld(1))).toEqual([]);
    const world = rich(createWorld(2));
    buildTower(world, [...lobbyRun(90, 200), { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 4 }, ...buildRow('office', 2, [100])]);
    expect(towerProblems(world)).toEqual([]);
  });
});

describe('tower problems: elevator waits', () => {
  /** Lobby, one shaft 1 to 12 (its car at the lobby), offices up to 12; nine people waiting on 12. */
  function queue(): { world: World; shaftId: number } {
    const world = rich(createWorld(3));
    const script: Command[] = [...lobbyRun(90, 200), { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 12 }];
    for (let f = 2; f <= 12; f++) script.push(...buildRow('office', f, [100]));
    buildTower(world, script);
    // Two in the morning: nobody else is about.
    atOnDay(world, 1, 2, 0);
    const shaft = onlyShaft(world);
    const office = roomsMatching(world, 'office', { floor: 12 })[0] as Room;
    for (let i = 0; i < 9; i++) {
      addSim(world, {
        id: allocId(world), kind: 'shopper', homeRoomId: null, pos: { floor: 12, x: shaft.x }, inCarId: null, inRoomId: null,
        route: [{ kind: 'ride', shaftId: shaft.id, fromFloor: 12, toFloor: 1 }, { kind: 'walk', toX: 100 }],
        state: 'waiting', stress: 0, waitStart: world.time.minute - (i === 0 ? 7 : 2),
        schedule: [{ minuteOfDay: 0, days: ['weekday', 'weekend'], goal: { kind: 'room', roomId: office.id }, stayMinutes: 1 }],
        nextScheduleIndex: 1, stayUntil: null, wallet: 0, leaveReason: null,
      } as unknown as Sim);
    }
    return { world, shaftId: shaft.id };
  }

  it('names the floor, how many wait, the longest wait, and opens the worst elevator; gone once the car takes them', () => {
    const { world, shaftId } = queue();
    const waits = ofKind(world, 'wait');
    expect(waits).toHaveLength(1);
    const [wait] = waits as [TowerProblem];
    expect(wait.floors).toEqual([12]);
    expect(wait.count).toBe(9);
    expect(wait.minutes).toBe(7);
    expect(wait.shaftId).toBe(shaftId);
    expect(wait.text).toBe('Floor 12: 9 people waiting for an elevator, the longest for 7 minutes.');
    expect(wait.actions.map((a) => a.label)).toEqual([OPEN_ELEVATOR, SHOW_FLOOR]);
    expect(wait.actions[0]?.select).toEqual({ shaftId });
    expect(wait.actions[0]?.at.floor).toBe(12);
    noDashes(wait.text);

    // Nobody past the mark yet on a floor is not a problem.
    for (const sim of world.sims.values()) if (sim.waitStart !== null) sim.waitStart = world.time.minute - LONG_WAIT_MINUTES;
    expect(ofKind(world, 'wait')).toEqual([]);
    for (const sim of world.sims.values()) if (sim.waitStart !== null) sim.waitStart = world.time.minute - 7;

    // The car comes up and takes them: the problem is gone.
    tickMany(world, 20);
    expect(ofKind(world, 'wait')).toEqual([]);
  });

  it('lists the worst three floors, then one row for the rest', () => {
    const { world } = queue();
    const shaft = onlyShaft(world);
    const template = [...world.sims.values()].find((sim) => sim.state === 'waiting') as Sim;
    for (const [floor, waited] of [[3, 9], [5, 12], [7, 6], [9, 20], [11, 8]] as const) {
      addSim(world, { ...template, id: allocId(world), pos: { floor, x: shaft.x }, route: [{ kind: 'ride', shaftId: shaft.id, fromFloor: floor, toFloor: 1 }], waitStart: world.time.minute - waited } as Sim);
    }
    const waits = ofKind(world, 'wait');
    expect(waits.map((w) => w.floors)).toEqual([[9], [5], [3], [7, 11, 12]]);
    expect(waits[3]?.text).toBe('And 3 more floors where people have waited over 5 minutes, the worst on floor 11.');
  });
});

describe('tower problems: people who gave up', () => {
  it('counts the give-ups of the last hour from the log, with the worst floor, and forgets them after the hour', () => {
    const world = rich(createWorld(4));
    buildTower(world, [...lobbyRun(90, 200), { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 8 }, ...buildRow('office', 2, [100]), ...buildRow('office', 3, [100])]);
    atOnDay(world, 1, 2, 0);
    log(world, 'Gave up waiting for an elevator on floor 6.', 'warn', { simId: 1 });
    log(world, 'Gave up waiting for an elevator on floor 6 and went home.', 'warn', { simId: 2 });
    log(world, 'Gave up waiting for an elevator on floor 4.', 'warn', { simId: 3 });
    const [gave] = ofKind(world, 'gaveUp') as [TowerProblem];
    expect(gave.count).toBe(3);
    expect(gave.floors).toEqual([4, 6]);
    expect(gave.text).toBe('3 people gave up waiting for an elevator in the last hour, on floors 4 and 6. More cars or another elevator would help.');
    for (const f of [7, 8]) log(world, `Gave up waiting for an elevator on floor ${f}.`, 'warn', { simId: f });
    expect(ofKind(world, 'gaveUp')[0]?.text).toBe('5 people gave up waiting for an elevator in the last hour, most on floor 6. More cars or another elevator would help.');
    expect(gave.actions.map((a) => [a.label, a.at.floor])).toEqual([[SHOW_FLOOR, 6]]);
    tickMany(world, 61);
    expect(ofKind(world, 'gaveUp')).toEqual([]);
  });

  it('writes a large count with thousands separators, as the rest of the game does', () => {
    const world = rich(createWorld(4));
    buildTower(world, [...lobbyRun(90, 200), { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 8 }, ...buildRow('office', 2, [100])]);
    atOnDay(world, 1, 2, 0);
    for (let i = 0; i < 1956; i++) log(world, 'Gave up waiting for an elevator on floor 6.', 'warn', { simId: i });
    expect(ofKind(world, 'gaveUp')[0]?.text).toBe('1,956 people gave up waiting for an elevator in the last hour, on floor 6. More cars or another elevator would help.');
  });
});

describe('tower problems: no way in', () => {
  it('groups the rooms nobody can reach by floor, and is gone when the stop comes back', () => {
    const world = rich(createWorld(5));
    buildTower(world, [
      ...lobbyRun(90, 200),
      { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 5 },
      ...buildRow('office', 2, [100, 110]),
      ...buildRow('office', 3, [100, 110]),
      ...buildRow('office', 4, [100, 110]),
      ...buildRow('office', 5, [100, 110]),
    ]);
    const shaft = onlyShaft(world);
    expect(applyCommand(world, { kind: 'shaft.setStop', shaftId: shaft.id, floor: 5, stops: false }).ok).toBe(true);
    const cut = ofKind(world, 'noWayIn');
    expect(cut).toHaveLength(1);
    expect(cut[0]?.floors).toEqual([5]);
    expect(cut[0]?.count).toBe(2);
    expect(cut[0]?.text).toBe('Floor 5: 2 rooms with no way in from the lobby. Give the floor an elevator stop or stairs.');
    expect(cut[0]?.actions.map((a) => [a.label, a.at.floor])).toEqual([[SHOW_FLOOR, 5]]);
    expect(applyCommand(world, { kind: 'shaft.setStop', shaftId: shaft.id, floor: 5, stops: true }).ok).toBe(true);
    expect(ofKind(world, 'noWayIn')).toEqual([]);
  });

  it('says there is no lobby when there is none', () => {
    const world = createWorld(6);
    addRoom(world, {
      id: allocId(world), kind: 'office', floor: 2, x: 100, width: ROOMS.office.width, height: 1, eval: 1, tenants: [], occupancy: 0,
      builtAtMinute: 0, vacant: true, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 100,
    });
    expect(towerProblems(world).map((p) => p.text)).toEqual(['There is no lobby, so nobody can get into the tower. Build a lobby on floor 1.']);
  });
});

describe('tower problems: housekeeping', () => {
  /** A public shaft 1 to 4 for the guests; housekeeping on basement 1, which no shaft reaches; singles on 3 and 4. */
  function hotel(): { world: World; a: Room; b: Room } {
    const world = rich(createWorld(7));
    buildTower(world, [
      ...lobbyRun(90, 200),
      { kind: 'shaft.build', shaft: 'standard', x: 190, floorMin: 1, floorMax: 4 },
      { kind: 'build', room: 'office', floor: 2, x: 100 },
      { kind: 'build', room: 'hotelSingle', floor: 3, x: 100 },
      { kind: 'build', room: 'hotelSingle', floor: 4, x: 100 },
    ]);
    const a = roomsMatching(world, 'hotelSingle', { floor: 3 })[0] as Room;
    const b = roomsMatching(world, 'hotelSingle', { floor: 4 })[0] as Room;
    return { world, a, b };
  }

  it('a dirty hotel room with no housekeeping office says to build one; the office clears it', () => {
    const { world, a } = hotel();
    a.dirty = true;
    const [none] = ofKind(world, 'noHousekeeping') as [TowerProblem];
    expect(none.text).toBe('1 hotel room needs cleaning and there is no housekeeping. Build a housekeeping office.');
    expect(none.actions.map((x) => [x.label, x.at.floor])).toEqual([[SHOW_ROOM, 3]]);
    buildTower(world, [{ kind: 'build', room: 'housekeeping', floor: 2, x: 120 }]);
    expect(ofKind(world, 'noHousekeeping')).toEqual([]);
    expect(ofKind(world, 'housekeepingReach')).toEqual([]);
  });

  it('names the floors of the hotel rooms housekeeping cannot reach, and is gone once it has a way there', () => {
    const { world, a, b } = hotel();
    buildTower(world, [{ kind: 'build', room: 'housekeeping', floor: -1, x: 100 }]);
    a.dirty = true;
    b.dirty = true;
    const [cut] = ofKind(world, 'housekeepingReach') as [TowerProblem];
    expect(cut.floors).toEqual([3, 4]);
    expect(cut.count).toBe(2);
    expect(cut.text).toBe('Housekeeping cannot get to 2 hotel rooms on floors 3 and 4, so they stay dirty. Give housekeeping an elevator to those floors.');
    expect(cut.actions.map((x) => x.label)).toEqual([SHOW_FLOOR, 'Open housekeeping']);
    // A guest's way in is not housekeeping's: the rooms themselves are not cut off.
    expect(ofKind(world, 'noWayIn')).toEqual([]);
    buildTower(world, [{ kind: 'shaft.build', shaft: 'service', x: 60, floorMin: -1, floorMax: 4 }]);
    expect(ofKind(world, 'housekeepingReach')).toEqual([]);
  });
});

describe('tower problems: waste', () => {
  function tower(): World {
    const world = rich(createWorld(8));
    const script: Command[] = [...lobbyRun(90, 200), { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: -2, floorMax: 6 }];
    for (let f = 2; f <= 6; f++) script.push(...buildRow('office', f, [100]));
    script.push({ kind: 'build', room: 'parkingSpace', floor: -1, x: 100 });
    script.push({ kind: 'build', room: 'recycling', floor: -2, x: 10 });
    buildTower(world, script);
    buildTower(world, [{ kind: 'shaft.addCar', shaftId: onlyShaft(world).id }]);
    return world;
  }
  const center = (world: World): Room => roomsMatching(world, 'recycling')[0] as Room;

  it('names the floors the collectors cannot reach and the rooms piling up there; gone once they can', () => {
    const world = tower();
    atOnDay(world, 1, 7, 0);
    expect(towerProblems(world)).toEqual([]);
    const shaftId = onlyShaft(world).id;
    expect(applyCommand(world, { kind: 'shaft.setStop', shaftId, floor: -2, stops: false }).ok).toBe(true);
    atOnDay(world, 1, 10, 0);
    const [cut] = ofKind(world, 'wasteReach') as [TowerProblem];
    expect(cut.floors).toEqual([2, 3, 4, 5, 6]);
    expect(cut.text).toBe('The waste collectors cannot get to floors 2, 3, 4, 5 and 6. Give the recycling center a way to those floors.');
    expect(cut.actions.map((a) => a.label)).toEqual([SHOW_FLOOR, OPEN_CENTER]);
    expect(cut.actions[1]?.select).toEqual({ roomId: center(world).id });
    // Days later the waste piles up there, and the row says so.
    for (const office of roomsMatching(world, 'office')) office.waste = 7;
    atOnDay(world, 3, 10, 0);
    expect(ofKind(world, 'wasteReach')[0]?.text).toBe(
      'The waste collectors cannot get to floors 2, 3, 4, 5 and 6. Waste is piling up in 5 rooms there. Give the recycling center a way to those floors.',
    );
    expect(ofKind(world, 'wasteBehind')).toEqual([]);

    // The stop comes back after the shift: next morning the rooms still pile up, now on floors the
    // collectors reach.
    atOnDay(world, 3, 18, 0);
    expect(applyCommand(world, { kind: 'shaft.setStop', shaftId, floor: -2, stops: true }).ok).toBe(true);
    atOnDay(world, 4, 7, 0);
    expect(ofKind(world, 'wasteReach')).toEqual([]);
    const [behind] = ofKind(world, 'wasteBehind') as [TowerProblem];
    expect(behind.count).toBe(5);
    // Made counts what full rooms could not hold too (8afa423), so the tally is there from the roll.
    expect(behind.text).toBe(
      'Waste is piling up in 5 rooms, the oldest on floor 2. Today the tower made 5 units of waste and the collectors took 0 units. If this keeps up, build another recycling center.',
    );
    // Through the shift the card's numbers come in: made today against collected today.
    atOnDay(world, 4, 18, 0);
    expect(ofKind(world, 'wasteBehind')[0]?.text).toMatch(/^Waste is piling up in 5 rooms, the oldest on floor 2\. Today the tower made \d+ units? of waste and the collectors took \d+ units?\. /);
    noDashes(behind.text);
    // Collected through the day, and cleared at the next morning's roll.
    atOnDay(world, 5, 7, 0);
    expect(ofKind(world, 'wasteBehind')).toEqual([]);
    expect(towerProblems(world)).toEqual([]);
  });

  it('is true now: a stop fixed after the shift clears the row at once, and a stop cut after the shift raises it at once', () => {
    const world = tower();
    const shaftId = onlyShaft(world).id;
    atOnDay(world, 1, 7, 0);
    // Cut before the shift: the row is there at once, before any worker has tried a trip.
    expect(applyCommand(world, { kind: 'shaft.setStop', shaftId, floor: -2, stops: false }).ok).toBe(true);
    expect(ofKind(world, 'wasteReach')[0]?.floors).toEqual([2, 3, 4, 5, 6]);
    atOnDay(world, 1, 12, 0);
    expect(ofKind(world, 'wasteReach')).toHaveLength(1);
    // Fixed after the shift, when no worker will go out to find out: gone at once.
    atOnDay(world, 1, 17, 30);
    expect(applyCommand(world, { kind: 'shaft.setStop', shaftId, floor: -2, stops: true }).ok).toBe(true);
    expect(ofKind(world, 'wasteReach')).toEqual([]);
    atOnDay(world, 1, 23, 0);
    expect(ofKind(world, 'wasteReach')).toEqual([]);
    // Cut after the next day's shift: there at once, not only after the next trip fails.
    atOnDay(world, 2, 17, 30);
    expect(applyCommand(world, { kind: 'shaft.setStop', shaftId, floor: -2, stops: false }).ok).toBe(true);
    const [cut] = ofKind(world, 'wasteReach') as [TowerProblem];
    expect(cut.text).toBe('The waste collectors cannot get to floors 2, 3, 4, 5 and 6. Give the recycling center a way to those floors.');
  });

  it('a tower that lost its recycling center is told to build one, with the rooms piling up; gone when one is back', () => {
    const world = tower();
    atOnDay(world, 1, 7, 0);
    expect(applyCommand(world, { kind: 'demolish', roomId: center(world).id }).ok).toBe(true);
    for (const office of roomsMatching(world, 'office')) office.waste = 7;
    const [gone] = ofKind(world, 'wasteNoCenter') as [TowerProblem];
    expect(gone.text).toBe('There is no recycling center now, so nobody collects the waste and rooms get dirty. Build a recycling center.');
    atOnDay(world, 4, 7, 0);
    const [later] = ofKind(world, 'wasteNoCenter') as [TowerProblem];
    expect(later.count).toBeGreaterThan(0);
    expect(later.text).toContain(`It is already piling up in ${later.count} rooms.`);
    expect(later.actions.map((a) => a.label)).toEqual([SHOW_ROOM]);
    buildTower(world, [{ kind: 'build', room: 'recycling', floor: -2, x: 10 }]);
    expect(ofKind(world, 'wasteNoCenter')).toEqual([]);
  });
});

describe('tower problems: the move-out countdown', () => {
  it('names the room, the time left in words and the main reason; gone once the rating is fixed', () => {
    const world = rich(createWorld(9));
    buildTower(world, [
      ...lobbyRun(60, 200),
      { kind: 'shaft.build', shaft: 'standard', x: 190, floorMin: 1, floorMax: 3 },
      { kind: 'build', room: 'fastFood', floor: 2, x: 75 },
      { kind: 'build', room: 'office', floor: 2, x: 100 },
      { kind: 'build', room: 'fastFood', floor: 2, x: 110 },
    ]);
    const office = roomsMatching(world, 'office')[0] as Room;
    atOnDay(world, 1, 10, 0);
    expect(office.tenants.length).toBeGreaterThan(0);
    expect(applyCommand(world, { kind: 'room.setRent', roomId: office.id, rent: 150 }).ok).toBe(true);
    atOnDay(world, 1, 11, 30);
    expect(office.lowEvalSinceMinute).not.toBeNull();
    const [count] = ofKind(world, 'moveOut') as [TowerProblem];
    expect(count.roomId).toBe(office.id);
    expect(count.floors).toEqual([2]);
    expect(count.text).toBe(
      'The office on floor 2 is rated too low. Its tenants will move out in about a day unless it gets better. The main reason: it is too loud next to the fast food.',
    );
    expect(count.actions.map((a) => [a.label, a.at.floor])).toEqual([[SHOW_ROOM, 2]]);
    noDashes(count.text);
    expect(applyCommand(world, { kind: 'room.setRent', roomId: office.id, rent: 50 }).ok).toBe(true);
    atOnDay(world, 1, 12, 30);
    expect(ofKind(world, 'moveOut')).toEqual([]);
  });

  it('says the time left in plain words, never a day number', () => {
    expect(timeLeftWords(1000, 1000)).toBe('in about a day');
    expect(timeLeftWords(1000 + 1440 - 300, 1000)).toBe('in about 5 hours');
    expect(timeLeftWords(1000 + 1440 - 90, 1000)).toBe('in about 2 hours');
    expect(timeLeftWords(1000 + 1440 - 30, 1000)).toBe('within the hour');
  });

  it('a move-out that already happened is history, not a problem', () => {
    const world = rich(createWorld(10));
    buildTower(world, [...lobbyRun(90, 200), { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 3 }, ...buildRow('office', 2, [100])]);
    log(world, 'Nobody cleaned the office on floor 2.', 'warn', { roomId: 1 });
    expect(towerProblems(world)).toEqual([]);
  });
});
