// Light and time: the screen wide light tint by minute of day, and the window state each
// room shows. Pure functions, no pixi, so the rules are testable without a GPU.
// See docs/reviews/2026-09-22-codex-astra-ui-graphics.md section 2 and docs/VISUAL.md.

import type { Room, RoomKind, World } from '../sim/types';
import { mix } from './venue';

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

/** The dusk and dawn windows (D-15), minutes of the day, both ends inclusive: 18:00 to 19:15 and 05:15 to 06:30. */
const DUSK_WINDOW = [18 * 60, 19 * 60 + 15] as const;
const DAWN_WINDOW = [5 * 60 + 15, 6 * 60 + 30] as const;

const minuteOf = (minuteOfDay: number): number => ((minuteOfDay % 1440) + 1440) % 1440;

/** Inside the dusk or the dawn window, when the rooms switch on their own minutes (roomNight). */
export function inLightWindow(minuteOfDay: number): boolean {
  const m = minuteOf(minuteOfDay);
  return (m >= DUSK_WINDOW[0] && m <= DUSK_WINDOW[1]) || (m >= DAWN_WINDOW[0] && m <= DAWN_WINDOW[1]);
}

/**
 * The reconcile gate's light key: one value for all of the day, and one per game hour at
 * night, so window states that do not bump the structure version (a hotel room going dirty,
 * a lobby filling or emptying) are picked up within a game hour. Inside the dusk and dawn
 * windows it moves every five game minutes, whatever the global night flag says, so the rooms
 * light and go out one by one (D-15).
 */
export function lightBand(night: boolean, minuteOfDay: number): number {
  const m = minuteOf(minuteOfDay);
  if (inLightWindow(m)) return 10000 + Math.floor(m / 5);
  if (!night) return -1;
  return Math.floor(m / 60);
}

/**
 * D-15: whether one room keeps its night windows at this minute. Each room lights on its own
 * minute from 18:15 to 18:59 and goes out on its own minute from 05:30 to 06:14, both from the
 * tower's seed and the room's id (venue.ts mix), never from world.rng.
 */
export function roomNight(seed: number, roomId: number, minuteOfDay: number): boolean {
  const h = mix((seed | 0) ^ 0x51ed27, roomId);
  const on = 1095 + (h % 45);
  const off = 330 + ((h >>> 8) % 45);
  const m = minuteOf(minuteOfDay);
  return m >= on || m < off;
}

/**
 * D-4: the night grade a room shell and its illustrated layers take, by window state. A lit
 * room keeps its colours (its windows glow on the emissive layer); an empty one falls back.
 */
export const NIGHT_GRADE: Readonly<Record<WindowState, number>> = {
  day: 0xffffff,
  lit: 0xffffff,
  vacant: 0x9aa5c6,
  housekeeping: 0xb4bcd6,
};

interface TintAnchor {
  minute: number;
  color: number;
}

const NIGHT_TINT = 0x6078b0;
const DAWN_TINT = 0xbfd8ff;
const NOON_TINT = 0xffffff;
const EVENING_TINT = 0xffd0a0;

/**
 * D-9: warm with the sky, not before it. Night to 05:30, dawn at 06:00, noon 06:45 to 17:30,
 * the evening peak at 18:30 (the sky's dusk, sky.ts), night from 19:15.
 */
const TINT_ANCHORS: readonly TintAnchor[] = [
  { minute: 0, color: NIGHT_TINT },
  { minute: 330, color: NIGHT_TINT },
  { minute: 360, color: DAWN_TINT },
  { minute: 405, color: NOON_TINT },
  { minute: 1050, color: NOON_TINT },
  { minute: 1110, color: EVENING_TINT },
  { minute: 1155, color: NIGHT_TINT },
  { minute: 1440, color: NIGHT_TINT },
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
