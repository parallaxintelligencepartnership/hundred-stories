// Chrome geometry: the arithmetic ui.ts does with the rectangles it measures.
// Pure numbers in, pure numbers out, so the rules can be read and tested without a browser.

/**
 * Is the palette laid out as a bottom sheet rather than a side rail?
 *
 * Measured rather than asked of a media query: the sheet is simply the layout where the
 * palette spans the whole shell. A pixel of slack covers a screen that measures in fractions.
 */
export function isSheetLayout(paletteWidth: number, shellWidth: number): boolean {
  if (!Number.isFinite(paletteWidth) || !Number.isFinite(shellWidth)) return false;
  if (shellWidth <= 0) return false;
  return paletteWidth >= shellWidth - 1;
}

export interface ChromeMeasure {
  /** Height of the whole ui shell, which covers the tower view. */
  shellHeight: number;
  /** Height the top strip really takes, wrapped rows and all. */
  stripHeight: number;
  /** Top edge of the ticker, in the same coordinates as the shell. */
  tickerTop: number;
  /** Top edge of the palette, which only counts while it is a sheet over the view. */
  paletteTop: number;
  sheet: boolean;
}

/**
 * How many pixels of the view the chrome covers, top and bottom.
 *
 * The top is the strip. The bottom starts at whichever comes first, the ticker or the
 * palette sheet; a side rail palette covers the left, which the camera does not mind.
 */
export function chromeInsets(measure: ChromeMeasure): { top: number; bottom: number } {
  const top = Number.isFinite(measure.stripHeight) ? Math.max(0, measure.stripHeight) : 0;
  const shellHeight = Number.isFinite(measure.shellHeight) ? measure.shellHeight : 0;
  const tickerTop = Number.isFinite(measure.tickerTop) ? measure.tickerTop : Infinity;
  const paletteTop =
    measure.sheet && Number.isFinite(measure.paletteTop) ? measure.paletteTop : Infinity;
  const highest = Math.min(tickerTop, paletteTop);
  const bottom = Number.isFinite(highest) ? Math.max(0, shellHeight - highest) : 0;
  return { top, bottom };
}
