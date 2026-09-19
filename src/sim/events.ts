import type { Command, CommandResult, World } from './types';
export function tickEvents(_world: World): void {}
export function handleEventCommand(_world: World, _cmd: Extract<Command, { kind: 'bomb.pay' | 'fire.callHelicopter' }>): CommandResult { return { ok: false, reason: 'Not implemented.' }; }
