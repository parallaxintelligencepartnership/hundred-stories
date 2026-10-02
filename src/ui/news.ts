// What Stories shows (src/ui/stories.ts), as plain data: the open matters the player can act on
// (derived from the world on every refresh, never from the log) and the log split into today,
// yesterday and earlier. The page turns these into elements and rebuilds only on a new key.

import { hourWords, nextSettleWords } from '../sim/economy';
import { ECONOMY } from '../sim/rules';
import { inWasteBacklog } from '../sim/recycling';
import type { LogEntry, Room, World } from '../sim/types';
import { commandsRefused, fireHeadline, roachHeadline, SECURITY_RESPONDING, SECURITY_SEARCHING, theftHeadline } from './alerts';
import { formatFloor, formatMoney } from './format';
import { floorList, housekeepingReaches } from './problems';

/** The kinds of open matter, in the order they are listed. */
export type NeedKind = 'fire' | 'bomb' | 'theft' | 'roaches' | 'money';

/** One line under Needs you now. A line with a place centers the camera there when tapped. */
export interface NeedLine {
  kind: NeedKind;
  text: string;
  at?: { floor: number; x: number };
}

export const NEEDS_EMPTY = 'Nothing needs you right now.';
export const TODAY_EMPTY = 'Nothing yet today.';

const MINUTES_PER_DAY = 1440;

function onFloor(floor: number): string {
  return formatFloor(floor).toLowerCase();
}

function middleOf(room: Room): { floor: number; x: number } {
  return { floor: room.floor, x: Math.floor(room.x + room.width / 2) };
}

function hasRoom(world: World, kind: Room['kind'], usable = false): boolean {
  for (const room of world.rooms.values()) if (room.kind === kind && !(usable && room.onFire)) return true;
  return false;
}

/**
 * What happens to the cockroaches, as it is: housekeeping cleans them out only when it can get to
 * the rooms, and not while uncollected trash holds a room dirty (people.ts dirtyHotelRooms skips
 * those until the collectors empty them). No office: build one. Some rooms out of its reach: which
 * floors. Some held by trash: which floors wait for the collectors.
 */
export function roachHelp(world: World, infested: readonly Room[]): string {
  if (!hasRoom(world, 'housekeeping')) return 'There is no housekeeping. Build a housekeeping office to clean them out.';
  const floorsOf = (rooms: readonly Room[]): number[] => [...new Set(rooms.map((room) => room.floor))].sort((a, b) => a - b);
  const reached = infested.filter((room) => housekeepingReaches(world, room));
  const cut = floorsOf(infested.filter((room) => !reached.includes(room)));
  const held = floorsOf(reached.filter((room) => inWasteBacklog(room)));
  if (cut.length === 0 && held.length === 0) return 'Housekeeping will clean them out.';
  const out: string[] = [];
  if (cut.length > 0) out.push(`Housekeeping cannot get to ${floorList(cut)}. Give it an elevator there to clean them out.`);
  if (held.length > 0) out.push(`Housekeeping cannot clean the rooms on ${floorList(held)} until the waste collectors take their trash away.`);
  return out.join(' ');
}

/**
 * The open matters, most urgent first: a fire, a bomb threat, a theft under way, cockroaches,
 * money. The VIP visit is not a line: Stories gives it a section of its own (see vipView).
 */
