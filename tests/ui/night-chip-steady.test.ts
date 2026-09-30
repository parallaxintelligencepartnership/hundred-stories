// The night speed chip ("Night: 8 times as fast") qualifies the speed pill. It used to sit in the
// top bar's controls, in their flow, so at nightfall the controls grew, the bar could wrap to a
// second row, Views moved, and Watch and Sound (placed from Views) jumped. 747b9ec kept a fixed
// 16em box for it by day instead, which wrapped the bar by day on common laptop widths (P1 review
// I-1, I-2). Now the chip is out of the bar's flow at every width, so the bar keeps its one-row
// layout by day and nothing moves at nightfall:
// - a phone hangs it over the speed pill in the bottom left corner, as it always did;
// - where the bar has wrapped to two rows (below 1040 px, 1300 px with Larger text) it sits in
//   the controls' row, one gap left of the speed pill, in the room that row leaves on its left;
// - wider, it hangs under the bar on the start side, one gap right of the Build dock, in the row
//   of Save, Sound and Watch, and a step lower while a view's chip is up.
// The fake DOM lays nothing out, so the rules are read from ui.css and the geometry is worked
// from them and from text widths measured from the bundled fonts (the P1 review's figures, at
// 1x; Larger text scales the words by 1.25 and keeps the fixed paddings).
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUi } from '../../src/ui/ui';
import { FakeDom, type FakeElement } from './fake-dom';

const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const phoneAt = css.indexOf('@media (max-width: 720px) {');

/** Every rule whose selector list names `selector` exactly, with its declarations. */
function rulesFor(block: string, selector: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(block); m; m = re.exec(block)) {
    const selectors = (m[1] ?? '').split(',').map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    const decls: Record<string, string> = {};
    for (const decl of (m[2] ?? '').split(';')) {
      const [k, ...v] = decl.split(':');
      if (k?.trim() && v.length) decls[k.trim()] = v.join(':').trim();
    }
    out.push(decls);
  }
  return out;
}

/** The body of the block opened by `head` (the first at or after `from`), braces balanced. */
function block(head: string, from = 0): string {
  const start = css.indexOf(head, from);
  if (start < 0) throw new Error(`no ${head}`);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, i);
  }
  throw new Error(`unclosed ${head}`);
}

/** The wide screen's css: all of it but the phone block. */
const wide = css.slice(0, phoneAt);
const inRow = block('@media (min-width: 721px) {', wide.indexOf('.hs-speed-mode.is-hidden'));
const hang1x = block('@media (min-width: 1040px) {');
const hangLarge = block('@media (min-width: 1300px) {');

// Geometry at 1x, in css px from the P1 review (text measured from the bundled woff2 files).
const GAP = 8;
const EDGE = 12;
const PALETTE = 288;
const ROUND_PAD = 12 + 18 + 6 + 14; // .hs-round padding, the 18 px icon and the 6 px gap
const TEXT = { views: 40.5, share: 39.8, menu: 38.2, watch: 44, sound: 44, saved: 42 };
const SPEED_PILL = 190;
const PILL_MIN = 697; // the status pill on a fresh tower, its narrowest
const CHIP_PAUSED_TEXT = 197; // "Paused. Nights run 8 times as fast", the chip's longest words
const CHIP_PAD = 24;

/** Everything, at a scale: 1 or Larger text's 1.25 (words scale; paddings and gaps do not). */
function geometry(scale: number, shownWords: boolean) {
  const iconOnly = 44 * scale + 8; // .hs-round's min-width, --touch + 8
  const round = (text: number): number => Math.max(iconOnly, ROUND_PAD + text * scale);
  const views = round(TEXT.views);
  const share = round(TEXT.share);
  const menu = round(TEXT.menu);
  // From the bar's right edge: Watch centered under Views, Sound and Save one gap left each.
  const watchCenter = menu + GAP + share + GAP + views / 2;
  const watch = shownWords ? round(TEXT.watch) : iconOnly;
  const sound = shownWords ? round(TEXT.sound) : iconOnly;
  const save = shownWords ? round(TEXT.saved) : iconOnly;
  const saveReach = watchCenter + watch / 2 + GAP + sound + GAP + save;
  const speed = 4 * 44 * scale + 3 * 2 + 8;
  const actionsMine = speed + GAP + views + GAP + share + GAP + menu;
  return {
    saveReach,
    shareFromRight: menu + GAP + share,
    actionsMine,
    palette: PALETTE * scale,
    chipW: CHIP_PAUSED_TEXT * scale + CHIP_PAD,
    pillMin: PILL_MIN * scale,
    rowH: (44 * scale + 8),
  };
}

