// Where a card about a thing on the tower stands at 900 px and wider (owner ruling 2026-10-01):
// beside the selection, away from the Build dock, always on screen, never in Menu's corner.
// Numbers are the measured 1440 by 900 desktop: the folded dock rail ends at 68, Menu is
// 1340,12 88x52, the round-button row ends at 124, so the card may stand from 132 down to 888.
import { describe, expect, it } from 'vitest';
import { CARD_ANCHOR_GAP, anchorCard, cardMaxHeight, type CardAnchorFrame, type CardBounds } from '../../src/ui/card-anchor';

const VIEW = { width: 1440, height: 900 };
const BOUNDS: CardBounds = { left: 76, top: 132, right: 1428, bottom: 888 };
const CARD = { width: 360, height: 500 };
const MENU = { x: 1340, y: 12, w: 88, h: 52 };

function frame(over: Partial<CardAnchorFrame>): CardAnchorFrame {
  return { selection: null, card: CARD, bounds: BOUNDS, view: VIEW, dock: 'left', previous: null, ...over };
}

describe('anchorCard', () => {
  it('stands right of the selection with a small gap, its top level with the selection', () => {
    expect(CARD_ANCHOR_GAP).toBe(12);
    const sel = { x: 300, y: 200, w: 120, h: 36 };
    expect(anchorCard(frame({ selection: sel }))).toEqual({ left: 300 + 120 + 12, top: 200, side: 'right' });
  });

  it('flips to the left when the right would run off screen, and never covers the selection', () => {
    const sel = { x: 1100, y: 300, w: 120, h: 36 };
    const at = anchorCard(frame({ selection: sel }))!;
    expect(at).toEqual({ left: 1100 - 12 - 360, top: 300, side: 'left' });
    expect(at.left + CARD.width).toBeLessThanOrEqual(sel.x);
  });

  it('a selection near the right edge: on its left, clear of it, and nowhere near Menu', () => {
    const sel = { x: 1380, y: 140, w: 40, h: 36 };
    const at = anchorCard(frame({ selection: sel }))!;
    expect(at.side).toBe('left');
    expect(at.left + CARD.width).toBe(1380 - 12);
    expect(at.top).toBeGreaterThanOrEqual(MENU.y + MENU.h + 60); // the round-button row stays between
  });

  it('clamps at the top: a selection under the top bar puts the card below the round-button row', () => {
    expect(anchorCard(frame({ selection: { x: 300, y: 20, w: 120, h: 36 } }))!.top).toBe(132);
  });

  it('clamps at the bottom: a low selection lifts the card so all of it stays on screen', () => {
    const at = anchorCard(frame({ selection: { x: 300, y: 820, w: 120, h: 36 } }))!;
    expect(at.top).toBe(888 - 500);
    expect(at.side).toBe('right');
  });

  it('clamps at the left: a selection under the dock still puts the card clear of the dock', () => {
    const at = anchorCard(frame({ selection: { x: 20, y: 300, w: 30, h: 36 } }))!;
    expect(at).toEqual({ left: BOUNDS.left, top: 300, side: 'right' });
  });

  it('with the dock open (wider bounds on the left) it still never stands over the dock', () => {
    const open = { ...BOUNDS, left: 308 };
    const at = anchorCard(frame({ bounds: open, selection: { x: 100, y: 300, w: 120, h: 36 } }))!;
    expect(at.left).toBe(308);
    expect(at.side).toBe('right');
  });

  it('clamps at the right: never past the right bound', () => {
    for (let x = 0; x < 1440; x += 37) {
      const at = anchorCard(frame({ selection: { x, y: 300, w: 60, h: 36 } }))!;
      expect(at.left + CARD.width).toBeLessThanOrEqual(BOUNDS.right);
      expect(at.left).toBeGreaterThanOrEqual(BOUNDS.left);
    }
  });

  it('a tall card (the elevator card, 812 on a 900 screen) is capped to the bounds and starts at the top', () => {
    expect(cardMaxHeight(BOUNDS)).toBe(756);
    const at = anchorCard(frame({ card: { width: 360, height: 812 }, selection: { x: 400, y: 500, w: 32, h: 300 } }))!;
    expect(at.top).toBe(132);
    expect(at.side).toBe('right');
  });

  it('keeps its place, on screen, while the selection is off screen or not drawn', () => {
    const previous = { left: 600, top: 300 };
    expect(anchorCard(frame({ selection: { x: -400, y: 300, w: 120, h: 36 }, previous }))).toEqual({ left: 600, top: 300, side: 'kept' });
    expect(anchorCard(frame({ selection: { x: 500, y: 1200, w: 120, h: 36 }, previous }))).toEqual({ left: 600, top: 300, side: 'kept' });
    expect(anchorCard(frame({ selection: null, previous }))).toEqual({ left: 600, top: 300, side: 'kept' });
    // A resize that shrank the view pulls the kept place back inside.
    const small = { left: 76, top: 132, right: 1012, bottom: 756 };
    expect(anchorCard(frame({ bounds: small, selection: null, previous: { left: 900, top: 400 } }))).toEqual({ left: 1012 - 360, top: 756 - 500, side: 'kept' });
    // Never placed yet: no answer, the card keeps its fixed spot.
    expect(anchorCard(frame({ selection: null }))).toBeNull();
  });

  it('prefers the side away from the dock: a dock on the right puts the card on the left first', () => {
    const sel = { x: 700, y: 300, w: 120, h: 36 };
    expect(anchorCard(frame({ selection: sel, dock: 'right' }))!.side).toBe('left');
    expect(anchorCard(frame({ selection: sel, dock: 'left' }))!.side).toBe('right');
  });

  it('a selection too wide for either side: under it, or over it, and only then on top of it', () => {
    const short = { width: 360, height: 200 };
    expect(anchorCard(frame({ card: short, selection: { x: 200, y: 200, w: 1000, h: 100 } }))).toEqual({ left: 520, top: 312, side: 'below' });
    expect(anchorCard(frame({ card: short, selection: { x: 200, y: 640, w: 1000, h: 100 } }))).toEqual({ left: 520, top: 428, side: 'above' });
    const at = anchorCard(frame({ selection: { x: 100, y: 150, w: 1300, h: 700 } }))!;
    expect(at.side).toBe('over');
    expect(at.left).toBe(BOUNDS.right - 360); // the side with more room
  });

  it('never takes the old spot, flush right 8 px under Menu, for any selection on screen', () => {
    const oldSpot = { left: 1440 - 12 - 360, top: MENU.y + MENU.h + 8 };
    for (const card of [CARD, { width: 360, height: 812 }, { width: 468, height: 640 }]) {
      for (let x = -40; x < 1440; x += 23) {
        for (let y = -20; y < 900; y += 41) {
          const at = anchorCard(frame({ card, selection: { x, y, w: 96, h: 36 } }));
          if (!at) continue;
          expect(at.top).toBeGreaterThanOrEqual(BOUNDS.top);
          expect(at.top === oldSpot.top && at.left === oldSpot.left).toBe(false);
          // Below Menu by at least the round-button row.
          expect(at.top - (MENU.y + MENU.h)).toBeGreaterThanOrEqual(60);
        }
      }
    }
  });
});
