// The design pass contact sheet: the 17 fresh shots docs/reviews/2026-09-25-design-pass-brief.md
// section 3 lists, then the five the design pass packages retake with (dusk, the far zoom, the
// light dock, watch mode, the placement beat).
//
//   node scripts/make-design-sheet.mjs                    build both bundles into a temp dir, preview them, shoot
//   node scripts/make-design-sheet.mjs --no-build         serve the dist-app/ and dist/ already built in the repo
//   node scripts/make-design-sheet.mjs --only a,b,c       shoot only the named shots (a name not in SHOTS: exit 2)
//   node scripts/make-design-sheet.mjs --out <dir>        write the PNGs and NOT-CAPTURED.md there (relative to the repo root)
//   node scripts/make-design-sheet.mjs --textures         print the texture budget from the dev server and exit
//
// The machinery is scripts/make-store-shots.mjs: the app bundle served with `vite preview --mode
// app` for the game, headless Chrome on a fresh profile over the DevTools protocol (SwiftShader,
// so colours are true), the committed demo tower seeded into IndexedDB, the game opened and
// paused, and a PNG capture. The site shots need the landing pages, which only the web bundle
// carries, so a second preview serves that. The 404 shot is served by `wrangler dev` over the web
// bundle instead, since vite preview falls back to index.html and only the Worker's
// not_found_handling (wrangler.jsonc) serves 404.html.
//
// Several agents may run this at once in the same checkout, so a run shares nothing: both bundles
// are built with `vite build --outDir` into a fresh directory under the OS temp dir and previewed
// from there, every server takes a free port, and the temp dir is removed at the end. --no-build
// serves the repo's dist-app/ and dist/ instead.
//
// Each game shot seeds a temporary copy of the fixture with the clock moved to the shot's time,
// and every per-person minute stamp (waitStart, stayUntil, storyTripStart, a guard's pauseUntil,
// a collector's until) moved by the same delta, so a wait keeps its age; the committed fixture is
// never written. The game is paused before its first tick (a script injected ahead of the page
// clicks Pause the moment the ui mounts), so the tower is the fixture as seeded and the clock reads
// the shot's time exactly; a clock that does not is one line in NOT-CAPTURED.md, and the shot is
// still taken. The seed step's ?new page is paused at mount the same way, so it never saves its
// empty lot over the fixture when it unloads. The seed is checked too: the status bar cash must read the fixture's cash, or the
// page is loaded once more, and a tower that still is not the fixture is one line in
// NOT-CAPTURED.md ("fixture did not seed") and no capture. The room and person shots click a target the fixture puts inside the canvas band
// the chrome leaves free at the opening view, and the ghost and place shots aim at the same view:
// openingView models renderer.ts frameInitial (since design pass package P1, the whole tower at
// zoom 0.5 when it fits the band, else zoom 1 with the street at camera.ts openingGroundLine). The
// far zoom sends ctrl wheel notches (a plain wheel pans, src/render/input.ts). A state that does not show its DOM within 5 seconds
// is skipped, with one line in NOT-CAPTURED.md. Output: docs/reviews/design-pass-2026-09-25/sheet/
// unless --out says otherwise (gitignored). Exits 0 whether or not every shot was taken.
//
// --textures starts the dev server (the __hsRender hook is DEV only) with a private cache dir,
// opens /play/?smoke at the desk viewport, and polls window.__hsRender.stats() until the texture
// count and bytes hold still for 3 s (or 30 s pass), then prints one line against the budget.

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CHROME_PATH, FIXTURE, dropAlpha, pngInfo } from './make-store-shots.mjs';
import { TILE_PX, FLOOR_PX, SLAB_PX, SIM_H } from '../src/render/grid.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_DIR = join(ROOT, 'docs', 'reviews', 'design-pass-2026-09-25', 'sheet');
export const NOT_CAPTURED = join(OUT_DIR, 'NOT-CAPTURED.md');

export const VIEWPORTS = {
  desk: { w: 1440, h: 900, dpr: 2, mobile: false },
  phone: { w: 390, h: 844, dpr: 2, mobile: true },
};

/**
 * The fixed shot list: brief section 3, then the design pass shots. Game shots carry an hour (or
 * a minute of the day) and a state; site shots a page and a theme. `ghost` writes two files,
 * -ghost-ok and -ghost-refused, and `place` three, -place-0, -place-200 and -place-600; each
 * counts as one shot. `theme` on a game shot sets hs.theme before the game loads.
 */
export const SHOTS = [
  { name: 'game-desk-z1-1300', viewport: 'desk', hour: 13, state: 'opening' },
  { name: 'game-desk-z1-2300', viewport: 'desk', hour: 23, state: 'opening' },
  { name: 'game-desk-z1-1300-dock', viewport: 'desk', hour: 13, state: 'dock' },
  { name: 'game-desk-z1-1300-person', viewport: 'desk', hour: 13, state: 'person' },
  { name: 'game-desk-z1-1300-room', viewport: 'desk', hour: 13, state: 'room' },
  { name: 'game-desk-z1-1300-settings', viewport: 'desk', hour: 13, state: 'settings' },
  { name: 'game-desk-z1-1300-views', viewport: 'desk', hour: 13, state: 'views' },
  { name: 'game-desk-z1-0900-fire', viewport: 'desk', hour: 9, state: 'fire' },
  { name: 'game-desk-z1-1300-ghost', viewport: 'desk', hour: 13, state: 'ghost' },
  { name: 'game-phone-z1-1300', viewport: 'phone', hour: 13, state: 'opening' },
  { name: 'game-phone-z1-1300-sheet', viewport: 'phone', hour: 13, state: 'sheet' },
  { name: 'game-phone-z1-1300-person', viewport: 'phone', hour: 13, state: 'person' },
  { name: 'site-home-desk-light', viewport: 'desk', page: '/', theme: 'light', state: 'site' },
  { name: 'site-home-desk-dark', viewport: 'desk', page: '/', theme: 'dark', state: 'site' },
  { name: 'site-home-phone-light', viewport: 'phone', page: '/', theme: 'light', state: 'site' },
  { name: 'site-guide-desk-light', viewport: 'desk', page: '/how-to-play/', theme: 'light', state: 'site' },
  { name: 'site-404-desk-light', viewport: 'desk', page: '/nothing-here', theme: 'light', state: 'site' },
  { name: 'game-desk-z1-1830', viewport: 'desk', minute: 1110, state: 'opening' },
  { name: 'game-desk-zfar-2200', viewport: 'desk', hour: 22, state: 'zoomout' },
  { name: 'game-desk-z1-1300-dock-light', viewport: 'desk', hour: 13, state: 'dock', theme: 'light' },
  { name: 'game-desk-z1-1300-watch', viewport: 'desk', hour: 13, state: 'watch' },
  { name: 'game-desk-z1-1300-place', viewport: 'desk', hour: 13, state: 'place' },
];

const STATE_TIMEOUT_MS = 5000;
/** src/render/camera.ts DEFAULT_GROUND_LINE: the street sits at least this far down the free band. */
const DEFAULT_GROUND_LINE = 0.68;
/**
 * src/render/renderer.ts OPENING_WHOLE_TOWER and OPENING_ZOOM (lines 788 and 789): the game opens
 * on the whole tower at 0.5 when it fits. Copied because renderer.ts imports pixi;
 * tests/design/sheet.test.ts holds the copies to the originals.
 */
