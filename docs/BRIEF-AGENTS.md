# Implementer brief: module contracts

Read first: docs/DESIGN.md, src/sim/types.ts, src/sim/rules.ts, src/sim/world.ts. Renderer and UI agents also read docs/VISUAL.md.

## Rules for every agent
- Touch only the files named in your task. Never edit types.ts, rules.ts, world.ts, or another module's file. If a type or helper you need is missing, define it locally in your own file and say so in your report.
- Do not run git commit or git add. The orchestrator commits.
- Stub files already exist for every sim module with the exact exported signatures below. Replace the body, keep the signatures.
- Sim modules: no DOM, no Date, no Math.random; use world.rng. Every number comes from rules.ts.
- Verification is one pass (Matt, 2026-09-23). Run your own new tests and a narrow typecheck while you work; run the full `npm test`, `npm run typecheck` and `npm run build` once, at the end, never after every edit. No sweep, closeout, version bump or deploy inside a package: one closeout and one deploy cover the whole run, and Claude runs the deploy, never Matt.
- Tests: vitest, under tests/sim/<module>.test.ts (or tests/scenarios/). Run only your file: `npx vitest run tests/sim/<module>.test.ts`. Typecheck with `npx tsc --noEmit 2>&1 | grep -E 'src/(sim|render|ui|game)/<yourfile>'`; other agents' files may be mid-edit, only yours must be clean.
- Report under 300 words: files, exported API as built, test names and counts, anything you had to define locally, anything you could not do.
- UI strings: plain English, US spelling, sentence case, no em dashes or hyphens used as dashes.

## Common helpers you may rely on
- `createWorld(seed)`, `allocId`, `log`, `addRoom/removeRoom`, `addShaft/removeShaft`, `addSim/removeSim`, `rebuildFloorIndex`, `roomsOnFloor`, `shaftsOnFloor`, `roomAt`, `shaftAt`, `groundLobby`, `roomsOfKind` from world.ts.
- `clockOf(minute)` from types.ts.

## Test world helper
For tests, build rooms and shafts directly with addRoom/addShaft (construct the objects by hand with allocId) rather than through build.ts, unless you are testing build.ts. A minimal tower: lobby segments on floor 1 from x=100 to x=140, an office on floor 2 at x=100, a standard shaft at x=150 floors 1 to 10 with stops 1..10 and one car.

## Module contracts

### sim/build.ts
```ts
export function applyCommand(world: World, cmd: Command): CommandResult;
export function canBuild(world: World, kind: RoomKind, floor: number, x: number): CommandResult; // ghost preview, no mutation
export function canBuildShaft(world: World, kind: ShaftKind, x: number, floorMin: number, floorMax: number): CommandResult;
```
Rules: star gate (ROOMS[kind].star, SHAFTS[kind].star) reason "Needs 3 stars."; cash via `spend` from economy.ts reason "Not enough cash. Offices cost $40,000."; bounds 0..TOWER_WIDTH and MIN_FLOOR..MAX_FLOOR; placement above/underground; no overlap with rooms or shafts; floor support: floor f > 1 needs any room on f-1, floor -k needs any room on -(k-1) or the ground lobby for -1; lobby only on floor 1; skyLobby only on LIMITS.skyLobbyFloors, occupies 3 floors; maxCount per kind; maxShafts; shaft span per SHAFTS.maxSpan; a shaft is built with one car included in shaftCost; standard and service default stops every floor in span; express default stops are floor 1, sky lobby floors, and underground floors within its span, and setStop on any other floor is refused "Express elevators stop only at lobbies and underground floors."; shaft.extend keeps stops and adds defaults; addCar up to maxCars charging carCost; removeCar refuses the last car and any car with passengers; shaft.demolish refuses when any car has passengers "Wait until the cars are empty."; demolish room refuses when occupancy > 0 "People are inside." and removes tenants (state 'gone', removeSim) when vacant; no refunds. Commands bomb.pay and fire.callHelicopter delegate to `handleEventCommand` in events.ts. Every success writes a log line. Cash never goes negative from building.

### sim/routing.ts
```ts
export function ensureRouting(world: World): void; // rebuild cached graph if world.routingDirty
export function findRoute(world: World, from: { floor: number; x: number }, to: { floor: number; x: number }, opts?: { staff?: boolean }): Leg[] | null;
export function isReachableFromLobby(world: World, floor: number, x: number): boolean;
export function entrances(world: World): { floor: number; x: number }[]; // ground lobby left and right ends; metro station center if built
```
Routes: same floor = one walk leg. Vertical moves via shafts that stop at both floors (service shafts only when opts.staff), or stairs/escalator rooms linking floor and floor+1 with at most LIMITS.stairsMaxClimbFloors stair floors per route. Transfers allowed (BFS over floors, cost = transfers * 10 + stair floors * 2 + walk tiles / 50). Prefer the shaft nearest in x. Legs end with `{kind:'walk', toX}` on the destination floor. Do not emit enter legs; callers append them.

