// Audit F3 S1: placePerson mirrors the body for the mirrored stride and the right weight shift.
// pixi's setSize keeps the sign scale.x already has, so the sign must come from the frame every
// time, or a person who once took a mirrored frame stays mirrored for good.
import { describe, expect, it } from 'vitest';
import { Container, Sprite, Texture } from 'pixi.js';
import { FRAME, isMirrored, type PersonFrame } from '../../src/render/anim';
import type { Art } from '../../src/render/art';
import { placePerson, type PersonSprites } from '../../src/render/person';
import { SIM_H, SIM_W } from '../../src/render/grid';

describe('placePerson', () => {
  it('a plain frame after a mirrored one is unflipped', () => {
    const tex = new Texture({ label: 'person' });
    const art = { sim: () => tex, prop: () => new Texture({ label: 'prop' }) } as unknown as Art;
    const body = new Sprite(tex);
    body.anchor.set(0.5, 1);
    const p: PersonSprites = { body, prop: null, propKind: null };
    const layer = new Container();
    const seq: PersonFrame[] = [
      FRAME.stand,
      FRAME.stride,
      FRAME.stand,
      FRAME.strideMirrored,
      FRAME.stand,
      FRAME.stride,
      FRAME.shiftLeft,
      FRAME.shiftRight,
      FRAME.shiftLeft,
    ];
    const signs: number[] = [];
    for (const frame of seq) {
      placePerson(art, layer, p, 'worker', 0, frame, 100, 0);
      signs.push(Math.sign(body.scale.x));
      expect(Math.abs(body.width)).toBeCloseTo(SIM_W);
      expect(Math.abs(body.height)).toBeCloseTo(SIM_H);
    }
    expect(signs).toEqual(seq.map((f) => (isMirrored(f) ? -1 : 1)));
  });
});
