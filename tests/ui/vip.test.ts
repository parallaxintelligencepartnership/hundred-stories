// The VIP card: live preparation ticks, the breakdown after a rating, and the next chance.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EVENT_TEST_HOOKS, resetEventTestHooks, startFire } from '../../src/sim/events';
import { personName, vipArrivalHour } from '../../src/sim/identity';
import { EVENTS } from '../../src/sim/rules';
import { tick } from '../../src/sim/tick';
import type { ActiveEvent, Room, VipVisitRecord, World } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';
import { createLogPanel, type PanelContext } from '../../src/ui/panels';
import { vipBreakdown, vipNextChance, vipView } from '../../src/ui/vip';
import { atOnDay, buildTower, lobbyRun, onlyShaft, roomsMatching } from '../scenarios/helpers';
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
  it('names the guest and their preference while the visit is booked', () => {
    const { world, visit } = bookedTower();
    const view = vipView(world);
    expect(view?.lines[0]).toBe(`${personName(world.seed, visit.simId)}, VIP guest`);
    expect(view?.lines[1]).toBe(`Cares most about ${visit.preference}`);
    // On the hour the VIP's identity picks, between 8:00 AM and 5:00 PM: 3:00 PM for this one.
    expect(vipArrivalHour(world.seed, visit.simId)).toBe(15);
    expect(view?.lines[2]).toBe('Arrives at the lobby weekday 2, quarter 1, year 1 at 3:00 PM');
  });

  it('ticks the checklist live from the tower', () => {
    const { world, suite } = bookedTower();
    expect(ticks(world)).toEqual({
      'A suite is ready for them': true,
      'The suite is clean': true,
      'An elevator stops at floor 3': true,
      'No fire or bomb in the tower': true,
    });

    suite.dirty = true;
    expect(ticks(world)['The suite is clean']).toBe(false);
    suite.dirty = false;

    const shaft = onlyShaft(world);
    shaft.stops.delete(3);
    expect(ticks(world)['An elevator stops at floor 3']).toBe(false);
    shaft.stops.add(3);

    EVENT_TEST_HOOKS.target.fire = roomsMatching(world, 'office')[0]?.id ?? null;
    startFire(world);
    expect(ticks(world)['No fire or bomb in the tower']).toBe(false);
    world.events = world.events.filter((e) => e.kind !== 'fire');

    world.rooms.delete(suite.id);
    expect(ticks(world)['A suite is ready for them']).toBe(false);
    expect(ticks(world)['The suite is clean']).toBe(false);
  });

  it('after the rating shows the breakdown and the next chance', () => {
    const { world } = bookedTower();
    for (let i = 0; i < 3 * 1440 && world.events.some((e) => e.kind === 'vip'); i++) tick(world);
    const view = vipView(world);
    expect(view?.checklist).toBeNull();
    const rows = Object.fromEntries((view?.breakdown ?? []).map((r) => [r.label, r.value]));
    const last = world.stats.lastVip as VipVisitRecord;
    expect(rows['Longest wait']).toBe(`${last.longestWait === 1 ? '1 minute' : `${last.longestWait} minutes`} (${last.waitBand})`);
    expect(rows['Suite clean']).toBe('Yes');
    expect(rows['Fire or bomb']).toBe('No');
    expect(rows['Rating']).toBe(last.rating.charAt(0).toUpperCase() + last.rating.slice(1));
    expect(view?.nextChance).toBe(
      'Next chance: weekday 1, quarter 2, year 1 at 6:00 AM. On the first day of each quarter at 6:00 AM, there is a 50% chance a VIP books a visit, if you have at least 3 stars and a clean, empty suite.',
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
      { label: 'Suite clean', value: 'No' },
      { label: 'Suite rating', value: 'Poor' },
      { label: 'Fire or bomb', value: 'Yes' },
      { label: 'Rating', value: 'Poor' },
    ]);
    expect(vipBreakdown({ ...record, reason: 'The VIP left: no suite was ready', suiteClean: null, incident: false, longestWait: 0 })).toEqual([
      { label: 'Visit', value: 'The VIP left: no suite was ready' },
      { label: 'Longest wait', value: '0 minutes (good)' },
      { label: 'Suite clean', value: 'Never reached' },
      { label: 'Fire or bomb', value: 'No' },
      { label: 'Rating', value: 'Poor' },
    ]);
    for (const row of vipBreakdown(record)) expect(row.value).not.toMatch(/[–—]/);
  });

  it('says nothing below the VIP star, and names the rule from it', () => {
    const world = createWorld(1);
    expect(vipView(world)).toBeNull();
    world.stars = EVENTS.vip.minStar;
    expect(vipView(world)?.lines).toEqual(['No VIP has visited yet']);
    expect(vipNextChance(world)).toMatch(/^Next chance: weekday 1, quarter 2, year 1 at 6:00 AM\./);
  });
});

describe('VIP card in the event log', () => {
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
    const panel = createLogPanel({ world } as never, ctx) as unknown as FakeElement;
    const card = () => panel.descendants().find((n) => n.className.includes('hs-vip'));
    const doneLabels = () =>
      (card()?.descendants() ?? []).filter((n) => n.className === 'hs-row hs-goal is-done').map((n) => n.children[0]?.textContent);
    expect(card()).toBeDefined();
    expect(doneLabels()).toContain('The suite is clean');
    suite.dirty = true;
    (panel as unknown as { refresh(): void }).refresh();
    expect(doneLabels()).not.toContain('The suite is clean');
    dom.created = 0;
    (panel as unknown as { refresh(): void }).refresh();
    expect(dom.created).toBe(0);
  });
});
