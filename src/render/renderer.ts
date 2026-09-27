// The tower view: one pixi Application, nine layers, and a sprite pool reconciled
// against the world: cars and sims every frame, the static tower when
// world.structureVersion or the light band (light.ts) moves. See docs/DESIGN.md section 9 and docs/VISUAL.md.
//
// The renderer never mutates the world and never touches world.rng: it reads the
// world, moves sprites, and reports picks back through onPick.

// Our CSP (public/_headers, deploy/nginx.conf) has no 'unsafe-eval' in script-src.
// PixiJS 8 compiles shader/uniform code with `new Function` unless this CSP-safe
// module is loaded first, so it must be the first import, before any Application
// is created (both the game and the landing hero go through createRenderer here).
import 'pixi.js/unsafe-eval';
import {
  Application,
  Container,
  isWebGLSupported,
  isWebGPUSupported,
  Graphics,
  Particle,
  ParticleContainer,
  Rectangle,
  Sprite,
  Texture,
  type Renderer as PixiRenderer,
} from 'pixi.js';
import { stressBand } from '../sim/people';
import { ROOMS, STORY } from '../sim/rules';
import { clockOf, spanFloors, spanTop, TOWER_WIDTH, type Car, type Id, type Room, type RoomKind, type Shaft, type ShaftKind, type Sim, type SimKind, type StressBand, type World } from '../sim/types';
import { roomsOnFloor, shaftAt } from '../sim/world';
import {
  bakeResolution,
  CAR_CLEAR_PX,
  createArt,
  FLOOR_PX,
  LINE_PX,
  OVERLAY_KINDS,
  shaftPieces,
  SIM_H,
  SIM_W,
  SLAB_PX,
  TEXTURE_SIZE,
  TILE_PX,
  VENUE_SHELL,
  hasWindowBand,
  type Art,
  type CrowdAtlas,
} from './art';
import {
  createCamera,
  floorBand,
  floorBaseY,
  floorTopY,
  floorYFloat,
  openingGroundLine,
  xToTile,
  yToFloor,
  type Camera,
} from './camera';
import {
  classifyPress,
  isTap,
  pinchGesture,
  PRESS_SLOP_PX,
  TOUCH_SLOP_PX,
  wheelGesture,
  type FingerPair,
  type Point,
} from './input';
import { createAmbient } from './ambient';
import {
  DOOR_FRAMES,
  doorFrameOf,
  FRAME,
  isStepping,
  PERSON_FRAME_COUNT,
  poseAt,
  stepDoor,
  type DoorFrame,
  type PersonFrame,
  type Pose,
} from './anim';
import { createCurb, lobbyDoors } from './curb';
import { placePerson, type PersonSprites } from './person';
import {
  bodyOf,
  LOOK_CODES,
  lookCode,
  MARK_H,
  MARK_W,
  markBottomAboveFeet,
  PROP_SIZE,
  personLookCode,
  propPlacement,
  stressMarkOf,
  type PropKind,
  type StressMark,
} from './figure';
import { bakesAtStructuralScale, DECOR, INTERIORS, interiorFlip, interiorOpen, interiorVariant, interiorVariants, lookOf as interiorLook } from './interiors';
import { INTERIOR_TOP, WALL_SHADOW_PX, WIN_PANE, WIN_PANE_TOP, WIN_PANE_X, WIN_SILL, WIN_TOP } from './grid';
import { layerPlan, zoomTier, type LayerPlan, type ZoomTier } from './hierarchy';
import {
  carFinishes,
  carIndicator,
  POOL_ALPHA,
  POOL_H,
  POOL_STEP,
  POOL_TINT,
  POOL_W,
  SIGN_DARK_TINT,
  SIGN_GLOW_TINT,
  signBoard,
  type SignState,
} from './illustrated';
import { PALETTE, shade } from './palette';
import { isVenueKind, venueOf, type Venue } from './venue';
import { createBuildFx, priceLabel, type RevealBand } from './buildfx';
import { carFloorLabel, drawCarIndicator } from './led';
import { Motion, TELEPORT_TILES } from './interpolate';
import { floorsWithPeople, inLightWindow, LIGHT_ALPHA, lightBand, lightTintAt, NIGHT_GRADE, roomNight, windowStateOf, windowStatesFor, type WindowState } from './light';
import { createOverlayPass, drawBlocks, type OverlayKind, type ViewRect } from './overlays';
import { createSky, isNight, nightness, skyBackground, type Sky } from './sky';
import { easeView, publishWeatherView, settledView, weatherLightTint, weatherNow, weatherSkyColor, type Rect as WeatherRect } from './weather';
import { basementSpanOf, createWeatherFx, floorRectsOf } from './weatherfx';
import { createThumbnails, type ThumbnailKind } from './thumbnail';

export interface PickHit {
  roomId?: Id;
  simId?: Id;
  shaftId?: Id;
  floor: number;
  x: number;
}

export interface Ghost {
  widthTiles: number;
  heightFloors: number;
  floor: number;
  x: number;
  ok: boolean;
  /** Set when the ghost is an elevator: the overlay pass bands the floors it will stop at. */
  shaft?: ShaftKind;
}

export interface Selection {
  roomId?: Id;
  simId?: Id;
  shaftId?: Id;
}

export interface Renderer {
  /** Draw the world; alpha in [0, 1] is how far each moving thing is from its commit to its target. */
  render(world: World, alpha: number): void;
  /**
   * Snapshot every drawn sim and car where it stands now. The game calls this immediately before
   * the last tick of a batch, so the next render lerps across that one tick.
   */
  commitMotion(world: World): void;
  /** Forget every snapshot, for a world that was replaced (a load, a new game). */
  resetMotion(): void;
  /**
   * The guide's translucent amber band over where the next step can be built, in floors and
   * tiles (both ends inclusive), drawn in the overlay layer under the ghost. Null clears it.
   */
  setGuideBand(band: { floorMin: number; floorMax: number; xMin: number; xMax: number } | null): void;
  /**
   * Tint every room by one of the information views (src/render/overlays.ts), or none. Drawn
   * every frame while on, outside the structure-version gate; off costs one branch a frame.
   */
  setOverlay(kind: OverlayKind | null): void;
  /** The information views in the color-blind friendly ramp, worst step striped. Render only. */
  setOverlayColorBlind(on: boolean): void;
  camera: Camera;
  screenToTile(sx: number, sy: number): { floor: number; x: number };
  setGhost(g: null | Ghost): void;
  /**
   * The ghost's box in CSS pixels relative to the view element, or null with no ghost.
   *
   * The ui hangs the placement chip and the placement bar off this. A camera pan or a pinch
   * moves it without notifying anyone, so the ui reads it on a frame loop while it lasts.
   */
  ghostScreenRect(): { x: number; y: number; w: number; h: number } | null;
  /**
   * The selection ring's box as the last frame drew it, in CSS pixels relative to the view
   * element, or null when no ring was drawn (nothing selected, or a person the frame did not
   * draw). A new selection answers null until a frame has drawn it. The ui keeps the selection
   * clear of the card open beside it with this (D-23).
   */
  selectionScreenRect(): { x: number; y: number; w: number; h: number } | null;
  setSelection(sel: null | Selection): void;
  onPick(cb: (hit: PickHit) => void): void;
  /** Off for the landing hero: no pointer gesture pans. */
  setPanEnabled(on: boolean): void;
  /** On while the held tool draws with the left drag (lobby paint, shaft span), so it does not pan. */
  setToolOwnsDrag(on: boolean): void;
  setReducedMotion(on: boolean): void;
  /**
   * How many screen pixels the chrome covers at the top and the bottom of the view.
   *
   * The ui measures its own strips and hands the numbers over, so the camera can aim at the
   * part of the screen the player can see. Until the player moves the view themselves, this
   * re-frames the opening shot around the new band.
   */
  setChrome(topPx: number, bottomPx: number): void;
  /** A still image of the current view, for sharing. Throws if extraction fails. */
  snapshot(): HTMLCanvasElement;
  destroy(): void;
  /** The daytime art of a room or shaft kind as a canvas for the palette, extracted once per kind. */
  thumbnail(kind: ThumbnailKind): HTMLCanvasElement;
}

/**
 * Connectors are drawn above the rooms they cover. Stairs and escalators are rooms, so
 * they need their own layer over the room layer; a shaft has one already. See build.ts:
 * a connector may share tiles with any room, in either order.
 */
export function drawsOverRooms(kind: RoomKind): boolean {
  return OVERLAY_KINDS.has(kind);
}

/**
 * The room a click lands on. Where a connector overlays another room both cover the
 * tile, so the pick follows the picture: the connector is on top, so it is the one the
 * player means. Two flights may cover one tile (a flight based on floor 2 and one based on
 * floor 3 share floor 3); their sprites are made in id order, so the highest id is drawn on
 * top and is the one picked.
 */
export function pickRoomAt(world: World, floor: number, x: number): Room | undefined {
  let found: Room | undefined;
  for (const room of roomsOnFloor(world, floor)) {
    if (x < room.x || x >= room.x + room.width) continue;
    if (!found) {
      found = room;
      continue;
    }
    const over = drawsOverRooms(room.kind);
    const foundOver = drawsOverRooms(found.kind);
    if (over && (!foundOver || room.id > found.id)) found = room;
  }
  return found;
}

/**
 * The room or shaft a click lands on, in the order the picture stacks them and the hover
 * card reads them (src/ui/hover.ts hoverTargetAt): stairs and escalators, then shafts, then
 * the rooms behind them. A shaft may stand in front of any room, so a pick that put rooms
 * first would leave an elevator with an office behind every floor with no panel to open.
 * A lobby tile under a shaft is reached from the lobby tile beside it.
 */
export function pickTargetAt(world: World, floor: number, x: number): { roomId: Id } | { shaftId: Id } | null {
  const room = pickRoomAt(world, floor, x);
  if (room && drawsOverRooms(room.kind)) return { roomId: room.id };
  const shaft = shaftAt(world, floor, x);
  if (shaft) return { shaftId: shaft.id };
  return room ? { roomId: room.id } : null;
}

const SIM_WIDTH_PX = SIM_W; // one tile wide, matching art.ts
const SIM_HEIGHT_PX = SIM_H; // three tiles tall
const PARTICLE_THRESHOLD = 500;
const PARTICLE_RELEASE = 400; // hysteresis, so a crowd on the edge does not thrash
/**
 * Crowd mode draws props and stress marks too, at three quarters of their size (package 8b):
 * they come from a strip in the crowd atlas, so they cost one small row of it and nothing else.
 */
export const CROWD_EXTRA_SCALE = 0.75;
/** How long a mouse press may hold still and still count as a click. A finger gets no limit. */
const CLICK_MS = 600;
const FIRE_FLICKER_MS = 110;
const LOAD_FADE_MS = 900;
/** The load fade opens out of the chrome's steel, never black (D-2). */
const FADE_COLOR = 0x1c232e;
const SLAB_TOP_PX = SLAB_PX; // art.ts draws the slab as the bottom SLAB_PX of a floor band
const STRIP_ABOVE = 0xeaeaea;
/** A basement floor's tone, in the floor strips and on the far facade below the street. */
export const STRIP_BELOW = 0x7d818a;
const STRIP_EDGE = 0x333333;
const STRIP_CEILING = 0xcfcfcf;
const TELEPORT_PX = TELEPORT_TILES * TILE_PX; // a jump past this in one tick is a teleport, so snap instead of lerp
/** The selection ring's weight and its gap around a sim, two art lines so it reads at zoom 1. */
const SELECT_PAD_PX = 2 * LINE_PX;
const FRAME_GRACE_MS = 2000; // after this the opening framing never reasserts itself
const CABLE_PX = LINE_PX; // the hoist cable, one art line wide
/** D-18: a car sits 1 px low for the first half of this after its doors open. */
const CAR_SETTLE_MS = 120;
const CABLE_COLOR = 0x3b3f47;
const NO_FLOORS: ReadonlySet<number> = new Set<number>();
/** A room on fire is tinted this, day or night. */
const FIRE_TINT = 0xff8a72;

// D-4: what gives light at night, drawn on the emissive layer over the light layer's multiply.
/** A lit pane and its pale header (VISUAL.md windows), and the housekeeping lamp at 55 percent. */
const LIT_PANE = PALETTE.windowLit;
const LIT_HEADER = PALETTE.carLight;
const LAMP_ALPHA = 0.55;
/** The soft band of warm light behind a lit floor's panes. */
const HALO_ALPHA = 0.12;
/** A lit sign's added glow. */
const SIGN_GLOW_ALPHA = 0.8;

// BB-2: the far zoom facade.
/** The facade's wall, one band per built floor. */
export const FACADE_WALL = 0xdfe6ee;
/**
 * A shaft on the facade: a faint strip a step darker than the wall, so the column reads without
 * blocking the view behind it. The cars keep drawing over it at full strength.
 */
export const FACADE_SHAFT = 0xc4ccd6;
/** The shaft layer's alpha under the Districts view: a faint column between the category blocks. */
export const DISTRICTS_SHAFT_ALPHA = 0.3;
/** One facade pane per two tiles, as wide as two tiles' panes and the mullions between them. */
export const FACADE_PANE_W = 2 * WIN_PANE + 2 * LINE_PX;
/** The facade's slab line, one art line of ink at the top of each floor's slab. */
const FACADE_SLAB = 0x222222;

/**
 * Every room's shell is plain (package 8b): its furniture, signs, shutters and lighting are
 * illustrated layers on top (interiors.ts), which pick their own variant (interiorVariant).
 */
function roomVariant(_room: Room): number {
  return VENUE_SHELL;
}

/**
 * Bake every window state for every room shape in the tower, once, at boot, so the first
 * dusk swaps textures instead of baking hundreds of them mid play. Exported for the test.
 */
