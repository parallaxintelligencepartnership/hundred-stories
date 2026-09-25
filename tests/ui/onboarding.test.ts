// The first run's rules from stub worlds: the guide's steps, its band, the goals checklist, the
// nudges, the tip queue, and the copy's house style.
import { describe, expect, it } from 'vitest';
import {
  GUIDE_DONE,
  INTRO_SCREENS,
  LONG_WAIT_NUDGE,
  STALL_MINUTES,
  TIP_TEXT,
  TipQueue,
  goalsFor,
  goalsNudge,
  guideBand,
  guideCopy,
  guideStep,
  newLeaveReason,
  nudgeCounts,
  type GoalsWorld,
} from '../../src/ui/onboarding';
import { recordLongWait } from '../../src/sim/world';

type StubRoom = { id: number; kind: string; floor: number; x: number; width: number; height: number; occupancy: number; vacant: boolean };

function stubWorld(): GoalsWorld & { time: { minute: number } } {
  return {
    rooms: new Map(),
    shafts: new Map(),
    stars: 1,
    population: 0,
    stats: { vipRating: 'none', weddingsHeld: 0 },
    time: { minute: 6 * 60 },
  } as never;
}

let nextId = 1;
function addRoom(world: GoalsWorld, room: Omit<StubRoom, 'id' | 'height' | 'occupancy' | 'vacant'> & Partial<StubRoom>): StubRoom {
  const full: StubRoom = { id: nextId++, height: 1, occupancy: 0, vacant: room.kind === 'office' || room.kind === 'condo', ...room };
  world.rooms.set(full.id, full as never);
  return full;
}
function addShaft(world: GoalsWorld, floorMin: number, floorMax: number): void {
  const id = nextId++;
  world.shafts.set(id, { id, floorMin, floorMax } as never);
}

describe('guide steps', () => {
  it('advance on the world: lobby, office, an elevator that reaches it, tenants, 2 stars', () => {
    const world = stubWorld();
    expect(guideStep(world)).toBe(0);
    addRoom(world, { kind: 'lobby', floor: 1, x: 180, width: 20 });
    expect(guideStep(world)).toBe(1);
    const office = addRoom(world, { kind: 'office', floor: 2, x: 185, width: 9 });
    expect(guideStep(world)).toBe(2);
    addShaft(world, 3, 6); // stands, but reaches neither the lobby floor nor the office
    expect(guideStep(world)).toBe(2);
    addShaft(world, 1, 2);
    expect(guideStep(world)).toBe(3);
    office.vacant = false;
    expect(guideStep(world)).toBe(4);
    world.stars = 2;
    expect(guideStep(world)).toBe(GUIDE_DONE);
  });

  it('do not advance on time alone', () => {
    const world = stubWorld();
    addRoom(world, { kind: 'lobby', floor: 1, x: 180, width: 20 });
    const before = guideStep(world);
    for (let i = 0; i < 10; i++) world.time.minute += 1440;
    expect(guideStep(world)).toBe(before);
  });

  it('a lobby off the ground floor does not count, and a sky lobby is not the lobby step', () => {
    const world = stubWorld();
    addRoom(world, { kind: 'skyLobby', floor: 15, x: 180, width: 20, height: 3 });
    expect(guideStep(world)).toBe(0);
  });

  it('bands the ground for the lobby, the floors over the lobby for the office, the shaft span for the elevator', () => {
    const world = stubWorld();
    expect(guideBand(world, 0)).toEqual({ floorMin: 1, floorMax: 1, xMin: 0, xMax: 374 });
    addRoom(world, { kind: 'lobby', floor: 1, x: 180, width: 20 });
    expect(guideBand(world, 1)).toEqual({ floorMin: 2, floorMax: 2, xMin: 180, xMax: 199 });
    addRoom(world, { kind: 'office', floor: 2, x: 195, width: 9 });
    expect(guideBand(world, 2)).toEqual({ floorMin: 1, floorMax: 2, xMin: 195, xMax: 199 });
    expect(guideBand(world, 3)).toBe(null);
  });

  it('names the office floor in the elevator step and lights the right tool', () => {
    const world = stubWorld();
    addRoom(world, { kind: 'lobby', floor: 1, x: 180, width: 20 });
    addRoom(world, { kind: 'office', floor: 3, x: 185, width: 9 });
    const copy = guideCopy(world, 2);
    expect(copy.text).toContain('floor 3');
    expect(copy.tool).toEqual({ kind: 'shaft', shaft: 'standard' });
    expect(guideCopy(world, 0).tool).toEqual({ kind: 'room', room: 'lobby' });
    expect(guideCopy(world, 3).tool).toBe(null);
  });
});

describe('goals', () => {
  it('at 1 star: population toward 2 stars, nothing else', () => {
    const world = stubWorld();
    world.population = 120;
    const goals = goalsFor(world);
    expect(goals?.title).toBe('Next: 2 stars');
    expect(goals?.items).toEqual([{ label: 'Population', value: '120 of 300', done: false }]);
  });

  it('at 3 stars: population, a suite, the VIP rating, recycling and medical', () => {
    const world = stubWorld();
    world.stars = 3;
    world.population = 5_200;
    addRoom(world, { kind: 'hotelSuite', floor: 5, x: 10, width: 10 });
    addRoom(world, { kind: 'medical', floor: 6, x: 10, width: 26 });
    world.stats.vipRating = 'poor';
    const goals = goalsFor(world);
    expect(goals?.title).toBe('Next: 4 stars');
    expect(goals?.items).toEqual([
      { label: 'Population', value: '5,200 of 5,000', done: true },
      { label: 'Hotel suites', value: '1 of 1', done: true },
      { label: 'VIP rating', value: 'Fair needed, now poor', done: false },
      { label: 'Recycling center', value: 'Not built', done: false },
      { label: 'Medical center', value: 'Built', done: true },
    ]);
  });

  it('at 2 stars asks for the security office, and at Tower status there is nothing left', () => {
    const world = stubWorld();
    world.stars = 2;
    expect(goalsFor(world)?.items.map((i) => i.label)).toEqual(['Population', 'Security office']);
    world.stars = 6;
    expect(goalsFor(world)).toBe(null);
  });
});

