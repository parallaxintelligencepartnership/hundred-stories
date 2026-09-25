// The placement preview the player reads before they pay: the words on the chip and the
// Build button, and where the chip and the bar sit against the outline. Pure functions only,
// so this runs in the default vitest node environment like the rest of tests/ui.
import { describe, expect, it } from 'vitest';
import { placementArrowLabels, placementBuildLabels, placementChipText } from '../../src/ui/ui';
import { clampSpan, placementBoxes, PLACE_GAP, PLACE_GUTTER } from '../../src/ui/layout';
import type { Placement } from '../../src/game/api';

const office: Placement = {
  floor: 2,
  x: 100,
  floorMin: 2,
  floorMax: 2,
  ok: true,
  label: 'Office',
  cost: 40_000,
  pending: true,
};

describe('placementChipText', () => {
  it('names what is being placed and what it costs', () => {
    expect(placementChipText(office)).toBe('Office · $40,000');
  });

  it('gives the sim its own words when the spot is refused', () => {
    expect(
      placementChipText({ ...office, ok: false, reason: 'Build a floor below this one first.' }),
    ).toBe('Build a floor below this one first.');
  });

  it('still says something when a refusal arrives without a reason', () => {
    expect(placementChipText({ ...office, ok: false })).toBe('You cannot build it there.');
  });
});

describe('placementBuildLabels', () => {
  it('carries the price on the button', () => {
    expect(placementBuildLabels(office)).toEqual({ text: 'Build $40,000', title: 'Build it here' });
  });

  it('carries the reason as the title when it cannot be built', () => {
    const labels = placementBuildLabels({ ...office, ok: false, reason: 'Something is already there.' });
    expect(labels.text).toBe('Build $40,000');
    expect(labels.title).toBe('Something is already there.');
  });
});

describe('placementArrowLabels', () => {
  it('moves a room', () => {
    expect(placementArrowLabels(false)).toEqual({
      up: 'Move up one floor',
      down: 'Move down one floor',
    });
  });

  it('stretches an elevator', () => {
    expect(placementArrowLabels(true)).toEqual({
      up: 'Extend the top one floor',
      down: 'Extend the bottom one floor',
    });
  });
});

describe('clampSpan', () => {
  it('keeps a box a gutter clear of both edges', () => {
    expect(clampSpan(-40, 100, 400)).toBe(PLACE_GUTTER);
    expect(clampSpan(380, 100, 400)).toBe(400 - 100 - PLACE_GUTTER);
    expect(clampSpan(120, 100, 400)).toBe(120);
  });

  it('centers a box too wide for the gutters rather than pushing it off screen', () => {
    expect(clampSpan(-100, 390, 400)).toBe(5);
  });
});

describe('placementBoxes', () => {
  const frame = {
    ghost: { x: 200, y: 300, w: 80, h: 40 },
    chip: { width: 120, height: 20 },
    bar: { width: 200, height: 52 },
    view: { width: 400, height: 800 },
    chrome: { top: 60, bottom: 120 },
  };

  it('puts the chip over the outline and the bar under it, both centered on it', () => {
    const boxes = placementBoxes(frame);
    expect(boxes.chip).toEqual({ left: 240 - 60, top: 300 - 20 - PLACE_GAP });
    expect(boxes.bar).toEqual({ left: 240 - 100, top: 300 + 40 + PLACE_GAP });
  });

  it('leaves the bar out when there is no bar to place', () => {
    expect(placementBoxes({ ...frame, bar: null }).bar).toBeNull();
  });

  it('never lets the chip ride up under the top strip', () => {
    const boxes = placementBoxes({ ...frame, ghost: { x: 200, y: 4, w: 80, h: 40 } });
    expect(boxes.chip.top).toBe(60 + PLACE_GUTTER);
  });

  it('lifts the bar above the chip when the palette sheet leaves no room below', () => {
    const low = { ...frame, ghost: { x: 200, y: 600, w: 80, h: 40 } };
    const boxes = placementBoxes(low);
    const chipTop = 600 - 20 - PLACE_GAP;
    expect(boxes.chip.top).toBe(chipTop);
    expect(boxes.bar).toEqual({ left: 240 - 100, top: chipTop - 52 - PLACE_GAP });
  });

  it('keeps both inside the view when the outline is off at the edge', () => {
    const boxes = placementBoxes({ ...frame, ghost: { x: -300, y: 300, w: 80, h: 40 } });
    expect(boxes.chip.left).toBe(PLACE_GUTTER);
    expect(boxes.bar?.left).toBe(PLACE_GUTTER);
  });
});
