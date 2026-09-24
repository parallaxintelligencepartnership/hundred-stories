// The illustrated people (package 2): five adult builds, eight looks from the identity look key,
// role props as overlays, a stress mark instead of a recoloured body. Still one tile wide and
// three tall: a figure wider than its tile overlaps the one beside it in a lift queue, and one
// taller than three tiles pokes through the slab above. Pure geometry, no GPU.

import { describe, expect, it } from 'vitest';
import { FRAME, PERSON_FRAME_COUNT, type PersonFrame } from '../../src/render/anim';
import {
  BODY_COUNT,
  BODY_SHAPES,
  bodyOf,
  decodeLook,
  figureExtents,
  LOOK_CODES,
  LOOKS,
  lookCode,
  markBottomAboveFeet,
  personKey,
  personLookCode,
  propOf,
  propPlacement,
  PROP_SIZE,
  STRESS_MARK_PX,
  stressMarkOf,
  wardrobeOf,
} from '../../src/render/figure';
import { SIM_H, SIM_W, TILE_PX } from '../../src/render/grid';
import { LOOK_KEYS, personIdentity } from '../../src/sim/identity';
import type { SimKind } from '../../src/sim/types';

const KINDS: readonly SimKind[] = ['worker', 'resident', 'guest', 'shopper', 'diner', 'staff', 'visitor', 'vip'];
const FRAMES = Array.from({ length: PERSON_FRAME_COUNT }, (_, i) => i as PersonFrame);

describe('the person box', () => {
  it('is one tile by three tiles, 16 by 48 on the 0.4.0 grid', () => {
    expect(SIM_W).toBe(TILE_PX);
    expect(SIM_H).toBe(3 * TILE_PX);
    expect([SIM_W, SIM_H]).toEqual([16, 48]);
  });

  it('keeps every build, look, role and frame inside the box, outline included', () => {
    for (let code = 0; code < LOOK_CODES; code++) {
      for (const kind of KINDS) {
        for (const frame of FRAMES) {
          const e = figureExtents(kind, code, frame);
          expect(e.left, `${kind} ${code} ${frame}`).toBeGreaterThanOrEqual(-0.01);
          expect(e.right, `${kind} ${code} ${frame}`).toBeLessThanOrEqual(SIM_W + 0.01);
          expect(e.top, `${kind} ${code} ${frame}`).toBeGreaterThanOrEqual(-0.01);
          expect(e.bottom, `${kind} ${code} ${frame}`).toBeLessThanOrEqual(SIM_H + 0.01);
        }
      }
    }
  });

  it('stands the feet on the bottom rows so they meet the slab line', () => {
    for (let code = 0; code < LOOK_CODES; code++) {
      for (const frame of FRAMES) expect(figureExtents('visitor', code, frame).bottom).toBeGreaterThan(SIM_H - 1.5);
    }
  });
});

describe('five builds and eight looks', () => {
  it('has five adult builds, none of them child height', () => {
    expect(BODY_COUNT).toBe(5);
    expect([...BODY_SHAPES].sort()).toEqual(['average', 'broad', 'short', 'slim', 'tall']);
    // Even the short build stands at least 30 px of the 48: an adult, not a child.
    for (let b = 0; b < BODY_COUNT; b++) expect(SIM_H - figureExtents('visitor', lookCode(b, 0), FRAME.stand).top).toBeGreaterThan(30);
  });

  it('gives the five builds and the eight look keys distinct sprite keys', () => {
    expect(LOOKS).toHaveLength(LOOK_KEYS);
    const keys = new Set<string>();
    for (let b = 0; b < BODY_COUNT; b++) for (let k = 0; k < LOOK_KEYS; k++) keys.add(personKey('worker', FRAME.stand, lookCode(b, k)));
    expect(keys.size).toBe(BODY_COUNT * LOOK_KEYS);
  });

  it('draws the five builds as five different silhouettes', () => {
    const shapes = new Set<string>();
    for (let b = 0; b < BODY_COUNT; b++) shapes.add(JSON.stringify(figureExtents('visitor', lookCode(b, 0), FRAME.stand)));
    expect(shapes.size).toBe(BODY_COUNT);
  });

  it('gives the eight looks eight different skin, hair and clothing combinations', () => {
    const looks = new Set(LOOKS.map((l) => `${l.skin}|${l.hair}|${l.cut}|${l.top}`));
    expect(looks.size).toBe(LOOK_KEYS);
    expect(new Set(LOOKS.map((l) => l.skin)).size).toBeGreaterThanOrEqual(6);
    expect(new Set(LOOKS.map((l) => l.hair)).size).toBeGreaterThanOrEqual(6);
  });

  it('round trips a build and look key through the look code', () => {
    for (let b = 0; b < BODY_COUNT; b++) for (let k = 0; k < LOOK_KEYS; k++) expect(decodeLook(lookCode(b, k))).toEqual({ body: b, look: k });
  });

  it('takes the look key from the identity, and the build from seed and id alone', () => {
    for (let id = 1; id < 200; id++) {
      const code = personLookCode(777, id, 'worker');
      expect(decodeLook(code).look).toBe(personIdentity(777, id, 'worker').lookKey);
      expect(decodeLook(code).body).toBe(bodyOf(777, id));
      expect(personLookCode(777, id, 'worker')).toBe(code); // stable across calls
    }
    const builds = new Set(Array.from({ length: 200 }, (_, id) => bodyOf(5, id)));
    expect(builds.size).toBe(BODY_COUNT);
  });

  it('shares one baked person across roles that dress alike, and keeps the uniforms apart', () => {
    const code = lookCode(0, 0);
    expect(personKey('resident', FRAME.stand, code)).toBe(personKey('guest', FRAME.stand, code));
    expect(personKey('worker', FRAME.stand, code)).not.toBe(personKey('resident', FRAME.stand, code));
    expect(personKey('staff', FRAME.stand, code)).not.toBe(personKey('resident', FRAME.stand, code));
    expect(personKey('vip', FRAME.stand, code)).not.toBe(personKey('resident', FRAME.stand, code));
    expect(wardrobeOf('shopper')).toBe('casual');
  });

  it('bakes the mirrored frames once: the sprite is flipped instead', () => {
    const code = lookCode(2, 5);
    expect(personKey('worker', FRAME.strideMirrored, code)).toBe(personKey('worker', FRAME.stride, code));
    expect(personKey('worker', FRAME.shiftRight, code)).toBe(personKey('worker', FRAME.shiftLeft, code));
    expect(personKey('worker', FRAME.stride, code)).not.toBe(personKey('worker', FRAME.stand, code));
  });
});

