// The arithmetic behind the chrome: which layout the palette is in, the band the camera frames
// the full-bleed tower in, and how many pixels the floating chrome covers for the ui's own
// floating bits. Pure numbers, measured by ui.ts, no DOM here.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chromeInsets, isSheetLayout, viewInsets } from '../../src/ui/layout';

describe('isSheetLayout', () => {
  it('calls the full width palette a sheet and the rail a rail', () => {
    expect(isSheetLayout(390, 390)).toBe(true);
    expect(isSheetLayout(232, 1280)).toBe(false);
  });

  it('allows a pixel of slack, for a screen that measures in fractions', () => {
    expect(isSheetLayout(389.4, 390)).toBe(true);
    expect(isSheetLayout(388, 390)).toBe(false);
  });

  it('treats a shell nobody has measured as no sheet', () => {
    expect(isSheetLayout(0, 0)).toBe(false);
    expect(isSheetLayout(Number.NaN, 390)).toBe(false);
    expect(isSheetLayout(390, Number.NaN)).toBe(false);
  });
});

describe('viewInsets: the tower is full bleed', () => {
  it('takes only the floating top bar off the top and nothing off the bottom', () => {
    expect(viewInsets({ barBottom: 64 })).toEqual({ top: 64, bottom: 0 });
  });

  it('ignores the palette sheet and a panel: neither pushes the tower', () => {
    const phone = { shellHeight: 844, barBottom: 120, paletteTop: 460, sheet: true };
    expect(viewInsets(phone)).toEqual({ top: 120, bottom: 0 });
    expect(chromeInsets(phone).bottom).toBe(384); // the ui's own bits still keep clear of it
  });

  it('treats an unmeasured bar as covering nothing', () => {
    expect(viewInsets({ barBottom: Number.NaN })).toEqual({ top: 0, bottom: 0 });
    expect(viewInsets({ barBottom: -4 })).toEqual({ top: 0, bottom: 0 });
  });
});

describe('chromeInsets: what the placement chip and the hover card keep clear of', () => {
  it('counts the bar and the palette sheet on a phone', () => {
    expect(chromeInsets({ shellHeight: 844, barBottom: 120, paletteTop: 460, sheet: true })).toEqual({ top: 120, bottom: 384 });
  });

  it('counts nothing at the bottom where the palette is a side rail, now the ticker is gone', () => {
    expect(chromeInsets({ shellHeight: 800, barBottom: 64, paletteTop: 64, sheet: false })).toEqual({ top: 64, bottom: 0 });
  });

  it('never returns a negative inset', () => {
    expect(chromeInsets({ shellHeight: 800, barBottom: 44, paletteTop: 950, sheet: true })).toEqual({ top: 44, bottom: 0 });
  });

  it('treats an unmeasured shell as covering nothing', () => {
    expect(
      chromeInsets({ shellHeight: Number.NaN, barBottom: Number.NaN, paletteTop: Number.NaN, sheet: true }),
    ).toEqual({ top: 0, bottom: 0 });
  });
});

describe('the layout in ui.css', () => {
  const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8');

  it('has no ticker strip and no ticker height token', () => {
    expect(css).not.toContain('.hs-ticker');
    expect(css).not.toContain('--ticker-h');
  });

  it('lays the tower edge to edge under the chrome', () => {
    const view = /\n#view \{([^}]*)\}/.exec(css)?.[1] ?? /#app,\n#view \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(view).toContain('position: absolute;');
    expect(view).toContain('inset: 0;');
  });
});