describe('nudges', () => {
  const calm = { longWaitsThisHour: 0, longWaitsLastHour: 0, populationStillFor: 0, vacantRooms: 0 };

  it('says nothing while the tower moves', () => {
    expect(goalsNudge(calm)).toBe(null);
  });

  it('counts long waits past a dozen in the last hour, this hour or the one before', () => {
    expect(goalsNudge({ ...calm, longWaitsThisHour: LONG_WAIT_NUDGE })).toBe(null);
    expect(goalsNudge({ ...calm, longWaitsThisHour: 13 })).toBe('13 people waited over 5 minutes for a car in the last hour.');
    expect(goalsNudge({ ...calm, longWaitsLastHour: 20, longWaitsThisHour: 2 })).toBe('20 people waited over 5 minutes for a car in the last hour.');
  });

  it('flags a population stuck for two days only while rooms are vacant', () => {
    expect(goalsNudge({ ...calm, populationStillFor: STALL_MINUTES, vacantRooms: 0 })).toBe(null);
    expect(goalsNudge({ ...calm, populationStillFor: STALL_MINUTES - 1, vacantRooms: 3 })).toBe(null);
    expect(goalsNudge({ ...calm, populationStillFor: STALL_MINUTES, vacantRooms: 3 })).toBe('Tenants need an elevator within reach.');
  });

  it('reads the waits from the world ring and the vacancies from the rooms', () => {
    const world = { rooms: new Map(), time: { minute: 10 * 60 + 30 }, longWaits: { hour: new Array(24).fill(-1), count: new Array(24).fill(0) } };
    for (let i = 0; i < 4; i++) recordLongWait(world as never);
    world.rooms.set(1, { kind: 'office', vacant: true });
    world.rooms.set(2, { kind: 'condo', vacant: false });
    world.rooms.set(3, { kind: 'shop', vacant: true });
    expect(nudgeCounts(world as never)).toEqual({ longWaitsThisHour: 4, longWaitsLastHour: 0, vacantRooms: 1 });
    world.time.minute += 60;
    expect(nudgeCounts(world as never)).toEqual({ longWaitsThisHour: 0, longWaitsLastHour: 4, vacantRooms: 1 });
  });
});

describe('tips', () => {
  it('queue one at a time, each id once, and wait while blocked', () => {
    const queue = new TipQueue(['firstRent', 'bogus']);
    expect(queue.offer({ id: 'firstRent', text: 'x' })).toBe(false); // already read in an earlier session
    expect(queue.offer({ id: 'nightSpeed', text: 'night' })).toBe(true);
    expect(queue.offer({ id: 'nightSpeed', text: 'again' })).toBe(false);
    expect(queue.offer({ id: 'firstPanel', text: 'panel' })).toBe(true);
    expect(queue.next(true)).toBe(null);
    expect(queue.next(false)?.id).toBe('nightSpeed');
    queue.done('nightSpeed');
    expect(queue.next(false)?.id).toBe('firstPanel');
    expect(queue.offer({ id: 'nightSpeed', text: 'later' })).toBe(false);
  });

  it('finds the reason behind a new move out', () => {
    expect(newLeaveReason({ a: 1 }, { a: 1, b: 1 })).toBe('b');
    expect(newLeaveReason({ a: 1 }, { a: 2 })).toBe('a');
    expect(newLeaveReason({ a: 1 }, { a: 1 })).toBe(null);
    expect(TIP_TEXT.tenantLeft('Too noisy next to the Fast food on floor 3.')).toBe('A tenant moved out: too noisy next to the Fast food on floor 3.');
  });

  it('names the night mode the status bar shows', () => {
    expect(TIP_TEXT.nightSpeed('Night x8, x8 in all')).toBe('Night x8, x8 in all: from 11 PM to 6 AM the clock runs faster while the tower sleeps.');
  });
});

describe('copy', () => {
  const all = (): string[] => {
    const world = stubWorld();
    return [
      ...INTRO_SCREENS.flatMap((s) => [s.title, ...s.lines]),
      ...([0, 1, 2, 3, 4] as const).flatMap((step) => [guideCopy(world, step).title, guideCopy(world, step).text]),
      TIP_TEXT.longWait(),
      TIP_TEXT.firstRent(10_000),
      TIP_TEXT.firstEvent(),
      TIP_TEXT.firstPanel(),
    ];
  };

  it('has no em dashes, no spaced hyphens and no exclamation marks', () => {
    for (const text of all()) {
      expect(text).not.toMatch(/—|–| - |!/);
    }
  });

  it('lists every star on the second intro screen', () => {
    const stars = INTRO_SCREENS[1]?.lines ?? [];
    expect(stars).toContain('2 stars: 300 people.');
    expect(stars).toContain('3 stars: 1,000 people and a security office.');
    expect(stars).toContain('Tower: 15,000 people, a cathedral and a wedding.');
  });
});
