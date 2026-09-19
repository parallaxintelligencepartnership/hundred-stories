// Population and the star ladder. See docs/BRIEF-AGENTS.md.

import { ROOMS, STARS, type StarRule } from './rules';
import { log } from './world';
import type { Star, Stats, World } from './types';

const VIP_ORDER: Record<Stats['vipRating'], number> = { none: 0, poor: 1, fair: 2, good: 3 };

export function populationOf(world: World): number {
  let population = 0;
  for (const room of world.rooms.values()) {
    if (room.kind === 'office' && !room.vacant) {
      population += ROOMS.office.capacity;
    } else if (room.kind === 'condo' && !room.vacant) {
      population += ROOMS.condo.capacity;
    } else if (
      (room.kind === 'hotelSingle' || room.kind === 'hotelTwin' || room.kind === 'hotelSuite') &&
      room.occupancy > 0
    ) {
      population += ROOMS[room.kind].capacity;
    }
  }
  return population;
}

function meetsRequires(world: World, requires: StarRule['requires']): boolean {
  const has = (kind: 'security' | 'recycling' | 'medical' | 'metro' | 'cathedral'): boolean => {
    for (const room of world.rooms.values()) if (room.kind === kind) return true;
    return false;
  };
  if (requires.security && !has('security')) return false;
  if (requires.recycling && !has('recycling')) return false;
  if (requires.medical && !has('medical')) return false;
  if (requires.metro && !has('metro')) return false;
  if (requires.cathedral && !has('cathedral')) return false;
  if (requires.hotelSuites !== undefined) {
    let suites = 0;
    for (const room of world.rooms.values()) if (room.kind === 'hotelSuite') suites++;
    if (suites < requires.hotelSuites) return false;
  }
  if (requires.vipRating !== undefined && VIP_ORDER[world.stats.vipRating] < VIP_ORDER[requires.vipRating]) {
    return false;
  }
  if (requires.wedding && world.stats.weddingsHeld <= 0) return false;
  return true;
}

export function recomputeStars(world: World): void {
  const population = populationOf(world);
  world.population = population;
  const before = world.stars;

  // Falling is driven by population alone, and never below 1 star.
  while (world.stars > 1 && population < STARS[world.stars].population) {
    world.stars = (world.stars - 1) as Star;
  }

  // Rising is gated by population and requirements, one star at a time.
  if (world.stars < 6) {
    const next = (world.stars + 1) as Star;
    const rule = STARS[next];
    if (population >= rule.population && meetsRequires(world, rule.requires)) {
      world.stars = next;
    }
  }

  if (world.stars !== before) {
    const verb = world.stars > before ? 'Reached' : 'Fell to';
    log(world, `${verb} ${STARS[world.stars].label}.`);
  }
}
