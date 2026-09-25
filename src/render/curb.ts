// The curb arrival scene (package 2, item 5): the street outside the ground lobby's two doors,
// where commuters walk in from off screen and out again, under umbrellas when it rains; the VIP's
// car pulls up on the vip.arrival beat and leaves on vip.rated; a fire engine or a police car
// waits at the curb while a fire or a bomb is active.
//
// Cosmetic only: the figures are a sample of people the sim has outside the tower or leaving
// it, drawn walking a loop along the street on real time. While a fire burns nobody walks in:
// the people outside wait on the street, clear of the door and the fire engine. A person on
// the way out is on the street only once they are in the ground lobby and the tower does not
// draw them, so nobody is drawn inside and outside at once. Nothing here reads or writes world.rng
// or any sim field; the renderer never touches the sim. All motion stops under reduced motion.

import { Container, Sprite, type Texture } from 'pixi.js';
import type { StoryBeat } from '../sim/story';
import type { Id, Sim, SimKind, World } from '../sim/types';
import { FRAME, mix, walkFrameAt, type PersonFrame } from './anim';
import type { Art } from './art';
import { headTopOf } from './figure';
import { placePerson, type PersonSprites } from './person';
import { SIM_H, SIM_W, TILE_PX } from './grid';
import { UMBRELLA_COLOURS, UMBRELLA_H, UMBRELLA_W, VEHICLE_SIZE, type VehicleKind } from './illustrated';
import { RAIN_ON, rainFalling, type WeatherView } from './weather';

/** At most this many commuters are on the street at once. */
export const CURB_MAX = 12;
/** Walking pace on the street, css px a second at zoom 1. */
export const CURB_WALK_PX_PER_S = 30;
/** How far out from a door a commuter's walk runs: past the edge of any screen at zoom 1. */
export const CURB_PATH_PX = 720;
/** A gap at the door end of each loop, so a commuter is not always mid street. */
const CURB_LOOP_PX = CURB_PATH_PX + 120;
/** Umbrellas open above this much rain and storm in the eased weather: weather.ts RAIN_ON. */
export const UMBRELLA_WEIGHT = RAIN_ON;
/** A vehicle pulls up or drives off over this long. */
export const VEHICLE_MOVE_MS = 1500;
/** During a fire the people outside wait at least this far from their door, px: past the fire engine. */
export const CURB_WAIT_PX = VEHICLE_SIZE.fire.w + 24;

export interface CurbFigure {
  simId: Id;
  kind: SimKind;
  /** Which door: the lobby's left end (-1) or right end (1). */
  side: -1 | 1;
  /** In from the street toward the door, out from the door along it, or standing (a fire). */
  heading: 'in' | 'out' | 'wait';
}

/** What the street needs to know about the tower when it picks its people. */
export interface CurbSampleOptions {
  /** A fire is burning: nobody walks in, the people outside wait on the street. */
  fire?: boolean;
  /**
   * The ground lobby's doors, world px. Given, a person leaving is on the street only while on
   * the ground floor between them, not while still upstairs.
   */
  lobby?: { left: number; right: number } | null;
  /** True for a person the tower draws now: they are inside, so not on the street as well. */
  inTower?: (sim: Sim) => boolean;
}

/**
 * The commuters on the street: people outside the tower or leaving it, at most CURB_MAX,
 * chosen by a hash of the id so the same people stay on the street from one frame to the next.
 * One pass over the sims, keeping the lowest hashes, so a tower of thousands costs one walk.
 */
export function curbFigures(sims: Iterable<Sim>, max = CURB_MAX, options: CurbSampleOptions = {}): CurbFigure[] {
  const best: { h: number; sim: Sim }[] = [];
  const lobby = options.lobby;
  for (const sim of sims) {
    if (sim.state !== 'outside' && sim.state !== 'leaving') continue;
    if (sim.state === 'leaving') {
      if (options.inTower?.(sim)) continue;
      if (lobby) {
        const x = sim.pos.x * TILE_PX;
        if (sim.pos.floor !== 1 || x < lobby.left || x > lobby.right) continue;
      }
    }
    const h = mix(sim.id * 31 + 7);
    if (best.length === max && h >= (best[best.length - 1] as { h: number }).h) continue;
    let i = best.length;
    while (i > 0 && (best[i - 1] as { h: number }).h > h) i--;
    best.splice(i, 0, { h, sim });
    if (best.length > max) best.pop();
  }
  return best.map(({ h, sim }) => ({
    simId: sim.id,
    kind: sim.kind,
    side: (h & 1 ? 1 : -1) as -1 | 1,
    heading: sim.state === 'leaving' ? 'out' : options.fire ? 'wait' : 'in',
  }));
}

