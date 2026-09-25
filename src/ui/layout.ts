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
  /** Bottom edge of the floating top bar, every row of it, in the same coordinates as the shell. */
  barBottom: number;
  /** Top edge of the palette, which only counts while it is a sheet over the view. */
  paletteTop: number;
  sheet: boolean;
}

/**
 * The band the camera frames the street in: the tower is full bleed, so only the floating top
 * bar is taken off the top, and nothing off the bottom. The palette, a panel or a toast float
 * over the tower and never push it.
 */
export function viewInsets(measure: Pick<ChromeMeasure, 'barBottom'>): { top: number; bottom: number } {
  const top = Number.isFinite(measure.barBottom) ? Math.max(0, measure.barBottom) : 0;
  return { top, bottom: 0 };
}

/**
 * How many pixels of the view the floating chrome covers, top and bottom, for the ui's own
 * floating bits (the placement chip and bar, the hover card) to stay clear of.
 *
 * The top is the top bar. The bottom is the palette while it is the phone sheet; a side rail
 * palette covers the left, which none of them mind.
 */
export function chromeInsets(measure: ChromeMeasure): { top: number; bottom: number } {
  const { top } = viewInsets(measure);
  const shellHeight = Number.isFinite(measure.shellHeight) ? measure.shellHeight : 0;
  const paletteTop = measure.sheet && Number.isFinite(measure.paletteTop) ? measure.paletteTop : Infinity;
  const bottom = Number.isFinite(paletteTop) ? Math.max(0, shellHeight - paletteTop) : 0;
  return { top, bottom };
}

/** How far the placement chip and bar stay from the edges of the view, and from the ghost. */
export const PLACE_GUTTER = 16;
export const PLACE_GAP = 8;

export interface Box {
  width: number;
  height: number;
}

export interface PlacementFrame {
  /** The ghost's box on screen, in css pixels relative to the view. */
  ghost: { x: number; y: number; w: number; h: number };
  chip: Box;
  /** The bar's box, or null when there is no bar to place (a hover ghost has none). */
  bar: Box | null;
  view: Box;
  /** The strips the chrome covers, from watchChrome. */
  chrome: { top: number; bottom: number };
}

/** Keep a box of this width inside the view, a gutter clear of both edges. */
export function clampSpan(left: number, width: number, viewWidth: number): number {
  const room = viewWidth - width - PLACE_GUTTER;
  if (room <= PLACE_GUTTER) return Math.max(0, (viewWidth - width) / 2);
  return Math.max(PLACE_GUTTER, Math.min(left, room));
}

/**
 * Where the placement chip and the placement bar sit against the ghost.
 *
 * The chip goes just above the outline, the bar just below it, both centred on it and both
 * inside the band the chrome leaves free. A ghost low on the screen would put the bar under
 * the palette sheet, so in that case the bar goes above the chip instead.
 */
export function placementBoxes(frame: PlacementFrame): {
  chip: { left: number; top: number };
  bar: { left: number; top: number } | null;
} {
  const ghost = frame.ghost;
  const center = ghost.x + ghost.w / 2;
  const topLimit = Math.max(0, frame.chrome.top) + PLACE_GUTTER;
  const bottomLimit = frame.view.height - Math.max(0, frame.chrome.bottom) - PLACE_GUTTER;

  const chipTop = Math.max(topLimit, ghost.y - frame.chip.height - PLACE_GAP);
  const chip = {
    left: clampSpan(center - frame.chip.width / 2, frame.chip.width, frame.view.width),
    top: chipTop,
  };
  if (!frame.bar) return { chip, bar: null };

  const below = ghost.y + ghost.h + PLACE_GAP;
  const fitsBelow = below + frame.bar.height <= bottomLimit;
  return {
    chip,
    bar: {
      left: clampSpan(center - frame.bar.width / 2, frame.bar.width, frame.view.width),
      top: fitsBelow ? below : Math.max(topLimit, chipTop - frame.bar.height - PLACE_GAP),
    },
  };
}