export function bakeRoomStates(art: Art, world: World): number {
  const seen = new Set<string>();
  let baked = 0;
  for (const room of world.rooms.values()) {
    const variant = roomVariant(room);
    const key = `${room.kind}|${room.width}|${room.height}|${variant}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const state of windowStatesFor(room.kind)) {
      art.room(room.kind, room.width, room.height, variant, state);
      baked++;
    }
  }
  return baked;
}

const SIM_KINDS: readonly SimKind[] = ['worker', 'resident', 'guest', 'shopper', 'diner', 'staff', 'visitor', 'vip', 'guard', 'collector', 'thief'];

/**
 * A numeric stand-in for a person sprite's `${kind}|${frame}|${look}` key, cheap to build every
 * frame. Stress is not in it: stress is a mark over the head, not a different person.
 */
export function simKeyOf(kind: SimKind, frame: PersonFrame, look: number): number {
  return (SIM_KINDS.indexOf(kind) * PERSON_FRAME_COUNT + frame) * LOOK_CODES + look;
}

/**
 * The crowd atlas (art.ts crowd) stays inside ATLAS_BUDGET_PX device pixels on a side at a device
 * pixel ratio of 2: 8 kinds by 8 look keys is 64 cells of 16 px, 1024 css px, 2048 device px
 * wide; 5 builds by stand and stride is 10 rows of 48 px, 960 device px tall.
 */
export const ATLAS_BUDGET_PX = 2048;

/**
 * What a drawn person is doing, for the walk cycle, the waiting weight shift and glance, and the
 * activity pose inside a room. A walker walks only while it is actually moving (`stepping`);
 * stopped, it stands. A waiter turns impatient once the wait passes STORY.longWaitMinutes.
 */
export function poseOf(sim: Sim, stepping: boolean, minute: number, roomKind?: RoomKind): Pose {
  if (sim.state === 'walking' || sim.state === 'leaving') return stepping ? 'walk' : 'still';
  if (sim.state === 'waiting') {
    return sim.waitStart !== null && minute - sim.waitStart > STORY.longWaitMinutes ? 'impatient' : 'wait';
  }
  if (sim.state === 'inRoom' && roomKind) return ACTIVITY[roomKind] ?? 'still';
  return 'still';
}

// Flat colors for the fallback art, muted per VISUAL's world palette.
const FALLBACK_ROOM_COLORS: Record<RoomKind, number> = {
  lobby: 0x6d6552,
  skyLobby: 0x7a7159,
  stairs: 0x4a4e57,
  escalator: 0x56606e,
  office: 0x3f5a72,
  condo: 0x6b5570,
  hotelSingle: 0x7a5a4a,
  hotelTwin: 0x805f4d,
  hotelSuite: 0x8a6a52,
  fastFood: 0x8a4a42,
  restaurant: 0x7a4a56,
  shop: 0x4a7a6a,
  cinema: 0x4a4a7a,
  partyHall: 0x7a6a3a,
  medical: 0x5f7a7a,
  security: 0x3a4a5a,
  housekeeping: 0x5a6a4a,
  parkingRamp: 0x40444c,
  parkingSpace: 0x4a4e57,
  recycling: 0x3f5a46,
  metro: 0x3a4655,
  cathedral: 0x6a6a86,
};

const FALLBACK_BAND_COLORS: Record<StressBand, number> = {
  calm: 0x101010,
  pink: 0xff9ad5,
  red: 0xff4d4d,
};

interface RoomEntry {
  node: Sprite;
  kind: RoomKind;
  width: number;
  height: number;
  variant: number;
  state: WindowState;
}

interface SlabEntry {
  node: Sprite;
  width: number;
}

interface ShaftEntry {
  /** The shaft as a stack of pieces, top first (art.ts shaftPieces), so no texture passes the GPU limit. */
  parts: Sprite[];
  kind: ShaftKind;
  floors: number;
}

interface CarEntry {
  node: Sprite;
  /** The floor indicator: the floor and a direction arrow in lit segments, redrawn on change. */
  indicator: Graphics;
  indicatorKey: string;
  /** The hoist cable from the car's roof to the top of the shaft, a 2 px line scaled to length. */
  cable: Graphics;
  kind: ShaftKind;
  /** The shaft's car finish (illustrated.ts carFinishes). */
  finish: number;
  /** Where the doors are, 0 closed to 1 open, tweened on the frame loop. */
  door: number;
  /** The baked door frame the sprite shows now. */
  frame: DoorFrame;
  /** The sim's car state asks for open doors. */
  open: boolean;
  /** Set when the sim opens the doors, cleared once they are fully open: a one tick flap still opens them all the way. */
  latch: boolean;
  /** D-18: ms left of the arrival settle; the car sits 1 px low while more than 60 remain. */
  settle: number;
}

interface SimEntry extends PersonSprites {
  node: Sprite;
  simKey: number;
  /** The stress mark over the head, made the first time the person is stressed. */
  mark: Sprite | null;
  markKind: StressMark;
}

/** A room's illustrated layers over its shell (interiors.ts), and the state they last showed. */
interface VenueEntry {
  kind: RoomKind;
  width: number;
  floors: number;
  /** The room's variant (interiors.ts interiorVariants) and whether it is drawn mirrored. */
  variant: number;
  flip: boolean;
  /** The brand and treatment, for an office, shop or restaurant; null for every other kind. */
  venue: Venue | null;
  fixtures: Sprite;
  /** The look's plants, pets, frames and counter fronts; its painted wall. */
  decor: Container | null;
  wall: Container | null;
  sign: Sprite | null;
  signGlow: Sprite | null;
  /** D-4: the same sign face again on the emissive layer, shown while the sign is lit. */
  signLit: Sprite | null;
  closed: Sprite | null;
  pool: Container | null;
  staff: Sprite | null;
  state: string;
  /** D-4: the tint the room's shell takes (the night grade, or fire), for the layers made later. */
  grade: number;
  /** The room's top left, world px, for the layers made later (the shutter, the staff). */
  x: number;
  y: number;
}

/** Which rooms sit people down or have them browse, for the activity pose. */
const ACTIVITY: Partial<Record<RoomKind, Pose>> = {
  office: 'sit',
  restaurant: 'sit',
  fastFood: 'sit',
  shop: 'browse',
  condo: 'sit',
  cinema: 'sit',
  medical: 'sit',
};

/** The venue clock: closed-hours state is looked at again every this many game minutes. */
const VENUE_CLOCK_MINUTES = 10;
/** Person textures nobody shows and nobody has asked for in PERSON_IDLE_MS are freed this often. */
const SWEEP_EVERY_MS = 2000;
const PERSON_IDLE_MS = 4000;
/** Far zoom blocks are redrawn this often, in real ms, so their occupancy fill stays current. */
const BLOCKS_REFRESH_MS = 400;

function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): Texture {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const ctx = canvas.getContext('2d');
    if (!ctx) return Texture.WHITE;
    draw(ctx);
    const texture = Texture.from(canvas);
    texture.source.scaleMode = 'nearest';
    return texture;
  } catch {
    return Texture.WHITE;
  }
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

// The fallback's window band, on the same grid as art.ts: a pane a tile, inset by the outline.
const WIN_X = 3 * LINE_PX;
const WIN_Y = 3 * LINE_PX;
const WIN_W = TILE_PX / 2;

/**
 * Flat colored rectangles, used when WebGL is unavailable or the real art module
 * cannot be built. Drawn on a 2d canvas so it works without a GPU.
 */
export function fallbackArt(_renderer: PixiRenderer | null): Art {
  const cache = new Map<string, Texture>();
  const get = (key: string, make: () => Texture): Texture => {
    let texture = cache.get(key);
    if (!texture) {
      texture = make();
      cache.set(key, texture);
    }
    return texture;
  };

  return {
    room(kind, width, height, variant, state) {
      return get(`room|${kind}|${width}|${height}|${variant}|${state}`, () =>
        canvasTexture(width * TILE_PX, height * FLOOR_PX, (ctx) => {
          const base = FALLBACK_ROOM_COLORS[kind] ?? 0x3a4556;
          const line = LINE_PX;
          // A connector is an overlay here too: a diagonal and an outline, no backing fill.
          if (drawsOverRooms(kind)) {
            ctx.strokeStyle = hex(base);
            ctx.lineWidth = 2 * line;
            ctx.beginPath();
            ctx.moveTo(2 * line, ctx.canvas.height - SLAB_PX);
            ctx.lineTo(ctx.canvas.width - 2 * line, SLAB_PX);
            ctx.stroke();
            ctx.lineWidth = line;
            ctx.strokeStyle = hex(0x1c232e);
            ctx.strokeRect(line / 2, line / 2, ctx.canvas.width - line, ctx.canvas.height - line);
            return;
          }
          ctx.fillStyle = hex(base);
          ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
          ctx.fillStyle = hex(state === 'lit' ? 0xffd27a : state === 'day' ? 0x7fb6e0 : 0x1a2233);
          // one window a tile, the same band art.ts draws
          for (let wx = WIN_X; wx + WIN_W <= ctx.canvas.width - WIN_X; wx += TILE_PX) {
            ctx.fillRect(wx, WIN_Y + (variant % 2) * line, WIN_W, WIN_W);
          }
          ctx.lineWidth = line;
          ctx.strokeStyle = hex(0x1c232e);
          ctx.strokeRect(line / 2, line / 2, ctx.canvas.width - line, ctx.canvas.height - line);
        }),
      );
    },
    slab(widthTiles) {
      return get(`slab|${widthTiles}`, () =>
        canvasTexture(TEXTURE_SIZE.slab(widthTiles).width, TEXTURE_SIZE.slab(widthTiles).height, (ctx) => {
          ctx.fillStyle = hex(0x2f3238);
          ctx.fillRect(0, 0, ctx.canvas.width, SLAB_PX);
          ctx.fillStyle = hex(0x4a4e57);
          ctx.fillRect(0, 0, ctx.canvas.width, LINE_PX);
        }),
      );
    },
    shaft(kind, floors) {
      return get(`shaft|${kind}|${floors}`, () =>
        canvasTexture(TEXTURE_SIZE.shaft(kind, floors).width, floors * FLOOR_PX, (ctx) => {
          ctx.fillStyle = hex(kind === 'express' ? 0x232b38 : kind === 'service' ? 0x1e242e : 0x242c3a);
          ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
          ctx.fillStyle = hex(0x3a4556);
          ctx.fillRect(0, 0, 2 * LINE_PX, ctx.canvas.height);
          ctx.fillRect(ctx.canvas.width - 2 * LINE_PX, 0, 2 * LINE_PX, ctx.canvas.height);
        }),
      );
    },
    car(kind, door) {
      const doorsOpen = door >= 0.5;
      return get(`car|${kind}|${doorsOpen}`, () =>
        canvasTexture(TEXTURE_SIZE.car(kind).width, TEXTURE_SIZE.car(kind).height, (ctx) => {
          const line = LINE_PX;
          ctx.fillStyle = hex(0x8b93a3);
          ctx.fillRect(0, 2 * line, ctx.canvas.width, ctx.canvas.height - 4 * line);
          ctx.fillStyle = hex(doorsOpen ? 0xffd27a : 0x28313f);
          ctx.fillRect(3 * line, 5 * line, ctx.canvas.width - 6 * line, ctx.canvas.height - 10 * line);
        }),
      );
    },
    sim(_kind, band, frame) {
      return get(`sim|${band}|${frame}`, () =>
        canvasTexture(SIM_WIDTH_PX, SIM_HEIGHT_PX, (ctx) => {
          ctx.fillStyle = hex(FALLBACK_BAND_COLORS[band]);
          const u = SIM_WIDTH_PX / 8; // the figure is eight units wide
          ctx.fillRect(2 * u, 2 * u, 4 * u, 3 * u); // head
          ctx.fillRect((frame === 0 ? 2 : frame === 1 ? 1 : 3) * u, 5 * u, 4 * u, SIM_HEIGHT_PX - 5 * u); // body and legs, a unit over on the step
        }),
      );
    },
    ghost(widthTiles, heightFloors, ok) {
      return get(`ghost|${widthTiles}|${heightFloors}|${ok}`, () =>
        canvasTexture(widthTiles * TILE_PX, heightFloors * FLOOR_PX, (ctx) => {
          ctx.fillStyle = ok ? 'rgba(244,185,66,0.30)' : 'rgba(255,92,77,0.30)';
          ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
          ctx.strokeStyle = ok ? hex(0xf4b942) : hex(0xff5c4d);
          ctx.lineWidth = 2 * LINE_PX;
          ctx.strokeRect(LINE_PX, LINE_PX, ctx.canvas.width - 2 * LINE_PX, ctx.canvas.height - 2 * LINE_PX);
        }),
      );
    },
  };
}

/**
 * Wraps the real art module so a throw from any one call degrades to the fallback. The
 * illustrated extras are optional: an Art without one draws none of it, and one that throws
 * turns the extras off (an empty texture) without taking the whole tower down with it.
 */
function guardArt(primary: Art, backup: Art): Art {
  let broken = false;
  let extrasBroken = false;
  const call = <T extends keyof Art>(name: T, run: (art: Art) => Texture): Texture => {
    if (!broken) {
      try {
        return run(primary);
      } catch (error) {
        broken = true;
        console.warn(`render: art.${String(name)} failed, falling back to flat rectangles`, error);
      }
    }
    return run(backup);
  };
  const extra = <A extends unknown[]>(name: string, fn: (...args: A) => Texture): ((...args: A) => Texture) => {
    return (...args: A): Texture => {
      if (!broken && !extrasBroken) {
        try {
          return fn(...args);
        } catch (error) {
          extrasBroken = true;
          console.warn(`render: art.${name} failed, the illustrated extras are off`, error);
        }
      }
      return Texture.EMPTY;
    };
  };
  const guarded: Art = {
    room: (kind, width, height, variant, state) => call('room', (a) => a.room(kind, width, height, variant, state)),
    slab: (widthTiles) => call('slab', (a) => a.slab(widthTiles)),
    shaft: (kind, floors) => call('shaft', (a) => a.shaft(kind, floors)),
    car: (kind, door, finish) => call('car', (a) => a.car(kind, door, finish)),
    sim: (kind, band, frame, outfit) => call('sim', (a) => a.sim(kind, band, frame, outfit)),
    ghost: (widthTiles, heightFloors, ok) => call('ghost', (a) => a.ghost(widthTiles, heightFloors, ok)),
  };
  const p = primary;
  if (p.venue) guarded.venue = extra('venue', p.venue);
  if (p.interior) guarded.interior = extra('interior', p.interior);
  if (p.decor) guarded.decor = extra('decor', p.decor);
  if (p.shut) guarded.shut = extra('shut', p.shut);
  if (p.sign) guarded.sign = extra('sign', p.sign);
  if (p.closed) guarded.closed = extra('closed', p.closed);
  if (p.glow) guarded.glow = extra('glow', p.glow);
  if (p.prop) guarded.prop = extra('prop', p.prop);
  if (p.mark) guarded.mark = extra('mark', p.mark);
  if (p.umbrella) guarded.umbrella = extra('umbrella', p.umbrella);
  if (p.vehicle) guarded.vehicle = extra('vehicle', p.vehicle);
  if (p.crowd) {
    const crowd = p.crowd;
    guarded.crowd = () => (broken ? null : crowd());
  }
  if (p.stats) guarded.stats = p.stats;
  if (p.sweep) guarded.sweep = p.sweep;
  if (p.dropGhosts) guarded.dropGhosts = p.dropGhosts;
  return guarded;
}

/** Floors a shaft actually spans, remembering that floor 0 does not exist. */
function shaftFloorSpan(shaft: Shaft): number {
  return floorBand(shaft.floorMax) - floorBand(shaft.floorMin) + 1;
}

/**
 * The built extent of every floor: from the leftmost to the rightmost tile covered
 * by a room or by a shaft spanning that floor. The renderer paints a continuous
 * floor across it, so a sim standing in a gap is never on nothing. `max` is the
 * exclusive right tile. Floor 0 does not exist and never appears.
 */
export function builtFloorExtents(world: World): Map<number, { min: number; max: number }> {
  const extents = new Map<number, { min: number; max: number }>();
  const cover = (floor: number, from: number, to: number): void => {
    if (floor === 0) return;
    const found = extents.get(floor);
    if (!found) extents.set(floor, { min: from, max: to });
    else {
      if (from < found.min) found.min = from;
      if (to > found.max) found.max = to;
    }
  };
  for (const room of world.rooms.values()) {
    // spanFloors skips the floor that does not exist: a flight based at B1 covers B1 and 1.
    for (const f of spanFloors(room.floor, room.height)) cover(f, room.x, room.x + room.width);
  }
  for (const shaft of world.shafts.values()) {
    for (let f = shaft.floorMin; f <= shaft.floorMax; f++) cover(f, shaft.x, shaft.x + shaft.width);
  }
  return extents;
}

/** World y a sim's feet rest on: the top of its floor's slab. */
export function simFeetY(floor: number): number {
  return floorBaseY(floor) - SLAB_TOP_PX;
}

export function simIsVisible(sim: Sim): boolean {
  // A riding sim is inside the car, which draws itself.
  return sim.state !== 'gone' && sim.state !== 'outside' && sim.state !== 'riding' && sim.inCarId === null;
}

/** One sim in four gets a sprite. The simulation runs every sim; the screen shows a
 *  sample, so a full lobby reads as busy rather than as a swarm, and a player who is
 *  sensitive to motion is not looking at hundreds of walkers at once. Chosen by id so
 *  a sim is either always drawn or never drawn, no popping. The tower's recurring
 *  characters, few by nature, are always drawn: the guards at their posts, the collectors,
 *  the VIP and the thief (package 8b). Housekeepers stay in the sample: a hotel's six would
 *  cost more person textures than the budget has room for. */
export const CROWD_ONE_IN = 4;
export const ALWAYS_DRAWN: ReadonlySet<SimKind> = new Set<SimKind>(['guard', 'collector', 'vip', 'thief']);
export function inCrowd(sim: Sim): boolean {
  return sim.id % CROWD_ONE_IN === 0 || ALWAYS_DRAWN.has(sim.kind);
}

/** How far from the tap, in tiles, a sim still counts as the thing that was tapped. */
export const PICK_RADIUS_TILES = 1.5;

/**
 * The sim a tap lands on, or null. Only a sim the screen actually draws can be picked:
 * a tap must never select someone the crowd sample left out, or the panel would open on
 * a person who is not there. On a floor, within the pick radius, newest wins because the
 * newest sim draws on top. Pure and exported so the rule is testable without a GPU.
 *
 * `drawnAt`, when given, is where the last frame drew each person (renderer: recorded in
 * reconcileSims): only a sim in it can be picked, and it is picked where it is drawn, so a
 * person at a desk is picked at the desk and not at the middle of the room (sim.pos.x).
 */
export function pickSimAt(
  sims: Iterable<Sim>,
  floor: number,
  tileFloat: number,
  sample = true,
  drawnAt?: ReadonlyMap<Id, DrawPoint>,
): Sim | null {
  let best: Sim | null = null;
  for (const sim of sims) {
    if (!simIsVisible(sim) || (sample && !inCrowd(sim))) continue;
    let simFloor = sim.pos.floor;
    let simX = sim.pos.x;
    if (drawnAt) {
      const at = drawnAt.get(sim.id);
      if (!at) continue;
      simFloor = at.floor;
      simX = at.x / TILE_PX;
    }
    if (simFloor !== floor) continue;
    if (Math.abs(simX - tileFloat) > PICK_RADIUS_TILES) continue;
    if (!best || sim.id > best.id) best = sim;
  }
  return best;
}

/** Where a person was drawn: feet at (x, y) in world px, standing on `floor`. */
export interface DrawPoint {
  x: number;
  y: number;
  floor: number;
}

/** Only these states move across the floor, so only these interpolate and animate. */
export function simMoves(sim: Sim): boolean {
  return sim.state === 'walking' || sim.state === 'waiting' || sim.state === 'leaving';
}

/**
 * A fixed spot inside the room for a sim that is staying put: one slot pitch apart in
 * id order, clamped inside the room. Stable between frames, so no jitter.
 */
export function inRoomSlot(world: World, sim: Sim, slots: Map<Id, number>): [number, number] {
  const room = sim.inRoomId === null ? undefined : world.rooms.get(sim.inRoomId);
  if (!room) return [sim.pos.x * TILE_PX, simFeetY(sim.pos.floor)];
  const index = slots.get(room.id) ?? 0;
  slots.set(room.id, index + 1);
  // Spread occupants across the room instead of stacking them on the first desk: slot pitch is the
  // room width divided by its capacity, at least one tile now that a sim is one tile wide, so an
  // office's six workers sit one per desk area across its nine tiles.
  const right = room.x + room.width - 1;
  const capacity = Math.max(1, ROOMS[room.kind].capacity || 1);
  const pitch = Math.max(1, Math.floor((room.width - 2) / capacity));
  const tile = Math.max(room.x, Math.min(room.x + 1 + index * pitch, right));
  const inside = sim.pos.floor >= room.floor && sim.pos.floor < room.floor + room.height;
  return [tile * TILE_PX, simFeetY(inside ? sim.pos.floor : room.floor)];
}

/**
 * 'sample' draws one sim in four (the game); 'all' draws every sim (the landing hero's hand-built crowd).
 * fadeIn, default true: the view opens behind a cover in the chrome's steel that fades once the
 * first frame is drawn; false shows no cover at all.
 */
export type RendererOptions = { crowd?: 'sample' | 'all'; fadeIn?: boolean };

/**
 * BB-1: the game opens on the whole tower at OPENING_ZOOM when it fits the free band, and the
 * player zooms in. False restores the zoom 1 opening (D-1's framing) for every tower.
 */
export const OPENING_WHOLE_TOWER = true;
export const OPENING_ZOOM = 0.5;

/** The built tower's floor span: its top floor (D-1) and its lowest floor, 1 with no basement. */
export function towerSpan(world: World): { top: number; bottom: number; built: boolean } {
  let top = 1;
  let bottom = 1;
  for (const room of world.rooms.values()) {
    top = Math.max(top, room.floor + room.height - 1);
    bottom = Math.min(bottom, room.floor);
  }
  for (const shaft of world.shafts.values()) {
    top = Math.max(top, shaft.floorMax);
    bottom = Math.min(bottom, shaft.floorMin);
  }
  return { top, bottom, built: world.rooms.size + world.shafts.size > 0 };
}

/**
 * BB-1's opening, or null when the tower does not fit: the ground line fraction that puts the
 * middle of the tower (its top floor down to its lowest basement) in the middle of a free band
 * `bandPx` tall at OPENING_ZOOM. It fits when the tower and one floor of sky over it do.
 */
export function wholeTowerGroundLine(top: number, bottom: number, bandPx: number): number | null {
  const roof = floorTopY(top);
  const base = floorBaseY(bottom);
  if (!(bandPx > 0) || (base - roof + FLOOR_PX) * OPENING_ZOOM > bandPx) return null;
  const middle = (roof + base) / 2;
  return 0.5 - (middle * OPENING_ZOOM) / bandPx;
}

/** A run of lobby or sky lobby tiles side by side on one floor, in tiles: x to end (exclusive). */
export interface LobbyRun {
  floor: number;
  height: number;
  x: number;
  end: number;
}

/**
 * Lobby and sky lobby rooms grouped into runs by floor and height, where the next room starts
 * at the run's end (D-11). The renderer outlines each run once, as the one hall the player sees.
 */
export function lobbyRuns(rooms: Iterable<Room>): LobbyRun[] {
  const groups = new Map<string, Room[]>();
  for (const room of rooms) {
    if (room.kind !== 'lobby' && room.kind !== 'skyLobby') continue;
    const key = `${room.floor}|${room.height}`;
    const group = groups.get(key);
    if (group) group.push(room);
    else groups.set(key, [room]);
  }
  const runs: LobbyRun[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.x - b.x);
    let run: LobbyRun | null = null;
    for (const room of group) {
      if (run && room.x === run.end) {
        run.end = room.x + room.width;
        continue;
      }
      run = { floor: room.floor, height: room.height, x: room.x, end: room.x + room.width };
      runs.push(run);
    }
  }
  return runs;
}

/** A lobby run's two end lines and its shadow face, one per floor, in world px (D-11). */
function drawLobbyRun(g: Graphics, run: LobbyRun): void {
  const xl = run.x * TILE_PX;
  const xr = run.end * TILE_PX;
  const y = floorTopY(run.floor + run.height - 1);
  const h = run.height * FLOOR_PX;
  g.rect(xl, y, 2, h).fill(0x222222);
  g.rect(xr - 2, y, 2, h).fill(0x222222);
  for (let f = 0; f < run.height; f++) g.rect(xr - 10, y + f * FLOOR_PX + 22, 8, 44).fill(0xd7d7d4);
}

export async function createRenderer(
  container: HTMLElement,
  world: World,
  options: RendererOptions = {},
): Promise<Renderer> {
  // PixiJS 8 resolves init even when no GPU context can be made, which leaves a working HUD
  // over a blank stage. Refuse up front so main.ts can show the plain-language message instead.
  // false: a software WebGL (a VM, a remote desktop) is slow but plays; only no context refuses.
  if (!isWebGLSupported(false) && !(await isWebGPUSupported())) {
    throw new Error('This browser cannot draw the tower. WebGL is required.');
  }
  const sampleCrowd = options.crowd !== 'all';
  function drawn(sim: Sim): boolean {
    return simIsVisible(sim) && (!sampleCrowd || inCrowd(sim));
  }
  const app = new Application();
  await app.init({
    resizeTo: container,
    // The same resolution art.ts bakes at, so a texture pixel lands on whole device pixels.
    resolution: bakeResolution(window.devicePixelRatio),
    autoDensity: true,
    antialias: false,
    roundPixels: true,
    background: skyBackground(clockOf(world.time.minute).minuteOfDay),
  });

  app.canvas.style.display = 'block';
  app.canvas.style.touchAction = 'none';
  // Above a device pixel ratio of 2 the browser stretches the canvas; keep that nearest neighbour too.
  app.canvas.style.imageRendering = 'pixelated';
  container.appendChild(app.canvas);

  // Layers, back to front.
  const layers = {
    sky: new Container(),
    cityFar: new Container(),
    cityNear: new Container(),
    ground: new Container(),
    tower: new Container(),
    cars: new Container(),
    sims: new Container(),
    effects: new Container(),
    light: new Container(),
    overlay: new Container(),
  };
  // Everything from ground forward shares the camera transform.
  const worldRoot = new Container();
  worldRoot.addChild(layers.ground, layers.tower, layers.cars, layers.sims, layers.effects);
  // The overlay (ghost, selection) shares the camera too, but sits above the light layer so the
  // placement colours are never graded by the hour.
  const overlayRoot = new Container();
  overlayRoot.addChild(layers.overlay);
  // D-4: what gives light at night sits over the light layer's multiply, under the same camera:
  // lit panes over their halo, the pools, the signs, the car indicators and the stress marks.
  const emissiveRoot = new Container();
  emissiveRoot.label = 'emissive';
  app.stage.addChild(layers.sky, layers.cityFar, layers.cityNear, worldRoot, layers.light, emissiveRoot, overlayRoot);

  // The light layer: one screen sized multiply quad tinted by the minute of day. It grades the
  // sky, the horizon and the tower together; the DOM chrome is outside the canvas.
  const lightSprite = new Sprite(Texture.WHITE);
  lightSprite.blendMode = 'multiply';
  lightSprite.alpha = LIGHT_ALPHA;
  lightSprite.tint = lightTintAt(clockOf(world.time.minute).minuteOfDay);
  layers.light.addChild(lightSprite);

  // Cars draw over their cables: one layer of hoist lines, then the car sprites.
  const cableLayer = new Container();
  const carSpriteLayer = new Container();
  // Each car's floor indicator, drawn over the housing baked into the car (on the emissive layer).
  const indicatorLayer = new Container();
  indicatorLayer.label = 'indicators';
  layers.cars.addChild(cableLayer, carSpriteLayer);
  layers.cars.label = 'cars';

  const slabLayer = new Container();
  const roomLayer = new Container();
  // A lobby run's two end lines and its shadow face, over the tiles, which draw neither (D-11).
  const lobbyEdges = new Graphics();
  lobbyEdges.label = 'lobby edges';
  const shaftLayer = new Container();
  shaftLayer.label = 'shafts';
  // Stairs and escalators are rooms, but they overlay the rooms they cross, so they
  // are drawn last of all, with no backing fill (art.ts OVERLAY_KINDS).
  const connectorLayer = new Container();
  // Behind everything in the tower: a continuous floor across each built floor,
  // so a sim between two rooms is never walking on sky.
  const floorStrips = new Graphics();
  // Slabs sit over the rooms: each casts its shadow onto the top of the floor below it.
  // The veil that mutes the window band below zoom 0.75, over the shells and under the signs.
  const windowVeil = new Graphics();
  windowVeil.visible = false;
  // A venue's illustrated layers: a look's painted wall, staff behind the fixtures, then the
  // fixtures, decor and signs, then the closed-hours shutters, then the night's pools of light.
  const venueWallLayer = new Container();
  const venueStaffLayer = new Container();
  const venueLayer = new Container();
  const venueClosedLayer = new Container();
  const venuePoolLayer = new Container();
  venuePoolLayer.label = 'pools';
  // Far zoom with FAR_ZOOM_BLOCKS: every room as one category block (the Districts chart).
  const blockLayer = new Graphics();
  blockLayer.visible = false;
  // Far zoom (BB-2): each built floor as a facade band; its night panes go on the emissive layer.
  const facade = new Graphics();
  facade.label = 'facade';
  facade.visible = false;
  // Labels name the layers the zoom hierarchy switches, for the tests and the pixi devtools.
  roomLayer.label = 'rooms';
  connectorLayer.label = 'connectors';
  windowVeil.label = 'window veil';
  blockLayer.label = 'blocks';
  layers.tower.addChild(
    floorStrips,
    roomLayer,
    lobbyEdges,
    windowVeil,
    venueWallLayer,
    venueStaffLayer,
    venueLayer,
    venueClosedLayer,
    slabLayer,
    shaftLayer,
    connectorLayer,
    blockLayer,
    facade,
  );

  const simSpriteLayer = new Container();
  // What people carry, in front of them.
  const propLayer = new Container();
  // Stress marks over the heads, and the one person drawn at far zoom: the selected one.
  const markLayer = new Container();
  const soloLayer = new Container();
  const soloSprite = new Sprite();
  soloSprite.anchor.set(0.5, 1);
  soloSprite.visible = false;
  soloLayer.addChild(soloSprite);
  simSpriteLayer.label = 'people';
  soloLayer.label = 'selected person';
  markLayer.label = 'marks';
  layers.sims.addChild(simSpriteLayer, propLayer, soloLayer);

  // The emissive layer's contents, back to front. The far zoom's night: the block glow (D-8, with
  // FAR_ZOOM_BLOCKS) or the facade's panes (BB-2). The near view's night: a soft halo behind each
  // lit floor, the lit panes, the pools, the sign glows and the lit sign faces, then the car
  // indicators and the stress marks. Signs and marks stand in front of the windows, as before.
  const blockGlow = new Graphics();
  blockGlow.label = 'block glow';
  blockGlow.visible = false;
  const facadeLit = new Graphics();
  facadeLit.label = 'facade lit';
  facadeLit.visible = false;
  const litHalo = new Graphics();
  litHalo.label = 'lit halo';
  litHalo.blendMode = 'add';
  const litPanes = new Graphics();
  litPanes.label = 'lit panes';
  const signGlowLayer = new Container();
  signGlowLayer.label = 'sign glows';
  const signLitLayer = new Container();
  signLitLayer.label = 'lit signs';
  emissiveRoot.addChild(blockGlow, facadeLit, litHalo, litPanes, venuePoolLayer, signGlowLayer, signLitLayer, indicatorLayer, markLayer);

  // The load fade: the chrome's steel over the whole stage until the first frame is drawn, then
  // lifted over LOAD_FADE_MS of wall clock time (onFrame). fadeIn: false shows none of it.
  const fadeCover = new Graphics();
  fadeCover.label = 'load fade';
  fadeCover.visible = options.fadeIn !== false;
  if (fadeCover.visible) fadeCover.rect(0, 0, app.screen.width, app.screen.height).fill({ color: FADE_COLOR, alpha: 1 });
  app.stage.addChild(fadeCover);

  // Ambient life (shop signs, restaurant steam, the cinema marquee) and build feedback, both in
  // the effects layer over the rooms and both off under reduced motion. The price a placement
  // floats (D-14) goes on the overlay, above the light layer, so it is never graded by the hour.
  const ambientLayer = new Container();
  const buildFxLayer = new Container();
  const priceLayer = new Container();
  priceLayer.label = 'build prices';
  layers.effects.addChild(ambientLayer, buildFxLayer);
  const ambient = createAmbient(ambientLayer);
  const buildFx = createBuildFx(buildFxLayer, priceLayer);

  let art: Art;
  const backup = fallbackArt(app.renderer as PixiRenderer);
  try {
    art = guardArt(createArt(app.renderer as PixiRenderer), backup);
  } catch (error) {
    console.warn('render: createArt failed, drawing flat rectangles', error);
    art = backup;
  }

  bakeRoomStates(art, world);

  // The curb scene on the street outside the ground lobby, behind the tower.
  const curb = createCurb(layers.ground, () => art);
  let curbDoors: { left: number; right: number } | null = null;

  // Visual hierarchy by zoom: which layers draw, and how strongly (hierarchy.ts).
  let tier: ZoomTier = 'full';
  let plan: LayerPlan = layerPlan(tier);
  // applyTier only acts on a change of tier, so the opening tier's connector alpha is set here.
  connectorLayer.alpha = plan.connectors;
  let veilDirty = true;
  let blocksDirty = true;
  let blocksAge = 0;
  let facadeDirty = true;
  let venueClock = -1;
  let sweepAge = 0;

  /** A person's look code: build and identity look key, cached per id (a pure function of both). */
  const lookCodes = new Map<Id, number>();
  function lookOf(w: World, sim: Sim): number {
    let code = lookCodes.get(sim.id);
    if (code === undefined) {
      if (lookCodes.size > 8192) lookCodes.clear();
      code = personLookCode(w.seed, sim.id, sim.kind);
      lookCodes.set(sim.id, code);
    }
    return code;
  }

  const camera = createCamera();
  camera.setViewport(app.screen.width, app.screen.height);
  const sky: Sky = createSky(layers);
  // Weather, outside the tower: the sun and lightning in the sky layer, the distant rain sheet
  // over the horizon bands (cityNear, still behind the world root), the wet street on the ground.
  const weatherFx = createWeatherFx({ sky: layers.sky, sheet: layers.cityNear, ground: layers.ground });
  let weatherView = settledView(weatherNow(world.seed, world.time.minute));
  let weatherFloors: readonly WeatherRect[] = [];
  let weatherBasement: { left: number; right: number } | null = null;

  let reducedMotion =
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  camera.setReducedMotion(reducedMotion);

  let lastWorld: World = world;

  // Opening composition. A built tower that fits the free band at OPENING_ZOOM opens whole,
  // centered in the band (BB-1). Otherwise zoom 1, with the street low enough that the roof and
  // a floor of sky show when they fit (D-1), and two thirds down for an empty lot or a short tower.
  let userMoved = false;
  let framedOnce = false;
  const bornAt = performance.now();
  // The chrome insets the ui last reported (setChrome). Until it reports, the free band is not
  // known, so the whole tower opening waits for it; the landing hero never reports and stays at 1.
  let chromeTop = 0;
  let chromeBottom = 0;
  let chromeKnown = false;
  function frameInitial(): void {
    camera.reset(); // zoom 1, no inertia, street at the default ground line
    const span = towerSpan(lastWorld);
    const whole =
      OPENING_WHOLE_TOWER && chromeKnown && span.built
        ? wholeTowerGroundLine(span.top, span.bottom, app.screen.height - chromeTop - chromeBottom)
        : null;
    if (whole !== null) {
      const extents = builtFloorExtents(lastWorld);
      let min = Infinity;
      let max = -Infinity;
      for (const e of extents.values()) {
        min = Math.min(min, e.min);
        max = Math.max(max, e.max);
      }
      camera.zoom = OPENING_ZOOM;
      // centerOn aims at a tile's middle, so half a tile back puts the tower's middle in the middle.
      camera.centerOn(6, (min + max) / 2 - 0.5);
      camera.setGroundLine(whole);
    } else {
      const x = lastWorld.rooms.size > 0 ? averageRoomX(lastWorld) : TOWER_WIDTH / 2;
      camera.centerOn(6, Math.round(x));
      const bandPx = app.screen.height - chromeTop;
      const phone = app.screen.width <= 720;
      camera.setGroundLine(openingGroundLine(span.top, bandPx, camera.zoom, phone));
    }
    if (app.screen.width > 1 && app.screen.height > 1) framedOnce = true;
  }

  let ghost: Ghost | null = null;
  let selection: Selection | null = null;
  /** The selection ring as drawOverlay last drew it, world px, or null when it drew none. */
  let selectionRect: { x: number; y: number; w: number; h: number } | null = null;
  const pickListeners: ((hit: PickHit) => void)[] = [];

  const roomSprites = new Map<Id, RoomEntry>();
  const slabSprites = new Map<Id, SlabEntry>();
  const shaftSprites = new Map<Id, ShaftEntry>();
  const carSprites = new Map<Id, CarEntry>();
  /** Each shaft's car finish, refreshed with the shafts (reconcileShafts). */
  let shaftFinish = new Map<Id, number>();
  const simSprites = new Map<Id, SimEntry>();
  const fireGraphics = new Map<Id, Graphics>();
  const carMotion = new Motion<Id>(TELEPORT_PX);
  const simMotion = new Motion<Id>(TELEPORT_PX);
  /** Per drawn sim: the x it was last seen at, and the real time that x last changed. */
  const simSteps = new Map<Id, { x: number; at: number }>();

  // Per-frame scratch sets/maps, hoisted so reconcile loops do not allocate every frame.
  const seenRooms = new Set<Id>();
  const seenShafts = new Set<Id>();
  const seenCars = new Set<Id>();
  const seenSims = new Set<Id>();
  const seenFires = new Set<Id>();
  const simSlots = new Map<Id, number>();
  const drawnSims: Sim[] = [];
  /**
   * Where the last frame drew each person (sprite or particle), feet point. A tap picks a
   * person here and the selection ring goes here, so both follow the picture: a person at a
   * desk is picked at the desk, and one nobody drew (outside the sample, riding, far zoom)
   * can be neither picked nor ringed.
   */
  const drawnAt = new Map<Id, DrawPoint>();

  const ghostSprite = new Sprite();
  ghostSprite.visible = false;
  const selectionBox = new Graphics();
  selectionBox.visible = false;
  selectionBox.label = 'selection';
  // The information views tint under the ghost and the selection ring, above the light layer so
  // their colours read the same at midnight as at noon.
  const overlayTint = new Graphics();
  overlayTint.visible = false;
  layers.overlay.addChild(overlayTint, ghostSprite, selectionBox, priceLayer);
  const overlayPass = createOverlayPass(overlayTint);
  const overlayView: ViewRect = { left: 0, top: 0, right: 0, bottom: 0 };

  // Sim particle mode: one shared atlas (art.crowd) so every particle draws from one source.
  let particles: ParticleContainer | null = null;
  // Crowd mode's stress marks: their own particle container in the marks layer, so a mark sits on
  // the emissive layer above the night tint whatever the crowd size, as a sprite mark does (D-4).
  let crowdMarks: ParticleContainer | null = null;
  let crowdAtlas: CrowdAtlas | null = null;
  let particleMode = false;
  const simParticles = new Map<Id, Particle>();
  // What people carry and their stress marks, as particles from the atlas's strip, at CROWD_EXTRA_SCALE.
  const propParticles = new Map<Id, Particle>();
  const markParticles = new Map<Id, { particle: Particle; mark: 'dot' | 'bang' }>();

  function dropSimEntry(id: Id, entry: SimEntry): void {
    entry.node.destroy();
    entry.mark?.destroy();
    entry.prop?.destroy();
    simSprites.delete(id);
  }

  function enterParticleMode(): boolean {
    if (particles) return true;
    const atlas = crowdAtlas ?? art.crowd?.() ?? null;
    if (!atlas) return false;
    crowdAtlas = atlas;
    particles = new ParticleContainer({
      texture: atlas.frameOf('worker', 0, FRAME.stand),
      dynamicProperties: { position: true, uvs: true, color: false, rotation: false, vertex: false },
      roundPixels: true,
      boundsArea: new Rectangle(-4000, -4000, 20000, 20000),
    });
    layers.sims.addChild(particles);
    crowdMarks = new ParticleContainer({
      texture: atlas.frameOf('worker', 0, FRAME.stand),
      dynamicProperties: { position: true, uvs: true, color: false, rotation: false, vertex: false },
      roundPixels: true,
      boundsArea: new Rectangle(-4000, -4000, 20000, 20000),
    });
    crowdMarks.label = 'crowd marks';
    markLayer.addChild(crowdMarks);
    for (const [id, entry] of simSprites) dropSimEntry(id, entry);
    simSpriteLayer.removeChildren();
    particleMode = true;
    return true;
  }

  function leaveParticleMode(): void {
    if (!particles) return;
    particles.destroy();
    particles = null;
    crowdMarks?.destroy();
    crowdMarks = null;
    simParticles.clear();
    propParticles.clear();
    markParticles.clear();
    particleMode = false;
  }

  /**
   * Crowd mode's prop and stress mark for one person, drawn from the atlas strip at
   * CROWD_EXTRA_SCALE: the prop in the hand for the atlas frame shown, the mark over the head.
   */
  function syncCrowdExtras(id: Id, kind: SimKind, look: number, frame: PersonFrame, band: StressBand, x: number, y: number): void {
    const container = particles;
    const marks = crowdMarks;
    const atlas = crowdAtlas;
    if (!container || !marks || !atlas) return;
    const atlasFrame = frame === FRAME.stride || frame === FRAME.strideMirrored ? FRAME.stride : FRAME.stand;
    const place = atlas.propOf ? propPlacement(kind, look, atlasFrame) : null;
    let prop = propParticles.get(id);
    if (place && atlas.propOf) {
      const size = PROP_SIZE[place.prop as PropKind];
      if (!prop) {
        prop = new Particle({ texture: atlas.propOf(place.prop), anchorX: 0.5, anchorY: 0.5, scaleX: CROWD_EXTRA_SCALE, scaleY: CROWD_EXTRA_SCALE });
        propParticles.set(id, prop);
        container.addParticle(prop);
      }
      prop.x = x - SIM_WIDTH_PX / 2 + place.x + size.w / 2;
      prop.y = y - SIM_HEIGHT_PX + place.y + size.h / 2;
    } else if (prop) {
      container.removeParticle(prop);
      propParticles.delete(id);
    }
    const mark = atlas.markOf ? stressMarkOf(band) : null;
    let held = markParticles.get(id);
    if (held && held.mark !== mark) {
      marks.removeParticle(held.particle);
      markParticles.delete(id);
      held = undefined;
    }
    if (mark && atlas.markOf) {
      if (!held) {
        held = { particle: new Particle({ texture: atlas.markOf(mark), anchorX: 0.5, anchorY: 1, scaleX: CROWD_EXTRA_SCALE, scaleY: CROWD_EXTRA_SCALE }), mark };
        markParticles.set(id, held);
        marks.addParticle(held.particle);
      }
      held.particle.x = x;
      held.particle.y = y - markBottomAboveFeet(look);
    }
  }

  /** Target this key at (x, y) and return where to draw it at alpha. */
  function interpolated(motion: Motion<Id>, key: Id, x: number, y: number, alpha: number): { x: number; y: number } {
    motion.target(key, x, y);
    if (reducedMotion) return { x, y };
    return motion.at(key, alpha)!;
  }

  /** Park an entity at a fixed point so it does not lerp away from it next frame. */
  function parked(motion: Motion<Id>, key: Id, x: number, y: number): { x: number; y: number } {
    motion.park(key, x, y);
    return { x, y };
  }

  function carX(shaft: Shaft): number {
    return (shaft.x + shaft.width / 2) * TILE_PX;
  }

  function carY(car: Car): number {
    return floorYFloat(car.y) + FLOOR_PX - SLAB_TOP_PX;
  }

  function commitMotion(w: World): void {
    for (const shaft of w.shafts.values()) {
      const x = carX(shaft);
      for (const car of shaft.cars) carMotion.commit(car.id, x, carY(car));
    }
    // Only a walking sim is lerped; a sim in a room is parked on its slot by the render anyway.
    // commit ignores sims without an entry, so sims off screen cost a map lookup and no memory.
    for (const sim of w.sims.values()) {
      if (!drawn(sim) || !simMoves(sim)) continue;
      simMotion.commit(sim.id, sim.pos.x * TILE_PX, simFeetY(sim.pos.floor));
    }
  }

  // Built floor extents. Rooms never move once built, so the cache only has to
  // notice a change in the room count, the shaft count or a shaft's span.
  let stripSignature = -1;

  function builtSignature(w: World): number {
    let sig = w.rooms.size * 131 + w.shafts.size * 17;
    for (const shaft of w.shafts.values()) sig += shaft.x * 3 + shaft.floorMin * 7 + shaft.floorMax * 13;
    return sig;
  }

  function rebuildFloorStrips(w: World): void {
    const extents = builtFloorExtents(w);
    curbDoors = lobbyDoors(w);
    weatherFloors = floorRectsOf(extents);
    weatherBasement = basementSpanOf(extents);
    floorStrips.clear();
    for (const [floor, extent] of extents) {
      const x = extent.min * TILE_PX;
      const width = (extent.max - extent.min) * TILE_PX;
      if (width <= 0) continue;
      const top = floorTopY(floor);
      floorStrips.rect(x, top, width, FLOOR_PX).fill(floor > 0 ? STRIP_ABOVE : STRIP_BELOW);
      floorStrips.rect(x, top, width, LINE_PX).fill(STRIP_CEILING);
      // The slab edge sits where art.ts draws it, SLAB_TOP_PX up from the bottom of
      // the band, so an empty stretch lines up with the rooms on either side.
      floorStrips.rect(x, top + FLOOR_PX - SLAB_TOP_PX, width, LINE_PX).fill(STRIP_EDGE);
    }
  }

  function syncFloorStrips(w: World): void {
    const sig = builtSignature(w);
    if (sig === stripSignature) return;
    stripSignature = sig;
    rebuildFloorStrips(w);
  }

  function reconcileRooms(w: World, night: boolean, minuteOfDay: number, animateNew: boolean): void {
    seenRooms.clear();
    // D-15: each room keeps its own night (roomNight), so across the dusk and dawn windows the
    // lobbies need the people too, not only once the tower's night has fallen.
    const peopleFloors = night || inLightWindow(minuteOfDay) ? floorsWithPeople(w) : NO_FLOORS;
    // D-14: the rooms placed in this pass (a lobby drag places many in one move) share one price.
    const placedNow: { nodes: Sprite[]; x: number; y: number; w: number; h: number; bands: RevealBand[]; cost: number }[] = [];
    // Every room's look, neighbors considered: one pass per reconcile, from ids and positions.
    const looks = art.interior ? interiorVariants(w.seed, w.rooms.values()) : null;
    for (const room of w.rooms.values()) {
      seenRooms.add(room.id);
      const state = windowStateOf(room, roomNight(w.seed, room.id, minuteOfDay), peopleFloors);
      const variant = roomVariant(room);
      const topFloor = room.floor + room.height - 1;
      const px = room.x * TILE_PX;
      const py = floorTopY(topFloor);
      const pw = room.width * TILE_PX;
      const ph = room.height * FLOOR_PX;

      let slab = slabSprites.get(room.id);
      if (!slab) {
        const sprite = new Sprite(art.slab(room.width));
        slabLayer.addChild(sprite);
        slab = { node: sprite, width: room.width };
        slabSprites.set(room.id, slab);
      } else if (slab.width !== room.width) {
        slab.node.texture = art.slab(room.width);
        slab.width = room.width;
      }
      // The deck overlays the room's own bottom SLAB_PX; the shadow below it runs onto the floor beneath.
      const slabHeight = TEXTURE_SIZE.slab(room.width).height;
      slab.node.setSize(pw, slabHeight);
      slab.node.position.set(px, floorBaseY(room.floor) - SLAB_TOP_PX);

      let entry = roomSprites.get(room.id);
      const placed = !entry;
      if (!entry) {
        const sprite = new Sprite(roomTexture(room, variant, state));
        (drawsOverRooms(room.kind) ? connectorLayer : roomLayer).addChild(sprite);
        entry = { node: sprite, kind: room.kind, width: room.width, height: room.height, variant, state };
        roomSprites.set(room.id, entry);
      } else if (
        entry.kind !== room.kind ||
        entry.width !== room.width ||
        entry.height !== room.height ||
        entry.variant !== variant ||
        entry.state !== state
      ) {
        entry.node.texture = roomTexture(room, variant, state);
        entry.kind = room.kind;
        entry.width = room.width;
        entry.height = room.height;
        entry.variant = variant;
        entry.state = state;
      }
      entry.node.position.set(px, py);
      entry.node.setSize(pw, ph);
      // D-4: the night grade by window state (day and lit keep their colours), or the fire.
      const grade = room.onFire ? FIRE_TINT : NIGHT_GRADE[state];
      entry.node.tint = grade;
      // A room the player just placed settles, puffs dust and flashes; one loaded with the
      // world, or drawn on the first pass, simply appears. Nothing under reduced motion.
      if (placed && animateNew && !reducedMotion) {
        // D-14: each floor's window band lights left to right, and the price rises out of the room.
        const bands = hasWindowBand(room.kind)
          ? spanFloors(room.floor, room.height).map((f) => ({ y: floorTopY(f) + WIN_TOP, h: WIN_SILL + LINE_PX - WIN_TOP }))
          : [];
        placedNow.push({ nodes: [entry.node, slab.node], x: px, y: py, w: pw, h: ph, bands, cost: ROOMS[room.kind].cost });
      }
      if (art.interior && !INTERIORS[room.kind].overlay) syncVenue(w, room, px, py, looks?.get(room.id) ?? interiorVariant(w.seed, room));
      const venue = venueSprites.get(room.id);
      if (venue) gradeVenue(venue, grade);
    }
    if (placedNow.length > 0) {
      // One price for the batch, the summed cost, centred over the union of what was placed.
      const left = Math.min(...placedNow.map((p) => p.x));
      const right = Math.max(...placedNow.map((p) => p.x + p.w));
      const over = { x: left, y: Math.min(...placedNow.map((p) => p.y)), w: right - left };
      const label = priceLabel(placedNow.reduce((sum, p) => sum + p.cost, 0));
      placedNow.forEach((p, i) => buildFx.start(p.nodes, p.x, p.y, p.w, p.h, p.bands, i === 0 ? label : '', over));
    }

    for (const [id, entry] of roomSprites) {
      if (seenRooms.has(id)) continue;
      entry.node.destroy();
      roomSprites.delete(id);
    }
    lobbyEdges.clear();
    for (const run of lobbyRuns(w.rooms.values())) drawLobbyRun(lobbyEdges, run);
    for (const [id, entry] of venueSprites) {
      const room = w.rooms.get(id);
      if (seenRooms.has(id) && room?.kind === entry.kind && room.height === entry.floors) continue;
      dropVenue(id, entry);
    }
    veilDirty = true;
    blocksDirty = true;
    facadeDirty = true;
    updateVenues(w, night);
    for (const [id, entry] of slabSprites) {
      if (seenRooms.has(id)) continue;
      entry.node.destroy();
      slabSprites.delete(id);
    }
    drawLitWindows(w);
  }

  /**
   * Where no pane is drawn on a floor: a shaft, or a stair or escalator over the rooms. Per
   * floor, tile spans [x, end). For the lit panes (D-4) and the facade (BB-2).
   */
  function paneObstacles(w: World): Map<number, [number, number][]> {
    const out = new Map<number, [number, number][]>();
    const add = (floor: number, x: number, end: number): void => {
      const spans = out.get(floor);
      if (spans) spans.push([x, end]);
      else out.set(floor, [[x, end]]);
    };
    for (const shaft of w.shafts.values()) {
      for (let f = shaft.floorMin; f <= shaft.floorMax; f++) if (f !== 0) add(f, shaft.x, shaft.x + shaft.width);
    }
    for (const room of w.rooms.values()) {
      if (!drawsOverRooms(room.kind)) continue;
      for (const f of spanFloors(room.floor, room.height)) add(f, room.x, room.x + room.width);
    }
    return out;
  }

  function blockedAt(spans: readonly [number, number][] | undefined, tile: number): boolean {
    if (!spans) return false;
    for (const [x, end] of spans) if (tile >= x && tile < end) return true;
    return false;
  }

  /**
   * D-4: the lit windows over the multiply. A lit room's panes, one per tile with a pale header,
   * over a soft halo along each lit floor; a housekeeping room's lamp. Panes under a shaft or a
   * flight are skipped, and a pane is cut where the room's sign board stands in front of it, so
   * what stood before the windows still does. Rebuilt with every full reconcile; empty by day.
   */
  function drawLitWindows(w: World): void {
    litPanes.clear();
    litHalo.clear();
    let obstacles: Map<number, [number, number][]> | null = null;
    for (const room of w.rooms.values()) {
      const entry = roomSprites.get(room.id);
      // A burning room shows its flames, not its windows: nothing of it goes over the fire.
      if (!entry || room.onFire || (entry.state !== 'lit' && entry.state !== 'housekeeping') || !hasWindowBand(room.kind)) continue;
      obstacles ??= paneObstacles(w);
      const lit = entry.state === 'lit';
      const px = room.x * TILE_PX;
      const width = room.width * TILE_PX;
      const venue = venueSprites.get(room.id);
      const board = venue?.sign ? signBoard(room.kind as 'shop' | 'restaurant', width) : null;
      for (const f of spanFloors(room.floor, room.height)) {
        const y = floorTopY(f);
        const spans = obstacles.get(f);
        if (lit) litHalo.rect(px, y + WIN_TOP, width, WIN_SILL + LINE_PX - WIN_TOP).fill({ color: LIT_PANE, alpha: HALO_ALPHA });
        for (let x = WIN_PANE_X, n = 0; x + WIN_PANE + LINE_PX <= width; x += TILE_PX, n++) {
          if (blockedAt(spans, room.x + n)) continue;
          for (const [from, to] of clearOf(x, x + WIN_PANE, board)) {
            if (lit) {
              litPanes.rect(px + from, y + WIN_PANE_TOP, to - from, WIN_PANE).fill(LIT_PANE);
              litPanes.rect(px + from, y + WIN_PANE_TOP, to - from, LINE_PX).fill(LIT_HEADER);
            } else {
              litPanes.rect(px + from, y + WIN_PANE_TOP + WIN_PANE - 4, to - from, 4).fill({ color: LIT_PANE, alpha: LAMP_ALPHA });
            }
          }
        }
      }
    }
  }

  /** The parts of [from, to) a board does not cover, room px. */
  function clearOf(from: number, to: number, board: { x: number; w: number } | null): [number, number][] {
    if (!board || to <= board.x || from >= board.x + board.w) return [[from, to]];
    const out: [number, number][] = [];
    if (from < board.x) out.push([from, board.x]);
    if (to > board.x + board.w) out.push([board.x + board.w, to]);
    return out;
  }

  /** D-4: a room's illustrated layers take its shell's tint: the night grade, or the fire. */
  function gradeVenue(v: VenueEntry, grade: number): void {
    v.grade = grade;
    v.fixtures.tint = grade;
    if (v.decor) v.decor.tint = grade;
    if (v.wall) v.wall.tint = grade;
    if (v.staff) v.staff.tint = grade;
    if (v.closed) v.closed.tint = grade;
  }

  // ---------------------------------------------------------------- venues

  const venueSprites = new Map<Id, VenueEntry>();

  function layerSprite(layer: Container, texture: Texture, x: number, y: number, w: number, h: number): Sprite {
    const sprite = new Sprite(texture);
    sprite.position.set(x, y);
    sprite.setSize(w, h);
    layer.addChild(sprite);
    return sprite;
  }

  function dropVenue(id: Id, entry: VenueEntry): void {
    for (const node of [entry.fixtures, entry.decor, entry.wall, entry.sign, entry.signGlow, entry.signLit, entry.closed, entry.pool, entry.staff]) node?.destroy({ children: true });
    venueSprites.delete(id);
  }

  /**
   * A room's texture in the room layer: its structural shell, or for stairs and escalators, which
   * draw over the rooms they cross, their illustrated flight (interiors.ts overlay kinds).
   */
  function roomTexture(room: Room, variant: number, state: WindowState): Texture {
    if (art.interior && INTERIORS[room.kind].overlay) return art.interior(room.kind, room.width, room.height, 0);
    return art.room(room.kind, room.width, room.height, variant, state);
  }

  /**
   * Make or move one room's illustrated layers: fixtures in its variant (a venue's treatment and
   * brand, venue.ts), a sign over a shop or restaurant, and the pools of light under the ceiling.
   */
  function syncVenue(w: World, room: Room, px: number, py: number, variant: number): void {
    const kind = room.kind;
    const spec = INTERIORS[kind];
    const width = room.width * TILE_PX;
    let entry = venueSprites.get(room.id);
    // A new neighbor can change a room's look (interiorVariants): its layers are made afresh.
    if (entry && (entry.width !== room.width || entry.floors !== room.height || entry.variant !== variant)) {
      dropVenue(room.id, entry);
      entry = undefined;
    }
    if (!entry && art.interior) {
      const venue = isVenueKind(kind) ? venueOf(w.seed, room.id, kind) : null;
      const look = interiorLook(kind, variant);
      const flip = interiorFlip(w.seed, room);
      const band = spec.band(room.height);
      // A painted feature wall, behind the staff and the fixtures, clear of the wall's shadow face,
      // and stopping above the shell's district floor line (art.ts drawShell, D-7) so it shows.
      let wall: Container | null = null;
      if (look.wall !== null) {
        wall = new Container();
        const top = WIN_SILL + LINE_PX;
        const bottom = FLOOR_PX - SLAB_PX - 2;
        const face = width - LINE_PX - WALL_SHADOW_PX;
        layerSprite(wall, Texture.WHITE, LINE_PX, top, face - LINE_PX, bottom - top).tint = look.wall;
        layerSprite(wall, Texture.WHITE, face, top, WALL_SHADOW_PX, bottom - top).tint = shade(look.wall);
        venueWallLayer.addChild(wall);
      }
      const fixtures = layerSprite(venueLayer, art.interior(kind, room.width, room.height, look.base), 0, 0, width, band.height);
      if (flip) fixtures.scale.x = -Math.abs(fixtures.scale.x);
      // The look's decor over the fixtures, mirrored with them.
      let decor: Container | null = null;
      if (art.decor && look.decor.length > 0) {
        decor = new Container();
        const fine = !bakesAtStructuralScale(kind, room.width);
        for (const p of look.decor) {
          const piece = DECOR[p.piece];
          const sprite = layerSprite(decor, art.decor(p.piece, fine), flip ? width - p.x : p.x, p.y, piece.w, piece.h);
          if (flip) sprite.scale.x = -Math.abs(sprite.scale.x);
        }
        venueLayer.addChild(decor);
      }
      let sign: Sprite | null = null;
      let signGlow: Sprite | null = null;
      let signLit: Sprite | null = null;
      if (venue && kind !== 'office' && art.sign) {
        const k = kind as 'shop' | 'restaurant';
        const board = signBoard(k, width);
        if (art.glow) {
          // D-4: the glow adds over the night tint, and a second face on the same texture lights
          // the sign above it; the plain face stays in the world for the day and the dark.
          signGlow = layerSprite(signGlowLayer, art.glow(), 0, 0, board.w + 24, board.h + 20);
          signGlow.tint = SIGN_GLOW_TINT;
          signGlow.blendMode = 'add';
          signGlow.alpha = SIGN_GLOW_ALPHA;
          signGlow.visible = false;
        }
        const face = art.sign(k, room.width, venue.name, venue.accent);
        sign = layerSprite(venueLayer, face, 0, 0, board.w, board.h);
        signLit = layerSprite(signLitLayer, face, 0, 0, board.w, board.h);
        signLit.visible = false;
      }
      let pool: Container | null = null;
      if (art.glow && spec.pools && room.height === 1) {
        // Warm pools of light under the ceiling: the shared glow, one every POOL_STEP px.
        pool = new Container();
        for (let x = POOL_STEP / 2; x < width; x += POOL_STEP) {
          const glow = layerSprite(pool, art.glow(), x - POOL_W / 2, INTERIOR_TOP - 2, POOL_W, POOL_H);
          glow.tint = POOL_TINT;
          glow.alpha = POOL_ALPHA;
          glow.blendMode = 'add';
        }
        pool.visible = false;
        venuePoolLayer.addChild(pool);
      }
      // The closed overlay and the post are made the first time they show (updateVenues).
      entry = { kind, width: room.width, floors: room.height, variant, flip, venue, fixtures, decor, wall, sign, signGlow, signLit, closed: null, pool, staff: null, state: '', grade: 0xffffff, x: px, y: py };
      venueSprites.set(room.id, entry);
    }
    if (!entry) return;
    entry.x = px;
    entry.y = py;
    entry.fixtures.position.set(px + (entry.flip ? width : 0), py + spec.band(room.height).top);
    entry.decor?.position.set(px, py);
    entry.wall?.position.set(px, py);
    if (entry.closed && spec.closed) {
      const r = spec.closed.rect(width, room.height);
      entry.closed.position.set(px + r.x, py + r.y);
    }
    entry.pool?.position.set(px, py);
    if (entry.sign || entry.signGlow) {
      const board = signBoard(kind as 'shop' | 'restaurant', width);
      entry.sign?.position.set(px + board.x, py + board.y);
      entry.signLit?.position.set(px + board.x, py + board.y);
      entry.signGlow?.position.set(px + board.x - 12, py + board.y - 10);
    }
    if (entry.staff && spec.post) entry.staff.position.set(px + spec.post.x(width), py + room.height * FLOOR_PX - SLAB_TOP_PX);
  }

  /**
   * Closed hours, lit signs, light pools and the people at their posts, from the schedules and
   * the room's occupancy. Nothing is baked here but the first showing of an overlay or a post:
   * shutters, pools and glows show and hide, a closed sign is tinted.
   */
  function updateVenues(w: World, night: boolean): void {
    for (const [id, v] of venueSprites) {
      const room = w.rooms.get(id);
      if (!room) continue;
      const spec = INTERIORS[v.kind];
      const open = interiorOpen(v.kind, w.time.minute);
      const occupied = room.occupancy > 0;
      // A burning room gives no light: its pools and its lit sign go out while it burns.
      const burning = room.onFire;
      const key = `${open ? 1 : 0}${night ? 1 : 0}${occupied ? 1 : 0}${burning ? 1 : 0}`;
      if (key === v.state) continue;
      v.state = key;
      const width = v.width * TILE_PX;
      if (!open && !v.closed && spec.closed && art.shut) {
        const r = spec.closed.rect(width, v.floors);
        v.closed = layerSprite(venueClosedLayer, art.shut(v.kind, v.width, v.floors), v.x + r.x, v.y + r.y, r.w, r.h);
        v.closed.tint = v.grade;
      }
      const post = spec.post;
      const manned = !!post && open && (post.when === 'open' || occupied);
      if (manned && post && !v.staff) {
        // A clerk behind the counter, a cook at the pass, a nurse, a guard at the desk: behind the fixtures.
        const look = lookCode(bodyOf(w.seed, id + 7919), (id * 5 + 3) % 8);
        v.staff = new Sprite(art.sim(post.kind, 'calm', FRAME.stand, look));
        v.staff.anchor.set(0.5, 1);
        v.staff.setSize(SIM_WIDTH_PX, SIM_HEIGHT_PX);
        v.staff.position.set(v.x + post.x(width), v.y + v.floors * FLOOR_PX - SLAB_TOP_PX);
        v.staff.tint = v.grade;
        venueStaffLayer.addChild(v.staff);
      }
      if (v.closed) v.closed.visible = !open;
      if (v.pool) v.pool.visible = night && !burning && (occupied || (manned && post?.when === 'open'));
      if (v.staff) v.staff.visible = manned;
      const sign: SignState = !open ? 'dark' : night ? 'lit' : 'day';
      if (v.sign) v.sign.tint = sign === 'dark' ? SIGN_DARK_TINT : 0xffffff;
      if (v.signGlow) v.signGlow.visible = sign === 'lit' && !burning;
      if (v.signLit) v.signLit.visible = sign === 'lit' && !burning;
    }
  }

  // ---------------------------------------------------------------- hierarchy

  function applyTier(next: ZoomTier): void {
    if (next === tier) return;
    tier = next;
    plan = layerPlan(tier);
    const rooms = plan.rooms;
    roomLayer.visible = rooms;
    lobbyEdges.visible = rooms;
    slabLayer.visible = rooms;
    venueWallLayer.visible = rooms;
    venueStaffLayer.visible = rooms;
    venueLayer.visible = rooms;
    venueClosedLayer.visible = rooms;
    venuePoolLayer.visible = rooms;
    // The near view's lit windows and signs go with the rooms.
    litPanes.visible = rooms;
    litHalo.visible = rooms;
    signGlowLayer.visible = rooms;
    signLitLayer.visible = rooms;
    ambientLayer.visible = plan.ambient;
    connectorLayer.visible = plan.connectors > 0;
    connectorLayer.alpha = plan.connectors;
    windowVeil.visible = plan.windowVeil > 0;
    windowVeil.alpha = plan.windowVeil;
    // The veil mutes the lit windows too: the emissive layer dims by the same share at the muted tier.
    emissiveRoot.alpha = 1 - plan.windowVeil;
    blockLayer.visible = plan.blocks;
    if (plan.blocks) blocksDirty = true;
    else blockGlow.visible = false;
    // BB-2: the facade covers the shafts, which it draws as strips of its own.
    facade.visible = plan.facade;
    facadeLit.visible = plan.facade;
    shaftLayer.visible = !plan.facade;
    if (plan.facade) facadeDirty = true;
  }

  /** The wall coloured veil over every window band, muting the repetition at broad zoom. */
  function rebuildVeil(w: World): void {
    veilDirty = false;
    windowVeil.clear();
    for (const room of w.rooms.values()) {
      if (!hasWindowBand(room.kind)) continue;
      const px = room.x * TILE_PX;
      const pw = room.width * TILE_PX;
      for (let f = room.floor; f < room.floor + room.height; f++) {
        windowVeil.rect(px, floorTopY(f) + WIN_TOP, pw, WIN_SILL + LINE_PX - WIN_TOP).fill(PALETTE.wall[room.kind]);
      }
    }
  }

  /**
   * Far zoom with FAR_ZOOM_BLOCKS: the category blocks (overlays.ts drawBlocks). At night (D-8)
   * the blocks darken toward the night sky and their occupancy glows on the emissive layer.
   */
  function rebuildBlocks(w: World): void {
    blocksDirty = false;
    blocksAge = 0;
    const night = isNight(clockOf(w.time.minute).minuteOfDay);
    blockLayer.clear();
    blockGlow.clear();
    drawBlocks(blockLayer, w.rooms.values(), { night, glow: blockGlow });
    blockGlow.visible = plan.blocks && night;
  }

  /**
   * BB-2: the far zoom as a facade. Each built floor is a band of wall across its extent with a
   * 2 px slab line, one pane per two tiles (on the tile grid, so a floor keeps one rhythm) where a
   * room with windows stands, none under a shaft or a flight, and each shaft a darker strip. By
   * day the panes are glass; once a room's night has come (roomNight, D-15) its pane is lit or
   * dark by the room's window state, on the emissive layer over the night tint.
   */
  function rebuildFacade(w: World): void {
    facadeDirty = false;
    facade.clear();
    facadeLit.clear();
    const extents = builtFloorExtents(w);
    const obstacles = paneObstacles(w);
    // At night the wall takes the grade an empty room takes (D-4), so the facade is a dark slab and
    // its lit panes, on the emissive layer and never graded, carry it.
    facade.tint = isNight(clockOf(w.time.minute).minuteOfDay) ? NIGHT_GRADE.vacant : 0xffffff;
    const cells = new Map<number, Map<number, Room>>();
    for (const room of w.rooms.values()) {
      if (drawsOverRooms(room.kind) || !hasWindowBand(room.kind)) continue;
      for (const f of spanFloors(room.floor, room.height)) {
        let row = cells.get(f);
        if (!row) cells.set(f, (row = new Map()));
        for (let t = room.x; t < room.x + room.width; t++) row.set(t, room);
      }
    }
    for (const [floor, extent] of extents) {
      const top = floorTopY(floor);
      const x = extent.min * TILE_PX;
      const width = (extent.max - extent.min) * TILE_PX;
      if (width <= 0) continue;
      // The facade stops at the street: a basement floor draws as the underground does, the
      // basement tone of the floor strips with no panes.
      if (floor < 0) {
        facade.rect(x, top, width, FLOOR_PX).fill(STRIP_BELOW);
        facade.rect(x, top, width, LINE_PX).fill(STRIP_CEILING);
        facade.rect(x, top + FLOOR_PX - SLAB_TOP_PX, width, LINE_PX).fill(STRIP_EDGE);
        continue;
      }
      facade.rect(x, top, width, FLOOR_PX).fill(FACADE_WALL);
      const row = cells.get(floor);
      const spans = obstacles.get(floor);
      if (row) {
        for (let t = extent.min + (((extent.min % 2) + 2) % 2); t < extent.max; t += 2) {
          const room = row.get(t);
          if (!room || blockedAt(spans, t)) continue;
          const state = roomSprites.get(room.id)?.state ?? 'day';
          // The pane's second tile: cut back to one tile's pane at a shaft, a flight or the floor's end.
          const paneW = blockedAt(spans, t + 1) || t + 1 >= extent.max ? WIN_PANE : FACADE_PANE_W;
          const px = t * TILE_PX + WIN_PANE_X;
          const py = top + WIN_PANE_TOP;
          if (state === 'day') facade.rect(px, py, paneW, WIN_PANE).fill(PALETTE.windowDay);
          // A burning room shows no lit light at any zoom: its panes stay dark while it burns.
          else facadeLit.rect(px, py, paneW, WIN_PANE).fill(state === 'lit' && !room.onFire ? PALETTE.windowLit : PALETTE.windowUnlit);
        }
      }
      facade.rect(x, top + FLOOR_PX - SLAB_PX, width, LINE_PX).fill(FACADE_SLAB);
    }
    for (const shaft of w.shafts.values()) {
      facade.rect(shaft.x * TILE_PX, floorTopY(shaft.floorMax), shaft.width * TILE_PX, shaftFloorSpan(shaft) * FLOOR_PX).fill(FACADE_SHAFT);
    }
  }

  // ---------------------------------------------------------------- car indicators

  const LED = 0xffb347;

  /** The car's floor and direction, lit in the housing baked above its doors. */
  function drawIndicator(entry: CarEntry, car: Car, x: number, y: number): void {
    const label = carFloorLabel(car.y);
    const key = `${label}|${car.dir}`;
    const size = TEXTURE_SIZE.car(entry.kind);
    const box = carIndicator(size.width, 4);
    entry.indicator.position.set(x - size.width / 2 + box.x, y - size.height + box.y);
    if (key === entry.indicatorKey) return;
    entry.indicatorKey = key;
    entry.indicator.clear();
    drawCarIndicator(entry.indicator, label, car.dir, box.w, LED);
  }

  /**
   * Where a person stands in the picture: a walker at its position, a person in a room at the
   * slot the full frame gives them (the same slot order reconcileSims walks). For the one
   * person drawn at far zoom, so it stands where it stood a zoom step closer.
   */
  function restingPoint(w: World, sim: Sim): [number, number] {
    if (simMoves(sim) || sim.inRoomId === null) return [sim.pos.x * TILE_PX, simFeetY(sim.pos.floor)];
    simSlots.clear();
    for (const other of w.sims.values()) {
      if (other.inRoomId !== sim.inRoomId || simMoves(other) || !drawn(other)) continue;
      const p = inRoomSlot(w, other, simSlots);
      if (other.id === sim.id) return p;
    }
    return inRoomSlot(w, sim, new Map());
  }

  /** At far zoom only the selected person is drawn, and the selection ring goes round it. */
  function drawSolo(w: World): void {
    const sim = selection?.simId !== undefined ? w.sims.get(selection.simId) : undefined;
    if (!sim || !simIsVisible(sim)) {
      soloSprite.visible = false;
      return;
    }
    const [x, y] = restingPoint(w, sim);
    soloSprite.texture = art.sim(sim.kind, stressBand(sim.stress), FRAME.stand, lookOf(w, sim));
    soloSprite.setSize(SIM_WIDTH_PX, SIM_HEIGHT_PX);
    soloSprite.position.set(x, y);
    soloSprite.visible = true;
    drawnAt.set(sim.id, { x, y, floor: yToFloor(y - 1) });
  }

  // The static tower (floor strips, rooms, slabs, shafts, fire markers) is reconciled only
  // when the world's structure version, the world itself or the light band moves since the
  // last full pass. The light band is one value all day and one per game hour at night
  // (light.ts lightBand), so window states the sim does not version (a hotel room going
  // dirty, people on a lobby floor) catch up within a game hour. Cars, sims and the overlay
  // are touched every frame.
  let reconciledWorld: World | null = null;
  let reconciledVersion = -1;
  let lastLitState = -1;

  function reconcileStaticTower(w: World, night: boolean, minuteOfDay: number): void {
    const band = lightBand(night, minuteOfDay);
    if (w === reconciledWorld && w.structureVersion === reconciledVersion && band === lastLitState) return;
    const animateNew = w === reconciledWorld;
    reconciledWorld = w;
    reconciledVersion = w.structureVersion;
    lastLitState = band;
    syncFloorStrips(w);
    reconcileRooms(w, night, minuteOfDay, animateNew);
    ambient.sync(w, reducedMotion);
    reconcileShafts(w);
    reconcileFires(w);
  }

  function reconcileShafts(w: World): void {
    seenShafts.clear();
    shaftFinish = carFinishes(w.seed, w.shafts.values());
    for (const shaft of w.shafts.values()) {
      seenShafts.add(shaft.id);
      const floors = shaftFloorSpan(shaft);
      const pieces = shaftPieces(floors);
      let entry = shaftSprites.get(shaft.id);
      if (!entry || entry.kind !== shaft.kind || entry.floors !== floors) {
        const parts = entry?.parts ?? [];
        while (parts.length > pieces.length) parts.pop()?.destroy();
        pieces.forEach((n, i) => {
          const texture = art.shaft(shaft.kind, n);
          const part = parts[i];
          if (part) part.texture = texture;
          else {
            const sprite = new Sprite(texture);
            shaftLayer.addChild(sprite);
            parts.push(sprite);
          }
        });
        if (!entry) {
          entry = { parts, kind: shaft.kind, floors };
          shaftSprites.set(shaft.id, entry);
        }
        entry.parts = parts;
        entry.kind = shaft.kind;
        entry.floors = floors;
      }
      // Stacked from the top of the shaft down, each piece exactly its floors tall.
      let y = floorTopY(shaft.floorMax);
      for (let i = 0; i < entry.parts.length; i++) {
        const part = entry.parts[i] as Sprite;
        const n = pieces[i] ?? 0;
        part.position.set(shaft.x * TILE_PX, y);
        part.setSize(shaft.width * TILE_PX, n * FLOOR_PX);
        y += n * FLOOR_PX;
      }
    }

    for (const [id, entry] of shaftSprites) {
      if (seenShafts.has(id)) continue;
      for (const part of entry.parts) part.destroy();
      shaftSprites.delete(id);
    }
  }

  function reconcileCars(w: World, alpha: number): void {
    seenCars.clear();
    for (const shaft of w.shafts.values()) {
      for (const car of shaft.cars) {
        seenCars.add(car.id);
        drawCar(shaft, car, alpha);
      }
    }
    for (const [id, entry] of carSprites) {
      if (seenCars.has(id)) continue;
      entry.node.destroy();
      entry.cable.destroy();
      entry.indicator.destroy();
      carSprites.delete(id);
      carMotion.forget(id);
    }
  }

  /**
   * Slide a car's doors toward where the sim wants them, by `dtMs` of real time: 240 ms each way.
   * The target comes from the sim's car state; the latch holds it open until the doors have
   * opened fully, so a one tick stop still reads as a stop. Under reduced motion the doors snap
   * between closed and open, with the same hold, so a one tick stop cannot strobe.
   */
  function stepCarDoors(entry: CarEntry, dtMs: number): void {
    const target = entry.open || entry.latch;
    entry.door = stepDoor(entry.door, target, dtMs, false);
    if (entry.door >= 1) entry.latch = false;
    const frame = doorFrameOf(reducedMotion ? (target ? 1 : 0) : entry.door);
    if (frame !== entry.frame) {
      entry.frame = frame;
      entry.node.texture = art.car(entry.kind, DOOR_FRAMES[frame], entry.finish);
    }
  }

  function drawCar(shaft: Shaft, car: Car, alpha: number): void {
    const open = car.state === 'doorsOpen';
    let entry = carSprites.get(car.id);
    const finish = shaftFinish.get(shaft.id) ?? 0;
    if (!entry) {
      // A car first seen with its doors open shows them open: there was no closing to watch.
      const door = open ? 1 : 0;
      const sprite = new Sprite(art.car(shaft.kind, door, finish));
      // Bottom center on the slab line, so a door frame swap never moves the car.
      sprite.anchor.set(0.5, 1);
      carSpriteLayer.addChild(sprite);
      // Drawn once a pixel tall and stretched to length each frame, so a moving car costs a
      // scale, not a Graphics rebuild.
      const cable = new Graphics().rect(-CABLE_PX / 2, 0, CABLE_PX, 1).fill(CABLE_COLOR);
      cableLayer.addChild(cable);
      const indicator = new Graphics();
      indicatorLayer.addChild(indicator);
      entry = { node: sprite, cable, indicator, indicatorKey: '', kind: shaft.kind, finish, door, frame: doorFrameOf(door), open, latch: false, settle: 0 };
      carSprites.set(car.id, entry);
    } else if (entry.kind !== shaft.kind || entry.finish !== finish) {
      entry.kind = shaft.kind;
      entry.finish = finish;
      entry.node.texture = art.car(shaft.kind, DOOR_FRAMES[entry.frame], finish); // texture swap only
    }
    const wasOpen = entry.open;
    entry.open = open;
    // D-18: the car lands, settling a pixel as its doors open. Not under reduced motion.
    if (open && !wasOpen && !reducedMotion) entry.settle = CAR_SETTLE_MS;
    if (open) entry.latch = true; // seen open once, even for a tick: the doors open all the way
    if (reducedMotion) stepCarDoors(entry, 0); // doors snap, as they always did
    const target = interpolated(carMotion, car.id, carX(shaft), carY(car), alpha);
    // The indicator and the cable move with the car, so the digits stay in their housing.
    const y = target.y + (entry.settle > CAR_SETTLE_MS / 2 ? 1 : 0);
    entry.node.position.set(target.x, y);
    // From the car's roof (under its cast shadow) up to the top of the shaft.
    const roof = y - (FLOOR_PX - CAR_CLEAR_PX);
    const shaftTop = floorTopY(shaft.floorMax);
    entry.cable.position.set(target.x, shaftTop);
    entry.cable.scale.y = Math.max(0, roof - shaftTop);
    entry.cable.visible = roof > shaftTop;
    drawIndicator(entry, car, target.x, y);
  }

  /** The stress mark over one person's head: a pink dot, a red exclamation, or nothing. */
  function syncMark(entry: SimEntry, band: StressBand, look: number, x: number, y: number): void {
    const mark = art.mark ? stressMarkOf(band) : null;
    if (!mark || !art.mark) {
      if (entry.mark) entry.mark.visible = false;
      return;
    }
    if (!entry.mark) {
      entry.mark = new Sprite(art.mark(mark));
      entry.mark.anchor.set(0.5, 1);
      markLayer.addChild(entry.mark);
      entry.markKind = mark;
    } else if (entry.markKind !== mark) {
      entry.mark.texture = art.mark(mark);
      entry.markKind = mark;
    }
    entry.mark.visible = true;
    entry.mark.setSize(MARK_W, MARK_H);
    entry.mark.position.set(x, y - markBottomAboveFeet(look));
  }

  function reconcileSims(w: World, alpha: number): void {
    drawnAt.clear();
    // Far zoom: nobody but the selected person, so the blocks read as the tower.
    const solo = plan.people === 'selected';
    simSpriteLayer.visible = !solo;
    propLayer.visible = !solo;
    markLayer.visible = !solo;
    if (particles) particles.visible = !solo;
    if (solo) {
      drawSolo(w);
      return;
    }
    soloSprite.visible = false;

    // One pass over every sim: the crowd sample and visibility are decided once here, and
    // the loop below walks only the sims that are drawn.
    drawnSims.length = 0;
    for (const sim of w.sims.values()) if (drawn(sim)) drawnSims.push(sim);
    const visible = drawnSims.length;

    if (!particleMode && visible > PARTICLE_THRESHOLD) enterParticleMode();
    else if (particleMode && visible < PARTICLE_RELEASE) leaveParticleMode();

    // Sims standing in a room take a fixed slot, in id order, so they stop jittering.
    simSlots.clear();

    // One viewport of margin on every side of the camera, in world px; a sim further
    // out than this gets no sprite or particle until it comes back into range.
    const halfW = app.screen.width / camera.zoom;
    const halfH = app.screen.height / camera.zoom;
    const viewLeft = camera.x - halfW;
    const viewRight = camera.x + halfW;
    const viewTop = camera.y - halfH;
    const viewBottom = camera.y + halfH;

    seenSims.clear();
    const now = performance.now();
    for (const sim of drawnSims) {
      const sx = sim.pos.x * TILE_PX;
      const sy = simFeetY(sim.pos.floor);
      if (sx < viewLeft || sx > viewRight || sy < viewTop || sy > viewBottom) continue;
      seenSims.add(sim.id);
      const kind = sim.kind;
      const band = stressBand(sim.stress);
      // The walk cycle, the weight shift and the glance run on real time; the look is the id's.
      let step = simSteps.get(sim.id);
      if (!step) simSteps.set(sim.id, (step = { x: sim.pos.x, at: -Infinity }));
      else if (step.x !== sim.pos.x) {
        step.x = sim.pos.x;
        step.at = now;
      }
      const roomKind = sim.state === 'inRoom' && sim.inRoomId !== null ? w.rooms.get(sim.inRoomId)?.kind : undefined;
      const pose = poseAt(poseOf(sim, isStepping(step.at, now), w.time.minute, roomKind), sim.id, now, reducedMotion);
      const frame = pose.frame;
      const look = lookOf(w, sim);
      const simKey = simKeyOf(kind, frame, look);
      const point = simMoves(sim)
        ? // Feet on the slab top, not the bottom of the floor band.
          interpolated(simMotion, sim.id, sim.pos.x * TILE_PX, simFeetY(sim.pos.floor), alpha)
        : parked(simMotion, sim.id, ...inRoomSlot(w, sim, simSlots));
      const drawX = point.x + pose.dx;
      const drawY = point.y + pose.dy;
      // Where the person stands, before the pose's small shift, so the ring does not bob. The
      // floor is the one the feet stand on: a slot in a two floor room sits on its base floor.
      drawnAt.set(sim.id, { x: point.x, y: point.y, floor: yToFloor(point.y - 1) });

      const atlasTile = particleMode && particles && crowdAtlas ? crowdAtlas.frameOf(kind, look, frame) : undefined;
      if (particles && atlasTile) {
        let particle = simParticles.get(sim.id);
        if (!particle) {
          particle = new Particle({ texture: atlasTile, anchorX: 0.5, anchorY: 1 });
          simParticles.set(sim.id, particle);
          particles.addParticle(particle);
        } else if (particle.texture !== atlasTile) {
          particle.texture = atlasTile;
        }
        particle.x = drawX;
        particle.y = drawY;
        syncCrowdExtras(sim.id, kind, look, frame, band, drawX, drawY);
        continue;
      }

      let entry = simSprites.get(sim.id);
      if (!entry) {
        const sprite = new Sprite(art.sim(kind, band, frame, look));
        sprite.anchor.set(0.5, 1);
        simSpriteLayer.addChild(sprite);
        entry = { node: sprite, body: sprite, prop: null, propKind: null, simKey, mark: null, markKind: null };
        simSprites.set(sim.id, entry);
      } else if (entry.simKey !== simKey) {
        entry.node.texture = art.sim(kind, band, frame, look);
        entry.simKey = simKey;
      }
      placePerson(art, propLayer, entry, kind, look, frame, drawX, drawY);
      syncMark(entry, band, look, drawX, drawY);
    }
    drawnSims.length = 0; // hold no sim past the frame

    for (const [id, entry] of simSprites) {
      if (seenSims.has(id)) continue;
      dropSimEntry(id, entry);
      simMotion.forget(id);
      simSteps.delete(id);
    }
    if (particles) {
      for (const [id, particle] of simParticles) {
        if (seenSims.has(id)) continue;
        particles.removeParticle(particle);
        simParticles.delete(id);
        simMotion.forget(id);
        simSteps.delete(id);
        const prop = propParticles.get(id);
        if (prop) particles.removeParticle(prop);
        propParticles.delete(id);
        const held = markParticles.get(id);
        if (held) crowdMarks?.removeParticle(held.particle);
        markParticles.delete(id);
      }
    }
  }

  function reconcileFires(w: World): void {
    seenFires.clear();
    for (const room of w.rooms.values()) {
      if (!room.onFire) continue;
      seenFires.add(room.id);
      if (!fireGraphics.has(room.id)) {
        const g = new Graphics();
        layers.effects.addChild(g);
        fireGraphics.set(room.id, g);
      }
    }
    for (const [id, g] of fireGraphics) {
      if (seenFires.has(id)) continue;
      g.destroy();
      fireGraphics.delete(id);
    }
  }

  // Flicker uses its own counter, never world.rng.
  let flickerSeed = 0x9e3779b1;
  function flickerNext(): number {
    flickerSeed = (flickerSeed * 1664525 + 1013904223) >>> 0;
    return flickerSeed / 4294967296;
  }

  function drawFires(w: World): void {
    for (const [id, g] of fireGraphics) {
      const room = w.rooms.get(id);
      if (!room) continue;
      g.clear();
      const baseY = floorBaseY(room.floor);
      const width = room.width * TILE_PX;
      // One flame per tile and a half, a tile tall at the least, a gap of three eighths of a tile between.
      const flames = Math.max(2, Math.floor(width / (1.5 * TILE_PX)));
      const gap = (3 * TILE_PX) / 8;
      for (let i = 0; i < flames; i++) {
        const jitter = reducedMotion ? 0.5 : flickerNext();
        const h = TILE_PX + jitter * (room.height * FLOOR_PX - 1.25 * TILE_PX);
        const x = room.x * TILE_PX + (i + 0.2) * (width / flames);
        g.rect(x, baseY - h, Math.max(gap, width / flames - gap), h).fill(jitter > 0.6 ? 0xffd27a : 0xff5c4d);
      }
    }
  }

  function drawOverlay(w: World): void {
    if (ghost) {
      const texture = art.ghost(ghost.widthTiles, ghost.heightFloors, ghost.ok);
      ghostSprite.texture = texture;
      ghostSprite.visible = true;
      ghostSprite.position.set(ghost.x * TILE_PX, floorTopY(spanTop(ghost.floor, ghost.heightFloors)));
      ghostSprite.setSize(ghost.widthTiles * TILE_PX, ghost.heightFloors * FLOOR_PX);
    } else {
      ghostSprite.visible = false;
    }

    selectionBox.clear();
    selectionBox.visible = false;
    selectionRect = null;
    if (!selection) return;
    let box: { x: number; y: number; w: number; h: number } | null = null;
    if (selection.roomId !== undefined) {
      const room = w.rooms.get(selection.roomId);
      if (room) {
        box = {
          x: room.x * TILE_PX,
          y: floorTopY(room.floor + room.height - 1),
          w: room.width * TILE_PX,
          h: room.height * FLOOR_PX,
        };
      }
    } else if (selection.shaftId !== undefined) {
      const shaft = w.shafts.get(selection.shaftId);
      if (shaft) {
        box = {
          x: shaft.x * TILE_PX,
          y: floorTopY(shaft.floorMax),
          w: shaft.width * TILE_PX,
          h: shaftFloorSpan(shaft) * FLOOR_PX,
        };
      }
    } else if (selection.simId !== undefined) {
      // Round the person where this frame drew them, and only if it did: nobody is ringed at
      // the middle of a room, on the hall floor under a car, or outside the one in four sample.
      const at = w.sims.has(selection.simId) ? drawnAt.get(selection.simId) : undefined;
      if (at) {
        box = {
          x: at.x - SIM_WIDTH_PX / 2 - SELECT_PAD_PX,
          y: at.y - SIM_HEIGHT_PX - SELECT_PAD_PX,
          w: SIM_WIDTH_PX + 2 * SELECT_PAD_PX,
          h: SIM_HEIGHT_PX + 2 * SELECT_PAD_PX,
        };
      }
    }
    if (!box) return;
    selectionRect = box;
    selectionBox.visible = true;
    selectionBox.rect(box.x, box.y, box.w, box.h).stroke({ width: SELECT_PAD_PX, color: 0xf4b942, alignment: 0 });
  }

  function screenToWorldPoint(sx: number, sy: number): { x: number; y: number } {
    return camera.screenToWorld(sx, sy);
  }

  function screenToTile(sx: number, sy: number): { floor: number; x: number } {
    const point = screenToWorldPoint(sx, sy);
    return { floor: yToFloor(point.y), x: xToTile(point.x) };
  }

  function pickAt(sx: number, sy: number): void {
    if (pickListeners.length === 0) return;
    const point = screenToWorldPoint(sx, sy);
    const floor = yToFloor(point.y);
    const tile = xToTile(point.x);
    const tileFloat = point.x / TILE_PX;

    // A person is picked where the last frame drew them, and only if it did: at far zoom
    // nobody is drawn but the selected person, so a tap there picks the room under it.
    const best = plan.people === 'selected' ? null : pickSimAt(lastWorld.sims.values(), floor, tileFloat, sampleCrowd, drawnAt);

    let hit: PickHit;
    if (best) hit = { simId: best.id, floor, x: tile };
    else {
      const target = pickTargetAt(lastWorld, floor, tile);
      hit = target ? { ...target, floor, x: tile } : { floor, x: tile };
    }
    for (const cb of pickListeners) cb(hit);
  }

  // Input. All coordinates are canvas relative CSS pixels.
  function localPoint(event: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = app.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  let dragPointer: number | null = null;
  let downX = 0;
  let downY = 0;
  let downTime = 0;
  let downTouch = false;
  let moved = false;
  let tapCandidate = false;
  let panning = false;
  // On while the held tool draws with the left drag: the lobby brush and the shaft span.
  let toolOwnsDrag = false;
  // Space held is a pan override. The UI also uses space to pause, so it is read,
  // never swallowed.
  let spaceHeld = false;

  // Every pointer currently down on the view, in the order it landed. One is a drag, two are
  // a pinch, and the tail of a three finger fumble is ignored rather than fought with.
  const pointers = new Map<number, Point>();
  // The two fingers a pinch is reading, and where they were on the last move.
  let pinchIds: [number, number] | null = null;
  let pinchPrev: FingerPair | null = null;

  /** The slop a pointer of this kind is allowed: a finger is fatter than a mouse. */
  const slopFor = (touch: boolean): number => (touch ? TOUCH_SLOP_PX : PRESS_SLOP_PX);

  /** Pointer gestures all pass through here, so setPanEnabled(false) silences every one of them. */
  const beginPan = (sx: number, sy: number, timeMs: number): void => {
    if (panning || !camera.isPanEnabled()) return;
    camera.dragStart(sx, sy, timeMs, true);
    panning = true;
  };

  const endPan = (): void => {
    camera.dragEnd();
    panning = false;
  };

  /** Hand the whole gesture to the camera, from wherever the fingers are now. */
  const startPinch = (ids: [number, number], timeMs: number): void => {
    const a = pointers.get(ids[0]);
    const b = pointers.get(ids[1]);
    if (!a || !b) return;
    pinchIds = ids;
    pinchPrev = { a: { ...a }, b: { ...b } };
    // Whatever the first finger was doing, the camera restarts from the midpoint, so the
    // view does not jump by the distance between that finger and the middle of the pair.
    endPan();
    dragPointer = null;
    tapCandidate = false;
    moved = true;
    beginPan((a.x + b.x) / 2, (a.y + b.y) / 2, timeMs);
  };

  const endPinch = (): void => {
    pinchIds = null;
    pinchPrev = null;
    endPan();
  };

  /** Two fingers left on the view after one lifted: keep the gesture, on the new pair. */
  const regrip = (timeMs: number): void => {
    const ids = [...pointers.keys()];
    if (ids.length >= 2) {
      startPinch([ids[0] as number, ids[1] as number], timeMs);
      return;
    }
    endPinch();
    const [id] = ids;
    const rest = id === undefined ? undefined : pointers.get(id);
    if (id === undefined || !rest) return;
    // One finger still down: it goes on panning from where it is, and places nothing.
    dragPointer = id;
    downX = rest.x;
    downY = rest.y;
    downTime = timeMs;
    moved = true;
    tapCandidate = false;
    beginPan(rest.x, rest.y, timeMs);
  };

  const onPointerDown = (event: PointerEvent): void => {
    const middle = event.button === 1;
    const right = event.button === 2;
    if (event.button !== 0 && !middle && !right) return;
    if (middle || right) event.preventDefault(); // no autoscroll, no menu
    const p = localPoint(event);
    pointers.set(event.pointerId, p);
    try {
      app.canvas.setPointerCapture(event.pointerId);
    } catch {
      // capture is a nicety, dragging still works without it
    }
    // A press on the view means the player owns the camera now.
    userMoved = true;
    if (pointers.size >= 2) {
      // A second finger: the camera takes the gesture whatever tool is in hand, which is how
      // the lobby and elevator tools keep their one finger drag and still let the view move.
      const ids = [...pointers.keys()];
      startPinch([ids[0] as number, ids[1] as number], event.timeStamp);
      return;
    }
    dragPointer = event.pointerId;
    downX = p.x;
    downY = p.y;
    downTime = event.timeStamp;
    downTouch = event.pointerType === 'touch';
    moved = false;
    panning = false;
    tapCandidate = event.button === 0;
    // Middle, right and space held pan from the first pixel. A plain left press waits to see
    // whether it travels: a press that holds still is a click, one that moves is a pan.
    if (middle || right || spaceHeld) {
      tapCandidate = false;
      beginPan(p.x, p.y, event.timeStamp);
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, localPoint(event));
    if (pinchIds) {
      if (!pinchIds.includes(event.pointerId)) return; // a third finger along for the ride
      const a = pointers.get(pinchIds[0]);
      const b = pointers.get(pinchIds[1]);
      if (!a || !b || !pinchPrev) return;
      const next: FingerPair = { a: { ...a }, b: { ...b } };
      const gesture = pinchGesture(pinchPrev, next);
      pinchPrev = next;
      // The span zooms toward the point the hand is holding, the midpoint pans, and both go
      // through the paths the wheel and the mouse drag already use.
      if (gesture.scale !== 1) camera.zoomAt(gesture.scale, gesture.mid.x, gesture.mid.y);
      camera.dragMove(gesture.mid.x, gesture.mid.y, event.timeStamp);
      return;
    }
    if (dragPointer !== event.pointerId) return;
    const p = localPoint(event);
    if (classifyPress({ x: downX, y: downY }, p, slopFor(downTouch)) === 'pan') moved = true;
    if (moved && tapCandidate && !toolOwnsDrag) {
      // The press turned into a pan, so the camera picks it up from where the finger went down.
      tapCandidate = false;
      beginPan(downX, downY, downTime);
    }
    camera.dragMove(p.x, p.y, event.timeStamp);
  };

  const onPointerUp = (event: PointerEvent): void => {
    pointers.delete(event.pointerId);
    try {
      app.canvas.releasePointerCapture(event.pointerId);
    } catch {
      // already released
    }
    if (pinchIds) {
      if (pinchIds.includes(event.pointerId)) regrip(event.timeStamp);
      return; // a gesture that grew a second finger never places anything
    }
    if (dragPointer !== event.pointerId) return;
    dragPointer = null;
    endPan();
    const p = localPoint(event);
    const elapsed = event.timeStamp - downTime;
    const tapped = downTouch
      ? isTap({ x: downX, y: downY }, p, elapsed, TOUCH_SLOP_PX)
      : !moved && elapsed < CLICK_MS;
    if (tapCandidate && !moved && tapped) pickAt(p.x, p.y);
    tapCandidate = false;
  };

  const onPointerCancel = (event: PointerEvent): void => {
    pointers.delete(event.pointerId);
    if (pinchIds) {
      if (pinchIds.includes(event.pointerId)) regrip(event.timeStamp);
      return;
    }
    if (dragPointer !== null && dragPointer !== event.pointerId) return;
    dragPointer = null;
    tapCandidate = false;
    endPan();
  };

  // The right button is a pan handle here, so the browser menu never opens on the view.
  const onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const p = localPoint(event);
    userMoved = true;
    camera.wheelAt(wheelGesture(event, app.screen.height), p.x, p.y);
  };

  const typingTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (typingTarget(event.target)) return;
    // Read space, never preventDefault it: the UI still pauses on it.
    if (event.code === 'Space') spaceHeld = true;
    // Home is the way back for a player who has scrolled off into the concrete.
    if (event.code === 'Home') {
      frameInitial();
      return;
    }
    // Plus and minus zoom toward the middle of the view. Ctrl and meta are the browser's own zoom.
    if (!event.ctrlKey && !event.metaKey) {
      if (event.code === 'Equal' || event.code === 'NumpadAdd' || event.key === '+' || event.key === '=') {
        userMoved = true;
        camera.zoomStep(1);
        return;
      }
      if (event.code === 'Minus' || event.code === 'NumpadSubtract' || event.key === '-' || event.key === '_') {
        userMoved = true;
        camera.zoomStep(-1);
        return;
      }
    }
    // A key pressed with Cmd, Ctrl or Alt is a shortcut (Cmd+A, Ctrl+S), never a pan: the
    // browser may not deliver its keyup, and a held pan key would drift the view for good.
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.code.startsWith('Key') || event.code.startsWith('Arrow')) userMoved = true;
    camera.setKey(event.code, true);
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space') spaceHeld = false;
    camera.setKey(event.code, false);
  };
  const onBlur = (): void => {
    spaceHeld = false;
    camera.clearKeys();
    // A gesture interrupted by a tab switch leaves fingers that will never lift, and a
    // stale finger would make the next press look like the second half of a pinch.
    pointers.clear();
    dragPointer = null;
    tapCandidate = false;
    endPinch();
  };

  app.canvas.addEventListener('pointerdown', onPointerDown);
  app.canvas.addEventListener('pointermove', onPointerMove);
  app.canvas.addEventListener('pointerup', onPointerUp);
  app.canvas.addEventListener('pointercancel', onPointerCancel);
  app.canvas.addEventListener('wheel', onWheel, { passive: false });
  app.canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  // Per frame: camera, transforms, sky, ambient motion.
  // Set by the first render() call; the fade starts on the wall clock at the next frame.
  let firstRendered = false;
  let fadeStart: number | null = null;
  let ambientReduced = reducedMotion;
  let flickerLeft = 0;
  let lastBackground = -1;
  let lastLightMinute = -1;
  let lastW = -1;
  let lastH = -1;

  const onFrame = (): void => {
    const dt = app.ticker.deltaMS;
    const width = app.screen.width;
    const height = app.screen.height;
    if (width !== lastW || height !== lastH) {
      camera.setViewport(width, height);
      lastW = width;
      lastH = height;
      // Hold the opening composition only until the player first touches the view,
      // and only while the layout is still settling.
      if (!userMoved && !framedOnce && performance.now() - bornAt < FRAME_GRACE_MS) frameInitial();
    }
    camera.update(dt);

    worldRoot.scale.set(camera.zoom);
    worldRoot.position.set(width / 2 - camera.x * camera.zoom, height / 2 - camera.y * camera.zoom);
    // The overlay (ghost, selection, information tint) lives above the light layer but is drawn
    // in world pixels, so it takes the same camera transform.
    overlayRoot.scale.set(camera.zoom);
    overlayRoot.position.copyFrom(worldRoot.position);
    emissiveRoot.scale.set(camera.zoom);
    emissiveRoot.position.copyFrom(worldRoot.position);

    const clock = clockOf(lastWorld.time.minute);
    // One weather snapshot a frame, eased in real time: the fade runs under reduced motion too.
    weatherView = easeView(weatherView, weatherNow(lastWorld.seed, lastWorld.time.minute), dt);
    // The status bar names the weather this view draws (F3: never Rain over a dry street).
    publishWeatherView(lastWorld.seed, weatherView);
    sky.update(clock.minuteOfDay, camera, width, height, reducedMotion ? 0 : dt, { view: weatherView, seed: lastWorld.seed });
    const background = weatherSkyColor(skyBackground(clock.minuteOfDay), weatherView);
    weatherFx.update({
      view: weatherView,
      seed: lastWorld.seed,
      night: nightness(clock.minuteOfDay),
      viewW: width,
      viewH: height,
      originX: worldRoot.position.x,
      originY: worldRoot.position.y,
      zoom: camera.zoom,
      floors: weatherFloors,
      basement: weatherBasement,
      doors: curbDoors,
      skyColor: background,
      dtMs: dt,
      reducedMotion,
    });
    applyTier(zoomTier(camera.zoom));
    sweepAge += dt;
    if (sweepAge >= SWEEP_EVERY_MS && art.sweep) {
      sweepAge = 0;
      const live = new Set<Texture>();
      for (const entry of simSprites.values()) live.add(entry.node.texture);
      for (const v of venueSprites.values()) if (v.staff) live.add(v.staff.texture);
      live.add(soloSprite.texture);
      curb.textures(live);
      art.sweep(live, PERSON_IDLE_MS);
    }
    if (plan.blocks) {
      blocksAge += dt;
      if (blocksDirty || blocksAge >= BLOCKS_REFRESH_MS) rebuildBlocks(lastWorld);
    } else if (plan.facade) {
      if (facadeDirty) rebuildFacade(lastWorld);
    } else if (plan.windowVeil > 0 && veilDirty) rebuildVeil(lastWorld);
    curb.update({
      world: lastWorld,
      view: weatherView,
      doors: curbDoors,
      lookOf: (sim) => lookOf(lastWorld, sim),
      nowMs: performance.now(),
      dtMs: dt,
      reducedMotion,
      people: plan.ambient,
      viewLeft: camera.x - width / 2 / camera.zoom,
      viewRight: camera.x + width / 2 / camera.zoom,
      inTower: drawn,
    });
    const lightMinute = Math.floor(clock.minuteOfDay);
    const lightTint = weatherLightTint(lightTintAt(lightMinute), weatherView);
    if (lightMinute !== lastLightMinute || lightTint !== lightSprite.tint) {
      lightSprite.tint = lightTint;
      lastLightMinute = lightMinute;
    }
    if (lightSprite.width !== width || lightSprite.height !== height) lightSprite.setSize(width, height);
    if (background !== lastBackground) {
      app.renderer.background.color = background;
      lastBackground = background;
    }

    for (const entry of carSprites.values()) {
      stepCarDoors(entry, dt);
      entry.settle = Math.max(0, entry.settle - dt);
    }
    if (reducedMotion !== ambientReduced) {
      // Everything ambient stops at once when reduced motion comes on: the emitters go and
      // running build feedback lands. (Their sprites live in layers.effects, so app.destroy
      // takes them with it.)
      ambientReduced = reducedMotion;
      ambient.sync(lastWorld, reducedMotion);
      if (reducedMotion) buildFx.clear();
    }
    ambient.update(dt, isNight(clock.minuteOfDay), lastWorld.time.minute);
    buildFx.update(dt);

    if (fireGraphics.size > 0) {
      flickerLeft -= dt;
      if (flickerLeft <= 0) {
        flickerLeft = FIRE_FLICKER_MS;
        drawFires(lastWorld);
      }
    }

    // Wall clock time, not the ticker's capped frame time, so a slow first bake cannot stretch
    // it. Under reduced motion there is no fade: the cover goes once the first frame is drawn.
    if (fadeCover.visible) {
      let alpha = 1;
      if (firstRendered) {
        if (reducedMotion) alpha = 0;
        else {
          const now = performance.now();
          fadeStart ??= now;
          alpha = Math.max(0, 1 - (now - fadeStart) / LOAD_FADE_MS);
        }
      }
      fadeCover.clear();
      if (alpha > 0) fadeCover.rect(0, 0, width, height).fill({ color: FADE_COLOR, alpha });
      else fadeCover.visible = false;
    }
  };
  app.ticker.add(onFrame);

  /**
   * A different world object is a different tower (a load, a new game, Today's tower, a
   * friend's link). Ids restart at 1 in every world, so nothing kept by id (room, slab, venue,
   * shaft, car and person sprites), by the built signature (floor strips, curb doors, weather
   * boxes) or by real time (the eased weather, the wet street, the street's sample) may carry
   * over: all of it is dropped here, and the next pass builds the new tower as a fresh
   * renderer would, with no build feedback, under the new tower's weather settled.
   */
  function worldReplaced(w: World): void {
    for (const entry of roomSprites.values()) entry.node.destroy();
    roomSprites.clear();
    for (const entry of slabSprites.values()) entry.node.destroy();
    slabSprites.clear();
    for (const [id, entry] of [...venueSprites]) dropVenue(id, entry);
    for (const entry of shaftSprites.values()) for (const part of entry.parts) part.destroy();
    shaftSprites.clear();
    for (const entry of carSprites.values()) {
      entry.node.destroy();
      entry.cable.destroy();
      entry.indicator.destroy();
    }
    carSprites.clear();
    for (const [id, entry] of [...simSprites]) dropSimEntry(id, entry);
    leaveParticleMode();
    for (const g of fireGraphics.values()) g.destroy();
    fireGraphics.clear();
    drawnAt.clear();
    carMotion.reset();
    simMotion.reset();
    simSteps.clear();
    lookCodes.clear();
    buildFx.clear();
    stripSignature = -1;
    curbDoors = null;
    weatherFloors = [];
    weatherBasement = null;
    reconciledWorld = null;
    reconciledVersion = -1;
    lastLitState = -1;
    venueClock = -1;
    veilDirty = true;
    blocksDirty = true;
    facadeDirty = true;
    weatherView = settledView(weatherNow(w.seed, w.time.minute));
    publishWeatherView(w.seed, weatherView);
    weatherFx.reset();
    curb.reset();
  }

  frameInitial();

  const renderer: Renderer = {
    render(w: World, alpha: number): void {
      if (w !== lastWorld) worldReplaced(w);
      lastWorld = w;
      const clock = clockOf(w.time.minute);
      const night = isNight(clock.minuteOfDay);
      reconcileStaticTower(w, night, clock.minuteOfDay);
      const bucket = Math.floor(w.time.minute / VENUE_CLOCK_MINUTES);
      if (bucket !== venueClock) {
        venueClock = bucket;
        updateVenues(w, night);
      }
      reconcileCars(w, alpha);
      reconcileSims(w, alpha);
      drawOverlay(w);
      // The information views: every frame while one is on, whatever the structure version says.
      const halfW = app.screen.width / 2 / camera.zoom;
      const halfH = app.screen.height / 2 / camera.zoom;
      overlayView.left = camera.x - halfW;
      overlayView.right = camera.x + halfW;
      overlayView.top = camera.y - halfH;
      overlayView.bottom = camera.y + halfH;
      overlayPass.draw(w, overlayView, ghost);
      firstRendered = true;
    },
    commitMotion,
    resetMotion(): void {
      carMotion.reset();
      simMotion.reset();
      simSteps.clear();
      lookCodes.clear();
      buildFx.clear();
      // A replaced world is always reconciled in full on the next render.
      reconciledWorld = null;
      reconciledVersion = -1;
    },
    // The band is static world geometry under the shared camera, so it is drawn once per change
    // and never per frame. Its Graphics is made on first use and sits under the ghost.
    setGuideBand: (() => {
      let band: Graphics | null = null;
      return (next: { floorMin: number; floorMax: number; xMin: number; xMax: number } | null): void => {
        if (!next) {
          if (band) band.visible = false;
          return;
        }
        if (!band) {
          band = new Graphics();
          layers.overlay.addChildAt(band, 0);
        }
        const x = next.xMin * TILE_PX;
        const y = floorTopY(next.floorMax);
        const w = (next.xMax - next.xMin + 1) * TILE_PX;
        const h = (next.floorMax - next.floorMin + 1) * FLOOR_PX;
        band.clear();
        band.rect(x, y, w, h).fill({ color: 0xf4b942, alpha: 0.22 });
        band.rect(x, y, w, h).stroke({ width: 2, color: 0xf4b942, alpha: 0.85, alignment: 1 });
        band.visible = true;
      };
    })(),
    setOverlay(kind): void {
      overlayPass.set(kind);
      // The Districts view steps the shafts back to a faint column; the cars stay at full strength.
      // Alpha only: the far tier's facade owns shaftLayer.visible (applyTier), so the two never fight.
      shaftLayer.alpha = kind === 'districts' ? DISTRICTS_SHAFT_ALPHA : 1;
    },
    setOverlayColorBlind(on): void {
      overlayPass.setColorBlind(on);
    },
    camera,
    screenToTile,
    setGhost(g): void {
      if (!g && ghost && art.dropGhosts) {
        // The placement ended: let go of the sprite's texture, then free every ghost bake.
        ghostSprite.texture = Texture.EMPTY;
        ghostSprite.visible = false;
        art.dropGhosts();
      }
      ghost = g;
    },
    ghostScreenRect(): { x: number; y: number; w: number; h: number } | null {
      if (!ghost) return null;
      // The same two corners drawOverlay places the sprite between, put through the camera.
      const left = ghost.x * TILE_PX;
      const top = floorTopY(spanTop(ghost.floor, ghost.heightFloors));
      const near = camera.worldToScreen(left, top);
      const far = camera.worldToScreen(
        left + ghost.widthTiles * TILE_PX,
        top + ghost.heightFloors * FLOOR_PX,
      );
      return { x: near.x, y: near.y, w: far.x - near.x, h: far.y - near.y };
    },
    selectionScreenRect(): { x: number; y: number; w: number; h: number } | null {
      if (!selectionRect) return null;
      // The same mapping as ghostScreenRect: the box's two corners, put through the camera.
      const near = camera.worldToScreen(selectionRect.x, selectionRect.y);
      const far = camera.worldToScreen(selectionRect.x + selectionRect.w, selectionRect.y + selectionRect.h);
      return { x: near.x, y: near.y, w: far.x - near.x, h: far.y - near.y };
    },
    setSelection(sel): void {
      selection = sel;
      selectionRect = null; // the old ring's box, until a frame draws the new one
    },
    onPick(cb): void {
      pickListeners.push(cb);
    },
    setPanEnabled(on): void {
      camera.setPanEnabled(on);
    },
    setToolOwnsDrag(on): void {
      toolOwnsDrag = on;
    },
    setChrome(topPx, bottomPx): void {
      camera.setObstruction(topPx, bottomPx);
      chromeTop = Number.isFinite(topPx) ? Math.max(0, topPx) : 0;
      chromeBottom = Number.isFinite(bottomPx) ? Math.max(0, bottomPx) : 0;
      chromeKnown = true;
      // The opening shot is still the game's to compose until the player takes the view.
      if (!userMoved) frameInitial();
    },
    setReducedMotion(on): void {
      reducedMotion = on;
      camera.setReducedMotion(on);
      // No fade under reduced motion: a cover still up goes once the first frame is drawn.
      if (on && firstRendered && fadeCover.visible) {
        fadeCover.clear();
        fadeCover.visible = false;
      }
    },
    snapshot(): HTMLCanvasElement {
      return app.renderer.extract.canvas({ target: app.stage }) as HTMLCanvasElement;
    },
    destroy(): void {
      app.canvas.removeEventListener('pointerdown', onPointerDown);
      app.canvas.removeEventListener('pointermove', onPointerMove);
      app.canvas.removeEventListener('pointerup', onPointerUp);
      app.canvas.removeEventListener('pointercancel', onPointerCancel);
      app.canvas.removeEventListener('wheel', onWheel);
      app.canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      app.ticker.remove(onFrame);
      pickListeners.length = 0;
      sky.destroy();
      weatherFx.destroy();
      publishWeatherView(0, null);
      curb.destroy();
      leaveParticleMode();
      crowdAtlas = null;
      app.destroy({ removeView: true }, { children: true });
    },
    thumbnail: createThumbnails({ art: () => art, extract: (t) => app.renderer.extract.canvas(t) as HTMLCanvasElement }),
  };

  // The capture path, dev only like ?smoke: the capture scripts read the camera and the texture
  // budget through this. Nothing is exposed in a production build.
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    (window as unknown as { __hsRender?: unknown }).__hsRender = {
      renderer,
      stats: () => art.stats?.() ?? null,
      drawn: () => ({
        people: simSprites.size,
        commuters: curb.count(),
        venues: venueSprites.size,
        posts: [...venueSprites.values()].filter((v) => v.staff?.visible).map((v) => v.kind),
      }),
      // The drawn people with a stress mark, and a pick as if tapped: the close capture selects one.
      stressed: () =>
        [...lastWorld.sims.values()].flatMap((sim) => {
          const band = stressBand(sim.stress);
          return drawn(sim) && band !== 'calm' ? [{ id: sim.id, kind: sim.kind, floor: sim.pos.floor, x: sim.pos.x, band, state: sim.state }] : [];
        }),
      pick: (hit: PickHit) => {
        for (const cb of pickListeners) cb(hit);
      },
    };
  }

  return renderer;
}

function averageRoomX(world: World): number {
  let total = 0;
  let count = 0;
  for (const room of world.rooms.values()) {
    total += room.x + room.width / 2;
    count++;
  }
  return count === 0 ? 187 : total / count;
}
