// The second line of the placement chip: for an elevator, the floors it will serve; for a
// refusal the player can act on, one sentence on what to do about it. The first line keeps the
// sim's own words (src/sim/build.ts), so a reason this file does not know stays as it was,
// with no second line.

import type { Placement, Tool } from '../game/api';
import { servedFloors } from '../render/overlays';
import { CONDO_SOLD_REASON } from '../sim/build';
import { LIMITS, ROOMS } from '../sim/rules';
import { spanTop } from '../sim/types';
import type { ShaftKind, Star, World } from '../sim/types';
import { formatFloor, formatMoney, starsTitle } from './format';
import { toolUpkeep } from './palette';

/** Which common refusal a build.ts reason is, or null for one the chip shows as is. */
export type RefusalKind = 'cash' | 'noFloorBelow' | 'nothingOver' | 'overlapsRoom' | 'overlapsShaft' | 'outOfTower' | 'needsStar';

/**
 * Read a refusal reason back into its kind. The sentences are build.ts's (cannotAfford,
 * hasSupport, restsOnStructure underground, roomInTheWay, shaftInTheWay, the tower bounds,
 * starText); a change there that this misses only loses the second line.
 */
export function refusalKind(reason: string): { kind: RefusalKind; star?: Star } | null {
  if (reason.startsWith('Not enough cash.')) return { kind: 'cash' };
  if (
    reason === 'Build a floor below this one first.' ||
    reason === 'Build the floor above this one first.' ||
    reason === 'Build a lobby first.'
  ) {
    return { kind: 'noFloorBelow' };
  }
  if (reason === 'Nothing is holding this up. Build over it first.') return { kind: 'nothingOver' };
  if (reason === 'Something is already there.') return { kind: 'overlapsRoom' };
  if (reason === 'An elevator is in the way.') return { kind: 'overlapsShaft' };
  if (reason === 'That does not fit inside the tower.' || reason === 'That floor does not exist.') return { kind: 'outOfTower' };
  if (reason === 'Needs Tower status.') return { kind: 'needsStar', star: 6 };
  const stars = /^Needs (\d) stars?\.$/.exec(reason);
  if (stars) return { kind: 'needsStar', star: Number(stars[1]) as Star };
  return null;
}

function floorName(floor: number): string {
  return formatFloor(floor).toLowerCase();
}

/**
 * The floor a footprint stands on (build.ts hasSupport): the one under its bottom above
 * ground, the one over its top underground (`top` is the span's top floor, floorMax + 1 for
 * a shaft span). B1 and a basement span reaching it hang from the lobby on floor 1.
 */
function supportFloor(floorMin: number, top: number): number {
  if (floorMin > 1) return floorMin - 1;
  if (floorMin === -1 || top === -1) return 1;
  return top + 1;
}

/** "It also costs $10,000 a quarter to run." for a placement with a running cost, else empty. */
export function upkeepSentence(upkeep: number, also: boolean): string {
  if (upkeep <= 0) return '';
  return `It ${also ? 'also ' : ''}costs ${formatMoney(upkeep)} a quarter to run.`;
}

/**
 * One sentence under a refused chip, or null when the reason is not one of the common ones.
 * `upkeep` is what the placement would cost to run each quarter (toolUpkeep), said after the
 * cash refusal so the price and the running cost are read together.
 */
