/**
 * The VIP visit as a journey: announced a day ahead, in through the ground lobby, up by the
 * normal routing and elevator rules, a stay in the suite, and out again. Rated from what
 * actually happened: the longest wait, the suite at check in, and any fire or bomb.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyCommand } from '../../src/sim/build';
import { EVENT_TEST_HOOKS, resetEventTestHooks, startFire, startVip } from '../../src/sim/events';
import { vipPreference, VIP_PREFERENCES } from '../../src/sim/identity';
import { EVENTS } from '../../src/sim/rules';
import { deserialize, hashWorld, serialize } from '../../src/sim/save';
import { personCard } from '../../src/sim/story';
import { tick } from '../../src/sim/tick';
import type { ActiveEvent, Room, Sim, VipPhase, World } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';
import { vipBreakdown } from '../../src/ui/vip';
import { atOnDay, buildRow, buildTower, lobbyRun, onlyShaft, roomsMatching } from './helpers';

type Visit = Extract<ActiveEvent, { kind: 'vip' }>;

const SHAFT_X = 150;
/** Right of the shaft, clear of the offices' noise on floors 2 and 4. */
const SUITE_X = 160;

function visitOf(world: World): Visit | undefined {
  return world.events.find((e): e is Visit => e.kind === 'vip');
}

function suiteOf(world: World): Room {
  const suite = roomsMatching(world, 'hotelSuite')[0];
  if (!suite) throw new Error('no suite');
  return suite;
}

/**
 * A small, well run tower: a lobby, one shaft with `cars` cars from the lobby to floor `top`,
 * four offices on floor 2 (or on `officeFloors`) left of the shaft and the suite on floor 3.
 */
function tower(opts: { cars: number; top: number; officeFloors?: number[]; suiteX?: number }): World {
  const world = createWorld(7);
  world.stars = EVENTS.vip.minStar;
  world.cash = 500_000_000;
  const floors = opts.officeFloors ?? [2];
  buildTower(world, [
    ...lobbyRun(90, 170),
    { kind: 'shaft.build', shaft: 'standard', x: SHAFT_X, floorMin: 1, floorMax: opts.top },
    ...floors.flatMap((f) => buildRow('office', f, [100, 109, 118, 127])),
  ]);
  const shaft = onlyShaft(world);
  for (let c = 1; c < opts.cars; c++) buildTower(world, [{ kind: 'shaft.addCar', shaftId: shaft.id }]);
  buildTower(world, [{ kind: 'build', room: 'hotelSuite', floor: 3, x: opts.suiteX ?? SUITE_X }]);
  return world;
}

/** Tick until the visit clears, noting every phase and every state the VIP was seen in. */
function runVisit(world: World, onTick?: (world: World, visit: Visit) => void): { phases: Set<VipPhase>; states: Set<Sim['state']>; lobbyWalk: boolean } {
  const phases = new Set<VipPhase>();
  const states = new Set<Sim['state']>();
  let lobbyWalk = false;
  for (let i = 0; i < 4 * 1440; i++) {
    const visit = visitOf(world);
    if (!visit) break;
    phases.add(visit.phase);
    const sim = world.sims.get(visit.simId);
    if (sim) {
      states.add(sim.state);
      if (sim.state === 'walking' && sim.pos.floor === 1) lobbyWalk = true;
    }
    onTick?.(world, visit);
    tick(world);
  }
  if (visitOf(world)) throw new Error('the visit never cleared');
  return { phases, states, lobbyWalk };
}

/** Run to the morning roll on day 0 with the VIP chance forced, so the notice lands at 06:00. */
function announce(world: World): Visit {
  atOnDay(world, 0, 6, 1);
  const visit = visitOf(world);
  if (!visit) throw new Error('no visit announced');
  return visit;
}

beforeEach(() => {
  resetEventTestHooks();
  EVENT_TEST_HOOKS.chance = { fire: 0, bomb: 0, vip: 1 };
});
afterEach(() => resetEventTestHooks());

