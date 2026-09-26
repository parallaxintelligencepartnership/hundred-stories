// The design pass contact sheet script (scripts/make-design-sheet.mjs): its shot list is the 17
// names docs/reviews/2026-09-25-design-pass-brief.md section 3 lists, then the six shots the
// design pass packages added; the time a game shot asks for moves the save's minute of the day
// and every per-person minute stamp by the same delta; --only takes shot names and nothing else;
// the room and person targets are picked inside the band the chrome leaves free; the far zoom
// takes as many wheel notches as the camera needs to reach its lowest stop. The browser run
// itself is not run here.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MIN_ZOOM, createCamera, nearestSnap, openingGroundLine } from '../../src/render/camera';
import { OPENING_WHOLE_TOWER, OPENING_ZOOM, builtFloorExtents, towerSpan, wholeTowerGroundLine } from '../../src/render/renderer';
import { deserialize } from '../../src/sim/save';
import { formatClock } from '../../src/ui/format';
import type { World } from '../../src/sim/types';

const ROOT = join(__dirname, '..', '..');
const FIXTURE = join(ROOT, 'store', 'fixtures', 'demo-tower.json');

const BRIEF_NAMES = [
  'game-desk-z1-1300',
  'game-desk-z1-2300',
  'game-desk-z1-1300-dock',
  'game-desk-z1-1300-person',
  'game-desk-z1-1300-room',
  'game-desk-z1-1300-settings',
  'game-desk-z1-1300-views',
  'game-desk-z1-0900-fire',
  'game-desk-z1-1300-ghost',
  'game-phone-z1-1300',
  'game-phone-z1-1300-sheet',
  'game-phone-z1-1300-person',
  'site-home-desk-light',
  'site-home-desk-dark',
  'site-home-phone-light',
  'site-guide-desk-light',
  'site-404-desk-light',
];

/** The shots the design pass packages retake with, appended after the brief's list. */
const PASS_NAMES = [
  'game-desk-z1-1830',
  'game-desk-zfar-2200',
  'game-desk-z1-1300-dock-light',
  'game-desk-z1-1300-watch',
  'game-desk-z1-1300-place',
];

interface Shot {
  name: string;
  viewport: 'desk' | 'phone';
  hour?: number;
  minute?: number;
  theme?: string;
  state: string;
}
interface Viewport {
  w: number;
  h: number;
  dpr: number;
  mobile: boolean;
}
interface Geo {
  left: number;
  top: number;
  width: number;
  height: number;
  bar: number;
  bottomCover: number;
}
interface Target {
  what: string;
  x: number;
  y: number;
  inView: boolean;
}
interface Pick {
  target: Target | null;
  candidates: Target[];
}
interface SheetModule {
  SHOTS: Shot[];
  VIEWPORTS: { desk: Viewport; phone: Viewport };
  fixtureAtHour(saveText: string, hour: number): string;
  fixtureAtMinute(saveText: string, minuteOfDay: number): string;
  shotMinuteOfDay(shot: Shot): number;
  clockText(minuteOfDay: number): string;
  parseArgs(argv: string[]): { only: string[] | null; out: string; build: boolean; textures: boolean };
  pickRoom(save: unknown, geo: Geo): Pick;
  pickPerson(save: unknown, geo: Geo): Pick;
  openingView(save: unknown, geo: Geo): { zoom: number; x: number; y: number };
  projectPoint(save: unknown, geo: Geo, wx: number, wy: number): { x: number; y: number; inView: boolean };
  zoomOutPlan(from?: number): { notches: number; zoom: number };
  WHEEL_NOTCH: number;
  OPENING_WHOLE_TOWER: boolean;
  OPENING_ZOOM: number;
}

const url = pathToFileURL(join(ROOT, 'scripts', 'make-design-sheet.mjs')).href;
const sheet = (await import(/* @vite-ignore */ url)) as SheetModule;

