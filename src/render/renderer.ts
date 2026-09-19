// The tower view: one pixi Application, nine layers, and a sprite pool reconciled
// against the world every frame. See docs/DESIGN.md section 9 and docs/VISUAL.md.
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
  Graphics,
  Particle,
  ParticleContainer,
  Rectangle,
  RenderTexture,
  Sprite,
  Texture,
  type Renderer as PixiRenderer,
} from 'pixi.js';
import { stressBand } from '../sim/people';
import { ROOMS } from '../sim/rules';
import { clockOf, TOWER_WIDTH, type Car, type Id, type Room, type RoomKind, type Shaft, type Sim, type SimKind, type StressBand, type World } from '../sim/types';
import { roomsOnFloor, shaftAt } from '../sim/world';
import { createArt, FLOOR_PX, OVERLAY_KINDS, TILE_PX, type Art } from './art';
import {
  createCamera,
  floorBand,
  floorBaseY,
  floorTopY,
  floorYFloat,
  groundLineFor,
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
import { createSky, isNight, skyBackground, type Sky } from './sky';

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
}

export interface Selection {
  roomId?: Id;
  simId?: Id;
  shaftId?: Id;
}

export interface Renderer {
  render(world: World, alpha: number): void;
  camera: Camera;
  screenToTile(sx: number, sy: number): { floor: number; x: number };
  setGhost(g: null | Ghost): void;
  setSelection(sel: null | Selection): void;
  onPick(cb: (hit: PickHit) => void): void;
  /** Off for the landing hero: no pointer gesture pans. */
  setPanEnabled(on: boolean): void;
  /** On while the held tool draws with the left drag (lobby paint, shaft span), so it does not pan. */
  setToolOwnsDrag(on: boolean): void;
  setReducedMotion(on: boolean): void;
  destroy(): void;
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
 * player means. Shafts stay behind rooms in the pick, as they always have, so a lobby
 * segment under a column can still be reached.
 */
export function pickRoomAt(world: World, floor: number, x: number): Room | undefined {
  let found: Room | undefined;
  for (const room of roomsOnFloor(world, floor)) {
    if (x < room.x || x >= room.x + room.width) continue;
    if (!found || drawsOverRooms(room.kind)) found = room;
  }
  return found;
}

const SIM_WIDTH_PX = TILE_PX; // one tile wide, matching art.ts
const SIM_HEIGHT_PX = 3 * TILE_PX; // three tiles tall
const PARTICLE_THRESHOLD = 500;
const PARTICLE_RELEASE = 400; // hysteresis, so a crowd on the edge does not thrash
/** How long a mouse press may hold still and still count as a click. A finger gets no limit. */
const CLICK_MS = 600;
const FIRE_FLICKER_MS = 110;
const LOAD_FADE_MS = 900;
const SLAB_TOP_PX = 3; // art.ts draws the slab as the bottom 3 px of a floor band
const STRIP_ABOVE = 0xeaeaea;
const STRIP_BELOW = 0x7d818a;
const STRIP_EDGE = 0x333333;
const STRIP_CEILING = 0xcfcfcf;
const DOOR_HOLD_MS = 120; // minimum time the open door texture stays up
const TELEPORT_PX = 12 * TILE_PX; // a jump past this is a teleport, so snap instead of lerp
const FRAME_GRACE_MS = 2000; // after this the opening framing never reasserts itself

const SIM_KINDS: readonly SimKind[] = ['worker', 'resident', 'guest', 'shopper', 'diner', 'staff', 'visitor', 'vip'];
const STRESS_BANDS: readonly StressBand[] = ['calm', 'pink', 'red'];

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

interface Interp {
  px: number;
  py: number;
  cx: number;
  cy: number;
  minute: number; // sim minute the current target belongs to; a new minute with the same target means the sprite has settled
}

interface Keyed<T> {
  node: T;
  key: string;
}

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
    room(kind, width, height, variant, lit) {
      return get(`room|${kind}|${width}|${height}|${variant}|${lit}`, () =>
        canvasTexture(width * TILE_PX, height * FLOOR_PX, (ctx) => {
          const base = FALLBACK_ROOM_COLORS[kind] ?? 0x3a4556;
          // A connector is an overlay here too: a diagonal and an outline, no backing fill.
          if (drawsOverRooms(kind)) {
            ctx.strokeStyle = hex(base);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(2, ctx.canvas.height - 3);
            ctx.lineTo(ctx.canvas.width - 2, 3);
            ctx.stroke();
            ctx.lineWidth = 1;
            ctx.strokeStyle = hex(0x1c232e);
            ctx.strokeRect(0.5, 0.5, ctx.canvas.width - 1, ctx.canvas.height - 1);
            return;
          }
          ctx.fillStyle = hex(base);
          ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
          ctx.fillStyle = hex(lit ? 0xffd27a : 0x1a2233);
          for (let wx = 3; wx + 4 <= ctx.canvas.width - 3; wx += 10) {
            ctx.fillRect(wx, 6 + (variant % 2), 4, 8);
          }
          ctx.strokeStyle = hex(0x1c232e);
          ctx.strokeRect(0.5, 0.5, ctx.canvas.width - 1, ctx.canvas.height - 1);
        }),
      );
    },
    slab(widthTiles) {
      return get(`slab|${widthTiles}`, () =>
        canvasTexture(widthTiles * TILE_PX, 4, (ctx) => {
          ctx.fillStyle = hex(0x2f3238);
          ctx.fillRect(0, 0, ctx.canvas.width, 4);
          ctx.fillStyle = hex(0x4a4e57);
          ctx.fillRect(0, 0, ctx.canvas.width, 1);
        }),
      );
    },
    shaft(kind, floors) {
      return get(`shaft|${kind}|${floors}`, () =>
        canvasTexture(4 * TILE_PX, floors * FLOOR_PX, (ctx) => {
          ctx.fillStyle = hex(kind === 'express' ? 0x232b38 : kind === 'service' ? 0x1e242e : 0x242c3a);
          ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
          ctx.fillStyle = hex(0x3a4556);
          ctx.fillRect(0, 0, 2, ctx.canvas.height);
          ctx.fillRect(ctx.canvas.width - 2, 0, 2, ctx.canvas.height);
        }),
      );
    },
    car(kind, doorsOpen) {
      return get(`car|${kind}|${doorsOpen}`, () =>
        canvasTexture(4 * TILE_PX, FLOOR_PX, (ctx) => {
          ctx.fillStyle = hex(0x8b93a3);
          ctx.fillRect(0, 2, ctx.canvas.width, ctx.canvas.height - 4);
          ctx.fillStyle = hex(doorsOpen ? 0xffd27a : 0x28313f);
          ctx.fillRect(3, 5, ctx.canvas.width - 6, ctx.canvas.height - 10);
        }),
      );
    },
    sim(_kind, band, frame) {
      return get(`sim|${band}|${frame}`, () =>
        canvasTexture(SIM_WIDTH_PX, SIM_HEIGHT_PX, (ctx) => {
          ctx.fillStyle = hex(FALLBACK_BAND_COLORS[band]);
          ctx.fillRect(2, 2, 4, 3); // head
          ctx.fillRect(frame === 0 ? 2 : 1, 5, 4, SIM_HEIGHT_PX - 5); // body and legs, a pixel over on the step
        }),
      );
    },
    ghost(widthTiles, heightFloors, ok) {
      return get(`ghost|${widthTiles}|${heightFloors}|${ok}`, () =>
        canvasTexture(widthTiles * TILE_PX, heightFloors * FLOOR_PX, (ctx) => {
          ctx.fillStyle = ok ? 'rgba(244,185,66,0.30)' : 'rgba(255,92,77,0.30)';
          ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
          ctx.strokeStyle = ok ? hex(0xf4b942) : hex(0xff5c4d);
          ctx.lineWidth = 2;
          ctx.strokeRect(1, 1, ctx.canvas.width - 2, ctx.canvas.height - 2);
        }),
      );
    },
  };
}

