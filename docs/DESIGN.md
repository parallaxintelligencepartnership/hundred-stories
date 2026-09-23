# Hundred Stories: architecture contract

Every module is built against this document and `src/sim/types.ts`. If reality disagrees with this file, stop and report; do not improvise a different shape.

## 1. Principles

1. The simulation is pure. `src/sim/**` never imports from `pixi.js`, the DOM, `window`, `Date`, or `Math.random`. All randomness comes from the `Rng` stored in the world. Same seed plus same command list equals the same state hash, always.
2. One tick equals one game minute. `tick(world)` advances exactly one minute and mutates the world in place. The renderer only reads.
3. Player intent is a command. `applyCommand(world, cmd)` validates, mutates, and returns `{ ok: true } | { ok: false, reason: string }`. The reason string is shown to the player verbatim, so it is plain English, US spelling, no dashes.
4. Rules live in data. `src/sim/rules.ts` holds every number (costs, widths, thresholds, schedules). Logic modules read it; they never inline a magic number.
5. Rendering is derived. Sprites are keyed by entity id and reconciled from world state: cars and sims every frame, the static tower (rooms, slabs, shafts, fire markers) only when `world.structureVersion` or the night lit state changes. No render-side gameplay state; the motion snapshots in `render/interpolate.ts` are presentation only.

## 2. Coordinates and grid

- Tower width `TOWER_WIDTH = 375` tiles, x in `[0, 375)`.
- Floors: 1 is the ground floor and holds the mandatory lobby. Floors 2 to 100 above ground. Floors -1 to -10 underground. Floor 0 does not exist.
- A room occupies `[x, x + width)` on floors `[floor, floor + height)` (height grows upward for above ground rooms; underground rooms also grow upward from their floor).
- A floor exists only where a room or a shaft has been built on it, and a shaft's tiles count: a floor a shaft passes through carries rooms beside it. Floor slabs are implicit: the renderer draws a slab under any tile covered by a room or a lobby.
- Elevator shafts occupy `[x, x + width)` on floors `[floorMin, floorMax]`, and those floors need not exist yet: a shaft may rise from the lobby into empty air. A shaft overlays rooms of every kind and rooms may be built over its columns.
- Stairs and escalators are rooms of height 2 that connect `floor` and `floor + 1`. They are connectors, like shafts: they overlay rooms and rooms overlay them. Two connectors never share a tile on the same base floor, so a flight may start on the floor the last one reaches and a stairwell stacks in a column; stairs over a shaft, or a shaft over stairs, is still refused. Connectors are drawn above the rooms they cover, stairs and escalators without a backing fill so the room stays visible behind them.

## 3. Time

- `world.time = { minute: number }` counts total game minutes from the start. Derived: `minuteOfDay = minute % 1440`, `dayOfQuarter = floor(minute / 1440) % 3` (0 and 1 weekdays, 2 weekend), `quarter = floor(minute / 4320) % 4`, `year = floor(minute / 17280) + 1`.
- The clock shows hours 0 to 23. Quarter boundaries occur at minute 0 of day 0. `onQuarterStart(world)` runs economy and evaluation. `onYearEnd(world)` runs Santa.
- Speed is a render concern: the loop calls `tick` N times per real second (1x = 10 ticks/s, 2x = 20, 4x = 40; night 23:00 to 06:00 auto-runs at 8x unless paused). The loop lives in `game/game.ts`: while the tab is visible ticks drain from the `requestAnimationFrame` frame loop, and a 50 ms timer drives them only while the tab is hidden.

## 4. Entities (see types.ts for exact fields)

- `Room`: id, kind (`RoomKind`), floor, x, width, height, `eval` 0..1, `occupancy`, `tenants` (sim ids), `state` flags per kind (hotel: `dirty`, `infested`; office: `vacant`), `builtAtMinute`, `rent` (percent of the standard rate, office/condo/hotel rooms only).
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
| `game/game.ts` | loop: accumulator, speed, pause, frame-driven ticks with the hidden-tab timer fallback; tools, input, save and load wiring | `createGame` |
| `main.ts` | boot: seed from the query string, game, renderer and UI wiring, the no-WebGL message | |

### Tick order (sim/tick.ts)

1. `tickEvents` (may spawn sims or block rooms)
2. `tickPeople` (decide, walk, request elevators, enter rooms)
3. `tickElevators` (move cars, board, alight)
4. `tickEvaluation` every 60 minutes at minute 30
5. `chargeDaily` at 05:00; `onQuarterStart` when `dayOfQuarter === 0 && minuteOfDay === 300`
6. `recomputeStars` every 60 minutes
7. `world.time.minute += 1`

## 6. Elevator algorithm (sim/elevators.ts)

