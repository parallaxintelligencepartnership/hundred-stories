// The curb arrival scene (package 2): at most twelve commuters from the people outside or
// leaving, umbrellas only when the eased weather is wet past 0.5, the VIP's car between the
// arrival and rating beats, an emergency vehicle while a fire or bomb is on, no motion under
// reduced motion. The scene reads the world and never writes it.

import { describe, expect, it } from 'vitest';
import { Container, Sprite, Texture } from 'pixi.js';
import type { Art } from '../../src/render/art';
import {
  CURB_MAX,
  curbFigures,
  curbOffset,
  createCurb,
  emergencyVehicle,
  lobbyDoors,
  umbrellasUp,
  UMBRELLA_WEIGHT,
  vipCarPresent,
} from '../../src/render/curb';
import type { WeatherView } from '../../src/render/weather';
import { hashWorld } from '../../src/sim/save';
import type { StoryBeat } from '../../src/sim/story';
import type { Room, Sim, World } from '../../src/sim/types';
import { addRoom, addSim, allocId, createWorld } from '../../src/sim/world';

function person(world: World, state: Sim['state']): Sim {
  const sim: Sim = {
    id: allocId(world), kind: 'worker', homeRoomId: null, pos: { floor: 1, x: 100 }, inCarId: null, inRoomId: null, route: [], state,
    stress: 0, waitStart: null, schedule: [], nextScheduleIndex: 0, stayUntil: null, wallet: 0, leaveReason: null,
  };
  addSim(world, sim);
  return sim;
}

function lobby(world: World, from: number, to: number): void {
  for (let x = from; x < to; x++) {
    const room: Room = {
      id: allocId(world), kind: 'lobby', floor: 1, x, width: 1, height: 1, eval: 1, tenants: [], occupancy: 0, builtAtMinute: 0,
      vacant: false, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 100,
    };
    addRoom(world, room);
  }
}

function view(rain: number, storm = 0): WeatherView {
  return { weights: { clear: 1 - rain - storm, overcast: 0, rain, storm }, intensity: 0.8 };
}

describe('who is on the street', () => {
  it('caps the street at twelve commuters however many are outside', () => {
    const world = createWorld(4);
    for (let i = 0; i < 300; i++) person(world, i % 2 ? 'outside' : 'leaving');
    const figures = curbFigures(world.sims.values());
    expect(CURB_MAX).toBe(12);
    expect(figures).toHaveLength(12);
    expect(new Set(figures.map((f) => f.simId)).size).toBe(12);
  });

  it('samples only people outside or leaving, heading in or out to match', () => {
    const world = createWorld(4);
    const out = person(world, 'outside');
    const leaving = person(world, 'leaving');
    for (const state of ['walking', 'waiting', 'inRoom', 'riding', 'gone'] as const) person(world, state);
    const figures = curbFigures(world.sims.values());
    expect(figures.map((f) => f.simId).sort()).toEqual([out.id, leaving.id].sort());
    expect(figures.find((f) => f.simId === out.id)?.heading).toBe('in');
    expect(figures.find((f) => f.simId === leaving.id)?.heading).toBe('out');
  });

  it('keeps the same people on the street from one sample to the next', () => {
    const world = createWorld(4);
    for (let i = 0; i < 100; i++) person(world, 'outside');
    expect(curbFigures(world.sims.values())).toEqual(curbFigures(world.sims.values()));
  });

  it('holds everyone still under reduced motion', () => {
    const fig = { simId: 7, kind: 'worker' as const, side: 1 as const, heading: 'in' as const };
    const at0 = curbOffset(fig, 0, true);
    for (let t = 0; t < 60_000; t += 777) expect(curbOffset(fig, t, true)).toBe(at0);
    const moving = new Set<number | null>();
    for (let t = 0; t < 10_000; t += 500) moving.add(curbOffset(fig, t, false));
    expect(moving.size).toBeGreaterThan(5);
  });

  it('finds the doors at the ends of the ground lobby', () => {
    const world = createWorld(4);
    expect(lobbyDoors(world)).toBeNull();
    lobby(world, 100, 140);
    expect(lobbyDoors(world)).toEqual({ left: 1600, right: 2240 });
  });
});

describe('umbrellas', () => {
  it('open only when rain and storm together pass 0.5 in the eased weather', () => {
    expect(UMBRELLA_WEIGHT).toBe(0.5);
    expect(umbrellasUp(view(0))).toBe(false);
    expect(umbrellasUp(view(0.5))).toBe(false);
    expect(umbrellasUp(view(0.51))).toBe(true);
    expect(umbrellasUp(view(0, 0.6))).toBe(true);
    expect(umbrellasUp(view(0.3, 0.3))).toBe(true);
    const overcast: WeatherView = { weights: { clear: 0, overcast: 1, rain: 0, storm: 0 }, intensity: 1 };
    expect(umbrellasUp(overcast)).toBe(false);
  });
});

