// Boxes that hold their own contents: the sheet's head band holds its 44 px Close with room on
// every side, and every toast keeps its words, and its close x, inside its rounded card.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8');

/** The body of the first top level rule whose selector list is exactly `selector`. */
function ruleOf(selector: string): string {
  let at = css.indexOf(`\n${selector} {`);
  // Skip a list that only ends in `selector` (the line before it ends in a comma).
  while (at >= 0 && css.slice(0, at).trimEnd().endsWith(',')) at = css.indexOf(`\n${selector} {`, at + 1);
  if (at < 0) return '';
  const open = at + selector.length + 3;
  return css.slice(open, css.indexOf('}', open));
}

/** The block that `head` starts, from its first brace to the closing one at the same depth. */
function blockOf(head: string): string {
  const at = css.indexOf(head);
  if (at < 0) return '';
  let depth = 0;
  for (let i = css.indexOf('{', at); i < css.length; i++) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}' && --depth === 0) return css.slice(at, i);
  }
  return '';
}

/** One declaration's value in a rule body, or '' when it has none. */
function decl(body: string, prop: string): string {
  const m = new RegExp(`(?:^|[;{\\s])${prop}:\\s*([^;]+);`).exec(body);
  return m ? m[1]!.trim() : '';
}

/** A length in px: plain px, or a calc() over px and var(--touch) at the given --ui-scale. */
function px(value: string, scale: number): number {
  const expr = value
    .replace(/var\(--touch\)/g, String(44 * scale))
    .replace(/calc\(/g, '(')
    .replace(/(\d+(?:\.\d+)?)px/g, '$1');
  if (!/^[\d\s.+\-*/()]+$/.test(expr)) throw new Error(`not a length: ${value}`);
  return Function(`return (${expr});`)() as number;
}

/** Top, right, bottom and left of a padding shorthand. */
function box(value: string, scale: number): [number, number, number, number] {
  const parts = value.split(/\s+/).map((v) => px(v, scale));
  const [t, r = t, b = t, l = r] = parts as [number, number?, number?, number?];
  return [t, r!, b!, l!];
}

/** The colour edge bar the text toasts once drew in a ::before; gone since the icons. */
function edgeBar(): string {
  return blockOf('.hs-toast::before,\n.hs-alert-toast::before {');
}

describe('the sheet head holds its Close button', () => {
  const head = ruleOf('.hs-panel-head');
  const close = ruleOf('.hs-panel-close');

  it('never gives up height to the sheet body: the band is not a shrinking flex item', () => {
    // .hs-sheet is a column flex box with a fixed (phone) or capped (desktop) height; a long
    // body used to squeeze the head to its 44 px min-height, under its own padded Close.
    expect(blockOf('.hs-sheet {')).toContain('flex-direction: column;');
    expect(decl(head, 'flex')).toBe('none');
  });

  for (const scale of [1, 1.25]) {
    it(`fits Close with room on every side at --ui-scale ${scale}`, () => {
      const [top, right, bottom] = box(decl(head, 'padding'), scale);
      const border = px(decl(head, 'border-bottom').split(/\s+/)[0]!, scale);
      const band = px(decl(head, 'min-height'), scale);
      const button = px(decl(close, 'min-height'), scale);
      expect(button).toBe(44 * scale); // the touch target stays
      expect(Math.min(top, right, bottom)).toBeGreaterThanOrEqual(8);
      // Even at its floor the band is the button, its padding and its hairline.
      expect(band).toBeGreaterThanOrEqual(button + top + bottom + border);
    });
  }
});

describe('toasts keep their contents inside the card', () => {
  it('wraps a long word in every toast variant instead of running past the edge', () => {
    for (const sel of ['.hs-toast', '.hs-alert-toast', '.hs-news-toast']) {
      expect(decl(ruleOf(sel), 'overflow-wrap'), sel).toBe('anywhere');
    }
    expect(decl(ruleOf('.hs-toast-words'), 'min-width')).toBe('0');
    expect(decl(ruleOf('.hs-toast-body'), 'min-width')).toBe('0');
  });

  it('keeps the alert card close x inside the rounded corner, clear of the words, desktop and phone', () => {
    const x = ruleOf('.hs-toast-close');
    const offset = Math.min(px(decl(x, 'top'), 1), px(decl(x, 'right'), 1));
    const radius = 16; // --radius-16 on .hs-toast
    // The x's corner is inside the rounded edge, not in the cut-away corner.
    expect(decl(ruleOf('.hs-toast'), 'border-radius')).toBe('var(--radius-16)');
    expect(offset).toBeGreaterThanOrEqual(Math.ceil(radius * (1 - Math.SQRT1_2)));
    const reach = px(decl(x, 'right'), 1) + px(decl(x, 'width'), 1);
    const reserve = px(decl(ruleOf('.hs-toast-body'), 'padding-right'), 1);
    const desktopPad = box(decl(ruleOf('.hs-toast'), 'padding'), 1)[1];
    const phone = blockOf('@media (max-width: 720px) {\n  /* A phone');
    const phonePad = box(decl(phone.slice(phone.indexOf('.hs-toast {')), 'padding'), 1)[1];
    for (const pad of [desktopPad, phonePad]) expect(pad + reserve).toBeGreaterThanOrEqual(reach + 4);
  });

  it('draws no colour edge: no bar and no inset shadow; the icon carries the colour', () => {
    // The stripe read as a web notification; the pause menu's look (an amber icon at the left of
    // the words) is the game's own, so the cards carry their colour in the icon instead.
    for (const sel of ['.hs-toast', '.hs-alert-toast']) {
      expect(decl(ruleOf(sel), 'box-shadow'), sel).not.toMatch(/inset/);
      expect(decl(ruleOf(sel), 'position'), sel).toBe('relative');
    }
    expect(edgeBar()).toBe('');
    expect(css).not.toContain('--toast-edge');
  });

  it('keeps the icon clear of the rounded corner, desktop and phone', () => {
    const phone = blockOf('@media (max-width: 720px) {\n  /* A phone');
    const phoneToast = phone.slice(phone.indexOf('.hs-toast {'));
    const pads: [string, string][] = [
      ['.hs-toast', decl(ruleOf('.hs-toast'), 'padding')],
      ['.hs-alert-toast', decl(ruleOf('.hs-alert-toast'), 'padding')],
      ['phone .hs-toast', decl(phoneToast.slice(0, phoneToast.indexOf('}')), 'padding')],
    ];
    // At the icon's top (the card's top padding), the 16 px corner's curve is already left of it.
    const radius = 16;
    for (const [name, pad] of pads) {
      const [top, , , left] = box(pad, 1);
      const curve = radius - Math.sqrt(radius ** 2 - (radius - top) ** 2);
      expect(left - curve, name).toBeGreaterThanOrEqual(4);
    }
  });

  it('gives the alert toast its x or action a column of its own', () => {
    expect(decl(ruleOf('.hs-alert-toast'), 'display')).toBe('flex');
    expect(decl(ruleOf('.hs-toast-action'), 'flex')).toBe('none');
    expect(decl(ruleOf('.hs-icon'), 'flex')).toBe('0 0 auto');
  });
});

// Review A10 (2026-09-30): with Larger text on a 390 px phone, "Today's tower" wrapped to two
// lines between Back and its twin pad on the plate. A page's title steps down there instead.
describe("a page's plate title with Larger text on a phone", () => {
  const scale = 1.25; // :root.hs-large-text
  const width = 390;
  /** A generous average advance for the UI face at 600 weight, in em: estimates run wide, not tight. */
  const EM_PER_CHAR = 0.6;
  const TITLES = ['Settings', 'Controls', 'Stories', 'Share', "Today's tower"];
  const phoneLarge = blockOf('@media (max-width: 480px) {\n  :root.hs-large-text .hs-pause-card.is-page .hs-plate-title {');
  const sizeOf = (value: string): number => {
    const m = /^var\(--size-(\d+)\)$/.exec(value);
    if (!m) throw new Error(`not a size token: ${value}`);
    return Number(m[1]) * scale;
  };

  /** Room for the title: the card at this width, less its padding and the plate's two pads (Back's and its twin). */
  function room(at: number): { room: number; back: number; pad: number } {
    const edge = px(decl(ruleOf(':root'), '--edge'), scale);
    const card = Math.min(440, at - 2 * edge);
    const [, right, , left] = box(decl(ruleOf('.hs-pause-card'), 'padding'), 1);
    const plate = ruleOf('.hs-pause-card.is-page .hs-pause-plate');
    const padL = px(decl(plate, 'padding-left'), scale);
    const padR = px(decl(plate, 'padding-right'), scale);
    return { room: card - left - right - padL - padR, back: px(decl(ruleOf('.hs-pause-back'), 'width'), scale), pad: padL };
  }

  it('fits every page title on one line at 390 px, Back clear of it, never cut short', () => {
    expect(phoneLarge).not.toBe('');
    const size = sizeOf(decl(phoneLarge.slice(phoneLarge.indexOf('.hs-plate-title {')), 'font-size'));
    const { room: space, back, pad } = room(width);
    const longest = Math.max(...TITLES.map((t) => t.length)) * EM_PER_CHAR;
    expect(longest * size).toBeLessThanOrEqual(space);
    // Back sits in the plate's pad, 8 px short of where the title may start.
    expect(pad - back).toBeGreaterThanOrEqual(8);
    // Without the step the 35 px title would not fit: this is the rule that keeps it on one line.
    expect(longest * sizeOf(decl(ruleOf('.hs-plate-title'), 'font-size'))).toBeGreaterThan(space);
    // One line by size alone: nothing truncates or forbids the wrap.
    for (const body of [ruleOf('.hs-plate-title'), phoneLarge]) {
      expect(body).not.toMatch(/text-overflow|ellipsis|white-space:\s*nowrap/);
    }
  });

  it('steps down wherever the full size would wrap: the breakpoint is past the width where 35 px fits', () => {
    const full = sizeOf(decl(ruleOf('.hs-plate-title'), 'font-size'));
    const longest = Math.max(...TITLES.map((t) => t.length)) * EM_PER_CHAR;
    let fitsFrom = 320;
    while (longest * full > room(fitsFrom).room) fitsFrom += 1;
    expect(480).toBeGreaterThanOrEqual(fitsFrom);
  });
});