export const OPENING_WHOLE_TOWER = true;
export const OPENING_ZOOM = 0.5;
/** src/sim/types.ts TOWER_WIDTH, MAX_FLOOR, MIN_FLOOR; camera.ts PAN_MARGIN_PX (30 tiles). */
const TOWER_WIDTH = 375;
const MAX_FLOOR = 100;
const MIN_FLOOR = -10;
const PAN_MARGIN_PX = 30 * TILE_PX;
/**
 * The .hs-panel-title-text the panels write (src/ui/sheet.ts lines 197 and 198): the settings
 * sheet's title, and for a room its rule label (src/ui/panels.ts roomPanel, line 271; rules.ts).
 */
const SETTINGS_TITLE = 'Settings';
const ROOM_KIND = 'restaurant';
const ROOM_TITLE = 'Restaurant';
/** The ghost: an office on floor 2 over the lobby's free end (placeable), then the sky past the lot's east edge (refused). */
const GHOST_OK = { floor: 2, x: 168 };
const GHOST_SKY = { floor: 6, x: 181 };
/** src/ui/palette.ts GROUPS: the Office tile sits under this tab (the tab's aria-label; its title adds the key). */
const OFFICE_TAB = 'Shops and fun';
/** The Settings switch the watch shot turns on (the feature lands later in the design pass). */
const WATCH_LABEL = 'Watch mode';
const WATCH_IDLE_MS = 25000;
/** The placement beat: captures this many ms after the click. */
const PLACE_OFFSETS_MS = [0, 200, 600];
/** src/ui/build.ts PHONE_MAX_WIDTH: at or under it the palette is the bottom sheet (ui.ts watchChrome). */
const PHONE_MAX_WIDTH = 720;

/**
 * The far zoom. One wheel notch is 120 px of deltaY; src/render/camera.ts wheel() multiplies the
 * zoom by exp(-deltaY * 0.0022), clamped to 0.5..2, and clamps the zoom to MIN_ZOOM..MAX_ZOOM;
 * SNAP_STOPS is MIN_ZOOM then SNAP_ZOOMS. tests/design/sheet.test.ts holds these to camera.ts.
 */
export const WHEEL_NOTCH = 120;
const WHEEL_ZOOM_RATE = 0.0022;
const CAMERA_MIN_ZOOM = 0.175;
const CAMERA_SNAP_STOPS = [CAMERA_MIN_ZOOM, 0.5, 1, 2, 3];
const WHEEL_GAP_MS = 100;
const SNAP_SETTLE_MS = 600;
/** src/render/input.ts wheelGesture: a plain wheel pans, only ctrl or meta zooms. CDP modifier bit 2 is Ctrl. */
const CDP_CTRL = 2;

/** The texture budget: brief section 2, the 2026-09-23 baseline at DPR 2, and the ceiling as a ratio of it. */
const TEXTURE_BASELINE = 3906560;
const TEXTURE_POLL_MS = 500;
const TEXTURE_STEADY_MS = 3000;
const TEXTURE_TIMEOUT_MS = 30000;
const WRANGLER_TIMEOUT_MS = 30000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ flags

/**
 * The command line: --no-build, --only a,b,c (every name must be in SHOTS), --out <dir> (relative
 * to the repo root), --textures. Throws on anything else; main turns that into exit 2.
 */
export function parseArgs(argv) {
  const args = { only: null, out: OUT_DIR, build: true, textures: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-build') args.build = false;
    else if (a === '--textures') args.textures = true;
    else if (a === '--only' || a === '--out') {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`${a} needs a value`);
      if (a === '--out') args.out = resolve(ROOT, value);
      else {
        const names = value.split(',').map((n) => n.trim()).filter((n) => n !== '');
        const known = new Set(SHOTS.map((s) => s.name));
        const unknown = names.filter((n) => !known.has(n));
        if (names.length === 0) throw new Error('--only needs at least one shot name');
        if (unknown.length > 0) throw new Error(`--only: not in SHOTS: ${unknown.join(', ')}`);
        args.only = names;
      }
    } else throw new Error(`unknown flag ${a}`);
  }
  return args;
}

// ------------------------------------------------------------------ the fixture at a time

/** The minute of the day a game shot asks for: its `minute`, or its `hour` on the hour. */
export function shotMinuteOfDay(shot) {
  return shot.minute ?? shot.hour * 60;
}

/**
 * What the status bar clock reads at a minute of the day: src/ui/format.ts formatClock, which
 * src/ui/status.ts (lines 382 to 385) writes into .hs-status-clock .hs-readout-value as the digits
 * and " AM" or " PM". tests/design/sheet.test.ts holds this copy to the original.
 */
export function clockText(minuteOfDay) {
  const hour = Math.floor(minuteOfDay / 60) % 24;
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minuteOfDay % 60).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

/**
 * What the status bar cash reads for an amount: src/ui/format.ts formatMoney (lines 21 to 25, over
 * formatCount), which src/ui/status.ts (line 333) writes into .hs-status-cash .hs-readout-value.
 * tests/design/sheet.test.ts holds this copy to the original.
 */
export function cashText(dollars) {
  const whole = Math.round(dollars);
  const digits = String(Math.abs(whole));
  let grouped = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) grouped += ',';
    grouped += digits.charAt(i);
  }
  return `${whole < 0 ? '-' : ''}$${grouped}`;
}

/**
 * Did the seed take: does the status bar cash, read after the pause at mount (before any tick),
 * show the seeded save's cash? A game that opened some other tower (an empty lot) does not.
 */
export function seedTook(save, shownCash) {
  return String(shownCash ?? '').trim() === cashText(save.cash);
}

/** Moves a minute stamp by delta; null and absent stay as they are. */
function shiftStamp(holder, key, delta) {
  if (holder && typeof holder[key] === 'number') holder[key] += delta;
}

/**
 * The fixture's save with the clock at a minute of the day. The save's `minute` is the absolute
 * game minute (src/sim/save.ts, world.time.minute); the day is kept so the weather and every dated
 * record in the fixture stay as they are, and only the minute of the day moves. Every per-person
 * stamp in that same clock (src/sim/types.ts Sim: waitStart, stayUntil, storyTripStart;
 * GuardState.pauseUntil; CollectorState.until) moves by the same delta, so a wait that was two
 * minutes old is still two minutes old.
 */
export function fixtureAtMinute(saveText, minuteOfDay) {
  const save = JSON.parse(saveText);
  const before = save.minute;
  save.minute = Math.floor(save.minute / 1440) * 1440 + minuteOfDay;
  const delta = save.minute - before;
  for (const sim of save.sims ?? []) {
    shiftStamp(sim, 'waitStart', delta);
    shiftStamp(sim, 'stayUntil', delta);
    shiftStamp(sim, 'storyTripStart', delta);
    shiftStamp(sim.guard, 'pauseUntil', delta);
    shiftStamp(sim.collector, 'until', delta);
  }
  return JSON.stringify(save);
}

/** The fixture at an hour on the hour. */
export function fixtureAtHour(saveText, hour) {
  return fixtureAtMinute(saveText, hour * 60);
}

/** The camera's opening x in world px on the zoom 1 path: renderer.ts frameInitial centers on the rooms' mean x. */
export function openingCameraX(save) {
  let total = 0;
  for (const r of save.rooms) total += r.x + r.width / 2;
  const x = save.rooms.length === 0 ? TOWER_WIDTH / 2 : total / save.rooms.length;
  return (Math.round(x) + 0.5) * TILE_PX;
}

