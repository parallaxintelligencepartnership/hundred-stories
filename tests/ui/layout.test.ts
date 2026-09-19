// The arithmetic behind the chrome the camera has to work around: which layout the palette
// is in, and how many pixels the strips cover. Pure numbers, measured by ui.ts, no DOM here.
import { describe, expect, it } from 'vitest';
import { chromeInsets, isSheetLayout } from '../../src/ui/layout';

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

describe('chromeInsets', () => {
  it('counts the sheet and the ticker on a phone', () => {
    expect(
      chromeInsets({ shellHeight: 844, stripHeight: 88, tickerTop: 816, paletteTop: 460, sheet: true }),
    ).toEqual({ top: 88, bottom: 384 });
  });

  it('counts only the ticker where the palette is a side rail', () => {
    expect(
      chromeInsets({ shellHeight: 800, stripHeight: 44, tickerTop: 772, paletteTop: 44, sheet: false }),
    ).toEqual({ top: 44, bottom: 28 });
  });

  it('never returns a negative inset', () => {
    expect(
      chromeInsets({ shellHeight: 800, stripHeight: 44, tickerTop: 900, paletteTop: 950, sheet: true }),
    ).toEqual({ top: 44, bottom: 0 });
  });

  it('treats an unmeasured strip as covering nothing', () => {
    expect(
      chromeInsets({
        shellHeight: Number.NaN,
        stripHeight: Number.NaN,
        tickerTop: Number.NaN,
        paletteTop: Number.NaN,
        sheet: true,
      }),
    ).toEqual({ top: 0, bottom: 0 });
  });
});
