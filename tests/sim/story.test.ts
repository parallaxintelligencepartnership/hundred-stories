import { describe, expect, it } from 'vitest';
import {
  createStoryState,
  followSim,
  recordBeat,
  STORY_FOLLOWED_CAP,
  STORY_RECENT_CAP,
  STORY_THREAD_CAP,
  unfollowSim,
} from '../../src/sim/story';

describe('story', () => {
  it('caps recent at STORY_RECENT_CAP', () => {
    const story = createStoryState();
    for (let i = 0; i < STORY_RECENT_CAP + 10; i++) {
      recordBeat(story, { code: 'wait.long', minute: i, value: i });
    }
    expect(story.recent.length).toBe(STORY_RECENT_CAP);
    expect(story.recent[0]?.minute).toBe(10);
    expect(story.recent[story.recent.length - 1]?.minute).toBe(STORY_RECENT_CAP + 9);
  });

  it('caps followed at STORY_FOLLOWED_CAP and refuses the ninth', () => {
    const story = createStoryState();
    for (let i = 0; i < STORY_FOLLOWED_CAP; i++) {
      expect(followSim(story, i)).toBe(true);
    }
    expect(story.followed.length).toBe(STORY_FOLLOWED_CAP);
    expect(followSim(story, 9999)).toBe(false);
    expect(story.followed.length).toBe(STORY_FOLLOWED_CAP);
    expect(story.followed).not.toContain(9999);
  });

  it('followSim returns true and makes no change when already followed', () => {
    const story = createStoryState();
    followSim(story, 1);
    const before = [...story.followed];
    expect(followSim(story, 1)).toBe(true);
    expect(story.followed).toEqual(before);
  });

  it('caps a thread at STORY_THREAD_CAP', () => {
    const story = createStoryState();
    followSim(story, 1);
    for (let i = 0; i < STORY_THREAD_CAP + 10; i++) {
      recordBeat(story, { code: 'trip.arrived', minute: i, simId: 1, value: i });
    }
    const thread = story.threads[1];
    expect(thread?.length).toBe(STORY_THREAD_CAP);
    expect(thread?.[0]?.minute).toBe(10);
  });

  it('recordBeat for an unfollowed sim does not create a thread', () => {
    const story = createStoryState();
    recordBeat(story, { code: 'trip.arrived', minute: 1, simId: 42, value: 3 });
    expect(story.threads[42]).toBeUndefined();
  });

  it('unfollowSim deletes the thread', () => {
    const story = createStoryState();
    followSim(story, 5);
    recordBeat(story, { code: 'trip.arrived', minute: 1, simId: 5, value: 3 });
    expect(story.threads[5]).toBeDefined();
    unfollowSim(story, 5);
    expect(story.followed).not.toContain(5);
    expect(story.threads[5]).toBeUndefined();
  });
});