/** World px of a floor's top edge (camera.ts floorTopY): floor 1 spans -FLOOR_PX to 0. */
function floorTopY(floor) {
  return -(floor > 0 ? floor : floor + 1) * FLOOR_PX + 0;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** renderer.ts towerSpan: the built tower's top floor and lowest floor, 1 with no basement. */
function towerSpan(save) {
  let top = 1;
  let bottom = 1;
  for (const r of save.rooms) { top = Math.max(top, r.floor + r.height - 1); bottom = Math.min(bottom, r.floor); }
  for (const s of save.shafts) { top = Math.max(top, s.floorMax); bottom = Math.min(bottom, s.floorMin); }
  return { top, bottom, built: save.rooms.length + save.shafts.length > 0 };
}

/** renderer.ts wholeTowerGroundLine: the ground line that centres the whole tower at OPENING_ZOOM, or null when it does not fit. */
function wholeTowerGroundLine(top, bottom, bandPx) {
  const roof = floorTopY(top);
  const base = floorTopY(bottom) + FLOOR_PX;
  if (!(bandPx > 0) || (base - roof + FLOOR_PX) * OPENING_ZOOM > bandPx) return null;
  return 0.5 - (((roof + base) / 2) * OPENING_ZOOM) / bandPx;
}

/** renderer.ts builtFloorExtents, folded to the widest span: the leftmost and rightmost built tile edges. */
function builtExtent(save) {
  let min = Infinity;
  let max = -Infinity;
  for (const r of save.rooms) { min = Math.min(min, r.x); max = Math.max(max, r.x + r.width); }
  for (const s of save.shafts) { min = Math.min(min, s.x); max = Math.max(max, s.x + s.width); }
  return { min, max };
}

/**
 * The camera at the opening view, as renderer.ts frameInitial sets it (lines 1076 to 1103 with
 * design pass package P1): the whole tower at OPENING_ZOOM, centred sideways on the built extent,
 * when it fits the band under the top bar; otherwise zoom 1 on the rooms' mean x with the street at
 * camera.ts openingGroundLine (clamp((top + 1) * FLOOR_PX * zoom / band, 0.68, phone ? 0.8 : 0.9)).
 * The band is the canvas under the top bar: ui.ts hands the renderer viewInsets, whose bottom is 0.
 * Then camera.ts centerOn, setGroundLine and clampPosition. `geo` is measureGeo's.
 */
export function openingView(save, geo) {
  const band = geo.height - geo.bar;
  const span = towerSpan(save);
  const whole = OPENING_WHOLE_TOWER && span.built ? wholeTowerGroundLine(span.top, span.bottom, band) : null;
  let zoom = 1;
  let x;
  let line;
  if (whole !== null) {
    const { min, max } = builtExtent(save);
    zoom = OPENING_ZOOM;
    // centerOn(6, (min + max) / 2 - 0.5) aims at that tile's middle: the extent's middle.
    x = ((min + max) / 2) * TILE_PX;
    line = whole;
  } else {
    x = openingCameraX(save);
    line = clamp(((span.top + 1) * FLOOR_PX * zoom) / band, DEFAULT_GROUND_LINE, geo.width <= PHONE_MAX_WIDTH ? 0.8 : 0.9);
  }
  // setGroundLine: the street at `line` down the band, solved for the camera's centre y.
  const screenY = geo.bar + line * band;
  const y = (geo.height / 2 - screenY) / zoom;
  return {
    zoom,
    x: clamp(x, -PAN_MARGIN_PX, TOWER_WIDTH * TILE_PX + PAN_MARGIN_PX),
    y: clamp(y, floorTopY(MAX_FLOOR) - PAN_MARGIN_PX, floorTopY(MIN_FLOOR) + FLOOR_PX + PAN_MARGIN_PX),
  };
}

// ------------------------------------------------------------------ targets at the opening view

/**
 * The CSS point of a world position at the opening view (camera.ts worldToScreen on openingView),
 * and whether it lies in the band the chrome leaves free. `geo` is the canvas rect, `bar` the top
 * bar's bottom and `bottomCover` what the phone sheet covers at the bottom (ui.ts watchChrome,
 * layout.ts chromeInsets), all css px.
 */
export function projectPoint(save, geo, wx, wy) {
  const view = openingView(save, geo);
  const x = Math.round(geo.left + (wx - view.x) * view.zoom + geo.width / 2);
  const y = Math.round(geo.top + (wy - view.y) * view.zoom + geo.height / 2);
  const inView = x >= geo.left && x < geo.left + geo.width && y >= geo.top + geo.bar && y < geo.top + geo.height - (geo.bottomCover ?? 0);
  return { x, y, inView };
}

/**
 * The tile of a room to click: the one nearest its middle that no shaft covers on the room's
 * floor and no standing person is on. renderer.ts pickTargetAt (line 241) takes a shaft over a
 * room that does not draw over it, and pickAt (line 2110) takes a drawn person over both, so the
 * middle of the demo restaurant (x 112, inside the shaft at 110 to 113) selected the elevator.
 */
function roomAimTile(save, room) {
  const blocked = (x) =>
    save.shafts.some((s) => room.floor >= s.floorMin && room.floor <= s.floorMax && x >= s.x && x < s.x + s.width) ||
    save.sims.some((p) => p.pos && p.pos.floor === room.floor && p.state !== 'inRoom' && Math.abs(p.pos.x - x) < 1.5);
  const mid = room.x + Math.floor(room.width / 2);
  for (let d = 0; d < room.width; d++) {
    for (const x of [mid - d, mid + d]) if (x >= room.x && x < room.x + room.width && !blocked(x)) return x;
  }
  return null;
}

/**
 * The restaurant the room shot clicks: of the fixture's restaurants with a clear tile, the one
 * whose aim point lies inside the band, nearest the band's centre. `candidates` are all of them,
 * nearest first.
 */
export function pickRoom(save, geo) {
  const mid = { x: geo.left + geo.width / 2, y: geo.top + (geo.bar + geo.height - (geo.bottomCover ?? 0)) / 2 };
  const candidates = save.rooms
    .filter((r) => r.kind === ROOM_KIND)
    .map((r) => ({ r, tile: roomAimTile(save, r) }))
    .filter(({ tile }) => tile !== null)
    .map(({ r, tile }) => ({ what: `${ROOM_KIND} ${r.id} floor ${r.floor} x ${r.x} (tile ${tile})`, tile, ...projectPoint(save, geo, (tile + 0.5) * TILE_PX, floorTopY(r.floor) + FLOOR_PX / 2) }))
    .sort((a, b) => Math.hypot(a.x - mid.x, a.y - mid.y) - Math.hypot(b.x - mid.x, b.y - mid.y));
  return { target: candidates.find((c) => c.inView) ?? null, candidates };
}

/** renderer.ts inCrowd (lines 701 to 705): one sim in four is drawn, by id, plus the recurring characters. */
const CROWD_ONE_IN = 4;
const ALWAYS_DRAWN = new Set(['guard', 'collector', 'vip', 'thief']);
/** renderer.ts simMoves (line 753): these stand where their pos says; anyone else in a room sits in a slot. */
const STANDING = new Set(['walking', 'waiting', 'leaving']);

/**
 * Where the renderer draws a person, feet in world px, or null when it does not draw them (and
 * pickSimAt, line 720, would not pick them). renderer.ts drawn and simIsVisible (lines 879 and
 * 689): not riding, outside or gone, and in the one-in-four sample. A standing person is drawn at
 * pos.x * TILE_PX on the slab top (simFeetY, line 685). A person in a room sits at inRoomSlot
 * (line 761), whose index counts the room's drawn occupants in world order; only the first,
 * index 0 at tile room.x + 1, is modelled here, so a later occupant is not a candidate.
 */
function drawnFeet(save, sim, firstInRoom) {
  if (!sim.pos || sim.state === 'gone' || sim.state === 'outside' || sim.state === 'riding' || sim.inCarId !== null) return null;
  if (!(sim.id % CROWD_ONE_IN === 0 || ALWAYS_DRAWN.has(sim.kind))) return null;
  const slabTop = (floor) => floorTopY(floor) + FLOOR_PX - SLAB_PX;
  if (STANDING.has(sim.state) || sim.inRoomId === null) return { x: sim.pos.x * TILE_PX, y: slabTop(sim.pos.floor), floor: sim.pos.floor, standing: true };
  const room = save.rooms.find((r) => r.id === sim.inRoomId);
  if (!room) return { x: sim.pos.x * TILE_PX, y: slabTop(sim.pos.floor), floor: sim.pos.floor, standing: true };
  if (firstInRoom.get(room.id) !== sim.id) return null;
  const inside = sim.pos.floor >= room.floor && sim.pos.floor < room.floor + room.height;
  const floor = inside ? sim.pos.floor : room.floor;
  return { x: Math.min(room.x + 1, room.x + room.width - 1) * TILE_PX, y: slabTop(floor), floor, standing: false };
}

/**
 * The person the person shots click: anyone the renderer draws, on any floor, the lobby first,
 * then the lowest floor; standing before sitting in a room, waiting before walking; then nearest
 * the camera. The first whose middle (SIM_H / 2 over the feet) lies inside the band.
 */
export function pickPerson(save, geo) {
  const camX = openingView(save, geo).x;
  const firstInRoom = new Map();
  for (const sim of save.sims) {
    if (sim.state !== 'inRoom' || sim.inRoomId === null || sim.inCarId !== null) continue;
    if (!(sim.id % CROWD_ONE_IN === 0 || ALWAYS_DRAWN.has(sim.kind))) continue;
    if (!firstInRoom.has(sim.inRoomId)) firstInRoom.set(sim.inRoomId, sim.id);
  }
  const people = save.sims.flatMap((sim) => {
    const feet = drawnFeet(save, sim, firstInRoom);
    return feet && feet.floor !== 0 ? [{ sim, feet }] : [];
  });
  const floorRank = (f) => (f === 1 ? -Infinity : f);
  const stateRank = ({ sim, feet }) => (!feet.standing ? 2 : sim.state === 'waiting' ? 0 : 1);
  people.sort((a, b) =>
    floorRank(a.feet.floor) - floorRank(b.feet.floor) ||
    stateRank(a) - stateRank(b) ||
    Math.abs(a.feet.x - camX) - Math.abs(b.feet.x - camX));
  const candidates = people.map(({ sim, feet }) => ({
    what: `${sim.kind} ${sim.id} (${sim.state}) floor ${feet.floor} x ${feet.x / TILE_PX}`,
    ...projectPoint(save, geo, feet.x, feet.y - SIM_H / 2),
  }));
  return { target: candidates.find((c) => c.inView) ?? null, candidates };
}

/**
 * The far zoom: how many notches take the opening zoom (`from`; 1 before package P1, 0.5 for the
 * desk demo tower since) to the lowest snap stop below 0.5, and the zoom it lands on.
 */
export function zoomOutPlan(from = 1) {
  const target = Math.min(...CAMERA_SNAP_STOPS.filter((z) => z < 0.5));
  const factor = Math.min(Math.max(Math.exp(-WHEEL_NOTCH * WHEEL_ZOOM_RATE), 0.5), 2);
  let zoom = from;
  let notches = 0;
  while (zoom > target && notches < 100) {
    zoom = Math.max(zoom * factor, CAMERA_MIN_ZOOM);
    notches++;
  }
  return { notches, zoom };
}

// ------------------------------------------------------------------ processes (copied from the store script)

function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

async function waitForHttp(url, tries = 100) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  throw new Error(`nothing answered at ${url}`);
}

