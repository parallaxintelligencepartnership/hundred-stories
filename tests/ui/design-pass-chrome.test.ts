// The chrome package of the 2026-09-25 design pass (D-19 to D-28): the rules that live in
// ui.css and the icon sheet, and the collapsed goals pill.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSideCard } from '../../src/ui/cards';
import { createIconSheet } from '../../src/ui/icons';
import { createUi } from '../../src/ui/ui';
import { FakeDom, type FakeElement } from './fake-dom';

const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8');
const site = readFileSync(new URL('../../src/site/site.css', import.meta.url), 'utf8');

/** The body of the first rule whose selector list is exactly `selector`, at any indent. */
function ruleOf(source: string, selector: string): string {
  const match = new RegExp(`(^|\\n)[ \\t]*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{`).exec(source);
  if (!match) return '';
  const at = match.index + match[0].length;
  return source.slice(at, source.indexOf('}', at));
}

/** Every block of a light theme: the system one and the explicit one. */
function lightBlocks(source: string): string[] {
  return [ruleOf(source, ":root:not([data-theme='dark'])"), ruleOf(source, ":root[data-theme='light']")];
}

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
});
afterEach(() => uninstall());

describe('D-19: news arrives without moving', () => {
  it('fades a news toast in with no rise; an alert toast keeps its rise', () => {
    const starts = css.split('@starting-style {').slice(1).map((part) => part.slice(0, part.indexOf('}\n}')));
    const news = starts.find((s) => /\n\s*\.hs-news-toast \{/.test(s)) ?? '';
    const alert = starts.find((s) => /\n\s*\.hs-alert-toast \{/.test(s)) ?? '';
    expect(news).toContain('opacity: 0;');
    expect(news).not.toContain('transform');
    expect(alert).toContain('opacity: 0;');
    expect(alert).toContain('transform: translateY(var(--toast-rise));');
    expect(css).not.toMatch(/\.hs-news-toast,\s*\.hs-alert-toast \{\s*opacity: 0;\s*transform/);
  });
});

describe('D-20: the reset has no specificity', () => {
  it('resets buttons, inputs and selects through :where, so a row or a stepper keeps its size', () => {
    const reset = ruleOf(css, '.hs-ui :where(button, input, select)');
    expect(reset).toContain('font: inherit;');
    expect(reset).toContain('color: inherit;');
    expect(css).not.toContain('.hs-ui button,\n.hs-ui input,\n.hs-ui select {');
    expect(ruleOf(css, '.hs-set-row')).toContain('font-size: var(--size-16);');
    expect(ruleOf(css, '.hs-stepper-btn')).toContain('font-size: var(--size-20);');
  });
});

describe('D-21: the clock and the floor readout in the indicator face', () => {
  it('draws the clock digits and the hover floor in --indicator, the floor in the readout face', () => {
    expect(ruleOf(css, '.hs-clock-digits')).toContain('color: var(--indicator);');
    const hover = ruleOf(css, '.hs-status-hover .hs-readout-value');
    for (const line of ['font-family: var(--font-readout);', 'font-weight: 400;', 'letter-spacing: 0.02em;', 'color: var(--indicator);']) {
      expect(hover).toContain(line);
    }
    // Cash stays ink: green would read as a gain.
    expect(ruleOf(css, '.hs-status-cash .hs-readout-value')).not.toContain('color');
  });
});

describe('D-22: the collapsed goals card is a small pill', () => {
  const titleOf = (node: FakeElement): string =>
    node.descendants().find((n) => n.className === 'hs-panel-title-text')?.textContent ?? '';
  const goals = {
    title: 'Next: 3 stars',
    items: [
      { label: 'People', value: '300 of 300', done: true },
      { label: 'Security', value: 'None', done: false },
      { label: 'Hotel', value: '0 of 1', done: false },
    ],
  };

  it('folds into one pill control: the count, a chevron, no Show button, and a tap anywhere shows the goals', () => {
    let toggles = 0;
    const card = createSideCard({ skipGuide() {}, openTools() {}, toggleGoals: () => (toggles += 1) });
    const node = card.node as unknown as FakeElement;
    card.showGoals(goals, null, true);
    expect(node.classList.contains('is-collapsed')).toBe(true);
    const pill = node.descendants().find((n) => n.className.split(' ').includes('hs-card-pill')) as FakeElement;
    expect(pill.tagName).toBe('BUTTON'); // a real button: Enter and Space press it
    expect(pill.hidden).toBe(false);
    expect(pill.descendants().find((n) => n.className.split(' ').includes('hs-card-pill-text'))?.textContent).toBe('Goals, 1 of 3');
    expect(pill.descendants().some((n) => (n.getAttribute('class') ?? '').includes('hs-card-pill-chevron'))).toBe(true);
    expect(pill.getAttribute('aria-label')).toBe('Goals, 1 of 3, show');
    expect(pill.getAttribute('aria-expanded')).toBe('false');
    // The head, with its Show button, is not part of the pill.
    const head = node.children.find((n) => n.className === 'hs-panel-head') as FakeElement;
    expect(head.hidden).toBe(true);
    expect(pill.descendants().some((n) => n.textContent === 'Show')).toBe(false);
    (pill.listeners.get('click') ?? []).forEach((f) => f({}));
    expect(toggles).toBe(1);

    card.showGoals(goals, null, false);
    expect(pill.hidden).toBe(true);
    expect(head.hidden).toBe(false);
    expect(titleOf(node)).toBe('Next: 3 stars');
    card.showGoals(null, null, true);
    expect(pill.getAttribute('aria-label')).toBe('Tower, show');
  });

  it('keeps the pill under Share and Menu only: as wide as they span, right-aligned under Menu', () => {
    const store = (globalThis as unknown as { window: { localStorage: { setItem(k: string, v: string): void } } }).window.localStorage;
    store.setItem('hs.intro.seen', 'true');
    store.setItem('hs.guide.done', 'true');
    const game = {
      world: {
        seed: 1, cash: 1e6, population: 0, stars: 1, time: { minute: 0 }, log: [], logTotal: 0, rooms: new Map(), shafts: new Map(),
        sims: new Map(), events: [], stats: { lastQuarter: null, vipRating: 'none', weddingsHeld: 0 },
        story: { followed: [], threads: {}, recent: [], seq: 0 },
      },
      subscribe: () => () => {}, getHover: () => null, getSpeed: () => 1, getTool: () => ({ kind: 'none' }), setTool() {},
      getPlacement: () => null, getPlacementRect: () => null, getSelection: () => null, setChrome() {}, setReducedMotion() {}, getSlot: () => 'mine',
    } as never;
    const root = dom.createElement('div');
    createUi(root as never, game, {} as never);
    const named = (label: string): FakeElement =>
      root.descendants().find((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === label) as FakeElement;
    const rect = (left: number, width: number) => () => ({ left, width, right: left + width, top: 12, bottom: 64, height: 52 });
    // The shell is 1000 wide in the fake; Share at 780 to 880, Menu at 888 to 988.
    Object.assign(named('Share'), { getBoundingClientRect: rect(780, 100) });
    Object.assign(named('Menu'), { getBoundingClientRect: rect(888, 100) });
    dom.fireWindow('resize');
    const card = root.descendants().find((n) => n.className.split(' ').includes('hs-card')) as FakeElement;
    expect(card.style['--pill-max-w']).toBe(`${988 - 780}px`);
    expect(card.style['--pill-right']).toBe(`${1000 - 988}px`);
    const wide = css.slice(css.lastIndexOf('@media (min-width: 721px) {'));
    const pillRule = ruleOf(wide, '.hs-card.is-collapsed');
    expect(pillRule).toContain('max-width: var(--pill-max-w');
    expect(pillRule).toContain('right: var(--pill-right');
    // A very long title ends in an ellipsis rather than pushing the pill wider.
    const text = ruleOf(css, '.hs-card-pill-text');
    expect(text).toContain('text-overflow: ellipsis;');
    expect(text).toContain('min-width: 0;');
  });

  it('shrinks the collapsed card to its content above 720 px', () => {
    const wide = css.slice(css.lastIndexOf('@media (min-width: 721px) {'));
    expect(ruleOf(wide, '.hs-card.is-collapsed')).toContain('width: max-content;');
  });
});

describe('D-24: tiles on sky', () => {
  it('puts every tile picture on a daytime sky', () => {
    expect(ruleOf(css, '.hs-tool-pic')).toContain('background: linear-gradient(180deg, #9fd3f5 0%, #dcefff 100%);');
  });
});

describe('D-25: amber as a fill and as a text color', () => {
  it('adds --amber-text, the same amber in dark, and points the focus ring at it', () => {
    const root = ruleOf(css, ':root');
    expect(root).toContain('--amber: #f4b942;');
    expect(root).toContain('--amber-text: #f4b942;');
    expect(root).toContain('--focus-color: var(--amber-text);');
  });

  it('keeps the fill amber in the light theme and darkens only text and lines', () => {
    for (const source of [css, site]) {
      for (const block of lightBlocks(source)) {
        for (const line of ['--amber: #f4b942;', '--on-amber: #14181f;', '--amber-text: #8a5a00;', '--indicator: #0a6a48;']) {
          expect(block).toContain(line);
        }
      }
    }
    expect(ruleOf(site, ':root')).toContain('--amber-text: #f4b942;');
    expect(ruleOf(site, '.challenge')).toContain('color: var(--amber-text);');
  });

  it('uses --amber-text wherever amber is words or a line', () => {
    const uses: [string, string][] = [
      ['.hs-speed-mode', 'color: var(--amber-text);'],
      ['.hs-log-item.is-warn .hs-log-text', 'color: var(--amber-text);'],
      ['.hs-goal.is-done .hs-row-value', 'color: var(--amber-text);'],
      ['.hs-panel-icon', 'color: var(--amber-text);'],
      ['.hs-controls-icon', 'color: var(--amber-text);'],
      ['.hs-palette-toggle:hover', 'color: var(--amber-text);'],
      ['.hs-toast-close:hover', 'color: var(--amber-text);'],
      ['.hs-card-nudge', 'border-left: 2px solid var(--amber-text);'],
      ['.hs-place-chip', 'border: 1px solid var(--amber-text);'],
      ['.hs-tool.hs-tool-hint', 'outline: 2px solid var(--amber-text);'],
      ['.hs-dial-hand', 'stroke: var(--amber-text);'],
      ['.hs-dial-pin', 'fill: var(--amber-text);'],
    ];
    for (const [selector, line] of uses) expect(ruleOf(css, selector), selector).toContain(line);
    // The stars keep an amber fill and take the text amber for their outline.
    for (const selector of ['.hs-star.is-earned', '.hs-count-glyph']) {
      expect(ruleOf(css, selector)).toContain('fill: var(--amber);');
      expect(ruleOf(css, selector)).toContain('color: var(--amber-text);');
    }
  });
});

describe('D-26: the Services tab is a service bell', () => {
  it('draws a bell on a counter, not a bin', () => {
    const sheet = createIconSheet() as unknown as FakeElement;
    const symbol = sheet.children.find((n) => n.getAttribute('id') === 'hs-icon-services') as unknown as { innerHTML: string };
    expect(symbol.innerHTML).toContain('<path d="M2 12.75h12"');
    expect(symbol.innerHTML).toContain('<path d="M3.5 12.75a4.5 4.5 0 0 1 9 0"');
    expect(symbol.innerHTML).toContain('<path d="M8 8.25V6.5M6.75 6.5h2.5"');
    expect(symbol.innerHTML).not.toContain('M3.5 4.5h9');
  });
});

/** WCAG contrast of two #rrggbb colors. */
function contrast(a: string, b: string): number {
  const lum = (hex: string): number => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (bl as number);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('C-1: tile keycaps are a solid plate of their own', () => {
  it('draws each tile letter on the dark top bar steel in its ink, the same in both themes, 4.5:1 or better', () => {
    const root = ruleOf(css, ':root');
    const plate = /--keycap: (#[0-9a-f]{6});/.exec(root)?.[1] ?? '';
    const ink = /--on-keycap: (#[0-9a-f]{6});/.exec(root)?.[1] ?? '';
    // The dark theme's steel and ink, which the top bar is drawn in.
    expect([plate, ink]).toEqual([/--steel: (#[0-9a-f]{6});/.exec(root)?.[1], /--ink: (#[0-9a-f]{6});/.exec(root)?.[1]]);
    for (const block of lightBlocks(css)) expect(block).not.toContain('keycap');
    expect(contrast(plate, ink)).toBeGreaterThanOrEqual(4.5);
    const key = ruleOf(css, '.hs-tool-key');
    for (const line of ['background: var(--keycap);', 'color: var(--on-keycap);', 'border-radius: 4px;']) expect(key).toContain(line);
    // A selected tile does not recolor its keycap: the plate stays readable on amber too.
    expect(ruleOf(css, ".hs-tool[aria-pressed='true'] .hs-tool-key")).not.toContain('color');
  });
});

describe('C-2: the Views button ring when a view is on', () => {
  it('rings the Views button in the text amber, like every pressed ring', () => {
    expect(ruleOf(css, '.hs-views-btn.is-on')).toContain('inset 0 0 0 2px var(--amber-text)');
  });
});

describe('D-27: round keycaps', () => {
  it('draws the tile letters and the group numbers as soft tinted keycaps', () => {
    for (const selector of ['.hs-tool-key', '.hs-group-key']) {
      const rule = ruleOf(css, selector);
      for (const line of ['border: 0;', 'border-radius: 4px;', 'padding: 0 4px;']) expect(rule, selector).toContain(line);
      expect(rule).not.toContain('var(--line)');
    }
    // The group number sits on the dock's own surface, so a tint is enough there (C-1 plates the tiles').
    expect(ruleOf(css, '.hs-group-key')).toContain('background: var(--press-tint);');
  });
});

describe('D-28: a silent sound row dims as a whole', () => {
  it('dims the label and the value beside a disabled level', () => {
    expect(ruleOf(css, '.hs-level:has(input:disabled) .hs-set-label,\n.hs-level:has(input:disabled) .hs-level-value')).toContain(
      'color: var(--ink-dim);',
    );
  });
});
