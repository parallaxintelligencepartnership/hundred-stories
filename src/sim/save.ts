import type { World } from './types';
export const SAVE_VERSION = 1;
export function serialize(_world: World): string { return ''; }
export function deserialize(_text: string): { ok: true; world: World } | { ok: false; reason: string } { return { ok: false, reason: 'Not implemented.' }; }
export function hashWorld(_world: World): string { return ''; }
