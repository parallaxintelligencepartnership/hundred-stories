// Player intent: validate, charge, mutate, log.
// Every number comes from rules.ts; every refusal reason is plain English shown to the player verbatim.

import { spend } from './economy';
import { handleEventCommand } from './events';
import { LIMITS, ROOMS, SHAFTS } from './rules';
import { MAX_FLOOR, MIN_FLOOR, TOWER_WIDTH } from './types';
import type {
  Car,
  Command,
  CommandResult,
  Room,
  RoomKind,
  Shaft,
  ShaftKind,
  World,
} from './types';
import {
  addRoom,
  addShaft,
  allocId,
  groundLobby,
  log,
  rebuildFloorIndex,
  removeRoom,
  removeShaft,
  removeSim,
  roomsOfKind,
  roomsOnFloor,
} from './world';

const OK: CommandResult = { ok: true };

function no(reason: string): CommandResult {
  return { ok: false, reason };
}

// ---------------------------------------------------------------------------
// Wording helpers
// ---------------------------------------------------------------------------

/** 40000 -> "$40,000" */
function money(amount: number): string {
  const digits = Math.abs(Math.round(amount)).toString();
  let grouped = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) grouped += ',';
    grouped += digits.charAt(i);
  }
  return `${amount < 0 ? '-' : ''}$${grouped}`;
}

/** "Office" -> "Offices", "Stairs" -> "Stairs" */
function plural(label: string): string {
  return label.endsWith('s') ? label : `${label}s`;
}

function article(label: string): string {
  return 'aeiou'.includes(label.charAt(0).toLowerCase()) ? 'an' : 'a';
}

function starText(star: number): string {
  if (star <= 1) return 'Needs 1 star.';
  if (star >= 6) return 'Needs Tower status.';
  return `Needs ${star} stars.`;
}

function cannotAfford(label: string, cost: number): string {
  return `Not enough cash. ${plural(label)} cost ${money(cost)}.`;
}

function floorName(floor: number): string {
  return floor < 0 ? `basement ${-floor}` : `floor ${floor}`;
}