export function needsYou(world: World): NeedLine[] {
  const out: NeedLine[] = [];
  const events = world.events ?? [];
  // A security office on fire is not on duty, as the alert cards count it.
  const security = hasRoom(world, 'security', true);

  // A finished Today's tower: the clock has stopped, so nothing will happen to a fire or a bomb.
  // The off spend button under the line gives the reason (the tower is over).
  const over = commandsRefused(world) !== null;

  const fire = events.find((e) => e.kind === 'fire');
  if (fire && fire.kind === 'fire') {
    const rooms = fire.roomIds.map((id) => world.rooms.get(id)).filter((r): r is Room => r !== undefined);
    const floors = rooms.map((r) => r.floor);
    const headline = fireHeadline(floors, rooms.length);
    const text = over
      ? `${headline}.`
      : security
        ? `${headline}. ${SECURITY_RESPONDING}`
        : `${headline}, no security. Call a helicopter or let it burn out.`;
    out.push({ kind: 'fire', text, ...(rooms[0] ? { at: middleOf(rooms[0]) } : {}) });
  }

  const bomb = events.find((e) => e.kind === 'bomb' && !e.found);
  if (bomb && bomb.kind === 'bomb') {
    const room = world.rooms.get(bomb.roomId);
    const at = room ? middleOf(room) : bomb.floor !== undefined && bomb.x !== undefined ? { floor: bomb.floor, x: bomb.x } : undefined;
    const where = at ? `Bomb threat on ${onFloor(at.floor)}` : 'Bomb threat';
    const ransom = formatMoney(bomb.ransom);
    const text = over
      ? `${where}.`
      : security
        ? `${where}. ${SECURITY_SEARCHING}`
        : `${where}, no security. Pay the ${ransom} ransom, or build a security office to find it before ${hourWords(bomb.detonateAt % MINUTES_PER_DAY)}.`;
    out.push({ kind: 'bomb', text, ...(at ? { at } : {}) });
  }

  // A theft that has begun (the thief at the target), as its alert card says it.
  const theft = events.find((e) => e.kind === 'theft' && (e.phase === 'acting' || e.phase === 'leaving'));
  if (theft && theft.kind === 'theft') {
    const target = theft.targetId !== null ? world.rooms.get(theft.targetId) : undefined;
    const at = target ? middleOf(target) : undefined;
    out.push({ kind: 'theft', text: `${theftHeadline(theft.floor ?? target?.floor ?? 1, theft.guardId !== null)}.`, ...(at ? { at } : {}) });
  }

  // Not yet treated: still infested. A housekeeper's clean is the treatment and clears the flag.
  const infested = [...world.rooms.values()].filter((r) => r.infested).sort((a, b) => a.id - b.id);
  if (infested.length > 0) {
    const floors = infested.map((r) => r.floor);
    out.push({ kind: 'roaches', text: `${roachHeadline(floors, infested.length)}. ${roachHelp(world, infested)}`, at: middleOf(infested[0] as Room) });
  }

  // The bank's quarter first: it is the one with a deadline. The game over card speaks after that.
  if (!world.gameOver) {
    const minute = world.time?.minute ?? 0;
    if ((world.stats?.badQuarterStreak ?? 0) >= 1) {
      out.push({
        kind: 'money',
        text: `The bank gives you until ${nextSettleWords(minute)}. Get to ${formatMoney(ECONOMY.bankruptAtCash)} or better, or it takes the tower.`,
      });
    } else if (world.cash < 0) {
      out.push({ kind: 'money', text: `You owe ${formatMoney(Math.abs(world.cash))}. Nothing can be built until you have its price.` });
    }
  }
  return out;
}

export interface NewsDays {
  today: LogEntry[];
  yesterday: LogEntry[];
  earlier: LogEntry[];
  /** Lines in the log not on show: Show older has more to reveal. */
  more: boolean;
}

/**
 * The newest `limit` lines of the log, newest first, split by the game day of `now`. Before Show
 * older is tapped (`older` false) only today's lines are on show; after it, earlier days too.
 */
export function newsDays(log: readonly LogEntry[], now: number, limit: number, older: boolean): NewsDays {
  const dayStart = Math.floor(Math.max(0, now) / MINUTES_PER_DAY) * MINUTES_PER_DAY;
  const out: NewsDays = { today: [], yesterday: [], earlier: [], more: false };
  let shown = 0;
  for (let i = log.length - 1; i >= 0 && shown < limit; i -= 1) {
    const entry = log[i] as LogEntry;
    if (entry.minute >= dayStart) out.today.push(entry);
    else if (!older) break;
    else if (entry.minute >= dayStart - MINUTES_PER_DAY) out.yesterday.push(entry);
    else out.earlier.push(entry);
    shown += 1;
  }
  out.more = log.length > shown;
  return out;
}
