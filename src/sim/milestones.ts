// The tower's milestones: the firsts the News panel lists under Milestones. Written by the sim
// (recomputeStars and the build command), so they are saved with the tower and a replay of the
// same commands writes the same list. Each kind is kept once: a population that dips under a
// mark and passes it again is not a second milestone.

import type { Milestone, Star, World } from './types';

/** The population marks worth a milestone, the first time the tower reaches each. */
export const POPULATION_MILESTONES: readonly number[] = [100, 500, 1_000, 5_000, 10_000, 15_000];

/** Milestones a save may carry at most; far more than the kinds that exist, so a bad file cannot bloat the panel. */
const SAVED_MAX = 64;

export function hasMilestone(world: Pick<World, 'milestones'>, kind: string): boolean {
  return (world.milestones ?? []).some((m) => m.kind === kind);
}

/** Append a milestone at the current minute, unless this kind is already on record. */
export function recordMilestone(world: World, kind: string, text: string): void {
  if (!world.milestones) world.milestones = [];
  if (hasMilestone(world, kind)) return;
  world.milestones.push({ kind, minute: world.time.minute, text });
}

export function starMilestoneText(star: Star): string {
  return star === 6 ? 'The tower reached Tower status.' : `The tower reached ${star} stars.`;
}

/** The star just gained, the first time the tower holds it. */
export function noteStarGained(world: World, star: Star): void {
  recordMilestone(world, `star:${star}`, starMilestoneText(star));
}

/**
 * The highest star this milestone list says the tower earned, or null when it records none. A
 * star once earned is never taken away (DECISIONS 2026-09-29), so a save written while stars
 * could fall loads at this star at least.
 */
export function highestStarMilestone(milestones: readonly Milestone[]): Star | null {
  let best: Star | null = null;
  for (const m of milestones) {
    const match = /^star:([1-6])$/.exec(m.kind);
    if (!match) continue;
    const star = Number(match[1]) as Star;
    if (best === null || star > best) best = star;
  }
  return best;
}

/**
 * Population moved from `before` to `after`: each mark crossed upward on this step, the first
 * time. A crossing, not a level, so a save from before milestones existed, loaded above a mark,
 * does not announce that mark as news.
 */
export function notePopulation(world: World, before: number, after: number): void {
  for (const mark of POPULATION_MILESTONES) {
    if (before < mark && after >= mark) {
      recordMilestone(world, `population:${mark}`, `Population reached ${mark.toLocaleString('en-US')}.`);
    }
  }
}

/** A metro station was just built: the first one is a milestone. */
export function noteMetroBuilt(world: World): void {
  recordMilestone(world, 'metro', 'The first metro station opened.');
}

/** A save's milestones, or an empty list: malformed entries are dropped, never a reason to refuse the file. */
export function sanitizeMilestones(raw: unknown): Milestone[] {
  if (!Array.isArray(raw)) return [];
  const out: Milestone[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const { kind, minute, text } = item as Record<string, unknown>;
    if (typeof kind !== 'string' || typeof text !== 'string') continue;
    if (typeof minute !== 'number' || !Number.isFinite(minute) || minute < 0) continue;
    if (out.some((m) => m.kind === kind)) continue;
    out.push({ kind, minute, text });
    if (out.length >= SAVED_MAX) break;
  }
  return out;
}
