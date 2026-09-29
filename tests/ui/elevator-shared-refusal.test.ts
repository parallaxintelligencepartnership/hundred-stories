// An untouched elevator's cars are all refused for the same reason; the panel says it once
// ("Every car ...") and keeps a per-car line only when the cars differ (audit close, 2026-09-28).
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
  return { world, game, shaftId };
}

/** Every visible refusal line in the panel. */
const refusedLines = (panel: FakeElement): string[] =>
  panel
    .descendants()
    .filter((n) => n.tagName === 'P' && n.className.split(/\s+/).includes('hs-refused') && !n.hidden)
    .map((n) => n.textContent);

it('an untouched 8-car elevator says the shared reason once, not once per car', () => {
  const { game, shaftId } = shaftGame(3, 8);
  const panel = createQueryPanel(game, { shaftId }, ctx) as unknown as FakeElement;
  const lines = refusedLines(panel);
  expect(lines).toEqual([
    'Add car: This elevator already has 8 cars.',
    'Every car already reaches the top and bottom of the elevator.',
  ]);
});

it('a car whose floors differ gets its own line, and the others keep theirs', () => {
  const { world, game, shaftId } = shaftGame(3, 2);
  const shaft = world.shafts.get(shaftId)!;
  const car = shaft.cars[1]!;
  expect(applyCommand(world, { kind: 'shaft.setCarRange', shaftId, carId: car.id, range: { lo: 2, hi: 3 } }).ok).toBe(true);
  const panel = createQueryPanel(game, { shaftId }, ctx) as unknown as FakeElement;
  const lines = refusedLines(panel);
  expect(lines.some((t) => t.startsWith('Every car'))).toBe(false);
  expect(lines).toContain('This car already reaches the top and bottom of the elevator.');
  expect(lines.filter((t) => t.startsWith('This car') || t.startsWith('A car'))).toHaveLength(2);
});

it('the shared line goes when a car is changed, on the next refresh', () => {
  const { world, game, shaftId } = shaftGame(3, 2);
  const panel = createQueryPanel(game, { shaftId }, ctx) as unknown as FakeElement & { refresh(): void };
  expect(refusedLines(panel)).toContain('Every car already reaches the top and bottom of the elevator.');
  const car = world.shafts.get(shaftId)!.cars[0]!;
  expect(applyCommand(world, { kind: 'shaft.setCarRange', shaftId, carId: car.id, range: { lo: 2, hi: 3 } }).ok).toBe(true);
  panel.refresh();
  expect(refusedLines(panel).some((t) => t.startsWith('Every car'))).toBe(false);
});
