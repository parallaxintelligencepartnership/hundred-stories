// The placement chip's second line: each common refusal, read from the sentences build.ts
// really returns, maps to its explainer; an unknown one keeps only the raw text; an elevator
// says which floors it will serve.
import { describe, expect, it } from 'vitest';
import type { Placement } from '../../src/game/api';
import { applyCommand, canBuild, canBuildShaft } from '../../src/sim/build';
import type { CommandResult, World } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';
import { placementNote, refusalExplainer, refusalKind, servesLine } from '../../src/ui/explain';

function reasonOf(result: CommandResult): string {
  if (result.ok) throw new Error('expected a refusal');
  return result.reason;
}

function refused(reason: string, extra: Partial<Placement> = {}): Placement {
  return { floor: 5, x: 10, floorMin: 5, floorMax: 5, ok: false, reason, label: 'Office', cost: 40_000, pending: false, ...extra };
}

/** A lobby from x 0 to 39 on floor 1. */
function lobbyWorld(): World {
  const world = createWorld(5);
  for (let x = 0; x < 40; x += 1) applyCommand(world, { kind: 'build', room: 'lobby', floor: 1, x });
  return world;
}

describe('refusal explainer', () => {
  it('names the cost and the cash for not enough cash', () => {
    const world = lobbyWorld();
    world.cash = 12_000;
    const reason = reasonOf(canBuild(world, 'office', 2, 0));
    expect(reason).toBe('Not enough cash. Offices cost $40,000.');
    expect(refusalKind(reason)).toEqual({ kind: 'cash' });
    expect(refusalExplainer(refused(reason, { floorMin: 2 }), world)).toBe(
      'It costs $40,000 and you have $12,000. Rent comes in each quarter.',
    );
  });

  it('names the floor that must be built under it, or above it underground', () => {
    const world = lobbyWorld();
    const reason = reasonOf(canBuild(world, 'office', 5, 0));
    expect(reason).toBe('Build a floor below this one first.');
    expect(refusalExplainer(refused(reason, { floorMin: 5 }), world)).toBe('Floor 5 needs floor 4 built under it.');
    const deep = reasonOf(canBuild(world, 'fastFood', -3, 0));
    expect(refusalExplainer(refused(deep, { floorMin: -3 }), world)).toBe('Basement 3 needs basement 2 built above it.');
    expect(refusalExplainer(refused(deep, { floorMin: -1 }), world)).toBe('Basement 1 needs the lobby on floor 1 above it.');
  });

  it('says what it overlaps', () => {
    const world = lobbyWorld();
    applyCommand(world, { kind: 'build', room: 'office', floor: 2, x: 0 });
    const room = reasonOf(canBuild(world, 'office', 2, 4));
    expect(room).toBe('Something is already there.');
    expect(refusalExplainer(refused(room), world)).toBe('It overlaps a room. Move it to an empty stretch of floor.');
    applyCommand(world, { kind: 'shaft.build', shaft: 'standard', x: 20, floorMin: 1, floorMax: 2 });
    const shaft = reasonOf(canBuildShaft(world, 'standard', 22, 1, 2));
    expect(shaft).toBe('An elevator is in the way.');
    expect(refusalExplainer(refused(shaft), world)).toBe('It overlaps an elevator. Move it away from the elevator.');
  });

  it('gives the size of the tower for a spot outside it', () => {
    const world = lobbyWorld();
    const reason = reasonOf(canBuild(world, 'office', 2, 370));
    expect(reason).toBe('That does not fit inside the tower.');
    expect(refusalExplainer(refused(reason), world)).toBe('The tower runs from basement 10 to floor 100, 375 tiles across.');
  });

  it('names the star a locked room needs and the stars the tower has', () => {
    const world = lobbyWorld();
    const reason = reasonOf(canBuild(world, 'shop', 2, 0));
    expect(reason).toBe('Needs 3 stars.');
    expect(refusalKind(reason)).toEqual({ kind: 'needsStar', star: 3 });
    expect(refusalExplainer(refused(reason, { label: 'Shop' }), world)).toBe('Shop unlocks at 3 stars. You have 1 star.');
    expect(refusalKind('Needs Tower status.')).toEqual({ kind: 'needsStar', star: 6 });
  });

  it('adds nothing for a reason it does not know, so the chip keeps the raw text alone', () => {
    const world = lobbyWorld();
    expect(refusalKind('The lobby goes on floor 1.')).toBe(null);
    expect(refusalExplainer(refused('The lobby goes on floor 1.'), world)).toBe(null);
    expect(placementNote(refused('The lobby goes on floor 1.'), { kind: 'room', room: 'lobby' }, world)).toBe('');
  });
});

describe('elevator serves line', () => {
  it('counts the floors a standard car serves and the stops an express makes', () => {
    expect(servesLine('standard', 1, 12)).toBe('Serves 12 floors, 1 to 12.');
    expect(servesLine('standard', -2, 3)).toBe('Serves 5 floors, B2 to 3.');
    expect(servesLine('express', 1, 31)).toBe('Stops at 3 of 31 floors: lobbies and basements.');
  });

  it('is the note for a buildable elevator and nothing for a buildable room', () => {
    const world = lobbyWorld();
    const ok: Placement = { floor: 1, x: 10, floorMin: 1, floorMax: 6, ok: true, label: 'Elevator', cost: 200_000, pending: false };
    expect(placementNote(ok, { kind: 'shaft', shaft: 'standard' }, world)).toBe('Serves 6 floors, 1 to 6.');
    expect(placementNote({ ...ok, floorMax: 1, label: 'Office' }, { kind: 'room', room: 'office' }, world)).toBe('');
  });
});
