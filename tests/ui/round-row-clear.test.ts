// The row of round buttons under the top bar (Save, Sound, Watch, placed from Views) against its
// neighbours on a wide screen (P1 review I-3 and I-4):
// - the open Build dock: below 820 px (1024 px with Larger text) the three keep to their icons,
//   hovered or not, and with Larger text below 840 px the dock starts under their row;
// - the view's chip: where it would meet one of them it takes the row under theirs, decided with
//   their words out and never raised again while the words fold and come back.
// The fake DOM lays nothing out, so the widths come from ui.css and the P1 review's measured text
// widths (1x; Larger text scales the words by 1.25 and keeps the fixed paddings), and the chip's
// decision is driven through stubbed measures.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createViewChipRow, viewChipMeets } from '../../src/ui/layout';
import { createUi } from '../../src/ui/ui';
import { FakeDom, type FakeElement } from './fake-dom';

const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The body of the block opened by `head`, braces balanced. */
function block(head: string): string {
  const start = css.indexOf(head);
  if (start < 0) throw new Error(`no ${head}`);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, i);
  }
  throw new Error(`unclosed ${head}`);
}

/** The highest max-width of a wide screen block whose body names `needle` (at Larger text or not). */
function upTo(needle: string, large: boolean): number {
  const re = /@media \(min-width: 721px\) and \(max-width: (\d+)px\) \{/g;
  let found = 0;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    const body = block(m[0]);
    if (body.includes(needle) && body.includes('hs-large-text') === large) found = Math.max(found, Number(m[1]));
  }
  return found;
}

const GAP = 8;
const EDGE = 12;
const TEXT = { views: 40.5, share: 39.8, menu: 38.2, watch: 44, sound: 44, saved: 42 };

/** Save's left edge from the bar's right edge, its words out ("Saved", the widest) or folded. */
function saveReach(scale: number, words: boolean): number {
  const icon = 44 * scale + 8;
  const round = (text: number): number => Math.max(icon, 12 + 18 + 6 + 14 + text * scale);
  const watchCenter = round(TEXT.menu) + GAP + round(TEXT.share) + GAP + round(TEXT.views) / 2;
  const w = (text: number): number => (words ? round(text) : icon);
  return watchCenter + w(TEXT.watch) / 2 + GAP + w(TEXT.sound) + GAP + w(TEXT.saved);
}

describe('Save, Sound and Watch clear the open Build dock from 721 px up', () => {
  const iconsTo1x = upTo(':is(.hs-watch-btn, .hs-sound-btn, .hs-save-btn) .hs-btn-label', false);
  const iconsToLarge = upTo(':is(.hs-watch-btn, .hs-sound-btn, .hs-save-btn) .hs-btn-label', true);
  const dockDownTo = upTo('.hs-palette', true);

  it('fold to their icons, hover or focus included, where their words would reach it', () => {
    expect([iconsTo1x, iconsToLarge, dockDownTo]).toEqual([819, 1023, 839]);
    const fold = block('@media (min-width: 721px) and (max-width: 819px) {');
    expect(fold).toMatch(/\.hs-ui :is\(\.hs-watch-btn, \.hs-sound-btn, \.hs-save-btn\) \{\s*padding: 0;\s*\}/);
    expect(fold).toMatch(/\.hs-btn-label \{\s*max-width: 0;\s*opacity: 0;\s*margin-left: -6px;\s*\}/);
    // No :hover or :focus-visible escape: a hovered Save would spread under the dock again.
    expect(fold).not.toMatch(/:hover|:focus/);
    // The dock starts under their row where even the icons reach it.
    const down = block('@media (min-width: 721px) and (max-width: 839px) {');
    expect(down).toMatch(/top: calc\(var\(--top-actual, calc\(var\(--top-h\) \+ var\(--safe-top\)\)\) \+ 2 \* var\(--gap-float\) \+ var\(--touch\) \+ 8px\);/);
  });

  it.each([[1, 288], [1.25, 360]])('at scale %s every width from 721 to 2560 keeps Save a gap right of the dock', (scale, palette) => {
    const iconsTo = scale === 1 ? iconsTo1x : iconsToLarge;
    const failsBefore: number[] = [];
    for (let vw = 721; vw <= 2560; vw += 1) {
      const W = vw - 2 * EDGE;
      const dockBelowRow = scale > 1 && vw <= dockDownTo;
      const words = vw > iconsTo;
      if (!dockBelowRow) expect(W - saveReach(scale, words), `vw ${vw}`).toBeGreaterThanOrEqual(palette + GAP);
      // Before: the words always out, the dock always in their row.
      if (W - saveReach(scale, true) < palette + GAP) failsBefore.push(vw);
    }
    // The review's band: Save under the dock below about 808 px (about 930 with Larger text).
    expect(failsBefore[0]).toBe(721);
    expect(failsBefore.at(-1)).toBe(scale === 1 ? 808 : 931);
  });
});

