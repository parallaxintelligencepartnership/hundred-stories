// The store tower (store/fixtures/store-tower.json, made by scripts/make-store-tower.ts) seeds the
// store screenshots (design pass D-44). It must be a tower a player could build: a save the game
// loads, at three stars or fewer, holding only rooms and elevators that star count allows, with the
// status bar's quarter and day baselines set so both changes read as figures, not dashes.

import fixture from '../../store/fixtures/store-tower.json?raw';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { deserialize } from '../../src/sim/save';
import { ROOMS, SHAFTS } from '../../src/sim/rules';
import { clockOf, type World } from '../../src/sim/types';

function load(): World {
  const result = deserialize(fixture);
  if (!result.ok) throw new Error(result.reason);
  return result.world;
}

describe('the store tower fixture', () => {
  it('loads as a valid save under the current loader', () => {
    const result = deserialize(fixture);
    expect(result.ok ? 'ok' : result.reason).toBe('ok');
  });

  it('shows three stars or fewer', () => {
    const world = load();
    expect(world.stars).toBeLessThanOrEqual(3);
    expect(world.stars).toBe(3);
  });

  it('holds only rooms and elevators its star count allows', () => {
    const world = load();
    for (const room of world.rooms.values()) expect(ROOMS[room.kind].star, room.kind).toBeLessThanOrEqual(world.stars);
    for (const shaft of world.shafts.values()) expect(SHAFTS[shaft.kind].star, shaft.kind).toBeLessThanOrEqual(world.stars);
  });

  it('sets both status bar baselines', () => {
    const world = load();
    expect(typeof world.quarterStartCash).toBe('number');
    expect(typeof world.dayStartPopulation).toBe('number');
  });

  it('is saved at 13:00 on a weekday', () => {
    const clock = clockOf(load().time.minute);
    expect(clock.minuteOfDay).toBe(13 * 60);
    expect(clock.isWeekend).toBe(false);
  });

  it('is the fixture the store screenshots seed', async () => {
    const mod = (await import(pathToFileURL(join(__dirname, '..', '..', 'scripts', 'make-store-shots.mjs')).href)) as { FIXTURE: string };
    expect(mod.FIXTURE).toBe(join(__dirname, '..', '..', 'store', 'fixtures', 'store-tower.json'));
  });

  it('leaves the link preview on the demo tower it was captured from', async () => {
    const mod = (await import(pathToFileURL(join(__dirname, '..', '..', 'scripts', 'make-store-shots.mjs')).href)) as { OG_FIXTURE: string };
    expect(mod.OG_FIXTURE).toBe(join(__dirname, '..', '..', 'store', 'fixtures', 'demo-tower.json'));
  });

  it('seeds the fixture afresh before every capture, so the clock holds 13:00', async () => {
    type Step = (...args: unknown[]) => Promise<unknown>;
    const { shootScene } = (await import(pathToFileURL(join(__dirname, '..', '..', 'scripts', 'make-store-shots.mjs')).href)) as {
      shootScene(browser: unknown, base: string, spec: unknown, scene: string, steps: Record<string, Step>): Promise<unknown>;
    };
    const calls: string[] = [];
    const step = (name: string): Step => async () => {
      calls.push(name);
      return name === 'capture' ? 'png' : undefined;
    };
    const steps = { seed: step('seed'), openGame: step('openGame'), toScene: step('toScene'), capture: step('capture') };
    for (const scene of ['tower', 'wide']) expect(await shootScene({}, 'http://x', { id: 's' }, scene, steps)).toBe('png');
    expect(calls).toEqual(['seed', 'openGame', 'toScene', 'capture', 'seed', 'openGame', 'toScene', 'capture']);
  });

  it('rewrites the tracked og.png only when asked, with --og or ONLY=og', async () => {
    const { shootsOg } = (await import(pathToFileURL(join(__dirname, '..', '..', 'scripts', 'make-store-shots.mjs')).href)) as {
      shootsOg(args: Set<string>, only: Set<string> | null): boolean;
    };
    expect(shootsOg(new Set(), null)).toBe(false);
    expect(shootsOg(new Set(['--no-build']), null)).toBe(false);
    expect(shootsOg(new Set(), new Set(['steam-screenshot']))).toBe(false);
    expect(shootsOg(new Set(['--og']), null)).toBe(true);
    expect(shootsOg(new Set(), new Set(['og', 'steam-header-capsule']))).toBe(true);
  });
});
