// The surface the UI talks to. Implemented by game/game.ts; the UI never touches the sim modules directly.
import type { Command, CommandResult, Id, RoomKind, ShaftKind, World } from '../sim/types';

export type Tool =
  | { kind: 'none' }
  | { kind: 'room'; room: RoomKind }
  | { kind: 'shaft'; shaft: ShaftKind }
  | { kind: 'demolish' }
  | { kind: 'query' };

export type Speed = 0 | 1 | 2 | 4;

export interface GameApi {
  readonly world: World;
  apply(cmd: Command): CommandResult;
  canBuildAt(tool: Tool, floor: number, x: number): CommandResult;
  setTool(tool: Tool): void;
  getTool(): Tool;
  setSpeed(speed: Speed): void;
  getSpeed(): Speed;
  togglePause(): void;
  select(sel: null | { roomId?: Id; simId?: Id; shaftId?: Id }): void;
  getSelection(): null | { roomId?: Id; simId?: Id; shaftId?: Id };
  getHover(): { floor: number; x: number } | null; // tile under the pointer on the tower view
  save(): Promise<CommandResult>;
  load(): Promise<CommandResult>;
  exportSave(): string;
  importSave(text: string): CommandResult;
  newGame(seed: number): void;
  setReducedMotion(on: boolean): void;
  /**
   * How many screen pixels the chrome covers at the top and the bottom of the view.
   *
   * The ui measures its own strips; the game passes them to the renderer, and remembers
   * them for a ui that measured before the renderer attached.
   */
  setChrome(topPx: number, bottomPx: number): void;
  subscribe(cb: () => void): () => void; // called after each tick batch and on any state change
}
