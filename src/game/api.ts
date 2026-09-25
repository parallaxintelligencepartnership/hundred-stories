// The surface the UI talks to. Implemented by game/game.ts; the UI never touches the sim modules directly.
import type { Command, CommandResult, Id, RoomKind, ShaftKind, World } from '../sim/types';
import type { GameEvent, GameEventListener } from './events';
import type { SlotName } from './storage';

export type { GameEvent, GameEventListener, SlotName };

/** Today's tower as the ui sees it. */
export interface DailyInfo {
  /** YYYY-MM-DD, the player's local date it was started on. */
  date: string;
  twist: { name: string; line: string };
  /** The game minute it ends on. */
  endMinute: number;
  finished: boolean;
}

/** The choice when the daily slot holds an unfinished tower from an earlier date. */
export interface DailyChoice {
  savedDate: string;
  today: string;
  /** The saved one is from the day before today. */
  yesterday: boolean;
}

export type Tool =
  | { kind: 'none' }
  | { kind: 'room'; room: RoomKind }
  | { kind: 'shaft'; shaft: ShaftKind }
  | { kind: 'demolish' }
  | { kind: 'query' };

export type Speed = 0 | 1 | 2 | 4;

/** From 23:00 to 06:00 the clock runs this many times faster than the chosen speed. */
export const NIGHT_MULTIPLIER = 8;

/**
 * Where the tool in hand would land, priced and judged before a dollar is spent.
 *
 * A mouse gets this from the hover ghost (`pending` false). A finger gets it from the
 * pending placement a tap parks on the tower (`pending` true), which stays put until the
 * player confirms it, moves it, or drops it.
 */
export interface Placement {
  floor: number; // a room's floor; a shaft's lowest floor
  x: number;
  floorMin: number;
  floorMax: number; // equal to floorMin for a room
  ok: boolean;
  reason?: string; // why it cannot be built, in the sim's own words
  /** Set when this placement stretches a shaft that is already standing, rather than building one. */
  shaftId?: Id;
  label: string; // the palette's name for the room or shaft
  cost: number;
  pending: boolean;
}

/** The ghost's box on screen, in CSS pixels relative to the tower view. */
export interface PlacementRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GameApi {
  readonly world: World;
  /**
   * The one way a player changes the world. An accepted command is kept in the tower's build log
   * with the minute it went in (src/sim/buildlog.ts), so a save can be replayed.
   */
  apply(cmd: Command): CommandResult;
  canBuildAt(tool: Tool, floor: number, x: number): CommandResult;
  /** Could this shaft be stretched to this span? The panel asks before it offers the button. */
  canExtend(shaftId: Id, floorMin: number, floorMax: number): CommandResult;
  setTool(tool: Tool): void;
  getTool(): Tool;
  setSpeed(speed: Speed): void;
  getSpeed(): Speed;
  togglePause(): void;
  select(sel: null | { roomId?: Id; simId?: Id; shaftId?: Id }): void;
  getSelection(): null | { roomId?: Id; simId?: Id; shaftId?: Id };
  getHover(): { floor: number; x: number } | null; // tile under the pointer on the tower view
  /**
   * The placement the player is looking at: the pending one a finger parked, or the hover
   * ghost under a mouse. Null with no tool in hand, or with nothing under the pointer.
   */
  getPlacement(): Placement | null;
  /** Where that placement sits on screen, so the ui can put its chip and its bar beside it. */
  getPlacementRect(): PlacementRect | null;
  /** Move the whole pending placement. Floor 0 does not exist, so a step across it lands past it. */
  nudgePending(dx: number, dFloor: number): void;
  /** Grow or shrink a pending elevator span. A room has nothing to resize, so this does nothing. */
  resizePending(dTop: number, dBottom: number): void;
  /** Build the pending placement. On success it clears and the tool stays in hand. */
  confirmPending(): CommandResult;
  cancelPending(): void;
  save(): Promise<CommandResult>;
  load(): Promise<CommandResult>;
  exportSave(): string;
  importSave(text: string): CommandResult;
  newGame(seed: number): void;
  /** Which save slot the tower in hand lives in: My tower, Today's tower or Friend's tower. */
  getSlot(): SlotName;
  /** Today's tower in hand, or null in the other slots. */
  getDaily(): DailyInfo | null;
  /** Set while an unfinished daily from an earlier date waits for the player to pick. */
  getDailyChoice(): DailyChoice | null;
  /**
   * Open the daily slot on today's date: go on with today's tower, start it fresh, or, when the
   * slot holds an unfinished tower from an earlier date, show that one stopped and set the choice.
   * The slot being left is saved only if it moved; My tower is never rewritten by the daily.
   */
  openDaily(): Promise<void>;
  /** Answer the choice: finish the older daily, or start today's fresh. */
  chooseDaily(which: 'finish' | 'today'): Promise<void>;
  /** A friend's link: the same tower they started, in the Friend's tower slot. */
  openFriend(seed: number): Promise<void>;
  /** Back to My tower, one call: its save, or a fresh tower when there is none. */
  openMyTower(): Promise<void>;
  setReducedMotion(on: boolean): void;
  /**
   * How many screen pixels the chrome covers at the top and the bottom of the view.
   *
   * The ui measures its own strips; the game passes them to the renderer, and remembers
   * them for a ui that measured before the renderer attached.
   */
  setChrome(topPx: number, bottomPx: number): void;
  subscribe(cb: () => void): () => void; // called after each tick batch and on any state change
  /**
   * Moments rather than state: new log lines, accepted builds, rent day, star changes, car
   * doors opening and closing. Read only. Fed after each tick batch and each command; the
   * world is only compared while at least one listener is subscribed.
   */
  subscribeEvents(listener: GameEventListener): () => void;
}