describe('design sheet shot list', () => {
  const shots = sheet.SHOTS;

  it('is the 17 shots the brief lists, then the five design pass shots', () => {
    expect(shots.map((s) => s.name)).toEqual([...BRIEF_NAMES, ...PASS_NAMES]);
  });

  it('every brief name appears in the brief text', () => {
    const brief = readFileSync(join(ROOT, 'docs', 'reviews', '2026-09-25-design-pass-brief.md'), 'utf8');
    for (const name of BRIEF_NAMES) {
      const tail = name.split('-').pop() as string;
      expect(brief.includes(name) || brief.includes(`-${tail}`)).toBe(true);
    }
  });

  it('game shot times match the time in the name, viewports match the name', () => {
    for (const s of shots) {
      expect(s.name.includes('-phone-') ? 'phone' : 'desk').toBe(s.viewport);
      if (!s.name.startsWith('game-')) continue;
      const ofDay = sheet.shotMinuteOfDay(s);
      const hhmm = `${String(Math.floor(ofDay / 60)).padStart(2, '0')}${String(ofDay % 60).padStart(2, '0')}`;
      expect(s.name).toContain(`-${hhmm}`);
    }
  });

  it('the dusk shot sits at minute 1110 and the light dock asks for the light theme', () => {
    const dusk = shots.find((s) => s.name === 'game-desk-z1-1830') as Shot;
    expect(sheet.shotMinuteOfDay(dusk)).toBe(1110);
    expect(shots.find((s) => s.name === 'game-desk-z1-1300-dock-light')).toMatchObject({ state: 'dock', theme: 'light' });
  });

  it('the clock a paused game shot must read is the status bar text for its minute (src/ui/format.ts formatClock)', () => {
    expect(sheet.clockText(780)).toBe('1:00 PM');
    for (let m = 0; m < 1440; m++) expect(sheet.clockText(m)).toBe(formatClock(1440 * 3 + m));
    for (const s of shots) if (s.name.startsWith('game-')) expect(sheet.clockText(sheet.shotMinuteOfDay(s))).toBe(formatClock(sheet.shotMinuteOfDay(s)));
  });

  it('the viewports are 1440 by 900 and 390 by 844, both at DPR 2', () => {
    expect(sheet.VIEWPORTS.desk).toEqual({ w: 1440, h: 900, dpr: 2, mobile: false });
    expect(sheet.VIEWPORTS.phone).toEqual({ w: 390, h: 844, dpr: 2, mobile: true });
  });
});

describe('fixtureAtHour', () => {
  const text = readFileSync(FIXTURE, 'utf8');
  const original = JSON.parse(text);

  /** The save with every per-person minute stamp blanked, to compare the rest. */
  const withoutStamps = (save: { minute: number; sims: Record<string, unknown>[] }) => ({
    ...save,
    minute: 0,
    sims: save.sims.map((p) => ({ ...p, waitStart: null, stayUntil: null })),
  });

  it('sets the minute of the day to hour * 60 and keeps the day and everything but the stamps', () => {
    const cases: [number, number][] = [
      [9, 540],
      [13, 780],
      [23, 1380],
    ];
    for (const [hour, ofDay] of cases) {
      const out = JSON.parse(sheet.fixtureAtHour(text, hour));
      expect(out.minute % 1440).toBe(ofDay);
      expect(Math.floor(out.minute / 1440)).toBe(Math.floor(original.minute / 1440));
      expect(withoutStamps(out)).toEqual(withoutStamps(original));
    }
  });

  it('moves every waitStart by the same delta as the clock, so a wait keeps its age', () => {
    const out = JSON.parse(sheet.fixtureAtHour(text, 13));
    const delta = out.minute - original.minute;
    expect(delta).not.toBe(0);
    const waiting = original.sims.filter((p: { waitStart: number | null }) => p.waitStart !== null);
    expect(waiting.length).toBeGreaterThan(0);
    original.sims.forEach((p: { waitStart: number | null }, i: number) => {
      const moved = out.sims[i].waitStart;
      if (p.waitStart === null) expect(moved).toBeNull();
      else {
        expect(moved).toBe(p.waitStart + delta);
        expect(out.minute - moved).toBe(original.minute - p.waitStart);
      }
    });
  });

  it('moves the other per-person minute stamps too, and leaves null ones null', () => {
    const save = {
      minute: 1440 * 3 + 100,
      sims: [
        { id: 1, waitStart: 4390, stayUntil: 4420, storyTripStart: 4380, guard: { pauseUntil: 4405 }, collector: { until: 4410 } },
        { id: 2, waitStart: null, stayUntil: null, guard: { pauseUntil: null }, collector: { until: null } },
      ],
    };
    const out = JSON.parse(sheet.fixtureAtMinute(JSON.stringify(save), 700));
    expect(out.minute).toBe(1440 * 3 + 700);
    expect(out.sims[0]).toEqual({ id: 1, waitStart: 4990, stayUntil: 5020, storyTripStart: 4980, guard: { pauseUntil: 5005 }, collector: { until: 5010 } });
    expect(out.sims[1]).toEqual(save.sims[1]);
  });

  it('never writes the committed fixture', () => {
    sheet.fixtureAtHour(text, 13);
    expect(readFileSync(FIXTURE, 'utf8')).toBe(text);
  });
});

