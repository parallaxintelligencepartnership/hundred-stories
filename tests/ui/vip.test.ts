// The VIP card: live preparation ticks, the breakdown after a rating, and the next chance.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EVENT_TEST_HOOKS, resetEventTestHooks, startBomb, startFire } from '../../src/sim/events';
import { personName, vipArrivalHour } from '../../src/sim/identity';
import { EVENTS } from '../../src/sim/rules';
import { tick } from '../../src/sim/tick';
import type { ActiveEvent, Room, VipVisitRecord, World } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';
import type { PanelContext } from '../../src/ui/panels';
import { storiesBody } from '../../src/ui/stories';
import { VIP_RATED_ON, vipBreakdown, vipNextChance, vipView } from '../../src/ui/vip';
import { atOnDay, buildTower, lobbyRun, onlyShaft, roomsMatching, runMinutes } from '../scenarios/helpers';
import { FakeDom, type FakeElement } from './fake-dom';

type Visit = Extract<ActiveEvent, { kind: 'vip' }>;

function bookedTower(): { world: World; visit: Visit; suite: Room } {
  const world = createWorld(11);
  world.stars = EVENTS.vip.minStar;
  world.cash = 100_000_000;
  buildTower(world, [
    ...lobbyRun(90, 170),
    { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 4 },
    { kind: 'build', room: 'office', floor: 2, x: 100 },
    { kind: 'build', room: 'hotelSuite', floor: 3, x: 152 }, // over the shaft's last two columns, which hold it up
  ]);
  atOnDay(world, 0, 6, 1);
  const visit = world.events.find((e): e is Visit => e.kind === 'vip');
  if (!visit) throw new Error('no visit');
  return { world, visit, suite: roomsMatching(world, 'hotelSuite')[0] as Room };
}

const ticks = (world: World): Record<string, boolean> =>
  Object.fromEntries((vipView(world)?.checklist ?? []).map((c) => [c.label, c.done]));

beforeEach(() => {
  resetEventTestHooks();
  EVENT_TEST_HOOKS.chance = { fire: 0, bomb: 0, vip: 1 };
});
afterEach(() => resetEventTestHooks());