export function refusalExplainer(
  placement: Placement,
  world: Pick<World, 'cash' | 'stars'>,
  height = 1,
  upkeep = 0,
): string | null {
  if (placement.ok || !placement.reason) return null;
  const found = refusalKind(placement.reason);
  if (!found) return null;
  switch (found.kind) {
    case 'cash':
      return [
        `It costs ${formatMoney(placement.cost)} and you have ${formatMoney(world.cash)}. Rent comes in each quarter.`,
        upkeepSentence(upkeep, true),
      ]
        .filter(Boolean)
        .join(' ');
    case 'noFloorBelow': {
      // A room's placement keeps floorMax at its floor, so its height gives the span's top.
      const top = Math.max(placement.floorMax, spanTop(placement.floorMin, height));
      const under = supportFloor(placement.floorMin, top);
      if (placement.floorMin < 0 && under === 1) return 'Basement 1 needs the lobby on floor 1 above it.';
      const side = placement.floorMin > 0 ? 'under' : 'above';
      return `${formatFloor(placement.floorMin)} needs ${floorName(under)} built ${side} it.`;
    }
    case 'nothingOver': {
      // The floor exists but nothing on it covers this stretch: a basement room hangs from the
      // floor over its top (build.ts restingFloor).
      const top = Math.max(placement.floorMax, spanTop(placement.floorMin, height));
      const over = supportFloor(placement.floorMin, top);
      if (over === 1) return `${formatFloor(placement.floorMin)} needs the lobby on floor 1 right above it.`;
      return `${formatFloor(placement.floorMin)} needs something built on ${floorName(over)} right above it.`;
    }
    case 'overlapsRoom':
      return 'It overlaps a room. Move it to an empty stretch of floor.';
    case 'overlapsShaft':
      return 'It overlaps an elevator. Move it away from the elevator.';
    case 'outOfTower':
      return `The tower runs from basement ${-LIMITS.minFloor} to floor ${LIMITS.maxFloor}, ${LIMITS.towerWidth} tiles across.`;
    case 'needsStar':
      return `${placement.label} unlocks at ${starsTitle(found.star ?? 1)}. You have ${starsTitle(world.stars)}.`;
  }
}

/** The kind of elevator a placement builds or stretches, or null for a room. */
export function placementShaftKind(placement: Placement, tool: Tool, world: Pick<World, 'shafts'>): ShaftKind | null {
  if (placement.shaftId !== undefined) return world.shafts.get(placement.shaftId)?.kind ?? null;
  return tool.kind === 'shaft' ? tool.shaft : null;
}

/** For an elevator the chip can build: how many floors it will stop at, and which. */
export function servesLine(kind: ShaftKind, floorMin: number, floorMax: number): string {
  const floors = servedFloors(kind, floorMin, floorMax);
  const span = floorMax - floorMin + 1 - (floorMin < 0 && floorMax > 0 ? 1 : 0);
  const short = (f: number): string => (f < 0 ? `B${-f}` : String(f));
  if (floors.length === span) return `Serves ${span} floors, ${short(floorMin)} to ${short(floorMax)}.`;
  return `Stops at ${floors.length} of ${span} floors: lobbies and basements.`;
}

/**
 * The chip's second line for this placement, or empty for none. A new room or elevator with a
 * running cost says it (one car for an elevator); stretching an elevator adds none.
 */
export function placementNote(placement: Placement, tool: Tool, world: Pick<World, 'cash' | 'stars' | 'shafts'>): string {
  const upkeep = placement.shaftId === undefined ? toolUpkeep(tool, world) : 0;
  if (!placement.ok) return refusalExplainer(placement, world, tool.kind === 'room' ? ROOMS[tool.room].height : 1, upkeep) ?? '';
  const kind = placementShaftKind(placement, tool, world);
  return [kind ? servesLine(kind, placement.floorMin, placement.floorMax) : '', upkeepSentence(upkeep, false)].filter(Boolean).join(' ');
}

/**
 * The demolish refusals, by build.ts's words (doDemolish, doDemolishShaft, strandsSomething),
 * each with the sentence said after it, or empty where the reason already says what to do.
 */
const DEMOLISH_NEXT: ReadonlyMap<string, string> = new Map([
  ['People are inside.', 'Wait until the room is empty.'],
  ['Wait until the cars are empty.', ''],
  ['Put the fire out first.', ''],
  ['Deal with the bomb first.', ''],
  ['There is nothing to demolish.', ''],
  [CONDO_SOLD_REASON, ''],
  ['Something above rests on this. Remove that first.', 'Demolish from the top down.'],
  ['Something below rests on this. Remove that first.', 'Underground, demolish from the deepest floor up.'],
]);

/**
 * What the notice says for a refused demolish from a tap on the tower: the sim's reason and, for
 * the common ones, one plain sentence on what to do. Null for a line that is not a demolish
 * refusal, which stays a news line as before.
 */
export function demolishNotice(reason: string): string | null {
  const next = DEMOLISH_NEXT.get(reason);
  if (next === undefined) return null;
  return next ? `${reason} ${next}` : reason;
}
