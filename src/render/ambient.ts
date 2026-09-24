// Ambient life in the rooms: a shop sign that blinks at night, steam off the restaurant's
// kitchen pass, the cinema marquee cycling colour. A small list of emitters attached to rooms
// of those kinds, ticked on the frame with elapsed real time. Everything here is off under
// reduced motion (docs/VISUAL.md Motion): no emitters exist at all, so nothing is drawn.
//
// The timing rules and the emitter list are pure functions; createAmbient binds them to a
// pixi layer of plain sprites (no per frame Graphics).

import { Container, Sprite, Texture } from 'pixi.js';
import type { Id, RoomKind, World } from '../sim/types';
import { CINEMA_MARQUEE_COLOURS, cinemaMarquee } from './art';
import { restaurantSteamPoint, shopSignStrip } from './illustrated';
import { floorTopY } from './camera';
import { TILE_PX } from './grid';
import { PALETTE } from './palette';
import { venueOpen } from './venue';

export const SIGN_BLINK_MS = 900;
export const MARQUEE_STEP_MS = 600;
export const STEAM_RISE_MS = 1200;
export const STEAM_RISE_PX = 12;
export const STEAM_PUFFS = 3;
const STEAM_PX = 2;
const SIGN_OFF = PALETTE.detail.metalDark;
const STEAM_COLOUR = 0xffffff;

export type EmitterKind = 'sign' | 'steam' | 'marquee';

export interface AmbientEmitter {
  roomId: Id;
  kind: EmitterKind;
  /** World pixels: the strip's top left, or the steam's source point. */
  x: number;
  y: number;
  w: number;
  h: number;
}

const EMITTER_OF: Partial<Record<RoomKind, EmitterKind>> = { shop: 'sign', restaurant: 'steam', cinema: 'marquee' };

/** Where one room's emitter sits in the world, or null for a kind that has none. */
export function emitterFor(room: { id: Id; kind: RoomKind; x: number; floor: number; width: number; height: number }): AmbientEmitter | null {
  const kind = EMITTER_OF[room.kind];
  if (!kind) return null;
  const left = room.x * TILE_PX;
  const top = floorTopY(room.floor + room.height - 1); // the top of the room's highest floor band
  const w = room.width * TILE_PX;
  if (kind === 'sign') {
    const s = shopSignStrip(w);
    return { roomId: room.id, kind, x: left + s.x, y: top + s.y, w: s.w, h: s.h };
  }
  if (kind === 'marquee') {
    const m = cinemaMarquee(w);
    return { roomId: room.id, kind, x: left + m.x, y: top + m.y, w: m.w, h: m.h };
  }
  // Steam rises from the kitchen pass on the room's ground floor band.
  const p = restaurantSteamPoint(w);
  return { roomId: room.id, kind, x: left + p.x, y: floorTopY(room.floor) + p.y, w: 0, h: 0 };
}

/** Every emitter in the tower, or none at all under reduced motion. */
export function ambientEmitters(world: World, reducedMotion: boolean): AmbientEmitter[] {
  if (reducedMotion) return [];
  const out: AmbientEmitter[] = [];
  for (const room of world.rooms.values()) {
    const e = emitterFor(room);
    if (e) out.push(e);
  }
  return out;
}

/** The shop sign's strip at `elapsedMs`: lit, then dark, 900 ms each. Only ever shown at night. */
export function signLit(elapsedMs: number): boolean {
  return (Math.floor(Math.max(0, elapsedMs) / SIGN_BLINK_MS) & 1) === 0;
}

/** The marquee's colour at `elapsedMs`, stepping through three colours every 600 ms. */
export function marqueeColour(elapsedMs: number): number {
  const i = Math.floor(Math.max(0, elapsedMs) / MARQUEE_STEP_MS) % CINEMA_MARQUEE_COLOURS.length;
  return CINEMA_MARQUEE_COLOURS[i] ?? CINEMA_MARQUEE_COLOURS[0];
}

/**
 * The three steam puffs at `elapsedMs`: each rises STEAM_RISE_PX over STEAM_RISE_MS and fades
 * as it goes, a third of a cycle behind the one before, with a one pixel drift side to side.
 */