/** Umbrellas up exactly while rain is falling on screen: the same test the rain layer draws by. */
export function umbrellasUp(view: WeatherView): boolean {
  return rainFalling(view) > 0;
}

/** The VIP's car is at the curb from the last vip.arrival beat until a vip.rated beat follows it. */
export function vipCarPresent(recent: readonly StoryBeat[]): boolean {
  for (let i = recent.length - 1; i >= 0; i--) {
    const code = (recent[i] as StoryBeat).code;
    if (code === 'vip.rated') return false;
    if (code === 'vip.arrival') return true;
  }
  return false;
}

/** The emergency vehicle at the curb: a fire engine for a fire, a police car for a bomb. */
export function emergencyVehicle(world: Pick<World, 'events'>): 'fire' | 'police' | null {
  let bomb = false;
  for (const e of world.events) {
    if (e.kind === 'fire') return 'fire';
    if (e.kind === 'bomb') bomb = true;
  }
  return bomb ? 'police' : null;
}

/**
 * Where a commuter is along the street, px out from their door, at `nowMs`, or null while they
 * are through the door. Heading in, the distance falls to the door; out, it grows from it.
 * Under reduced motion the clock does not run: each stands at their own fixed spot.
 */
export function curbOffset(figure: CurbFigure, nowMs: number, reducedMotion: boolean): number | null {
  // Waiting out a fire: standing at their own spot down the street, never at the door.
  if (figure.heading === 'wait') return CURB_WAIT_PX + (mix(figure.simId) % (CURB_PATH_PX - CURB_WAIT_PX));
  const start = mix(figure.simId) % CURB_LOOP_PX;
  const run = reducedMotion ? 0 : (nowMs / 1000) * CURB_WALK_PX_PER_S;
  const p = (start + run) % CURB_LOOP_PX;
  if (p > CURB_PATH_PX) return null;
  return figure.heading === 'out' ? p : CURB_PATH_PX - p;
}

/** The two doors: the ground lobby's left and right ends, world px. Null with no ground lobby. */
export function lobbyDoors(world: Pick<World, 'rooms'>): { left: number; right: number } | null {
  let left = Infinity;
  let right = -Infinity;
  for (const room of world.rooms.values()) {
    if (room.kind !== 'lobby' || room.floor !== 1) continue;
    left = Math.min(left, room.x);
    right = Math.max(right, room.x + room.width);
  }
  return left === Infinity ? null : { left: left * TILE_PX, right: right * TILE_PX };
}

export interface CurbFrame {
  world: World;
  view: WeatherView;
  doors: { left: number; right: number } | null;
  /** The person look code (figure.ts) for a sim id. */
  lookOf: (sim: Sim) => number;
  nowMs: number;
  dtMs: number;
  reducedMotion: boolean;
  /** People on the street are hidden at far zoom; vehicles stay. */
  people: boolean;
  /** The view's left and right edges, world px: a commuter off screen gets no sprite at all. */
  viewLeft: number;
  viewRight: number;
  /** True for a person the tower draws now (renderer: the crowd sample, visible): not on the street too. */
  inTower?: (sim: Sim) => boolean;
}

export interface Curb {
  update(frame: CurbFrame): void;
  /** How many commuters are drawn now, for the tests. */
  count(): number;
  /** Add every texture the commuters show to `into`, so a sweep keeps them. */
  textures(into: Set<Texture>): void;
  /** Forget the street for a different tower: no commuters, no vehicles, a fresh sample next frame. */
  reset(): void;
  destroy(): void;
}

interface Walker extends PersonSprites {
  umbrella: Sprite | null;
  key: string;
}

interface Vehicle {
  node: Sprite | null;
  kind: VehicleKind | null;
  /** 0 parked, 1 fully off to the side; eased toward the target. */
  away: number;
  want: boolean;
}

/** How often the sample of commuters is refreshed, in real ms. */
const RESAMPLE_MS = 1000;

