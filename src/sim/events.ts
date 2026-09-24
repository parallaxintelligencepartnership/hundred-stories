// Events: fire, bomb, VIP visit, cockroaches, Santa and weddings.
// Scheduling, progression and resolution. Numbers come from rules.ts, chance
// comes from world.rng, and every start, step and end writes a log line.

import { EVAL, EVENTS } from './rules';
import { ROOMS } from './rules';
import { clockOf, TOWER_WIDTH } from './types';
import type { ActiveEvent, Command, CommandResult, Id, Room, RoomKind, Sim, VipRating, World } from './types';
import { personName, vipPreference } from './identity';
import { sendVipToSuite } from './people';
import { isFollowed, recordBeat, type StoryBeat } from './story';
import { addSim, allocId, groundLobby, log, removeRoom, removeSim, roomsOfKind, setOccupancy, setOnFire } from './world';

// Defined here because rules.ts has no calendar constants. One tick is one minute.
const MINUTES_PER_DAY = 1440;
const DAYS_PER_YEAR = 12; // 4 quarters of 3 days, per docs/DESIGN.md section 3
/** Daily and quarterly rolls all happen once a day at this minute of day. */
export const EVENT_ROLL_MINUTE_OF_DAY = 6 * 60;

const HOTEL_SUITE: RoomKind = 'hotelSuite';

/**
 * Test seam. Production code never writes to this. `chance` forces a roll to
 * pass or fail, `target` forces which room a fire or a bomb picks, so a test
 * does not have to hunt for a seed that lands on the room it built.
 *
 * The export ships in every bundle (tests import it directly), but every
 * read of it in this file is gated behind `hooksActive()`. Vite sets
 * `import.meta.env.MODE` to 'test' under vitest and to 'production' in a
 * built bundle, so in production the hooks are always ignored no matter
 * what a caller writes into them.
 */
export const EVENT_TEST_HOOKS: {
  chance: { fire: number | null; bomb: number | null; vip: number | null };
  target: { fire: Id | null; bomb: Id | null };
} = {
  chance: { fire: null, bomb: null, vip: null },
  target: { fire: null, bomb: null },
};

/** True only when running under vitest. See the comment on EVENT_TEST_HOOKS. */
export function hooksActive(): boolean {
  return import.meta.env.MODE === 'test';
}

export function resetEventTestHooks(): void {
  EVENT_TEST_HOOKS.chance = { fire: null, bomb: null, vip: null };
  EVENT_TEST_HOOKS.target = { fire: null, bomb: null };
}

// The dirty-since timer lives on room.dirtySinceMinute so it survives save and
// load. Only the spread cadence (a cosmetic pacing, not part of the save
// contract) still lives here, keyed by world, and is rebuilt from scratch
// after a load.
interface RoachSpreadState {
  lastSpread: number | null;
}
const roachSpread = new WeakMap<World, RoachSpreadState>();

function roachSpreadOf(world: World): RoachSpreadState {
  let state = roachSpread.get(world);
  if (!state) {
    state = { lastSpread: null };
    roachSpread.set(world, state);
  }
  return state;
}

