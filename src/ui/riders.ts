// A car's rider setting, as the player reads it (decided by Matt, 2026-09-29: "Those riders
// first"). The setting is a priority, not a lock: a car set to "Hotel guests first" or "Office
// staff first" serves those riders first and carries everyone else when it is free. The words
// here are the elevator card's and the hover card's; the command is shaft.setCarServes as before.
//
// The warning asks one question of the tower the UI already reads (GameApi.world): with this shaft
// holding no Everyone car, is there a room on its floors whose people no car anywhere carries on
// that floor, either as everyone or as the riders it serves first?

import { carRangeOf, type Car, type RoomKind, type Shaft, type World } from '../sim/types';
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

/** On the card when the shaft has no Everyone car and other tenants depend on it. */
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
 * True when this shaft has no Everyone car and a room on one of its floors (above or below the
 * ground floor, where everyone walks in) has no car anywhere that stops on its floor and either
 * carries everyone or serves that room's people first. Every elevator counts, this one included:
 * a hotel shaft beside an office shaft leaves nobody waiting, since each rides its own car.
 */
export function othersWaitLonger(world: World, shaft: Shaft): boolean {
  if (shaft.cars.length === 0 || shaft.cars.some((car) => car.serves === 'any')) return false;
  const shafts = [...world.shafts.values()];
  for (const room of world.rooms.values()) {
    if (room.floor === 1 || !shaft.stops.has(room.floor)) continue;
    const groups = groupsOfRoom(room.kind);
    if (groups === null) continue;
    const staff = STAFF_ROOMS.has(room.kind);
    if (shaft.kind === 'service' && !staff) continue;
    const carried = shafts.some(
      (any) =>
        (any.kind !== 'service' || staff) &&
        any.stops.has(room.floor) &&
        any.cars.some((car) => {
          const span = carRangeOf(any, car);
          return room.floor >= span.lo && room.floor <= span.hi && (car.serves === 'any' || groups.includes(car.serves));
        }),
    );
    if (!carried) return true;
  }
  return false;
}
