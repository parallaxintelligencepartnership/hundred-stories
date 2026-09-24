/**
 * Story beats are presentation state: never read by tick, never in the hash projection.
 * Package 1 attaches this as world.story and persists it in save v4.
 */

export type BeatCode =
  | 'wait.long'
  | 'trip.gaveUp'
  | 'trip.arrived'
  | 'room.vacated'
  | 'fire.started'
  | 'fire.resolved'
  | 'bomb.started'
  | 'bomb.resolved'
  | 'bomb.failed'
  | 'vip.notice'
  | 'vip.arrival'
  | 'vip.rated'
  | 'star.gained'
  | 'star.lost';

/** One recorded transition. value: wait.long = wait minutes; trip.arrived = trip minutes; vip.rated = 0 poor, 1 fair, 2 good; star.* = the new star number. */
export interface StoryBeat {
  code: BeatCode;
  minute: number;
  simId?: number;
  roomId?: number;
  value?: number;
}

export const STORY_RECENT_CAP = 256;
export const STORY_FOLLOWED_CAP = 8;
export const STORY_THREAD_CAP = 6;

export interface StoryState {
  seq: number;
  recent: StoryBeat[];
  followed: number[];
  threads: Record<number, StoryBeat[]>;
}

export function createStoryState(): StoryState {
  return { seq: 0, recent: [], followed: [], threads: {} };
}

export function recordBeat(story: StoryState, beat: StoryBeat): void {
  story.seq += 1;
  story.recent.push(beat);
  if (story.recent.length > STORY_RECENT_CAP) {
    story.recent.shift();
  }
  if (beat.simId !== undefined && story.followed.includes(beat.simId)) {
    const thread = story.threads[beat.simId];
    if (thread) {
      thread.push(beat);
      if (thread.length > STORY_THREAD_CAP) {
        thread.shift();
      }
    }
  }
}

export function followSim(story: StoryState, simId: number): boolean {
  if (story.followed.includes(simId)) {
    return true;
  }
  if (story.followed.length >= STORY_FOLLOWED_CAP) {
    return false;
  }
  story.followed.push(simId);
  story.threads[simId] = [];
  return true;
}

export function unfollowSim(story: StoryState, simId: number): void {
  const idx = story.followed.indexOf(simId);
  if (idx !== -1) {
    story.followed.splice(idx, 1);
  }
  delete story.threads[simId];
}
