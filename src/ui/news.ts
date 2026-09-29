// What the News panel shows, as plain data: the open matters the player can act on (derived
// from the world on every refresh, never from the log) and the log split into today, yesterday
// and earlier. The panel in panels.ts turns these into elements and rebuilds only on a new key.

import { hourWords, nextSettleWords } from '../sim/economy';
import { ECONOMY } from '../sim/rules';
import type { LogEntry, Room, World } from '../sim/types';
import { fireHeadline, roachHeadline, SECURITY_RESPONDING } from './alerts';
import { formatFloor, formatMoney } from './format';

/** One line under Needs you now. A line with a place centers the camera there when tapped. */
export interface NeedLine {
  kind: 'fire' | 'bomb' | 'roaches' | 'money';
  text: string;
  at?: { floor: number; x: number };
}

export const NEEDS_EMPTY = 'Nothing needs you right now.';
export const NEWS_EMPTY = 'Nothing has happened yet.';
export const TODAY_EMPTY = 'Nothing yet today.';
export const MILESTONES_EMPTY = 'Your first milestone is coming.';

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
 * The open matters, most urgent first: a fire, a bomb threat, cockroaches, money. The VIP card
 * is not a line: the panel shows it under these while a visit is on (see vipView).
 */
export function needsYou(world: World): NeedLine[] {
  const out: NeedLine[] = [];
  const events = world.events ?? [];
  // A security office on fire is not on duty, as the alert cards count it.
  const security = hasRoom(world, 'security', true);

  const fire = events.find((e) => e.kind === 'fire');
  if (fire && fire.kind === 'fire') {
    const rooms = fire.roomIds.map((id) => world.rooms.get(id)).filter((r): r is Room => r !== undefined);
    const floors = rooms.map((r) => r.floor);
    const headline = fireHeadline(floors, rooms.length);
    const text = security
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
    const text = security
      ? `${where}. Wait for security to find it, or pay the ${ransom} ransom.`
      : `${where}, no security. Pay the ${ransom} ransom, or build a security office to find it before ${hourWords(bomb.detonateAt % MINUTES_PER_DAY)}.`;
    out.push({ kind: 'bomb', text, ...(at ? { at } : {}) });
  }

  // Not yet treated: still infested. A housekeeper's clean is the treatment and clears the flag.
  const infested = [...world.rooms.values()].filter((r) => r.infested).sort((a, b) => a.id - b.id);
  if (infested.length > 0) {
    const floors = infested.map((r) => r.floor);
    const help = hasRoom(world, 'housekeeping') ? 'Housekeeping will clean them out.' : 'Build housekeeping to clean them out.';
    out.push({ kind: 'roaches', text: `${roachHeadline(floors, infested.length)}. ${help}`, at: middleOf(infested[0] as Room) });
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

/** A key that changes whenever the lines or their places do, so the panel rebuilds only then. */
export function needsKey(lines: readonly NeedLine[]): string {
  return lines.map((l) => `${l.kind}|${l.text}|${l.at ? `${l.at.floor},${l.at.x}` : ''}`).join('#');
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
