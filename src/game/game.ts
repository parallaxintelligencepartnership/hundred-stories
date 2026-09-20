// The game shell: owns the world, the clock loop, the active tool, pointer input on the tower view, and saves.
import { applyCommand, canBuild, canBuildShaft, canExtendShaft } from '../sim/build';
import { LIMITS, ROOMS, SHAFTS } from '../sim/rules';
import { deserialize, serialize } from '../sim/save';
import { tick } from '../sim/tick';
import { clockOf, type Command, type CommandResult, type Id, type Shaft, type World } from '../sim/types';
import { createWorld } from '../sim/world';
import { SCHEDULES } from '../sim/rules';
import { classifyPress, isTap, PRESS_SLOP_PX, TOUCH_SLOP_PX } from '../render/input';
import type { Renderer } from '../render/renderer';
import type { GameApi, Placement, PlacementRect, Speed, Tool } from './api';
import { readSave, stashUnreadable, writeSave } from './storage';

const TICKS_PER_SECOND_AT_1X = 10;
const NIGHT_MULTIPLIER = 8;
const MAX_TICKS_PER_FRAME = 240;

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

export interface Game extends GameApi {
  attach(renderer: Renderer, container: HTMLElement): void;
  start(): void;
  stop(): void;
}

export function createGame(seed: number): Game {
  let world: World = createWorld(seed);
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
  let accumulator = 0;
  const subscribers = new Set<() => void>();
  const notify = () => subscribers.forEach((cb) => cb());

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

  // The sim is driven by a timer, not by requestAnimationFrame, so it keeps running when the tab is
  // hidden (Chrome pauses rAF in background tabs). Rendering stays on rAF.
  function step(): void {
    const now = performance.now();
    const dt = Math.min(1, (now - last) / 1000 || 0);
    last = now;
    if (speed > 0 && !world.gameOver) {
      const rate = TICKS_PER_SECOND_AT_1X * speed * (isNight() ? NIGHT_MULTIPLIER : 1);
      accumulator += dt * rate;
      const minuteBefore = world.time.minute;
      let n = 0;
      while (accumulator >= 1 && n < MAX_TICKS_PER_FRAME) {
        tick(world);
        accumulator -= 1;
        n++;
      }
      if (accumulator > MAX_TICKS_PER_FRAME) accumulator = 0;
      if (n > 0) {
        notify();
        maybeAutosave(minuteBefore, world.time.minute);
      }
    }
  }

  // One save per batch of ticks, and never two at once: a burst of ticks that crosses several
  // boundaries, or a slow write still in flight, must not pile up writes.
  let autosaveInFlight = false;
  function maybeAutosave(prevMinute: number, nextMinute: number): void {
    if (autosaveInFlight) return;
    if (!shouldAutosave(prevMinute, nextMinute)) return;
    autosaveInFlight = true;
    // An autosave is silent, success or failure: the player did not ask for it.
    void saveWorld(true).finally(() => {
      autosaveInFlight = false;
    });
  }

  async function saveWorld(quiet: boolean): Promise<CommandResult> {
    try {
      await writeSave(serialize(world));
      if (!quiet) {
        world.log.push({ minute: world.time.minute, text: 'Game saved.', level: 'info' });
        notify();
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : 'Could not save.' };
    }
  }

  function frame(): void {
    raf = requestAnimationFrame(frame);
    // Interpolate against real time since the last timer step so sprites glide at the display rate
    // instead of stepping at the timer rate.
    const elapsed = speed > 0 && !world.gameOver ? (performance.now() - last) / 1000 : 0;
    const rate = TICKS_PER_SECOND_AT_1X * speed * (isNight() ? NIGHT_MULTIPLIER : 1);
    renderer?.render(world, Math.min(1, accumulator + elapsed * rate));
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
    renderer.setGhost({
      widthTiles: shaft ? shaft.width : toolWidth(),
      heightFloors,
      floor: placement.floorMin,
      x: placement.x,
      ok: placement.ok,
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
      renderer.setGhost({ widthTiles: rule.width, heightFloors: floorMax - floorMin + 1, floor: floorMin, x: sx, ok: res.ok });
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
      applyCommand(world, { kind: 'build', room: 'lobby', floor: 1, x });
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
      for (let sx = from; sx <= to; sx++) applyCommand(world, { kind: 'build', room: 'lobby', floor: 1, x: sx });
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
      for (let sx = from; sx <= to; sx++) applyCommand(world, { kind: 'build', room: 'lobby', floor: 1, x: sx });
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
      const res = applyCommand(world, cmd);
      if (!res.ok) world.log.push({ minute: world.time.minute, text: res.reason, level: 'warn' });
      else followBuild(cmd);
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
      if (!pending) return { ok: false, reason: 'There is nothing waiting to be built.' };
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
        return { ok: false, reason: 'There is nothing waiting to be built.' };
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
      return saveWorld(false); // the player pressed Save, so this one logs
    },
    async load() {
      const text = await readSave();
      if (!text) return { ok: false, reason: 'There is no saved game yet.' };
      const res = deserialize(text);
      if (!res.ok) {
        stashUnreadable(text);
        world.log.push({
          minute: world.time.minute,
          text: `Your saved tower could not be read: ${res.reason} A copy is kept in this browser. Starting a fresh lot.`,
          level: 'warn',
        });
        notify();
        return { ok: false, reason: res.reason };
      }
      return api.importSave(text);
    },
    exportSave: () => serialize(world),
    importSave(text) {
      const res = deserialize(text);
      if (!res.ok) return res;
      world = res.world;
      selection = null;
      renderer?.setSelection(null);
      notify();
      return { ok: true };
    },
    newGame(newSeed) {
      world = createWorld(newSeed);
      selection = null;
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
    start() {
      if (raf) return;
      last = performance.now();
      timer = window.setInterval(step, 50);
      raf = requestAnimationFrame(frame);
    },
    stop() {
      cancelAnimationFrame(raf);
      window.clearInterval(timer);
      raf = 0;
      timer = 0;
    },
  };
  return api;
}
