// Where a card about a thing on the tower stands (owner ruling 2026-10-01, DECISIONS): at 900 px
// and wider a room, person or elevator card opens beside what it is about, on the side away from
// the Build dock, never in Menu's corner. Pure numbers in, pure numbers out, so the rule can be
// read and tested without a browser; ui.ts measures the rectangles and writes the result.

import type { Box } from './layout';

/** The space between the selection's ring and the card beside it. */
export const CARD_ANCHOR_GAP = 12;

/** A rectangle on screen, in the shell's css px. */
export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The area a card may stand in: inside the safe area and the edges, right of the Build dock (or
 * left of it, were it on the right), below the top bar and its row of round buttons, above the
 * bottom edge. ui.ts measures it.
 */
export interface CardBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CardAnchorFrame {
  /** The selection's ring on screen, or null when none is drawn. */
  selection: ScreenRect | null;
  /** The card's size as drawn (its height already capped by cardMaxHeight). */
  card: Box;
  bounds: CardBounds;
  /** The whole view, to tell a selection that has left the screen. */
  view: Box;
  /** Which side the Build dock is on: the card prefers the other side of the selection. */
  dock: 'left' | 'right';
  /** Where the card stood last, kept while the selection is off screen. */
  previous: { left: number; top: number } | null;
}

export type CardSide = 'right' | 'left' | 'below' | 'above' | 'over' | 'kept';

export interface CardPlace {
  left: number;
  top: number;
  side: CardSide;
}

/** The tallest the card may be: the bounds' height. A taller body scrolls inside the card. */
export function cardMaxHeight(bounds: CardBounds): number {
  return Math.max(0, Math.floor(bounds.bottom - bounds.top));
}

function onScreen(rect: ScreenRect, view: Box): boolean {
  return rect.w > 0 && rect.h > 0 && rect.x + rect.w > 0 && rect.x < view.width && rect.y + rect.h > 0 && rect.y < view.height;
}

/**
 * Where the card goes.
 *
 * Beside the selection with CARD_ANCHOR_GAP clear, on the side away from the dock (the right,
 * with the dock on the left), its top level with the selection's top; on the other side when
 * that one would run past the bounds; under or over it when neither side has room; and only when
 * nothing fits without covering it, on the side with more room, clamped. The card is always
 * clamped inside the bounds, so it never stands in Menu's corner or under the round buttons.
 * A selection off screen (or not drawn) keeps the card where it was, inside the bounds; with no
 * earlier place the answer is null and the card keeps its fixed spot.
 */
export function anchorCard(frame: CardAnchorFrame): CardPlace | null {
  const { bounds, selection: sel } = frame;
  const w = frame.card.width;
  const h = Math.min(frame.card.height, cardMaxHeight(bounds));
  const clampX = (x: number): number => Math.max(bounds.left, Math.min(x, bounds.right - w));
  const clampY = (y: number): number => Math.max(bounds.top, Math.min(y, bounds.bottom - h));
  const place = (left: number, top: number, side: CardSide): CardPlace => ({ left: Math.round(left), top: Math.round(top), side });

  if (!sel || !onScreen(sel, frame.view)) {
    if (!frame.previous) return null;
    const left = clampX(frame.previous.left);
    return place(left, clampY(frame.previous.top), 'kept');
  }

  const right = (): CardPlace | null => {
    const x = Math.max(sel.x + sel.w + CARD_ANCHOR_GAP, bounds.left);
    return x + w <= bounds.right ? place(x, clampY(sel.y), 'right') : null;
  };
  const left = (): CardPlace | null => {
    const x = Math.min(sel.x - CARD_ANCHOR_GAP - w, bounds.right - w);
    return x >= bounds.left ? place(x, clampY(sel.y), 'left') : null;
  };
  const sides = frame.dock === 'right' ? [left, right] : [right, left];
  for (const side of sides) {
    const at = side();
    if (at) return at;
  }

  // Neither side has room (a wide room close up): under it, else over it, centered on it.
  const x = clampX(sel.x + sel.w / 2 - w / 2);
  const below = sel.y + sel.h + CARD_ANCHOR_GAP;
  if (below >= bounds.top && below + h <= bounds.bottom) return place(x, below, 'below');
  const above = sel.y - CARD_ANCHOR_GAP - h;
  if (above >= bounds.top && above + h <= bounds.bottom) return place(x, above, 'above');

  // Nothing fits without covering it: the side with more room, as far from it as the bounds allow.
  const roomRight = bounds.right - (sel.x + sel.w);
  const roomLeft = sel.x - bounds.left;
  const towardRight = frame.dock === 'right' ? roomRight > roomLeft : roomRight >= roomLeft;
  const over = towardRight ? clampX(bounds.right - w) : clampX(bounds.left);
  return place(over, clampY(sel.y), 'over');
}
