# scripts/bench

- `bench3.ts`: measures per-tick cost (median/p95), serialize and hash time on three towers (small, medium, large) built to scale.
- `bench4.ts`: replays the real game loop (game.ts `step()` behaviour) at 4x speed for 20 in-game seconds on a medium tower; set `STEP_MS=0` for the unboxed loop with no catch-up time-box.
- `hash.ts`: prints world hashes at two checkpoints for each of the three bench towers; these six hashes must not change across a performance fix, since a different hash means different simulation behaviour.

Run any script with:

```
npx vite-node@6.0.0 scripts/bench/<name>.ts
```

`vite-node` is not a repo dependency; `npx` fetches that pinned version on demand.
