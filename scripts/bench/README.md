# scripts/bench

- `bench3.ts`: measures per-tick cost (median/p95), serialize and hash time on three towers (small, medium, large) built to scale.
  Each tower prints a second row, `<label>-evening`, sampled on the same world run on to 17:30 the same day, so the evening rush is measured.
- `bench4.ts`: replays the 50 ms timer loop (game.ts `step()`, which since the engine round drives ticks only while the tab is hidden; a visible tab drains them per animation frame) at 4x speed for 20 in-game seconds on a medium tower; set `STEP_MS=0` for the unboxed loop with no catch-up time-box.
- `hash.ts`: prints world hashes at two checkpoints for each of the three bench towers; these six hashes must not change across a performance fix, since a different hash means different simulation behaviour.

Run any script with:

```
npx vite-node@6.0.0 scripts/bench/<name>.ts
```

`vite-node` is not a repo dependency; `npx` fetches that pinned version on demand.
