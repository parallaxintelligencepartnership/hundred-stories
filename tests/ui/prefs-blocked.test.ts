// Site storage blocked (audit 2026-09-25, E1 S2): the Settings switches must still do what they
// say for the rest of the session. A store that throws keeps the choice in memory; a working
// store and values stored in an earlier session read exactly as before.
import { afterEach, describe, expect, it, vi } from 'vitest';

type WindowStub = { localStorage: unknown };

async function freshModules() {
  vi.resetModules();
  const prefs = await import('../../src/ui/prefs');
  const display = await import('../../src/ui/display');
  const haptics = await import('../../src/ui/haptics');
  return { ...prefs, ...display, ...haptics };
}

function rootStub(): { classes: Set<string>; classList: { toggle(n: string, on?: boolean): boolean } } {
  const classes = new Set<string>();
  return {
    classes,
    classList: {
      toggle(n: string, on?: boolean) {
        if (on) classes.add(n);
        else classes.delete(n);
        return Boolean(on);
      },
    },
  };
}

const saved = (globalThis as { window?: unknown }).window;
afterEach(() => {
  (globalThis as { window?: unknown }).window = saved;
});

function blockGetter(): void {
  (globalThis as { window?: unknown }).window = {
    get localStorage(): never {
      throw new DOMException('blocked', 'SecurityError');
    },
  };
}

function blockWrites(data: Map<string, string>): void {
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    },
  } satisfies WindowStub;
}

describe('prefs with storage blocked', () => {
  for (const [name, block] of [
    ['the localStorage getter throws', () => blockGetter()],
    ['setItem throws', () => blockWrites(new Map())],
  ] as const) {
    it(`${name}: Larger text, Color-blind views and Vibration still take effect`, async () => {
      block();
      const m = await freshModules();
      const root = rootStub();
      let colorBlind: boolean | null = null;
      m.watchDisplayPrefs({ root, colorBlind: (on) => (colorBlind = on) });
      m.setFlag(m.PREF_KEYS.largeText, true);
      m.setFlag(m.PREF_KEYS.colorBlind, true);
      m.setHapticsEnabled(false);
      expect(m.getFlag(m.PREF_KEYS.largeText)).toBe(true);
      expect(root.classes.has('hs-large-text')).toBe(true);
      expect(colorBlind).toBe(true);
      expect(m.hapticsEnabled()).toBe(false);
      m.setFlag(m.PREF_KEYS.largeText, false);
      expect(root.classes.has('hs-large-text')).toBe(false);
    });
  }

  it('a value stored in an earlier session still reads back when only writes fail', async () => {
    blockWrites(new Map([['hs.largeText', 'true']]));
    const m = await freshModules();
    expect(m.getFlag(m.PREF_KEYS.largeText)).toBe(true);
    // and a change made now wins over it for the rest of the session
    m.setFlag(m.PREF_KEYS.largeText, false);
    expect(m.getFlag(m.PREF_KEYS.largeText)).toBe(false);
  });

  it('a working store reads and writes as before', async () => {
    const data = new Map<string, string>();
    (globalThis as { window?: unknown }).window = {
      localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) },
    } satisfies WindowStub;
    const m = await freshModules();
    expect(m.getFlag(m.PREF_KEYS.colorBlind)).toBe(null);
    m.setFlag(m.PREF_KEYS.colorBlind, true);
    expect(data.get('hs.colorBlind')).toBe('true');
    expect(m.getFlag(m.PREF_KEYS.colorBlind)).toBe(true);
  });
});