const VITE = join(ROOT, 'node_modules', '.bin', 'vite');

/** `mode` 'app' serves the app bundle (the game at the root), null the web bundle (the site), from `outDir`. */
async function startPreview(mode, outDir) {
  const port = await freePort();
  const args = ['preview', ...(mode ? ['--mode', mode] : []), '--outDir', outDir, '--host', '127.0.0.1', '--port', String(port), '--strictPort'];
  const child = spawn(VITE, args, { cwd: ROOT, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  await waitForHttp(`${base}/`);
  return { base, stop: () => child.kill() };
}

/** Stops a detached child and everything it started (npx, wrangler, workerd). */
async function stopGroup(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((res) => child.once('exit', res));
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
  if (await Promise.race([exited.then(() => true), sleep(5000).then(() => false)])) return;
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
}

/**
 * `wrangler dev` over a web bundle, local, on a free port: the Worker's assets config
 * (wrangler.jsonc, not_found_handling 404-page) is what serves 404.html for a path with no file.
 * Its local state goes under the run's temp dir. Resolves { base, stop } or { error }.
 */
async function startWrangler(assetsDir, tmp) {
  const port = await freePort();
  const args = ['wrangler', 'dev', '--local', '--assets', assetsDir, '--port', String(port), '--ip', '127.0.0.1', '--persist-to', join(tmp, 'wrangler-state')];
  const child = spawn('npx', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let tail = '';
  const keep = (chunk) => { tail = (tail + chunk.toString()).slice(-2000); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitForHttp(`${base}/`, WRANGLER_TIMEOUT_MS / 200);
    return { base, stop: () => stopGroup(child) };
  } catch {
    await stopGroup(child);
    // eslint-disable-next-line no-control-regex
    const last = tail.replace(/\x1b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim()).filter(Boolean).slice(-2).join(' / ');
    const exited = child.exitCode !== null ? `exited ${child.exitCode}` : 'still starting';
    return { error: `npx ${args.join(' ')} did not answer at ${base}/ within ${WRANGLER_TIMEOUT_MS / 1000} s (${exited}): ${last.slice(0, 240) || 'no output'}` };
  }
}

/**
 * The dev server, for --textures: the __hsRender hook exists only in a DEV build. Vite has no
 * cacheDir flag, so a two line config in the run's temp dir extends vite.config.ts with a private
 * cacheDir, and no other run shares its optimized deps.
 */
async function startDevServer(tmp) {
  const port = await freePort();
  const config = join(tmp, 'vite.textures.config.mjs');
  writeFileSync(config, `import base from ${JSON.stringify(join(ROOT, 'vite.config.ts'))};
export default (env) => ({ ...(typeof base === 'function' ? base(env) : base), cacheDir: ${JSON.stringify(join(tmp, 'vite-cache'))} });
`);
  const child = spawn(VITE, ['--config', config, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  await waitForHttp(`${base}/`, 300);
  return { base, stop: () => child.kill() };
}

async function launchChrome(angle) {
  const port = await freePort();
  const profile = join(tmpdir(), `hs-design-sheet-${port}`);
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const gpu = angle === 'metal'
    ? ['--use-angle=metal', '--ignore-gpu-blocklist']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const proc = spawn(CHROME_PATH, ['--headless=new', ...gpu, '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--window-size=1440,900', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  let targets = [];
  for (let i = 0; i < 75 && !targets.some((t) => t.type === 'page'); i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    } catch {
      // not up yet
    }
    if (!targets.some((t) => t.type === 'page')) await sleep(200);
  }
  const page = targets.find((t) => t.type === 'page');
  if (!page) {
    proc.kill();
    throw new Error('Chrome did not open a page target');
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) rej(new Error(JSON.stringify(m.error)));
      else res(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  const close = async () => {
    try { ws.close(); } catch { /* already closed */ }
    const exited = new Promise((res) => proc.once('exit', res));
    proc.kill();
    await Promise.race([exited, sleep(3000)]);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      console.log(`left the Chrome profile at ${profile}`);
    }
  };
  return { send, evaluate, close, errors, angle };
}

// ------------------------------------------------------------------ the game (copied from the store script)

const PREFS = {
  'hs.intro.seen': 'true',
  'hs.guide.done': 'true',
  'hs.hintSeen': '3',
  'hs.palette.collapsed': 'true',
  'hs.goals.collapsed': 'true',
  'hs.tips': JSON.stringify(['longWait', 'tenantLeft', 'firstRent', 'firstEvent', 'nightSpeed', 'firstPanel']),
};

/**
 * Writes the save into the game's IndexedDB slot from a `?new` page. That page runs a fresh game
 * in the same My tower slot (src/game/storage.ts SLOT_KEYS, key autosave), and a game that has
 * moved saves on unload (src/game/game.ts onPageHide, line 415): left running, it wrote its empty
 * lot over the fixture when openGame navigated away. So the page is paused at mount, before its
 * first tick (PAUSE_AT_MOUNT); a game that never ticked is not dirty (game.ts line 236), and
 * saveNow (lines 467 and 468) writes nothing, so the fixture written here is the last write.
 * Waiting for that pause also means the page has finished booting before the write. Returns
 * whether the pause took; if it did not, the cash check in openGame is still the guard.
 */
async function seed(browser, base, saveText) {
  const { send, evaluate } = browser;
  const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: PAUSE_AT_MOUNT });
  let paused = false;
  try {
    await send('Page.navigate', { url: `${base}/?new&cb=${Date.now()}` });
    for (let i = 0; i < 30 && !paused; i++) {
      await sleep(500);
      paused = await evaluate('window.__hsSheetPaused === true').catch(() => false);
    }
  } finally {
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => {});
  }
  await evaluate(`(() => { const p = ${JSON.stringify(PREFS)}; for (const k in p) localStorage.setItem(k, p[k]); return true; })()`);
  await evaluate(`new Promise((res, rej) => { const q = indexedDB.open('hundred-stories', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('saves');
    q.onsuccess = () => { const tx = q.result.transaction('saves', 'readwrite'); tx.objectStore('saves').put(${JSON.stringify(saveText)}, 'autosave');
      tx.oncomplete = () => { q.result.close(); res(true); }; tx.onerror = () => rej(tx.error); };
    q.onerror = () => rej(q.error); })`);
  return { paused };
}

async function setViewport(browser, vp) {
  await browser.send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: vp.dpr, mobile: vp.mobile });
  await browser.send('Emulation.setTouchEmulationEnabled', vp.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
}

/** The speed bar's Pause button (src/ui/ui.ts line 300): aria-label Pause, and its click is game.setSpeed(0), not a toggle. */
const PAUSE_BUTTON = `b.textContent.trim() === 'Pause' || b.getAttribute('aria-label') === 'Pause'`;

/**
 * Stops the clock before the first tick. src/main.ts mounts the ui (createUi, line 141) and starts
 * the loop (game.start(), line 142) in one synchronous step, and a tick only ever runs inside an
 * animation frame (src/game/game.ts advance, line 351; the 50 ms timer ticks only in a hidden tab).
 * This runs before the page's own scripts on every new document: a MutationObserver whose callback,
 * a microtask, runs right after that step and before any frame, and clicks Pause.
 */
const PAUSE_AT_MOUNT = `(() => {
  if (window.top !== window) return;
  const mo = new MutationObserver(() => {
    const b = [...document.querySelectorAll('button')].find((b) => ${PAUSE_BUTTON});
    if (!b) return;
    mo.disconnect();
    b.click();
    window.__hsSheetPaused = true;
  });
  mo.observe(document, { childList: true, subtree: true });
})();`;

/**
 * Opens the seeded game and stops its clock before the first tick (PAUSE_AT_MOUNT), so the tower
 * shows the fixture as seeded at the shot's minute. Then the seed check: the status bar cash must
 * read the seeded save's cash (seedTook); if it does not, the page is loaded once more and read
 * again. This checks the seed, it does not retry any state. Returns { clock, cash, early, seeded,
 * reloaded }: the clock and cash texts after the pause, whether the early pause took (if not,
 * Pause was clicked after the fade as before, and the game ran meanwhile), whether the seed took,
 * and whether the one reload was needed.
 *
 * `theme` sets hs.theme (public/theme.js reads it on the game page too) before the game loads; a
 * shot with none clears it, so one shot's theme never carries into the next on the same origin.
 * hs.watchMode (src/ui/prefs.ts) is cleared the same way: the watch shot turns it on itself.
 */
async function openGame(browser, base, vp, name, save, theme = null) {
  const { send, evaluate } = browser;
  await setViewport(browser, vp);
  await evaluate(`(() => { const p = ${JSON.stringify(PREFS)}; for (const k in p) localStorage.setItem(k, p[k]);
    const t = ${JSON.stringify(theme)}; if (t) localStorage.setItem('hs.theme', t); else localStorage.removeItem('hs.theme');
    localStorage.removeItem('hs.watchMode'); return true; })()`);

  /** Loads the game page, waits for the ui and the fade, makes sure it is paused, reads the bar. */
  const load = async () => {
    let mounted = false;
    for (let attempt = 0; attempt < 3 && !mounted; attempt++) {
      await send('Page.navigate', { url: `${base}/?cb=${Date.now()}` });
      for (let i = 0; i < 30 && !mounted; i++) {
        await sleep(500);
        mounted = await evaluate(`!!document.querySelector('#view canvas') && [...document.querySelectorAll('button')].some((b) => ${PAUSE_BUTTON})`).catch(() => false);
      }
    }
    if (!mounted) throw new Error(`the game did not mount at ${name}: ${browser.errors.slice(-3).join(' | ')}`);
    await sleep(2500); // the fade in; the clock is already stopped
    const early = await evaluate('window.__hsSheetPaused === true').catch(() => false);
    if (!early) await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((b) => ${PAUSE_BUTTON}); b && b.click(); return !!b; })()`);
    await sleep(600);
    const bar = await evaluate(`(() => { const t = (s) => (document.querySelector(s)?.textContent ?? '').trim();
      return { clock: t('.hs-status-clock .hs-readout-value'), cash: t('.hs-status-cash .hs-readout-value') }; })()`).catch(() => ({ clock: '', cash: '' }));
    return { ...bar, early };
  };

  const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: PAUSE_AT_MOUNT });
  try {
    let opened = await load();
    let reloaded = false;
    if (!seedTook(save, opened.cash)) {
      reloaded = true;
      opened = await load();
    }
    return { ...opened, seeded: seedTook(save, opened.cash), reloaded };
  } finally {
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => {});
  }
}

async function capture(browser, vp) {
  const r = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const png = dropAlpha(Buffer.from(r.data, 'base64'));
  const info = pngInfo(png);
  if (info.width !== vp.w * vp.dpr || info.height !== vp.h * vp.dpr) throw new Error(`captured ${info.width} by ${info.height}, expected ${vp.w * vp.dpr} by ${vp.h * vp.dpr}`);
  return png;
}

// ------------------------------------------------------------------ states

/** Polls a page expression until it is truthy, for at most STATE_TIMEOUT_MS. */
async function waitFor(browser, expression) {
  const until = Date.now() + STATE_TIMEOUT_MS;
  while (Date.now() < until) {
    if (await browser.evaluate(expression).catch(() => false)) return true;
    await sleep(100);
  }
  return false;
}

/** A page expression that clicks the first visible button matching `test` (a JS predicate on b). */
function clickButton(test) {
  return `(() => { const b = [...document.querySelectorAll('button')].find((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (${test}); }); if (b) b.click(); return !!b; })()`;
}

const BUILD_TEXT = `(b.textContent.trim() === 'Build' || [...b.querySelectorAll('span')].some((s) => s.textContent.trim() === 'Build')) && !b.classList.contains('hs-place-btn')`;
const OFFICE_TILE = `b.classList.contains('hs-tool') && (b.querySelector('.hs-tool-name')?.textContent ?? '').trim() === 'Office'`;

/** A visible .hs-panel whose title text passes `test` (a JS predicate on t). */
function panelShown(test) {
  return `[...document.querySelectorAll('.hs-panel')].some((p) => { const r = p.getBoundingClientRect(); const t = (p.querySelector('.hs-panel-title-text')?.textContent ?? '').trim(); return r.width > 0 && r.height > 0 && (${test}); })`;
}

const DOCK_OPEN = `(() => { const p = document.querySelector('.hs-palette'); return !!p && !p.classList.contains('is-collapsed') && [...p.querySelectorAll('.hs-tool')].some((t) => t.getBoundingClientRect().height > 0); })()`;
const SHEET_OPEN = `(() => { const p = document.querySelector('.hs-palette'); return !!p && (p.classList.contains('is-sheet-row') || p.classList.contains('is-sheet-full')); })()`;
const VIEWS_OPEN = `(() => { const m = document.querySelector('.hs-views-menu'); return !!m && m.getBoundingClientRect().height > 0; })()`;
/** What the placement chip shows, for a skip line: hidden, or its text and whether it is the alert. */
const CHIP_STATE = `(() => { const c = document.querySelector('.hs-place-chip'); if (!c) return 'no .hs-place-chip';
  return c.classList.contains('is-hidden') ? 'the chip is hidden' : 'the chip reads "' + c.textContent.trim().slice(0, 80) + '"' + (c.classList.contains('is-alert') ? ' as an alert' : ''); })()`;
const chipShown = (alert) => `(() => { const c = document.querySelector('.hs-place-chip'); return !!c && !c.classList.contains('is-hidden') && c.classList.contains('is-alert') === ${alert}; })()`;

/** The canvas rect and the chrome over it, css px, as projectPoint takes them. */
async function measureGeo(browser) {
  return browser.evaluate(`(() => { const c = document.querySelector('#view canvas').getBoundingClientRect();
    const t = document.querySelector('.hs-top').getBoundingClientRect(); const s = document.querySelector('.hs-ui').getBoundingClientRect();
    const p = document.querySelector('.hs-palette')?.getBoundingClientRect();
    const shown = !!p && p.height > 0;
    const sheet = shown && (innerWidth <= ${PHONE_MAX_WIDTH} || p.width >= s.width - 1);
    return { left: c.left, top: c.top, width: c.width, height: c.height, bar: t.bottom - s.top, bottomCover: sheet ? Math.max(0, s.height - (p.top - s.top)) : 0 }; })()`);
}

/** The CSS point of a world position at the opening view (projectPoint on the measured chrome). */
async function screenPoint(browser, save, wx, wy) {
  return projectPoint(save, await measureGeo(browser), wx, wy);
}

async function clickAt(browser, p) {
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 });
  await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(60);
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
}

async function pressKey(browser, key, code, keyCode) {
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
}

const OFFICE_TAB_BUTTON = `b.classList.contains('hs-build-tab') && b.getAttribute('aria-label') === ${JSON.stringify(OFFICE_TAB)}`;
const officeTileShown = `(() => [...document.querySelectorAll('.hs-tool')].some((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (${OFFICE_TILE}); }))()`;

/** Build, the Shops and fun tab, the Office tile: the office in hand. Returns a skip reason, or null. */
async function officeInHand(browser) {
  if (!(await browser.evaluate(clickButton(BUILD_TEXT)))) return 'no visible button whose text is Build';
  if (!(await waitFor(browser, DOCK_OPEN))) return 'Build clicked, the dock did not open in 5 s';
  if (!(await browser.evaluate(clickButton(OFFICE_TAB_BUTTON)))) return `the dock is open, no visible .hs-build-tab labelled ${OFFICE_TAB}`;
  if (!(await waitFor(browser, officeTileShown))) return `${OFFICE_TAB} clicked, no visible Office tile in 5 s`;
  if (!(await browser.evaluate(clickButton(OFFICE_TILE)))) return 'the Office tile did not take the click';
  await sleep(300);
  return null;
}

/** A Settings switch whose label (label[for], aria-labelledby or aria-label) reads `label`; clicks it when `click`. */
function settingsSwitch(label, click) {
  return `(() => { const name = (c) => { const l = c.id ? document.querySelector('label[for="' + CSS.escape(c.id) + '"]') : null;
    const by = c.getAttribute('aria-labelledby'); const t = l?.textContent ?? (by ? document.getElementById(by)?.textContent : null) ?? c.getAttribute('aria-label') ?? '';
    return t.trim(); };
    const c = [...document.querySelectorAll('.hs-panel [role="switch"]')].find((c) => name(c) === ${JSON.stringify(label)});
    if (c && ${click ? 'true' : 'false'}) c.click(); return !!c; })()`;
}

const SETTINGS_BUTTON = `['Menu', 'Settings'].includes(b.getAttribute('aria-label') ?? '') || ['Menu', 'Settings'].includes(b.textContent.trim())`;

/**
 * Runs one game shot. `ctx` carries outDir and the run's temp dir. Returns { files: [name...],
 * skipped: [{ name, why }], note } where note is extra detail for the console line.
 */
async function gameShot(browser, base, shot, fixtureText, ctx) {
  const vp = VIEWPORTS[shot.viewport];
  const out = { files: [], skipped: [], note: '' };
  const skip = (why, name = shot.name) => out.skipped.push({ name, why });
  if (shot.state === 'fire') {
    // Only a DEV hook on window (src/main.ts, src/game/game.ts) may raise a fire; there is none.
    skip('no DEV hook on window raises a fire (src/main.ts and src/game/game.ts expose no window.__ hook), so no mechanism in the spec reaches it');
    return out;
  }
  const saveText = fixtureAtMinute(fixtureText, shotMinuteOfDay(shot));
  const save = JSON.parse(saveText);
  // The temp copy the spec asks for, in this run's own temp dir; the committed fixture is not touched.
  const tmp = join(ctx.tmp, `fixture-${shot.name}.json`);
  writeFileSync(tmp, saveText);
  const seeded = await seed(browser, base, readFileSync(tmp, 'utf8'));
  rmSync(tmp, { force: true });
  const opened = await openGame(browser, base, vp, shot.name, save, shot.theme ?? null);
  if (!opened.seeded) {
    // The game opened some other tower (an empty lot at 6 AM, say): no capture of it.
    skip(`fixture did not seed (cash ${opened.cash || 'unread'})`);
    out.note = `clock ${opened.clock || 'unread'}, loaded twice${seeded.paused ? '' : ', the ?new page did not pause at mount'}`;
    return out;
  }
  const expectClock = clockText(shotMinuteOfDay(shot));
  out.note = `clock ${opened.clock || 'unread'}${opened.early ? '' : ', paused late'}${opened.reloaded ? ', seeded on the reload' : ''}${seeded.paused ? '' : ', the ?new page did not pause at mount'}`;
  // A clock that moved means the game ticked before the pause: the tower is not the fixture as
  // seeded. The shot is still taken, and the line says so.
  if (opened.clock !== expectClock) out.skipped.push({ name: shot.name, taken: true, why: `the status bar clock reads "${opened.clock}" after the pause, not "${expectClock}"${opened.early ? '' : ' (the pause at mount did not take; Pause was clicked after the fade)'}; the shot was taken anyway` });

  const shoot = async (name) => {
    writeFileSync(join(ctx.outDir, `${name}.png`), await capture(browser, vp));
    out.files.push(name);
  };

  switch (shot.state) {
    case 'opening':
      await shoot(shot.name);
      break;
    case 'zoomout': {
      const opening = openingView(save, await measureGeo(browser)).zoom;
      const plan = zoomOutPlan(opening);
      const c = await browser.evaluate(`(() => { const r = document.querySelector('#view canvas').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
      await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none', buttons: 0 });
      for (let i = 0; i < plan.notches; i++) {
        if (i > 0) await sleep(WHEEL_GAP_MS);
        await browser.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: c.x, y: c.y, deltaX: 0, deltaY: WHEEL_NOTCH, modifiers: CDP_CTRL });
      }
      await sleep(SNAP_SETTLE_MS);
      out.note += `; zoom ${opening} to ${plan.zoom} after ${plan.notches} notches of ${WHEEL_NOTCH}`;
      await shoot(shot.name);
      break;
    }
    case 'dock':
    case 'sheet': {
      const clicked = await browser.evaluate(clickButton(BUILD_TEXT));
      const expect = shot.state === 'dock' ? DOCK_OPEN : SHEET_OPEN;
      if (!clicked) skip('no visible button whose text is Build');
      else if (!(await waitFor(browser, expect))) skip(shot.state === 'dock' ? 'Build clicked, the dock (.hs-palette without is-collapsed) did not open in 5 s' : 'Build clicked, the sheet (.hs-palette.is-sheet-row or is-sheet-full) did not open in 5 s');
      else { await sleep(400); await shoot(shot.name); }
      break;
    }
    case 'settings': {
      const clicked = await browser.evaluate(clickButton(SETTINGS_BUTTON));
      if (!clicked) skip('no visible button named Menu or Settings');
      else if (!(await waitFor(browser, panelShown(`t === ${JSON.stringify(SETTINGS_TITLE)}`)))) skip('Menu clicked, no .hs-panel titled Settings in 5 s');
      else { await sleep(400); await shoot(shot.name); }
      break;
    }
    case 'watch': {
      if (!(await browser.evaluate(clickButton(SETTINGS_BUTTON)))) { skip('no visible button named Menu or Settings'); break; }
      if (!(await waitFor(browser, panelShown(`t === ${JSON.stringify(SETTINGS_TITLE)}`)))) { skip('Menu clicked, no .hs-panel titled Settings in 5 s'); break; }
      if (!(await waitFor(browser, settingsSwitch(WATCH_LABEL, false)))) { skip(`the Settings panel has no switch labelled ${WATCH_LABEL} within 5 s (the feature has not landed)`); break; }
      await browser.evaluate(settingsSwitch(WATCH_LABEL, true));
      await sleep(200);
      await pressKey(browser, 'Escape', 'Escape', 27);
      await sleep(WATCH_IDLE_MS);
      await shoot(shot.name);
      break;
    }
    case 'views': {
      const clicked = await browser.evaluate(clickButton(`b.textContent.trim() === 'Views'`));
      if (!clicked) skip('no visible button whose text is Views');
      else if (!(await waitFor(browser, VIEWS_OPEN))) skip('Views clicked, .hs-views-menu did not show in 5 s');
      else { await sleep(300); await shoot(shot.name); }
      break;
    }
    case 'room':
    case 'person': {
      const pick = shot.state === 'room' ? pickRoom(save, await measureGeo(browser)) : pickPerson(save, await measureGeo(browser));
      if (pick.candidates.length === 0) { skip(`the fixture has no ${shot.state === 'room' ? `${ROOM_KIND} with a tile clear of shafts and people` : 'person waiting or walking on any floor'}`); break; }
      if (!pick.target) {
        const first = pick.candidates[0];
        const more = pick.candidates.length > 1 ? ` (none of the fixture's ${pick.candidates.length} candidates is inside)` : '';
        skip(`${first.what} is at css (${first.x}, ${first.y}), outside the canvas band under the top bar at the opening view${more}`);
        break;
      }
      const target = pick.target;
      await clickAt(browser, target);
      const expect = shot.state === 'room' ? panelShown(`t === ${JSON.stringify(ROOM_TITLE)}`) : panelShown(`t !== '' && t !== 'Nothing selected' && t !== ${JSON.stringify(ROOM_TITLE)} && t !== 'Lobby'`);
      if (!(await waitFor(browser, expect))) {
        const shown = await browser.evaluate(`[...document.querySelectorAll('.hs-panel')].filter((p) => p.getBoundingClientRect().height > 0).map((p) => (p.querySelector('.hs-panel-title-text')?.textContent ?? '').trim()).join(', ')`).catch(() => '');
        skip(`clicked ${target.what} at css (${target.x}, ${target.y}), no ${shot.state === 'room' ? '.hs-panel titled Restaurant' : 'person .hs-panel'} in 5 s (open: ${shown || 'none'})`);
      }
      else { await sleep(400); out.note += `; ${target.what}`; await shoot(shot.name); }
      break;
    }
    case 'ghost': {
      const why = await officeInHand(browser);
      if (why) { skip(why); break; }
      const ok = await screenPoint(browser, save, (GHOST_OK.x + 0.5) * TILE_PX, floorTopY(GHOST_OK.floor) + FLOOR_PX / 2);
      await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ok.x, y: ok.y, button: 'none', buttons: 0 });
      if (!ok.inView || !(await waitFor(browser, chipShown(false)))) skip(`office over floor ${GHOST_OK.floor} x ${GHOST_OK.x} at css (${ok.x}, ${ok.y}): no placeable .hs-place-chip in 5 s (${await browser.evaluate(CHIP_STATE).catch(() => 'chip unread')})`, `${shot.name}-ok`);
      else { await sleep(300); await shoot(`${shot.name}-ok`); }
      const sky = await screenPoint(browser, save, (GHOST_SKY.x + 0.5) * TILE_PX, floorTopY(GHOST_SKY.floor) + FLOOR_PX / 2);
      await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sky.x, y: sky.y, button: 'none', buttons: 0 });
      if (!sky.inView || !(await waitFor(browser, chipShown(true)))) skip(`office over the sky, floor ${GHOST_SKY.floor} x ${GHOST_SKY.x} at css (${sky.x}, ${sky.y}): no refused .hs-place-chip.is-alert in 5 s (${await browser.evaluate(CHIP_STATE).catch(() => 'chip unread')})`, `${shot.name}-refused`);
      else { await sleep(300); await shoot(`${shot.name}-refused`); }
      break;
    }
    case 'place': {
      const why = await officeInHand(browser);
      if (why) { skip(why); break; }
      const ok = await screenPoint(browser, save, (GHOST_OK.x + 0.5) * TILE_PX, floorTopY(GHOST_OK.floor) + FLOOR_PX / 2);
      await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ok.x, y: ok.y, button: 'none', buttons: 0 });
      if (!ok.inView || !(await waitFor(browser, chipShown(false)))) { skip(`office over floor ${GHOST_OK.floor} x ${GHOST_OK.x} at css (${ok.x}, ${ok.y}): no placeable .hs-place-chip in 5 s (${await browser.evaluate(CHIP_STATE).catch(() => 'chip unread')}), so no valid spot to click`); break; }
      await sleep(300);
      await clickAt(browser, ok);
      // Real waits: the script runs on real time, not virtual time. Each capture starts at its
      // offset from the click, or as soon as the one before it finished if that ran long.
      const t0 = Date.now();
      const started = [];
      for (const at of PLACE_OFFSETS_MS) {
        const wait = t0 + at - Date.now();
        if (wait > 0) await sleep(wait);
        started.push(Date.now() - t0);
        await shoot(`${shot.name}-${at}`);
      }
      out.note += `; captures began ${started.join(', ')} ms after the click`;
      break;
    }
    default:
      skip(`unknown state ${shot.state}`);
  }
  return out;
}

