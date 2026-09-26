// Solid amber is for the primary action; a pressed toggle wears an amber ring (design pass D-3).
// The speed that is on and the dock's open category are always pressed, so as solid blocks they
// were always the two brightest shapes on screen. Pause, when the game is stopped, stays solid.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8');

/** Every declaration for an exact selector anywhere in the sheet, later rules winning. */
function rule(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    const selectors = (m[1] ?? '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(',')
      .map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    for (const decl of (m[2] ?? '').split(';')) {
      const [k, ...v] = decl.split(':');
      if (k && v.length) out[k.trim()] = v.join(':').trim();
    }
  }
  return out;
}

const RING = {
  background: 'rgba(244, 185, 66, 0.18)',
  // Words and a line in amber: the text amber, so the light theme passes (D-25).
  color: 'var(--amber-text)',
  'box-shadow': 'inset 0 0 0 2px var(--amber-text)',
};

describe('pressed toggles wear a ring (D-3)', () => {
  it('rings the speed that is on and the open dock category, the phone pills included', () => {
    expect(rule(".hs-speed-btn[aria-pressed='true']")).toEqual(RING);
    // The phone's category pills are the same .hs-build-tab, so the one rule covers them.
    expect(rule(".hs-build-tab[aria-selected='true']")).toEqual(RING);
  });

  it('keeps Pause solid, so a stopped game still shows it', () => {
    expect(rule(".hs-speed-btn[aria-pressed='true'][aria-label='Pause']")).toEqual({
      background: 'var(--amber)',
      color: 'var(--on-amber)',
      'box-shadow': 'none',
    });
  });

  it('keeps solid amber on the primary actions', () => {
    expect(rule(".hs-tool[aria-pressed='true']").background).toBe('var(--amber)');
  });
});
