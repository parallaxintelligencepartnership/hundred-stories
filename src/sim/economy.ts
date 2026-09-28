// Cash, quarterly income and upkeep, and bankruptcy. See docs/BRIEF-AGENTS.md.

import { ECONOMY, LIMITS, RENT, ROOMS, SCHEDULES, SHAFTS } from './rules';
import { evaluateRoom } from './evaluation';
import { log } from './world';
import type { CommandResult, LossKind, Room, RoomKind, ShaftKind, World } from './types';

export type { LossKind } from './types';

/** All income flows through here so incomeByKind stays in sync with cash. */
function credit(world: World, kind: RoomKind | ShaftKind, amount: number): void {
  world.cash += amount;
  world.stats.incomeByKind[kind as RoomKind] = (world.stats.incomeByKind[kind as RoomKind] ?? 0) + amount;
}

function debitUpkeep(world: World, kind: RoomKind | ShaftKind, amount: number): void {
  world.cash -= amount;
  world.stats.upkeepByKind[kind] = (world.stats.upkeepByKind[kind] ?? 0) + amount;
}

/** 30000 -> "$30,000", -30000 -> "-$30,000": the sign goes before the dollar sign. */
function dollars(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.round(Math.abs(amount)).toLocaleString('en-US')}`;
}

export function spend(world: World, amount: number, what: string): CommandResult {
  if (world.cash < amount) {
    return { ok: false, reason: `Not enough cash. ${what} costs $${amount.toLocaleString('en-US')}.` };
  }
  world.cash -= amount;
  return { ok: true };
}

/**
 * Rounded office rent for one quarter, scaled by how well the office is doing (ECONOMY.officeRentEvalScale).
 * `rating` defaults to the office's last evaluation, the one the settle reads.
 */
export function officeQuarterRent(room: Room, rating: number = room.eval): number {
  const evalScale = ECONOMY.officeRentEvalScale ? 0.5 + rating / 2 : 1;
  return Math.round(ROOMS.office.incomePerQuarter * evalScale * (room.rent / RENT.default));
}

/**
 * Every event loss flows through here (fire damage, the helicopter, a bomb, a ransom, a thief),
 * so the quarter's losses line stays in sync with cash.
 */
export function debitLoss(world: World, kind: LossKind, amount: number): void {
  world.cash -= amount;
  world.stats.lossesByKind[kind] = (world.stats.lossesByKind[kind] ?? 0) + amount;
}

function isShaftKind(kind: RoomKind | ShaftKind): kind is ShaftKind {
  return Object.hasOwn(SHAFTS, kind);
}

/**
 * The running cost per quarter of one room of this kind (a lobby or sky lobby segment includes
 * the star-scaled segment upkeep at the tower's current rating), or of one car of this shaft kind.
 */
export function quarterUpkeepOf(world: World, kind: RoomKind | ShaftKind): number {
  if (isShaftKind(kind)) return SHAFTS[kind].upkeepPerQuarterPerCar;
  const lobby = kind === 'lobby' || kind === 'skyLobby' ? LIMITS.lobbyUpkeepPerSegmentByStar[world.stars] : 0;
  return ROOMS[kind].upkeepPerQuarter + lobby;
}

interface SettleLine<K> {
  kind: K;
  amount: number;
  /** Units the line bills: one room or lobby tile, or a shaft's cars. */
  count: number;
}

/**
 * What the settle credits and debits for the tower as it stands: office rent per leased office,
 * upkeep per room and per shaft (per car). onQuarterStart applies these lines and quarterForecast
 * sums them, so the forecast and the settle cannot drift apart.
 *
 * The settle reads each office's last evaluation, taken at 04:30 when the workers are home and
 * their stress has faded. The forecast runs at any hour, so it rates each office as that
 * evaluation will: its resting rating, stress 0. At 04:59 the two are the same number.
 */
function settleLines(world: World, forecast: boolean): { rent: SettleLine<RoomKind>[]; upkeep: SettleLine<RoomKind | ShaftKind>[]; vacantOffices: number } {
  const rent: SettleLine<RoomKind>[] = [];
  const upkeep: SettleLine<RoomKind | ShaftKind>[] = [];
  let vacantOffices = 0;
  // Office rent, scaled by how well the office is doing.
  for (const room of world.rooms.values()) {
    if (room.kind !== 'office') continue;
    if (room.vacant) vacantOffices += 1;
    else rent.push({ kind: 'office', amount: officeQuarterRent(room, forecast ? evaluateRoom(world, room, 0) : room.eval), count: 1 });
  }
  // Flat per-room upkeep, plus lobby segment upkeep scaled by star rating.
  for (const room of world.rooms.values()) {
    const amount = quarterUpkeepOf(world, room.kind);
    if (amount > 0) upkeep.push({ kind: room.kind, amount, count: 1 });
  }
  // Shaft upkeep, per car.
  for (const shaft of world.shafts.values()) {
    const amount = quarterUpkeepOf(world, shaft.kind) * shaft.cars.length;
    if (amount > 0) upkeep.push({ kind: shaft.kind, amount, count: shaft.cars.length });
  }
  return { rent, upkeep, vacantOffices };
}

function countByKind<K extends string>(lines: SettleLine<K>[]): Partial<Record<K, number>> {
  const counts: Partial<Record<K, number>> = {};
  for (const line of lines) counts[line.kind] = (counts[line.kind] ?? 0) + line.count;
  return counts;
}

function sumTable(table: Partial<Record<string, number>>): number {
  return Object.values(table).reduce<number>((a, b) => a + (b ?? 0), 0);
}

export interface QuarterForecast {
  rent: number;
  rentByKind: Partial<Record<RoomKind, number>>;
  upkeep: number;
  upkeepByKind: Partial<Record<RoomKind | ShaftKind, number>>;
  /** Units behind each upkeep line: rooms, lobby tiles, cars. */
  upkeepCountByKind: Partial<Record<RoomKind | ShaftKind, number>>;
  vacantOffices: number;
}

/**
 * What the next settle would credit as rent and debit as upkeep for the tower as it stands now,
 * with each office at its resting rating (see settleLines). Reads only; income earned during the
 * quarter (shops, hotels, condos) and event losses are not in it.
 */
export function quarterForecast(world: World): QuarterForecast {
  const lines = settleLines(world, true);
  const rentByKind: Partial<Record<RoomKind, number>> = {};
  const upkeepByKind: Partial<Record<RoomKind | ShaftKind, number>> = {};
  for (const line of lines.rent) rentByKind[line.kind] = (rentByKind[line.kind] ?? 0) + line.amount;
  for (const line of lines.upkeep) upkeepByKind[line.kind] = (upkeepByKind[line.kind] ?? 0) + line.amount;
  return {
    rent: sumTable(rentByKind),
    rentByKind,
    upkeep: sumTable(upkeepByKind),
    upkeepByKind,
    upkeepCountByKind: countByKind(lines.upkeep),
    vacantOffices: lines.vacantOffices,
  };
}

/** 300 -> "5 AM", the hour the settle runs. */
export function hourWords(minuteOfDay: number): string {
  const hour = Math.floor(minuteOfDay / 60);
  return `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'AM' : 'PM'}`;
}

export const MINUTES_PER_QUARTER = 3 * 1440;
/** The settle runs once a quarter, so from one settle the next is this many days away. */
const DAYS_PER_QUARTER = MINUTES_PER_QUARTER / 1440;

/** The minute of the next quarter settle at or after `minute` (5 AM on the quarter's first day). */
export function nextSettleMinute(minute: number): number {
  const settle = SCHEDULES.quarterStartMinuteOfDay;
  const quarterStart = Math.floor(Math.max(0, minute) / MINUTES_PER_QUARTER) * MINUTES_PER_QUARTER;
  return minute <= quarterStart + settle ? quarterStart + settle : quarterStart + MINUTES_PER_QUARTER + settle;
}

/**
 * When the next settle runs, in words: "5 AM today", "5 AM tomorrow", "5 AM in 2 days".
 * Days are calendar days; the game shows no day counter.
 */
export function nextSettleWords(minute: number): string {
  const at = nextSettleMinute(minute);
  const days = Math.floor(at / 1440) - Math.floor(Math.max(0, minute) / 1440);
  const when = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
  return `${hourWords(SCHEDULES.quarterStartMinuteOfDay)} ${when}`;
}

export function onQuarterStart(world: World): void {
  const lines = settleLines(world, false);
  for (const line of lines.rent) credit(world, line.kind, line.amount);
  for (const line of lines.upkeep) debitUpkeep(world, line.kind, line.amount);

  // The quarter's tables move into lastQuarter before the running tables start again.
  const { incomeByKind, upkeepByKind, lossesByKind } = world.stats;
  const income = sumTable(incomeByKind);
  const upkeep = sumTable(upkeepByKind);
  const losses = sumTable(lossesByKind);
  const net = income - upkeep - losses;
  const upkeepCountByKind = countByKind(lines.upkeep);
  world.stats.lastQuarter = { income, upkeep, losses, net, incomeByKind, upkeepByKind, lossesByKind, upkeepCountByKind };
  world.stats.incomeByKind = {};
  world.stats.upkeepByKind = {};
  world.stats.lossesByKind = {};

  const lost = losses > 0 ? ` lost ${dollars(losses)} to trouble,` : '';
  log(
    world,
    `The quarter is over. Earned ${dollars(income)}, spent ${dollars(upkeep)} on running costs,${lost} profit ${dollars(net)}. Cash: ${dollars(world.cash)}.`,
    'info',
    { notable: true }, // the one moment money moves for an offices-only tower: it toasts
  );

  if (world.cash < 0) {
    log(
      world,
      `You are in debt: ${dollars(world.cash)}. Nothing can be built until you have its price. Removing elevator cars or demolishing costly rooms lowers your running costs.`,
      'alert',
      { notable: true },
    );
  }

  if (world.cash < ECONOMY.bankruptAtCash) {
    const streak = (world.stats.badQuarterStreak ?? 0) + 1;
    world.stats.badQuarterStreak = streak;
    if (streak === 1) {
      // The game shows no day counter, so the deadline is said as the next settle, days from now.
      log(
        world,
        `The bank gives you one quarter. Get to ${dollars(ECONOMY.bankruptAtCash)} or better by the next settle, ${hourWords(SCHEDULES.quarterStartMinuteOfDay)} in ${DAYS_PER_QUARTER} days, or the bank takes the tower.`,
        'alert',
        { notable: true },
      );
    }
    if (streak >= ECONOMY.bankruptAfterQuarters && !world.gameOver) {
      world.gameOver = { at: world.time.minute, reason: 'The bank took the tower back.' };
      log(world, 'The bank took the tower because your cash stayed too low for too long.', 'alert');
    }
  } else {
    world.stats.badQuarterStreak = 0;
  }

  // The status bar's quarter delta counts from here: cash once the quarter is settled.
  world.quarterStartCash = world.cash;
}

/** The day boundary: the status bar's population change counts from the population now. */
export function onDayStart(world: World): void {
  world.dayStartPopulation = world.population;
}

export function recordVisit(world: World, room: Room): void {
  switch (room.kind) {
    case 'shop':
      credit(world, 'shop', ECONOMY.shopIncomePerVisitor);
      break;
    case 'fastFood':
      credit(world, 'fastFood', ECONOMY.fastFoodIncomePerVisitor);
      break;
    case 'restaurant':
      credit(world, 'restaurant', ECONOMY.restaurantIncomePerVisitor);
      break;
    case 'cinema':
      credit(world, 'cinema', ECONOMY.cinemaIncomePerViewer);
      break;
    case 'partyHall':
      credit(world, 'partyHall', ECONOMY.partyHallIncomePerEvent);
      break;
    default:
      break;
  }
}

export function recordHotelNight(world: World, room: Room): void {
  const income = Math.round(ROOMS[room.kind].incomePerQuarter * ECONOMY.hotelNightlyIncomeFraction * (room.rent / RENT.default));
  credit(world, room.kind, income);
}

export function recordCondoSale(world: World, room: Room): void {
  room.vacant = false;
  credit(world, 'condo', Math.round(ECONOMY.condoSalePrice * (room.rent / RENT.default)));
}