### sim/elevators.ts
```ts
export function requestHallCall(world: World, shaftId: Id, floor: number, dir: 1 | -1): void;
export function tickElevators(world: World): void;
export const IDLE_RETURN_MINUTES: number;
```
Per car: SCAN dispatch across hallCalls and car.calls; move `SHAFTS[kind].floorsPerMinute` floors per tick toward the next stop; on reaching a stop open doors for doorOpenMinutes; while doors open, alight passengers whose route[0] is a ride leg with toFloor === floor (set sim.pos = {floor, x: shaft.x}, inCarId null, state 'walking', route.shift()), then board waiting sims on that floor whose route[0] is a ride leg on this shaft (state 'waiting', |sim.pos.x - shaft.x| <= shaft.width + 1) up to capacity (set inCarId, state 'riding', car.calls.add(toFloor)); clear the hall call in the served direction; idle cars return to homeFloor after IDLE_RETURN_MINUTES. Cars in one shaft may pass through each other (decided 2026-09-18 to avoid crossing-demand wedges); cars stay in creation order.

### sim/people.ts
```ts
export function tickPeople(world: World): void;
export function stressBand(stress: number): StressBand;
export const WALK_TILES_PER_MINUTE: number;
```
Owns: tenant intake (a vacant office fills with ROOMS.office.capacity workers on a weekday between SCHEDULES.worker.arriveStart and arriveEnd if isReachableFromLobby; a vacant condo sells via `recordCondoSale` from economy.ts when reachable and eval >= ECONOMY.condoSaleEvalMin, then residents spawn); daily schedules from SCHEDULES for worker, resident, guest (check in from an entrance in the evening into a clean, uninfested, empty hotel room with probability by weekday/weekend; check out in the morning, mark room dirty, call `recordHotelNight`), shopper and diner spawns sized to open commerce capacity, cinema and party hall audiences; housekeeping staff (ROOMS.housekeeping.capacity per office) who walk to dirty hotel rooms via routes with staff: true and clean them in minutesPerRoom; movement along legs at WALK_TILES_PER_MINUTE; at a ride leg walk to shaft.x then state 'waiting', waitStart, requestHallCall; stress += STRESS.perWaitingMinute while waiting, += perStairFloor per stair floor, decays in rooms; at STRESS.giveUp abandon the trip with leaveReason "Gave up waiting for an elevator on floor 12." and head to an entrance; sims with state 'leaving' (set by evaluation.ts or by their own give up) route to the nearest entrance and become 'gone' (removeSim) on arrival; on entering a commerce room call `recordVisit`. Room.occupancy counts sims inside. Sims outside the tower are state 'outside' with pos at an entrance and are not drawn.

### sim/economy.ts
```ts
export function spend(world: World, amount: number, what: string): CommandResult; // refuses when cash < amount
export function onQuarterStart(world: World): void;
export function recordVisit(world: World, room: Room): void;
export function recordHotelNight(world: World, room: Room): void;
export function recordCondoSale(world: World, room: Room): void; // sets vacant false, adds ECONOMY.condoSalePrice
```
onQuarterStart: office rent incomePerQuarter scaled by (0.5 + eval / 2) for non-vacant offices; upkeep per room rule, lobby segments by LIMITS.lobbyUpkeepPerSegmentByStar, shafts upkeepPerQuarterPerCar per car; write stats.lastQuarter and reset incomeByKind/upkeepByKind; bankruptcy when cash < ECONOMY.bankruptAtCash for bankruptAfterQuarters consecutive quarters sets world.gameOver with a plain reason. Commerce income per visit from ECONOMY per kind, hotel nights from incomePerQuarter * hotelNightlyIncomeFraction.

### sim/stars.ts
```ts
export function recomputeStars(world: World): void;
export function populationOf(world: World): number; // non-vacant offices * 6, sold condos * 3, occupied hotel rooms by capacity
```
Ladder from STARS; a star is granted when population and every `requires` key hold; stars can fall by population only, never below 1; log on change; star 6 also needs stats.weddingsHeld > 0.

### sim/evaluation.ts
```ts
export function tickEvaluation(world: World): void; // called hourly by tick.ts
```
Per room eval per DESIGN section 7 using EVAL and NOISE; noise neighbors by tile distance on the same floor and vertical overlap; hotel dirty and infested penalties; lowEvalSinceMinute bookkeeping; after EVAL.leaveAfterMinutes below leaveThreshold, tenants leave: office and condo become vacant, each tenant sim gets state 'leaving' and leaveReason such as "Too noisy next to the fast food on floor 3." and stats.tenantsLeftReasons counts the reason.

