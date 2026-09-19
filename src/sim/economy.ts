import type { CommandResult, Room, World } from './types';
export function spend(_world: World, _amount: number, _what: string): CommandResult { return { ok: false, reason: 'Not implemented.' }; }
export function onQuarterStart(_world: World): void {}
export function recordVisit(_world: World, _room: Room): void {}
export function recordHotelNight(_world: World, _room: Room): void {}
export function recordCondoSale(_world: World, _room: Room): void {}
