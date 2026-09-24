// Story beats as the tick records them, and as the card renders them.
import { describe, expect, it } from 'vitest';
import { startFire } from '../../src/sim/events';
import { ROOMS, STORY } from '../../src/sim/rules';
import { recomputeStars } from '../../src/sim/stars';
import {
  createStoryState,
  describeBeat,
  followSim,
  goalLine,
  NOTHING_HELPS,
  NOTHING_RECORDED,
  personCard,
  recordBeat,
  recordSimBeat,
  STORY_RECENT_CAP,
  WAIT_HELP,
  type BeatCode,
  type StoryBeat,
} from '../../src/sim/story';
import { tickMany } from '../../src/sim/tick';
import type { Room, RoomKind, Sim, World } from '../../src/sim/types';
import { addRoom, addSim, allocId, createWorld } from '../../src/sim/world';
import { at, buildRow, buildTower, lobbyRun } from '../scenarios/helpers';

function room(world: World, kind: RoomKind, floor: number, x: number, extra: Partial<Room> = {}): Room {
  const r: Room = {
    id: allocId(world),
    kind,
    floor,
    x,
    width: ROOMS[kind].width,
    height: ROOMS[kind].height,
    eval: 1,
    tenants: [],
    occupancy: 0,
    builtAtMinute: 0,
    vacant: false,
    dirty: false,
    infested: false,
    lowEvalSinceMinute: null,
    onFire: false,
    rent: 100,
    ...extra,
  };
  addRoom(world, r);
  return r;
}

function person(world: World, kind: Sim['kind'], extra: Partial<Sim> = {}): Sim {
  const sim: Sim = {
    id: allocId(world),
    kind,
    homeRoomId: null,
    pos: { floor: 1, x: 100 },
    inCarId: null,
    inRoomId: null,
    route: [],
    state: 'outside',
    stress: 0,
    waitStart: null,
    schedule: [],
    nextScheduleIndex: 0,
    stayUntil: null,
    wallet: 0,
    leaveReason: null,
    ...extra,
  };
  addSim(world, sim);
  return sim;
}

const ALL_CODES: BeatCode[] = [
  'wait.long', 'trip.gaveUp', 'trip.arrived', 'room.vacated', 'fire.started', 'fire.resolved', 'bomb.started',
  'bomb.resolved', 'bomb.failed', 'vip.notice', 'vip.arrival', 'vip.rated', 'star.gained', 'star.lost',
];

describe('recording', () => {
  it('spaces out beats about people nobody follows, and never a followed person', () => {
    const story = createStoryState();
    followSim(story, 1);
    const gap = STORY.unfollowedBeatGapMinutes;
    expect(recordSimBeat(story, { code: 'wait.long', minute: 100, simId: 2, value: 6 }, gap)).not.toBeNull();
    expect(recordSimBeat(story, { code: 'wait.long', minute: 100 + gap - 1, simId: 3, value: 6 }, gap)).toBeNull();
    expect(recordSimBeat(story, { code: 'trip.gaveUp', minute: 101, simId: 3, value: 9 }, gap)).not.toBeNull();
    expect(recordSimBeat(story, { code: 'wait.long', minute: 101, simId: 1, value: 6 }, gap)).not.toBeNull();
    expect(recordSimBeat(story, { code: 'wait.long', minute: 100 + gap, simId: 4, value: 6 }, gap)).not.toBeNull();
    expect(story.recent.map((b) => b.simId)).toEqual([2, 3, 1, 4]);
    expect(story.threads[1]).toHaveLength(1);
  });

  it('keeps a busy tower bounded: one unfollowed long wait per gap, followed people in full', () => {
    const world = createWorld(31);
    buildTower(world, [
      ...lobbyRun(140, 160),
      { kind: 'shaft.build', shaft: 'standard', x: 148, floorMin: 1, floorMax: 4 },
      ...buildRow('office', 2, [94, 103, 112, 121, 130, 139, 152, 161, 170, 179]),
      ...buildRow('office', 3, [94, 103, 112, 121, 130, 139, 152, 161, 170, 179]),
      ...buildRow('office', 4, [94, 103, 112, 121, 130, 139, 152, 161, 170, 179]),
    ]);
    at(world, 12, 0);
    const waits = world.story.recent.filter((b) => b.code === 'wait.long');
    expect(waits.length).toBeGreaterThan(0);
    for (let i = 1; i < waits.length; i++) {
      expect((waits[i] as StoryBeat).minute - (waits[i - 1] as StoryBeat).minute).toBeGreaterThanOrEqual(STORY.unfollowedBeatGapMinutes);
    }
    expect(world.story.recent.length).toBeLessThanOrEqual(STORY_RECENT_CAP);
  });

  it('records a star change with the new star, beside the unchanged log line', () => {
    const world = createWorld(1);
    for (let i = 0; i < 50; i++) room(world, 'office', 2 + Math.floor(i / 30), (i % 30) * 10);
    recomputeStars(world);
    expect(world.stars).toBe(2);
    expect(world.log[world.log.length - 1]?.text).toBe('Reached 2 stars.');
    expect(world.story.recent).toEqual([{ code: 'star.gained', minute: world.time.minute, value: 2 }]);
    for (const r of world.rooms.values()) r.vacant = true;
    recomputeStars(world);
    expect(world.story.recent[1]).toEqual({ code: 'star.lost', minute: world.time.minute, value: 1 });
  });

  it('records a fire beside its log line, which keeps its wording', () => {
    const world = createWorld(1);
    const office = room(world, 'office', 2, 100);
    startFire(world);
    expect(world.log[world.log.length - 2]?.text).toBe('Fire broke out in the office on floor 2. Call a helicopter or wait for security.');
    expect(world.story.recent).toEqual([{ code: 'fire.started', minute: world.time.minute, roomId: office.id }]);
  });

  it('a followed worker records trip.arrived on reaching the office', () => {
    const world = createWorld(5);
    buildTower(world, [...lobbyRun(140, 160), { kind: 'shaft.build', shaft: 'standard', x: 148, floorMin: 1, floorMax: 3 }, ...buildRow('office', 2, [130])]);
    at(world, 8, 1);
    const office = [...world.rooms.values()].find((r) => r.kind === 'office') as Room;
    const id = office.tenants[0] as number;
    followSim(world.story, id);
    tickMany(world, 180);
    const arrived = (world.story.threads[id] ?? []).find((b) => b.code === 'trip.arrived');
    expect(arrived?.roomId).toBe(office.id);
    expect(arrived?.value).toBeGreaterThan(0);
  });
});