describe('vehicles at the curb', () => {
  const beat = (code: StoryBeat['code'], minute: number): StoryBeat => ({ code, minute });

  it('parks the VIP car from the arrival beat until the rating beat', () => {
    expect(vipCarPresent([])).toBe(false);
    expect(vipCarPresent([beat('vip.notice', 1)])).toBe(false);
    expect(vipCarPresent([beat('vip.notice', 1), beat('vip.arrival', 2)])).toBe(true);
    expect(vipCarPresent([beat('vip.arrival', 2), beat('wait.long', 3)])).toBe(true);
    expect(vipCarPresent([beat('vip.arrival', 2), beat('vip.rated', 9)])).toBe(false);
    expect(vipCarPresent([beat('vip.arrival', 2), beat('vip.rated', 9), beat('vip.arrival', 20)])).toBe(true);
  });

  it('sends a fire engine for a fire and a police car for a bomb', () => {
    expect(emergencyVehicle({ events: [] })).toBeNull();
    expect(emergencyVehicle({ events: [{ kind: 'bomb', roomId: 1, ransom: 1, detonateAt: 1, found: false }] })).toBe('police');
    expect(emergencyVehicle({ events: [{ kind: 'fire', roomIds: [1], startedAt: 0, spreadAt: 0 }] })).toBe('fire');
  });
});

describe('the curb layer', () => {
  function stubArt(): Art {
    const tex = (label: string): Texture => new Texture({ label });
    return {
      room: () => tex('room'),
      slab: () => tex('slab'),
      shaft: () => tex('shaft'),
      car: () => tex('car'),
      sim: (kind, _band, frame, look) => tex(`person|${kind}|${frame}|${look}`),
      ghost: () => tex('ghost'),
      umbrella: (c) => tex(`umbrella|${c}`),
      vehicle: (k) => tex(`vehicle|${k}`),
    };
  }
  function sprites(root: Container, prefix: string): Sprite[] {
    const out: Sprite[] = [];
    const walk = (n: Container): void => {
      if (n instanceof Sprite && n.visible && n.texture.label?.startsWith(prefix) && (n.parent?.visible ?? true)) out.push(n);
      for (const c of n.children) walk(c as Container);
    };
    walk(root);
    return out;
  }

  function street(): { world: World; layer: Container; frame: (weather: WeatherView, reduced?: boolean) => void } {
    const world = createWorld(12);
    lobby(world, 100, 110);
    for (let i = 0; i < 200; i++) person(world, 'outside');
    const layer = new Container();
    const curb = createCurb(layer, () => art);
    const art = stubArt();
    const frame = (weather: WeatherView, reduced = false): void =>
      curb.update({ world, view: weather, doors: lobbyDoors(world), lookOf: () => 0, nowMs: 5000, dtMs: 16, reducedMotion: reduced, people: true, viewLeft: -1e6, viewRight: 1e6 });
    return { world, layer, frame };
  }

  it('draws no more than twelve commuters, with umbrellas only in the wet', () => {
    const { layer, frame } = street();
    frame(view(0));
    const people = sprites(layer, 'person|').length;
    expect(people).toBeGreaterThan(0);
    expect(people).toBeLessThanOrEqual(12);
    expect(sprites(layer, 'umbrella|')).toHaveLength(0);
    frame(view(0.4));
    expect(sprites(layer, 'umbrella|')).toHaveLength(0);
    frame(view(0.9));
    expect(sprites(layer, 'umbrella|')).toHaveLength(people);
    frame(view(0.1));
    expect(sprites(layer, 'umbrella|')).toHaveLength(0);
  });

  it('brings the VIP car to the curb on the arrival beat, and never touches the world', () => {
    const { world, layer, frame } = street();
    const before = hashWorld(world);
    frame(view(0));
    expect(sprites(layer, 'vehicle|vip')).toHaveLength(0);
    world.story.recent.push({ code: 'vip.arrival', minute: 1 });
    frame(view(0), true); // reduced motion: it is simply there
    expect(sprites(layer, 'vehicle|vip')).toHaveLength(1);
    world.story.recent.push({ code: 'vip.rated', minute: 2, value: 2 });
    frame(view(0), true);
    expect(sprites(layer, 'vehicle|vip')).toHaveLength(0);
    world.story.recent.length = 0;
    expect(hashWorld(world)).toBe(before);
  });

  it('hides the commuters at far zoom and keeps the vehicles', () => {
    const { world, layer } = street();
    const curb = createCurb(layer, stubArt);
    world.events.push({ kind: 'fire', roomIds: [1], startedAt: 0, spreadAt: 0 });
    curb.update({ world, view: view(0), doors: lobbyDoors(world), lookOf: () => 0, nowMs: 5000, dtMs: 16, reducedMotion: true, people: false, viewLeft: -1e6, viewRight: 1e6 });
    expect(curb.count()).toBe(0);
    expect(sprites(layer, 'vehicle|fire')).toHaveLength(1);
  });
});
