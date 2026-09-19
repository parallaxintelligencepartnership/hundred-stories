// Every number in the game lives here. Logic modules read these tables and never inline a value.
// Sources: SimTower PC v1.0 reference tables and the original manual; where the sources disagreed
// or were silent the value is marked "our call" and can be tuned without touching logic.

import type { RoomKind, ShaftKind, Star } from './types';

export interface RoomRule {
  label: string; // UI name, sentence case, US spelling
  width: number; // tiles
  height: number; // floors
  cost: number; // dollars
  upkeepPerQuarter: number; // dollars charged at quarter start (0 for none)
  incomePerQuarter: number; // dollars per quarter at full occupancy for rented rooms; per-visit income for commerce is derived
  capacity: number; // tenants for residential and office, seats for commerce and entertainment
  population: number; // counted toward the star ladder per occupied room
  star: Star; // star required to build
  placement: 'aboveGround' | 'underground' | 'both';
  noisy: boolean;
  quiet: boolean; // objects to noise
  maxCount: number | null; // null for unlimited
  group: 'structure' | 'residential' | 'hotel' | 'commercial' | 'services';
}

export const ROOMS: Record<RoomKind, RoomRule> = {
  lobby: { label: 'Lobby', width: 1, height: 1, cost: 5_000, upkeepPerQuarter: 0, incomePerQuarter: 0, capacity: 0, population: 0, star: 1, placement: 'aboveGround', noisy: true, quiet: false, maxCount: null, group: 'structure' },
  skyLobby: { label: 'Sky lobby', width: 1, height: 3, cost: 5_000, upkeepPerQuarter: 0, incomePerQuarter: 0, capacity: 0, population: 0, star: 3, placement: 'aboveGround', noisy: true, quiet: false, maxCount: null, group: 'structure' },
  stairs: { label: 'Stairs', width: 8, height: 2, cost: 5_000, upkeepPerQuarter: 0, incomePerQuarter: 0, capacity: 0, population: 0, star: 1, placement: 'both', noisy: false, quiet: false, maxCount: 64, group: 'structure' },
  escalator: { label: 'Escalator', width: 8, height: 2, cost: 20_000, upkeepPerQuarter: 5_000, incomePerQuarter: 0, capacity: 0, population: 0, star: 3, placement: 'both', noisy: false, quiet: false, maxCount: 64, group: 'structure' },
  office: { label: 'Office', width: 9, height: 1, cost: 40_000, upkeepPerQuarter: 0, incomePerQuarter: 10_000, capacity: 6, population: 6, star: 1, placement: 'aboveGround', noisy: false, quiet: true, maxCount: null, group: 'commercial' },
  condo: { label: 'Condo', width: 16, height: 1, cost: 80_000, upkeepPerQuarter: 0, incomePerQuarter: 0, capacity: 3, population: 3, star: 1, placement: 'aboveGround', noisy: false, quiet: true, maxCount: null, group: 'residential' },
  hotelSingle: { label: 'Single room', width: 4, height: 1, cost: 20_000, upkeepPerQuarter: 0, incomePerQuarter: 6_000, capacity: 1, population: 1, star: 2, placement: 'aboveGround', noisy: false, quiet: true, maxCount: null, group: 'hotel' },
  hotelTwin: { label: 'Twin room', width: 6, height: 1, cost: 50_000, upkeepPerQuarter: 0, incomePerQuarter: 9_000, capacity: 2, population: 2, star: 2, placement: 'aboveGround', noisy: false, quiet: true, maxCount: null, group: 'hotel' },
  hotelSuite: { label: 'Suite', width: 10, height: 1, cost: 100_000, upkeepPerQuarter: 0, incomePerQuarter: 18_000, capacity: 2, population: 2, star: 2, placement: 'aboveGround', noisy: false, quiet: true, maxCount: null, group: 'hotel' },
  fastFood: { label: 'Fast food', width: 16, height: 1, cost: 100_000, upkeepPerQuarter: 0, incomePerQuarter: 9_000, capacity: 35, population: 0, star: 1, placement: 'both', noisy: true, quiet: false, maxCount: 512, group: 'commercial' },
  restaurant: { label: 'Restaurant', width: 24, height: 1, cost: 200_000, upkeepPerQuarter: 0, incomePerQuarter: 18_000, capacity: 35, population: 0, star: 3, placement: 'both', noisy: true, quiet: false, maxCount: 512, group: 'commercial' },
  shop: { label: 'Shop', width: 12, height: 1, cost: 100_000, upkeepPerQuarter: 0, incomePerQuarter: 15_000, capacity: 25, population: 0, star: 3, placement: 'both', noisy: true, quiet: false, maxCount: 512, group: 'commercial' },
  cinema: { label: 'Cinema', width: 31, height: 2, cost: 500_000, upkeepPerQuarter: 0, incomePerQuarter: 30_000, capacity: 120, population: 0, star: 3, placement: 'both', noisy: true, quiet: false, maxCount: 16, group: 'commercial' },
  partyHall: { label: 'Party hall', width: 24, height: 2, cost: 100_000, upkeepPerQuarter: 0, incomePerQuarter: 60_000, capacity: 50, population: 0, star: 3, placement: 'aboveGround', noisy: true, quiet: false, maxCount: 16, group: 'commercial' },
  medical: { label: 'Medical center', width: 26, height: 1, cost: 500_000, upkeepPerQuarter: 0, incomePerQuarter: 0, capacity: 0, population: 0, star: 3, placement: 'both', noisy: false, quiet: false, maxCount: 10, group: 'services' },
  security: { label: 'Security office', width: 16, height: 1, cost: 100_000, upkeepPerQuarter: 20_000, incomePerQuarter: 0, capacity: 6, population: 0, star: 2, placement: 'both', noisy: false, quiet: false, maxCount: 10, group: 'services' },
  housekeeping: { label: 'Housekeeping', width: 15, height: 1, cost: 50_000, upkeepPerQuarter: 10_000, incomePerQuarter: 0, capacity: 6, population: 0, star: 2, placement: 'both', noisy: false, quiet: false, maxCount: null, group: 'services' },
  parkingRamp: { label: 'Parking ramp', width: 16, height: 1, cost: 50_000, upkeepPerQuarter: 10_000, incomePerQuarter: 0, capacity: 0, population: 0, star: 3, placement: 'underground', noisy: false, quiet: false, maxCount: null, group: 'services' },
  parkingSpace: { label: 'Parking space', width: 4, height: 1, cost: 3_000, upkeepPerQuarter: 0, incomePerQuarter: 0, capacity: 1, population: 0, star: 3, placement: 'underground', noisy: false, quiet: false, maxCount: 512, group: 'services' },
  recycling: { label: 'Recycling center', width: 25, height: 2, cost: 500_000, upkeepPerQuarter: 50_000, incomePerQuarter: 0, capacity: 0, population: 0, star: 3, placement: 'underground', noisy: false, quiet: false, maxCount: 1, group: 'services' },
  metro: { label: 'Metro station', width: 30, height: 3, cost: 1_000_000, upkeepPerQuarter: 100_000, incomePerQuarter: 0, capacity: 0, population: 0, star: 4, placement: 'underground', noisy: true, quiet: false, maxCount: 1, group: 'services' },
  cathedral: { label: 'Cathedral', width: 28, height: 4, cost: 3_000_000, upkeepPerQuarter: 0, incomePerQuarter: 0, capacity: 0, population: 0, star: 5, placement: 'aboveGround', noisy: false, quiet: false, maxCount: 1, group: 'services' },
};