describe('words', () => {
  it('renders every code, for every voice, as a plain sentence with no cause and no dash', () => {
    const world = createWorld(3);
    const office = room(world, 'office', 12, 100);
    for (const code of ALL_CODES) {
      for (let simId = 1; simId <= 30; simId++) {
        for (const value of [0, 1, 8]) {
          const line = describeBeat({ code, minute: 0, simId, roomId: office.id, value }, world);
          expect(line.length).toBeGreaterThan(0);
          expect(line).toMatch(/^[A-Z].*[.]$/);
          expect(line.toLowerCase()).not.toMatch(/because|caused|thanks to|—|–| - /);
        }
      }
    }
  });

  it('states the numbers it observed', () => {
    const world = createWorld(3);
    const office = room(world, 'office', 12, 100);
    const lines = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((simId) =>
      describeBeat({ code: 'wait.long', minute: 0, simId, roomId: office.id, value: 8 }, world),
    );
    for (const line of lines) expect(line.toLowerCase()).toContain('eight minutes');
    expect(lines.some((line) => line.includes('floor 12'))).toBe(true);
  });

  it('gives every live person a grounded line, with or without beats', () => {
    const world = createWorld(4);
    const lobby = room(world, 'lobby', 1, 100);
    const office = room(world, 'office', 12, 110);
    world.time.minute = 8 * 60 + 10;
    const waiting = person(world, 'worker', { homeRoomId: office.id, state: 'waiting', waitStart: 8 * 60 + 6, route: [{ kind: 'ride', shaftId: 999, fromFloor: 1, toFloor: 12 }, { kind: 'enter', roomId: office.id }] });
    expect(goalLine(world, waiting)).toBe('Waiting for an elevator at the lobby, four minutes so far');
    const walking = person(world, 'worker', { homeRoomId: office.id, state: 'walking', route: [{ kind: 'walk', toX: 105 }, { kind: 'enter', roomId: office.id }] });
    expect(goalLine(world, walking)).toBe('Heading to work on floor 12');
    const home = person(world, 'resident', { state: 'inRoom', inRoomId: office.id, homeRoomId: office.id });
    expect(goalLine(world, home)).toBe('At home');
    for (const kind of ['worker', 'resident', 'guest', 'shopper', 'diner', 'staff', 'visitor', 'vip'] as const) {
      for (const state of ['inRoom', 'walking', 'waiting', 'riding', 'leaving', 'outside'] as const) {
        const sim = person(world, kind, { state, inRoomId: state === 'inRoom' ? lobby.id : null });
        expect(goalLine(world, sim).length).toBeGreaterThan(0);
      }
    }
  });

  it('maps what helps from the latest setback only', () => {
    const world = createWorld(4);
    const office = room(world, 'office', 3, 110);
    const sim = person(world, 'worker', { homeRoomId: office.id });
    expect(personCard(world, sim).helps).toBe(NOTHING_HELPS);
    expect(personCard(world, sim).chapter).toEqual([NOTHING_RECORDED]);
    followSim(world.story, sim.id);
    recordBeat(world.story, { code: 'wait.long', minute: 1, simId: sim.id, roomId: office.id, value: 9 });
    expect(personCard(world, sim).helps).toBe(WAIT_HELP);
    sim.leaveReason = 'Too noisy next to the fast food on floor 3.';
    recordBeat(world.story, { code: 'room.vacated', minute: 2, simId: sim.id, roomId: office.id, value: 1 });
    const card = personCard(world, sim);
    expect(card.helps).toBe('Too noisy next to the fast food on floor 3.');
    expect(card.chapter).toHaveLength(2);
    expect(card.who[0]).toBe(card.name);
    expect(card.who).toContain('Worker');
    expect(card.who).toContain('Works in the office on floor 3');
  });
});