describe('the night speed chip keeps the top bar still', () => {
  it('hidden by day it leaves no box at all, and it never takes one in the bar: no reserved width', () => {
    const hidden = rulesFor(css, '.hs-speed-mode.is-hidden');
    expect(hidden.map((d) => d.display)).toEqual(['none']);
    // 747b9ec's reserved box is gone: nothing sizes it to a fixed width or hides it by visibility.
    for (const decls of rulesFor(css, '.hs-speed-mode')) {
      expect(decls.width === undefined || decls.width === 'max-content').toBe(true);
      expect(decls.flex).toBeUndefined();
      expect(decls.visibility).toBeUndefined();
    }
  });

  it('is out of the bar\'s flow at every width: in the controls\' row where the bar wraps, under the bar wider', () => {
    const [row] = rulesFor(inRow, '.hs-speed-mode');
    expect(row).toMatchObject({
      position: 'absolute',
      top: '50%',
      right: 'calc(100% + var(--gap-float))',
      translate: '0 -50%',
      'white-space': 'normal',
    });
    // Its words wrap inside the room the controls' row leaves on its left, never past the bar.
    expect(row!['max-width']).toBe('calc(100vw - 2 * var(--edge) - var(--safe-left) - var(--safe-right) - 100% - var(--gap-float))');
    for (const [hang, root] of [[hang1x, ':root:not(.hs-large-text)'], [hangLarge, ':root.hs-large-text']] as const) {
      const [chip] = rulesFor(hang, `${root} .hs-speed-mode`);
      expect(chip).toMatchObject({
        top: 'calc(100% + var(--gap-float) + var(--chip-h, 0px))',
        left: 'calc(var(--palette-w) + var(--gap-float))',
        right: 'auto',
        translate: 'none',
        'white-space': 'nowrap',
      });
      // Its box is the bar's, not the controls'.
      expect(rulesFor(hang, `${root} .hs-top-actions`)).toEqual([{ position: 'static' }]);
    }
    // The controls are the box of the in-row placement.
    expect(rulesFor(wide, '.hs-top-actions')[0]!.position).toBe('relative');
  });

  it('on a phone it hangs over the speed pill exactly as before 747b9ec', () => {
    expect(rulesFor(css.slice(phoneAt), '.hs-speed-mode')).toContainEqual({
      position: 'absolute', top: 'auto', bottom: 'calc(100% + 4px)', left: '0', right: 'auto',
    });
  });

  it('where it sits in the controls\' row the bar has always wrapped, so that row is free on its left', () => {
    for (const [scale, below] of [[1, 1040], [1.25, 1300]] as const) {
      const g = geometry(scale, true);
      const W = below - 1 - 2 * EDGE;
      // The narrowest pill beside the narrowest controls does not fit one row: row two is the
      // controls alone, right aligned, and the chip takes the room on their left.
      expect(g.pillMin + GAP + g.actionsMine).toBeGreaterThan(W);
    }
  });

  it('where it hangs under the bar it clears the dock, Save, Sound, Watch, the goals pill and the view chip', () => {
    for (const [scale, from] of [[1, 1040], [1.25, 1300]] as const) {
      const g = geometry(scale, true);
      for (let vw = from; vw <= 2560; vw += 1) {
        const W = vw - 2 * EDGE;
        const chipLeft = g.palette + GAP;
        const chipRight = chipLeft + g.chipW;
        // The open dock ends at the palette's width: one gap before the chip.
        expect(chipLeft - g.palette).toBe(GAP);
        // Save, the leftmost of the three, with its words out and reading "Saved".
        expect(W - g.saveReach - chipRight).toBeGreaterThanOrEqual(GAP);
        // The goals pill hangs under Share and Menu, right of Watch.
        expect(W - g.shareFromRight).toBeGreaterThan(chipRight);
      }
      // With a view on, the chip steps down by --chip-h: its top is the view chip's bottom plus a
      // gap, and under the round buttons' row.
      const chipH = 44 * scale + GAP;
      const viewChipBottom = GAP + 44 * scale;
      expect(GAP + chipH).toBeGreaterThanOrEqual(viewChipBottom + GAP);
      expect(GAP + chipH).toBeGreaterThanOrEqual(GAP + g.rowH);
    }
    // The step is the view chip's own height and gap, and more when that chip drops a row.
    expect(rulesFor(wide, '.hs-ui.has-view')[0]!['--chip-h']).toBe('calc(var(--touch) + var(--gap-float))');
    expect(rulesFor(wide, '.hs-ui.has-view.is-view-low')[0]!['--chip-h']).toBe('calc(2 * var(--touch) + 8px + 2 * var(--gap-float))');
  });

  describe('in the ui', () => {
    let dom: FakeDom;
    let uninstall: () => void;
    beforeEach(() => {
      dom = new FakeDom();
      uninstall = dom.install();
    });
    afterEach(() => uninstall());

    it('day, night, paused at night and day again: the same nodes in the same places, and the same measures under the bar', () => {
      const world = {
        cash: 2_000_000, population: 0, stars: 1, time: { minute: 12 * 60 }, log: [], logTotal: 0,
        rooms: new Map(), shafts: new Map(), sims: new Map(), events: [],
      };
      let speed = 1;
      const api = {
        world, subscribe: () => () => {}, getHover: () => null, getSpeed: () => speed, getTool: () => ({ kind: 'none' }),
        setTool: () => {}, getPlacement: () => null, getPlacementRect: () => null, getSelection: () => null,
        setChrome: () => {}, setReducedMotion: () => {},
      } as never;
      const root = dom.createElement('div');
      const ui = createUi(root as never, api, {} as never);
      const has = (n: FakeElement, c: string): boolean => n.className.split(' ').includes(c);
      const top = root.descendants().find((n) => has(n, 'hs-top'))!;
      const actions = top.children.find((n) => has(n, 'hs-top-actions'))!;
      const chip = actions.children.find((n) => has(n, 'hs-speed-mode'))!;
      const snapshot = (): unknown => ({
        top: [...top.children],
        actions: [...actions.children],
        placed: top.children.map((n) => [n.className, n.style['--watch-x'], n.style['--sound-x'], n.style['--save-x']]),
      });
      const before = snapshot();
      const seen: [string, boolean][] = [];
      for (const [minute, s] of [[23 * 60 + 30, 1], [23 * 60 + 40, 0], [12 * 60 + 2 * 1440, 1]] as const) {
        world.time.minute = minute;
        speed = s;
        ui.update();
        seen.push([chip.textContent, chip.classList.contains('is-hidden')]);
        expect(snapshot()).toEqual(before);
      }
      // Its words are as they were: shown at night, the paused line when paused, gone by day.
      expect(seen).toEqual([
        ['Night: 8 times as fast', false],
        ['Paused. Nights run 8 times as fast', false],
        ['', true],
      ]);
      ui.destroy();
    });
  });
});
