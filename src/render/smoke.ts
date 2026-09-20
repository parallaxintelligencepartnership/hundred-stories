// Renderer smoke test: a hand built tower, no simulation modules involved.
// Boot it with `npx vite` and open the page with ?smoke (src/main.ts imports bootSmoke).
//
// It exercises every renderer path: layers, sky keyframes, parallax city, slabs,
// rooms lighting up at night, a shaft with two cars, sims walking with stress
// bands, the fire effect, the build ghost, selection and pointer picking.

import { ROOMS } from '../sim/rules';
import type { Room, RoomKind, Shaft, ShaftKind, Sim, SimKind, World } from '../sim/types';
import { addRoom, addShaft, addSim, allocId, createWorld } from '../sim/world';
import { createRenderer, type Renderer } from './renderer';

function makeRoom(world: World, kind: RoomKind, floor: number, x: number, occupancy: number): Room {
  const rule = ROOMS[kind];
  const room: Room = {
    id: allocId(world),
    kind,
    floor,
    x,
    width: rule.width,
    height: rule.height,
    eval: 0.72,
    tenants: [],
    occupancy,
    builtAtMinute: 0,
    vacant: occupancy === 0,
    dirty: false,
    infested: false,
    lowEvalSinceMinute: null,
    onFire: false,
    rent: 100,
  };
  addRoom(world, room);
  return room;
}

function makeShaft(world: World, kind: ShaftKind, x: number, floorMin: number, floorMax: number, cars: number): Shaft {
  const shaft: Shaft = {
    id: allocId(world),
    kind,
    x,
    width: 4,
    floorMin,
    floorMax,
    stops: new Set<number>(),
    homeFloor: 1,
    cars: [],
    hallCalls: new Map(),
  };
  for (let f = floorMin; f <= floorMax; f++) {
    if (f === 0) continue;
    shaft.stops.add(f);
  }
  for (let i = 0; i < cars; i++) {
    shaft.cars.push({
      id: allocId(world),
      shaftId: shaft.id,
      y: floorMin + i,
      dir: 0,
      state: 'idle',
      doorTimer: 0,
      idleSince: null,
      passengers: [],
      calls: new Set<number>(),
      serves: 'any',
      range: null,
    });
  }
  addShaft(world, shaft);
  return shaft;
}

function makeSim(world: World, kind: SimKind, floor: number, x: number, stress: number): Sim {
  const sim: Sim = {
    id: allocId(world),
    kind,
    homeRoomId: null,
    pos: { floor, x },
    inCarId: null,
    inRoomId: null,
    route: [],
    state: 'walking',
    stress,
    waitStart: null,
    schedule: [],
    nextScheduleIndex: 0,
    stayUntil: null,
    wallet: 0,
    leaveReason: null,
  };
  addSim(world, sim);
  return sim;
}

/** A small tower with a lobby, five floors of offices and condos, and one shaft. */
export function buildDemoWorld(): World {
  const world = createWorld(20260918);
  world.time.minute = 8 * 60;
  world.cash = 2_000_000;

  for (let x = 100; x <= 140; x++) makeRoom(world, 'lobby', 1, x, 0);

  for (const floor of [2, 3]) {
    for (const x of [100, 110, 120, 130, 160, 170]) makeRoom(world, 'office', floor, x, 6);
  }
  for (const floor of [4, 5, 6]) {
    for (const x of [100, 120, 160]) makeRoom(world, 'condo', floor, x, 3);
  }

  makeShaft(world, 'standard', 150, 1, 6, 2);

  const kinds: SimKind[] = ['worker', 'resident', 'guest', 'shopper', 'staff'];
  for (let i = 0; i < 20; i++) {
    const floor = 1 + (i % 6);
    const x = 102 + (i % 7) * 7 + (floor % 3) * 3;
    const stress = (i % 5) * 0.22;
    makeSim(world, kinds[i % kinds.length] as SimKind, floor, x, stress);
  }

  return world;
}

