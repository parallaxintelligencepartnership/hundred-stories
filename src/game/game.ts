// The game shell: owns the world, the clock loop, the active tool, pointer input on the tower view, and saves.
import { canBuild, canBuildShaft, canExtendShaft } from '../sim/build';
import { applyAndRecord, buildLogOf, startBuildLog } from '../sim/buildlog';
import { markCheckpoint } from '../sim/replay';
import { LIMITS, ROOMS, SHAFTS } from '../sim/rules';
import { deserialize, serialize } from '../sim/save';
import { tick } from '../sim/tick';
import { clockOf, type Command, type CommandResult, type Id, type Shaft, type World } from '../sim/types';
import { createWorld, log as logEvent, type TowerStart } from '../sim/world';
import { SCHEDULES } from '../sim/rules';
import { classifyPress, isTap, PRESS_SLOP_PX, TOUCH_SLOP_PX } from '../render/input';
import type { Renderer } from '../render/renderer';
import { NIGHT_MULTIPLIER, type DailyChoice, type DailyInfo, type GameApi, type Placement, type PlacementRect, type Speed, type Tool } from './api';
import { keepDailyCopy, readDailyCopy, readSave, readSlot, readUnreadable, stashUnreadable, writeSave, writeSlot, type SlotName } from './storage';
import {
  DAILY_END_MINUTE,
  dailyFinished,
  dailyMode,
  dailyOpening,
  dailyStart,
  dailyTwist,
  dateOfMode,
  localDateKey,
  previousDateKey,
} from './daily';
import { createTap, drainTap, isBuildCommand, primeTap, type GameEvent, type GameEventListener } from './events';

const TICKS_PER_SECOND_AT_1X = 10;
/** The refusal for a build after today's tower has ended, in the player's words. */
export const DAILY_OVER_REASON = "Today's tower is over. Come back tomorrow for a new one.";
/** Said once per session, the first time a save the player did not ask for fails. */
export const NOT_SAVING_NOTICE = 'This device is not saving your tower right now.';
/** Said when "Start today's tower instead" cannot keep a copy of the later tower first. */
export const DAILY_COPY_FAILED = 'We could not keep a copy of that tower, so it stays for now.';

/**
 * The loader's reason without the field it tripped on: a damaged save's reason ends in the field
 * path in brackets, e.g. "(sims[3].route)", which is code and never shown to a player. The path
 * goes to the console on one line, so a developer can still find it.
 */
function plainReason(reason: string): string {
  const found = /^(.*?)\s*\(([^()]*)\)$/.exec(reason);
  if (!found) return reason;
  console.warn(`Unreadable save field: ${found[2]}`);
  return found[1] ?? reason;
}

/** What the player is told when their My tower save cannot be opened, at boot or on the My tower tap. */
export function unreadableMessage(reason: string, copied: boolean): string {
  reason = plainReason(reason);
  const kept = copied
    ? 'We kept a copy of it.'
    : 'We could not keep a copy, so we left it where it is.';
  const after = copied
    ? 'It is not saved until you press Save now.'
    : 'It is not saved until you press Save now, and that will replace the old one.';
  return `We could not open your saved tower. ${reason} ${kept} You are playing a new tower. ${after}`;
}
/** The largest interpolation alpha while the clock runs: the frame never reaches the next tick's position early. */
const ALPHA_MAX = 1 - 1e-9;
const MAX_TICKS_PER_FRAME = 240;
// A step drains missed ticks until this much wall time has passed, then drops the rest, so a
// slow tick becomes slow motion instead of a freeze.
const MAX_STEP_MS = 8;

// Clock constants for the autosave schedule. rules.ts holds no clock lengths, so these live
// here next to the only code that uses them; they match clockOf in sim/types.ts.
const MINUTES_PER_DAY = 1440;
const AUTOSAVE_MINUTE_OF_DAY = 6 * 60; // 06:00, the minute a new game opens on

/**
 * Should the tick loop autosave for the minutes it just ran?
 *
 * True when the batch crossed 06:00 on a game day, or crossed into a new quarter. A batch can
 * be hundreds of minutes at 4x night speed, so this asks whether a boundary falls inside
 * (prevMinute, nextMinute]: one save per burst, however many boundaries the burst swallowed.
 */
export function shouldAutosave(prevMinute: number, nextMinute: number): boolean {
  if (!Number.isFinite(prevMinute) || !Number.isFinite(nextMinute)) return false;
  if (nextMinute <= prevMinute) return false;
  const morningsBefore = Math.floor((prevMinute - AUTOSAVE_MINUTE_OF_DAY) / MINUTES_PER_DAY);
  const morningsAfter = Math.floor((nextMinute - AUTOSAVE_MINUTE_OF_DAY) / MINUTES_PER_DAY);
  if (morningsAfter > morningsBefore) return true;
  // Absolute quarter number, so the turn of a year counts too.
  const quarterOf = (minute: number): number => {
    const clock = clockOf(minute);
    return (clock.year - 1) * 4 + clock.quarter;
  };
  return quarterOf(nextMinute) > quarterOf(prevMinute);
}

/**
 * Floors counted without the floor that does not exist: 1 stays 1, -1 becomes 0.
 *
 * Moving a placement one step has to step over the ground, the same way the renderer's
 * shaft spans do, or a nudge up from floor -1 would land on a floor the sim refuses.
 */
function bandOf(floor: number): number {
  return floor > 0 ? floor : floor + 1;
}

function floorOfBand(band: number): number {
  return band > 0 ? band : band - 1;
}

const BAND_MIN = bandOf(LIMITS.minFloor);
const BAND_MAX = bandOf(LIMITS.maxFloor);

function clampBand(band: number): number {
  return Math.max(BAND_MIN, Math.min(BAND_MAX, band));
}

/** Wall time, the idle slot and the tab's visibility the loop runs on, so a test can drive all three. */
export interface GameClock {
  now(): number;
  scheduleIdle(run: () => void): () => void;
  /** True while the tab is hidden: the timer drives the sim then, the frame loop otherwise. */
  hidden(): boolean;
  /** The player's local calendar date, YYYY-MM-DD: the only place the daily reads the date. */
  today(): string;
  /** A fresh starting number for a new tower in My tower. */
  freshSeed(): number;
}

/**
 * Whether the tab is hidden. With no document at all (node, the tests) it counts as hidden, so
 * the timer step, which the loop tests drive through stepOnce, keeps driving the sim.
 */
