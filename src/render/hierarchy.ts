// Visual hierarchy by zoom (package 2, item 6): occupied rooms lead, repetition recedes.
//
// full, zoom 0.75 and up: everything as drawn, the stairs and escalators at 85 percent (D-12).
// muted, zoom below 0.75: the repeating window band and the stair and escalator diagonals are
//   muted by 20 percent, so the rooms with people in them lead.
// blocks, zoom below 0.5: the tower is a facade (design pass BB-2): each built floor a band of
//   wall with a pane per two tiles, lit where people are at night. No furniture, no people but
//   the selected one. The category blocks moved to the Districts view (overlays.ts); the
//   FAR_ZOOM_BLOCKS flag makes them the far zoom again.
// Selection and emergency overlays (fire, the ghost, the information views) are drawn at full
// strength at every zoom. Pure: no pixi, so the plan is testable without a GPU.

import { ROOMS } from '../sim/rules';
import type { Room } from '../sim/types';

export const MUTE_BELOW_ZOOM = 0.75;
export const BLOCKS_BELOW_ZOOM = 0.5;
/** How much the window band and the connectors are muted below MUTE_BELOW_ZOOM. */
export const MUTE_AMOUNT = 0.2;
/** D-12: the stairs and escalators at full zoom, a little back, so the rooms beside them lead. */
export const CONNECTOR_ALPHA_FULL = 0.85;

/** BB-2's way back: true draws the category blocks at far zoom instead of the facade. */
export const FAR_ZOOM_BLOCKS = false;

export type ZoomTier = 'full' | 'muted' | 'blocks';

export function zoomTier(zoom: number): ZoomTier {
  if (zoom < BLOCKS_BELOW_ZOOM) return 'blocks';
  if (zoom < MUTE_BELOW_ZOOM) return 'muted';
  return 'full';
}

export interface LayerPlan {
  /** Room shells, fixtures, signs, slabs: the drawn tower. */
  rooms: boolean;
  /** The category blocks (only with FAR_ZOOM_BLOCKS). */
  blocks: boolean;
  /** The far zoom facade (BB-2). */
  facade: boolean;
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

export function layerPlan(tier: ZoomTier, blocks: boolean = FAR_ZOOM_BLOCKS): LayerPlan {
  if (tier === 'blocks') return { rooms: false, blocks, facade: !blocks, windowVeil: 0, connectors: 0, people: 'selected', ambient: false, selection: 1, emergency: 1 };
  const muted = tier === 'muted';
  return {
    rooms: true,
    blocks: false,
    facade: false,
    windowVeil: muted ? MUTE_AMOUNT : 0,
    connectors: muted ? 1 - MUTE_AMOUNT : CONNECTOR_ALPHA_FULL,
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