export interface DemoAnimationOptions {
  /** Game minutes per real millisecond. 0.12 is one demo day every twelve seconds. */
  minutesPerMs?: number;
  /** The office on floor 3 catches fire on a six second cycle. */
  fire?: boolean;
}

interface DemoState {
  elapsed: number;
  dirs: Map<number, number>;
  shaft: Shaft | undefined;
  burning: Room | undefined;
}

// Per world, so the smoke page and the landing hero each keep their own phase
// while sharing one copy of the motion.
const demoStates = new WeakMap<World, DemoState>();

/**
 * One frame of the demo world's fake life: the clock, the sims pacing their
 * floors, the cars running their shaft, and the fire. Both the ?smoke page and
 * the landing hero call this, so the two can never drift apart.
 */
export function animateDemo(world: World, dt: number, options: DemoAnimationOptions = {}): void {
  const minutesPerMs = options.minutesPerMs ?? 0.12;
  const fire = options.fire ?? true;

  let state = demoStates.get(world);
  if (!state) {
    state = {
      elapsed: 0,
      dirs: new Map<number, number>(),
      shaft: [...world.shafts.values()][0],
      burning: [...world.rooms.values()].find((r) => r.kind === 'office' && r.floor === 3),
    };
    for (const sim of world.sims.values()) state.dirs.set(sim.id, sim.id % 2 === 0 ? 1 : -1);
    demoStates.set(world, state);
  }
  state.elapsed += dt;

  world.time.minute += dt * minutesPerMs;

  for (const sim of world.sims.values()) {
    const dir = state.dirs.get(sim.id) ?? 1;
    sim.pos.x += dir * dt * 0.006;
    if (sim.pos.x > 176) state.dirs.set(sim.id, -1);
    if (sim.pos.x < 101) state.dirs.set(sim.id, 1);
    sim.stress = (sim.stress + dt * 0.00002) % 1;
  }

  const shaft = state.shaft;
  if (shaft) {
    const span = shaft.floorMax - shaft.floorMin;
    shaft.cars.forEach((car, index) => {
      const phase = (state.elapsed / 4000 + index * 0.5) % 2;
      const t = phase < 1 ? phase : 2 - phase;
      car.y = shaft.floorMin + t * span;
      car.state = t < 0.02 || t > 0.98 ? 'doorsOpen' : 'moving';
    });
  }

  if (state.burning) state.burning.onFire = fire && Math.floor(state.elapsed / 6000) % 2 === 1;
}

/**
 * Boots the renderer full screen into document.body with the demo world and a
 * small animation loop. Returns the renderer so a caller can tear it down.
 */
export async function bootSmoke(): Promise<Renderer> {
  const host = document.createElement('div');
  host.id = 'smoke-view';
  host.style.position = 'fixed';
  host.style.inset = '0';
  host.style.background = '#070b1a';
  document.body.style.margin = '0';
  document.body.appendChild(host);

  const world = buildDemoWorld();
  const renderer = await createRenderer(host, world);

  renderer.onPick((hit) => {
    console.log('pick', hit);
    if (hit.simId !== undefined) renderer.setSelection({ simId: hit.simId });
    else if (hit.roomId !== undefined) renderer.setSelection({ roomId: hit.roomId });
    else if (hit.shaftId !== undefined) renderer.setSelection({ shaftId: hit.shaftId });
    else renderer.setSelection(null);
  });

  renderer.setGhost({ widthTiles: ROOMS.office.width, heightFloors: 1, floor: 7, x: 120, ok: true });
  renderer.camera.centerOn(3, 130);

  let last = performance.now();
  let running = true;

  const frame = (now: number): void => {
    if (!running) return;
    const dt = Math.min(100, now - last);
    last = now;

    // One demo day every twelve seconds, so the sky keyframes are easy to see.
    animateDemo(world, dt, { minutesPerMs: 0.12, fire: true });

    renderer.render(world, 1);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  window.addEventListener(
    'beforeunload',
    () => {
      running = false;
    },
    { once: true },
  );

  console.log('smoke: drag to pan, wheel to zoom, WASD or arrows to pan, click to pick');
  return renderer;
}
