import { it, vi } from 'vitest';
import { Texture, type Rectangle, type Renderer as PixiRenderer } from 'pixi.js';
import { createArt } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/render/art';
import { createWorld } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/world';
import { applyCommand } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/build';
import { floorBand } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/render/camera';

import { appendFileSync } from "node:fs";
const out = (s: string) => appendFileSync("/private/tmp/claude-501/-Users-matthew-parallax-private-Projects-hundred-stories/59100aac-82b1-4a98-947c-f0845463d155/scratchpad/audit/verifyNew/n4.out", s + "\n");
it('N1: a built (never dragged) express 1..100 bakes one shaft texture taller than 8192 device px', () => {
  const bakes: { key?: string; w: number; h: number; res: number }[] = [];
  const pixi = { generateTexture: (o: { frame: Rectangle; resolution: number }) => { bakes.push({ w: o.frame.width, h: o.frame.height, res: o.resolution }); return new Texture(); } } as unknown as PixiRenderer;
  const art = createArt(pixi, { resolution: 2, createCanvas: (w, h) => ({ width: w, height: h, getContext: () => null }) as unknown as HTMLCanvasElement });
  const w = createWorld(1); w.cash = 1e10; (w as any).stars = 3;
  for (let x = 100; x < 140; x++) applyCommand(w, { kind: 'build', room: 'lobby', floor: 1, x });
  for (const [min, max] of [[1, 100], [-10, 100], [1, 56], [1, 57]] as const) {
    const res = applyCommand(w, { kind: 'shaft.build', shaft: 'express', x: 110 + (min + 20) % 7 * 0, floorMin: min, floorMax: max });
    const shaft = [...w.shafts.values()].pop()!;
    // renderer.ts:1553-1556: floors = shaftFloorSpan(shaft) = floorBand(max) - floorBand(min) + 1, then art.shaft(kind, floors)
    const floors = floorBand(shaft.floorMax) - floorBand(shaft.floorMin) + 1;
    const before = bakes.length;
    art.shaft(shaft.kind, floors);
    const b = bakes[before];
    out(`N1 build express ${min}..${max}: ${JSON.stringify(res)} span ${floors} floors -> texture ${b ? `${b.w * b.res} x ${b.h * b.res} device px` : 'cached'}; over 8192: ${b ? b.h * b.res > 8192 : '-'}`);
    applyCommand(w, { kind: 'shaft.demolish', shaftId: shaft.id });
  }
});