/** Runs one site shot. The 404 is served by wrangler dev over the web bundle, started and stopped here. */
async function siteShot(browser, base, shot, ctx) {
  const vp = VIEWPORTS[shot.viewport];
  const out = { files: [], skipped: [], note: '' };
  const is404 = shot.page === '/nothing-here';
  let worker = null;
  if (is404) {
    worker = await startWrangler(ctx.siteDir, ctx.tmp);
    if (worker.error) {
      out.skipped.push({ name: shot.name, why: worker.error });
      return out;
    }
    base = worker.base;
    out.note = 'served by wrangler dev';
  }
  try {
    await setViewport(browser, vp);
    await browser.send('Page.navigate', { url: `${base}/robots.txt` });
    await sleep(300);
    await browser.evaluate(`(() => { localStorage.setItem('hs.theme', ${JSON.stringify(shot.theme)}); return true; })()`);
    await browser.send('Page.navigate', { url: `${base}${shot.page}` });
    await sleep(2500);
    if (is404) {
      const title = await browser.evaluate('document.title');
      if (title !== 'Not found') {
        out.skipped.push({ name: shot.name, why: `wrangler dev served "${title}" at /nothing-here, not the 404 page` });
        return out;
      }
    }
    writeFileSync(join(ctx.outDir, `${shot.name}.png`), await capture(browser, vp));
    out.files.push(shot.name);
    return out;
  } finally {
    if (worker) await worker.stop();
  }
}

