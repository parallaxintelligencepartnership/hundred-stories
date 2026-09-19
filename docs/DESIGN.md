# Hundred Stories: architecture contract

Every module is built against this document and `src/sim/types.ts`. If reality disagrees with this file, stop and report; do not improvise a different shape.

## 1. Principles

1. The simulation is pure. `src/sim/**` never imports from `pixi.js`, the DOM, `window`, `Date`, or `Math.random`. All randomness comes from the `Rng` stored in the world. Same seed plus same command list equals the same state hash, always.
2. One tick equals one game minute. `tick(world)` advances exactly one minute and mutates the world in place. The renderer only reads.
3. Player intent is a command. `applyCommand(world, cmd)` validates, mutates, and returns `{ ok: true } | { ok: false, reason: string }`. The reason string is shown to the player verbatim, so it is plain English, US spelling, no dashes.
4. Rules live in data. `src/sim/rules.ts` holds every number (costs, widths, thresholds, schedules). Logic modules read it; they never inline a magic number.
5. Rendering is derived. Sprites are keyed by entity id and reconciled each frame from world state. No render-side gameplay state.

## 2. Coordinates and grid

- Tower width `TOWER_WIDTH = 375` tiles, x in `[0, 375)`.
- Floors: 1 is the ground floor and holds the mandatory lobby. Floors 2 to 100 above ground. Floors -1 to -10 underground. Floor 0 does not exist.
- A room occupies `[x, x + width)` on floors `[floor, floor + height)` (height grows upward for above ground rooms; underground rooms also grow upward from their floor).
- A floor exists only where a room or shaft has been built on it. Floor slabs are implicit: the renderer draws a slab under any tile covered by a room or a lobby.
- Elevator shafts occupy `[x, x + width)` on floors `[floorMin, floorMax]` and share floors with rooms only at their own columns (no room may overlap a shaft).
- Stairs and escalators are rooms of height 2 that connect `floor` and `floor + 1`.

## 3. Time

- `world.time = { minute: number }` counts total game minutes from the start. Derived: `minuteOfDay = minute % 1440`, `dayOfQuarter = floor(minute / 1440) % 3` (0 and 1 weekdays, 2 weekend), `quarter = floor(minute / 4320) % 4`, `year = floor(minute / 17280) + 1`.
- The clock shows hours 0 to 23. Quarter boundaries occur at minute 0 of day 0. `onQuarterStart(world)` runs economy and evaluation. `onYearEnd(world)` runs Santa.
- Speed is a render concern: the loop calls `tick` N times per real second (1x = 10 ticks/s, 2x = 20, 4x = 40; night 23:00 to 06:00 auto-runs at 8x unless paused).

## 4. Entities (see types.ts for exact fields)

- `Room`: id, kind (`RoomKind`), floor, x, width, height, `eval` 0..1, `occupancy`, `tenants` (sim ids), `state` flags per kind (hotel: `dirty`, `infested`; office: `vacant`), `builtAtMinute`.
- `Shaft`: id, kind (`standard | express | service`), x, width, floorMin, floorMax, `stops: Set<floor>`, `cars: Car[]`, `homeFloor`.
- `Car`: id, shaftId, `y` (float floor position), `dir` (-1, 0, 1), `state` (`idle | moving | doorsOpen`), `doorTimer`, `passengers: simId[]`, `calls: Set<floor>`.
- `Sim`: id, kind (`worker | resident | guest | shopper | diner | staff | visitor | vip`), `homeRoomId`, `pos: { floor, x }` or `inCarId`, `route: Leg[]`, `state` (`inRoom | walking | waiting | riding | leaving | gone`), `stress` 0..1, `waitStart`, `schedule: ScheduleEntry[]`, `wallet` (for shoppers), `visibleColor` derived from stress.
- `Leg`: `{ kind: 'walk', toX } | { kind: 'ride', shaftId, fromFloor, toFloor } | { kind: 'stairs', roomId, toFloor } | { kind: 'enter', roomId }`.
- `World`: `{ seed, rng, time, cash, stars, population, rooms: Map, shafts: Map, sims: Map, nextId, log: LogEntry[], events: ActiveEvent[], stats, floorIndex }`. `floorIndex` is a rebuilt-on-change cache: for each floor, the sorted rooms and the shafts stopping there.

## 5. Modules and owners

| Module | Responsibility | Exports |
|---|---|---|
| `sim/types.ts` | all interfaces and enums (orchestrator writes it first) | types only |
| `sim/rules.ts` | every number: `ROOMS[kind]`, `SHAFTS[kind]`, `STARS[]`, `STRESS`, `SCHEDULES`, `EVENTS` | const data |
| `sim/rng.ts` | mulberry32 | `createRng` |
| `sim/world.ts` | `createWorld(seed)`, id allocation, `rebuildFloorIndex`, `log(world, text)` | |
| `sim/build.ts` | `applyCommand` for `build`, `demolish`, `elevator.*` commands; all validation (overlap, lobby, star gate, cash, underground rules, sky lobby floors, shaft span) | `applyCommand`, `canBuild` |
| `sim/routing.ts` | floor connectivity graph, `findRoute(world, from, toFloor, toX): Leg[] | null`; rebuilt lazily when `world.routingDirty` | |
| `sim/elevators.ts` | per tick: car movement, door cycle, boarding and alighting, hall calls, SCAN dispatch, idle return to home floor | `tickElevators` |
| `sim/people.ts` | schedules by sim kind, spawning tenants for occupied rooms, walking, waiting, stress accumulation and decay, leaving with a reason, visitor spawning for shops and restaurants | `tickPeople`, `spawnForRoom` |
| `sim/economy.ts` | quarter start: rent, upkeep, hotel nightly income at checkout, shop and restaurant revenue per customer, condo sale, bankruptcy detection | `onQuarterStart`, `chargeDaily`, `recordSale` |
| `sim/evaluation.ts` | room eval from tenant stress and noise neighbors; tenant leave decisions | `tickEvaluation` |
| `sim/stars.ts` | population count and star ladder including non-population gates | `recomputeStars` |
| `sim/events.ts` | fire, bomb, VIP, cockroaches, Santa: scheduling, progression, resolution | `tickEvents` |
| `sim/tick.ts` | `tick(world)`: the fixed order below | `tick` |
| `sim/save.ts` | `serialize(world): SaveFile`, `deserialize(file): World`, `hashWorld(world): string` (FNV-1a over the canonical JSON), version field | |
| `render/**` | PixiJS scene, camera, procedural art, lighting, sprite reconciliation | `createRenderer(world, canvas)` |
| `ui/**` | DOM HUD, build palette, query panel, finances, event log, settings, save/load | `createUi(app)` |
| `main.ts` | loop: accumulator, speed, pause, wiring | |