describe('the view chip never shares a row with a round button it would meet', () => {
  it('meets a button within a gap, on either side, and ignores one not laid out', () => {
    const save = { left: 600, right: 692 };
    expect(viewChipMeets({ left: 300, right: 594 }, [save], 8)).toBe(true); // 2 px short of a gap
    expect(viewChipMeets({ left: 300, right: 592 }, [save], 8)).toBe(false); // exactly a gap
    expect(viewChipMeets({ left: 698, right: 900 }, [save], 8)).toBe(true);
    expect(viewChipMeets({ left: 300, right: 700 }, [{ left: 0, right: 0 }], 8)).toBe(false);
    expect(viewChipMeets({ left: 0, right: 0 }, [save], 8)).toBe(false);
  });

  it('once lowered for a layout it stays lowered while the words fold, and a new layout decides afresh', () => {
    const row = createViewChipRow();
    expect(row('589|1376', true)).toBe(true); // words out: Save meets the chip
    expect(row('589|1376', false)).toBe(true); // words folded: Save is narrower, the chip stays down
    expect(row('298|1376', false)).toBe(false); // another view, a narrower chip
    expect(row('298|1376', true)).toBe(true);
    expect(row('298|2000', false)).toBe(false); // a resize
  });

  describe('in the ui', () => {
    let dom: FakeDom;
    let uninstall: () => void;
    beforeEach(() => {
      dom = new FakeDom();
      uninstall = dom.install();
    });
    afterEach(() => uninstall());

    it('turning a view on whose chip meets Save lowers it; off, or clear of the buttons, it stays in the row', () => {
      const world = {
        cash: 2_000_000, population: 0, stars: 1, time: { minute: 12 * 60 }, log: [], logTotal: 0,
        rooms: new Map(), shafts: new Map(), sims: new Map(), events: [],
      };
      const api = {
        world, subscribe: () => () => {}, getHover: () => null, getSpeed: () => 1, getTool: () => ({ kind: 'none' }),
        setTool: () => {}, getPlacement: () => null, getPlacementRect: () => null, getSelection: () => null,
        setChrome: () => {}, setReducedMotion: () => {},
      } as never;
      const root = dom.createElement('div');
      const ui = createUi(root as never, api, { setOverlay: () => {} } as never);
      const has = (n: FakeElement, c: string): boolean => n.className.split(/\s+/).includes(c);
      const find = (c: string): FakeElement => root.descendants().find((n) => has(n, c))!;
      const shell = find('hs-ui');
      const at = (node: FakeElement, left: number, right: number): void => {
        (node as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect = () => ({ left, right, width: right - left, top: 0, bottom: 44, height: 44 });
      };
      // The bar is 1352 wide (a 1376 px screen); Save, Sound and Watch with their words out.
      at(find('hs-top'), 12, 1364);
      at(find('hs-save-btn'), 876, 968);
      at(find('hs-sound-btn'), 976, 1070);
      at(find('hs-watch-btn'), 1078, 1172);
      const chip = find('hs-view-chip');
      const pick = (kind: string): void => {
        const item = root.descendants().find((n) => has(n, 'hs-views-item') && n.dataset['view'] === kind)!;
        (item.listeners.get('click') ?? []).forEach((f) => f({}));
      };
      // Elevator wait: 589 px wide, centered, its close button under Save.
      at(chip, 394, 983);
      pick('wait');
      expect(has(shell, 'has-view') && has(shell, 'is-view-low')).toBe(true);
      // Off again: the chip is gone (no box), and so is the lower row.
      at(chip, 0, 0);
      pick('wait');
      expect([has(shell, 'has-view'), has(shell, 'is-view-low')]).toEqual([false, false]);
      // Vacancy: 298 px, well clear of Save.
      at(chip, 539, 837);
      pick('vacancy');
      expect([has(shell, 'has-view'), has(shell, 'is-view-low')]).toEqual([true, false]);
      ui.destroy();
    });
  });
});