// ------------------------------------------------------------------ the texture budget

/** --textures: the dev server, /play/?smoke at the desk viewport, __hsRender.stats() until it holds still. */
async function textures(tmp) {
  const dev = await startDevServer(tmp);
  let browser = null;
  try {
    browser = await launchChrome('swiftshader');
    await setViewport(browser, VIEWPORTS.desk);
    await browser.send('Page.navigate', { url: `${dev.base}/play/?smoke` });
    const start = Date.now();
    let last = null;
    let since = start;
    let steady = false;
    while (Date.now() - start < TEXTURE_TIMEOUT_MS) {
      await sleep(TEXTURE_POLL_MS);
      const now = await browser.evaluate(`(() => { const s = window.__hsRender?.stats?.(); return s ? { textures: s.textures, bytes: s.bytes } : null; })()`).catch(() => null);
      if (!now) continue;
      if (!last || now.textures !== last.textures || now.bytes !== last.bytes) { last = now; since = Date.now(); }
      else if (Date.now() - since >= TEXTURE_STEADY_MS) { steady = true; break; }
    }
    if (!last) throw new Error(`window.__hsRender.stats() gave nothing in ${TEXTURE_TIMEOUT_MS / 1000} s at ${dev.base}/play/?smoke: ${browser.errors.slice(-2).join(' | ')}`);
    const unsettled = steady ? '' : `, still changing after ${TEXTURE_TIMEOUT_MS / 1000} s`;
    console.log(`textures ${last.textures} bytes ${last.bytes} ratio ${(last.bytes / TEXTURE_BASELINE).toFixed(3)} (baseline 3,906,560 at DPR 2, budget 1.6${unsettled})`);
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      dev.stop();
    }
  }
}