export interface ShaftRule {
  label: string;
  width: number;
  shaftCost: number;
  carCost: number;
  upkeepPerQuarterPerCar: number;
  maxSpan: number | null; // floors, null for unlimited
  maxCars: number;
  capacity: number; // people per car
  floorsPerMinute: number; // our call, tuned for feel
  doorOpenMinutes: number;
  star: Star;
  expressOnly: boolean; // may only stop at lobby floors and underground floors
}

export const SHAFTS: Record<ShaftKind, ShaftRule> = {
  standard: { label: 'Elevator', width: 4, shaftCost: 200_000, carCost: 80_000, upkeepPerQuarterPerCar: 10_000, maxSpan: 30, maxCars: 8, capacity: 21, floorsPerMinute: 4, doorOpenMinutes: 1, star: 1, expressOnly: false },
  service: { label: 'Service elevator', width: 4, shaftCost: 100_000, carCost: 50_000, upkeepPerQuarterPerCar: 10_000, maxSpan: 30, maxCars: 8, capacity: 21, floorsPerMinute: 4, doorOpenMinutes: 1, star: 2, expressOnly: false },
  express: { label: 'Express elevator', width: 6, shaftCost: 400_000, carCost: 150_000, upkeepPerQuarterPerCar: 20_000, maxSpan: null, maxCars: 8, capacity: 42, floorsPerMinute: 8, doorOpenMinutes: 1, star: 3, expressOnly: true },
};

export const LIMITS = {
  maxShafts: 24,
  towerWidth: 375,
  maxFloor: 100,
  minFloor: -10,
  skyLobbyFloors: [15, 30, 45, 60, 75, 90] as readonly number[],
  lobbyUpkeepPerSegmentByStar: { 1: 0, 2: 0, 3: 300, 4: 1_000, 5: 1_000, 6: 1_000 } as Record<Star, number>,
  startingCash: 2_000_000,
  stairsMaxClimbFloors: 5, // our call: sims will not climb more than this many floors by stairs
};

export interface StarRule {
  population: number;
  requires: {
    security?: boolean;
    hotelSuites?: number;
    vipRating?: 'fair' | 'good';
    recycling?: boolean;
    medical?: boolean;
    metro?: boolean;
    cathedral?: boolean;
    wedding?: boolean;
  };
  label: string;
}

