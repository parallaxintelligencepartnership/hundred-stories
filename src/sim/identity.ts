/**
 * Who a person is: a stable name, a look and a voice, derived from the tower seed and the
 * sim id alone. Pure: it never reads or advances world.rng and nothing is stored, so a save
 * from before identities existed shows the same names the moment it loads.
 *
 * The name and the voice depend on seed and id only, so a followed person who has left the
 * tower (and whose kind is no longer known) keeps their name in the story list. The kind
 * feeds the look, so a later art pass can draw from a set per role.
 */

import { EVENTS } from './rules';
import type { Sim, VipPreference } from './types';

/** The same 32-bit mix as src/game/weather.ts, copied so the sim never imports from the game. */
function mix(a: number, b: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ b, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const GIVEN: readonly string[] = [
  'Amara', 'Luis', 'Priya', 'Grace', 'Mateo', 'Hana', 'Omar', 'Leah', 'Tomas', 'Nadia',
  'Caleb', 'Rosa', 'Arjun', 'Ines', 'Marcus', 'June', 'Felix', 'Alma', 'Theo', 'Keiko',
  'Ruth', 'Samir', 'Nora', 'Wes', 'Lena', 'Andre', 'Maya', 'Owen', 'Talia', 'Ray',
  'Esme', 'Jonah', 'Farah', 'Colin', 'Bea', 'Idris', 'Carmen', 'Eli', 'Vera', 'Hugo',
];

const FAMILY: readonly string[] = [
  'Okafor', 'Reyes', 'Patel', 'Lindqvist', 'Morales', 'Tanaka', 'Haddad', 'Brennan', 'Novak', 'Castillo',
  'Whitfield', 'Nguyen', 'Abernathy', 'Kowalski', 'Delgado', 'Halvorsen', 'Osei', 'Hartley', 'Soto', 'Varga',
  'Quinlan', 'Rahman', 'Ferreira', 'Mendez', 'Holloway', 'Ibarra', 'Yoon', 'Sorensen', 'Adeyemi', 'Pruitt',
  'Marsh', 'Dunleavy', 'Kaur', 'Serrano', 'Lindgren', 'Moreau', 'Petrakis', 'Ostrowski', 'Barros', 'Kimura',
];

/** Distinct looks per role for the art to draw from. */
export const LOOK_KEYS = 8;
/** Restrained first-person voices the story lines are written in. */
export const VOICE_KEYS = 3;

const KIND_SALT: Record<Sim['kind'], number> = {
  worker: 1,
  resident: 2,
  guest: 3,
  shopper: 4,
  diner: 5,
  staff: 6,
  visitor: 7,
  vip: 8,
  guard: 9,
  thief: 10,
};

function pick<T>(list: readonly T[], u: number): T {
  return list[Math.min(list.length - 1, Math.floor(u * list.length))] as T;
}

/** A person's full name. Seed and id only, so it outlives the sim. */
export function personName(seed: number, simId: number): string {
  const given = pick(GIVEN, mix(seed | 0, simId * 2 + 1));
  const family = pick(FAMILY, mix((seed | 0) ^ 0x27d4eb2d, simId * 2));
  return `${given} ${family}`;
}

/** Which of the voices this person speaks in, 0 to VOICE_KEYS - 1. Seed and id only. */
export function personVoice(seed: number, simId: number): number {
  return Math.floor(mix((seed | 0) ^ 0x165667b1, simId) * VOICE_KEYS) % VOICE_KEYS;
}

export function personIdentity(seed: number, simId: number, kind: Sim['kind']): { name: string; lookKey: number; voiceKey: number } {
  const lookKey = Math.floor(mix((seed | 0) ^ 0x61c88647, simId * 16 + KIND_SALT[kind]) * LOOK_KEYS) % LOOK_KEYS;
  return { name: personName(seed, simId), lookKey, voiceKey: personVoice(seed, simId) };
}

/** What a VIP cares most about, in the order the hash picks from. */
export const VIP_PREFERENCES: readonly VipPreference[] = ['quick elevators', 'a clean suite', 'a quiet floor'];

/** A VIP's preference. Seed and id only, like the name, so it survives a save made before it. */
export function vipPreference(seed: number, simId: number): VipPreference {
  return pick(VIP_PREFERENCES, mix((seed | 0) ^ 0x3c6ef372, simId * 16 + KIND_SALT.vip));
}

/**
 * The hour a VIP walks in, on the hour between EVENTS.vip.arrivalHours.first and last inclusive.
 * Seed and id only, like the preference.
 */
export function vipArrivalHour(seed: number, simId: number): number {
  const { first, last } = EVENTS.vip.arrivalHours;
  const hours: number[] = [];
  for (let h = first; h <= last; h++) hours.push(h);
  return pick(hours, mix((seed | 0) ^ 0x5bd1e995, simId * 16 + KIND_SALT.vip));
}
