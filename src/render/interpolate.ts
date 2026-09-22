// Where a moving thing is drawn between two sim ticks.
//
// The game snapshots every drawn entity immediately before the last tick of a batch (commit),
// the renderer then hands over the position after that tick (target), and each frame draws
// commit + (target - commit) * alpha, where alpha is the fraction of the next tick already
// earned. So a sprite reaches its target just as the next tick fires, and a batch of N ticks
// draws as uniform motion. Pure on purpose: no pixi, so the tests drive it directly.

/**
 * A jump past this many tiles in one tick is a teleport (an entrance, alighting, a load), so
 * snap instead of lerp. The renderer turns it into pixels (TELEPORT_PX) for the constructor.
 */
export const TELEPORT_TILES = 12;

interface Entry {
  cx: number; // the committed position, before the last tick
  cy: number;
  tx: number; // the target, the position after it
  ty: number;
}

export class Motion<K> {
  private readonly entries = new Map<K, Entry>();

  /** @param teleportPx a move past this on either axis snaps */
  constructor(private readonly teleportPx: number) {}

  /**
   * Record where this entity stands before the last tick of a batch.
   *
   * A key that has never been targeted is ignored: its first target places it without motion,
   * and a commit must not create entries for things the renderer never draws.
   */
  commit(key: K, x: number, y: number): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.cx = x;
    entry.cy = y;
  }

  /**
   * Record where this entity stands now, and say whether the move from the commit is a teleport.
   *
   * A new key, or a teleport, collapses commit and target onto the new point. There is no settle
   * rule: an entity the last tick did not move has commit equal to target, so it holds still.
   */
  target(key: K, x: number, y: number): boolean {
    const entry = this.entries.get(key);
    if (!entry) {
      this.entries.set(key, { cx: x, cy: y, tx: x, ty: y });
      return false;
    }
    entry.tx = x;
    entry.ty = y;
    const teleport = Math.abs(x - entry.cx) > this.teleportPx || Math.abs(y - entry.cy) > this.teleportPx;
    if (teleport) {
      entry.cx = x;
      entry.cy = y;
    }
    return teleport;
  }

  /** Pin an entity to a fixed point (a room slot) so it does not lerp away from it next frame. */
  park(key: K, x: number, y: number): void {
    const entry = this.entries.get(key);
    if (!entry) this.entries.set(key, { cx: x, cy: y, tx: x, ty: y });
    else {
      entry.cx = x;
      entry.cy = y;
      entry.tx = x;
      entry.ty = y;
    }
  }

  /** The drawn point at alpha, clamped to [0, 1]. An unknown key has no point. */
  at(key: K, alpha: number): { x: number; y: number } | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    const t = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    return { x: entry.cx + (entry.tx - entry.cx) * t, y: entry.cy + (entry.ty - entry.cy) * t };
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }

  forget(key: K): void {
    this.entries.delete(key);
  }

  reset(): void {
    this.entries.clear();
  }
}
