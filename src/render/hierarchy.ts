// Visual hierarchy by zoom (package 2, item 6): occupied rooms lead, repetition recedes.
//
// full, zoom 0.75 and up: everything as drawn.
// muted, zoom below 0.75: the repeating window band and the stair and escalator diagonals are
//   muted by 20 percent, so the rooms with people in them lead.
// blocks, zoom below 0.5: every room is a flat block in its category colour with a 1 px outline
//   and its occupancy as a lighter fill level. No furniture, no people but the selected one.
// Selection and emergency overlays (fire, the ghost, the information views) are drawn at full
// strength at every zoom. Pure: no pixi, so the plan is testable without a GPU.

import { ROOMS } from '../sim/rules';
import type { Room } from '../sim/types';

export const MUTE_BELOW_ZOOM = 0.75;
export const BLOCKS_BELOW_ZOOM = 0.5;
/** How much the window band and the connectors are muted below MUTE_BELOW_ZOOM. */
export const MUTE_AMOUNT = 0.2;

export type ZoomTier = 'full' | 'muted' | 'blocks';

export function zoomTier(zoom: number): ZoomTier {
  if (zoom < BLOCKS_BELOW_ZOOM) return 'blocks';
  if (zoom < MUTE_BELOW_ZOOM) return 'muted';
  return 'full';
}

export interface LayerPlan {
  /** Room shells, fixtures, signs, slabs: the drawn tower. */
  rooms: boolean;
  /** The category blocks. */
  blocks: boolean;
  /** Alpha of the wall coloured veil over each window band: 0 is no veil. */
  windowVeil: number;
  /** Alpha of the stairs and escalators. */
  connectors: number;
  /** Which people are drawn: everyone sampled, or only the selected person. */
  people: 'all' | 'selected';
  /** Shop signs blinking, restaurant steam, the curb's commuters. */
  ambient: boolean;
  /** Always 1: the selection ring, the ghost and the information views. */
  selection: 1;
  /** Always 1: fires and the emergency vehicle. */
  emergency: 1;
}

export function layerPlan(tier: ZoomTier): LayerPlan {
  if (tier === 'blocks') return { rooms: false, blocks: true, windowVeil: 0, connectors: 0, people: 'selected', ambient: false, selection: 1, emergency: 1 };
  const muted = tier === 'muted';
  return {
    rooms: true,
    blocks: false,
    windowVeil: muted ? MUTE_AMOUNT : 0,
    connectors: muted ? 1 - MUTE_AMOUNT : 1,
    people: 'all',
    ambient: true,
    selection: 1,
    emergency: 1,
  };
}

/** How full a room's block is drawn: the share of its capacity inside now, 0 to 1. */
export function occupancyLevel(room: Pick<Room, 'kind' | 'occupancy'>): number {
  const capacity = ROOMS[room.kind].capacity;
  if (capacity <= 0) return room.occupancy > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, room.occupancy / capacity));
}
