// The room specimens (design pass D-39): each is drawn by the game's own art code, on the day
// cutaway's wall (BB-3: the head rail and the sill, no panes), then swapped for an image.
import { describe, expect, it } from 'vitest';
import { FRAME } from '../../src/render/anim';
import { drawPerson, drawPortrait, drawStressMark, lookCode, type Ctx2D } from '../../src/render/figure';
import { drawCarIllustrated, drawSign, drawVenueFixtures, signBoard } from '../../src/render/illustrated';
import { VENUE_ACCENTS } from '../../src/render/venue';
import { PORTRAIT_PX as CARD_PX } from '../../src/ui/panels';
import {
  CARD_PORTRAIT_PX,
  drawSpecimen,
  mountSpecimens,
  PORTRAIT_PX,
  SPECIMEN_H,
  SPECIMEN_KINDS,
  SPECIMEN_W,
  specimenScene,
  type SpecimenCanvas,
  type SpecimenDocument,
  type SpecimenImage,
  type SpecimenKind,
} from '../../src/site/specimens';

/** A 2D context that records every call and every property set, in order. */
function recorder(): { ctx: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = [];
  const fmt = (a: unknown): string => (typeof a === 'number' ? a.toFixed(3) : typeof a === 'object' && a !== null ? 'obj' : String(a));
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (target, key: string) => {
      if (key in target) return target[key];
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop: () => undefined });
      if (key === 'measureText') return () => ({ width: 10 });
      return (...args: unknown[]) => calls.push(`${key}(${args.map(fmt).join(',')})`);
    },
    set: (target, key: string, value) => {
      target[key] = value;
      calls.push(`${key}=${fmt(value)}`);
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

/** The calls one game draw function makes on its own. */
function callsOf(draw: (ctx: CanvasRenderingContext2D) => void): string[] {
  const r = recorder();
  draw(r.ctx);
  return r.calls;
}

/** Whether `run` appears in `calls` as one unbroken stretch. */
function containsRun(calls: string[], run: string[]): boolean {
  expect(run.length).toBeGreaterThan(5);
  for (let i = 0; i + run.length <= calls.length; i++) {
    if (run.every((c, j) => calls[i + j] === c)) return true;
  }
  return false;
}

function specimenCalls(kind: SpecimenKind): string[] {
  const r = recorder();
  drawSpecimen(r.ctx, kind);
  return r.calls;
}

const asCtx2D = (ctx: CanvasRenderingContext2D): Ctx2D => ctx as unknown as Ctx2D;

describe('each specimen is drawn by the game, not by hand', () => {
  it('office: the first office base in a nine tile room, and a worker seated at the bench', () => {
    const calls = specimenCalls('office');
    expect(specimenScene('office').w).toBe(144);
    expect(containsRun(calls, callsOf((c) => drawVenueFixtures(c, 'office', 0, 144)))).toBe(true);
    expect(containsRun(calls, callsOf((c) => drawPerson(asCtx2D(c), 'worker', lookCode(1, 2), FRAME.sit)))).toBe(true);
    expect(calls).toContain(`translate(${(48).toFixed(3)},${(18).toFixed(3)})`); // at the second laptop, feet on the slab line
  });

  it('shop: the second shop base in a twelve tile room, under its sign', () => {
    const calls = specimenCalls('shop');
    expect(specimenScene('shop').w).toBe(192);
    expect(containsRun(calls, callsOf((c) => drawVenueFixtures(c, 'shop', 1, 192)))).toBe(true);
    const accent = (VENUE_ACCENTS.shop[1] as readonly [number, number])[0];
    expect(containsRun(calls, callsOf((c) => drawSign(c, signBoard('shop', 192), 'Paper Lantern', accent)))).toBe(true);
    expect(calls).toContain(`translate(${(10).toFixed(3)},${(4).toFixed(3)})`); // the sign where the renderer puts it
  });

  it('car: a standard car at its middle door frame, standing on the slab line', () => {
    const calls = specimenCalls('car');
    expect(containsRun(calls, callsOf((c) => drawCarIllustrated(c, 'standard', 56, 60, 0.5, 4, 0)))).toBe(true);
    expect(calls).toContain(`translate(${(44).toFixed(3)},${(2).toFixed(3)})`);
  });

  it('stress: three people, one calm, one with the pink dot, one with the red exclamation', () => {
    const calls = specimenCalls('stress');
    for (const [kind, code, frame] of [
      ['visitor', lookCode(0, 1), FRAME.stand],
      ['worker', lookCode(3, 4), FRAME.shiftLeft],
      ['visitor', lookCode(2, 6), FRAME.glance],
    ] as const) {
      expect(containsRun(calls, callsOf((c) => drawPerson(asCtx2D(c), kind, code, frame)))).toBe(true);
    }
    const dot = callsOf((c) => drawStressMark(asCtx2D(c), 'dot'));
    const bang = callsOf((c) => drawStressMark(asCtx2D(c), 'bang'));
    expect(containsRun(calls, dot)).toBe(true);
    expect(containsRun(calls, bang)).toBe(true);
  });

  it('people: four portraits from the person card, each framed in the 2 px outline', () => {
    const calls = specimenCalls('people');
    const faces = [
      ['worker', lookCode(0, 3)],
      ['visitor', lookCode(4, 0)],
      ['staff', lookCode(1, 5)],
      ['vip', lookCode(3, 7)],
    ] as const;
    for (const [kind, code] of faces) {
      expect(containsRun(calls, callsOf((c) => drawPortrait(asCtx2D(c), kind, code, PORTRAIT_PX)))).toBe(true);
    }
    expect(calls.filter((c) => c.startsWith(`strokeRect(`) && c.endsWith(`,${PORTRAIT_PX.toFixed(3)},${PORTRAIT_PX.toFixed(3)})`))).toHaveLength(4);
  });

  it('people: each portrait is clipped to the person card\'s square, 48 css px from its origin, before it is drawn', () => {
    expect(CARD_PORTRAIT_PX).toBe(CARD_PX);
    expect(PORTRAIT_PX * specimenScene('people').scale).toBe(CARD_PX);
    const calls = specimenCalls('people');
    const size = PORTRAIT_PX.toFixed(3);
    const clips = calls.flatMap((c, i) => (c === 'clip()' ? [i] : []));
    expect(clips).toHaveLength(4);
    for (const at of clips) {
      const rect = calls[at - 1] as string;
      expect(rect).toMatch(new RegExp(`^rect\\(([\\d.]+),([\\d.]+),${size},${size}\\)$`));
      const [, x, y] = /^rect\(([\d.]+),([\d.]+),/.exec(rect) as RegExpExecArray;
      expect(calls[at - 2]).toBe('beginPath()');
      expect(calls[at - 3]).toBe('save()');
      expect(calls[at + 1]).toBe(`translate(${x},${y})`); // the card's offset: the portrait at the crop's origin
      expect(calls[at + 3]).toBe(`fillRect(${(0).toFixed(3)},${(0).toFixed(3)},${size},${size})`); // drawPortrait's own square
    }
  });
});

describe('every specimen sits on the day cutaway wall', () => {
  it.each(SPECIMEN_KINDS)('%s: the wall, the head rail at y 4 and the sill at y 18 in ink, no day panes, the outline last', (kind) => {
    const calls = specimenCalls(kind);
    const { w, h } = specimenScene(kind);
    const n = (v: number): string => v.toFixed(3);
    expect(calls.slice(0, 2)).toEqual(['fillStyle=#f8f8f6', `fillRect(${n(0)},${n(0)},${n(w)},${n(h)})`]);
    const rail = calls.indexOf(`fillRect(${n(0)},${n(4)},${n(w)},${n(2)})`);
    const sill = calls.indexOf(`fillRect(${n(0)},${n(18)},${n(w)},${n(2)})`);
    expect(rail).toBeGreaterThan(0);
    expect(sill).toBe(rail + 1);
    expect(calls[rail - 1]).toBe('fillStyle=#222222');
    // BB-3: by day no pane is drawn, so the day glass never appears.
    expect(calls.join(' ')).not.toContain('#7fb6e0');
    expect(calls.slice(-3)).toEqual(['strokeStyle=#222222', `lineWidth=${n(2)}`, `strokeRect(${n(1)},${n(1)},${n(w - 2)},${n(h - 2)})`]);
    // The scene fills the canvas at one scale.
    expect(w * specimenScene(kind).scale).toBe(SPECIMEN_W);
    expect(h * specimenScene(kind).scale).toBe(SPECIMEN_H);
  });
});

describe('mountSpecimens', () => {
  type Fake = SpecimenCanvas & { replacedBy: SpecimenImage | null; added: string[]; ctx: { calls: string[] } };

  function fakeCanvas(kind: string, label: string, dataUrl: () => string): Fake {
    const r = recorder();
    const c: Fake = {
      width: 300,
      height: 150,
      dataset: { specimen: kind },
      getAttribute: (name) => (name === 'aria-label' ? label : null),
      getContext: () => r.ctx,
      toDataURL: dataUrl,
      replaceWith(node) {
        c.replacedBy = node as SpecimenImage;
      },
      classList: {
        add(name) {
          c.added.push(name);
        },
      },
      replacedBy: null,
      added: [],
      ctx: r,
    };
    return c;
  }

  function fakeDocument(canvases: Fake[]): SpecimenDocument & { selectors: string[] } {
    const selectors: string[] = [];
    return {
      selectors,
      querySelectorAll(selector) {
        selectors.push(selector);
        return canvases;
      },
      createElement: () => ({ src: '', alt: '', width: 0, height: 0, className: '' }),
    };
  }

  it('sizes each canvas at the pixel ratio, draws it and swaps it for an image with the label as alt', () => {
    const office = fakeCanvas('office', 'An office as the game draws it', () => 'data:image/png;base64,AAAA');
    const shop = fakeCanvas('shop', 'A shop as the game draws it', () => 'data:image/png;base64,BBBB');
    const doc = fakeDocument([office, shop]);
    expect(mountSpecimens(doc, 2)).toBe(2);
    expect(doc.selectors).toEqual(['canvas.specimen[data-specimen]']);
    expect([office.width, office.height]).toEqual([576, 288]);
    expect(office.ctx.calls[0]).toBe(`scale(${(4).toFixed(3)},${(4).toFixed(3)})`); // the ratio times 288 / 144
    expect(shop.ctx.calls[0]).toBe(`scale(${(3).toFixed(3)},${(3).toFixed(3)})`); // the ratio times 288 / 192
    expect(office.replacedBy).toEqual({ src: 'data:image/png;base64,AAAA', alt: 'An office as the game draws it', width: 288, height: 144, className: 'specimen is-drawn' });
    expect(shop.replacedBy?.src).toBe('data:image/png;base64,BBBB');
  });

  it('leaves an unknown specimen alone and keeps a drawn canvas when it cannot make an image', () => {
    const unknown = fakeCanvas('lobby', 'Not a specimen', () => 'data:,');
    const stuck = fakeCanvas('car', 'An elevator car', () => {
      throw new Error('tainted');
    });
    expect(mountSpecimens(fakeDocument([unknown, stuck]), 1)).toBe(1);
    expect(unknown.ctx.calls).toEqual([]);
    expect(unknown.replacedBy).toBeNull();
    expect(stuck.replacedBy).toBeNull();
    expect(stuck.added).toEqual(['is-drawn']);
    expect([stuck.width, stuck.height]).toEqual([288, 144]);
  });
});