### Tick order (sim/tick.ts)

1. `tickEvents` (may spawn sims or block rooms)
2. `tickPeople` (decide, walk, request elevators, enter rooms)
3. `tickElevators` (move cars, board, alight)
4. `tickEvaluation` every 60 minutes at minute 30
5. `chargeDaily` at 05:00; `onQuarterStart` when `dayOfQuarter === 0 && minuteOfDay === 300`
6. `recomputeStars` every 60 minutes
7. `world.time.minute += 1`

## 6. Elevator algorithm (sim/elevators.ts)

- Hall call: a waiting sim on floor f registers `(f, dir)` on the shaft it chose (routing picks the nearest shaft by x that stops at both floors; express only for lobby to sky lobby legs).
- Dispatch: each car follows SCAN: continue in its direction while any call or passenger destination lies ahead; reverse when none; idle cars return to `homeFloor` after `IDLE_RETURN_MINUTES`.
- Speed: `SHAFTS[kind].floorsPerMinute`. Door cycle: `doorOpenMinutes`. Board and alight are instantaneous at door open; capacity enforced; a full car skips the hall call but a sim keeps waiting.
- Wait time feeds stress: `stress += STRESS.perWaitingMinute` while waiting; `stress -= STRESS.decayPerMinute` while in a room. Colors: below `pink` threshold normal, `pink`, `red`, `black`. At black the sim abandons the trip, logs a reason, and if a tenant, marks the room for leaving on the next evaluation.

## 7. Noise and evaluation (sim/evaluation.ts)

- Noisy kinds: fast food, restaurant, shop, cinema, party hall, lobby, sky lobby. Quiet kinds: office, condo, hotel rooms.
- A quiet room loses eval for each noisy room on the same floor within `NOISE.rangeTiles`, and for noisy rooms directly above or below overlapping in x.
- Room eval = clamp(1 - avgTenantStressPenalty - noisePenalty - dirtyPenalty). Below `EVAL.leaveThreshold` for a full day: tenants leave with a logged reason; office becomes vacant, condo goes back on sale, hotel room stays.

## 8. Save format (sim/save.ts)

`{ version: 1, seed, minute, cash, rooms: [...], shafts: [...], sims: [...], rngState, nextId, stars, log: last 200 }`. Deserialize validates version and shape; a foreign or corrupt file returns `{ ok: false, reason }` and never touches the running world.

## 9. Renderer (render/**)

- One `Application` on a canvas, `resizeTo` the container, `resolution = devicePixelRatio`, `antialias: false` for crisp pixel art, `roundPixels: true`.
- Layers (containers, back to front): `sky`, `cityFar`, `cityNear`, `ground`, `tower` (slabs, rooms, shafts), `cars`, `sims`, `effects` (fire, smoke, particles), `overlay` (build ghost, stress tints, selection).
- Camera: world units = tiles; `TILE_PX = 8`, `FLOOR_PX = 36`. Pan by drag or WASD, zoom by wheel toward the cursor between 0.35 and 3, inertia, all GPU transforms. Reduced motion: no inertia, no particles, instant transitions.
- Procedural art: `render/art/*.ts` draws each room kind into a `RenderTexture` once per (kind, width, variant, lit) and reuses it. Windows light up by occupancy at night.
- Lighting: sky gradient keyed to minuteOfDay, tower tint, window glow after dusk, headlight streaks on the ground road at rush hour.
- Sims: 2x4 tile sprites with a stress tint, walking animation by x delta, batched in a `ParticleContainer` when more than 500.

## 10. UI (ui/**)

- DOM overlay, CSS custom properties for tokens, dark theme by default and a light theme via `prefers-color-scheme`, fonts from Google Fonts (one display face, one UI face).
- Top bar: cash, population, stars, clock with day label, speed controls, pause.
- Left palette: build tools grouped (Structure, Elevators, Residential, Hotel, Commercial, Services), locked items show the star needed.
- Query panel: click a room or sim for its state, eval bar, tenants, reason log.
- Finances panel: last quarter income and upkeep per kind.
- Event log with time stamps. Toasts for events with the action they need.
- Settings: sound toggle (no audio in v1, control hidden), reduced motion, save, load, export, import, new game with seed.
- Every UI string: US spelling, no em dashes or hyphen-dash pairs used as dashes.

## 11. Testing

- `tests/sim/*.test.ts` cover each module with seeded worlds. `tests/scenarios/*.test.ts` run scripted builds (fixtures as command lists) for N days and assert population, cash, stars, and `hashWorld` determinism.
- Rendering has no unit tests; verification is a real browser pass via the Chrome extension, recorded in `.itworks/REVIEWS.md`.