export const STARS: Record<Star, StarRule> = {
  1: { population: 0, requires: {}, label: '1 star' },
  2: { population: 300, requires: {}, label: '2 stars' },
  3: { population: 1_000, requires: { security: true }, label: '3 stars' },
  4: { population: 5_000, requires: { hotelSuites: 1, vipRating: 'fair', recycling: true, medical: true }, label: '4 stars' },
  5: { population: 10_000, requires: { metro: true }, label: '5 stars' },
  6: { population: 15_000, requires: { cathedral: true, wedding: true }, label: 'Tower' },
};

export const STRESS = {
  perWaitingMinute: 0.02, // 50 minutes of waiting hits 1.0
  perStairFloor: 0.05,
  decayPerMinuteInRoom: 0.01,
  pink: 0.35,
  red: 0.7,
  giveUp: 1.0, // abandons the trip and logs a reason
  waitBandMinutes: { calm: 5, pink: 15 }, // for the UI legend only
};

export const EVAL = {
  leaveThreshold: 0.34, // red zone; a full day here and the tenant leaves
  leaveAfterMinutes: 1440,
  noisePenaltyPerNeighbor: 0.2,
  dirtyPenalty: 0.3,
  infestedPenalty: 1,
  stressWeight: 0.6,
};

export const NOISE = {
  fastFoodToOfficeTiles: 11,
  commercialToHotelOrCondoTiles: 21,
  officeToHotelOrCondoTiles: 21,
  verticalNeighborsCount: true, // a noisy room directly above or below with x overlap counts too
};

// Minute of day schedules. Weekday = dayOfQuarter 0 or 1, weekend = 2.
export const SCHEDULES = {
  worker: { arriveStart: 8 * 60, arriveEnd: 9 * 60 + 15, lunchStart: 12 * 60, lunchEnd: 13 * 60, lunchChance: 0.5, leaveStart: 17 * 60, leaveEnd: 18 * 60 + 30, weekendChance: 0.1 },
  resident: { leaveStart: 7 * 60 + 30, leaveEnd: 9 * 60, returnStart: 17 * 60, returnEnd: 21 * 60, eveningOutChance: 0.3 },
  guest: { checkInStart: 17 * 60, checkInEnd: 22 * 60, checkOutStart: 7 * 60, checkOutEnd: 10 * 60, dinnerChance: 0.6, occupancyWeekday: 0.6, occupancyWeekend: 0.9 },
  shopper: { open: 10 * 60, close: 21 * 60, weekendMultiplier: 2.5, visitMinutes: 40 },
  diner: { lunchStart: 11 * 60 + 30, lunchEnd: 13 * 60 + 30, dinnerStart: 18 * 60, dinnerEnd: 21 * 60, visitMinutes: 50 },
  cinema: { showTimes: [13 * 60, 16 * 60, 19 * 60], showMinutes: 120 },
  partyHall: { weekendStart: 12 * 60, durationMinutes: 240 },
  housekeeping: { start: 10 * 60, minutesPerRoom: 20, roomsPerKeeper: 8 },
  quarterStartMinuteOfDay: 5 * 60,
  nightStart: 23 * 60,
  nightEnd: 6 * 60,
};

export const ECONOMY = {
  condoSalePrice: 150_000,
  condoSaleEvalMin: 0.5,
  shopIncomePerVisitor: 60, // dollars per visit; 15k per quarter at roughly 250 visits
  fastFoodIncomePerVisitor: 12,
  restaurantIncomePerVisitor: 45,
  cinemaIncomePerViewer: 10,
  partyHallIncomePerEvent: 15_000,
  hotelNightlyIncomeFraction: 1 / 45, // of incomePerQuarter, per occupied night; 45 nights a quarter at good occupancy
  officeRentEvalScale: true, // rent is multiplied by (0.5 + eval / 2)
  bankruptAtCash: -500_000,
  bankruptAfterQuarters: 2,
};

export const EVENTS = {
  fire: { minStar: 2 as Star, dailyChance: 0.01, spreadMinutes: 30, helicopterCost: 250_000, securityPutOutMinutes: 45, damagePerRoom: 20_000 },
  bomb: { minStar: 3 as Star, dailyChance: 0.008, ransom: 500_000, detonateAtMinuteOfDay: 13 * 60, securitySearchMinutesPerFloor: 3, damageCash: 2_000_000, damageRooms: 4 },
  vip: { minStar: 3 as Star, noticeDays: 1, quarterlyChance: 0.5, stayMinutes: 600, goodWaitMinutes: 5, fairWaitMinutes: 12 },
  cockroaches: { dirtyDaysBeforeInfested: 3, spreadDays: 2 },
  santa: { minuteOfDay: 20 * 60, tilesPerMinute: 6 },
  wedding: { weekendMinuteOfDay: 12 * 60, durationMinutes: 180 },
};
