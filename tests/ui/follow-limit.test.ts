// The follow limit sentence is built from the sim's cap (audit 2026-09-25, E1 S8), so a change to
// STORY_FOLLOWED_CAP changes the words the player reads, in a number word a child knows.
import { describe, expect, it } from 'vitest';
import { STORY_FOLLOWED_CAP } from '../../src/sim/story';
import * as panels from '../../src/ui/panels';

describe('the follow limit sentence', () => {
  it('is built from STORY_FOLLOWED_CAP', () => {
    expect(typeof panels.followLimitText).toBe('function');
    expect(panels.FOLLOW_LIMIT_TEXT).toBe(panels.followLimitText(STORY_FOLLOWED_CAP));
  });

  it('says the cap in words', () => {
    expect(panels.followLimitText(8)).toBe('You can follow eight people at a time.');
    expect(panels.followLimitText(3)).toBe('You can follow three people at a time.');
    expect(panels.followLimitText(1)).toBe('You can follow one person at a time.');
    expect(panels.followLimitText(12)).toBe('You can follow twelve people at a time.');
    expect(panels.followLimitText(20)).toBe('You can follow 20 people at a time.');
  });
});