export function steamPuffs(elapsedMs: number): { dx: number; dy: number; alpha: number }[] {
  const out: { dx: number; dy: number; alpha: number }[] = [];
  for (let i = 0; i < STEAM_PUFFS; i++) {
    const t = (((Math.max(0, elapsedMs) + (i * STEAM_RISE_MS) / STEAM_PUFFS) % STEAM_RISE_MS) + STEAM_RISE_MS) % STEAM_RISE_MS / STEAM_RISE_MS;
    out.push({ dx: (i - 1) * 3 + (t > 0.5 ? 1 : 0), dy: -Math.round(t * STEAM_RISE_PX), alpha: 0.7 * (1 - t) });
  }
  return out;
}

export interface Ambient {
  /** Match the emitters to the rooms in the world. None under reduced motion. */
  sync(world: World, reducedMotion: boolean): void;
  /**
   * Advance by `dtMs` of real time; the shop signs blink only at night, and only while the shop
   * is open at game minute `minute` (venue.ts venueOpen) when one is given.
   */
  update(dtMs: number, night: boolean, minute?: number): void;
  /** How many emitters are live, for the tests. */
  count(): number;
  destroy(): void;
}

interface Live {
  emitter: AmbientEmitter;
  node: Container;
  sprites: Sprite[];
}

function strip(e: AmbientEmitter, tint: number): Sprite {
  const s = new Sprite(Texture.WHITE);
  s.position.set(e.x, e.y);
  s.setSize(e.w, e.h);
  s.tint = tint;
  return s;
}

export function createAmbient(layer: Container): Ambient {
  const live = new Map<Id, Live>();
  let clock = 0;

  function drop(id: Id): void {
    const entry = live.get(id);
    if (!entry) return;
    entry.node.destroy({ children: true });
    live.delete(id);
  }

  function same(a: AmbientEmitter, b: AmbientEmitter): boolean {
    return a.kind === b.kind && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
  }

  return {
    sync(world, reducedMotion) {
      const want = ambientEmitters(world, reducedMotion);
      const seen = new Set<Id>();
      for (const e of want) {
        seen.add(e.roomId);
        const had = live.get(e.roomId);
        if (had && same(had.emitter, e)) continue;
        if (had) drop(e.roomId);
        const node = new Container();
        const sprites: Sprite[] = [];
        if (e.kind === 'steam') {
          for (let i = 0; i < STEAM_PUFFS; i++) {
            const s = new Sprite(Texture.WHITE);
            s.setSize(STEAM_PX, STEAM_PX);
            s.tint = STEAM_COLOUR;
            sprites.push(s);
          }
        } else {
          sprites.push(strip(e, e.kind === 'sign' ? PALETTE.amber : marqueeColour(clock)));
        }
        node.addChild(...sprites);
        layer.addChild(node);
        live.set(e.roomId, { emitter: e, node, sprites });
      }
      for (const id of [...live.keys()]) if (!seen.has(id)) drop(id);
    },

    update(dtMs, night, minute) {
      const shopOpen = minute === undefined || venueOpen('shop', minute);
      if (live.size === 0) return;
      clock += Math.max(0, dtMs);
      const lit = signLit(clock);
      const colour = marqueeColour(clock);
      const puffs = steamPuffs(clock);
      for (const { emitter: e, sprites } of live.values()) {
        if (e.kind === 'sign') {
          const s = sprites[0];
          if (!s) continue;
          s.visible = night && shopOpen;
          s.tint = lit ? PALETTE.amber : SIGN_OFF;
        } else if (e.kind === 'marquee') {
          const s = sprites[0];
          if (s) s.tint = colour;
        } else {
          for (let i = 0; i < sprites.length; i++) {
            const s = sprites[i];
            const p = puffs[i];
            if (!s || !p) continue;
            s.position.set(e.x + p.dx - STEAM_PX / 2, e.y + p.dy - STEAM_PX);
            s.alpha = p.alpha;
          }
        }
      }
    },

    count() {
      return live.size;
    },

    destroy() {
      for (const id of [...live.keys()]) drop(id);
    },
  };
}
