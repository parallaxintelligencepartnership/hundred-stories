// The second line of the placement chip: for an elevator, the floors it will serve; for a
// refusal the player can act on, one sentence on what to do about it. The first line keeps the
// sim's own words (src/sim/build.ts), so a reason this file does not know stays as it was,
// with no second line.

import type { Placement, Tool } from '../game/api';
import { servedFloors } from '../render/overlays';
import { LIMITS, ROOMS } from '../sim/rules';
import { spanTop } from '../sim/types';
import type { ShaftKind, Star, World } from '../sim/types';
import { formatFloor, formatMoney, starsTitle } from './format';

/** Which common refusal a build.ts reason is, or null for one the chip shows as is. */
export type RefusalKind = 'cash' | 'noFloorBelow' | 'overlapsRoom' | 'overlapsShaft' | 'outOfTower' | 'needsStar';

/**
 * Read a refusal reason back into its kind. The sentences are build.ts's (cannotAfford,
 * hasSupport, roomInTheWay, shaftInTheWay, the tower bounds, starText); a change there that
 * this misses only loses the second line.
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

/** One sentence under a refused chip, or null when the reason is not one of the common ones. */
export function refusalExplainer(
  placement: Placement,
  world: Pick<World, 'cash' | 'stars'>,
  height = 1,
): string | null {
  if (placement.ok || !placement.reason) return null;
  const found = refusalKind(placement.reason);
  if (!found) return null;
  switch (found.kind) {
    case 'cash':
      return `It costs ${formatMoney(placement.cost)} and you have ${formatMoney(world.cash)}. Rent comes in each quarter.`;
    case 'noFloorBelow': {
      // A room's placement keeps floorMax at its floor, so its height gives the span's top.
      const top = Math.max(placement.floorMax, spanTop(placement.floorMin, height));
      const under = supportFloor(placement.floorMin, top);
      if (placement.floorMin < 0 && under === 1) return 'Basement 1 needs the lobby on floor 1 above it.';
      const side = placement.floorMin > 0 ? 'under' : 'above';
      return `${formatFloor(placement.floorMin)} needs ${floorName(under)} built ${side} it.`;
    }
    case 'overlapsRoom':
      return 'It overlaps a room. Move it to an empty stretch of floor.';
    case 'overlapsShaft':
      return 'It overlaps an elevator. Move it clear of the shaft.';
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

/** The chip's second line for this placement, or empty for none. */
export function placementNote(placement: Placement, tool: Tool, world: Pick<World, 'cash' | 'stars' | 'shafts'>): string {
  if (!placement.ok) return refusalExplainer(placement, world, tool.kind === 'room' ? ROOMS[tool.room].height : 1) ?? '';
  const kind = placementShaftKind(placement, tool, world);
  return kind ? servesLine(kind, placement.floorMin, placement.floorMax) : '';
}