/** Wraps the real art module so a throw from any one call degrades to the fallback. */
function guardArt(primary: Art, backup: Art): Art {
  let broken = false;
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
  return {
    room: (kind, width, height, variant, lit) => call('room', (a) => a.room(kind, width, height, variant, lit)),
    slab: (widthTiles) => call('slab', (a) => a.slab(widthTiles)),
    shaft: (kind, floors) => call('shaft', (a) => a.shaft(kind, floors)),
    car: (kind, doorsOpen) => call('car', (a) => a.car(kind, doorsOpen)),
    sim: (kind, band, frame) => call('sim', (a) => a.sim(kind, band, frame)),
    ghost: (widthTiles, heightFloors, ok) => call('ghost', (a) => a.ghost(widthTiles, heightFloors, ok)),
  };
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
    for (let f = room.floor; f < room.floor + room.height; f++) cover(f, room.x, room.x + room.width);
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

export async function createRenderer(container: HTMLElement, world: World): Promise<Renderer> {
  const app = new Application();
  await app.init({
    resizeTo: container,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    antialias: false,
    roundPixels: true,
    background: skyBackground(clockOf(world.time.minute).minuteOfDay),
  });

  app.canvas.style.display = 'block';
  app.canvas.style.touchAction = 'none';
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
    overlay: new Container(),
  };
  // Everything from ground forward shares the camera transform.
  const worldRoot = new Container();
  worldRoot.addChild(layers.ground, layers.tower, layers.cars, layers.sims, layers.effects, layers.overlay);
  app.stage.addChild(layers.sky, layers.cityFar, layers.cityNear, worldRoot);

  const slabLayer = new Container();
  const roomLayer = new Container();
  const shaftLayer = new Container();
  // Stairs and escalators are rooms, but they overlay the rooms they cross, so they
  // are drawn last of all, with no backing fill (art.ts OVERLAY_KINDS).
  const connectorLayer = new Container();
  // Behind everything in the tower: a continuous floor across each built floor,
  // so a sim between two rooms is never walking on sky.
  const floorStrips = new Graphics();
  layers.tower.addChild(floorStrips, slabLayer, roomLayer, shaftLayer, connectorLayer);

  const simSpriteLayer = new Container();
  layers.sims.addChild(simSpriteLayer);

  const fadeCover = new Graphics();
  app.stage.addChild(fadeCover);

  let art: Art;
  const backup = fallbackArt(app.renderer as PixiRenderer);
  try {
    art = guardArt(createArt(app.renderer as PixiRenderer), backup);
  } catch (error) {
    console.warn('render: createArt failed, drawing flat rectangles', error);
    art = backup;
  }

  const camera = createCamera();
  camera.setViewport(app.screen.width, app.screen.height);
  const sky: Sky = createSky(layers);

  let reducedMotion =
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  camera.setReducedMotion(reducedMotion);

  let lastWorld: World = world;

  // Opening composition: the street sits about two thirds down, so the empty lot
  // reads as a stage with room for the tower to grow into the sky.
  let userMoved = false;
  let framedOnce = false;
  const bornAt = performance.now();
  function frameInitial(): void {
    camera.reset(); // zoom 1, no inertia, street at the default ground line
    const x = lastWorld.rooms.size > 0 ? averageRoomX(lastWorld) : TOWER_WIDTH / 2;
    camera.centerOn(6, Math.round(x));
    camera.setGroundLine(groundLineFor(app.screen.width));
    if (app.screen.width > 1 && app.screen.height > 1) framedOnce = true;
  }

  let ghost: Ghost | null = null;
  let selection: Selection | null = null;
  const pickListeners: ((hit: PickHit) => void)[] = [];

  const roomSprites = new Map<Id, Keyed<Sprite>>();
  const slabSprites = new Map<Id, Keyed<Sprite>>();
  const shaftSprites = new Map<Id, Keyed<Sprite>>();
  const carSprites = new Map<Id, Keyed<Sprite>>();
  const simSprites = new Map<Id, Keyed<Sprite>>();
  const fireGraphics = new Map<Id, Graphics>();
  const doorHold = new Map<Id, number>(); // car id -> time the open door texture may end
  const interp = new Map<string, Interp>();
  let renderMinute = 0;

  const ghostSprite = new Sprite();
  ghostSprite.visible = false;
  const selectionBox = new Graphics();
  selectionBox.visible = false;
  layers.overlay.addChild(ghostSprite, selectionBox);

  // Sim particle mode: one shared atlas so every particle draws from one source.
  let particles: ParticleContainer | null = null;
  let particleAtlas: Map<string, Texture> | null = null;
  let atlasTexture: RenderTexture | null = null;
  let particleMode = false;
  const simParticles = new Map<Id, Particle>();

  function buildParticleAtlas(): Map<string, Texture> | null {
    try {
      const cols = SIM_KINDS.length;
      const rows = STRESS_BANDS.length * 2;
      const rt = RenderTexture.create({
        width: cols * SIM_WIDTH_PX,
        height: rows * SIM_HEIGHT_PX,
        antialias: false,
        scaleMode: 'nearest',
      });
      const staging = new Container();
      const map = new Map<string, Texture>();
      for (let c = 0; c < cols; c++) {
        const kind = SIM_KINDS[c] as SimKind;
        for (let b = 0; b < STRESS_BANDS.length; b++) {
          const band = STRESS_BANDS[b] as StressBand;
          for (const frame of [0, 1] as const) {
            const row = b * 2 + frame;
            const sprite = new Sprite(art.sim(kind, band, frame));
            sprite.position.set(c * SIM_WIDTH_PX, row * SIM_HEIGHT_PX);
            sprite.setSize(SIM_WIDTH_PX, SIM_HEIGHT_PX);
            staging.addChild(sprite);
            map.set(
              `${kind}|${band}|${frame}`,
              new Texture({
                source: rt.source,
                frame: new Rectangle(c * SIM_WIDTH_PX, row * SIM_HEIGHT_PX, SIM_WIDTH_PX, SIM_HEIGHT_PX),
              }),
            );
          }
        }
      }
      app.renderer.render({ container: staging, target: rt });
      staging.destroy({ children: true });
      atlasTexture = rt;
      return map;
    } catch (error) {
      console.warn('render: sim atlas failed, staying on sprites', error);
      return null;
    }
  }

  function enterParticleMode(): boolean {
    if (particles) return true;
    const atlas = particleAtlas ?? buildParticleAtlas();
    if (!atlas) return false;
    particleAtlas = atlas;
    const first = atlas.values().next().value;
    particles = new ParticleContainer({
      ...(first ? { texture: first } : {}),
      dynamicProperties: { position: true, uvs: true, color: false, rotation: false, vertex: false },
      roundPixels: true,
      boundsArea: new Rectangle(-4000, -4000, 20000, 20000),
    });
    layers.sims.addChild(particles);
    for (const [id, entry] of simSprites) {
      entry.node.destroy();
      simSprites.delete(id);
    }
    simSpriteLayer.removeChildren();
    particleMode = true;
    return true;
  }

  function leaveParticleMode(): void {
    if (!particles) return;
    particles.destroy();
    particles = null;
    simParticles.clear();
    particleMode = false;
  }

  function interpolated(key: string, x: number, y: number, alpha: number): { x: number; y: number } {
    let entry = interp.get(key);
    if (!entry) {
      entry = { px: x, py: y, cx: x, cy: y, minute: renderMinute };
      interp.set(key, entry);
    } else if (entry.cx === x && entry.cy === y) {
      // Same target on a later sim minute: the thing has stopped. Settle the previous position on it,
      // otherwise every tick would re-lerp from where it was a minute ago and a parked car bounces.
      if (entry.minute !== renderMinute) {
        entry.px = x;
        entry.py = y;
        entry.minute = renderMinute;
      }
    } else {
      entry.minute = renderMinute;
      // A jump this big is a teleport, not a step: entering from an entrance,
      // alighting from a car, or several ticks landing in one frame. Snap.
      if (Math.abs(x - entry.cx) > TELEPORT_PX || Math.abs(y - entry.cy) > TELEPORT_PX) {
        entry.px = x;
        entry.py = y;
      } else {
        entry.px = entry.cx;
        entry.py = entry.cy;
      }
      entry.cx = x;
      entry.cy = y;
    }
    if (reducedMotion) return { x: entry.cx, y: entry.cy };
    const t = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    return { x: entry.px + (entry.cx - entry.px) * t, y: entry.py + (entry.cy - entry.py) * t };
  }

  /** Park an entity at a fixed point so it does not lerp away from it next frame. */
  function interpolateFrom(key: string, x: number, y: number): { x: number; y: number } {
    const entry = interp.get(key);
    if (!entry) interp.set(key, { px: x, py: y, cx: x, cy: y, minute: renderMinute });
    else {
      entry.px = x;
      entry.py = y;
      entry.cx = x;
      entry.cy = y;
    }
    return { x, y };
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
    floorStrips.clear();
    for (const [floor, extent] of extents) {
      const x = extent.min * TILE_PX;
      const width = (extent.max - extent.min) * TILE_PX;
      if (width <= 0) continue;
      const top = floorTopY(floor);
      floorStrips.rect(x, top, width, FLOOR_PX).fill(floor > 0 ? STRIP_ABOVE : STRIP_BELOW);
      floorStrips.rect(x, top, width, 1).fill(STRIP_CEILING);
      // The slab edge sits where art.ts draws it, SLAB_TOP_PX up from the bottom of
      // the band, so an empty stretch lines up with the rooms on either side.
      floorStrips.rect(x, top + FLOOR_PX - SLAB_TOP_PX, width, 1).fill(STRIP_EDGE);
    }
  }

  function syncFloorStrips(w: World): void {
    const sig = builtSignature(w);
    if (sig === stripSignature) return;
    stripSignature = sig;
    rebuildFloorStrips(w);
  }

  function reconcileRooms(w: World, night: boolean): void {
    const seenRooms = new Set<Id>();
    for (const room of w.rooms.values()) {
      seenRooms.add(room.id);
      const lit = night && room.occupancy > 0;
      // Lobby segments are one tile wide: alternating the variant per id would
      // stripe the lobby every 8 px, so narrow rooms pick their variant by x in
      // long runs and a continuous lobby reads as one room.
      const variant = room.width <= 2 ? Math.floor(room.x / 6) % 2 : room.id % 2;
      const topFloor = room.floor + room.height - 1;
      const px = room.x * TILE_PX;
      const py = floorTopY(topFloor);
      const pw = room.width * TILE_PX;
      const ph = room.height * FLOOR_PX;

      const slabKey = `${room.width}`;
      let slab = slabSprites.get(room.id);
      if (!slab) {
        const sprite = new Sprite(art.slab(room.width));
        slabLayer.addChild(sprite);
        slab = { node: sprite, key: slabKey };
        slabSprites.set(room.id, slab);
      } else if (slab.key !== slabKey) {
        slab.node.texture = art.slab(room.width);
        slab.key = slabKey;
      }
      const slabHeight = slab.node.texture.height || 4;
      slab.node.setSize(pw, slabHeight);
      slab.node.position.set(px, floorBaseY(room.floor) - slabHeight);

      const key = `${room.kind}|${room.width}|${room.height}|${variant}|${lit ? 1 : 0}`;
      let entry = roomSprites.get(room.id);
      if (!entry) {
        const sprite = new Sprite(art.room(room.kind, room.width, room.height, variant, lit));
        (drawsOverRooms(room.kind) ? connectorLayer : roomLayer).addChild(sprite);
        entry = { node: sprite, key };
        roomSprites.set(room.id, entry);
      } else if (entry.key !== key) {
        entry.node.texture = art.room(room.kind, room.width, room.height, variant, lit);
        entry.key = key;
      }
      entry.node.position.set(px, py);
      entry.node.setSize(pw, ph);
      entry.node.tint = room.onFire ? 0xff8a72 : 0xffffff;
    }

    for (const [id, entry] of roomSprites) {
      if (seenRooms.has(id)) continue;
      entry.node.destroy();
      roomSprites.delete(id);
    }
    for (const [id, entry] of slabSprites) {
      if (seenRooms.has(id)) continue;
      entry.node.destroy();
      slabSprites.delete(id);
    }
  }

  function reconcileShaftsAndCars(w: World, alpha: number): void {
    const seenShafts = new Set<Id>();
    const seenCars = new Set<Id>();
    for (const shaft of w.shafts.values()) {
      seenShafts.add(shaft.id);
      const floors = shaftFloorSpan(shaft);
      const key = `${shaft.kind}|${floors}`;
      let entry = shaftSprites.get(shaft.id);
      if (!entry) {
        const sprite = new Sprite(art.shaft(shaft.kind, floors));
        shaftLayer.addChild(sprite);
        entry = { node: sprite, key };
        shaftSprites.set(shaft.id, entry);
      } else if (entry.key !== key) {
        entry.node.texture = art.shaft(shaft.kind, floors);
        entry.key = key;
      }
      entry.node.position.set(shaft.x * TILE_PX, floorTopY(shaft.floorMax));
      entry.node.setSize(shaft.width * TILE_PX, floors * FLOOR_PX);

      for (const car of shaft.cars) {
        seenCars.add(car.id);
        drawCar(shaft, car, alpha);
      }
    }

    for (const [id, entry] of shaftSprites) {
      if (seenShafts.has(id)) continue;
      entry.node.destroy();
      shaftSprites.delete(id);
    }
    for (const [id, entry] of carSprites) {
      if (seenCars.has(id)) continue;
      entry.node.destroy();
      carSprites.delete(id);
      doorHold.delete(id);
      interp.delete(`car${id}`);
    }
  }

  /** Doors read as open for at least DOOR_HOLD_MS, so a one tick flap cannot strobe. */
  function carDoorsOpen(car: Car): boolean {
    const now = performance.now();
    if (car.state === 'doorsOpen') {
      doorHold.set(car.id, now + DOOR_HOLD_MS);
      return true;
    }
    const until = doorHold.get(car.id);
    if (until === undefined) return false;
    if (now < until) return true;
    doorHold.delete(car.id);
    return false;
  }

  function drawCar(shaft: Shaft, car: Car, alpha: number): void {
    const doorsOpen = carDoorsOpen(car);
    const key = `${shaft.kind}|${doorsOpen ? 1 : 0}`;
    let entry = carSprites.get(car.id);
    if (!entry) {
      const sprite = new Sprite(art.car(shaft.kind, doorsOpen));
      // Bottom center on the slab line: the two door textures may differ in size,
      // and this way a swap never moves the car.
      sprite.anchor.set(0.5, 1);
      layers.cars.addChild(sprite);
      entry = { node: sprite, key };
      carSprites.set(car.id, entry);
    } else if (entry.key !== key) {
      entry.node.texture = art.car(shaft.kind, doorsOpen); // texture swap only
      entry.key = key;
    }
    const target = interpolated(
      `car${car.id}`,
      (shaft.x + shaft.width / 2) * TILE_PX,
      floorYFloat(car.y) + FLOOR_PX - SLAB_TOP_PX,
      alpha,
    );
    entry.node.position.set(target.x, target.y);
  }

  function simTextureKey(sim: Sim): { kind: SimKind; band: StressBand; frame: 0 | 1 } {
    const band = stressBand(sim.stress);
    // Frame alternates every two tiles walked, so the step follows distance, not ticks.
    const frame: 0 | 1 =
      !reducedMotion && simMoves(sim) ? ((Math.floor(sim.pos.x * 0.5) & 1) as 0 | 1) : 0;
    return { kind: sim.kind, band, frame };
  }

  function reconcileSims(w: World, alpha: number): void {
    let visible = 0;
    for (const sim of w.sims.values()) if (simIsVisible(sim)) visible++;

    if (!particleMode && visible > PARTICLE_THRESHOLD) enterParticleMode();
    else if (particleMode && visible < PARTICLE_RELEASE) leaveParticleMode();

    // Sims standing in a room take a fixed slot, in id order, so they stop jittering.
    const slots = new Map<Id, number>();

    const seen = new Set<Id>();
    for (const sim of w.sims.values()) {
      if (!simIsVisible(sim)) continue;
      seen.add(sim.id);
      const { kind, band, frame } = simTextureKey(sim);
      const key = `${kind}|${band}|${frame}`;
      const point = simMoves(sim)
        ? // Feet on the slab top, not the bottom of the floor band.
          interpolated(`sim${sim.id}`, sim.pos.x * TILE_PX, simFeetY(sim.pos.floor), alpha)
        : interpolateFrom(`sim${sim.id}`, ...inRoomSlot(w, sim, slots));

      const atlasTile = particleMode && particles && particleAtlas ? particleAtlas.get(key) : undefined;
      if (particles && atlasTile) {
        let particle = simParticles.get(sim.id);
        if (!particle) {
          particle = new Particle({ texture: atlasTile, anchorX: 0.5, anchorY: 1 });
          simParticles.set(sim.id, particle);
          particles.addParticle(particle);
        } else if (particle.texture !== atlasTile) {
          particle.texture = atlasTile;
        }
        particle.x = point.x;
        particle.y = point.y;
        continue;
      }

      let entry = simSprites.get(sim.id);
      if (!entry) {
        const sprite = new Sprite(art.sim(kind, band, frame));
        sprite.anchor.set(0.5, 1);
        simSpriteLayer.addChild(sprite);
        entry = { node: sprite, key };
        simSprites.set(sim.id, entry);
      } else if (entry.key !== key) {
        entry.node.texture = art.sim(kind, band, frame);
        entry.key = key;
      }
      entry.node.setSize(SIM_WIDTH_PX, SIM_HEIGHT_PX);
      entry.node.position.set(point.x, point.y);
    }

    for (const [id, entry] of simSprites) {
      if (seen.has(id)) continue;
      entry.node.destroy();
      simSprites.delete(id);
      interp.delete(`sim${id}`);
    }
    if (particles) {
      for (const [id, particle] of simParticles) {
        if (seen.has(id)) continue;
        particles.removeParticle(particle);
        simParticles.delete(id);
        interp.delete(`sim${id}`);
      }
    }
  }

  function reconcileFires(w: World): void {
    const seen = new Set<Id>();
    for (const room of w.rooms.values()) {
      if (!room.onFire) continue;
      seen.add(room.id);
      if (!fireGraphics.has(room.id)) {
        const g = new Graphics();
        layers.effects.addChild(g);
        fireGraphics.set(room.id, g);
      }
    }
    for (const [id, g] of fireGraphics) {
      if (seen.has(id)) continue;
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
      const flames = Math.max(2, Math.floor(width / 12));
      for (let i = 0; i < flames; i++) {
        const jitter = reducedMotion ? 0.5 : flickerNext();
        const h = 8 + jitter * (room.height * FLOOR_PX - 10);
        const x = room.x * TILE_PX + (i + 0.2) * (width / flames);
        g.rect(x, baseY - h, Math.max(3, width / flames - 3), h).fill(jitter > 0.6 ? 0xffd27a : 0xff5c4d);
      }
    }
  }

  function drawOverlay(w: World): void {
    if (ghost) {
      const texture = art.ghost(ghost.widthTiles, ghost.heightFloors, ghost.ok);
      ghostSprite.texture = texture;
      ghostSprite.visible = true;
      ghostSprite.position.set(ghost.x * TILE_PX, floorTopY(ghost.floor + ghost.heightFloors - 1));
      ghostSprite.setSize(ghost.widthTiles * TILE_PX, ghost.heightFloors * FLOOR_PX);
    } else {
      ghostSprite.visible = false;
    }

    selectionBox.clear();
    selectionBox.visible = false;
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
      const sim = w.sims.get(selection.simId);
      if (sim) {
        box = {
          x: sim.pos.x * TILE_PX - SIM_WIDTH_PX / 2 - 2,
          y: simFeetY(sim.pos.floor) - SIM_HEIGHT_PX - 2,
          w: SIM_WIDTH_PX + 4,
          h: SIM_HEIGHT_PX + 4,
        };
      }
    }
    if (!box) return;
    selectionBox.visible = true;
    selectionBox.rect(box.x, box.y, box.w, box.h).stroke({ width: 2, color: 0xf4b942, alignment: 0 });
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

    let best: Sim | null = null;
    for (const sim of lastWorld.sims.values()) {
      if (!simIsVisible(sim)) continue;
      if (sim.pos.floor !== floor) continue;
      if (Math.abs(sim.pos.x - tileFloat) > 1.5) continue;
      if (!best || sim.id > best.id) best = sim; // the newest sim draws on top
    }

    let hit: PickHit;
    if (best) hit = { simId: best.id, floor, x: tile };
    else {
      const room: Room | undefined = pickRoomAt(lastWorld, floor, tile);
      if (room) hit = { roomId: room.id, floor, x: tile };
      else {
        const shaft = shaftAt(lastWorld, floor, tile);
        hit = shaft ? { shaftId: shaft.id, floor, x: tile } : { floor, x: tile };
      }
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
  let fadeLeft = reducedMotion ? 0 : LOAD_FADE_MS;
  let flickerLeft = 0;
  let lastBackground = -1;
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

    const clock = clockOf(lastWorld.time.minute);
    sky.update(clock.minuteOfDay, camera, width, height);
    const background = skyBackground(clock.minuteOfDay);
    if (background !== lastBackground) {
      app.renderer.background.color = background;
      lastBackground = background;
    }

    if (fireGraphics.size > 0) {
      flickerLeft -= dt;
      if (flickerLeft <= 0) {
        flickerLeft = FIRE_FLICKER_MS;
        drawFires(lastWorld);
      }
    }

    if (fadeLeft > 0) {
      fadeLeft -= dt;
      const alpha = Math.max(0, fadeLeft / LOAD_FADE_MS);
      fadeCover.clear();
      fadeCover.rect(0, 0, width, height).fill({ color: 0x000000, alpha });
      if (fadeLeft <= 0) fadeCover.visible = false;
    }
  };
  app.ticker.add(onFrame);

  frameInitial();

  const renderer: Renderer = {
    render(w: World, alpha: number): void {
      lastWorld = w;
      renderMinute = w.time.minute;
      const clock = clockOf(w.time.minute);
      const night = isNight(clock.minuteOfDay);
      syncFloorStrips(w);
      reconcileRooms(w, night);
      reconcileShaftsAndCars(w, alpha);
      reconcileSims(w, alpha);
      reconcileFires(w);
      drawOverlay(w);
    },
    camera,
    screenToTile,
    setGhost(g): void {
      ghost = g;
    },
    setSelection(sel): void {
      selection = sel;
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
    setReducedMotion(on): void {
      reducedMotion = on;
      camera.setReducedMotion(on);
      if (on && fadeLeft > 0) {
        fadeLeft = 0;
        fadeCover.visible = false;
      }
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
      leaveParticleMode();
      atlasTexture?.destroy(true);
      atlasTexture = null;
      particleAtlas = null;
      app.destroy({ removeView: true }, { children: true });
    },
  };

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
