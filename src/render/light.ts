// Light and time: the screen wide light tint by minute of day, and the window state each
// room shows. Pure functions, no pixi, so the rules are testable without a GPU.
// See docs/reviews/2026-09-22-codex-astra-ui-graphics.md section 2 and docs/VISUAL.md.

import type { Room, RoomKind, World } from '../sim/types';

/**
 * What a room's windows show. day: sky in the panes. lit: someone inside at night, warm panes
 * with a pale header. vacant: nobody inside at night, the panes go dark. housekeeping: a dirty
 * hotel room at night, dark panes with only the lamp left on.
 */
export type WindowState = 'day' | 'lit' | 'vacant' | 'housekeeping';

export const WINDOW_STATES: readonly WindowState[] = ['day', 'lit', 'vacant', 'housekeeping'];

export const HOTEL_KINDS: ReadonlySet<RoomKind> = new Set<RoomKind>(['hotelSingle', 'hotelTwin', 'hotelSuite']);

/** Lobbies have no capacity, so their lighting follows the people on their floor instead. */
const LOBBY_LIGHT_KINDS: ReadonlySet<RoomKind> = new Set<RoomKind>(['lobby', 'skyLobby']);

/** The states a kind can ever show, so the boot bake does not make textures nobody draws. */
export function windowStatesFor(kind: RoomKind): readonly WindowState[] {
  return HOTEL_KINDS.has(kind) ? WINDOW_STATES : WINDOW_STATES.filter((s) => s !== 'housekeeping');
}

/**
 * Every floor with a person standing on it (not riding, not gone, not outside). Built once
 * per full reconcile pass, and only at night, so lobby lighting costs one walk of the sims.
 */
export function floorsWithPeople(world: World): Set<number> {
  const floors = new Set<number>();
  for (const sim of world.sims.values()) {
    if (sim.state === 'gone' || sim.state === 'outside' || sim.state === 'riding' || sim.inCarId !== null) continue;
    floors.add(sim.pos.floor);
  }
  return floors;
}

/**
 * The window state for one room. By day every room shows the day panes. At night a room
 * with anyone inside is lit, a lobby is lit while anyone stands on its floor, a dirty hotel
 * room keeps only its lamp, and everything else goes dark: a tenant who is out leaves a dark
 * window the way the original does.
 */
export function windowStateOf(room: Room, night: boolean, peopleFloors: ReadonlySet<number>): WindowState {
  if (!night) return 'day';
  if (LOBBY_LIGHT_KINDS.has(room.kind)) {
    for (let f = room.floor; f < room.floor + room.height; f++) if (peopleFloors.has(f)) return 'lit';
    return 'vacant';
  }
  if (room.occupancy > 0) return 'lit';
  if (HOTEL_KINDS.has(room.kind) && room.dirty) return 'housekeeping';
  return 'vacant';
}

/**
 * The reconcile gate's light key: one value for all of the day, and one per game hour at
 * night, so window states that do not bump the structure version (a hotel room going dirty,
 * a lobby filling or emptying) are picked up within a game hour.
 */
export function lightBand(night: boolean, minuteOfDay: number): number {
  if (!night) return -1;
  return Math.floor((((minuteOfDay % 1440) + 1440) % 1440) / 60);
}

interface TintAnchor {
  minute: number;
  color: number;
}

const NIGHT_TINT = 0x6078b0;
const DAWN_TINT = 0xbfd8ff;
const NOON_TINT = 0xffffff;
const EVENING_TINT = 0xffd0a0;

/** Hold night through 05:00, dawn at 06:00, noon 07:00 to 17:00, evening 18:00, night from 19:00. */
const TINT_ANCHORS: readonly TintAnchor[] = [
  { minute: 0, color: NIGHT_TINT },
  { minute: 5 * 60, color: NIGHT_TINT },
  { minute: 6 * 60, color: DAWN_TINT },
  { minute: 7 * 60, color: NOON_TINT },
  { minute: 17 * 60, color: NOON_TINT },
  { minute: 18 * 60, color: EVENING_TINT },
  { minute: 19 * 60, color: NIGHT_TINT },
  { minute: 24 * 60, color: NIGHT_TINT },
];

/** The multiply layer's opacity. */
export const LIGHT_ALPHA = 0.4;

export function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** The light layer's tint for a minute of day, linear between the anchors. */
export function lightTintAt(minuteOfDay: number): number {
  const minute = ((minuteOfDay % 1440) + 1440) % 1440;
  for (let i = 0; i < TINT_ANCHORS.length - 1; i++) {
    const a = TINT_ANCHORS[i] as TintAnchor;
    const b = TINT_ANCHORS[i + 1] as TintAnchor;
    if (minute >= a.minute && minute <= b.minute) {
      return lerpColor(a.color, b.color, (minute - a.minute) / (b.minute - a.minute));
    }
  }
  return NIGHT_TINT;
}
