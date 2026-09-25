import { readFileSync, writeSync } from 'node:fs';
const S = '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/';
const { tick } = await import(S + 'tick');
const { deserialize } = await import(S + 'save');
const d: any = JSON.parse(readFileSync('/private/tmp/claude-501/-Users-matthew-parallax-private-Projects-hundred-stories/59100aac-82b1-4a98-947c-f0845463d155/scratchpad/audit/probeD/base.json', 'utf8'));
const say = (s: string) => writeSync(1, s + '\n');
const name = process.env.MUT!;
const M: Record<string, () => void> = {
  shaftWidth: () => { delete d.shafts[0].width; },
  statsIncomeByKind: () => { delete d.stats.incomeByKind; },
  statsEmpty: () => { d.stats = {}; },
  tenants: () => { delete d.rooms[d.rooms.length - 1].tenants; },
  schedule: () => { delete d.sims[0].schedule; },
  route: () => { delete d.sims[0].route; },
};
M[name]!();
const r = deserialize(JSON.stringify(d));
say(`${name}: deserialize ok=${r.ok}${r.ok ? '' : ' reason=' + (r as any).reason} start minute ${d.minute}`);
if (!r.ok) process.exit(0);
const w = r.world;
const t0 = Date.now();
try {
  for (let i = 0; i < 100_000; i++) {
    if (i % 1000 === 0) say(`  tick ${i} minute ${w.time.minute} ${Date.now() - t0} ms`);
    tick(w);
  }
  say(`${name}: 100000 ticks ok`);
} catch (e) {
  say(`${name}: THROWS at minute ${w.time.minute}: ${String((e as Error).message).slice(0, 100)}`);
  say(`  stack: ${String((e as Error).stack).split('\n').slice(1, 3).map((s) => s.trim().replace(/.*hundred-stories\//, '')).join(' <- ')}`);
}
