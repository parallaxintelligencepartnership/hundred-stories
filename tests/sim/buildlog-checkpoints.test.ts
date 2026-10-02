// The build log keeps only its most recent MAX_CHECKPOINTS checkpoints (decision 2026-10-01):
// they only locate where a replay drifted. The entries are never trimmed, and a save holding more
// checkpoints still loads.
import { describe, expect, it } from 'vitest';
import { applyAndRecord, buildLogFromSave, buildLogOf, buildLogToSave, MAX_CHECKPOINTS, recordCheckpoint, setBuildLog, startBuildLog } from '../../src/sim/buildlog';
import { deserialize, hashWorld, serialize } from '../../src/sim/save';
import { createWorld } from '../../src/sim/world';

function loggedWorld() {
  const world = createWorld(5);
  world.cash = 10_000_000;
  startBuildLog(world, 'full');
  for (let x = 100; x < 110; x++) expect(applyAndRecord(world, { kind: 'build', room: 'lobby', floor: 1, x }).ok).toBe(true);
  return world;
}

describe('build log checkpoints', () => {
  it('keeps the most recent 256 and never trims an entry', () => {
    expect(MAX_CHECKPOINTS).toBe(256);
    const world = loggedWorld();
    for (let i = 0; i < 300; i++) {
      world.time.minute = i * 60;
      recordCheckpoint(world, `h${i}`);
    }
    const log = buildLogOf(world);
    expect(log.checks).toHaveLength(256);
    expect(log.checks[0]).toEqual({ t: 44 * 60, n: 10, h: 'h44' });
    expect(log.checks[255]).toEqual({ t: 299 * 60, n: 10, h: 'h299' });
    expect(log.entries).toHaveLength(10);
  });

  it('a second note at the same point still replaces the first, at the cap too', () => {
    const world = loggedWorld();
    for (let i = 0; i < 256; i++) {
      world.time.minute = i;
      recordCheckpoint(world, `h${i}`);
    }
    recordCheckpoint(world, 'again');
    const log = buildLogOf(world);
    expect(log.checks).toHaveLength(256);
    expect(log.checks[0]?.h).toBe('h0');
    expect(log.checks[255]?.h).toBe('again');
  });

  it('a save with more than 256 checkpoints still loads with all of them, and the next one trims it', () => {
    const world = loggedWorld();
    const saved = buildLogToSave(world);
    saved.checks = Array.from({ length: 400 }, (_, i): [number, number, string] => [i, 10, `old${i}`]);
    const loaded = buildLogFromSave(JSON.parse(JSON.stringify(saved)));
    expect(loaded.unavailable).toBeNull();
    expect(loaded.checks).toHaveLength(400);
    setBuildLog(world, loaded);

    // Through the whole save path too.
    const file = deserialize(serialize(world));
    expect(file.ok).toBe(true);
    if (!file.ok) return;
    expect(buildLogOf(file.world).checks).toHaveLength(400);
    file.world.time.minute = 1_000;
    recordCheckpoint(file.world, hashWorld(file.world));
    const trimmed = buildLogOf(file.world).checks;
    expect(trimmed).toHaveLength(256);
    expect(trimmed[0]?.h).toBe('old145');
    expect(buildLogOf(file.world).entries).toHaveLength(10);
  });
});
