// The game shell: owns the world, the clock loop, the active tool, pointer input on the tower view, and saves.
import { applyCommand, canBuild, canBuildShaft } from '../sim/build';
import { LIMITS, ROOMS, SHAFTS } from '../sim/rules';
import { deserialize, serialize } from '../sim/save';
import { tick } from '../sim/tick';
import { clockOf, type Command, type CommandResult, type Id, type World } from '../sim/types';
import { createWorld } from '../sim/world';
import { SCHEDULES } from '../sim/rules';
import type { Renderer } from '../render/renderer';
import type { GameApi, Speed, Tool } from './api';
import { readSave, writeSave } from './storage';

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
  let renderer: Renderer | null = null;
  let container: HTMLElement | null = null;
  let raf = 0;
  let timer = 0;
  let last = 0;
  let accumulator = 0;
  const subscribers = new Set<() => void>();
  const notify = () => subscribers.forEach((cb) => cb());

  // Drag state for lobby segments (horizontal) and shafts (vertical).
  let drag: null | { floor: number; x: number; kind: 'lobby' | 'shaft' } = null;
  let hover: { floor: number; x: number } | null = null;

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

  function ghostFor(floor: number, x: number): void {
    if (!renderer) return;
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
    if (!renderer || !container || ev.button !== 0) return;
    const { floor, x } = renderer.screenToTile(ev.offsetX, ev.offsetY);
    if (tool.kind === 'room' && tool.room === 'lobby') {
      drag = { floor, x, kind: 'lobby' };
      applyCommand(world, { kind: 'build', room: 'lobby', floor: 1, x });
      notify();
    } else if (tool.kind === 'shaft') drag = { floor, x, kind: 'shaft' };
    else if (tool.kind === 'room') api.apply({ kind: 'build', room: tool.room, floor, x });
    ghostFor(floor, x);
  }

  function onPointerMove(ev: PointerEvent): void {
    if (!renderer) return;
    const { floor, x } = renderer.screenToTile(ev.offsetX, ev.offsetY);
    hover = { floor, x };
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
    if (!renderer || !drag) return;
    const { floor, x } = renderer.screenToTile(ev.offsetX, ev.offsetY);
    if (drag.kind === 'lobby') {
      const from = Math.min(drag.x, x);
      const to = Math.max(drag.x, x);
      for (let sx = from; sx <= to; sx++) applyCommand(world, { kind: 'build', room: 'lobby', floor: 1, x: sx });
      notify();
    }
    if (drag.kind === 'shaft' && tool.kind === 'shaft') {
      const floorMin = Math.min(drag.floor, floor);
      const floorMax = Math.max(drag.floor, floor);
      api.apply({ kind: 'shaft.build', shaft: tool.shaft, x: drag.x, floorMin, floorMax });
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
      renderer?.setGhost(null);
      renderer?.setPanEnabled(t.kind === 'none' || t.kind === 'query');
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
    save() {
      return saveWorld(false); // the player pressed Save, so this one logs
    },
    async load() {
      const text = await readSave();
      if (!text) return { ok: false, reason: 'There is no saved game yet.' };
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
      renderer?.setSelection(null);
      renderer?.setGhost(null);
      renderer?.camera.centerOn(3, LIMITS.towerWidth / 2);
      notify();
      void api.save(); // the autosave slot must not resurrect the old tower on the next reload
    },
    setReducedMotion(on) {
      reducedMotion = on;
      renderer?.setReducedMotion(on);
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
      el.addEventListener('pointerleave', () => {
        hover = null;
        renderer?.setGhost(null);
      });
      r.camera.centerOn(3, LIMITS.towerWidth / 2);
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
