// Information layers: a tint over every room (and every shaft stop in the wait view) that
// shows one number the sim already keeps, on a five step ramp from fine to bad. See
// docs/reviews/2026-09-22-ux-round-spec.md ship U2.
//
// The pure half (the ramp, the step for a room or a floor, the legend) is exported for the
// status bar and the tests, and imports nothing from pixi. The pass half draws into one
// Graphics the renderer owns. It is outside the structure-version gate: while a view is on it
// redraws every frame, because stress and waits move every tick. While no view is on and no
// elevator ghost is out, draw() returns before it reads the world.

import type { Graphics } from 'pixi.js';
import { averageTenantStress, noisyNeighborsOf } from '../sim/evaluation';
import { LIMITS, ROOMS, SHAFTS, STRESS } from '../sim/rules';
import type { Id, Room, ShaftKind, World } from '../sim/types';
import { floorBand, floorBaseY, floorTopY } from './camera';
import { FLOOR_PX, TILE_PX } from './grid';

export type OverlayKind = 'stress' | 'noise' | 'vacancy' | 'wait';

export const OVERLAY_KINDS: readonly OverlayKind[] = ['stress', 'noise', 'vacancy', 'wait'];

/** Step 0 is fine, step 4 is trouble: ghost green, through amber, to the alert red. */
export const OVERLAY_RAMP: readonly [number, number, number, number, number] = [
  0x5fd38a, 0xb4d65a, 0xf4b942, 0xf5873a, 0xff5c4d,
];

export type OverlayStep = 0 | 1 | 2 | 3 | 4;

/** How strongly the tint lies over the art: the room still reads through it. */
export const OVERLAY_ALPHA = 0.5;

// ------------------------------------------------------------------ steps

/**
 * Average tenant stress, cut at half the pink line, the pink line, halfway to red and the red
 * line (STRESS in rules.ts): the same bands the sims are drawn in, with a step between each.
 */
export const STRESS_CUTS = [STRESS.pink / 2, STRESS.pink, (STRESS.pink + STRESS.red) / 2, STRESS.red] as const;

/**
 * The longest wait on a floor right now, in game minutes: nobody, under the calm legend band,
 * under the pink legend band (STRESS.waitBandMinutes), under the wait that alone turns a sim
 * red (STRESS.red / STRESS.perWaitingMinute, 35 minutes), and past it.
 */
export const WAIT_CUTS = [
  STRESS.waitBandMinutes.calm,
  STRESS.waitBandMinutes.pink,
  STRESS.red / STRESS.perWaitingMinute,
] as const;

function cut(value: number, cuts: readonly number[]): number {
  let step = 0;
  for (const c of cuts) if (value >= c) step += 1;
  return step;
}

/** A room's stress step, or null for a room nobody is a tenant of (a shop, an empty office). */
export function stressStep(world: World, room: Room): OverlayStep | null {
  if (room.tenants.length === 0) return null;
  return cut(averageTenantStress(world, room), STRESS_CUTS) as OverlayStep;
}

/**
 * A quiet room's noise step: one step per noisy neighbor (noisyNeighborsOf), four or more at
 * the top. Each costs EVAL.noisePenaltyPerNeighbor of the evaluation, so step 4 is 0.8 gone.
 * Null for a room that does not mind noise.
 */
export function noiseStep(world: World, room: Room): OverlayStep | null {
  if (!ROOMS[room.kind].quiet) return null;
  return Math.min(4, noisyNeighborsOf(world, room).length) as OverlayStep;
}

const HOTEL = new Set(['hotelSingle', 'hotelTwin', 'hotelSuite']);

/**
 * Occupied (step 0) or vacant (step 4), for the rooms that take a tenant: an office or condo
 * with no contract (room.vacant), a hotel room with no guest. Null for everything else.
 */
export function vacancyStep(room: Room): OverlayStep | null {
  if (room.kind === 'office' || room.kind === 'condo') return room.vacant ? 4 : 0;
  if (HOTEL.has(room.kind)) return room.tenants.length === 0 ? 4 : 0;
  return null;
}

/** Nobody waiting is step 0; any wait is at least step 1, then WAIT_CUTS. */
export function waitStepOf(minutes: number | null): OverlayStep {
  if (minutes === null) return 0;
  return (1 + cut(minutes, WAIT_CUTS)) as OverlayStep;
}

/** The queue at one hall: how many are waiting and since when the first of them has. */
export interface HallQueue {
  count: number;
  since: number;
}

/**
 * Every sim waiting for a car, by shaft then floor: the same set the elevator pass boards from
 * (elevators.ts indexWaitingSims), a waiting sim not yet in a car whose next leg is a ride.
 * Read only.
 */
