// Room specimens (design pass D-39): below the fold, each floor section shows a piece of the game
// drawn by the game's own art code, never a hand drawn shape or an image file. A specimen is one
// floor band of the cutaway as the game draws it by day (BB-3): a wall with a 2 px outline, the
// head rail and the sill with no panes, the slab, and on it the fixtures, a car or people from
// src/render/illustrated.ts and src/render/figure.ts.
//
// Each `<canvas class="specimen" data-specimen="...">` is sized to SPECIMEN_W by SPECIMEN_H css px
// at the device pixel ratio, drawn once, then swapped for an img of its own pixels with the
// canvas's aria-label as alt, so nothing stays live on the page. Nothing is drawn at load: each
// specimen waits for the landing hero's first frame, then for its section to near the viewport
// (scheduleSpecimens). site.css keeps an undrawn canvas's space but shows nothing in it.

import { FRAME } from '../render/anim';
import { drawPerson, drawPortrait, drawStressMark, lookCode, markBottomAboveFeet, MARK_H, MARK_W, type Ctx2D } from '../render/figure';
import { CAR_CLEAR_PX, CAR_INSET_PX, CAR_SHADOW_PX, FLOOR_PX, LINE_PX, SIM_H, SIM_W, SLAB_EDGE_PX, SLAB_PX, TILE_PX, WIN_SILL, WIN_TOP } from '../render/grid';
import { css, drawCarIllustrated, drawSign, drawVenueFixtures, INK, signBoard } from '../render/illustrated';
import { PALETTE } from '../render/palette';
import { VENUE_ACCENTS, VENUE_NAMES } from '../render/venue';
import { SHAFTS } from '../sim/rules';
import { whenHeroSettled, type HeroDocument } from './hero-ready';

export const SPECIMEN_KINDS = ['stress', 'office', 'shop', 'car', 'people'] as const;
export type SpecimenKind = (typeof SPECIMEN_KINDS)[number];

/** Every specimen's size in css px. */
export const SPECIMEN_W = 288;
export const SPECIMEN_H = 144;
/** The wall every specimen is drawn on, the lobby's marble white. */
export const SPECIMEN_WALL = '#f8f8f6';

/** The first row of the slab in a floor band, as art.ts and illustrated.ts count it. */
const BASE = FLOOR_PX - SLAB_PX;

/** The room each specimen shows, in the game's logical px: its real width in tiles. */
export const SPECIMEN_ROOM_W: Record<SpecimenKind, number> = {
  stress: 9 * TILE_PX,
  office: 9 * TILE_PX, // an office is nine tiles (sim/rules.ts ROOMS.office)
  shop: 12 * TILE_PX, // a shop is twelve
  car: 9 * TILE_PX,
  people: 9 * TILE_PX,
};

export function isSpecimenKind(value: string | undefined | null): value is SpecimenKind {
  return (SPECIMEN_KINDS as readonly string[]).includes(value ?? '');
}

/**
 * The logical scene a specimen draws: the room's width, and as much height as the canvas gives at
 * the scale that fits that width. The floor band sits at the bottom; any height over one floor is
 * more wall above it.
 */
export function specimenScene(kind: SpecimenKind): { w: number; h: number; scale: number } {
  const w = SPECIMEN_ROOM_W[kind];
  const scale = SPECIMEN_W / w;
  return { w, h: SPECIMEN_H / scale, scale };
}

/** The standing person's box top, so the feet land on the slab line as the renderer puts them. */
const PERSON_TOP = BASE - SIM_H;

function drawStress(ctx: CanvasRenderingContext2D): void {
  // Calm, stressed and nearly out of patience: no mark, the pink dot, the red exclamation.
  const people = [
    { x: 30, kind: 'visitor', code: lookCode(0, 1), frame: FRAME.stand, mark: null },
    { x: 64, kind: 'worker', code: lookCode(3, 4), frame: FRAME.shiftLeft, mark: 'dot' },
    { x: 98, kind: 'visitor', code: lookCode(2, 6), frame: FRAME.glance, mark: 'bang' },
  ] as const;
  for (const p of people) {
    ctx.save();
    ctx.translate(p.x, PERSON_TOP);
    drawPerson(ctx as unknown as Ctx2D, p.kind, p.code, p.frame);
    ctx.restore();
    if (!p.mark) continue;
    ctx.save();
    ctx.translate(p.x + SIM_W / 2 - MARK_W / 2, BASE - markBottomAboveFeet(p.code) - MARK_H);
    drawStressMark(ctx as unknown as Ctx2D, p.mark);
    ctx.restore();
  }
}

