// One drawn person: the baked body (flipped for a mirrored frame) and what they carry, hung in
// their hand as its own small sprite. Shared by the tower's people and the curb's commuters.

import { Container, Sprite } from 'pixi.js';
import type { SimKind } from '../sim/types';
import { isMirrored, type PersonFrame } from './anim';
import type { Art } from './art';
import { PROP_SIZE, propPlacement, type PropKind } from './figure';
import { SIM_H, SIM_W } from './grid';

export interface PersonSprites {
  body: Sprite;
  prop: Sprite | null;
  propKind: PropKind | null;
}

/**
 * Put a person's body with its feet at (x, y), mirrored for a mirrored frame, and their prop in
 * their hand on `propLayer` (in front of the bodies). An Art without props draws none.
 */
export function placePerson(
  art: Art,
  propLayer: Container,
  p: PersonSprites,
  kind: SimKind,
  look: number,
  frame: PersonFrame,
  x: number,
  y: number,
): void {
  p.body.setSize(SIM_W, SIM_H);
  if (isMirrored(frame)) p.body.scale.x = -Math.abs(p.body.scale.x);
  p.body.position.set(x, y);
  const place = art.prop ? propPlacement(kind, look, frame) : null;
  if (!place || !art.prop) {
    if (p.prop) p.prop.visible = false;
    return;
  }
  if (!p.prop) {
    p.prop = new Sprite(art.prop(place.prop));
    propLayer.addChild(p.prop);
    p.propKind = place.prop;
  } else if (p.propKind !== place.prop) {
    p.prop.texture = art.prop(place.prop);
    p.propKind = place.prop;
  }
  const size = PROP_SIZE[place.prop];
  p.prop.visible = true;
  p.prop.setSize(size.w, size.h);
  p.prop.position.set(x - SIM_W / 2 + place.x, y - SIM_H + place.y);
}