export function documentHidden(): boolean {
  return typeof document === 'undefined' || document.hidden;
}

/**
 * Run this when the browser is next idle, and hand back the cancel for it.
 *
 * requestIdleCallback where it exists, a zero timeout everywhere else; the timeout keeps a busy
 * tab from postponing an autosave forever.
 */
export function scheduleIdle(run: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(run, { timeout: 2000 });
    return () => cancelIdleCallback(handle);
  }
  const handle = setTimeout(run, 0);
  return () => clearTimeout(handle);
}

export interface DrainLimits {
  maxTicks: number;
  maxMs: number;
  /**
   * Called at most once per drain, immediately before the tick that will leave the accumulator
   * under one, or before the last tick maxTicks allows. The renderer snapshots positions here so
   * it can lerp across that last tick. The time box is still checked after a tick, so a batch
   * the box cuts short may end without this having been called.
   */
  beforeLastTick?: () => void;
}

/**
 * Drain the whole ticks the accumulator has earned, and say how many ran.
 *
 * Stops at maxTicks, and at maxMs of wall time: past the box the whole missed ticks are dropped
 * and only the fraction is kept, so a slow tick turns into slow motion instead of a freeze. An
 * accumulator that outran the tick cap entirely (a tab asleep for minutes) is reset.
 */
export function drainTicks(
  loop: { accumulator: number },
  runTick: () => void,
  now: () => number,
  limits: DrainLimits = { maxTicks: MAX_TICKS_PER_FRAME, maxMs: MAX_STEP_MS },
): number {
  const start = now();
  let n = 0;
  let hooked = false;
  while (loop.accumulator >= 1 && n < limits.maxTicks) {
    if (!hooked && limits.beforeLastTick && (loop.accumulator < 2 || n + 1 === limits.maxTicks)) {
      hooked = true;
      limits.beforeLastTick();
    }
    runTick();
    loop.accumulator -= 1;
    n++;
    if (now() - start >= limits.maxMs) {
      loop.accumulator -= Math.floor(loop.accumulator); // drop the whole missed ticks, keep the fraction
      break;
    }
  }
  if (loop.accumulator > limits.maxTicks) loop.accumulator = 0;
  return n;
}

export interface Game extends GameApi {
  attach(renderer: Renderer, container: HTMLElement): void;
  start(): void;
  stop(): void;
  /** Runs one timer step, the thing setInterval calls; exported for the loop tests. */
  stepOnce(): void;
  /** Runs one animation frame, the thing requestAnimationFrame calls, without scheduling the next; for the loop tests. */
  frameOnce(): void;
  /** The fraction of the next tick earned so far (whole ticks while a drain is capped); for the loop tests. */
  accumulator(): number;
}

