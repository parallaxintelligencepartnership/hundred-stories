// Cash, quarterly income and upkeep, and bankruptcy. See docs/BRIEF-AGENTS.md.

import { ECONOMY, LIMITS, ROOMS, SHAFTS } from './rules';
import { log } from './world';
import type { CommandResult, Room, RoomKind, ShaftKind, World } from './types';

/** All income flows through here so incomeByKind stays in sync with cash. */
function credit(world: World, kind: RoomKind | ShaftKind, amount: number): void {
  world.cash += amount;
  world.stats.incomeByKind[kind as RoomKind] = (world.stats.incomeByKind[kind as RoomKind] ?? 0) + amount;
}

function debitUpkeep(world: World, kind: RoomKind | ShaftKind, amount: number): void {
  world.cash -= amount;
  world.stats.upkeepByKind[kind] = (world.stats.upkeepByKind[kind] ?? 0) + amount;
}

export function spend(world: World, amount: number, what: string): CommandResult {
  if (world.cash < amount) {
    return { ok: false, reason: `Not enough cash. ${what} costs $${amount.toLocaleString('en-US')}.` };
  }
  world.cash -= amount;
  return { ok: true };
}

/** Rounded office rent for one quarter, scaled by how well the office is doing. */
export function officeQuarterRent(room: Room): number {
  return Math.round(ROOMS.office.incomePerQuarter * (0.5 + room.eval / 2) * (room.rent / 100));
}

export function onQuarterStart(world: World): void {
  // Office rent, scaled by how well the office is doing.
  for (const room of world.rooms.values()) {
    if (room.kind === 'office' && !room.vacant) {
      credit(world, 'office', officeQuarterRent(room));
    }
  }

  // Flat per-room upkeep, plus lobby segment upkeep scaled by star rating.
  for (const room of world.rooms.values()) {
    const upkeep = ROOMS[room.kind].upkeepPerQuarter;
    if (upkeep > 0) debitUpkeep(world, room.kind, upkeep);
    if (room.kind === 'lobby' || room.kind === 'skyLobby') {
      const lobbyUpkeep = LIMITS.lobbyUpkeepPerSegmentByStar[world.stars];
      if (lobbyUpkeep > 0) debitUpkeep(world, room.kind, lobbyUpkeep);
    }
  }

  // Shaft upkeep, per car.
  for (const shaft of world.shafts.values()) {
    const upkeep = SHAFTS[shaft.kind].upkeepPerQuarterPerCar * shaft.cars.length;
    if (upkeep > 0) debitUpkeep(world, shaft.kind, upkeep);
  }

  const income = Object.values(world.stats.incomeByKind).reduce((a, b) => a + (b ?? 0), 0);
  const upkeep = Object.values(world.stats.upkeepByKind).reduce((a, b) => a + (b ?? 0), 0);
  const net = income - upkeep;
  world.stats.lastQuarter = { income, upkeep, net };
  world.stats.incomeByKind = {};
  world.stats.upkeepByKind = {};

  log(
    world,
    `The quarter is over. Earned $${income.toLocaleString('en-US')}, spent $${upkeep.toLocaleString('en-US')}, profit $${net.toLocaleString('en-US')}. Cash: $${world.cash.toLocaleString('en-US')}.`,
  );

  if (world.cash < ECONOMY.bankruptAtCash) {
    const streak = (world.stats.badQuarterStreak ?? 0) + 1;
    world.stats.badQuarterStreak = streak;
    if (streak >= ECONOMY.bankruptAfterQuarters && !world.gameOver) {
      world.gameOver = { at: world.time.minute, reason: 'The bank has foreclosed on the tower.' };
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
  const income = Math.round(ROOMS[room.kind].incomePerQuarter * ECONOMY.hotelNightlyIncomeFraction * (room.rent / 100));
  credit(world, room.kind, income);
}

export function recordCondoSale(world: World, room: Room): void {
  room.vacant = false;
  credit(world, 'condo', Math.round(ECONOMY.condoSalePrice * (room.rent / 100)));
}
