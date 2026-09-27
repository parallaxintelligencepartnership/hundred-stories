import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8');

/** The body of a block opened by `head`, up to its closing brace at the same depth. */
function blockOf(head: string): string {
  const at = css.indexOf(head);
  if (at < 0) return '';
  let depth = 0;
  for (let i = at + head.length - 1; i < css.length; i++) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}' && --depth === 0) return css.slice(at, i);
  }
  return '';
}

/** The body of the phone `.hs-toasts` rule: found from `--toast-bleed: 24px;` back to the
    nearest `.hs-toasts {` and forward to the next `}`. */
function phoneToastsRule(): string {
  const bleedAt = css.indexOf('--toast-bleed: 24px;');
  if (bleedAt < 0) return '';
  const ruleStart = css.lastIndexOf('.hs-toasts {', bleedAt);
  if (ruleStart < 0) return '';
  const open = css.indexOf('{', ruleStart);
  return css.slice(ruleStart, css.indexOf('}', open));
}

describe('the phone alert band', () => {
  it('gives the .hs-toasts band bleed room around the cards', () => {
    const mediaAt = css.indexOf('@media (max-width: 720px) {');
    const rule = phoneToastsRule();
    expect(rule).not.toBe('');
    expect(css.indexOf(rule)).toBeGreaterThan(mediaAt);
    expect(rule).toContain('--toast-bleed: 24px;');
    expect(rule).toContain('padding: var(--toast-bleed);');
    expect(rule).toContain('max-height: calc(25vh + 2 * var(--toast-bleed));');
    expect(rule).toContain('left: calc(var(--pad) + var(--safe-left) - var(--toast-bleed));');
    expect(rule).toContain(
      'right: calc(64px + 2 * var(--edge) + var(--safe-right) + var(--touch) + 8px + var(--gap-float) - var(--toast-bleed));',
    );
    expect(rule).toContain(
      'top: calc(var(--top-actual, calc(var(--top-h) * 2 + var(--safe-top))) + var(--gap-float) + var(--chip-h, 0px) - var(--toast-bleed));',
    );
  });

  it('keeps the news toast on its own layer so Safari does not square its corners', () => {
    const news = blockOf('.hs-news-toast {');
    expect(news).toContain('isolation: isolate;');
  });
});