- Rider class: `riderClassOf(kind)` sorts every sim into `hotel` (guest, vip), `office` (worker) or `other` (everyone else). A car's `serves` is `any`, `hotel` or `office`; its `range` is `{lo, hi}` inside the shaft span, or null for the whole shaft, which grows with the shaft. `carCovers(shaft, car, floor)` answers both.
- Hall call: a waiting sim on floor f registers `(f, dir, class)` on the shaft it chose (routing picks the nearest shaft by x that stops at both floors; express only for lobby to sky lobby legs). `hallCalls` holds one set of classes per direction, so two kinds of rider on one floor are two separate calls.
- Car eligibility for a call `(f, dir, c)`: the car covers f, and `serves` is `any`, or `serves` is c, or the leftover rule holds: the car has no passengers and no call of its own class anywhere inside its range. Dispatch ranks eligible dedicated or general cars first (heading that way, then idle, then the rest) and leftover cars last, with distance then car id as the tie breaks.
- Boarding: a sim gets on only if the car covers its destination floor and the car serves its class or is a leftover. A sim who cannot board keeps waiting and its hall call is registered again, so another car comes. Opening the doors clears the call at that floor and direction only for the classes that car serves.
- A car never drives outside its range: targets, the SCAN reversal and the idle return home all stay inside it, and a car left outside its range moves to the nearest edge first. A car's range cannot be changed while it carries passengers, which would strand them.
- Routing sees the rider: `findRoute(..., { riderClass })` uses a graph where a shaft emits one connector per distinct range among the cars that would carry that rider (`serves` `any` or the rider's class; leftover is a door courtesy, never a plan). Two floors are joined only when one counted car works both. With no class named the graph is class blind, which is what a structural question like `isReachableFromLobby` asks.
- Dispatch: each car follows SCAN: continue in its direction while any call or passenger destination lies ahead; reverse when none; idle cars return to `homeFloor` after `IDLE_RETURN_MINUTES`.
- Speed: `SHAFTS[kind].floorsPerMinute`. Door cycle: `doorOpenMinutes`. Board and alight are instantaneous at door open; capacity enforced; a full car skips the hall call but a sim keeps waiting.
- Wait time feeds stress: `stress += STRESS.perWaitingMinute` while waiting; `stress -= STRESS.decayPerMinute` while in a room. Colors: below `pink` threshold normal, `pink`, `red`, `black`. At black the sim abandons the trip, logs a reason, and if a tenant, marks the room for leaving on the next evaluation.

## 7. Noise and evaluation (sim/evaluation.ts)

- Noisy kinds: fast food, restaurant, shop, cinema, party hall. Lobbies are not noisy (a lobby run is many one tile rooms and would zero anything above it). Quiet kinds: office, condo, hotel rooms.
- A quiet room loses eval for each noisy room on the same floor within `NOISE.rangeTiles`, and for noisy rooms directly above or below overlapping in x.
- Room eval = clamp(1 - avgTenantStressPenalty - noisePenalty - dirtyPenalty). Below `EVAL.leaveThreshold` for a full day: tenants leave with a logged reason; office becomes vacant, condo goes back on sale, hotel room stays.
- Rent (`RENT` in rules.ts): office, condo and hotel rooms carry a `rent` percent, 50..150 in steps of 10, default 100, set via `room.setRent`. A discount below 100 adds to eval (up to `+0.3` at 50%), a premium above 100 subtracts (up to `-0.3` at 150%, `takesRent(kind)` gates which rooms use it), and the same figure scales what the room pays: office quarterly rent, hotel nightly income, and condo sale price.

## 8. Save format (sim/save.ts)

`{ version: 3, seed, minute, cash, stars, population, nextId, rngState, rooms: [...], shafts: [...], sims: [...], events, stats, gameOver, log: last 200, logTotal, quarterStartCash, dayStartPopulation }`; version 1 and 2 saves still load (the two status bar baselines load as null from an older save), and the world hash still names version 2 because it leaves the baselines out. Deserialize validates version and shape; a foreign or corrupt file returns `{ ok: false, reason }` and never touches the running world.

## 9. Renderer (render/**)

- One `Application` on a canvas, `resizeTo` the container, `resolution = devicePixelRatio`, `antialias: false` for crisp pixel art, `roundPixels: true`.
- Layers (containers, back to front): `sky`, `cityFar`, `cityNear`, `ground`, `tower` (slabs, rooms, shafts), `cars`, `sims`, `effects` (fire, smoke, particles), `overlay` (build ghost, stress tints, selection).
- Camera: world units = tiles; `TILE_PX = 8`, `FLOOR_PX = 36`. The view moves by drag with any button and any tool in hand, by scroll (shift or a trackpad's `deltaX` for sideways) and by WASD, it zooms between 0.35 and 3 toward the cursor on ctrl scroll or a pinch and toward the center on the plus and minus keys, it keeps its inertia, and it eases up to follow a room built off the edge; all GPU transforms. Reduced motion: no inertia, no particles, instant transitions.
- Procedural art: `render/art/*.ts` draws each room kind into a `RenderTexture` once per (kind, width, variant, lit) and reuses it. Windows light up by occupancy at night.
- Lighting: sky gradient keyed to minuteOfDay, tower tint, window glow after dusk, headlight streaks on the ground road at rush hour.
- Sims: 2x4 tile sprites with a stress tint, walking animation by x delta, batched in a `ParticleContainer` when more than 500.
- Reconcile: the static tower is rewritten only when `world.structureVersion` (bumped by every sim writer of a field the tower draws, never saved or hashed), the night lit state or the world object changes. Motion: `render/interpolate.ts` snapshots car and sim positions before the last tick of a batch and draws at the fractional accumulator; a move past the teleport threshold snaps, and a replaced world resets it.

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
- Rendering logic is unit tested in `tests/render/` against a stub renderer (reconcile, crowd sample, interpolation, connectors); how it looks is verified in a real browser, recorded in `.itworks/REVIEWS.md`.