describe('flags', () => {
  it('--only takes shot names; a name not in SHOTS is an error', () => {
    const args = sheet.parseArgs(['--only', 'game-desk-z1-1300,site-404-desk-light', '--no-build']);
    expect(args.only).toEqual(['game-desk-z1-1300', 'site-404-desk-light']);
    expect(args.build).toBe(false);
    expect(() => sheet.parseArgs(['--only', 'game-desk-z1-1300,game-desk-z9-9999'])).toThrow(/game-desk-z9-9999/);
    expect(() => sheet.parseArgs(['--only'])).toThrow();
    expect(() => sheet.parseArgs(['--bogus'])).toThrow(/--bogus/);
  });

  it('--out is relative to the repo root, and the default is the sheet folder', () => {
    expect(sheet.parseArgs(['--out', 'docs/reviews/design-pass-2026-09-25/after']).out).toBe(join(ROOT, 'docs', 'reviews', 'design-pass-2026-09-25', 'after'));
    expect(sheet.parseArgs([]).out).toBe(join(ROOT, 'docs', 'reviews', 'design-pass-2026-09-25', 'sheet'));
    expect(sheet.parseArgs([]).build).toBe(true);
    expect(sheet.parseArgs(['--textures']).textures).toBe(true);
  });
});

/**
 * The renderer's frameInitial (src/render/renderer.ts) on a real camera, from the exported
 * helpers: the whole tower at OPENING_ZOOM when it fits the band under the top bar, else zoom 1
 * on the rooms' mean x with the street at openingGroundLine.
 */
function rendererOpening(world: World, geo: Geo) {
  const camera = createCamera();
  camera.setViewport(geo.width, geo.height);
  camera.setObstruction(geo.bar, 0);
  camera.reset();
  const span = towerSpan(world);
  const whole = OPENING_WHOLE_TOWER && span.built ? wholeTowerGroundLine(span.top, span.bottom, geo.height - geo.bar) : null;
  if (whole !== null) {
    let min = Infinity;
    let max = -Infinity;
    for (const e of builtFloorExtents(world).values()) {
      min = Math.min(min, e.min);
      max = Math.max(max, e.max);
    }
    camera.zoom = OPENING_ZOOM;
    camera.centerOn(6, (min + max) / 2 - 0.5);
    camera.setGroundLine(whole);
  } else {
    let total = 0;
    for (const r of world.rooms.values()) total += r.x + r.width / 2;
    camera.centerOn(6, Math.round(world.rooms.size > 0 ? total / world.rooms.size : 375 / 2));
    camera.setGroundLine(openingGroundLine(span.top, geo.height - geo.bar, camera.zoom, geo.width <= 720));
  }
  return camera;
}

describe('the opening view', () => {
  const text = sheet.fixtureAtHour(readFileSync(FIXTURE, 'utf8'), 13);
  const save = JSON.parse(text);
  const loaded = deserialize(text);
  if (!loaded.ok) throw new Error(loaded.reason);
  const deskGeo: Geo = { left: 0, top: 0, width: 1440, height: 900, bar: 64, bottomCover: 0 };
  const shortGeo: Geo = { left: 0, top: 0, width: 1440, height: 700, bar: 64, bottomCover: 0 };
  const phoneGeo: Geo = { left: 0, top: 0, width: 390, height: 844, bar: 96, bottomCover: 120 };
  const geos: [string, Geo][] = [
    ['desk', deskGeo],
    ['desk, short', shortGeo],
    ['phone', phoneGeo],
  ];

  it('copies the renderer constants it cannot import', () => {
    expect(sheet.OPENING_WHOLE_TOWER).toBe(OPENING_WHOLE_TOWER);
    expect(sheet.OPENING_ZOOM).toBe(OPENING_ZOOM);
  });

  it('opens the demo tower whole at 0.5 on the desk and at zoom 1 on the phone', () => {
    expect(sheet.openingView(save, deskGeo).zoom).toBe(0.5);
    expect(sheet.openingView(save, shortGeo).zoom).toBe(1);
    expect(sheet.openingView(save, phoneGeo).zoom).toBe(1);
  });

  it('puts every world point where the renderer camera does', () => {
    const points: [number, number][] = [
      [0, 0],
      [(100 + 12) * 16, -612],
      [160.5 * 16, -30],
      [168.5 * 16, -108],
      [181.5 * 16, -396],
    ];
    for (const [, geo] of geos) {
      const camera = rendererOpening(loaded.world, geo);
      const view = sheet.openingView(save, geo);
      expect(view.zoom).toBe(camera.zoom);
      expect(view.x).toBeCloseTo(camera.x, 6);
      expect(view.y).toBeCloseTo(camera.y, 6);
      for (const [wx, wy] of points) {
        const want = camera.worldToScreen(wx, wy);
        const got = sheet.projectPoint(save, geo, wx, wy);
        expect(got.x).toBe(Math.round(want.x));
        expect(got.y).toBe(Math.round(want.y));
      }
    }
  });
});