describe('the VIP journey', () => {
  it('a competent tower earns fair or better, and the VIP is seen walking the lobby and riding the shaft', () => {
    const world = tower({ cars: 2, top: 6 });
    const visit = announce(world);
    expect(visit.phase).toBe('notice');
    const sim = world.sims.get(visit.simId) as Sim;
    expect(sim.kind).toBe('vip');
    expect(VIP_PREFERENCES).toContain(visit.preference);
    expect(visit.preference).toBe(vipPreference(world.seed, sim.id));

    const seen = runVisit(world);
    expect([...seen.phases]).toEqual(['notice', 'route', 'stay', 'checkout']);
    expect(seen.states.has('walking')).toBe(true);
    expect(seen.states.has('riding')).toBe(true);
    expect(seen.states.has('inRoom')).toBe(true);
    expect(seen.lobbyWalk).toBe(true);
    expect(['fair', 'good']).toContain(world.stats.vipRating);
    expect(world.stats.lastVip?.reason).toBeNull();
    expect(world.stats.lastVip?.suiteClean).toBe(true);
    expect(world.sims.has(visit.simId)).toBe(false);
    expect(suiteOf(world).tenants).not.toContain(visit.simId);

    const beats = world.story.recent.filter((b) => b.code.startsWith('vip.'));
    expect(beats.map((b) => b.code)).toEqual(['vip.notice', 'vip.arrival', 'vip.rated']);
    const rated = beats[2];
    expect(rated?.simId).toBe(visit.simId);
    expect(rated?.value).toBe(world.stats.vipRating === 'good' ? 2 : 1);
    // vip.arrival fires when the VIP reaches the suite, not when they walk in.
    const checkIn = world.log.find((l) => l.text.startsWith('The VIP checked into'));
    expect(beats[1]?.minute).toBe(checkIn?.minute);
  });

  it('the person card names the VIP guest, their preference and the current leg', () => {
    const world = tower({ cars: 2, top: 6 });
    const visit = announce(world);
    atOnDay(world, 1, 6, 1);
    const sim = world.sims.get(visit.simId) as Sim;
    const card = personCard(world, sim);
    expect(card.who[1]).toBe('VIP guest');
    expect(card.mind).toContain(`Cares most about ${visit.preference}`);
    expect(card.mind).not.toBe(`Arriving tomorrow. Cares most about ${visit.preference}`);
  });

  it('one car in a crowded morning rates poor, and the breakdown names the wait', () => {
    const floors = [2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const world = tower({ cars: 1, top: 15, officeFloors: floors });
    EVENT_TEST_HOOKS.chance.vip = 0;
    // Book the visit at 8:20 so the VIP walks in at 8:20 tomorrow, into the office rush.
    atOnDay(world, 0, 8, 20);
    startVip(world);
    const visit = visitOf(world) as Visit;
    expect(visit.arrivesAt).toBe(1440 + 8 * 60 + 20);
    runVisit(world);
    const record = world.stats.lastVip;
    expect(world.stats.vipRating).toBe('poor');
    expect(record?.waitBand).toBe('poor');
    expect(record?.longestWait).toBeGreaterThan(EVENTS.vip.fairMaxWaitMinutes);
    const rows = vipBreakdown(record!);
    expect(rows.find((r) => r.label === 'Longest wait')?.value).toBe(`${record?.longestWait} minutes (poor)`);
  });

  it('a dirty suite at check in caps the rating at poor', () => {
    const world = tower({ cars: 2, top: 6 });
    announce(world);
    suiteOf(world).dirty = true;
    runVisit(world);
    expect(world.stats.vipRating).toBe('poor');
    expect(world.stats.lastVip?.suiteClean).toBe(false);
    expect(world.stats.lastVip?.suiteBand).toBe('poor');
    expect(world.stats.lastVip?.waitBand).not.toBe('poor');
  });

  it('a suite rated below the fair band keeps its booking and caps the rating at fair', () => {
    // Offices under and over the suite: two noisy neighbors each way, a suite rating of 0.2.
    const world = tower({ cars: 2, top: 6, officeFloors: [2, 4], suiteX: 100 });
    // Book it on day 1, so the suite has been in the red zone a full day during the notice:
    // evaluation must not move the booked VIP out as if they were a tenant.
    EVENT_TEST_HOOKS.chance.vip = 0;
    atOnDay(world, 1, 0, 0);
    startVip(world);
    runVisit(world);
    expect(suiteOf(world).eval).toBeLessThan(0.34);
    expect(world.stats.lastVip?.reason).toBeNull();
    expect(world.stats.lastVip?.suiteBand).toBe('fair');
    expect(world.stats.vipRating).toBe('fair');
  });

  it('a fire during the stay caps the rating at poor', () => {
    const world = tower({ cars: 2, top: 6 });
    announce(world);
    let lit = false;
    runVisit(world, (w, visit) => {
      if (lit || visit.phase !== 'stay') return;
      lit = true;
      EVENT_TEST_HOOKS.target.fire = roomsMatching(w, 'office', { floor: 2 })[3]?.id ?? null;
      startFire(w);
    });
    expect(lit).toBe(true);
    expect(world.stats.vipRating).toBe('poor');
    expect(world.stats.lastVip?.incident).toBe(true);
    expect(vipBreakdown(world.stats.lastVip!).find((r) => r.label === 'Fire or bomb')?.value).toBe('Yes');
  });

  it('a suite demolished during the notice ends the visit with the reason and clears it', () => {
    const world = tower({ cars: 2, top: 6 });
    const visit = announce(world);
    expect(applyCommand(world, { kind: 'demolish', roomId: suiteOf(world).id }).ok).toBe(true);
    const seen = runVisit(world);
    expect(seen.phases.has('route')).toBe(false);
    expect(world.log.some((l) => l.text === 'The VIP left: no suite was ready.')).toBe(true);
    const rated = world.story.recent.find((b) => b.code === 'vip.rated');
    expect(rated).toMatchObject({ simId: visit.simId, value: 0 });
    expect(world.stats.vipRating).toBe('poor');
    expect(world.stats.lastVip?.reason).toBe('The VIP left: no suite was ready');
    expect(visitOf(world)).toBeUndefined();
  });

  it('an unreachable suite floor ends the visit with the reason and clears it', () => {
    const world = tower({ cars: 2, top: 6 });
    const visit = announce(world);
    const shaft = onlyShaft(world);
    expect(applyCommand(world, { kind: 'shaft.setStop', shaftId: shaft.id, floor: 3, stops: false }).ok).toBe(true);
    runVisit(world);
    expect(world.log.some((l) => l.text === 'The VIP left: no way up to floor 3.')).toBe(true);
    expect(world.story.recent.find((b) => b.code === 'vip.rated')).toMatchObject({ simId: visit.simId, value: 0 });
    expect(world.sims.has(visit.simId)).toBe(false);
    expect(suiteOf(world).tenants).toEqual([]);
  });

  for (const phase of ['notice', 'route', 'stay'] as const) {
    it(`a save and load during the ${phase} resumes there and finishes with the same rating`, () => {
      const world = tower({ cars: 2, top: 6 });
      announce(world);
      for (let i = 0; i < 3 * 1440 && visitOf(world)?.phase !== phase; i++) tick(world);
      // Mid route means off the ground: wait for the ride itself.
      if (phase === 'route') {
        for (let i = 0; i < 60; i++) {
          const v = visitOf(world) as Visit;
          if (world.sims.get(v.simId)?.state === 'riding') break;
          tick(world);
        }
        expect(world.sims.get((visitOf(world) as Visit).simId)?.state).toBe('riding');
      }
      expect(visitOf(world)?.phase).toBe(phase);

      const loaded = deserialize(serialize(world));
      if (!loaded.ok) throw new Error(loaded.reason);
      const copy = loaded.world;
      expect(visitOf(copy)).toEqual(visitOf(world));
      expect(hashWorld(copy)).toBe(hashWorld(world));

      runVisit(world);
      runVisit(copy);
      expect(copy.stats.vipRating).toBe(world.stats.vipRating);
      expect(copy.stats.lastVip).toEqual(world.stats.lastVip);
      expect(hashWorld(copy)).toBe(hashWorld(world));
    });
  }

  it('a v4 save of a visit in the suite loads as the stay and finishes', () => {
    const world = tower({ cars: 2, top: 6 });
    announce(world);
    for (let i = 0; i < 3 * 1440 && visitOf(world)?.phase !== 'stay'; i++) tick(world);
    const data = JSON.parse(serialize(world)) as { version: number; events: Record<string, unknown>[] };
    const v4 = data.events.find((e) => e.kind === 'vip') as Record<string, unknown>;
    for (const key of ['phase', 'preference', 'longestWait', 'waitingSince', 'checkInClean', 'checkInEval', 'incident']) delete v4[key];
    const loaded = deserialize(JSON.stringify(data));
    if (!loaded.ok) throw new Error(loaded.reason);
    const visit = visitOf(loaded.world) as Visit;
    expect(visit.phase).toBe('stay');
    expect(visit.checkInClean).toBe(true);
    expect(visit.preference).toBe(vipPreference(world.seed, visit.simId));
    runVisit(loaded.world);
    expect(['fair', 'good']).toContain(loaded.world.stats.vipRating);
  });
});