### sim/events.ts
```ts
export function tickEvents(world: World): void;
export function handleEventCommand(world: World, cmd: Extract<Command, { kind: 'bomb.pay' | 'fire.callHelicopter' }>): CommandResult;
```
Per EVENTS rules: fire (random room, spreads to same-floor neighbors every spreadMinutes; a security office present puts it out securityPutOutMinutes per room; helicopter command charges helicopterCost and ends it; each burned room is damaged: demolished with damagePerRoom charged), bomb (ransom dialog via log level 'alert'; pay charges ransom; with security present it is found after floors * securitySearchMinutesPerFloor; otherwise detonates at detonateAtMinuteOfDay destroying damageRooms rooms near the bomb and charging damageCash), VIP (spawn a 'vip' sim into a free suite, score from waits, set stats.vipRating), cockroaches (hotel rooms dirty for dirtyDaysBeforeInfested days become infested and spread to adjacent hotel rooms every spreadDays), Santa (year end, cosmetic event with x sweeping across the tower), wedding (when stars >= 5, a cathedral exists and it is weekend noon: run for durationMinutes then stats.weddingsHeld++).

### sim/save.ts
```ts
export const SAVE_VERSION = 1;
export function serialize(world: World): string; // JSON text
export function deserialize(text: string): { ok: true; world: World } | { ok: false; reason: string };
export function hashWorld(world: World): string; // FNV-1a 32 bit hex over canonical serialization without the log
```
Maps and Sets become arrays; rng state restored with createRng(seed) then re-seeded by the saved state value (add a `restore(state)` helper locally if rng.ts lacks one and report it). Corrupt or foreign text returns ok false with a reason in plain English.

### sim/tick.ts
Written by the orchestrator after the modules land. Order per DESIGN section 5.

### game/api.ts (exists; the UI and renderer build against it)
See the file. The integration agent implements it in game/game.ts.

### render/art.ts
```ts
export interface Art {
  room(kind: RoomKind, width: number, height: number, variant: number, lit: boolean): Texture;
  slab(widthTiles: number): Texture;
  shaft(kind: ShaftKind, floors: number): Texture;
  car(kind: ShaftKind, doorsOpen: boolean): Texture;
  sim(kind: SimKind, band: StressBand, frame: 0 | 1): Texture;
  ghost(widthTiles: number, heightFloors: number, ok: boolean): Texture;
}
export const TILE_PX = 8;
export const FLOOR_PX = 36;
export function createArt(renderer: Renderer): Art; // caches by key; draws with Graphics, generateTexture
```
Pixel art per docs/VISUAL.md world palette: each kind has a distinct interior (desks, beds, tables, shelves, seats, pews) readable at 1x; lit variant shows warm or office-white windows; hotel rooms have a made bed; two variants per kind for visual variety; sims are 2 tiles wide by 4 tiles tall figures in black with a pink or red tint by band and a two-frame walk.

### render/renderer.ts
```ts
export interface Renderer {
  render(world: World, alpha: number): void; // reconcile sprites to world, draw
  camera: { x: number; y: number; zoom: number; panBy(dx: number, dy: number): void; zoomAt(factor: number, sx: number, sy: number): void; centerOn(floor: number, x: number): void };
  screenToTile(sx: number, sy: number): { floor: number; x: number };
  setGhost(g: null | { widthTiles: number; heightFloors: number; floor: number; x: number; ok: boolean }): void;
  setSelection(sel: null | { roomId?: Id; simId?: Id; shaftId?: Id }): void;
  onPick(cb: (hit: { roomId?: Id; simId?: Id; shaftId?: Id; floor: number; x: number }) => void): void;
  setReducedMotion(on: boolean): void;
  destroy(): void;
}
export async function createRenderer(container: HTMLElement, world: World): Promise<Renderer>;
```
Layers, camera, sky, lighting, sprite reconciliation per DESIGN section 9 and VISUAL. Uses createArt from render/art.ts (being written concurrently; build against the Art interface, and if art.ts is not there yet at run time, write a temporary local `fallbackArt` of flat colored rectangles inside renderer.ts and keep it as the WebGL-less fallback).

### ui/ui.ts
```ts
export function createUi(root: HTMLElement, game: GameApi): { destroy(): void; update(): void };
```
DOM and CSS per docs/VISUAL.md: top strip, left palette (directory board), query panel, finances, event ticker and log, settings with save, load, export, import, new game with seed, reduced motion. Uses GameApi only. Styles in src/ui/ui.css imported from ui.ts. Fonts via a Google Fonts link injected once. Keyboard: space pauses, 1 2 3 set speed, Escape clears the tool.