describe('VIP card', () => {
  it('names the guest, when they arrive in plain words, the suite, and what they like as character, not scoring', () => {
    const { world, visit } = bookedTower();
    const view = vipView(world);
    // On the hour the VIP's identity picks, between 8:00 AM and 5:00 PM: 3:00 PM for this one.
    expect(vipArrivalHour(world.seed, visit.simId)).toBe(15);
    expect(view?.stage).toBe('booked');
    expect(view?.lines).toEqual([
      `${personName(world.seed, visit.simId)}, VIP guest`,
      'Arrives tomorrow afternoon at 3:00 PM',
      'Suite on floor 3',
      `Likes: ${visit.preference}`,
      VIP_RATED_ON,
    ]);
    expect(VIP_RATED_ON).toBe('Every VIP rates the same three things: the longest elevator wait, the suite and safety.');
    // Past midnight the same arrival is this afternoon.
    world.time.minute = 1440 + 60;
    expect(vipView(world)?.lines[1]).toBe('Arrives this afternoon at 3:00 PM');
  });

  it('ticks the checklist live from the tower', () => {
    const { world, suite } = bookedTower();
    expect(ticks(world)).toEqual({
      'A suite is ready for them': true,
      'The suite is clean': true,
      'The VIP can get to floor 3': true,
      'No fire or bomb in the tower': true,
    });

    suite.dirty = true;
    expect(ticks(world)['The suite is clean']).toBe(false);
    suite.dirty = false;

    const shaft = onlyShaft(world);
    shaft.stops.delete(3);
    world.routingDirty = true; // what the stop command sets
    expect(ticks(world)['The VIP can get to floor 3']).toBe(false);
    shaft.stops.add(3);
    world.routingDirty = true;

    EVENT_TEST_HOOKS.target.fire = roomsMatching(world, 'office')[0]?.id ?? null;
    startFire(world);
    expect(ticks(world)['No fire or bomb in the tower']).toBe(false);
    world.events = world.events.filter((e) => e.kind !== 'fire');

    world.rooms.delete(suite.id);
    expect(ticks(world)['A suite is ready for them']).toBe(false);
    expect(ticks(world)['The suite is clean']).toBe(false);
  });

  it('a bomb that went off during the stay keeps the last tick off until checkout (audit 2026-09-28, E2 S1)', () => {
    // Seed 6: the VIP arrives at 10 AM; a bomb from the arrival day's 6 AM roll, with no
    // security to find it, goes off at 1 PM, while the VIP is in the suite.
    const world = createWorld(6);
    world.stars = EVENTS.vip.minStar;
    world.cash = 100_000_000;
    buildTower(world, [
      ...lobbyRun(90, 170),
      { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 4 },
      { kind: 'build', room: 'office', floor: 2, x: 100 },
      { kind: 'build', room: 'hotelSuite', floor: 3, x: 152 },
    ]);
    atOnDay(world, 0, 6, 1);
    const visit = world.events.find((e): e is Visit => e.kind === 'vip')!;
    expect(visit.arrivesAt % 1440).toBe(10 * 60);
    while (world.time.minute < 1440 + 360) runMinutes(world, 1);
    EVENT_TEST_HOOKS.target.bomb = roomsMatching(world, 'office')[0]!.id;
    startBomb(world); // what the 6 AM roll does
    let guard = 0;
    while (visit.phase !== 'stay' && guard++ < 3000) runMinutes(world, 1);
    while (world.events.some((e) => e.kind === 'bomb') && guard++ < 6000) runMinutes(world, 1);
    expect([visit.phase, visit.incident]).toEqual(['stay', true]);
    const last = vipView(world)?.checklist?.at(-1);
    expect(last?.done).toBe(false);
    expect(last?.label).toBe('No fire or bomb during the visit');
  });

  it('after the rating shows the breakdown and the next chance', () => {
    const { world } = bookedTower();
    for (let i = 0; i < 3 * 1440 && world.events.some((e) => e.kind === 'vip'); i++) tick(world);
    const view = vipView(world);
    expect(view?.checklist).toBeNull();
    const rows = Object.fromEntries((view?.breakdown ?? []).map((r) => [r.label, r.value]));
    const last = world.stats.lastVip as VipVisitRecord;
    expect(rows['Longest wait']).toBe(`${last.longestWait === 1 ? '1 minute' : `${last.longestWait} minutes`} (${last.waitBand})`);
    expect(rows['Suite']).toBe(`Floor 3, clean (${last.suiteBand})`);
    expect(rows['Safety']).toBe('No fire or bomb (good)');
    expect(rows['Rating']).toBe(last.rating.charAt(0).toUpperCase() + last.rating.slice(1));
    expect(view?.nextChance).toBe(
      'Next chance: tomorrow at 6:00 AM. On the first day of each quarter at 6:00 AM, there is a 50% chance a VIP books a visit, if you have at least 3 stars and a clean, empty suite.',
    );
  });

  it('writes every breakdown row in plain words', () => {
    const record: VipVisitRecord = {
      simId: 5,
      minute: 0,
      rating: 'poor',
      preference: 'quick elevators',
      longestWait: 12,
      waitBand: 'poor',
      suiteClean: false,
      suiteBand: 'poor',
      incident: true,
      reason: null,
    };
    expect(vipBreakdown(record)).toEqual([
      { label: 'Longest wait', value: '12 minutes (poor)' },
      { label: 'Suite', value: 'Not clean (poor)' },
      { label: 'Safety', value: 'A fire or bomb (poor)' },
      { label: 'Rating', value: 'Poor' },
    ]);
    expect(vipBreakdown({ ...record, reason: 'The VIP left: no suite was ready', suiteClean: null, incident: false, longestWait: 0 })).toEqual([
      { label: 'Left early', value: 'No suite was ready' },
      { label: 'Longest wait', value: '0 minutes (good)' },
      { label: 'Suite', value: 'Never reached' },
      { label: 'Safety', value: 'No fire or bomb (good)' },
      { label: 'Rating', value: 'Poor' },
    ]);
    // A record that kept its suite names the floor; a clean suite rated low is fair.
    expect(vipBreakdown({ ...record, suiteFloor: 12, suiteId: 4, suiteClean: true, suiteBand: 'fair' })[1]).toEqual({
      label: 'Suite',
      value: 'Floor 12, clean, but rated low (fair)',
    });
    for (const row of vipBreakdown(record)) expect(row.value).not.toMatch(/[–—]/);
  });

  it('says nothing while there has never been a visit and none is booked, at any star; names the next chance in plain words', () => {
    const world = createWorld(1);
    expect(vipView(world)).toBeNull();
    world.stars = EVENTS.vip.minStar;
    expect(vipView(world)).toBeNull();
    expect(vipNextChance(world)).toMatch(/^Next chance: in 3 days at 6:00 AM\./);
    expect(vipNextChance(world)).not.toMatch(/weekday|quarter \d|year \d/i);
  });
});

describe('VIP card in Stories', () => {
  let dom: FakeDom;
  let uninstall: () => void;
  beforeEach(() => {
    dom = new FakeDom();
    uninstall = dom.install();
  });
  afterEach(() => uninstall());

  const ctx: PanelContext = {
    apply: () => ({ ok: true }) as never,
    notice: () => {},
    close: () => {},
    reducedMotion: false,
    setReducedMotion: () => {},
  };

  it('shows the checklist above the log and updates a tick on refresh', () => {
    const { world, suite } = bookedTower();
    const body = storiesBody({ world } as never, ctx);
    const panel = body.node as unknown as FakeElement;
    const card = () => panel.descendants().find((n) => n.className.includes('hs-vip'));
    const doneLabels = () =>
      (card()?.descendants() ?? []).filter((n) => n.className === 'hs-row hs-goal is-done').map((n) => n.children[0]?.textContent);
    expect(card()).toBeDefined();
    // Above the log: the VIP visit comes before Today.
    const titles = panel.descendants().filter((n) => n.className === 'hs-section-title').map((n) => n.textContent);
    expect(titles.indexOf('VIP visit')).toBeLessThan(titles.indexOf('Today'));
    expect(doneLabels()).toContain('The suite is clean');
    suite.dirty = true;
    body.refresh();
    expect(doneLabels()).not.toContain('The suite is clean');
    dom.created = 0;
    body.refresh();
    expect(dom.created).toBe(0);
  });
});
