// The design sheet's place shot builds an office at a spot it computes from the fixture
// (scripts/make-design-sheet.mjs pickPlaceSpot). The spot must be one the game accepts, so this
// holds it to the sim's own rule, and holds the script's copied constants to their originals.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canBuild } from '../../src/sim/build';
import { DEMO_X_MAX, DEMO_X_MIN, ROOMS } from '../../src/sim/rules';
import { deserialize } from '../../src/sim/save';

const ROOT = join(__dirname, '..', '..');
const FIXTURE = join(ROOT, 'store', 'fixtures', 'demo-tower.json');

interface Geo { left: number; top: number; width: number; height: number; bar: number; bottomCover: number }
interface Spot { what: string; floor: number; tile: number; x: number; y: number; inView: boolean }
interface SheetModule {
  pickPlaceSpot(save: unknown, geo: Geo): { target: Spot | null; candidates: Spot[] };
  fixtureAtHour(saveText: string, hour: number): string;
  OFFICE_WIDTH: number;
  DEMO_X_MIN: number;
  DEMO_X_MAX: number;
}

const url = pathToFileURL(join(ROOT, 'scripts', 'make-design-sheet.mjs')).href;
const sheet = (await import(/* @vite-ignore */ url)) as SheetModule;

describe('the place shot spot', () => {
  const text = sheet.fixtureAtHour(readFileSync(FIXTURE, 'utf8'), 13);
  const save = JSON.parse(text);
  const desk: Geo = { left: 0, top: 0, width: 1440, height: 900, bar: 64, bottomCover: 0 };

  it('copies the office width and the demo cap from the rules', () => {
    expect(sheet.OFFICE_WIDTH).toBe(ROOMS.office.width);
    expect(sheet.DEMO_X_MIN).toBe(DEMO_X_MIN);
    expect(sheet.DEMO_X_MAX).toBe(DEMO_X_MAX);
  });

  it('picks a spot inside the band that the game accepts, and every candidate is one it accepts', () => {
    const loaded = deserialize(text);
    if (!loaded.ok) throw new Error(loaded.reason);
    const pick = sheet.pickPlaceSpot(save, desk);
    expect(pick.target).not.toBeNull();
    expect(pick.target!.inView).toBe(true);
    for (const c of pick.candidates) expect(canBuild(loaded.world, 'office', c.floor, c.tile)).toEqual({ ok: true });
  });

  it('finds nothing when every floor is full', () => {
    const full = { ...save, rooms: [{ kind: 'lobby', floor: 1, height: 1, x: 0, width: 375 }, { kind: 'office', floor: 2, height: 1, x: 0, width: 375 }] };
    expect(sheet.pickPlaceSpot(full, desk).candidates.filter((c) => c.floor === 2)).toEqual([]);
  });
});
