// The controls hint counter: three loads, then silence, and a blocked store shows the line.
import { describe, expect, it, afterEach } from 'vitest';
import { nextHintSeen, readHintSeen, writeHintSeen } from '../../src/ui/ui';

describe('nextHintSeen', () => {
  it('shows the hint on the first three loads and counts each one', () => {
    expect(nextHintSeen(null)).toEqual({ show: true, seen: 1 });
    expect(nextHintSeen('1')).toEqual({ show: true, seen: 2 });
    expect(nextHintSeen('2')).toEqual({ show: true, seen: 3 });
  });

  it('stops after the third load and never counts past it', () => {
    expect(nextHintSeen('3')).toEqual({ show: false, seen: 3 });
    expect(nextHintSeen('9')).toEqual({ show: false, seen: 3 });
  });

  it('treats nonsense and a missing store as nothing seen', () => {
    expect(nextHintSeen('')).toEqual({ show: true, seen: 1 });
    expect(nextHintSeen('not a number')).toEqual({ show: true, seen: 1 });
    expect(nextHintSeen('-4')).toEqual({ show: true, seen: 1 });
  });
});

describe('a blocked localStorage', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  it('still shows the hint, and neither read nor write throws', () => {
    (globalThis as { window: { localStorage: Storage } }).window = {
      localStorage: {
        getItem() {
          throw new Error('blocked');
        },
        setItem() {
          throw new Error('blocked');
        },
      } as unknown as Storage,
    };

    let stored: string | null = null;
    expect(() => {
      stored = readHintSeen();
    }).not.toThrow();
    expect(stored).toBeNull();

    const hintState = nextHintSeen(stored);
    expect(hintState.show).toBe(true);

    expect(() => writeHintSeen(hintState.seen)).not.toThrow();
  });
});
