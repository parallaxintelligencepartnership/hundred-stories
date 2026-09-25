// Venue identity: which treatment an office, shop or restaurant is drawn in, the brand on its
// sign, and its accent colour. A pure function of the tower seed and the room id, so the sign in
// the world and the name in the room panel always agree, across saves, with nothing stored.
// Never reads or advances world.rng. See docs/VISUAL.md (venues) and the package 2 spec.

import { SCHEDULES } from '../sim/rules';
import { clockOf, type Id, type RoomKind } from '../sim/types';

export type VenueKind = 'office' | 'shop' | 'restaurant';
export const VENUE_KINDS: readonly VenueKind[] = ['office', 'shop', 'restaurant'];

export function isVenueKind(kind: RoomKind): kind is VenueKind {
  return kind === 'office' || kind === 'shop' || kind === 'restaurant';
}

/** Three treatments per kind, by fixtures, posters, window display and desk arrangement. */
export type Treatment = 0 | 1 | 2;
export const TREATMENTS = 3;

export interface Venue {
  treatment: Treatment;
  /** The brand on the sign; empty for an office, which has no sign. */
  name: string;
  /** The accent colour of the sign, the awning and the posters. */
  accent: number;
}

/** What each treatment is, in the room panel's words. */
export const TREATMENT_LABELS: Record<VenueKind, readonly [string, string, string]> = {
  office: ['design studio', 'finance office', 'creative agency'],
  shop: ['boutique', 'bookshop', 'grocer'],
  restaurant: ['bistro', 'noodle bar', 'grill'],
};

/**
 * 24 plausible fictional names per kind with a sign, eight per treatment, so a grocer is never
 * called something that sounds like a bookshop. All invented; none is a real chain.
 */
export const VENUE_NAMES: Record<'shop' | 'restaurant', readonly string[]> = {
  shop: [
    // boutique
    'Juniper & Co.', 'Hollis Row', 'Marlow Studio', 'Thread & Pin', 'Vela Boutique', 'Linden Lane', 'Ashby Supply', 'Cortland Goods',
    // bookshop
    'Paper Lantern', 'Folio House', 'Wren Books', 'Inkwell', 'Tallow & Twine', 'Kite Books', 'Margin Notes', 'Bluebell Books',
    // grocer
    'Greenleaf Market', 'Corner Crate', 'Harvest Pantry', 'Olive & Oat', 'Fig Street', 'Daily Basket', 'Orchard Row', 'Plum Market',
  ],
  restaurant: [
    // bistro
    'Maison Clair', 'Le Petit Quai', 'Bistro Lune', 'Cafe Verlaine', 'Rue Orsay', 'Chez Margot', 'Bistro Sable', 'La Table Rose',
    // noodle bar
    'Kumo Noodle', 'Golden Lotus', 'Saffron Garden', 'Hana Ramen', 'Jade Terrace', 'Little Pho', 'Red Lantern', 'Tamarind',
    // grill
    'Ember & Oak', 'Copper Grill', 'Harbor Chophouse', 'Smoke & Salt', 'Hearth Kitchen', 'Iron Skillet', 'Blue Plate', 'Union Grill',
  ],
};

/** Two accents per treatment. */
export const VENUE_ACCENTS: Record<VenueKind, readonly (readonly [number, number])[]> = {
  office: [
    [0x2f7d7d, 0x3d6fb0], // studio: teal, cobalt
    [0x1f3a5f, 0x4a5a6a], // finance: navy, slate
    [0xd9643a, 0xb0417a], // creative: orange, magenta
  ],
  shop: [
    [0xb0417a, 0x6a3a97], // boutique: berry, violet
    [0x2f5c9e, 0x1f7d7d], // bookshop: blue, teal
    [0x2f7d3a, 0xd28c1f], // grocer: green, amber
  ],
  restaurant: [
    [0x8c1f3d, 0x1f3a5f], // bistro: wine, navy
    [0xc03028, 0xd9a441], // noodle bar: red, gold
    [0x6b4420, 0x2b3f3a], // grill: walnut, forest
  ],
};

/** The same 32-bit mix as src/sim/identity.ts, copied so the renderer owns its own hash. */
export function mix(a: number, b: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ b, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

const KIND_SALT: Record<VenueKind, number> = { office: 0x1b873593, shop: 0x27d4eb2d, restaurant: 0x165667b1 };

/**
 * A venue's treatment, name and accent: a pure function of the seed, the room id and the kind.
 * Stable across calls and saves (the id and seed are saved; nothing else is read).
 */
export function venueOf(seed: number, roomId: Id, kind: VenueKind): Venue {
  const h = mix((seed | 0) ^ KIND_SALT[kind], Math.trunc(roomId));
  const treatment = (h % TREATMENTS) as Treatment;
  const accents = VENUE_ACCENTS[kind][treatment] as readonly [number, number];
  const accent = accents[(h >>> 8) & 1] as number;
  if (kind === 'office') return { treatment, name: '', accent };
  const names = VENUE_NAMES[kind];
  const perTreatment = names.length / TREATMENTS;
  const name = names[treatment * perTreatment + ((h >>> 12) % perTreatment)] as string;
  return { treatment, name, accent };
}

/** The index of a venue's name in its kind's list, for a texture key. -1 for an office. */
export function venueNameIndex(kind: VenueKind, name: string): number {
  return kind === 'office' ? -1 : VENUE_NAMES[kind].indexOf(name);
}

/**
 * Whether a venue keeps its doors open at `minute`, from the schedules the sim already runs:
 * offices during the working day on weekdays, shops over shopping hours, restaurants from the
 * start of lunch to the end of dinner. Closed venues show a shutter or drawn blinds.
 */
export function venueOpen(kind: VenueKind, minute: number): boolean {
  const clock = clockOf(minute);
  const m = clock.minuteOfDay;
  if (kind === 'office') return !clock.isWeekend && m >= SCHEDULES.worker.arriveStart && m < SCHEDULES.worker.leaveEnd;
  if (kind === 'shop') return m >= SCHEDULES.shopper.open && m < SCHEDULES.shopper.close;
  return m >= SCHEDULES.diner.lunchStart && m < SCHEDULES.diner.dinnerEnd;
}

/** The room panel's line for a venue: "Juniper & Co., a boutique" or "A finance office". */
export function venueLine(kind: VenueKind, venue: Venue): string {
  const label = TREATMENT_LABELS[kind][venue.treatment];
  if (!venue.name) return `A ${label}`;
  return `${venue.name}, a ${label}`;
}