function drawOfficeSpecimen(ctx: CanvasRenderingContext2D, w: number): void {
  // The design studio (the first base), with a worker seated at the second laptop, clear of the pinboard.
  drawVenueFixtures(ctx, 'office', 0, w);
  ctx.save();
  ctx.translate(48, PERSON_TOP);
  drawPerson(ctx as unknown as Ctx2D, 'worker', lookCode(1, 2), FRAME.sit);
  ctx.restore();
}

function drawShopSpecimen(ctx: CanvasRenderingContext2D, w: number): void {
  // The bookshop (the second base) under its sign, placed where the renderer places it.
  drawVenueFixtures(ctx, 'shop', 1, w);
  const board = signBoard('shop', w);
  const name = VENUE_NAMES.shop[8] as string; // Paper Lantern, the first bookshop name
  const accent = (VENUE_ACCENTS.shop[1] as readonly [number, number])[0];
  ctx.save();
  ctx.translate(board.x, board.y);
  drawSign(ctx, board, name, accent);
  ctx.restore();
}

function drawCarSpecimen(ctx: CanvasRenderingContext2D, w: number): void {
  // A standard car at its middle door frame, bottom centre on the slab line as renderer.ts carY has it.
  const carW = SHAFTS.standard.width * TILE_PX - CAR_INSET_PX;
  const carH = FLOOR_PX - CAR_CLEAR_PX + CAR_SHADOW_PX;
  ctx.save();
  ctx.translate(w / 2 - carW / 2, BASE - carH);
  drawCarIllustrated(ctx, 'standard', carW, carH - CAR_SHADOW_PX, 0.5, CAR_SHADOW_PX, 0);
  ctx.restore();
}

/**
 * The person card's portrait, css px (src/ui/panels.ts PORTRAIT_PX, copied because panels.ts pulls
 * in the whole game UI; tests/site/specimens.test.ts holds the copy to the original). The card
 * draws drawPortrait at its canvas origin and its canvas edge is the crop.
 */
export const CARD_PORTRAIT_PX = 48;
/** The same portrait in the people specimen's logical px, so it shows at the card's 48 css px. */
export const PORTRAIT_PX = CARD_PORTRAIT_PX / (SPECIMEN_W / (9 * TILE_PX));

function drawPeople(ctx: CanvasRenderingContext2D, w: number): void {
  const faces = [
    { kind: 'worker', code: lookCode(0, 3) },
    { kind: 'visitor', code: lookCode(4, 0) },
    { kind: 'staff', code: lookCode(1, 5) },
    { kind: 'vip', code: lookCode(3, 7) },
  ] as const;
  const gap = (w - faces.length * PORTRAIT_PX) / (faces.length + 1);
  const top = WIN_SILL + LINE_PX + (BASE - WIN_SILL - LINE_PX - PORTRAIT_PX) / 2;
  faces.forEach((f, i) => {
    const x = gap + i * (PORTRAIT_PX + gap);
    // Cropped to head and shoulders as the card crops it: its square, from its origin.
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, top, PORTRAIT_PX, PORTRAIT_PX);
    ctx.clip();
    ctx.translate(x, top);
    drawPortrait(ctx as unknown as Ctx2D, f.kind, f.code, PORTRAIT_PX);
    ctx.restore();
    // The card's frame: the 2 px outline every illustrated shape carries.
    ctx.strokeStyle = INK;
    ctx.lineWidth = LINE_PX;
    ctx.strokeRect(x, top, PORTRAIT_PX, PORTRAIT_PX);
  });
}