export function hallQueues(world: World): Map<Id, Map<number, HallQueue>> {
  const out = new Map<Id, Map<number, HallQueue>>();
  for (const sim of world.sims.values()) {
    if (sim.state !== 'waiting' || sim.inCarId !== null) continue;
    const leg = sim.route[0];
    if (!leg || leg.kind !== 'ride') continue;
    let byFloor = out.get(leg.shaftId);
    if (!byFloor) out.set(leg.shaftId, (byFloor = new Map()));
    const since = sim.waitStart ?? world.time.minute;
    const queue = byFloor.get(sim.pos.floor);
    if (queue) {
      queue.count += 1;
      if (since < queue.since) queue.since = since;
    } else byFloor.set(sim.pos.floor, { count: 1, since });
  }
  return out;
}

/** The longest wait on each floor across every shaft, in minutes. Floors nobody waits on are absent. */
export function floorWaits(world: World, queues = hallQueues(world)): Map<number, number> {
  const out = new Map<number, number>();
  for (const byFloor of queues.values()) {
    for (const [floor, queue] of byFloor) {
      const waited = Math.max(0, world.time.minute - queue.since);
      if (waited > (out.get(floor) ?? -1)) out.set(floor, waited);
    }
  }
  return out;
}

/** A room's wait step: the worst wait on any floor it covers. */
export function roomWaitStep(room: Room, waits: ReadonlyMap<number, number>): OverlayStep {
  let worst: number | null = null;
  for (let f = room.floor; f < room.floor + room.height; f += 1) {
    const w = waits.get(f);
    if (w !== undefined && (worst === null || w > worst)) worst = w;
  }
  return waitStepOf(worst);
}

/** One room's step in a view that tints rooms by their own numbers. */
export function roomStep(world: World, room: Room, kind: OverlayKind, waits?: ReadonlyMap<number, number>): OverlayStep | null {
  if (kind === 'stress') return stressStep(world, room);
  if (kind === 'noise') return noiseStep(world, room);
  if (kind === 'vacancy') return vacancyStep(room);
  // Stairs and escalators are the way between floors, not a place to wait for a car.
  if (room.kind === 'stairs' || room.kind === 'escalator') return null;
  return roomWaitStep(room, waits ?? floorWaits(world));
}

// ------------------------------------------------------------------ legend

export interface LegendEntry {
  color: number;
  label: string;
}

export interface Legend {
  title: string;
  entries: LegendEntry[];
}

const OVERLAY_TITLES: Record<OverlayKind, string> = {
  stress: 'Stress',
  noise: 'Noise',
  vacancy: 'Vacancy',
  wait: 'Elevator wait',
};

export function overlayTitle(kind: OverlayKind): string {
  return OVERLAY_TITLES[kind];
}

/** What each colour means in a view, for the status bar while the view is on. */
export function overlayLegend(kind: OverlayKind): Legend {
  const r = OVERLAY_RAMP;
  const title = OVERLAY_TITLES[kind];
  if (kind === 'vacancy') return { title, entries: [{ color: r[0], label: 'Occupied' }, { color: r[4], label: 'Vacant' }] };
  if (kind === 'noise') {
    return {
      title,
      entries: [
        { color: r[0], label: 'Quiet' },
        { color: r[1], label: '1' },
        { color: r[2], label: '2' },
        { color: r[3], label: '3' },
        { color: r[4], label: '4 or more noisy neighbors' },
      ],
    };
  }
  if (kind === 'stress') {
    return {
      title,
      entries: [
        { color: r[0], label: 'Calm' },
        { color: r[1], label: '' },
        { color: r[2], label: 'Stressed' },
        { color: r[3], label: '' },
        { color: r[4], label: 'Very stressed' },
      ],
    };
  }
  const [calm, pink, red] = WAIT_CUTS;
  return {
    title,
    entries: [
      { color: r[0], label: 'Nobody' },
      { color: r[1], label: `Under ${calm} min` },
      { color: r[2], label: `${calm} to ${pink}` },
      { color: r[3], label: `${pink} to ${red}` },
      { color: r[4], label: `${red} min or more` },
    ],
  };
}

// ------------------------------------------------------------------ ghost band

/**
 * The floors a new or stretched elevator of this kind will stop at across a span: every floor
 * but the missing floor 0, and for an express only the lobbies and the basements (build.ts
 * defaultStops). Top floor first.
 */
export function servedFloors(kind: ShaftKind, floorMin: number, floorMax: number): number[] {
  const out: number[] = [];
  for (let f = floorMax; f >= floorMin; f -= 1) {
    if (f === 0) continue;
    if (SHAFTS[kind].expressOnly && !(f === 1 || f < 0 || LIMITS.skyLobbyFloors.includes(f))) continue;
    out.push(f);
  }
  return out;
}

/** The ghost as the renderer holds it, with the elevator kind when it is one. */
export interface OverlayGhost {
  widthTiles: number;
  heightFloors: number;
  floor: number;
  x: number;
  ok: boolean;
  shaft?: ShaftKind;
}

/** The floor at a band, the inverse of floorBand: band 1 is floor 1, band 0 is floor -1. */
function floorAtBand(band: number): number {
  return band > 0 ? band : band - 1;
}