// ------------------------------------------------------------------ main

/** Builds one bundle with the CLI outDir override; vite.config.ts's gameAtRoot reads the resolved outDir. */
function build(mode, outDir) {
  // npm run build:app builds the app bundle with VITE_EDITION=full; the web bundle takes the default.
  const env = mode === 'app' ? { ...process.env, VITE_EDITION: 'full' } : process.env;
  const b = spawnSync(VITE, ['build', ...(mode ? ['--mode', mode] : []), '--outDir', outDir], { cwd: ROOT, stdio: 'inherit', env });
  if (b.status !== 0) throw Object.assign(new Error(`vite build ${mode ? `--mode ${mode} ` : ''}--outDir ${outDir} failed`), { exitCode: b.status ?? 1 });
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  }
  if (!existsSync(CHROME_PATH)) {
    console.error(`Chrome not found at ${CHROME_PATH}; set CHROME to its path.`);
    process.exit(2);
  }
  const tmp = mkdtempSync(join(tmpdir(), 'hs-design-sheet-run-'));
  try {
    if (args.textures) {
      await textures(tmp);
      return;
    }
    await shootAll(args, tmp);
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      console.log(`left the run's temp dir at ${tmp}`);
    }
  }
}

async function shootAll(args, tmp) {
  const appDir = args.build ? join(tmp, 'dist-app') : join(ROOT, 'dist-app');
  const siteDir = args.build ? join(tmp, 'dist') : join(ROOT, 'dist');
  if (args.build) {
    build('app', appDir);
    build(null, siteDir);
  }
  for (const dir of [appDir, siteDir]) {
    if (!existsSync(join(dir, 'index.html'))) throw new Error(`${dir}/index.html is missing`);
  }
  const outDir = args.out;
  const notCaptured = join(outDir, 'NOT-CAPTURED.md');
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) if (f.endsWith('.png')) rmSync(join(outDir, f));
  writeFileSync(notCaptured, '');
  const fixtureText = readFileSync(FIXTURE, 'utf8');
  const shots = args.only ? SHOTS.filter((s) => args.only.includes(s.name)) : SHOTS;
  const ctx = { outDir, tmp, siteDir };

  let game = null;
  let site = null;
  let browser = null;
  try {
    if (shots.some((s) => s.state !== 'site')) game = await startPreview('app', appDir);
    if (shots.some((s) => s.state === 'site' && s.page !== '/nothing-here')) site = await startPreview(null, siteDir);
    browser = await launchChrome('swiftshader');
    for (const shot of shots) {
      let result;
      try {
        result = shot.state === 'site' ? await siteShot(browser, site?.base, shot, ctx) : await gameShot(browser, game.base, shot, fixtureText, ctx);
      } catch (err) {
        result = { files: [], skipped: [{ name: shot.name, why: `error: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}` }], note: '' };
      }
      for (const s of result.skipped) appendFileSync(notCaptured, `${s.name} | ${s.why}\n`);
      if (result.files.length > 0) {
        const missed = result.skipped.filter((s) => !s.taken);
        const warned = result.skipped.filter((s) => s.taken);
        const partial = missed.length > 0 ? `; skipped ${missed.map((s) => s.name).join(', ')}` : '';
        const note = `${result.note ? `; ${result.note}` : ''}${warned.map((s) => `; ${s.why}`).join('')}`;
        console.log(`captured ${shot.name}${result.files.length > 1 || partial ? ` (${result.files.join(', ')})` : ''}${partial}${note}`);
      } else {
        console.log(`skipped ${shot.name} | ${result.skipped.map((s) => s.why).join('; ')}${result.note ? ` (${result.note})` : ''}`);
      }
    }
    const pngs = readdirSync(outDir).filter((f) => f.endsWith('.png'));
    const bytes = pngs.reduce((n, f) => n + statSync(join(outDir, f)).size, 0);
    console.log(`${pngs.length} files, ${bytes} bytes in ${relative(ROOT, outDir)}`);
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      if (game) game.stop();
      if (site) site.stop();
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(err?.exitCode ?? 1);
  });
}
