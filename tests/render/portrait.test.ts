// The person panel's portrait (package 2): a 48 px head and shoulders crop of the same figure the
// world draws for that person, beside "Who".

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FRAME } from '../../src/render/anim';
import { drawPerson, drawPortrait, personLookCode, type Ctx2D } from '../../src/render/figure';
import { ROOMS } from '../../src/sim/rules';
import { storyName } from '../../src/sim/story';
import type { Room, Sim } from '../../src/sim/types';
import { addRoom, addSim, allocId, createWorld } from '../../src/sim/world';
import { createQueryPanel, PORTRAIT_PX, type PanelContext } from '../../src/ui/panels';
import { FakeDom, type FakeElement } from '../ui/fake-dom';

/** A context that records every drawing call with its arguments. */
function recorder(): { ctx: Ctx2D; calls: string[] } {
  const calls: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (target, key: string) => (key in target ? target[key] : (...args: unknown[]) => calls.push(`${key}(${args.map((a) => (typeof a === 'number' ? a.toFixed(3) : String(a))).join(',')})`)),
    set: (target, key: string, value) => {
      target[key] = value;
      calls.push(`${key}=${String(value)}`);
      return true;
    },
  });
  return { ctx: ctx as unknown as Ctx2D, calls };
}

describe('portrait', () => {
  it('draws exactly the standing figure the world draws, scaled into the square', () => {
    const code = personLookCode(8, 21, 'worker');
    const figure = recorder();
    drawPerson(figure.ctx, 'worker', code, FRAME.stand);
    const portrait = recorder();
    drawPortrait(portrait.ctx, 'worker', code, PORTRAIT_PX);
    const at = portrait.calls.indexOf(figure.calls[0] as string);
    expect(at).toBeGreaterThan(0);
    expect(portrait.calls.slice(at, at + figure.calls.length)).toEqual(figure.calls);
    expect(portrait.calls.slice(0, at).some((c) => c.startsWith('scale('))).toBe(true);
  });

  describe('in the person panel', () => {
    let dom: FakeDom;
    let uninstall: () => void;
    beforeEach(() => {
      dom = new FakeDom();
      uninstall = dom.install();
    });
    afterEach(() => uninstall());

    it('sits beside the Who lines, 48 px, named for the person', () => {
      const world = createWorld(8);
      const home: Room = {
        id: allocId(world), kind: 'office', floor: 4, x: 100, width: ROOMS.office.width, height: 1, eval: 1, tenants: [], occupancy: 0,
        builtAtMinute: 0, vacant: false, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 100,
      };
      addRoom(world, home);
      const sim: Sim = {
        id: allocId(world), kind: 'worker', homeRoomId: home.id, pos: { floor: 4, x: 104 }, inCarId: null, inRoomId: home.id, route: [], state: 'inRoom',
        stress: 0, waitStart: null, schedule: [], nextScheduleIndex: 0, stayUntil: null, wallet: 0, leaveReason: null,
      };
      addSim(world, sim);
      const ctx: PanelContext = { apply: () => ({ ok: true }) as never, notice: () => {}, close: () => {}, reducedMotion: false, setReducedMotion: () => {} };
      const panel = createQueryPanel({ world } as never, { simId: sim.id }, ctx) as unknown as FakeElement;
      const who = panel.descendants().find((n) => n.className === 'hs-section' && n.children[0]?.textContent === 'Who');
      expect(who).toBeDefined();
      const portrait = who!.descendants().find((n) => n.className === 'hs-portrait');
      expect(portrait?.tagName).toBe('CANVAS');
      expect(portrait?.style['width']).toBe(`${PORTRAIT_PX}px`);
      expect(PORTRAIT_PX).toBe(48);
      expect(portrait?.attributes.get('aria-label')).toBe(`Portrait of ${storyName(world, sim.id)}`);
      const row = portrait!.parentNode!;
      expect(row.children.map((c) => c.className)).toEqual(['hs-portrait', 'hs-story-who']);
    });
  });
});