// ------------------------------------------------------------------ pass

/** The part of the world the camera shows, in world pixels. */
export interface ViewRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface OverlayPass {
  set(kind: OverlayKind | null): void;
  get(): OverlayKind | null;
  /** Redraw for this frame. Returns at once with no view on and no elevator ghost out. */
  draw(world: World, view: ViewRect, ghost: OverlayGhost | null): void;
}

type TintTarget = Pick<Graphics, 'clear' | 'rect' | 'fill' | 'visible'>;

/**
 * The per frame tint pass. Steps are worked out again when the world, its minute, its
 * structure or the view changes, which is at most once a tick; the rectangles are drawn
 * again every frame for the rooms on screen.
 */
export function createOverlayPass(g: TintTarget): OverlayPass {
  let kind: OverlayKind | null = null;
  let drawnSomething = false;
  let stepsKey = '';
  let stepsWorld: World | null = null;
  const roomSteps = new Map<Id, OverlayStep | null>();
  /** Wait view only: each shaft's own queue step per floor. */
  const shaftSteps = new Map<Id, Map<number, OverlayStep>>();

  function recompute(world: World, view: OverlayKind): void {
    const key = `${view}|${world.time.minute}|${world.structureVersion}`;
    if (world === stepsWorld && key === stepsKey) return;
    stepsWorld = world;
    stepsKey = key;
    roomSteps.clear();
    shaftSteps.clear();
    const queues = view === 'wait' ? hallQueues(world) : null;
    const waits = queues ? floorWaits(world, queues) : undefined;
    for (const room of world.rooms.values()) roomSteps.set(room.id, roomStep(world, room, view, waits));
    if (!queues) return;
    for (const [shaftId, byFloor] of queues) {
      const steps = new Map<number, OverlayStep>();
      for (const [floor, queue] of byFloor) steps.set(floor, waitStepOf(Math.max(0, world.time.minute - queue.since)));
      shaftSteps.set(shaftId, steps);
    }
  }

  function drawRooms(world: World, view: ViewRect): void {
    for (const room of world.rooms.values()) {
      const step = roomSteps.get(room.id);
      if (step === null || step === undefined) continue;
      const x = room.x * TILE_PX;
      const w = room.width * TILE_PX;
      const top = floorTopY(room.floor + room.height - 1);
      const h = room.height * FLOOR_PX;
      if (x > view.right || x + w < view.left || top > view.bottom || top + h < view.top) continue;
      g.rect(x, top, w, h).fill({ color: OVERLAY_RAMP[step], alpha: OVERLAY_ALPHA });
    }
  }

  function drawShaftStops(world: World, view: ViewRect): void {
    for (const shaft of world.shafts.values()) {
      const x = shaft.x * TILE_PX;
      const w = shaft.width * TILE_PX;
      if (x > view.right || x + w < view.left) continue;
      const steps = shaftSteps.get(shaft.id);
      for (const floor of shaft.stops) {
        const top = floorTopY(floor);
        if (top > view.bottom || top + FLOOR_PX < view.top) continue;
        const step = steps?.get(floor) ?? 0;
        g.rect(x, top, w, FLOOR_PX).fill({ color: OVERLAY_RAMP[step], alpha: OVERLAY_ALPHA });
      }
    }
  }

  /** On an elevator ghost, a band at each floor it will stop at, so an express shows its gaps. */
  function drawGhostBand(ghost: OverlayGhost): void {
    if (!ghost.shaft) return;
    const lowBand = floorBand(ghost.floor);
    const floorMin = ghost.floor;
    const floorMax = floorAtBand(lowBand + ghost.heightFloors - 1);
    const color = ghost.ok ? OVERLAY_RAMP[0] : OVERLAY_RAMP[4];
    const x = ghost.x * TILE_PX;
    const w = ghost.widthTiles * TILE_PX;
    const bandH = FLOOR_PX / 4;
    for (const floor of servedFloors(ghost.shaft, floorMin, floorMax)) {
      // The band sits where a car's doors would be, just over the slab.
      g.rect(x, floorBaseY(floor) - bandH - TILE_PX / 2, w, bandH).fill({ color, alpha: 0.7 });
    }
  }

  return {
    set(next) {
      if (next === kind) return;
      kind = next;
      stepsKey = '';
      stepsWorld = null;
      if (next === null) {
        roomSteps.clear();
        shaftSteps.clear();
      }
    },
    get: () => kind,
    draw(world, view, ghost) {
      const band = ghost?.shaft !== undefined;
      if (kind === null && !band) {
        if (drawnSomething) {
          g.clear();
          g.visible = false;
          drawnSomething = false;
        }
        return;
      }
      g.clear();
      g.visible = true;
      drawnSomething = true;
      if (kind !== null) {
        recompute(world, kind);
        drawRooms(world, view);
        if (kind === 'wait') drawShaftStops(world, view);
      }
      if (ghost && band) drawGhostBand(ghost);
    },
  };
}