describe('targets inside the band', () => {
  const save = JSON.parse(sheet.fixtureAtHour(readFileSync(FIXTURE, 'utf8'), 13));
  const desk: Geo = { left: 0, top: 0, width: 1440, height: 900, bar: 64, bottomCover: 0 };
  const short: Geo = { ...desk, height: 700 };
  const phone: Geo = { left: 0, top: 0, width: 390, height: 844, bar: 96, bottomCover: 120 };
  const inside = (t: Target, g: Geo) => t.x >= g.left && t.x < g.left + g.width && t.y >= g.top + g.bar && t.y < g.top + g.height - g.bottomCover;

  it('on the phone, where every lobby person is off screen, picks a drawn person on a higher floor inside the band', () => {
    const pick = sheet.pickPerson(save, phone);
    const lobby = pick.candidates.filter((t) => / floor 1 x /.test(t.what));
    expect(lobby.length).toBeGreaterThan(0);
    expect(lobby.every((t) => !inside(t, phone))).toBe(true);
    expect(pick.target).not.toBeNull();
    expect(inside(pick.target as Target, phone)).toBe(true);
    expect(pick.target?.what).not.toMatch(/ floor 1 x /);
  });

  it('only offers people the renderer draws: one in four by id, never riding or outside', () => {
    const pick = sheet.pickPerson(save, desk);
    const byId = new Map(save.sims.map((p: { id: number }) => [p.id, p]));
    for (const c of pick.candidates) {
      const id = Number(/ (\d+) \(/.exec(c.what)?.[1]);
      const sim = byId.get(id) as { id: number; kind: string; state: string };
      expect(sim.id % 4 === 0 || ['guard', 'collector', 'vip', 'thief'].includes(sim.kind)).toBe(true);
      expect(['riding', 'outside', 'gone']).not.toContain(sim.state);
    }
  });

  it('prefers the lobby, then the lowest floor', () => {
    const floors = sheet.pickPerson(save, desk).candidates.map((t) => Number(/ floor (-?\d+) x /.exec(t.what)?.[1]));
    const rank = (f: number) => (f === 1 ? -Infinity : f);
    for (let i = 1; i < floors.length; i++) expect(rank(floors[i] as number)).toBeGreaterThanOrEqual(rank(floors[i - 1] as number));
  });

  it('picks a lobby person inside the band on the desk', () => {
    const pick = sheet.pickPerson(save, desk);
    expect(pick.target).not.toBeNull();
    expect(inside(pick.target as Target, desk)).toBe(true);
  });

  it('picks the restaurant when the whole tower opens, and none when zoom 1 leaves it above the band', () => {
    const pick = sheet.pickRoom(save, desk);
    expect(pick.target).not.toBeNull();
    expect(inside(pick.target as Target, desk)).toBe(true);
    expect(sheet.pickRoom(save, short).target).toBeNull();
    expect(sheet.pickRoom(save, short).candidates.length).toBe(1);
  });

  it('aims the room click at a tile no shaft covers, since a shaft wins the pick', () => {
    const pick = sheet.pickRoom(save, desk);
    const tile = (pick.target as Target & { tile: number }).tile;
    const room = save.rooms.find((r: { kind: string }) => r.kind === 'restaurant');
    expect(tile).toBeGreaterThanOrEqual(room.x);
    expect(tile).toBeLessThan(room.x + room.width);
    for (const sh of save.shafts) {
      if (room.floor >= sh.floorMin && room.floor <= sh.floorMax) expect(tile >= sh.x && tile < sh.x + sh.width).toBe(false);
    }
  });

  it('never picks a point under the bottom chrome', () => {
    const covered: Geo = { ...desk, bottomCover: 900 - 64 - 1 };
    expect(sheet.pickPerson(save, covered).target).toBeNull();
  });
});

describe('the far zoom', () => {
  it('takes the wheel notches the camera needs to reach its lowest stop below 0.5, from 1 or from 0.5', () => {
    for (const from of [1, 0.5]) {
      const plan = sheet.zoomOutPlan(from);
      expect(plan.zoom).toBe(MIN_ZOOM);
      const camera = createCamera();
      camera.setViewport(1440, 900);
      camera.zoom = from;
      for (let i = 0; i < plan.notches - 1; i++) camera.wheel(sheet.WHEEL_NOTCH, 720, 450);
      expect(camera.zoom).toBeGreaterThan(MIN_ZOOM);
      camera.wheel(sheet.WHEEL_NOTCH, 720, 450);
      expect(camera.zoom).toBe(MIN_ZOOM);
      expect(nearestSnap(camera.zoom)).toBe(MIN_ZOOM);
      // the snap after the gesture holds it there
      for (let t = 0; t < 20; t++) camera.update(50);
      expect(camera.zoom).toBe(MIN_ZOOM);
    }
    expect(sheet.zoomOutPlan(1).notches).toBe(7);
    expect(sheet.zoomOutPlan(0.5).notches).toBe(4);
  });
});