export function formatDollars(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const digits = Math.round(Math.abs(amount)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${digits}`;
}

function label(kind: RoomKind): string {
  return ROOMS[kind].label.toLowerCase();
}

function describe(room: Room): string {
  return `${label(room.kind)} on floor ${room.floor}`;
}

/** A story beat beside an event's log line. Presentation only: nothing here reads it back. */
function towerBeat(world: World, code: StoryBeat['code'], facts: Omit<StoryBeat, 'code' | 'minute'>): void {
  recordBeat(world.story, { code, minute: world.time.minute, ...facts });
}

function eventOf<K extends ActiveEvent['kind']>(world: World, kind: K): Extract<ActiveEvent, { kind: K }> | undefined {
  return world.events.find((e) => e.kind === kind) as Extract<ActiveEvent, { kind: K }> | undefined;
}

function endEvent(world: World, event: ActiveEvent): void {
  const at = world.events.indexOf(event);
  if (at >= 0) world.events.splice(at, 1);
}

function securityOnDuty(world: World): boolean {
  return roomsOfKind(world, 'security').some((r) => !r.onFire);
}

function chanceFor(key: 'fire' | 'bomb' | 'vip', fallback: number): number {
  if (!hooksActive()) return fallback;
  const forced = EVENT_TEST_HOOKS.chance[key];
  return forced === null ? fallback : forced;
}

function sortedRooms(world: World): Room[] {
  return [...world.rooms.values()].sort((a, b) => a.id - b.id);
}

function pickTargetRoom(world: World, key: 'fire' | 'bomb'): Room | undefined {
  const forced = hooksActive() ? EVENT_TEST_HOOKS.target[key] : null;
  if (forced !== null) return world.rooms.get(forced);
  const candidates = sortedRooms(world).filter((r) => !r.onFire);
  if (candidates.length === 0) return undefined;
  return world.rng.pick(candidates);
}

/** Tenants of a room that is about to disappear head for the exit. */
function evictInto(world: World, room: Room, reason: string): void {
  // Story: every followed tenant gets their closing beat; the rest of the room shares one.
  // value 0: the room was lost, which says nothing about how they felt about it.
  let roomBeat = false;
  for (const sim of world.sims.values()) {
    if (sim.homeRoomId !== room.id && sim.inRoomId !== room.id) continue;
    const followed = isFollowed(world.story, sim.id);
    if (sim.homeRoomId === room.id && (followed || !roomBeat)) {
      recordBeat(world.story, { code: 'room.vacated', minute: world.time.minute, simId: sim.id, roomId: room.id, value: 0 });
      if (!followed) roomBeat = true;
    }
    sim.state = 'leaving';
    sim.leaveReason = reason;
    sim.route = [];
    sim.inRoomId = null;
    if (sim.homeRoomId === room.id) sim.homeRoomId = null;
  }
  room.tenants = [];
  setOccupancy(world, room, 0);
}

function destroyRoom(world: World, room: Room, reason: string): void {
  evictInto(world, room, reason);
  setOnFire(world, room, false);
  removeRoom(world, room.id);
}

// ---------------------------------------------------------------- fire

export function startFire(world: World): void {
  const room = pickTargetRoom(world, 'fire');
  if (!room) return;
  setOnFire(world, room, true);
  world.events.push({
    kind: 'fire',
    roomIds: [room.id],
    startedAt: world.time.minute,
    spreadAt: world.time.minute + EVENTS.fire.spreadMinutes,
  });
  log(world, `Fire broke out in the ${describe(room)}. Call a helicopter or wait for security.`, 'alert', { roomId: room.id });
  towerBeat(world, 'fire.started', { roomId: room.id });
}

function spreadFire(world: World, event: Extract<ActiveEvent, { kind: 'fire' }>): void {
  const burning = event.roomIds.map((id) => world.rooms.get(id)).filter((r): r is Room => r !== undefined);
  const caught: Room[] = [];
  for (const source of burning) {
    for (let f = source.floor; f < source.floor + source.height; f++) {
      for (const other of world.floorIndex.rooms.get(f) ?? []) {
        if (other.onFire || caught.includes(other)) continue;
        const gap = other.x >= source.x + source.width ? other.x - (source.x + source.width) : source.x - (other.x + other.width);
        if (gap <= 1) caught.push(other);
      }
    }
  }
  for (const room of caught) {
    setOnFire(world, room, true);
    event.roomIds.push(room.id);
    log(world, `The fire spread to the ${describe(room)}.`, 'alert', { roomId: room.id });
  }
}

function endFire(world: World, event: Extract<ActiveEvent, { kind: 'fire' }>, how: string): void {
  const firstRoom = event.roomIds[0];
  let lost = 0;
  let cost = 0;
  for (const id of event.roomIds) {
    const room = world.rooms.get(id);
    if (!room) continue;
    destroyRoom(world, room, `The fire on floor ${room.floor} destroyed the ${label(room.kind)}.`);
    lost += 1;
    cost += EVENTS.fire.damagePerRoom;
  }
  world.cash -= cost;
  endEvent(world, event);
  const rooms = `${lost} room${lost === 1 ? '' : 's'}`;
  log(world, `${how}. ${rooms} burned down and clearing the damage cost ${formatDollars(cost)}.`, 'alert');
  towerBeat(world, 'fire.resolved', firstRoom !== undefined ? { roomId: firstRoom, value: lost } : { value: lost });
}

export function tickFire(world: World, event: Extract<ActiveEvent, { kind: 'fire' }>): void {
  // A security office puts the fire out at securityPutOutMinutes per burning room.
  if (securityOnDuty(world)) {
    const outAt = event.startedAt + EVENTS.fire.securityPutOutMinutes * event.roomIds.length;
    if (world.time.minute >= outAt) {
      endFire(world, event, 'Security put the fire out');
      return;
    }
  }
  if (world.time.minute >= event.spreadAt) {
    spreadFire(world, event);
    event.spreadAt = world.time.minute + EVENTS.fire.spreadMinutes;
  }
}

// ---------------------------------------------------------------- bomb

export function startBomb(world: World): void {
  const room = pickTargetRoom(world, 'bomb');
  if (!room) return;
  const dayStart = world.time.minute - clockOf(world.time.minute).minuteOfDay;
  world.events.push({
    kind: 'bomb',
    roomId: room.id,
    ransom: EVENTS.bomb.ransom,
    detonateAt: dayStart + EVENTS.bomb.detonateAtMinuteOfDay,
    found: false,
  });
  log(
    world,
    `A caller planted a bomb in the ${describe(room)}. Pay the ${formatDollars(EVENTS.bomb.ransom)} ransom or let security search the tower.`,
    'alert',
    { roomId: room.id },
  );
  towerBeat(world, 'bomb.started', { roomId: room.id });
}

function detonate(world: World, event: Extract<ActiveEvent, { kind: 'bomb' }>): void {
  const bombRoom = world.rooms.get(event.roomId);
  const ranked = sortedRooms(world).sort((a, b) => distanceFrom(bombRoom, a) - distanceFrom(bombRoom, b));
  const doomed = ranked.slice(0, EVENTS.bomb.damageRooms);
  const floor = bombRoom ? bombRoom.floor : 1;
  for (const room of doomed) destroyRoom(world, room, `The bomb on floor ${floor} destroyed the ${label(room.kind)}.`);
  world.cash -= EVENTS.bomb.damageCash;
  endEvent(world, event);
  const rooms = `${doomed.length} room${doomed.length === 1 ? '' : 's'}`;
  log(world, `The bomb went off on floor ${floor}. ${rooms} were destroyed and the repairs cost ${formatDollars(EVENTS.bomb.damageCash)}.`, 'alert');
  towerBeat(world, 'bomb.failed', bombRoom ? { roomId: bombRoom.id } : {});
}

function distanceFrom(from: Room | undefined, room: Room): number {
  if (!from) return room.id;
  return Math.abs(room.floor - from.floor) * TOWER_WIDTH + Math.abs(room.x - from.x);
}

export function tickBomb(world: World, event: Extract<ActiveEvent, { kind: 'bomb' }>): void {
  const dayStart = event.detonateAt - EVENTS.bomb.detonateAtMinuteOfDay;
  const searchStart = dayStart + EVENT_ROLL_MINUTE_OF_DAY;
  if (securityOnDuty(world)) {
    const floors = Math.max(1, world.floorIndex.builtFloors.size);
    if (world.time.minute >= searchStart + floors * EVENTS.bomb.securitySearchMinutesPerFloor) {
      event.found = true;
      const room = world.rooms.get(event.roomId);
      log(world, `Security found the bomb${room ? ` in the ${describe(room)}` : ''} and took it away.`, 'alert');
      towerBeat(world, 'bomb.resolved', { roomId: event.roomId });
      endEvent(world, event);
      return;
    }
  }
  if (world.time.minute >= event.detonateAt) detonate(world, event);
}

// ---------------------------------------------------------------- VIP

type VipEventState = Extract<ActiveEvent, { kind: 'vip' }>;

function freeSuite(world: World): Room | undefined {
  return roomsOfKind(world, HOTEL_SUITE)
    .sort((a, b) => a.id - b.id)
    .find((r) => r.tenants.length === 0 && !r.dirty && !r.infested && !r.onFire);
}

function entrancePos(world: World): { floor: number; x: number } {
  const lobby = groundLobby(world);
  return lobby ? { floor: 1, x: lobby.x } : { floor: 1, x: 0 };
}

export function startVip(world: World): void {
  const suite = freeSuite(world);
  if (!suite) return;
  const arrivesAt = world.time.minute + EVENTS.vip.noticeDays * MINUTES_PER_DAY;
  const sim: Sim = {
    id: allocId(world),
    kind: 'vip',
    homeRoomId: suite.id,
    pos: entrancePos(world),
    inCarId: null,
    inRoomId: null,
    route: [],
    state: 'outside',
    stress: 0,
    waitStart: null,
    schedule: [],
    nextScheduleIndex: 0,
    stayUntil: null,
    wallet: 0,
    leaveReason: null,
  };
  addSim(world, sim);
  // The booking holds the suite: a tenant in it keeps hotel guests from taking it tonight.
  suite.tenants.push(sim.id);
  const preference = vipPreference(world.seed, sim.id);
  world.events.push({
    kind: 'vip',
    simId: sim.id,
    arrivesAt,
    leavesAt: arrivesAt + EVENTS.vip.stayMinutes,
    score: 0,
    suiteId: suite.id,
    phase: 'notice',
    preference,
    longestWait: 0,
    waitingSince: null,
    checkInClean: null,
    checkInEval: null,
    incident: false,
  });
  const name = personName(world.seed, sim.id);
  log(
    world,
    `A VIP, ${name}, is coming to the ${describe(suite)} tomorrow. They care most about ${preference}.`,
    'alert',
    { roomId: suite.id, simId: sim.id },
  );
  towerBeat(world, 'vip.notice', { simId: sim.id, roomId: suite.id });
}

/** The wait band: the longest single wait for a car on the way in or out. */
export function vipWaitBand(minutes: number): VipRating {
  if (minutes <= EVENTS.vip.goodMaxWaitMinutes) return 'good';
  if (minutes <= EVENTS.vip.fairMaxWaitMinutes) return 'fair';
  return 'poor';
}

/**
 * The suite band: a dirty or infested suite at check in is poor, a suite rated below the
 * fair band (the red zone where tenants start to leave) is fair. Null means never checked in.
 */
export function vipSuiteBand(clean: boolean | null, evaluation: number | null): VipRating {
  if (clean === false) return 'poor';
  if (evaluation !== null && evaluation < EVAL.leaveThreshold) return 'fair';
  return 'good';
}

/** The safety band: any fire or bomb while the VIP was in the tower is poor. */
export function vipSafetyBand(incident: boolean): VipRating {
  return incident ? 'poor' : 'good';
}

const VIP_ORDER: Record<VipRating, number> = { poor: 0, fair: 1, good: 2 };

/** The rating is the lowest of the wait band, the suite band and the safety band. */
export function vipRatingOf(visit: Pick<VipEventState, 'longestWait' | 'checkInClean' | 'checkInEval' | 'incident'>): VipRating {
  const bands = [vipWaitBand(visit.longestWait), vipSuiteBand(visit.checkInClean, visit.checkInEval), vipSafetyBand(visit.incident)];
  return bands.reduce((low, band) => (VIP_ORDER[band] < VIP_ORDER[low] ? band : low));
}

function floorWords(floor: number): string {
  return floor < 0 ? `floor B${-floor}` : `floor ${floor}`;
}

function incidentActive(world: World): boolean {
  return world.events.some((e) => e.kind === 'fire' || e.kind === 'bomb');
}

/** Take the VIP's booking off the suite. */
function releaseSuite(world: World, event: VipEventState): void {
  const suite = event.suiteId === null ? undefined : world.rooms.get(event.suiteId);
  if (suite) suite.tenants = suite.tenants.filter((id) => id !== event.simId);
}

/** Record the result, write the log line and the beat, and clear the event. */
function closeVisit(world: World, event: VipEventState, rating: VipRating, reason: string | null): void {
  const value = VIP_ORDER[rating];
  event.score = value / 2;
  world.stats.vipRating = rating;
  world.stats.lastVip = {
    simId: event.simId,
    minute: world.time.minute,
    rating,
    preference: event.preference,
    longestWait: event.longestWait,
    waitBand: vipWaitBand(event.longestWait),
    suiteClean: event.checkInClean,
    suiteBand: vipSuiteBand(event.checkInClean, event.checkInEval),
    incident: event.incident,
    reason,
  };
  endEvent(world, event);
  const beat: Omit<StoryBeat, 'code' | 'minute'> = { simId: event.simId, value };
  if (event.suiteId !== null && world.rooms.has(event.suiteId)) beat.roomId = event.suiteId;
  if (reason) log(world, `${reason}.`, 'alert', { simId: event.simId });
  else log(world, `The VIP checked out and rated the tower ${rating}.`, 'alert', { simId: event.simId });
  towerBeat(world, 'vip.rated', beat);
}

/**
 * The visit ends before the stay: the VIP turns round. One who never came in is simply gone;
 * one already inside heads for the door like anyone leaving. Rated poor, value 0.
 */
function failVisit(world: World, event: VipEventState, reason: string): void {
  const sim = world.sims.get(event.simId);
  releaseSuite(world, event);
  if (sim) {
    sim.homeRoomId = null;
    if (sim.state === 'outside') {
      sim.state = 'gone';
      removeSim(world, sim.id);
    } else if (sim.state !== 'gone') {
      sim.exiting = true;
      sim.state = 'leaving';
      sim.leaveReason = `${reason}.`;
      sim.route = [];
      sim.waitStart = null;
      if (sim.inRoomId !== null) {
        const room = world.rooms.get(sim.inRoomId);
        if (room) setOccupancy(world, room, Math.max(0, room.occupancy - 1));
        sim.inRoomId = null;
      }
    }
  }
  closeVisit(world, event, 'poor', reason);
}

/** Keep the longest wait up to date. A wait runs from the first minute at the doors to boarding. */
function trackWait(world: World, event: VipEventState, sim: Sim): number {
  if (sim.state === 'waiting') {
    if (event.waitingSince === null) event.waitingSince = sim.waitStart ?? world.time.minute;
    const waited = world.time.minute - event.waitingSince;
    if (waited > event.longestWait) event.longestWait = waited;
    return waited;
  }
  // A reroute walks the VIP a few steps between waits: that is still one wait. Boarding or a
  // room ends it.
  if (sim.state === 'riding' || sim.state === 'inRoom' || sim.state === 'outside') event.waitingSince = null;
  return 0;
}

function waitedTooLong(waited: number): boolean {
  return waited > EVENTS.vip.giveUpWaitMinutes;
}

export function tickVip(world: World, event: VipEventState): void {
  const minute = world.time.minute;
  const sim = world.sims.get(event.simId);
  const suite = event.suiteId === null ? undefined : world.rooms.get(event.suiteId);

  if (event.phase === 'notice') {
    if (minute < event.arrivesAt) return;
    if (!suite || !sim) {
      failVisit(world, event, 'The VIP left: no suite was ready');
      return;
    }
    if (incidentActive(world)) event.incident = true;
    if (!sendVipToSuite(world, sim, suite)) {
      failVisit(world, event, `The VIP left: no way up to ${floorWords(suite.floor)}`);
      return;
    }
    event.phase = 'route';
    const name = personName(world.seed, sim.id);
    log(world, `The VIP, ${name}, walked into the lobby and is heading up to the ${describe(suite)}.`, 'info', {
      roomId: suite.id,
      simId: sim.id,
    });
    return;
  }

  if (incidentActive(world)) event.incident = true;

  if (event.phase === 'route') {
    if (!suite) {
      failVisit(world, event, 'The VIP left: no suite was ready');
      return;
    }
    if (!sim || sim.exiting || sim.state === 'leaving' || sim.state === 'gone') {
      failVisit(world, event, `The VIP left: no way up to ${floorWords(suite.floor)}`);
      return;
    }
    const waited = trackWait(world, event, sim);
    if (waitedTooLong(waited)) {
      const limit = EVENTS.vip.giveUpWaitMinutes;
      failVisit(world, event, `The VIP left: no elevator came for ${limit} minutes on ${floorWords(sim.pos.floor)}`);
      return;
    }
    if (sim.state !== 'inRoom' || sim.inRoomId !== suite.id) return;
    event.phase = 'stay';
    event.waitingSince = null;
    event.checkInClean = !suite.dirty && !suite.infested;
    event.checkInEval = suite.eval;
    event.leavesAt = minute + EVENTS.vip.stayMinutes;
    sim.stayUntil = event.leavesAt;
    log(world, `The VIP checked into the ${describe(suite)}.`, 'info', { roomId: suite.id, simId: sim.id });
    towerBeat(world, 'vip.arrival', { simId: sim.id, roomId: suite.id });
    return;
  }

  if (event.phase === 'stay') {
    if (sim && suite && sim.state === 'inRoom' && sim.inRoomId === suite.id) return;
    // The stay is over, or a fire moved the VIP out early: either way they are leaving.
    event.phase = 'checkout';
  }

  // Checkout: the rating lands when the VIP is out of the tower.
  if (!sim || sim.state === 'gone') {
    releaseSuite(world, event);
    closeVisit(world, event, vipRatingOf(event), null);
    return;
  }
  const waited = trackWait(world, event, sim);
  if (waitedTooLong(waited)) {
    // They are leaving anyway; a car that never comes still ends the visit, so it cannot stall.
    releaseSuite(world, event);
    closeVisit(world, event, vipRatingOf(event), null);
  }
}

// ---------------------------------------------------------------- cockroaches

function isHotelRoom(kind: RoomKind): boolean {
  return kind === 'hotelSingle' || kind === 'hotelTwin' || kind === 'hotelSuite';
}

/** Runs once a day. Dirty hotel rooms breed cockroaches, and cockroaches travel. */
export function tickCockroaches(world: World): void {
  const state = roachSpreadOf(world);
  const minute = world.time.minute;

  for (const room of sortedRooms(world)) {
    if (!isHotelRoom(room.kind)) continue;
    if (!room.dirty) {
      // Housekeeping cleaning a dirty room takes the cockroaches with it. A clean
      // room that caught them by spread keeps them until it needs cleaning again.
      const wasDirty = room.dirtySinceMinute != null;
      room.dirtySinceMinute = null;
      if (wasDirty && room.infested) {
        room.infested = false;
        log(world, `The ${describe(room)} is clean again and the cockroaches are gone.`, 'info', { roomId: room.id });
      }
      continue;
    }
    if (room.dirtySinceMinute == null) {
      // First sight of a dirty room, or an older save made before this field
      // existed. Either way, the countdown starts now.
      room.dirtySinceMinute = minute;
      continue;
    }
    if (room.infested) continue;
    if (minute - room.dirtySinceMinute < EVENTS.cockroaches.dirtyDaysBeforeInfested * MINUTES_PER_DAY) continue;
    room.infested = true;
    if (state.lastSpread === null) state.lastSpread = minute;
    log(world, `Cockroaches moved into the ${describe(room)}.`, 'alert', { roomId: room.id });
  }

  const infested = sortedRooms(world).filter((r) => r.infested && isHotelRoom(r.kind));
  if (infested.length === 0) {
    state.lastSpread = null;
    return;
  }
  if (state.lastSpread === null) state.lastSpread = minute;
  if (minute - state.lastSpread < EVENTS.cockroaches.spreadDays * MINUTES_PER_DAY) return;
  state.lastSpread = minute;
  for (const source of infested) {
    for (let f = source.floor; f < source.floor + source.height; f++) {
      for (const other of world.floorIndex.rooms.get(f) ?? []) {
        if (other.infested || !isHotelRoom(other.kind)) continue;
        const gap = other.x >= source.x + source.width ? other.x - (source.x + source.width) : source.x - (other.x + other.width);
        if (gap > 1) continue;
        other.infested = true;
        log(world, `The cockroaches spread to the ${describe(other)}.`, 'alert', { roomId: other.id });
      }
    }
  }
}

// ---------------------------------------------------------------- Santa

function isYearEndDay(minute: number): boolean {
  return Math.floor((minute % (DAYS_PER_YEAR * MINUTES_PER_DAY)) / MINUTES_PER_DAY) === DAYS_PER_YEAR - 1;
}

export function startSanta(world: World): void {
  if (eventOf(world, 'santa')) return;
  world.events.push({ kind: 'santa', startedAt: world.time.minute, x: 0 });
  log(world, 'Santa is flying past the tower.', 'info');
}

export function tickSanta(world: World, event: Extract<ActiveEvent, { kind: 'santa' }>): void {
  event.x += EVENTS.santa.tilesPerMinute;
  if (event.x < TOWER_WIDTH) return;
  endEvent(world, event);
  log(world, 'Santa has gone. Happy new year.', 'info');
}

// ---------------------------------------------------------------- wedding

export function startWedding(world: World): void {
  if (eventOf(world, 'wedding')) return;
  if (world.stars < 5) return;
  const cathedral = roomsOfKind(world, 'cathedral')[0];
  if (!cathedral) return;
  world.events.push({ kind: 'wedding', startedAt: world.time.minute });
  log(world, `A wedding has started in the cathedral on floor ${cathedral.floor}.`, 'info', { roomId: cathedral.id });
}

export function tickWedding(world: World, event: Extract<ActiveEvent, { kind: 'wedding' }>): void {
  if (world.time.minute - event.startedAt < EVENTS.wedding.durationMinutes) return;
  world.stats.weddingsHeld += 1;
  endEvent(world, event);
  log(world, 'The wedding is over and the guests have left.', 'info');
}

// ---------------------------------------------------------------- scheduler

/** Rolls the daily and quarterly chances. Called once a day at 06:00. */
export function rollDailyEvents(world: World): void {
  const clock = clockOf(world.time.minute);
  if (world.stars >= EVENTS.fire.minStar && !eventOf(world, 'fire')) {
    if (world.rng.next() < chanceFor('fire', EVENTS.fire.dailyChance)) startFire(world);
  }
  if (world.stars >= EVENTS.bomb.minStar && !eventOf(world, 'bomb')) {
    if (world.rng.next() < chanceFor('bomb', EVENTS.bomb.dailyChance)) startBomb(world);
  }
  if (clock.dayOfQuarter === 0 && world.stars >= EVENTS.vip.minStar && !eventOf(world, 'vip')) {
    if (world.rng.next() < chanceFor('vip', EVENTS.vip.quarterlyChance)) startVip(world);
  }
}

export function tickEvents(world: World): void {
  if (world.gameOver) return;
  const clock = clockOf(world.time.minute);

  if (clock.minuteOfDay === EVENT_ROLL_MINUTE_OF_DAY) {
    rollDailyEvents(world);
    tickCockroaches(world);
  }
  if (clock.isWeekend && clock.minuteOfDay === EVENTS.wedding.weekendMinuteOfDay) startWedding(world);
  if (isYearEndDay(world.time.minute) && clock.minuteOfDay === EVENTS.santa.minuteOfDay) startSanta(world);

  for (const event of [...world.events]) {
    switch (event.kind) {
      case 'fire':
        tickFire(world, event);
        break;
      case 'bomb':
        tickBomb(world, event);
        break;
      case 'vip':
        tickVip(world, event);
        break;
      case 'santa':
        tickSanta(world, event);
        break;
      case 'wedding':
        tickWedding(world, event);
        break;
    }
  }
}

export function handleEventCommand(world: World, cmd: Extract<Command, { kind: 'bomb.pay' | 'fire.callHelicopter' }>): CommandResult {
  if (cmd.kind === 'bomb.pay') {
    const event = eventOf(world, 'bomb');
    if (!event) return { ok: false, reason: 'There is no bomb threat right now.' };
    if (world.cash < event.ransom) return { ok: false, reason: `Not enough cash. The ransom is ${formatDollars(event.ransom)}.` };
    world.cash -= event.ransom;
    endEvent(world, event);
    const room = world.rooms.get(event.roomId);
    log(world, `You paid the ${formatDollars(event.ransom)} ransom and the bomb${room ? ` in the ${describe(room)}` : ''} was handed over.`, 'alert');
    towerBeat(world, 'bomb.resolved', { roomId: event.roomId });
    return { ok: true };
  }

  const event = eventOf(world, 'fire');
  if (!event) return { ok: false, reason: 'There is no fire right now.' };
  const cost = EVENTS.fire.helicopterCost;
  if (world.cash < cost) return { ok: false, reason: `Not enough cash. A firefighting helicopter costs ${formatDollars(cost)}.` };
  world.cash -= cost;
  log(world, `A firefighting helicopter cost ${formatDollars(cost)} and put the fire out.`, 'alert');
  endFire(world, event, 'The helicopter soaked the fire');
  return { ok: true };
}