/**
 * Draws one specimen in its logical scene (specimenScene): the context is already scaled so the
 * scene fills the canvas. The wall, the day window band (the head rail at y 4 to 5 and the sill at
 * y 18 to 19, no panes), the slab, the subject, then the outline.
 */
export function drawSpecimen(ctx: CanvasRenderingContext2D, kind: SpecimenKind): void {
  const { w, h } = specimenScene(kind);
  ctx.fillStyle = SPECIMEN_WALL;
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.translate(0, h - FLOOR_PX);
  ctx.fillStyle = INK;
  ctx.fillRect(0, WIN_TOP, w, LINE_PX); // head rail
  ctx.fillRect(0, WIN_SILL, w, LINE_PX); // sill
  ctx.fillStyle = css(PALETTE.slab);
  ctx.fillRect(0, BASE, w, SLAB_PX);
  ctx.fillStyle = css(PALETTE.slabEdge);
  ctx.fillRect(0, BASE, w, SLAB_EDGE_PX);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (kind === 'stress') drawStress(ctx);
  else if (kind === 'office') drawOfficeSpecimen(ctx, w);
  else if (kind === 'shop') drawShopSpecimen(ctx, w);
  else if (kind === 'car') drawCarSpecimen(ctx, w);
  else drawPeople(ctx, w);
  ctx.restore();
  ctx.strokeStyle = INK;
  ctx.lineWidth = LINE_PX;
  ctx.strokeRect(LINE_PX / 2, LINE_PX / 2, w - LINE_PX, h - LINE_PX);
}

/** The parts of the DOM this module touches, so a test can hand in a stand in. */
export interface SpecimenCanvas {
  width: number;
  height: number;
  dataset: { specimen?: string };
  getAttribute(name: string): string | null;
  getContext(kind: '2d'): CanvasRenderingContext2D | null;
  toDataURL(type: string): string;
  replaceWith(node: unknown): void;
  classList: { add(name: string): void };
}

export interface SpecimenImage {
  src: string;
  alt: string;
  width: number;
  height: number;
  className: string;
}

export interface SpecimenDocument {
  querySelectorAll(selector: string): ArrayLike<SpecimenCanvas>;
  createElement(tag: 'img'): SpecimenImage;
}

/** The pixel ratio a specimen is drawn at: the device's, between 1 and 3, 1 when it is not a number. */
export function specimenRatio(dpr: number): number {
  return Math.min(3, Math.max(1, Number.isFinite(dpr) ? dpr : 1));
}

const SELECTOR = 'canvas.specimen[data-specimen]';

/**
 * Draws one specimen canvas and swaps it for an img of its pixels, the same size in css px so
 * nothing shifts. Returns whether it drew: an unknown kind or no 2D context draws nothing.
 */