export function createCurb(layer: Container, art: () => Art): Curb {
  const root = new Container();
  const people = new Container();
  const props = new Container();
  const umbrellas = new Container();
  const vehicles = new Container();
  root.addChild(vehicles, people, props, umbrellas);
  layer.addChild(root);
  let sample: CurbFigure[] = [];
  let sampledAt = -Infinity;
  let sampledFire = false;
  const walkers = new Map<Id, Walker>();
  const vip: Vehicle = { node: null, kind: null, away: 1, want: false };
  const rescue: Vehicle = { node: null, kind: null, away: 1, want: false };

  function place(v: Vehicle, kind: VehicleKind | null, x: number, side: -1 | 1, dtMs: number, reduced: boolean): void {
    v.want = kind !== null;
    const a = art();
    if (kind && kind !== v.kind && a.vehicle) {
      if (!v.node) {
        v.node = new Sprite(a.vehicle(kind));
        v.node.anchor.set(0.5, 1);
        vehicles.addChild(v.node);
      } else v.node.texture = a.vehicle(kind);
      v.kind = kind;
    }
    const target = v.want ? 0 : 1;
    const step = reduced ? 1 : Math.max(0, dtMs) / VEHICLE_MOVE_MS;
    v.away = v.away < target ? Math.min(target, v.away + step) : Math.max(target, v.away - step);
    if (!v.node || !v.kind) return;
    v.node.visible = v.away < 1;
    // Eased in from, and out to, the far side of the street.
    const e = v.away * v.away * (3 - 2 * v.away);
    const size = VEHICLE_SIZE[v.kind];
    v.node.setSize(size.w, size.h);
    v.node.position.set(x + side * (size.w / 2 + 6) + side * e * CURB_PATH_PX, 0);
  }

  function drop(id: Id): void {
    const w = walkers.get(id);
    if (!w) return;
    w.body.destroy();
    w.prop?.destroy();
    w.umbrella?.destroy();
    walkers.delete(id);
  }

  return {
    update(f) {
      const doors = f.doors;
      if (!doors) {
        for (const id of [...walkers.keys()]) drop(id);
        place(vip, null, 0, -1, f.dtMs, f.reducedMotion);
        place(rescue, null, 0, 1, f.dtMs, f.reducedMotion);
        return;
      }
      place(vip, vipCarPresent(f.world.story.recent) ? 'vip' : null, doors.left, -1, f.dtMs, f.reducedMotion);
      place(rescue, emergencyVehicle(f.world), doors.right, 1, f.dtMs, f.reducedMotion);

      people.visible = f.people;
      props.visible = f.people;
      umbrellas.visible = f.people;
      if (!f.people) return;
      // A fire starting or ending turns the street at once, not at the next resample.
      const fire = emergencyVehicle(f.world) === 'fire';
      if (f.nowMs - sampledAt >= RESAMPLE_MS || f.nowMs < sampledAt || fire !== sampledFire) {
        sample = curbFigures(f.world.sims.values(), CURB_MAX, { fire, lobby: doors, ...(f.inTower ? { inTower: f.inTower } : {}) });
        sampledAt = f.nowMs;
        sampledFire = fire;
      }
      const a = art();
      const rain = umbrellasUp(f.view);
      const seen = new Set<Id>();
      for (const fig of sample) {
        const sim = f.world.sims.get(fig.simId);
        const offset = curbOffset(fig, f.nowMs, f.reducedMotion);
        if (!sim || offset === null) continue;
        const x = fig.side === -1 ? doors.left - offset : doors.right + offset;
        if (x < f.viewLeft - SIM_W || x > f.viewRight + SIM_W) continue;
        seen.add(fig.simId);
        const code = f.lookOf(sim);
        const frame: PersonFrame = f.reducedMotion || fig.heading === 'wait' ? FRAME.stand : walkFrameAt(f.nowMs + (mix(fig.simId) % 360));
        const key = `${fig.kind}|${code}|${frame}`;
        let w = walkers.get(fig.simId);
        if (!w) {
          const body = new Sprite(a.sim(fig.kind, 'calm', frame, code));
          body.anchor.set(0.5, 1);
          people.addChild(body);
          w = { body, prop: null, propKind: null, umbrella: null, key };
          walkers.set(fig.simId, w);
        } else if (w.key !== key) {
          w.body.texture = a.sim(fig.kind, 'calm', frame, code);
          w.key = key;
        }
        placePerson(a, props, w, fig.kind, code, frame, x, 0);
        if (rain && a.umbrella) {
          if (!w.umbrella) {
            w.umbrella = new Sprite(a.umbrella(UMBRELLA_COLOURS[mix(fig.simId + 3) % UMBRELLA_COLOURS.length] as number));
            w.umbrella.anchor.set(0.5, 1);
            umbrellas.addChild(w.umbrella);
          }
          w.umbrella.visible = true;
          w.umbrella.setSize(UMBRELLA_W, UMBRELLA_H);
          w.umbrella.position.set(x + 2, -SIM_H + headTopOf(code) + 8);
        } else if (w.umbrella) w.umbrella.visible = false;
      }
      for (const id of [...walkers.keys()]) if (!seen.has(id)) drop(id);
    },
    count() {
      return walkers.size;
    },
    textures(into) {
      for (const w of walkers.values()) into.add(w.body.texture);
    },
    reset() {
      for (const id of [...walkers.keys()]) drop(id);
      sample = [];
      sampledAt = -Infinity;
      sampledFire = false;
      for (const v of [vip, rescue]) {
        v.away = 1;
        v.want = false;
        if (v.node) v.node.visible = false;
      }
    },
    destroy() {
      for (const id of [...walkers.keys()]) drop(id);
      root.destroy({ children: true });
    },
  };
}