function countText(count: number, label: string): string {
  return count === 1 ? `only one ${label.toLowerCase()}` : `only ${count} ${plural(label).toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * A floor number the tower can hold: a whole number, never 0, between MIN_FLOOR and
 * MAX_FLOOR. Nothing has to stand on it yet: a shaft may rise into empty air.
 */
function floorExists(floor: number): boolean {
  return Number.isInteger(floor) && floor !== 0 && floor >= MIN_FLOOR && floor <= MAX_FLOOR;
}

/** The floors a room covers; rooms always grow upward from their base floor. */
function floorsCovered(floor: number, height: number): number[] {
  const floors: number[] = [];
  for (let f = floor; f < floor + height; f++) floors.push(f);
  return floors;
}

/** The floors a shaft passes through, skipping the floor 0 that does not exist. */
function shaftFloors(floorMin: number, floorMax: number): number[] {
  const floors: number[] = [];
  for (let f = floorMin; f <= floorMax; f++) if (f !== 0) floors.push(f);
  return floors;
}

function overlapsX(aX: number, aWidth: number, bX: number, bWidth: number): boolean {
  return aX < bX + bWidth && bX < aX + aWidth;
}

/**
 * Connectors carry people between floors: stairs and escalators are rooms, an elevator
 * is a shaft. A connector overlays rooms and rooms overlay it, but two connectors never
 * share a tile.
 */
const CONNECTOR_KINDS: readonly RoomKind[] = ['stairs', 'escalator'];

function isConnector(kind: RoomKind): boolean {
  return CONNECTOR_KINDS.includes(kind);
}

/**
 * Rooms block each other only within their own layer: connectors over here, rooms over there.
 * Two connectors only collide when they share the same base floor (the first floor of the new
 * one's span); a flight may start where the last one reaches, so a stairwell stacks in a column.
 */
function roomInTheWay(
  world: World,
  kind: RoomKind,
  floors: readonly number[],
  x: number,
  width: number,
  baseFloor: number,
): boolean {
  const connector = isConnector(kind);
  for (const f of floors) {
    for (const room of roomsOnFloor(world, f)) {
      if (isConnector(room.kind) !== connector) continue;
      if (connector && room.floor !== baseFloor) continue;
      if (overlapsX(x, width, room.x, room.width)) return true;
    }
  }
  return false;
}

/** Room overlap as seen by a shaft: only stairs and escalators stand in an elevator's way. */
function connectorInTheWayOfShaft(
  world: World,
  floors: readonly number[],
  x: number,
  width: number,
): boolean {
  for (const f of floors) {
    for (const room of roomsOnFloor(world, f)) {
      if (!isConnector(room.kind)) continue;
      if (overlapsX(x, width, room.x, room.width)) return true;
    }
  }
  return false;
}

function shaftInTheWay(
  world: World,
  floors: readonly number[],
  x: number,
  width: number,
  exceptShaftId?: number,
): boolean {
  for (const shaft of world.shafts.values()) {
    if (shaft.id === exceptShaftId) continue;
    if (!overlapsX(x, width, shaft.x, shaft.width)) continue;
    for (const f of floors) {
      if (f >= shaft.floorMin && f <= shaft.floorMax) return true;
    }
  }
  return false;
}

/** A shaft's tiles are floor too, so a floor exists where a room or a shaft stands on it. */
function floorIsBuilt(world: World, floor: number): boolean {
  if (roomsOnFloor(world, floor).length > 0) return true;
  for (const shaft of world.shafts.values()) {
    if (floor >= shaft.floorMin && floor <= shaft.floorMax) return true;
  }
  return false;
}

/** A floor may only be built on when the floor nearer the ground already exists. */
function hasSupport(world: World, floor: number): boolean {
  if (floor === 1) return true;
  if (floor > 1) return floorIsBuilt(world, floor - 1);
  if (floor === -1) return groundLobby(world) !== undefined;
  return floorIsBuilt(world, floor + 1);
}

function isExpressStop(floor: number): boolean {
  return floor === 1 || floor < 0 || LIMITS.skyLobbyFloors.includes(floor);
}

function defaultStops(kind: ShaftKind, floorMin: number, floorMax: number): Set<number> {
  const stops = new Set<number>();
  for (const f of shaftFloors(floorMin, floorMax)) {
    if (SHAFTS[kind].expressOnly && !isExpressStop(f)) continue;
    stops.add(f);
  }
  return stops;
}

function makeCar(world: World, shaftId: number, homeFloor: number): Car {
  return {
    id: allocId(world),
    shaftId,
    y: homeFloor,
    dir: 0,
    state: 'idle',
    doorTimer: 0,
    idleSince: world.time.minute,
    passengers: [],
    calls: new Set<number>(),
    serves: 'any', // a new car carries everyone until the player says otherwise
    range: null, // and works the whole shaft, growing with it
  };
}

const VACANT_ON_BUILD: readonly RoomKind[] = [
  'office',
  'condo',
  'hotelSingle',
  'hotelTwin',
  'hotelSuite',
];

function makeRoom(world: World, kind: RoomKind, floor: number, x: number): Room {
  const rule = ROOMS[kind];
  return {
    id: allocId(world),
    kind,
    floor,
    x,
    width: rule.width,
    height: rule.height,
    eval: 1,
    tenants: [],
    occupancy: 0,
    builtAtMinute: world.time.minute,
    vacant: VACANT_ON_BUILD.includes(kind),
    dirty: false,
    infested: false,
    lowEvalSinceMinute: null,
    onFire: false,
  };
}

// ---------------------------------------------------------------------------
// Ghost previews
// ---------------------------------------------------------------------------

export function canBuild(world: World, kind: RoomKind, floor: number, x: number): CommandResult {
  const rule = ROOMS[kind];
  if (world.stars < rule.star) return no(starText(rule.star));

  if (!Number.isInteger(x)) return no('That spot is not on the grid.');
  if (!floorExists(floor)) return no('That floor does not exist.');

  const floors = floorsCovered(floor, rule.height);
  if (floors.some((f) => !floorExists(f))) return no('That does not fit inside the tower.');
  if (x < 0 || x + rule.width > TOWER_WIDTH) return no('That does not fit inside the tower.');

  if (rule.placement === 'aboveGround' && floors.some((f) => f < 1)) {
    return no(`${plural(rule.label)} must go above ground.`);
  }
  if (rule.placement === 'underground' && floors.some((f) => f > -1)) {
    return no(`${plural(rule.label)} must go underground.`);
  }

  if (kind === 'lobby' && floor !== 1) return no('The lobby goes on floor 1.');
  if (kind === 'skyLobby' && !LIMITS.skyLobbyFloors.includes(floor)) {
    const list = LIMITS.skyLobbyFloors;
    const spelled = `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
    return no(`Sky lobbies go on floors ${spelled}.`);
  }

  if (rule.maxCount !== null && roomsOfKind(world, kind).length >= rule.maxCount) {
    return no(`You can build ${countText(rule.maxCount, rule.label)}.`);
  }

  if (!hasSupport(world, floor)) return no('Build a floor below this one first.');

  if (roomInTheWay(world, kind, floors, x, rule.width, floor)) return no('Something is already there.');
  // A room may stand over an elevator's column; another connector may not.
  if (isConnector(kind) && shaftInTheWay(world, floors, x, rule.width)) {
    return no('An elevator is in the way.');
  }

  if (world.cash < rule.cost) return no(cannotAfford(rule.label, rule.cost));

  return OK;
}

