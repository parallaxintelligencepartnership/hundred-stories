import type { Command, CommandResult, RoomKind, ShaftKind, World } from './types';
export function applyCommand(_world: World, _cmd: Command): CommandResult { return { ok: false, reason: 'Not implemented.' }; }
export function canBuild(_world: World, _kind: RoomKind, _floor: number, _x: number): CommandResult { return { ok: false, reason: 'Not implemented.' }; }
export function canBuildShaft(_world: World, _kind: ShaftKind, _x: number, _floorMin: number, _floorMax: number): CommandResult { return { ok: false, reason: 'Not implemented.' }; }
