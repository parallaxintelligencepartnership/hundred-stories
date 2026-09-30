// A car's rider setting, as the player reads it (decided by Matt, 2026-09-29: "Those riders
// first"). The setting is a priority, not a lock: a car set to "Hotel guests first" or "Office
// staff first" serves those riders first and carries everyone else when it is free. The words
// here are the elevator card's and the hover card's; the command is shaft.setCarServes as before.
//
// The warning asks routing one question of the tower the UI already reads (GameApi.world): does a
// trip other tenants make from the street to their rooms ride this elevator on a car kept for
// somebody else, as a leftover? Asking routing, rather than looking at the rooms on this shaft's
// floors, also catches an express that is the only way up to a sky lobby (P6 review A1), and
// stays quiet for a floor whose people take the stairs.

import { entrances, findRoute } from '../sim/routing';
import { carRangeOf, type Car, type RiderClass, type Room, type RoomKind, type Shaft, type World } from '../sim/types';
import type { IconName } from './icons';

export type RiderSetting = Car['serves'];

/** The three choices, in the order the card shows them. */
export const RIDER_CHOICES: readonly RiderSetting[] = ['any', 'hotel', 'office'];

export const RIDER_LABEL: Record<RiderSetting, string> = {
  any: 'Everyone',
  hotel: 'Hotel guests first',
  office: 'Office staff first',
};

export const RIDER_ICON: Record<RiderSetting, IconName> = {
  any: 'population',
  hotel: 'hotel',
  office: 'structure',
};

/** Under a car's choices while it serves some riders first. */
export const RIDER_NOTE = 'These riders go first. Others ride when the car is free, so they may wait longer.';

/**
 * On the card when other tenants' routed trips ride this elevator as leftovers: a trip leg on it
 * that no car carrying them as its own (an Everyone car or their group's) covers end to end
 * (othersWaitLonger). A shaft with an Everyone car can still warn, for floors past that car's range.
 */
export const RIDER_WARNING = 'Other tenants on these floors will wait longer for this elevator.';

type Group = Exclude<RiderSetting, 'any'>;

/**
 * The groups whose people use a room of this kind as a car's own riders, or null for a room no
 * one rides to (the lobbies and the stairs). Hotel rooms and housekeeping are the hotel's (a
 * housekeeper rides a hotel car as its own, eb71c55); offices are the office staff's; security
 * and recycling staff ride either group's cars as their own; everyone else (homes, shops, food,
 * halls, parking, the metro, the cathedral) is nobody's group.
 */
function groupsOfRoom(kind: RoomKind): readonly Group[] | null {
  switch (kind) {
    case 'lobby':
    case 'skyLobby':
    case 'stairs':
    case 'escalator':
      return null;
    case 'hotelSingle':
    case 'hotelTwin':
    case 'hotelSuite':
    case 'housekeeping':
      return ['hotel'];
    case 'office':
      return ['office'];
    case 'security':
    case 'recycling':
      return ['hotel', 'office'];
    default:
      return [];
  }
}

/** Staff rooms: the only rooms whose people ride a service elevator. */
const STAFF_ROOMS: ReadonlySet<RoomKind> = new Set<RoomKind>(['housekeeping', 'security', 'recycling']);

/**
 * How the people of a room of this kind ask routing for their way (people.ts routeOptsFor): the
 * rider class and whether they are staff. Null for rooms nobody rides to, and for guards and
 * collectors, whom every car carries as its own (routing.ts graphKeyOf), so never as leftovers.
 */
function tripOf(kind: RoomKind): { riderClass: RiderClass; staff: boolean } | null {
  const groups = groupsOfRoom(kind);
  if (groups === null) return null;
  if (kind === 'security' || kind === 'recycling') return null;
  if (kind === 'housekeeping') return { riderClass: 'hotel', staff: true };
  if (groups.includes('hotel')) return { riderClass: 'hotel', staff: false };
  if (groups.includes('office')) return { riderClass: 'office', staff: false };
  return { riderClass: 'other', staff: STAFF_ROOMS.has(kind) };
}

/** Does a car of this shaft carry this class as its own on the whole ride from `from` to `to`? */
function ownCarRides(shaft: Shaft, cls: RiderClass, from: number, to: number): boolean {
  return shaft.cars.some((car) => {
    if (car.serves !== 'any' && car.serves !== cls) return false;
    const span = carRangeOf(shaft, car);
    return from >= span.lo && from <= span.hi && to >= span.lo && to <= span.hi;
  });
}

/** The answer per shaft, kept while the rooms and the cars' settings stay as they were. */
const remembered = new WeakMap<World, Map<string, boolean>>();

function carsSignature(world: World): string {
  const parts: string[] = [];
  for (const shaft of world.shafts.values()) for (const car of shaft.cars) parts.push(`${car.id}:${car.serves}:${car.range ? `${car.range.lo}-${car.range.hi}` : ''}`);
  return parts.join(',');
}

/**
 * True when a trip from the street to a room of other tenants, planned the way those tenants plan
 * it (routing.ts, with its rider class), rides this elevator where no car of it carries them as
 * its own: they wait for a kept car to be free. One trip is asked per floor and kind of rider, from
 * the ground lobby's first door to the room's middle. An elevator whose cars all carry everyone
 * never warns.
 */
export function othersWaitLonger(world: World, shaft: Shaft): boolean {
  if (shaft.cars.length === 0 || shaft.cars.every((car) => car.serves === 'any')) return false;
  const door = entrances(world)[0];
  if (!door) return false;
  const key = `${shaft.id}|${world.structureVersion}|${carsSignature(world)}`;
  let known = remembered.get(world);
  if (!known) remembered.set(world, (known = new Map()));
  const hit = known.get(key);
  if (hit !== undefined) return hit;
  const answer = anyLeftoverTrip(world, shaft, door);
  known.clear(); // one answer per shaft for the tower as it stands; an older one is never read again
  known.set(key, answer);
  return answer;
}

function anyLeftoverTrip(world: World, shaft: Shaft, door: { floor: number; x: number }): boolean {
  const asked = new Set<string>();
  for (const room of world.rooms.values()) {
    if (room.floor === door.floor) continue; // walked to
    const trip = tripOf(room.kind);
    if (!trip) continue;
    const once = `${room.floor}|${trip.riderClass}|${trip.staff}`;
    if (asked.has(once)) continue;
    asked.add(once);
    const legs = findRoute(world, door, { floor: room.floor, x: roomMiddle(room) }, trip);
    if (!legs) continue;
    for (const leg of legs) {
      if (leg.kind !== 'ride' || leg.shaftId !== shaft.id) continue;
      if (!ownCarRides(shaft, trip.riderClass, leg.fromFloor, leg.toFloor)) return true;
    }
  }
  return false;
}

function roomMiddle(room: Room): number {
  return room.x + Math.floor(room.width / 2);
}