export function canBuildShaft(
  world: World,
  kind: ShaftKind,
  x: number,
  floorMin: number,
  floorMax: number,
): CommandResult {
  const rule = SHAFTS[kind];
  if (world.stars < rule.star) return no(starText(rule.star));

  if (!Number.isInteger(x)) return no('That spot is not on the grid.');
  if (!floorExists(floorMin) || !floorExists(floorMax)) return no('That floor does not exist.');
  if (floorMin >= floorMax) return no('An elevator must serve at least two floors.');
  if (x < 0 || x + rule.width > TOWER_WIDTH) return no('That does not fit inside the tower.');

  const floors = shaftFloors(floorMin, floorMax);
  if (rule.maxSpan !== null && floors.length > rule.maxSpan) {
    return no(`${plural(rule.label)} can span only ${rule.maxSpan} floors.`);
  }
  if (world.shafts.size >= LIMITS.maxShafts) {
    return no(`You can build ${countText(LIMITS.maxShafts, 'Elevator')}.`);
  }

  if (connectorInTheWayOfShaft(world, floors, x, rule.width)) return no('Something is already there.');
  if (shaftInTheWay(world, floors, x, rule.width)) return no('An elevator is in the way.');

  if (world.cash < rule.shaftCost) return no(cannotAfford(rule.label, rule.shaftCost));

  return OK;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function doBuild(world: World, kind: RoomKind, floor: number, x: number): CommandResult {
  const check = canBuild(world, kind, floor, x);
  if (!check.ok) return check;

  const rule = ROOMS[kind];
  const paid = spend(world, rule.cost, rule.label);
  if (!paid.ok) return no(cannotAfford(rule.label, rule.cost));

  const room = makeRoom(world, kind, floor, x);
  addRoom(world, room);
  const name = rule.label.toLowerCase();
  log(world, `Built ${article(name)} ${name} on ${floorName(floor)}.`, 'info', { roomId: room.id });
  return OK;
}

function doDemolish(world: World, roomId: number): CommandResult {
  const room = world.rooms.get(roomId);
  if (!room) return no('There is nothing to demolish.');
  if (room.occupancy > 0) return no('People are inside.');

  for (const simId of room.tenants) {
    const sim = world.sims.get(simId);
    if (!sim) continue;
    sim.state = 'gone';
    sim.inRoomId = null;
    sim.homeRoomId = null;
    removeSim(world, simId);
  }
  room.tenants = [];
  removeRoom(world, room.id);

  const name = ROOMS[room.kind].label.toLowerCase();
  log(world, `Demolished the ${name} on ${floorName(room.floor)}.`);
  return OK;
}

function doBuildShaft(
  world: World,
  kind: ShaftKind,
  x: number,
  floorMin: number,
  floorMax: number,
): CommandResult {
  const check = canBuildShaft(world, kind, x, floorMin, floorMax);
  if (!check.ok) return check;

  const rule = SHAFTS[kind];
  const paid = spend(world, rule.shaftCost, rule.label);
  if (!paid.ok) return no(cannotAfford(rule.label, rule.shaftCost));

  const stops = defaultStops(kind, floorMin, floorMax);
  const shaft: Shaft = {
    id: allocId(world),
    kind,
    x,
    width: rule.width,
    floorMin,
    floorMax,
    stops,
    homeFloor: pickHomeFloor(stops, floorMin, floorMax),
    cars: [],
    hallCalls: new Map(),
  };
  // The shaft price includes its first car.
  shaft.cars.push(makeCar(world, shaft.id, shaft.homeFloor));
  addShaft(world, shaft);

  const name = rule.label.toLowerCase();
  log(
    world,
    `Built ${article(name)} ${name} from ${floorName(floorMin)} to ${floorName(floorMax)}.`,
  );
  return OK;
}

/** Ground level is home when the shaft reaches it, otherwise the lowest floor it stops at. */
function pickHomeFloor(stops: ReadonlySet<number>, floorMin: number, floorMax: number): number {
  if (floorMin <= 1 && floorMax >= 1 && stops.has(1)) return 1;
  if (stops.has(floorMin)) return floorMin;
  let lowest: number | null = null;
  for (const f of stops) if (lowest === null || f < lowest) lowest = f;
  return lowest ?? floorMin;
}

function doDemolishShaft(world: World, shaftId: number): CommandResult {
  const shaft = world.shafts.get(shaftId);
  if (!shaft) return no('There is nothing to demolish.');
  if (shaft.cars.some((car) => car.passengers.length > 0)) {
    return no('Wait until the cars are empty.');
  }
  removeShaft(world, shaft.id);
  const name = SHAFTS[shaft.kind].label.toLowerCase();
  log(world, `Demolished the ${name} at ${floorName(shaft.floorMin)}.`);
  return OK;
}

/**
 * Could this elevator be stretched to this span?
 *
 * Stretching is free: the shaft's price bought the column, whatever it ends up serving. The
 * ghost and the shaft panel ask this before they offer the move, so the answer is the same
 * sentence the log would have shown afterwards.
 */
export function canExtendShaft(
  world: World,
  shaftId: number,
  floorMin: number,
  floorMax: number,
): CommandResult {
  const shaft = world.shafts.get(shaftId);
  if (!shaft) return no('That elevator is gone.');
  if (!floorExists(floorMin) || !floorExists(floorMax)) return no('That floor does not exist.');
  if (floorMin > shaft.floorMin || floorMax < shaft.floorMax) {
    return no('You can only extend an elevator, not shrink it.');
  }
  if (floorMin === shaft.floorMin && floorMax === shaft.floorMax) {
    return no('That elevator already reaches those floors.');
  }

  const rule = SHAFTS[shaft.kind];
  const floors = shaftFloors(floorMin, floorMax);
  if (rule.maxSpan !== null && floors.length > rule.maxSpan) {
    return no(`${plural(rule.label)} can span only ${rule.maxSpan} floors.`);
  }

  const added = floors.filter((f) => f < shaft.floorMin || f > shaft.floorMax);
  if (connectorInTheWayOfShaft(world, added, shaft.x, shaft.width)) {
    return no('Something is already there.');
  }
  if (shaftInTheWay(world, added, shaft.x, shaft.width, shaft.id)) {
    return no('An elevator is in the way.');
  }
  return OK;
}

function doExtendShaft(
  world: World,
  shaftId: number,
  floorMin: number,
  floorMax: number,
): CommandResult {
  const refusal = canExtendShaft(world, shaftId, floorMin, floorMax);
  if (!refusal.ok) return refusal;
  const shaft = world.shafts.get(shaftId);
  if (!shaft) return no('That elevator is gone.');

  const rule = SHAFTS[shaft.kind];
  const added = shaftFloors(floorMin, floorMax).filter(
    (f) => f < shaft.floorMin || f > shaft.floorMax,
  );

  shaft.floorMin = floorMin;
  shaft.floorMax = floorMax;
  // Keep the stops the player chose; the new floors get the default stops for the kind.
  for (const f of defaultStops(shaft.kind, floorMin, floorMax)) {
    if (added.includes(f)) shaft.stops.add(f);
  }
  world.routingDirty = true;
  rebuildFloorIndex(world);

  const name = rule.label.toLowerCase();
  log(world, `Extended the ${name} to ${floorName(floorMin)} through ${floorName(floorMax)}.`);
  return OK;
}

function doAddCar(world: World, shaftId: number): CommandResult {
  const shaft = world.shafts.get(shaftId);
  if (!shaft) return no('That elevator is gone.');

  const rule = SHAFTS[shaft.kind];
  if (shaft.cars.length >= rule.maxCars) {
    return no(`This elevator already has ${rule.maxCars} cars.`);
  }
  const carLabel = `${rule.label} car`;
  if (world.cash < rule.carCost) return no(cannotAfford(carLabel, rule.carCost));
  const paid = spend(world, rule.carCost, carLabel);
  if (!paid.ok) return no(cannotAfford(carLabel, rule.carCost));

  shaft.cars.push(makeCar(world, shaft.id, shaft.homeFloor));
  world.routingDirty = true; // routes are planned on the cars, not on the shaft alone
  log(world, `Added a car to the ${rule.label.toLowerCase()} at ${floorName(shaft.floorMin)}.`);
  return OK;
}

function doRemoveCar(world: World, shaftId: number): CommandResult {
  const shaft = world.shafts.get(shaftId);
  if (!shaft) return no('That elevator is gone.');
  if (shaft.cars.length <= 1) return no('An elevator needs at least one car.');

  const car = shaft.cars[shaft.cars.length - 1];
  if (!car) return no('An elevator needs at least one car.');
  if (car.passengers.length > 0) return no('People are inside.');

  shaft.cars.pop();
  world.routingDirty = true;
  const rule = SHAFTS[shaft.kind];
  log(world, `Removed a car from the ${rule.label.toLowerCase()} at ${floorName(shaft.floorMin)}.`);
  return OK;
}

function doSetStop(world: World, shaftId: number, floor: number, stops: boolean): CommandResult {
  const shaft = world.shafts.get(shaftId);
  if (!shaft) return no('That elevator is gone.');
  if (!floorExists(floor) || floor < shaft.floorMin || floor > shaft.floorMax) {
    return no('That floor is not on this elevator.');
  }
  if (stops && SHAFTS[shaft.kind].expressOnly && !isExpressStop(floor)) {
    return no('Express elevators stop only at lobbies and underground floors.');
  }

  if (stops) shaft.stops.add(floor);
  else {
    shaft.stops.delete(floor);
    // The home floor must stay a floor the elevator actually serves.
    if (shaft.homeFloor === floor) shaft.homeFloor = pickHomeFloor(shaft.stops, shaft.floorMin, shaft.floorMax);
  }
  world.routingDirty = true;
  rebuildFloorIndex(world);

  const name = SHAFTS[shaft.kind].label.toLowerCase();
  log(
    world,
    stops
      ? `The ${name} now stops on ${floorName(floor)}.`
      : `The ${name} no longer stops on ${floorName(floor)}.`,
  );
  return OK;
}

/** The word the log uses for a car's riders. */
const SERVES_LABEL: Record<Car['serves'], string> = {
  any: 'everyone',
  hotel: 'hotel guests',
  office: 'office staff',
};

/** Which car this is to the player: the panel numbers them from 1, in shaft order. */
function carNumber(shaft: Shaft, carId: number): number {
  return shaft.cars.findIndex((car) => car.id === carId) + 1;
}

function doSetCarServes(
  world: World,
  shaftId: number,
  carId: number,
  serves: Car['serves'],
): CommandResult {
  const shaft = world.shafts.get(shaftId);
  if (!shaft) return no('That elevator is gone.');
  const car = shaft.cars.find((c) => c.id === carId);
  if (!car) return no('That car is gone.');
  if (serves !== 'any' && serves !== 'hotel' && serves !== 'office') {
    return no('A car carries everyone, hotel guests, or office staff.');
  }
  if (car.serves === serves) return OK;

  car.serves = serves;
  world.routingDirty = true; // who a car carries decides which trips it can be planned for

  const name = SHAFTS[shaft.kind].label.toLowerCase();
  log(world, `Car ${carNumber(shaft, carId)} of the ${name} now carries ${SERVES_LABEL[serves]}.`);
  return OK;
}

function doSetCarRange(
  world: World,
  shaftId: number,
  carId: number,
  range: { lo: number; hi: number } | null,
): CommandResult {
  const shaft = world.shafts.get(shaftId);
  if (!shaft) return no('That elevator is gone.');
  const car = shaft.cars.find((c) => c.id === carId);
  if (!car) return no('That car is gone.');
  if (range !== null) {
    if (!Number.isInteger(range.lo) || !Number.isInteger(range.hi)) {
      return no('That floor is not on this elevator.');
    }
    if (range.lo < shaft.floorMin || range.hi > shaft.floorMax) {
      return no('That floor is not on this elevator.');
    }
    if (range.lo > range.hi) return no('The bottom floor cannot be above the top floor.');
    if (range.hi - range.lo < 1) return no('A car must serve at least two floors.');
  }
  // Changing the floors under a rider aboard would strand them: the car may not leave
  // its range, so a destination outside it would never come.
  if (car.passengers.length > 0) return no('People are inside.');

  car.range = range === null ? null : { lo: range.lo, hi: range.hi };
  world.routingDirty = true;

  const name = SHAFTS[shaft.kind].label.toLowerCase();
  const where = range === null
    ? 'the whole shaft'
    : `${floorName(range.lo)} to ${floorName(range.hi).toLowerCase()}`;
  log(world, `Car ${carNumber(shaft, carId)} of the ${name} now works ${where}.`);
  return OK;
}

function doSetHome(world: World, shaftId: number, floor: number): CommandResult {
  const shaft = world.shafts.get(shaftId);
  if (!shaft) return no('That elevator is gone.');
  if (!shaft.stops.has(floor)) return no('The home floor must be a stop.');

  shaft.homeFloor = floor;
  const name = SHAFTS[shaft.kind].label.toLowerCase();
  log(world, `The ${name} now waits on ${floorName(floor)}.`);
  return OK;
}

export function applyCommand(world: World, cmd: Command): CommandResult {
  switch (cmd.kind) {
    case 'build':
      return doBuild(world, cmd.room, cmd.floor, cmd.x);
    case 'demolish':
      return doDemolish(world, cmd.roomId);
    case 'shaft.build':
      return doBuildShaft(world, cmd.shaft, cmd.x, cmd.floorMin, cmd.floorMax);
    case 'shaft.demolish':
      return doDemolishShaft(world, cmd.shaftId);
    case 'shaft.extend':
      return doExtendShaft(world, cmd.shaftId, cmd.floorMin, cmd.floorMax);
    case 'shaft.addCar':
      return doAddCar(world, cmd.shaftId);
    case 'shaft.removeCar':
      return doRemoveCar(world, cmd.shaftId);
    case 'shaft.setStop':
      return doSetStop(world, cmd.shaftId, cmd.floor, cmd.stops);
    case 'shaft.setHome':
      return doSetHome(world, cmd.shaftId, cmd.floor);
    case 'shaft.setCarServes':
      return doSetCarServes(world, cmd.shaftId, cmd.carId, cmd.serves);
    case 'shaft.setCarRange':
      return doSetCarRange(world, cmd.shaftId, cmd.carId, cmd.range);
    case 'bomb.pay':
    case 'fire.callHelicopter':
      return handleEventCommand(world, cmd);
    default: {
      const never: never = cmd;
      void never;
      return no('That command is not available.');
    }
  }
}
