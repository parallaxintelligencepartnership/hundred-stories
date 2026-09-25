import { describe, expect, it } from 'vitest';
import { applyCommand } from '../../src/sim/build';
import { personVoice } from '../../src/sim/identity';
import type { Room, World } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';
import {
  createStoryState,
  describeBeat,
  type StoryBeat,
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

describe('story: a trip to a room that has since gone (audit C S7)', () => {
  function simInVoice(world: World, voice: number): number {
    for (let id = 1; id < 1000; id++) if (personVoice(world.seed, id) === voice) return id;
    throw new Error(`no sim id speaks in voice ${voice}`);
  }

  it('drops the place instead of saying the street, in all three voices', () => {
    const world = createWorld(11);
    for (let x = 100; x < 110; x++) expect(applyCommand(world, { kind: 'build', room: 'lobby', floor: 1, x }).ok).toBe(true);
    expect(applyCommand(world, { kind: 'build', room: 'office', floor: 2, x: 100 }).ok).toBe(true);
    const office = [...world.rooms.values()].find((r) => r.kind === 'office') as Room;
    const lines: string[] = [];
    for (let voice = 0; voice < 3; voice++) {
      const beat: StoryBeat = { code: 'trip.arrived', minute: 500, simId: simInVoice(world, voice), roomId: office.id, value: 7 };
      expect(describeBeat(beat, world)).toMatch(/floor 2/i);
      lines.push(describeBeat(beat, world));
    }
    expect(applyCommand(world, { kind: 'demolish', roomId: office.id }).ok).toBe(true);
    for (let voice = 0; voice < 3; voice++) {
      const beat: StoryBeat = { code: 'trip.arrived', minute: 500, simId: simInVoice(world, voice), roomId: office.id, value: 7 };
      const line = describeBeat(beat, world);
      expect(line).not.toMatch(/street/);
      expect(line).not.toMatch(/floor/);
      expect(line).toMatch(/seven minutes/i);
      expect(line).not.toMatch(/ {2}| \./);
    }
    // a trip that really ended outside still says so
    const out: StoryBeat = { code: 'trip.arrived', minute: 500, simId: simInVoice(world, 1), value: 7 };
    expect(describeBeat(out, world)).toBe('I made it out to the street in seven minutes today.');
  });
});
