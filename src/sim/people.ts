import type { StressBand, World } from './types';
export const WALK_TILES_PER_MINUTE = 20;
export function stressBand(_stress: number): StressBand { return 'calm'; }
export function tickPeople(_world: World): void {}
