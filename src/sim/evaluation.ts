// Room evaluation: how good a room is to work in, live in or sleep in, and the
// decision that makes a tenant give up and leave. See docs/DESIGN.md section 7.
// Every number comes from rules.ts; nothing here is inlined.

import { EVAL, NOISE, RENT, ROOMS, takesRent } from './rules';
import { isFollowed, recordBeat } from './story';
import { log } from './world';
import type { Id, Room, RoomKind, World } from './types';

const HOTEL_KINDS: readonly RoomKind[] = ['hotelSingle', 'hotelTwin', 'hotelSuite'];

function isHotelRoom(kind: RoomKind): boolean {
  return HOTEL_KINDS.includes(kind);
}

function isHotelOrCondo(kind: RoomKind): boolean {
  return kind === 'condo' || isHotelRoom(kind);
}

export function clamp01(value: number): number {
  if (!(value > 0)) return 0;
  return value > 1 ? 1 : value;
}

/**
 * Tiles of separation allowed between a noise source and a quiet room, or null
 * when the pair does not interact at all. Three pairings exist:
 *   fast food next to an office        NOISE.fastFoodToOfficeTiles
 *   any noisy room next to a hotel room or condo   NOISE.commercialToHotelOrCondoTiles
 *   an office next to a hotel room or condo        NOISE.officeToHotelOrCondoTiles
 * Distance is measured as the gap in tiles between the two room footprints, so
 * rooms that touch are 0 tiles apart and a neighbor counts while gap <= range.
 */
export function noiseRangeTiles(source: RoomKind, target: RoomKind): number | null {
  if (!ROOMS[target].quiet) return null;
  if (source === 'fastFood' && target === 'office') return NOISE.fastFoodToOfficeTiles;
  if (!isHotelOrCondo(target)) return null;
  if (ROOMS[source].noisy) return NOISE.commercialToHotelOrCondoTiles;
  if (source === 'office') return NOISE.officeToHotelOrCondoTiles;
  return null;
}

export function gapTiles(a: Room, b: Room): number {
  if (b.x >= a.x + a.width) return b.x - (a.x + a.width);
  if (a.x >= b.x + b.width) return a.x - (b.x + b.width);
  return 0;
}

function floorsOverlap(a: Room, b: Room): boolean {
  return a.floor < b.floor + b.height && b.floor < a.floor + a.height;
}

function xOverlap(a: Room, b: Room): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width;
}

/** Floor 0 does not exist, so the floor below 1 is -1 and the floor above -1 is 1. */
function floorBelow(floor: number): number {
  return floor - 1 === 0 ? -1 : floor - 1;
}

function floorAbove(floor: number): number {
  return floor + 1 === 0 ? 1 : floor + 1;
}

