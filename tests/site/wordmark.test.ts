// The dark-mode wordmark used to double up on a phone: `.wordmark-light { display: none }` (0,1,0)
// lost to the light-mode override rules (0,3,0) as intended, but it also lost to
// `.site-wordmark img { display: block }` (0,1,1) in dark mode, so both logos showed and wrapped
// onto two lines. Scoping the default-hide rule under .site-wordmark (0,2,0) fixes it without
// touching the light-mode overrides, which already win.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/site/site.css', import.meta.url), 'utf8');

describe('the wordmark default-hide rule', () => {
  it('is scoped under .site-wordmark, so it cannot outrank the theme img rule', () => {
    expect(css).toContain('.site-wordmark .wordmark-light {');
    // A bare rule at the start of a line, unscoped, is the bug: it loses to
    // `.site-wordmark img { display: block }` in dark mode.
    expect(css).not.toMatch(/^\.wordmark-light\s*\{/m);
  });

  it('leaves the light-mode override rules untouched, since they already win', () => {
    expect(css).toContain(":root:not([data-theme='dark']) .wordmark-light {");
    expect(css).toContain(":root[data-theme='light'] .wordmark-light {");
  });
});
