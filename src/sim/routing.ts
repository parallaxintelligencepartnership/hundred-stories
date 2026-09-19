import type { Leg, World } from './types';
export function ensureRouting(_world: World): void {}
export function findRoute(_world: World, _from: { floor: number; x: number }, _to: { floor: number; x: number }, _opts?: { staff?: boolean }): Leg[] | null { return null; }
export function isReachableFromLobby(_world: World, _floor: number, _x: number): boolean { return false; }
export function entrances(_world: World): { floor: number; x: number }[] { return []; }
