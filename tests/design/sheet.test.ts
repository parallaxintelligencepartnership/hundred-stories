// The design pass contact sheet script (scripts/make-design-sheet.mjs): its shot list is exactly
// the 17 names docs/reviews/2026-09-25-design-pass-brief.md section 3 lists, and the hour a game
// shot asks for moves only the save's minute of the day. The browser run itself is not run here.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

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

interface Shot {
  name: string;
  viewport: 'desk' | 'phone';
  hour?: number;
  state: string;
}
interface Viewport {
  w: number;
  h: number;
  dpr: number;
  mobile: boolean;
}
interface SheetModule {
  SHOTS: Shot[];
  VIEWPORTS: { desk: Viewport; phone: Viewport };
  fixtureAtHour(saveText: string, hour: number): string;
}

const url = pathToFileURL(join(ROOT, 'scripts', 'make-design-sheet.mjs')).href;
const sheet = (await import(/* @vite-ignore */ url)) as SheetModule;

describe('design sheet shot list', () => {
  const shots = sheet.SHOTS;

  it('is exactly the 17 shots the brief lists', () => {
    expect(shots.map((s) => s.name)).toEqual(BRIEF_NAMES);
  });

  it('every brief name appears in the brief text', () => {
    const brief = readFileSync(join(ROOT, 'docs', 'reviews', '2026-09-25-design-pass-brief.md'), 'utf8');
    for (const name of BRIEF_NAMES) {
      const tail = name.split('-').pop() as string;
      expect(brief.includes(name) || brief.includes(`-${tail}`)).toBe(true);
    }
  });

  it('game shot hours match the hour in the name, viewports match the name', () => {
    for (const s of shots) {
      expect(s.name.includes('-phone-') ? 'phone' : 'desk').toBe(s.viewport);
      if (s.name.startsWith('game-')) expect(s.name).toContain(`-${String(s.hour).padStart(2, '0')}00`);
    }
  });

  it('the viewports are 1440 by 900 and 390 by 844, both at DPR 2', () => {
    expect(sheet.VIEWPORTS.desk).toEqual({ w: 1440, h: 900, dpr: 2, mobile: false });
    expect(sheet.VIEWPORTS.phone).toEqual({ w: 390, h: 844, dpr: 2, mobile: true });
  });
});

describe('fixtureAtHour', () => {
  const text = readFileSync(FIXTURE, 'utf8');
  const original = JSON.parse(text);

  it('sets the minute of the day to hour * 60 and keeps the day and everything else', () => {
    const cases: [number, number][] = [
      [9, 540],
      [13, 780],
      [23, 1380],
    ];
    for (const [hour, ofDay] of cases) {
      const out = JSON.parse(sheet.fixtureAtHour(text, hour));
      expect(out.minute % 1440).toBe(ofDay);
      expect(Math.floor(out.minute / 1440)).toBe(Math.floor(original.minute / 1440));
      expect({ ...out, minute: 0 }).toEqual({ ...original, minute: 0 });
    }
  });

  it('never writes the committed fixture', () => {
    sheet.fixtureAtHour(text, 13);
    expect(readFileSync(FIXTURE, 'utf8')).toBe(text);
  });
});