export function drawSpecimenCanvas(doc: SpecimenDocument, canvas: SpecimenCanvas, dpr: number): boolean {
  const kind = canvas.dataset.specimen;
  if (!isSpecimenKind(kind)) return false;
  const ratio = specimenRatio(dpr);
  canvas.width = Math.round(SPECIMEN_W * ratio);
  canvas.height = Math.round(SPECIMEN_H * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  ctx.scale(ratio * specimenScene(kind).scale, ratio * specimenScene(kind).scale);
  drawSpecimen(ctx, kind);
  const alt = canvas.getAttribute('aria-label') ?? '';
  try {
    const img = doc.createElement('img');
    img.src = canvas.toDataURL('image/png');
    img.alt = alt;
    img.width = SPECIMEN_W;
    img.height = SPECIMEN_H;
    img.className = 'specimen is-drawn';
    canvas.replaceWith(img);
  } catch {
    // No image out of the canvas: the drawn canvas stays and shows.
    canvas.classList.add('is-drawn');
  }
  return true;
}

/** Draws every specimen canvas on the page now. Returns how many were drawn. */
export function mountSpecimens(doc: SpecimenDocument, dpr: number): number {
  let drawn = 0;
  for (const canvas of Array.from(doc.querySelectorAll(SELECTOR))) if (drawSpecimenCanvas(doc, canvas, dpr)) drawn += 1;
  return drawn;
}

/** The observer this module asks for: the IntersectionObserver surface it uses. */
export interface SpecimenObserver {
  observe(target: SpecimenCanvas): void;
  unobserve(target: SpecimenCanvas): void;
}
export type SpecimenObserverFactory = (
  callback: (entries: ReadonlyArray<{ isIntersecting: boolean; target: unknown }>) => void,
  options: { rootMargin: string },
) => SpecimenObserver;

export interface SpecimenSchedule {
  doc: SpecimenDocument;
  dpr: number;
  /** Resolves once the landing hero has drawn its first frame or given up (hero-ready.ts). */
  heroSettled: Promise<void>;
  /** css px: the observer draws a specimen this far before it scrolls into view. */
  viewportHeight: number;
  /** An IntersectionObserver maker, or null where the browser has none. */
  observe: SpecimenObserverFactory | null;
  /** Runs work when the page is idle (requestIdleCallback, or a timeout where there is none). */
  idle: (work: () => void) => void;
}

/**
 * Nothing is drawn at load. Once the hero has settled, each specimen is drawn when its section
 * comes within about one viewport of the screen (one observer, each canvas unobserved once drawn).
 * With no IntersectionObserver, all of them are drawn on the first idle callback after the hero.
 */
export async function scheduleSpecimens(s: SpecimenSchedule): Promise<void> {
  await s.heroSettled;
  const canvases = Array.from(s.doc.querySelectorAll(SELECTOR));
  if (canvases.length === 0) return;
  if (!s.observe) {
    s.idle(() => {
      for (const canvas of canvases) drawSpecimenCanvas(s.doc, canvas, s.dpr);
    });
    return;
  }
  const observer = s.observe(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const canvas = entry.target as SpecimenCanvas;
        observer.unobserve(canvas);
        drawSpecimenCanvas(s.doc, canvas, s.dpr);
      }
    },
    { rootMargin: `${Math.max(0, Math.round(s.viewportHeight))}px 0px` },
  );
  for (const canvas of canvases) observer.observe(canvas);
}

/** If the hero has not settled this long after load, the specimens go ahead anyway. */
export const HERO_DEADLINE_MS = 4000;

/**
 * Resolves when the specimens may start: the page's fonts are ready (the shop's sign is lettered
 * in Bricolage Grotesque) and the hero has settled, or HERO_DEADLINE_MS has passed since this was
 * called, whichever comes first for the hero. The deadline runs from load, not from the fonts.
 */
export function specimensReady(fontsReady: Promise<unknown>, heroDoc: HeroDocument, wait: (ms: number) => Promise<void>): Promise<void> {
  const hero = Promise.race([whenHeroSettled(heroDoc), wait(HERO_DEADLINE_MS)]);
  return fontsReady.catch(() => undefined).then(() => hero);
}

/** What the page hands the load path: the real globals, or a test's stand ins. */
export interface SpecimenBoot extends Omit<SpecimenSchedule, 'heroSettled' | 'doc'> {
  doc: SpecimenDocument & HeroDocument;
  fontsReady: Promise<unknown>;
  wait: (ms: number) => Promise<void>;
}

/** The load path: wait for the fonts and the hero (or the deadline), then schedule the drawing. */
export function bootSpecimens(b: SpecimenBoot): Promise<void> {
  return scheduleSpecimens({ ...b, heroSettled: specimensReady(b.fontsReady, b.doc, b.wait) });
}

// Guarded so the drawing imports cleanly into tests, which run with no `document`.
if (typeof document !== 'undefined') {
  const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
  const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
  bootSpecimens({
    doc: document as unknown as SpecimenDocument & HeroDocument,
    fontsReady: fonts ? fonts.ready : Promise.resolve(),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    dpr: window.devicePixelRatio,
    viewportHeight: window.innerHeight,
    observe: 'IntersectionObserver' in window
      ? (callback, options) => new IntersectionObserver(callback, options) as unknown as SpecimenObserver
      : null,
    idle: (work) => {
      if (w.requestIdleCallback) w.requestIdleCallback(() => work());
      else setTimeout(work, 0);
    },
  }).catch((e: unknown) => console.warn('specimens: not drawn', e));
}
