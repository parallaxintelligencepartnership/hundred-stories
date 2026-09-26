// The site's world colours (src/site/site.css --w-*) are copies of the game's palette, and its
// steel chrome tokens are copies of src/ui/ui.css. Design pass D-46: hold every copy to its source,
// so the site and the game cannot drift apart unnoticed.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAR_BODY_TOP, css } from '../../src/render/illustrated';
import { PALETTE } from '../../src/render/palette';
import { CONCRETE_COLOR, CONCRETE_LINE } from '../../src/render/sky';

const ROOT = join(__dirname, '..', '..');
const SITE = readFileSync(join(ROOT, 'src', 'site', 'site.css'), 'utf8');
const UI = readFileSync(join(ROOT, 'src', 'ui', 'ui.css'), 'utf8');

/** Each --w-* token and the game colour it copies. */
const SOURCES: Record<string, number> = {
  outline: PALETTE.outline,
  slab: PALETTE.slab,
  'slab-edge': PALETTE.slabEdge,
  window: PALETTE.windowDay,
  shaft: PALETTE.shaftCavity,
  rail: PALETTE.shaftRail,
  lobby: PALETTE.wall.lobby,
  condo: PALETTE.wall.condo,
  security: PALETTE.wall.security,
  concrete: CONCRETE_COLOR,
  'concrete-line': CONCRETE_LINE,
  car: CAR_BODY_TOP,
};
/** Page text on the world colours; the game draws no text, so these have no source. */
const PAGE_ONLY = ['text', 'text-dim'];

/** The chrome tokens the site takes from ui.css, in the dark default and the light remap. */
const STEEL = ['steel', 'steel-2', 'line', 'ink', 'ink-dim', 'amber', 'on-amber', 'amber-text', 'indicator', 'alert'];

function tokens(block: string, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of block.matchAll(new RegExp(`--${prefix}([a-z0-9-]+):\\s*(#[0-9a-fA-F]{3,8})\\s*;`, 'g'))) {
    out.set(m[1]!, m[2]!.toLowerCase());
  }
  return out;
}

/** The body of the first rule whose selector text matches, braces balanced. */
function rule(sheet: string, selector: RegExp): string {
  const m = selector.exec(sheet);
  if (!m) throw new Error(`no rule ${selector}`);
  const open = sheet.indexOf('{', m.index + m[0].length - 1);
  let depth = 0;
  for (let i = open; i < sheet.length; i++) {
    if (sheet[i] === '{') depth++;
    else if (sheet[i] === '}' && --depth === 0) return sheet.slice(open + 1, i);
  }
  throw new Error(`unclosed rule ${selector}`);
}

const THEMES: [string, RegExp][] = [
  ['dark (:root)', /(^|\n):root\s*\{/],
  ['system light', /@media \(prefers-color-scheme: light\)\s*\{\s*:root:not\(\[data-theme='dark'\]\)\s*\{/],
  ['explicit light', /(^|\n):root\[data-theme='light'\]\s*\{/],
];

describe('the site holds to the game palette', () => {
  const world = tokens(rule(SITE, THEMES[0]![1]), 'w-');

  it('has a source for every world token and no source without a token', () => {
    expect([...world.keys()].sort()).toEqual([...Object.keys(SOURCES), ...PAGE_ONLY].sort());
  });

  for (const [name, source] of Object.entries(SOURCES)) {
    it(`--w-${name} is the game colour it copies`, () => {
      expect(world.get(name)).toBe(css(source));
    });
  }

  it('paints the car in the shipped body colour, not the retired one', () => {
    expect(world.get('car')).toBe('#f7d34d');
  });
});

describe('the site steel tokens match ui.css in both themes', () => {
  for (const [theme, selector] of THEMES) {
    it(theme, () => {
      const site = tokens(rule(SITE, selector));
      const ui = tokens(rule(UI, selector));
      for (const name of STEEL) {
        expect(site.get(name), `site --${name}`).toBeDefined();
        expect(site.get(name), `--${name}`).toBe(ui.get(name));
      }
    });
  }
});
