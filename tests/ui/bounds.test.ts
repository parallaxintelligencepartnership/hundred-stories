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

  it('gives the alert toast its x or action a column of its own', () => {
    expect(decl(ruleOf('.hs-alert-toast'), 'display')).toBe('flex');
    expect(decl(ruleOf('.hs-toast-action'), 'flex')).toBe('none');
    expect(decl(ruleOf('.hs-icon'), 'flex')).toBe('0 0 auto');
  });
});
