// A refused elevator control says why in plain text, not only in a tooltip (audit 2026-09-28,
// E1 S3): a touch player has no hover, and a disabled button fires no click to explain itself.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createQueryPanel, type PanelContext } from '../../src/ui/panels';
import { applyCommand, canExtendShaft } from '../../src/sim/build';
import { createWorld } from '../../src/sim/world';
import { FakeDom, type FakeElement } from './fake-dom';

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

function shaftGame(floorMax: number, cars: number) {
  const world = createWorld(7);
  world.cash = 50_000_000;
  world.stars = 3;
  for (let x = 0; x < 40; x += 1) applyCommand(world, { kind: 'build', room: 'lobby', floor: 1, x });
  expect(applyCommand(world, { kind: 'shaft.build', shaft: 'standard', x: 20, floorMin: 1, floorMax }).ok).toBe(true);
  const shaftId = [...world.shafts.keys()][0]!;
  for (let i = 1; i < cars; i += 1) expect(applyCommand(world, { kind: 'shaft.addCar', shaftId }).ok).toBe(true);
  const game = {
    world,
    canExtend: (id: number, lo: number, hi: number) => canExtendShaft(world, id, lo, hi),
  } as never;
  return { game, shaftId };
}

/** Every visible refusal line in the panel. */
const refusals = (panel: unknown): string[] =>
  (panel as FakeElement)
    .descendants()
    .filter((n) => n.tagName === 'P' && n.className.split(/\s+/).includes('hs-note') && !n.hidden)
    .map((n) => n.textContent)
    .filter((t) => t.includes(':') || t.startsWith('This car') || t.startsWith('People'));

it('Extend up on a 30-floor elevator shows the reason as text, and keeps the tooltip', () => {
  const { game, shaftId } = shaftGame(30, 1);
  const panel = createQueryPanel(game, { shaftId }, ctx) as unknown as FakeElement;
  const up = panel.descendants().find((n) => n.tagName === 'BUTTON' && n.textContent === 'Extend up')!;
  expect(up.disabled).toBe(true);
  expect(up.title).toBe('Elevators can span only 30 floors.');
  expect(refusals(panel)).toContain('Extend up and Extend down: Elevators can span only 30 floors.');
});

it('Add car at eight cars shows the reason as text', () => {
  const { game, shaftId } = shaftGame(3, 8);
  const panel = createQueryPanel(game, { shaftId }, ctx) as unknown as FakeElement;
  expect(refusals(panel)).toContain('Add car: This elevator already has 8 cars.');
});

it('a car that works the whole shaft says so once under its floor buttons', () => {
  const { game, shaftId } = shaftGame(3, 2);
  const panel = createQueryPanel(game, { shaftId }, ctx) as unknown as FakeElement;
  const lines = refusals(panel).filter((t) => t.startsWith('This car'));
  expect(lines).toEqual([
    'This car already reaches the top and bottom of the elevator.',
    'This car already reaches the top and bottom of the elevator.',
  ]);
});

it('says nothing when every control works', () => {
  const { game, shaftId } = shaftGame(3, 2);
  const panel = createQueryPanel(game, { shaftId }, ctx) as unknown as FakeElement;
  expect(refusals(panel).filter((t) => t.startsWith('Add car') || t.startsWith('Remove car') || t.startsWith('Extend up'))).toEqual([]);
});
