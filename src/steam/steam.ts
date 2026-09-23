// Steam achievements from the web side. Inside the Tauri desktop shell this reports the star
// rating to the shell's `report_star` command (src-tauri/src/achievements.rs), which unlocks
// every achievement up to that star when the shell is built with the `steam` feature and is a
// no-op otherwise. Outside Tauri (the web, the phone shells, tests) it does nothing at all: no
// subscription, no import of the Tauri api.
import type { GameApi } from '../game/api';
import { isTauri } from '../game/storage';

/**
 * Star rating to Steam achievement id, the same table as STAR_ACHIEVEMENTS in
 * src-tauri/src/achievements.rs (tests/game/steam.test.ts keeps the two in step). The shell does
 * the unlocking; this copy documents what a report earns.
 */
export const STAR_ACHIEVEMENTS: Readonly<Record<1 | 2 | 3 | 4 | 5 | 6, string>> = {
  1: 'FIRST_TOWER',
  2: 'STAR_2',
  3: 'STAR_3',
  4: 'STAR_4',
  5: 'STAR_5',
  6: 'STAR_6',
};

export const REPORT_STAR_COMMAND = 'report_star';

export type Invoke = (cmd: string, args: { n: number }) => Promise<unknown>;

export interface SteamDeps {
  /** The global to look for Tauri on; the real one by default. */
  global?: object;
  /** The Tauri invoke; loaded from @tauri-apps/api only inside the shell. */
  invoke?: Invoke;
}

async function tauriInvoke(cmd: string, args: { n: number }): Promise<unknown> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(cmd, args);
}

/**
 * Wire achievements to the game. Reports the current star once (a tower restored from a save
 * keeps what it earned, and star 1 is FIRST_TOWER), then each time the rating rises. A fall is
 * not reported: an achievement, once earned, stays. Returns the unsubscribe.
 */
export function createSteam(game: Pick<GameApi, 'world' | 'subscribeEvents'>, deps: SteamDeps = {}): () => void {
  if (!isTauri(deps.global)) return () => {};
  const invoke = deps.invoke ?? tauriInvoke;
  let best = 0;
  const report = (n: number): void => {
    if (n <= best) return;
    best = n;
    // A shell without the command (an old build) or a failed call must never reach the game.
    invoke(REPORT_STAR_COMMAND, { n }).catch(() => {});
  };
  report(game.world.stars);
  return game.subscribeEvents((event) => {
    if (event.kind === 'stars' && event.to > event.from) report(event.to);
  });
}
