// The status bar's View control on the fake DOM: one view at a time, the legend appears and
// clears, and the shell hands the choice to the renderer.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OVERLAY_RAMP } from '../../src/render/overlays';
import { createViewControl, VIEW_OPTIONS, type ViewChoice } from '../../src/ui/overlays';
import { createUi } from '../../src/ui/ui';
import { FakeDom, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
});
afterEach(() => uninstall());

function buttonsOf(root: FakeElement): FakeElement[] {
  return root.descendants().filter((n) => n.className.split(' ').includes('hs-view-btn'));
}

function click(node: FakeElement): void {
  for (const fn of node.listeners.get('click') ?? []) fn({});
}

function pressed(root: FakeElement): string[] {
  return buttonsOf(root)
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.textContent);
}

describe('view control', () => {
  it('offers Off and the four views, sentence case, with Off pressed and no legend', () => {
    const control = createViewControl(() => {});
    const root = control.root as unknown as FakeElement;
    expect(buttonsOf(root).map((b) => b.textContent)).toEqual(['Off', 'Stress', 'Noise', 'Vacancy', 'Elevator wait']);
    expect(VIEW_OPTIONS.map((o) => o.kind)).toEqual([null, 'stress', 'noise', 'vacancy', 'wait']);
    expect(root.children[0]?.textContent).toBe('View');
    expect(pressed(root)).toEqual(['Off']);
    expect(control.legend.classList.contains('is-hidden')).toBe(true);
  });

  it('keeps one view on at a time and reports each change once', () => {
    const changes: ViewChoice[] = [];
    const control = createViewControl((kind) => changes.push(kind));
    const root = control.root as unknown as FakeElement;
    const [off, stress, noise] = buttonsOf(root);
    click(stress!);
    click(noise!);
    click(noise!); // already on: no change
    expect(pressed(root)).toEqual(['Noise']);
    expect(control.get()).toBe('noise');
    click(off!);
    expect(pressed(root)).toEqual(['Off']);
    expect(changes).toEqual(['stress', 'noise', null]);
  });

  it('shows the legend while a view is on and clears it when turned off', () => {
    const control = createViewControl(() => {});
    const legend = control.legend as unknown as FakeElement;
    control.set('wait');
    expect(legend.classList.contains('is-hidden')).toBe(false);
    expect(legend.children).toHaveLength(5);
    expect(legend.textContent).toBe('NobodyUnder 5 min5 to 1515 to 3535 min or more');
    const swatches = legend.descendants().filter((n) => n.className === 'hs-legend-swatch');
    expect(swatches.map((s) => s.style['background'])).toEqual(OVERLAY_RAMP.map((c) => `#${c.toString(16).padStart(6, '0')}`));
    control.set('vacancy');
    expect(legend.textContent).toBe('OccupiedVacant');
    control.set(null);
    expect(legend.classList.contains('is-hidden')).toBe(true);
    expect(legend.children).toHaveLength(0);
  });
});

describe('view control in the shell', () => {
  function fakeGame() {
    return {
      world: {
        cash: 1_000_000,
        population: 0,
        stars: 1,
        time: { minute: 0 },
        log: [],
        logTotal: 0,
        rooms: new Map(),
        shafts: new Map(),
        sims: new Map(),
        events: [],
      },
      subscribe: () => () => {},
      getHover: () => null,
      getSpeed: () => 1,
      getTool: () => ({ kind: 'none' }),
      setTool: () => {},
      getPlacement: () => null,
      getPlacementRect: () => null,
      getSelection: () => null,
      setChrome: () => {},
      setReducedMotion: () => {},
    } as never;
  }

  it('sits in the status bar and hands each choice to renderer.setOverlay, off by default', () => {
    const calls: ViewChoice[] = [];
    const root = dom.createElement('div');
    createUi(root as never, fakeGame(), { setOverlay: (kind: ViewChoice) => calls.push(kind) } as never);
    const top = root.descendants().find((n) => n.className === 'hs-top')!;
    const buttons = buttonsOf(top);
    expect(buttons).toHaveLength(5);
    expect(calls).toEqual([]); // nothing is remembered, so nothing is restored
    click(buttons[1]!);
    click(buttons[4]!);
    click(buttons[0]!);
    expect(calls).toEqual(['stress', 'wait', null]);
  });
});
