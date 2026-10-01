// Fake browser stores and a hand driven clock for the leave tests (tests/game/leave.test.ts,
// tests/ui/leave-card.test.ts): the real storage module runs on top of them.
import { deserialize } from '../../src/sim/save';

export const task = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
export async function settle(n = 12): Promise<void> {
  for (let i = 0; i < n; i++) await task();
}

/** An in memory localStorage. `refuse` makes every write throw the way a full quota does. */
export function fakeLocalStorage() {
  const data = new Map<string, string>();
  const ctl = { refuse: false };
  const store = {
    get length(): number {
      return data.size;
    },
    clear: (): void => data.clear(),
    getItem: (key: string): string | null => data.get(key) ?? null,
    key: (index: number): string | null => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string): void => {
      data.delete(key);
    },
    setItem: (key: string, value: string): void => {
      if (ctl.refuse) throw new DOMException('quota', 'QuotaExceededError');
      data.set(key, value);
    },
  } as Storage;
  return { store, data, ctl };
}

/**
 * An IndexedDB stand-in whose requests settle in later tasks. `gate`: puts wait on it (a slow
 * disk). `failPuts`: the transaction errors and aborts (a full quota). `failOpens`: that many
 * opens fail (WebKit's lost connection).
 */
export function fakeIdb() {
  const data = new Map<string, unknown>();
  const ctl = { gate: null as Promise<void> | null, failPuts: false, failOpens: 0 };
  const later = (f: () => void): void => void setTimeout(f, 0);
  const factory = {
    open: () => {
      const req: Record<string, unknown> = {};
      if (ctl.failOpens > 0) {
        ctl.failOpens--;
        req.error = new DOMException('Connection to Indexed Database server lost', 'UnknownError');
        later(() => (req.onerror as (() => void) | undefined)?.());
        return req;
      }
      req.result = {
        close: () => {},
        transaction: () => {
          const tx: Record<string, unknown> = { error: null };
          const fire = (name: string): void => (tx[name] as (() => void) | undefined)?.();
          let pending = 0;
          tx.objectStore = () => ({
            put: (v: unknown, k: string) => {
              pending++;
              const run = (): void =>
                later(() => {
                  if (ctl.failPuts) {
                    if (!tx.error) {
                      tx.error = new DOMException('quota', 'QuotaExceededError');
                      fire('onerror');
                      fire('onabort');
                    }
                    return;
                  }
                  data.set(k, v);
                  if (--pending === 0) fire('oncomplete');
                });
              if (ctl.gate) void ctl.gate.then(run);
              else run();
            },
            get: (k: string) => {
              const g: Record<string, unknown> = {};
              later(() => {
                g.result = data.get(k);
                (g.onsuccess as (() => void) | undefined)?.();
              });
              return g;
            },
          });
          return tx;
        },
      };
      later(() => (req.onsuccess as (() => void) | undefined)?.());
      return req;
    },
  } as unknown as IDBFactory;
  /** Hold every put from now until the returned open() is called. */
  const hold = (): (() => void) => {
    let open!: () => void;
    ctl.gate = new Promise<void>((resolve) => (open = resolve));
    return () => {
      ctl.gate = null;
      open();
    };
  };
  return { factory, ctl, data, hold };
}

/** A game clock driven by hand: idle work runs at once, the tab counts as hidden (the timer drives). */
export function handClock(today = '2026-09-28') {
  const clock = { ms: 0 };
  return {
    clock,
    opts: {
      now: () => clock.ms,
      hidden: () => true,
      scheduleIdle: (run: () => void) => {
        run();
        return () => {};
      },
      today: () => today,
      freshSeed: () => 77,
    },
  };
}

/** A saved tower's text, read the way the game reads it: its lobby tiles and its minute. */
export function savedTower(text: unknown): { seed: number; minute: number; lobbies: number[] } | null {
  if (typeof text !== 'string') return null;
  const res = deserialize(text);
  if (!res.ok) return null;
  const lobbies = [...res.world.rooms.values()].filter((r) => r.kind === 'lobby').map((r) => r.x);
  return { seed: res.world.seed, minute: res.world.time.minute, lobbies: lobbies.sort((a, b) => a - b) };
}