export function createGame(seed: number, clock: Partial<GameClock> = {}): Game {
  const time: GameClock = {
    now: clock.now ?? (() => performance.now()),
    scheduleIdle: clock.scheduleIdle ?? scheduleIdle,
    hidden: clock.hidden ?? documentHidden,
    today: clock.today ?? (() => localDateKey()),
    freshSeed: clock.freshSeed ?? (() => Math.floor(Date.now() % 1_000_000)),
  };
  // Every player command reaches the sim through applyAndRecord, the one recording boundary, so
  // the build log beside the world holds everything a replay needs (src/sim/buildlog.ts).
  let world: World = createWorld(seed);
  startBuildLog(world);
  // Which save slot this world lives in (src/game/storage.ts). Every save and load goes to it.
  let slot: SlotName = 'mine';
  // Moved since it was last saved or loaded: leaving a slot saves it only then, so opening
  // another slot never rewrites a tower that did not change.
  let dirty = false;
  // Counts every change, so a save that finishes after the tower moved again leaves it dirty.
  let edits = 0;
  // Slot switches in flight. While any is, the clock holds and nothing autosaves: the slot and
  // the world in hand change together, only once the new tower has been read.
  let holds = 0;
  let switchChain: Promise<unknown> = Promise.resolve();
  // My tower's save could not be opened and nothing was chosen in its place yet: no save the
  // player did not ask for writes over it (Save now, New game or Open a saved file lift this).
  let mineHeld = false;
  // The unreadable text itself, for Save to a file this session even when no copy could be kept.
  let unreadableText: string | null = null;
  // The failed-save notice goes out once per session; the last save's outcome decides whether
  // Open a saved file may leave an unsaved daily behind.
  let notSavingShown = false;
  let lastSaveFailed = false;
  // Set while the daily slot holds an unfinished tower from an earlier date, or any tower dated
  // after today, and the player has not yet chosen between it and starting today's.
  let dailyChoice: DailyChoice | null = null;
  // The daily slot's text when it holds a tower dated after today, kept aside before today's
  // tower takes the slot.
  let aheadText: string | null = null;
  let tool: Tool = { kind: 'none' };
  let speed: Speed = 1;
  let speedBeforePause: Speed = 1;
  let selection: null | { roomId?: Id; simId?: Id; shaftId?: Id } = null;
  let reducedMotion = false;
  /** The chrome the ui last measured, kept for a renderer that attaches after the ui. */
  let chrome: { top: number; bottom: number } | null = null;
  let renderer: Renderer | null = null;
  let container: HTMLElement | null = null;
  let raf = 0;
  let timer = 0;
  let last = 0;
  // Boxed so drainTicks, which frame() and the loop tests share, can spend it.
  const loop = { accumulator: 0 };
  const subscribers = new Set<() => void>();
  const notify = () => subscribers.forEach((cb) => cb());
  // The event stream. The tap is primed when the first listener arrives and on every world
  // swap, and compared after each tick batch and command only while someone listens.
  const eventListeners = new Set<GameEventListener>();
  const tap = createTap(world);
  const emit = (event: GameEvent): void => eventListeners.forEach((fn) => fn(event));
  function drainEvents(): void {
    if (eventListeners.size > 0) drainTap(tap, world, emit);
  }

  // Drag state for lobby segments (horizontal), new shafts (vertical), and the drag that
  // stretches a shaft that is already standing.
  let drag:
    | null
    | { floor: number; x: number; kind: 'lobby' | 'shaft'; touch: boolean }
    | { floor: number; x: number; kind: 'shaftExtend'; touch: boolean; shaftId: Id } = null;
  /**
   * The placement a finger parked on the tower, waiting for Build.
   *
   * A mouse has a hover ghost and a cursor to aim it with; a finger covers the very tile it
   * is choosing, so touch places in two steps: a tap parks this, and the ui's bar moves it,
   * sizes it and confirms it. A room keeps floorMin === floorMax === floor.
   */
  let pending: null | { floor: number; x: number; floorMin: number; floorMax: number; shaftId?: Id } = null;
  // A left press with a room tool is provisional: it builds on release, and only if it held
  // still. A press that travels is a pan, which renderer.ts hands to the camera.
  let press: null | { sx: number; sy: number; floor: number; x: number; time: number; touch: boolean } = null;
  let hover: { floor: number; x: number } | null = null;
  // Pointers down on the view. A second finger means the gesture belongs to the camera now:
  // two fingers pan and pinch even while a lobby or an elevator is being sized.
  const pointers = new Set<number>();

  /** Drop whatever this press was going to build. The camera has the gesture. */
  function abandonPress(): void {
    drag = null;
    press = null;
    // The parked placement survives a pinch: the camera took the gesture, not the choice.
    if (pending) showPendingGhost();
    else renderer?.setGhost(null);
  }

  /** Tools that draw with the left drag. Their drag is the build gesture, so it cannot pan. */
  function toolOwnsDrag(t: Tool): boolean {
    return t.kind === 'shaft' || (t.kind === 'room' && t.room === 'lobby');
  }

  /** After a build, bring the whole floor on screen if the room ran off the top or bottom edge. */
  function followBuild(cmd: Command): void {
    if (!renderer) return;
    if (cmd.kind === 'build') renderer.camera.ensureFloorVisible(cmd.floor);
    else if (cmd.kind === 'shaft.build') renderer.camera.ensureFloorVisible(cmd.floorMax);
  }

  function isNight(): boolean {
    const m = clockOf(world.time.minute).minuteOfDay;
    return m >= SCHEDULES.nightStart || m < SCHEDULES.nightEnd;
  }

  // Hoisted so a step allocates nothing: world is read through the closure, so a load or a new
  // game still ticks the world the shell holds now.
  const runTick = (): void => tick(world);
  // The renderer snapshots positions immediately before the last tick of each batch, so the next
  // frames lerp across exactly that one tick. Hoisted with the limits so a drain allocates nothing.
  const commitMotion = (): void => renderer?.commitMotion(world);
  const drainLimits: DrainLimits = { maxTicks: MAX_TICKS_PER_FRAME, maxMs: MAX_STEP_MS, beforeLastTick: commitMotion };

  /**
   * Earn ticks for the wall time since the last call and run them; say how many ran.
   *
   * dt is capped at one second, so a driver that stalls longer than that (a throttled hidden tab)
   * loses the rest: hidden progress is best effort, and this does not try to catch it up.
   */
  function advance(): number {
    const now = time.now();
    const dt = Math.min(1, (now - last) / 1000 || 0);
    last = now;
    if (holds > 0 || speed === 0 || world.gameOver || dailyOver()) return 0;
    const rate = TICKS_PER_SECOND_AT_1X * speed * (isNight() ? NIGHT_MULTIPLIER : 1);
    loop.accumulator += dt * rate;
    // A daily never runs past its last minute, however many ticks a night burst earned.
    if (slot === 'daily') loop.accumulator = Math.min(loop.accumulator, DAILY_END_MINUTE - world.time.minute);
    const minuteBefore = world.time.minute;
    const n = drainTicks(loop, runTick, time.now, drainLimits);
    if (n > 0) {
      markDirty();
      drainEvents();
      if (dailyOver()) {
        endDaily();
        return n;
      }
      notify();
      maybeAutosave(minuteBefore, world.time.minute);
    }
    return n;
  }

  /** The date of the daily in hand, or null outside the daily slot. */
  function dailyDate(): string | null {
    if (slot !== 'daily') return null;
    return dateOfMode(buildLogOf(world).mode);
  }

  function dailyOver(): boolean {
    return slot === 'daily' && dailyFinished(world);
  }

  /** The daily reached its end: stop the clock and keep the result. The ui shows the card. */
  function endDaily(): void {
    speed = 0;
    loop.accumulator = 0;
    cancelScheduledSave();
    notify();
    void saveWorld('background');
  }

  function markDirty(): void {
    dirty = true;
    edits++;
  }

  // While the tab is visible the frame loop drives the sim, so ticks land on frame boundaries and
  // the interpolation alpha is exact. Chrome pauses rAF in hidden tabs, so there the timer takes
  // over. Exactly one of the two advances at any moment.
  function step(): void {
    if (!time.hidden()) return;
    advance();
  }

  function onVisibilityChange(): void {
    // Going away, save what moved: a hidden tab may never come back.
    if (time.hidden()) saveNow();
    // Coming back, start the clock from now: the frame loop must not earn the hidden gap again.
    else last = time.now();
  }

  /** The page is going away (closed, reloaded, or put in the back-forward cache). */
  function onPageHide(): void {
    saveNow();
  }

  // One save per batch of ticks, and never two at once: a burst of ticks that crosses several
  // boundaries, or a slow write still in flight, must not pile up writes.
  let autosaveInFlight = false;
  // The autosave stringifies the whole tower, several MB on a big one. It runs in an idle slot,
  // not inside the timer step, so it never stacks on top of a rush-hour tick.
  let cancelAutosave: (() => void) | null = null;
  function maybeAutosave(prevMinute: number, nextMinute: number): void {
    if (!shouldAutosave(prevMinute, nextMinute)) return;
    saveWhenIdle();
  }

  /**
   * Save the tower in hand in the next idle slot. The slot and the world are taken now, so a
   * save that runs after a switch still writes the tower it was meant for, where it belongs.
   */
  function saveWhenIdle(): void {
    if (autosaveInFlight || holds > 0) return;
    autosaveInFlight = true;
    const name = slot;
    const w = world;
    cancelAutosave = time.scheduleIdle(() => {
      cancelAutosave = null;
      void saveWorld('background', name, w).finally(() => {
        autosaveInFlight = false;
      });
    });
  }

  /** Drop an idle save that has not started yet. One already writing finishes on its own. */
  function cancelScheduledSave(): void {
    if (!cancelAutosave) return;
    cancelAutosave();
    cancelAutosave = null;
    autosaveInFlight = false;
  }

  /** Save now, fire and forget, if the tower moved: the page is hiding or closing. */
  function saveNow(): void {
    if (!dirty || holds > 0) return;
    cancelScheduledSave();
    void saveWorld('background');
  }

  /** The first failed save the player did not ask for says so, once per session. */
  function noteSaveFailed(): void {
    if (notSavingShown) return;
    notSavingShown = true;
    logEvent(world, NOT_SAVING_NOTICE, 'warn');
    drainEvents();
    notify();
  }

  /**
   * Write a tower to a slot. 'player' is Save now: it logs, and its failure goes back to the
   * button. 'quiet' and 'background' are the game's own saves: a failure tells the player once
   * per session. A held My tower (an unreadable save the player has not replaced) is never
   * written by any save but the player's.
   */
  async function saveWorld(kind: 'player' | 'quiet' | 'background', name: SlotName = slot, w: World = world): Promise<CommandResult> {
    if (kind !== 'player' && name === 'mine' && mineHeld) return { ok: true };
    const at = edits;
    try {
      markCheckpoint(w); // the hash here lets a replay find where it drifted
      await writeTo(name, serialize(w));
      lastSaveFailed = false;
      if (w === world && edits === at) dirty = false;
      if (kind === 'player') {
        logEvent(world, 'Game saved.', 'info');
        notify();
      }
      return { ok: true };
    } catch (e) {
      lastSaveFailed = true;
      if (kind !== 'player') noteSaveFailed();
      return { ok: false, reason: e instanceof Error ? e.message : 'Could not save.' };
    }
  }

  // My tower goes through the original writeSave and readSave; the other slots by name.
  function writeTo(name: SlotName, text: string): Promise<void> {
    return name === 'mine' ? writeSave(text) : writeSlot(name, text);
  }

  function readFrom(name: SlotName): Promise<string | null> {
    return name === 'mine' ? readSave() : readSlot(name);
  }

  /** Put a world in hand: the same reset importSave and newGame do. */
  function swapWorld(next: World): void {
    world = next;
    dirty = false;
    primeTap(tap, world);
    selection = null;
    tool = { kind: 'none' };
    pending = null;
    drag = null;
    press = null;
    loop.accumulator = 0;
    renderer?.resetMotion(); // no sprite may lerp from the old tower into the new one
    renderer?.setSelection(null);
    renderer?.setGhost(null);
    renderer?.camera.reset();
  }

  /** A fresh tower in hand, from its number and its start. */
  function freshTower(newSeed: number, begin: { start?: TowerStart; mode?: string } = {}): void {
    const next = createWorld(newSeed, begin.start);
    startBuildLog(next, undefined, begin);
    swapWorld(next);
  }

  /**
   * Run a slot switch. The clock holds and no autosave runs until it is done, and switches run
   * one after another, so the slot and the world in hand only ever change together.
   */
  function switching(run: () => Promise<void>): Promise<void> {
    holds++;
    cancelScheduledSave();
    const done = switchChain.then(run).finally(() => {
      holds--;
      last = time.now(); // the held time is not earned again
    });
    switchChain = done.catch(() => {});
    return done;
  }

  /**
   * Get ready to leave the slot in hand for another. The slot being left is saved first, but
   * only when its tower moved since it was last saved or loaded, so a slot nobody played in is
   * never rewritten. False when that save failed: the switch is refused, so the unsaved tower
   * stays in hand (the failure has told the player). A held My tower is not written; the new
   * tower in it was never saved, as the player was told.
   */
  async function readyToLeave(next: SlotName): Promise<boolean> {
    if (next === slot || !dirty) return true;
    if (slot === 'mine' && mineHeld) return true;
    const res = await saveWorld('quiet', slot, world);
    return res.ok;
  }

  /** Make the slot just read the one in hand. Called in the same step as the world swap. */
  function takeSlot(next: SlotName): void {
    slot = next;
    dailyChoice = null;
    aheadText = null;
  }

  /** A slot's save as a world, with the text when it is there but does not read. */
  async function readWorld(name: SlotName): Promise<{ world: World | null; text: string | null; reason: string }> {
    const text = await readFrom(name);
    if (!text) return { world: null, text: null, reason: '' };
    const res = deserialize(text);
    return res.ok ? { world: res.world, text, reason: '' } : { world: null, text, reason: res.reason };
  }

  /**
   * My tower's save does not open. Keep a copy, hold the slot so nothing the player did not
   * ask for writes over it, and say so: the same words at boot and on the My tower tap.
   */
  function keepUnreadable(text: string, reason: string): void {
    const copied = stashUnreadable(text) === true;
    unreadableText = text;
    mineHeld = true;
    logEvent(world, unreadableMessage(reason, copied), 'warn');
    drainEvents();
    notify();
  }

  function startSpeed(): void {
    speed = 1;
    speedBeforePause = 1;
  }

  /** Today's tower, begun fresh on today's date and saved into the daily slot at once. */
  async function beginToday(today: string): Promise<void> {
    freshTower(dailyStart(today), { start: dailyTwist(today).start, mode: dailyMode(today) });
    startSpeed();
    notify();
    await saveWorld('quiet');
  }

  function frame(): void {
    raf = requestAnimationFrame(frame);
    drawFrame();
  }

  /** Advance the sim and render it. rAF should not fire in a hidden tab, but a throttled browser can. */
  function drawFrame(): void {
    if (time.hidden()) return;
    advance();
    // alpha is the fraction of the next tick already earned: each sprite reaches its target just
    // as that tick fires. Paused or over, everything stands on its target.
    const alpha = speed === 0 || world.gameOver ? 1 : Math.min(Math.max(loop.accumulator, 0), ALPHA_MAX);
    renderer?.render(world, alpha);
  }

  /** The shaft standing on this tile, if any. Tapping one with an elevator in hand extends it. */
  function shaftAtTile(floor: number, x: number): Shaft | null {
    for (const shaft of world.shafts.values()) {
      if (x < shaft.x || x >= shaft.x + shaft.width) continue;
      if (floor >= shaft.floorMin && floor <= shaft.floorMax) return shaft;
    }
    return null;
  }

  /** The span a drag from inside a shaft out to this floor asks for: the old span plus the reach. */
  function extendSpan(shaft: Shaft, floor: number): { floorMin: number; floorMax: number } {
    return {
      floorMin: Math.min(shaft.floorMin, floor),
      floorMax: Math.max(shaft.floorMax, floor),
    };
  }

  /**
   * The two floor span a tap on empty ground parks for a new elevator.
   *
   * One floor is never a legal elevator, so a parked single floor would open red for no
   * reason the player can see. The pair reaches up, or down from the top of the tower.
   */
  function twoFloorSpan(floor: number): { floorMin: number; floorMax: number } {
    const up = floorOfBand(bandOf(floor) + 1);
    if (up <= LIMITS.maxFloor) return { floorMin: floor, floorMax: up };
    return { floorMin: floorOfBand(bandOf(floor) - 1), floorMax: floor };
  }

  /** How wide the tool in hand is, in tiles. Zero when it builds nothing. */
  function toolWidth(): number {
    if (tool.kind === 'room') return ROOMS[tool.room].width;
    if (tool.kind === 'shaft') return SHAFTS[tool.shaft].width;
    return 0;
  }

  /** Keep a placement inside the lot: never off the left edge, never hanging off the right. */
  function clampTileX(x: number): number {
    return Math.max(0, Math.min(x, LIMITS.towerWidth - toolWidth()));
  }

  /** The span a placement covers, priced and judged by the sim, for the ghost and the ui. */
  function placementFor(
    at: { x: number; floorMin: number; floorMax: number; shaftId?: Id },
    isPending: boolean,
  ): Placement | null {
    if (at.shaftId !== undefined) {
      const shaft = world.shafts.get(at.shaftId);
      if (!shaft) return null;
      const res = canExtendShaft(world, at.shaftId, at.floorMin, at.floorMax);
      const base = {
        floor: at.floorMin,
        x: shaft.x,
        floorMin: at.floorMin,
        floorMax: at.floorMax,
        label: `Extend ${SHAFTS[shaft.kind].label.toLowerCase()}`,
        cost: 0, // the shaft's price covered every floor it will ever serve
        pending: isPending,
        shaftId: at.shaftId,
      };
      return res.ok ? { ...base, ok: true } : { ...base, ok: false, reason: res.reason };
    }
    if (tool.kind === 'room') {
      const rule = ROOMS[tool.room];
      const res = canBuild(world, tool.room, at.floorMin, at.x);
      const base = {
        floor: at.floorMin,
        x: at.x,
        floorMin: at.floorMin,
        floorMax: at.floorMin,
        label: rule.label,
        cost: rule.cost,
        pending: isPending,
      };
      return res.ok ? { ...base, ok: true } : { ...base, ok: false, reason: res.reason };
    }
    if (tool.kind === 'shaft') {
      const rule = SHAFTS[tool.shaft];
      const res = canBuildShaft(world, tool.shaft, at.x, at.floorMin, at.floorMax);
      const base = {
        floor: at.floorMin,
        x: at.x,
        floorMin: at.floorMin,
        floorMax: at.floorMax,
        label: rule.label,
        cost: rule.shaftCost,
        pending: isPending,
      };
      return res.ok ? { ...base, ok: true } : { ...base, ok: false, reason: res.reason };
    }
    return null;
  }

  /** Park a placement and show it: the ghost stops following the pointer until it is resolved. */
  function setPending(next: { floor: number; x: number; floorMin: number; floorMax: number; shaftId?: Id }): void {
    pending = next;
    showPendingGhost();
    notify();
  }

  function clearPending(): void {
    if (!pending) return;
    pending = null;
    renderer?.setGhost(null);
    notify();
  }

  function showPendingGhost(): void {
    if (!renderer || !pending) return;
    const placement = placementFor(pending, true);
    if (!placement) {
      renderer.setGhost(null);
      return;
    }
    // A room stands as tall as its rule says; an elevator is as tall as the span the player drew.
    const heightFloors =
      tool.kind === 'room' && placement.shaftId === undefined
        ? ROOMS[tool.room].height
        : bandOf(placement.floorMax) - bandOf(placement.floorMin) + 1;
    const shaft = placement.shaftId === undefined ? null : world.shafts.get(placement.shaftId);
    // An elevator ghost carries its kind, so the renderer can band the floors it will stop at.
    const shaftKind = shaft ? shaft.kind : tool.kind === 'shaft' ? tool.shaft : undefined;
    renderer.setGhost({
      widthTiles: shaft ? shaft.width : toolWidth(),
      heightFloors,
      floor: placement.floorMin,
      x: placement.x,
      ok: placement.ok,
      ...(shaftKind ? { shaft: shaftKind } : {}),
    });
  }

  function ghostFor(floor: number, x: number): void {
    if (!renderer) return;
    // A parked placement owns the ghost: the pointer may wander, the outline stays where the
    // player put it. A shaft drag in progress is the exception, since it is drawing a span.
    if (pending && !drag) {
      showPendingGhost();
      return;
    }
    if (drag?.kind === 'shaftExtend') {
      const shaft = world.shafts.get(drag.shaftId);
      if (!shaft) {
        renderer.setGhost(null);
        return;
      }
      const span = extendSpan(shaft, floor);
      const res = canExtendShaft(world, shaft.id, span.floorMin, span.floorMax);
      renderer.setGhost({
        widthTiles: shaft.width,
        heightFloors: bandOf(span.floorMax) - bandOf(span.floorMin) + 1,
        floor: span.floorMin,
        x: shaft.x,
        ok: res.ok,
        shaft: shaft.kind,
      });
      return;
    }
    if (tool.kind === 'room') {
      const rule = ROOMS[tool.room];
      const res = canBuild(world, tool.room, floor, x);
      renderer.setGhost({ widthTiles: rule.width, heightFloors: rule.height, floor, x, ok: res.ok });
    } else if (tool.kind === 'shaft') {
      const rule = SHAFTS[tool.shaft];
      const floorMin = drag ? Math.min(drag.floor, floor) : floor;
      const floorMax = drag ? Math.max(drag.floor, floor) : floor;
      const sx = drag ? drag.x : x;
      const res = canBuildShaft(world, tool.shaft, sx, floorMin, floorMax);
      renderer.setGhost({
        widthTiles: rule.width,
        // Floors the span covers, not counting the floor 0 that does not exist.
        heightFloors: bandOf(floorMax) - bandOf(floorMin) + 1,
        floor: floorMin,
        x: sx,
        ok: res.ok,
        shaft: tool.shaft,
      });
    } else {
      renderer.setGhost(null);
    }
  }

  function onPointerDown(ev: PointerEvent): void {
    if (!renderer || !container) return;
    pointers.add(ev.pointerId);
    if (pointers.size > 1) {
      abandonPress();
      return;
    }
    if (ev.button !== 0) return;
    const { floor, x } = renderer.screenToTile(ev.offsetX, ev.offsetY);
    press = null;
    const touch = ev.pointerType === 'touch';
    if (tool.kind === 'room' && tool.room === 'lobby') {
      drag = { floor, x, kind: 'lobby', touch };
      applyAndRecord(world, { kind: 'build', room: 'lobby', floor: 1, x });
      notify();
    } else if (tool.kind === 'shaft') {
      // An elevator in hand on a shaft that is already there means stretch that one, whichever
      // kind it is: the player is pointing at the shaft, not choosing a new one.
      const standing = shaftAtTile(floor, x);
      drag = standing
        ? { floor, x, kind: 'shaftExtend', touch, shaftId: standing.id }
        : { floor, x, kind: 'shaft', touch };
    }
    // Every other room waits for the release: until then the press may still become a pan.
    else if (tool.kind === 'room')
      press = { sx: ev.clientX, sy: ev.clientY, floor, x, time: ev.timeStamp, touch };
    ghostFor(floor, x);
  }

  function onPointerMove(ev: PointerEvent): void {
    if (!renderer) return;
    if (pointers.size > 1) return; // the camera is driving
    const { floor, x } = renderer.screenToTile(ev.offsetX, ev.offsetY);
    hover = { floor, x };
    const slop = press?.touch ? TOUCH_SLOP_PX : PRESS_SLOP_PX;
    if (press && classifyPress({ x: press.sx, y: press.sy }, { x: ev.clientX, y: ev.clientY }, slop) === 'pan') {
      press = null; // the camera has it now
    }
    if (drag?.kind === 'lobby' && tool.kind === 'room') {
      // paint segments while dragging on the lobby floor
      const from = Math.min(drag.x, x);
      const to = Math.max(drag.x, x);
      for (let sx = from; sx <= to; sx++) applyAndRecord(world, { kind: 'build', room: 'lobby', floor: 1, x: sx });
      drag.x = x;
      notify();
    }
    ghostFor(floor, x);
  }

  function onPointerUp(ev: PointerEvent): void {
    pointers.delete(ev.pointerId);
    if (!renderer) return;
    const { floor, x } = renderer.screenToTile(ev.offsetX, ev.offsetY);
    if (press) {
      // A click that never moved, or a tap that came and went, builds where it went down. A
      // finger that rested on the view does not: that press was a hesitation, or a pinch
      // whose second finger arrived late.
      const placed =
        !press.touch ||
        isTap({ x: press.sx, y: press.sy }, { x: ev.clientX, y: ev.clientY }, ev.timeStamp - press.time);
      // A finger cannot see the tile it is covering, so a tap parks the placement instead of
      // paying for it; a second tap moves it. A click keeps building where it clicked.
      if (placed && tool.kind === 'room') {
        if (press.touch) {
          setPending({ floor: press.floor, x: press.x, floorMin: press.floor, floorMax: press.floor });
        } else {
          api.apply({ kind: 'build', room: tool.room, floor: press.floor, x: press.x });
        }
      }
      press = null;
    }
    if (!drag) {
      ghostFor(floor, x);
      return;
    }
    if (drag.kind === 'lobby') {
      const from = Math.min(drag.x, x);
      const to = Math.max(drag.x, x);
      for (let sx = from; sx <= to; sx++) applyAndRecord(world, { kind: 'build', room: 'lobby', floor: 1, x: sx });
      notify();
    }
    if (drag.kind === 'shaftExtend') {
      const shaft = world.shafts.get(drag.shaftId);
      if (shaft) {
        const span = extendSpan(shaft, floor);
        const grew = span.floorMin !== shaft.floorMin || span.floorMax !== shaft.floorMax;
        if (drag.touch) {
          drag = null;
          setPending({ floor: span.floorMin, x: shaft.x, ...span, shaftId: shaft.id });
        } else if (grew) {
          // A click that reached nowhere is a click on an elevator: nothing to do, nothing to say.
          api.apply({ kind: 'shaft.extend', shaftId: shaft.id, floorMin: span.floorMin, floorMax: span.floorMax });
        }
      }
    }
    if (drag?.kind === 'shaft' && tool.kind === 'shaft') {
      const floorMin = Math.min(drag.floor, floor);
      const floorMax = Math.max(drag.floor, floor);
      // The same two steps as a room on touch: the span the finger drew is parked, not built.
      if (drag.touch) {
        const dragX = drag.x;
        drag = null;
        // A tap that never moved still parks a legal elevator, so the outline opens green.
        const span = floorMin === floorMax ? twoFloorSpan(floorMin) : { floorMin, floorMax };
        setPending({ floor: span.floorMin, x: dragX, ...span });
      } else {
        api.apply({ kind: 'shaft.build', shaft: tool.shaft, x: drag.x, floorMin, floorMax });
      }
    }
    drag = null;
    ghostFor(floor, x);
  }

  const api: Game = {
    get world() {
      return world;
    },
    apply(cmd: Command): CommandResult {
      if (dailyOver()) return { ok: false, reason: DAILY_OVER_REASON };
      const res = applyAndRecord(world, cmd);
      if (res.ok) {
        markDirty();
        // A paused clock crosses no autosave boundary, so a build while paused saves on its own.
        if (speed === 0) saveWhenIdle();
      }
      if (!res.ok) logEvent(world, res.reason, 'warn');
      else followBuild(cmd);
      if (res.ok && eventListeners.size > 0 && isBuildCommand(cmd.kind)) emit({ kind: 'build', command: cmd.kind });
      if (!res.ok && eventListeners.size > 0) emit({ kind: 'refused', command: cmd.kind });
      drainEvents();
      notify();
      return res;
    },
    canBuildAt(t, floor, x) {
      if (t.kind === 'room') return canBuild(world, t.room, floor, x);
      if (t.kind === 'shaft') return canBuildShaft(world, t.shaft, x, floor, Math.min(floor + 1, LIMITS.maxFloor));
      return { ok: true };
    },
    setTool(t) {
      tool = t;
      drag = null;
      press = null;
      pending = null; // a new tool in hand is a new choice: the parked outline goes with the old one
      renderer?.setGhost(null);
      // Dragging pans with every tool in hand, except the two whose drag is the build itself.
      renderer?.setToolOwnsDrag(toolOwnsDrag(t));
      notify();
    },
    getTool: () => tool,
    setSpeed(s) {
      if (dailyOver() || (dailyChoice && s > 0)) return; // the result card or the choice stands
      // Pausing is a natural moment to step away: save what moved.
      if (s === 0 && speed !== 0 && dirty) saveWhenIdle();
      speed = s;
      if (s > 0) speedBeforePause = s;
      notify();
    },
    getSpeed: () => speed,
    togglePause() {
      api.setSpeed(speed === 0 ? speedBeforePause : 0);
    },
    select(sel) {
      selection = sel;
      renderer?.setSelection(sel);
      notify();
    },
    getSelection: () => selection,
    getHover: () => hover,
    canExtend(shaftId, floorMin, floorMax) {
      return canExtendShaft(world, shaftId, floorMin, floorMax);
    },
    getPlacement(): Placement | null {
      if (pending) return placementFor(pending, true);
      if (!hover) return null;
      // A drag that started inside a shaft is stretching that shaft, whatever the pointer is.
      if (drag?.kind === 'shaftExtend') {
        const shaft = world.shafts.get(drag.shaftId);
        if (!shaft) return null;
        return placementFor({ x: shaft.x, ...extendSpan(shaft, hover.floor), shaftId: shaft.id }, false);
      }
      // The hover ghost, including the span a mouse is dragging an elevator across.
      const dragging = drag?.kind === 'shaft' && tool.kind === 'shaft' ? drag : null;
      const floorMin = dragging ? Math.min(dragging.floor, hover.floor) : hover.floor;
      const floorMax = dragging ? Math.max(dragging.floor, hover.floor) : hover.floor;
      return placementFor({ x: dragging ? dragging.x : hover.x, floorMin, floorMax }, false);
    },
    getPlacementRect(): PlacementRect | null {
      return renderer?.ghostScreenRect() ?? null;
    },
    nudgePending(dx, dFloor) {
      if (!pending) return;
      // An extension is anchored to the elevator it grows from: it slides up and down, never
      // sideways, and never lets go of the floors the shaft already serves.
      if (pending.shaftId !== undefined) {
        api.resizePending(dFloor > 0 ? dFloor : 0, dFloor < 0 ? -dFloor : 0);
        return;
      }
      const span = bandOf(pending.floorMax) - bandOf(pending.floorMin);
      // Move the band, then put the span back on it, so a placement never grows by sliding.
      const bandMin = Math.max(BAND_MIN, Math.min(bandOf(pending.floorMin) + dFloor, BAND_MAX - span));
      const floorMin = floorOfBand(bandMin);
      const floorMax = floorOfBand(bandMin + span);
      setPending({ floor: floorMin, x: clampTileX(pending.x + dx), floorMin, floorMax });
    },
    resizePending(dTop, dBottom) {
      if (!pending) return;
      const extending = pending.shaftId !== undefined ? world.shafts.get(pending.shaftId) : undefined;
      if (!extending && tool.kind !== 'shaft') return; // a room is the size its rule says
      // Each end stops at the other: shrinking the top never drags the bottom down with it.
      let bandMax = Math.max(bandOf(pending.floorMin), clampBand(bandOf(pending.floorMax) + dTop));
      let bandMin = Math.min(bandMax, clampBand(bandOf(pending.floorMin) - dBottom));
      // An extension only ever grows: the floors the shaft already serves are not up for debate.
      if (extending) {
        bandMax = Math.max(bandMax, bandOf(extending.floorMax));
        bandMin = Math.min(bandMin, bandOf(extending.floorMin));
      }
      const floorMin = floorOfBand(bandMin);
      const floorMax = floorOfBand(bandMax);
      setPending({
        floor: floorMin,
        x: pending.x,
        floorMin,
        floorMax,
        ...(pending.shaftId === undefined ? {} : { shaftId: pending.shaftId }),
      });
    },
    confirmPending(): CommandResult {
      if (!pending) return { ok: false, reason: 'Pick a spot to build first.' };
      const at = pending;
      const cmd: Command | null = at.shaftId !== undefined
        ? { kind: 'shaft.extend', shaftId: at.shaftId, floorMin: at.floorMin, floorMax: at.floorMax }
        : tool.kind === 'room'
          ? { kind: 'build', room: tool.room, floor: at.floor, x: at.x }
          : tool.kind === 'shaft'
            ? { kind: 'shaft.build', shaft: tool.shaft, x: at.x, floorMin: at.floorMin, floorMax: at.floorMax }
            : null;
      if (!cmd) {
        clearPending();
        return { ok: false, reason: 'Pick a spot to build first.' };
      }
      const res = api.apply(cmd); // apply logs the refusal, so a failure keeps the outline up
      if (res.ok) clearPending();
      else showPendingGhost();
      return res;
    },
    cancelPending() {
      clearPending();
    },
    save() {
      // The player pressed Save, so this one logs; in a held My tower it is also the player
      // choosing the new tower over the save that would not open.
      if (slot === 'mine') mineHeld = false;
      return saveWorld('player');
    },
    async load() {
      const name = slot;
      const text = await readFrom(name);
      if (!text) return { ok: false, reason: 'There is no saved game yet.' };
      const res = deserialize(text);
      if (!res.ok) {
        if (name === 'mine') keepUnreadable(text, res.reason);
        else {
          // Only My tower's save is copied aside: one copy slot, kept for the tower that matters.
          logEvent(world, `We could not open this saved tower. ${res.reason}`, 'warn');
          notify();
        }
        return { ok: false, reason: res.reason };
      }
      swapWorld(res.world); // what is in hand is what the slot holds
      if (name === 'mine') mineHeld = false;
      notify();
      return { ok: true };
    },
    exportSave() {
      markCheckpoint(world);
      return serialize(world);
    },
    getKeptCopy: () => readUnreadable() ?? unreadableText,
    getKeptDailyCopy: () => readDailyCopy(),
    importSave(text) {
      const res = deserialize(text);
      if (!res.ok) return res;
      if (slot === 'daily') {
        // Today's tower stays today's: the daily is left first (saved if it moved) and the
        // file opens as My tower, with a running clock.
        if (dirty && lastSaveFailed) return { ok: false, reason: NOT_SAVING_NOTICE };
        if (dirty) void saveWorld('quiet', 'daily', world);
        cancelScheduledSave();
        takeSlot('mine');
        startSpeed();
      }
      swapWorld(res.world);
      markDirty(); // an opened file is not in the slot until the next save
      if (slot === 'mine') mineHeld = false; // the player chose this tower over a held save
      notify();
      return { ok: true };
    },
    getSlot: () => slot,
    getDaily(): DailyInfo | null {
      const date = dailyDate();
      if (date === null) return null;
      const twist = dailyTwist(date);
      return { date, twist: { name: twist.name, line: twist.line }, endMinute: DAILY_END_MINUTE, finished: dailyFinished(world) };
    },
    getDailyChoice: () => dailyChoice,
    openDaily: () =>
      switching(async () => {
        const today = time.today();
        if (slot === 'daily' && dailyDate() === today && !dailyChoice) return;
        if (!(await readyToLeave('daily'))) return;
        const read = await readWorld('daily');
        const saved = read.world;
        takeSlot('daily');
        const savedDate = saved ? dateOfMode(buildLogOf(saved).mode) : null;
        const opening = dailyOpening(saved && savedDate !== null ? { date: savedDate, finished: dailyFinished(saved) } : null, today);
        if (opening === 'fresh' || !saved || savedDate === null) {
          await beginToday(today);
          return;
        }
        swapWorld(saved);
        if (opening === 'choose' || opening === 'ahead') {
          // The saved tower stands, stopped, behind the choice. One dated after today (the
          // device's date moved back) is never replaced without the player's say.
          speed = 0;
          const ahead = opening === 'ahead';
          if (ahead) aheadText = read.text;
          dailyChoice = { savedDate, today, yesterday: !ahead && previousDateKey(today) === savedDate, ahead };
        } else if (dailyFinished(saved)) speed = 0;
        else startSpeed();
        notify();
      }),
    async chooseDaily(which) {
      const choice = dailyChoice;
      if (!choice) return;
      if (which === 'finish') {
        dailyChoice = null;
        aheadText = null;
        if (dailyFinished(world)) speed = 0; // a finished one stays on its result
        else startSpeed();
        notify();
        return;
      }
      // Start today's instead: a tower dated after today is copied aside first, or it stays.
      if (choice.ahead && (aheadText === null || !keepDailyCopy(aheadText))) {
        logEvent(world, DAILY_COPY_FAILED, 'warn');
        drainEvents();
        notify();
        return;
      }
      dailyChoice = null;
      aheadText = null;
      await beginToday(choice.today);
    },
    openFriend: (friendSeed) =>
      switching(async () => {
        if (!(await readyToLeave('friend'))) return;
        // The same link opened again goes on with the tower it started; another link starts over.
        const saved = (await readWorld('friend')).world;
        takeSlot('friend');
        if (saved && saved.seed === friendSeed) swapWorld(saved);
        else {
          freshTower(friendSeed);
          await saveWorld('quiet');
        }
        startSpeed();
        notify();
      }),
    openMyTower: () =>
      switching(async () => {
        if (!(await readyToLeave('mine'))) return;
        const read = await readWorld('mine');
        takeSlot('mine');
        if (read.world) {
          swapWorld(read.world);
          mineHeld = false;
        } else {
          freshTower(time.freshSeed());
          // A save that is there but will not open is kept, never written over: the same as boot.
          if (read.text !== null) keepUnreadable(read.text, read.reason);
          else {
            mineHeld = false; // nothing there any more to keep
            await saveWorld('quiet');
          }
        }
        startSpeed();
        notify();
      }),
    newGame(newSeed) {
      world = createWorld(newSeed);
      startBuildLog(world);
      dailyChoice = null;
      primeTap(tap, world);
      selection = null;
      renderer?.resetMotion();
      tool = { kind: 'none' };
      pending = null;
      renderer?.setSelection(null);
      renderer?.setGhost(null);
      // The opening shot again: the middle of the lot, street on the chrome's free band.
      renderer?.camera.reset();
      notify();
      void api.save(); // the autosave slot must not resurrect the old tower on the next reload
    },
    setReducedMotion(on) {
      reducedMotion = on;
      renderer?.setReducedMotion(on);
    },
    setChrome(topPx, bottomPx) {
      chrome = { top: topPx, bottom: bottomPx };
      renderer?.setChrome(topPx, bottomPx);
    },
    subscribe(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    subscribeEvents(listener) {
      if (eventListeners.size === 0) primeTap(tap, world); // what happened while nobody listened is not news
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
    attach(r, el) {
      renderer = r;
      container = el;
      r.setReducedMotion(reducedMotion);
      r.onPick((hit) => {
        if (tool.kind === 'demolish') {
          if (hit.roomId !== undefined) api.apply({ kind: 'demolish', roomId: hit.roomId });
          else if (hit.shaftId !== undefined) api.apply({ kind: 'shaft.demolish', shaftId: hit.shaftId });
          return;
        }
        if (tool.kind === 'query' || tool.kind === 'none') {
          const sel = hit.simId !== undefined ? { simId: hit.simId } : hit.roomId !== undefined ? { roomId: hit.roomId } : hit.shaftId !== undefined ? { shaftId: hit.shaftId } : null;
          api.select(sel);
        }
      });
      el.addEventListener('pointerdown', onPointerDown);
      el.addEventListener('pointermove', onPointerMove);
      el.addEventListener('pointerup', onPointerUp);
      el.addEventListener('pointercancel', (ev: PointerEvent) => {
        pointers.delete(ev.pointerId);
        abandonPress();
      });
      el.addEventListener('pointerleave', () => {
        hover = null;
        press = null;
        if (pending) showPendingGhost();
        else renderer?.setGhost(null);
      });
      r.setToolOwnsDrag(toolOwnsDrag(tool));
      // A ui that measured the chrome before the renderer existed still gets its band.
      if (chrome) r.setChrome(chrome.top, chrome.bottom);
      // The opening shot: the middle of the lot, with the street low enough to leave the sky
      // room to fill, inside whatever band the chrome leaves free. On a phone the palette is
      // a bottom sheet across the lower half, and floor 1, the only place a lobby can go,
      // would otherwise open behind it.
      r.camera.reset();
    },
    stepOnce() {
      step();
    },
    frameOnce() {
      drawFrame();
    },
    accumulator: () => loop.accumulator,
    start() {
      if (raf) return;
      last = time.now();
      timer = window.setInterval(step, 50);
      raf = requestAnimationFrame(frame);
      document.addEventListener('visibilitychange', onVisibilityChange);
      if (typeof window.addEventListener === 'function') window.addEventListener('pagehide', onPageHide);
    },
    stop() {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (typeof window.removeEventListener === 'function') window.removeEventListener('pagehide', onPageHide);
      cancelAnimationFrame(raf);
      window.clearInterval(timer);
      cancelScheduledSave();
      raf = 0;
      timer = 0;
    },
  };
  return api;
}
