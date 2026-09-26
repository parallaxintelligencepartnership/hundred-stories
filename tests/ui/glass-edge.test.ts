// D-10 (design pass P3): the glass controls carry an inset hairline, light on the dark theme and
// dark on the light one, so a pill keeps its edge over a navy sky and a dark tower at night.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8');

/** The body of the first rule whose selector list is exactly `selector`. */
function ruleOf(selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  if (at < 0) return '';
  const open = at + selector.length + 3;
  return css.slice(open, css.indexOf('}', open));
}

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

const EDGE = 'box-shadow: var(--shadow-1), inset 0 0 0 1px var(--glass-edge);';

describe('D-10: the glass edge', () => {
  it('defines the edge light in the dark theme and dark in both light theme blocks', () => {
    expect(ruleOf(':root')).toContain('--glass-edge: rgba(232, 236, 242, 0.10);');
    const system = blockOf("@media (prefers-color-scheme: light) {\n  :root:not([data-theme='dark']) {");
    expect(system).toContain('--glass-edge: rgba(21, 28, 37, 0.10);');
    expect(ruleOf(":root[data-theme='light']")).toContain('--glass-edge: rgba(21, 28, 37, 0.10);');
  });

  it('draws it inside the pill, the speed pill, the round buttons, the speed mode, the pill buttons and the news', () => {
    const glass = ruleOf('.hs-status-pill,\n.hs-speed,\n.hs-round,\n.hs-speed-mode,\n.hs-pill-btn');
    expect(glass).toContain(EDGE);
    expect(glass).not.toMatch(/box-shadow: var\(--shadow-1\);/);
    const news = ruleOf('.hs-news-toast');
    expect(news).toContain(EDGE);
    expect(news).not.toMatch(/box-shadow: var\(--shadow-1\);/);
  });
});