/** Noisy rooms that bother this room, sorted by id so the result is stable. */
export function noisyNeighborsOf(world: World, room: Room): Room[] {
  const floors: number[] = [];
  for (let f = room.floor; f < room.floor + room.height; f++) floors.push(f);
  floors.push(floorBelow(room.floor), floorAbove(room.floor + room.height - 1));

  const seen = new Set<Id>([room.id]);
  const out: Room[] = [];
  for (const floor of floors) {
    for (const other of world.floorIndex.rooms.get(floor) ?? []) {
      if (seen.has(other.id)) continue;
      seen.add(other.id);
      const range = noiseRangeTiles(other.kind, room.kind);
      if (range === null) continue;
      const counts = floorsOverlap(room, other)
        ? gapTiles(room, other) <= range
        : NOISE.verticalNeighborsCount && xOverlap(room, other);
      if (counts) out.push(other);
    }
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

export function averageTenantStress(world: World, room: Room): number {
  let total = 0;
  let count = 0;
  for (const id of room.tenants) {
    const sim = world.sims.get(id);
    if (!sim) continue;
    total += sim.stress;
    count += 1;
  }
  return count === 0 ? 0 : total / count;
}

function label(kind: RoomKind): string {
  return ROOMS[kind].label.toLowerCase();
}

/** The single biggest reason this room is unliveable, in plain English. */
export function leaveReasonFor(world: World, room: Room): string {
  const noisy = ROOMS[room.kind].quiet ? noisyNeighborsOf(world, room) : [];
  const penalties = [
    { weight: room.infested ? EVAL.infestedPenalty : 0, text: `Cockroaches in the ${label(room.kind)} on floor ${room.floor}.` },
    { weight: room.dirty ? EVAL.dirtyPenalty : 0, text: `Nobody cleaned the ${label(room.kind)} on floor ${room.floor}.` },
    {
      weight: EVAL.noisePenaltyPerNeighbor * noisy.length,
      text: noisy.length > 0 ? `Too noisy next to the ${label((noisy[0] as Room).kind)} on floor ${room.floor}.` : '',
    },
    {
      weight: EVAL.stressWeight * averageTenantStress(world, room),
      text: `Too long waiting for an elevator on floor ${room.floor}.`,
    },
    {
      weight: takesRent(room.kind) ? (Math.max(0, room.rent - 100) / 100) * RENT.evalWeight : 0,
      text: `The rent on floor ${room.floor} was too high.`,
    },
  ];
  let best = penalties[0] as { weight: number; text: string };
  for (const p of penalties) if (p.text !== '' && p.weight > best.weight) best = p;
  if (best.text === '') return `Life on floor ${room.floor} was not worth the rent.`;
  return best.text;
}

/** Score one room 0..1 without touching any other state. */
export function evaluateRoom(world: World, room: Room): number {
  const quiet = ROOMS[room.kind].quiet;
  const stressPenalty = quiet ? EVAL.stressWeight * averageTenantStress(world, room) : 0;
  const noisePenalty = quiet ? EVAL.noisePenaltyPerNeighbor * noisyNeighborsOf(world, room).length : 0;
  const dirtyPenalty = room.dirty ? EVAL.dirtyPenalty : 0;
  const infestedPenalty = room.infested ? EVAL.infestedPenalty : 0;
  const rentTerm = takesRent(room.kind) ? ((100 - room.rent) / 100) * RENT.evalWeight : 0;
  return clamp01(1 + rentTerm - stressPenalty - noisePenalty - dirtyPenalty - infestedPenalty);
}

function moveOut(world: World, room: Room): void {
  const reason = leaveReasonFor(world, room);
  // Story: every followed tenant gets their closing beat; the rest of the room shares one.
  let roomBeat = false;
  for (const id of room.tenants) {
    const sim = world.sims.get(id);
    if (!sim) continue;
    const followed = isFollowed(world.story, id);
    if (followed || !roomBeat) {
      recordBeat(world.story, { code: 'room.vacated', minute: world.time.minute, simId: id, roomId: room.id, value: 1 });
      if (!followed) roomBeat = true;
    }
    sim.state = 'leaving';
    sim.leaveReason = reason;
    sim.homeRoomId = null;
    sim.route = [];
    world.stats.tenantsLeftReasons[reason] = (world.stats.tenantsLeftReasons[reason] ?? 0) + 1;
  }
  room.tenants = [];
  if (room.kind === 'office' || room.kind === 'condo') room.vacant = true;
  room.lowEvalSinceMinute = null;
  log(world, reason, 'warn', { roomId: room.id });
}

/** Called hourly by tick.ts. Scores every room and moves fed up tenants out. */
export function tickEvaluation(world: World): void {
  for (const room of world.rooms.values()) {
    room.eval = evaluateRoom(world, room);

    if (room.eval >= EVAL.leaveThreshold) {
      room.lowEvalSinceMinute = null;
      continue;
    }
    if (room.lowEvalSinceMinute === null) {
      room.lowEvalSinceMinute = world.time.minute;
      continue;
    }
    if (world.time.minute - room.lowEvalSinceMinute < EVAL.leaveAfterMinutes) continue;
    if (room.tenants.length === 0) continue;
    moveOut(world, room);
  }
}
