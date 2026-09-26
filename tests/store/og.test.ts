// The link preview (design pass D-36): scripts/make-store-shots.mjs draws public/og.png from the
// game itself, on the fixture's first clear afternoon, with the wordmark and tagline on a panel.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { weatherAt } from '../../src/game/weather';

interface OgSpec {
  id: string;
  out: string;
  width: number;
  height: number;
  css: { w: number; h: number; dpr: number };
  minuteOfDay: number;
  weatherMinute: number;
  crop: number;
  panel: { color: string; right: number; fade: number };
  wordmark: { source: string; x: number; y: number; width: number };
  tagline: { text: string; font: string; color: string; x: number; y: number };
}
interface ShotsModule {
  FIXTURE: string;
  OG: OgSpec;
  firstClearDay: (seed: number, fromDay?: number) => number;
  ogFixture: (saveText: string) => string;
  pngInfo: (buf: Buffer) => { width: number; height: number };
}

const ROOT = join(__dirname, '..', '..');

async function load(): Promise<ShotsModule> {
  return (await import(/* @vite-ignore */ pathToFileURL(join(ROOT, 'scripts', 'make-store-shots.mjs')).href)) as ShotsModule;
}

describe('the link preview is the game, not the wordmark card', () => {
  it('captures 1200 by 630 at ratio 1 and lays the panel, wordmark and tagline out as specified', async () => {
    const { OG } = await load();
    expect(OG.out).toBe('public/og.png');
    expect([OG.width, OG.height]).toEqual([1200, 630]);
    expect(OG.css).toEqual({ w: 1200, h: 630, dpr: 1 });
    expect(OG.minuteOfDay).toBe(13 * 60);
    expect(OG.weatherMinute).toBe(780);
    expect(OG.crop).toBe(360);
    expect(OG.panel).toEqual({ color: '#0b1020', right: 420, fade: 60 });
    expect(OG.wordmark).toEqual({ source: 'public/wordmark-dark.png', x: 30, y: 190, width: 360 });
    expect(OG.tagline).toEqual({
      text: 'Build a tower. Run it well.',
      font: '600 30px "Bricolage Grotesque"',
      color: '#e8ecf2',
      x: 30,
      y: 330,
    });
  });

  it('picks the first day whose afternoon is clear', async () => {
    const { firstClearDay } = await load();
    const day = firstClearDay(777);
    expect(weatherAt(777, day * 1440 + 780).kind).toBe('clear');
    for (let d = 0; d < day; d++) expect(weatherAt(777, d * 1440 + 780).kind).not.toBe('clear');
  });

  it('moves a copy of the fixture forward to 13:00 on that day and every stamp with it', async () => {
    const { FIXTURE, firstClearDay, ogFixture } = await load();
    const text = readFileSync(FIXTURE, 'utf8');
    const before = JSON.parse(text) as { seed: number; minute: number; sims: Array<{ waitStart: number | null }> };
    const after = JSON.parse(ogFixture(text)) as typeof before;
    const day = firstClearDay(before.seed, Math.floor(before.minute / 1440));
    expect(after.minute).toBe(day * 1440 + 780);
    expect(after.minute).toBeGreaterThanOrEqual(before.minute);
    const delta = after.minute - before.minute;
    before.sims.forEach((sim, i) => {
      if (sim.waitStart !== null) expect(after.sims[i]!.waitStart).toBe(sim.waitStart + delta);
    });
    expect(readFileSync(FIXTURE, 'utf8')).toBe(text);
  });

  it('ships a captured public/og.png, not the 12 KB wordmark card', async () => {
    const { pngInfo } = await load();
    const og = readFileSync(join(ROOT, 'public', 'og.png'));
    expect(pngInfo(og)).toMatchObject({ width: 1200, height: 630 });
    expect(og.length).toBeGreaterThan(100_000);
  });
});