describe('role props', () => {
  it('gives the worker a briefcase, the resident a bag, the guest a suitcase', () => {
    expect(propOf('worker')).toBe('briefcase');
    expect(propOf('resident')).toBe('handbag');
    expect(propOf('guest')).toBe('suitcase');
    expect(propOf('staff')).toBeNull(); // the housekeeper's uniform is the prop
    expect(propOf('vip')).toBeNull(); // the long coat is drawn on the person
  });

  it('keeps a prop in the same hand across the walk cycle, and sets it down to sit', () => {
    const code = lookCode(0, 0);
    const stride = propPlacement('worker', code, FRAME.stride)!;
    const mirrored = propPlacement('worker', code, FRAME.strideMirrored)!;
    const stand = propPlacement('worker', code, FRAME.stand)!;
    for (const p of [stride, mirrored, stand]) expect(p.x + PROP_SIZE.briefcase.w / 2).toBeGreaterThan(SIM_W / 2);
    const sit = propPlacement('worker', code, FRAME.sit)!;
    expect(sit.y + PROP_SIZE.briefcase.h).toBeGreaterThan(SIM_H - 4);
  });
});

describe('stress mark', () => {
  it('is a pink dot in the middle band, a red exclamation in the top band, nothing when calm', () => {
    expect(stressMarkOf('calm')).toBeNull();
    expect(stressMarkOf('pink')).toBe('dot');
    expect(stressMarkOf('red')).toBe('bang');
    expect(STRESS_MARK_PX).toBe(4);
  });

  it('sits above the top of the head for every build', () => {
    for (let b = 0; b < BODY_COUNT; b++) {
      const code = lookCode(b, 3);
      const headTop = figureExtents('visitor', code, FRAME.stand).top + 2; // the outline is 2 px
      expect(SIM_H - markBottomAboveFeet(code)).toBeLessThan(headTop);
    }
  });
});

describe('the recurring characters (package 8b)', () => {
  it('dresses guards and collectors for the job, and the thief as any visitor', () => {
    const code = lookCode(1, 3);
    expect(wardrobeOf('guard')).toBe('guard');
    expect(wardrobeOf('collector')).toBe('collector');
    expect(wardrobeOf('thief')).toBe('casual');
    expect(personKey('guard', FRAME.stand, code)).not.toBe(personKey('worker', FRAME.stand, code));
    expect(personKey('collector', FRAME.stand, code)).not.toBe(personKey('staff', FRAME.stand, code));
    // Until the encounter is resolved the thief is the same baked person a visitor would be.
    expect(personKey('thief', FRAME.stand, code)).toBe(personKey('visitor', FRAME.stand, code));
  });

  it('gives the guard a radio, the collector a wheeled bin, the thief a visitor camera', () => {
    expect(propOf('guard')).toBe('radio');
    expect(propOf('collector')).toBe('bin');
    expect(propOf('thief')).toBe(propOf('visitor'));
  });

  it('wheels the bin at the feet like a suitcase, and holds the radio in the hand', () => {
    const code = lookCode(0, 0);
    const bin = propPlacement('collector', code, FRAME.stand)!;
    const suitcase = propPlacement('guest', code, FRAME.stand)!;
    expect(bin.y + PROP_SIZE.bin.h).toBeCloseTo(suitcase.y + PROP_SIZE.suitcase.h, 5);
    const radio = propPlacement('guard', code, FRAME.stand)!;
    expect(radio.y + PROP_SIZE.radio.h).toBeLessThan(SIM_H - 4);
  });

  it('keeps the uniforms inside the person box', () => {
    for (const kind of ['guard', 'collector'] as SimKind[]) {
      for (let body = 0; body < BODY_COUNT; body++) {
        for (const frame of FRAMES) {
          const e = figureExtents(kind, lookCode(body, 2), frame);
          expect(e.left, `${kind} ${body} ${frame}`).toBeGreaterThanOrEqual(-0.01);
          expect(e.right, `${kind} ${body} ${frame}`).toBeLessThanOrEqual(SIM_W + 0.01);
          expect(e.top, `${kind} ${body} ${frame}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
