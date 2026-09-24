// Dev only: replay an exported save from its build log and say whether it reaches the same world.
//
//   npx vite-node@6.0.0 scripts/replay.ts <save.json>
//
// Prints match, or mismatch with the first tick known to differ (a refused entry's tick, or the
// first checkpoint whose hash differs) and the last checkpoint that still matched. Checkpoints are
// written each time the game saves, so the drift lies between those two ticks.
// Exit code: 0 match, 1 mismatch, 2 replay unavailable or the file does not read.
import { readFileSync } from 'node:fs';
import { verifySave } from '../src/sim/replay';
import { clockOf } from '../src/sim/types';

function when(minute: number): string {
  const c = clockOf(minute);
  const hh = String(Math.floor(c.minuteOfDay / 60)).padStart(2, '0');
  const mm = String(c.minuteOfDay % 60).padStart(2, '0');
  return `tick ${minute} (year ${c.year}, quarter ${c.quarter + 1}, day ${c.dayOfQuarter + 1}, ${hh}:${mm})`;
}

const path = process.argv[2];
if (!path) {
  console.error('usage: npx vite-node@6.0.0 scripts/replay.ts <save.json>');
  process.exit(2);
}

const started = performance.now();
const result = verifySave(readFileSync(path, 'utf8'));
const ms = Math.round(performance.now() - started);

switch (result.status) {
  case 'unreadable':
    console.log(`unreadable: ${result.reason}`);
    process.exit(2);
    break;
  case 'unavailable':
    console.log(
      result.why === 'startedBeforeLog'
        ? 'unavailable: this tower was started before the build log existed (save v4 or older)'
        : result.why === 'damaged'
          ? 'unavailable: the build log in this save does not read'
          : 'unavailable: this log comes from an edition this build cannot replay',
    );
    process.exit(2);
    break;
  case 'match':
    console.log(`match at ${when(result.tick)}: hash ${result.hash}, ${result.entries} entries, ${result.checkpoints} checkpoints, ${ms} ms`);
    process.exit(0);
    break;
  case 'mismatch':
    console.log(`mismatch: first differs at ${when(result.divergedAt)}`);
    console.log(`  last match: ${result.lastMatch === null ? 'none' : when(result.lastMatch)}`);
    if (result.refused) console.log(`  entry ${result.refused.index} at tick ${result.refused.t} was refused: ${result.refused.reason}`);
    console.log(`  expected ${result.expected}, replay gave ${result.actual} (${ms} ms)`);
    process.exit(1);
}
