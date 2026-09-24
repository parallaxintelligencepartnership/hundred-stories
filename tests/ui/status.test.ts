// The status bar: deltas from a stub world, what the next star needs, the dial, the night mode,
// and the bar on the fake DOM.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NIGHT_MULTIPLIER } from '../../src/game/api';
import type { Room, RoomKind, World } from '../../src/sim/types';
import {
  createStatusBar,
  dialAngle,
  dialPoint,
  DIAL,
  isNightMinute,
  nextStarNeeds,
  nightArcPath,
  populationTrend,
  quarterDelta,
  quarterDeltaText,
  speedModeText,
  weatherShort,
} from '../../src/ui/status';
import { weatherAt, weatherLabel, type WeatherKind } from '../../src/game/weather';
import { setForcedWeather } from '../../src/render/weather';
import { FakeDom, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
});
afterEach(() => uninstall());

function rooms(...kinds: RoomKind[]): Map<number, Room> {
  return new Map(kinds.map((kind, i) => [i + 1, { id: i + 1, kind } as Room]));
}

function stubWorld(overrides: Partial<World> = {}): World {
  return {
    cash: 1_250_000,
    quarterStartCash: 1_000_000,
    population: 820,
    dayStartPopulation: 700,
    stars: 2,
    time: { minute: 12 * 60 },
    rooms: rooms('office'),
    stats: { vipRating: 'none', weddingsHeld: 0 },
    ...overrides,
  } as World;
}

describe('status bar deltas', () => {
  it('counts cash from the quarter start, spending included, and says so', () => {
    expect(quarterDelta(stubWorld())).toBe(250_000);
    expect(quarterDeltaText(stubWorld())).toBe('+$250,000 this quarter');
    expect(quarterDeltaText(stubWorld({ cash: 900_000 }))).toBe('-$100,000 this quarter');
  });

  it('shows a dash until a v2 save reaches its first boundary', () => {
    expect(quarterDelta(stubWorld({ quarterStartCash: null }))).toBe(null);
    expect(quarterDeltaText(stubWorld({ quarterStartCash: null }))).toBe('– this quarter');
    expect(populationTrend(stubWorld({ dayStartPopulation: null }))).toMatchObject({ delta: null, arrow: 'unknown', text: '– today' });
  });

  it('gives population a trend arrow and a signed change since midnight', () => {
    expect(populationTrend(stubWorld())).toMatchObject({ delta: 120, arrow: 'up', text: '▲ +120 today', label: 'Up 120 today' });
    expect(populationTrend(stubWorld({ population: 650 }))).toMatchObject({ delta: -50, arrow: 'down', text: '▼ -50 today' });
    expect(populationTrend(stubWorld({ population: 700 }))).toMatchObject({ delta: 0, arrow: 'flat', text: 'No change today' });
  });
});

describe('next star', () => {
  it('lists the population and every prerequisite of the next star, marked met or not', () => {
    const three = nextStarNeeds(stubWorld({ population: 1_200 }));
    expect(three.next).toBe(3);
    expect(three.needs).toEqual([
      { text: 'Population 1,200 of 1,000', met: true },
      { text: 'A security office', met: false },
    ]);

    const four = nextStarNeeds(stubWorld({ stars: 3, population: 5_100, rooms: rooms('hotelSuite', 'medical') }));
    expect(four.needs).toEqual([
      { text: 'Population 5,100 of 5,000', met: true },
      { text: '1 hotel suite (1 built)', met: true },
      { text: 'VIP rating fair or better (now none)', met: false },
      { text: 'A recycling center', met: false },
      { text: 'A medical center', met: true },
    ]);

    const tower = nextStarNeeds(stubWorld({ stars: 5, rooms: rooms('cathedral') }));
    expect(tower.title).toBe('Next: tower status');
    expect(tower.needs.map((n) => n.text)).toEqual(['Population 820 of 15,000', 'A cathedral', 'A wedding held']);
    expect(nextStarNeeds(stubWorld({ stars: 6 })).next).toBe(null);
  });
});

describe('clock dial', () => {
  it('puts midnight at the top, 06:00 on the right and 18:00 on the left', () => {
    expect(dialAngle(0)).toBe(0);
    expect(dialAngle(6 * 60)).toBe(90);
    expect(dialAngle(18 * 60)).toBe(270);
    expect(dialPoint(dialAngle(0), DIAL.hand)).toEqual({ x: DIAL.c, y: DIAL.c - DIAL.hand });
    expect(dialPoint(dialAngle(6 * 60), DIAL.hand)).toEqual({ x: DIAL.c + DIAL.hand, y: DIAL.c });
    expect(dialPoint(dialAngle(18 * 60), DIAL.hand)).toEqual({ x: DIAL.c - DIAL.hand, y: DIAL.c });
  });

  it('shades the arc from 23:00 through midnight to 06:00, and only that', () => {
    expect([isNightMinute(23 * 60), isNightMinute(3 * 60), isNightMinute(12 * 60)]).toEqual([true, true, false]);
    expect(isNightMinute(6 * 60)).toBe(false);
    // From 345 degrees (23:00) clockwise 105 degrees to 90 (06:00): the short way, sweep flag 1.
    const from = dialPoint(345, DIAL.r);
    expect(nightArcPath()).toBe(`M20 20L${from.x} ${from.y}A18 18 0 0 1 38 20Z`);
  });
});

describe('night speed mode', () => {
  it('names the night multiplier and the effective speed, and nothing by day', () => {
    expect(speedModeText(2, 23 * 60 + 30)).toBe(`Night x${NIGHT_MULTIPLIER}, effective x${2 * NIGHT_MULTIPLIER}`);
    expect(speedModeText(2, 23 * 60 + 30)).toBe('Night x8, effective x16');
    expect(speedModeText(0, 2 * 60)).toBe('Paused, night x8');
    expect(speedModeText(4, 12 * 60)).toBe('');
  });
});

describe('status bar on the page', () => {
  const find = (root: FakeElement, c: string): FakeElement[] => [root, ...root.descendants()].filter((n) => n.className.split(' ').includes(c));

  it('writes the values, six stars with the earned ones marked, and the tooltip of the next star', () => {
    const bar = createStatusBar();
    bar.update(stubWorld(), 2);
    const cash = bar.cash as unknown as FakeElement;
    expect(cash.textContent).toBe('Cash$1,250,000+$250,000 this quarter');
    const pop = bar.population as unknown as FakeElement;
    expect(find(pop, 'hs-readout-meta')[0]?.getAttribute('aria-label')).toBe('Up 120 today');

    const stars = bar.stars as unknown as FakeElement;
    const icons = stars.descendants().filter((n) => n.getAttribute('class')?.includes('hs-star'));
    expect(icons.length).toBe(6);
    expect(icons.filter((n) => n.classList.contains('is-earned')).length).toBe(2);
    const tip = find(stars, 'hs-tip')[0] as FakeElement;
    expect(tip.getAttribute('role')).toBe('tooltip');
    expect(tip.textContent).toContain('Next: 3 stars');
    expect(tip.textContent).toContain('NeededA security office');

    const mode = bar.mode as unknown as FakeElement;
    expect(mode.classList.contains('is-hidden')).toBe(true);
    bar.update(stubWorld({ time: { minute: 23 * 60 } }), 2);
    expect([mode.textContent, mode.classList.contains('is-hidden')]).toEqual(['Night x8, effective x16', false]);
  });

  it('builds nothing on an update that changes nothing', () => {
    const bar = createStatusBar();
    bar.update(stubWorld(), 1);
    dom.created = 0;
    for (let i = 0; i < 10; i += 1) bar.update(stubWorld(), 1);
    expect(dom.created).toBe(0);
  });
});

describe('weather readout beside the clock', () => {
  afterEach(() => setForcedWeather(null));
  const find = (root: FakeElement, c: string): FakeElement => {
    const node = [root, ...root.descendants()].find((n) => n.className.split(' ').includes(c));
    if (!node) throw new Error(`no ${c}`);
    return node;
  };
  const kinds: WeatherKind[] = ['clear', 'overcast', 'rain', 'storm'];

  it('names each kind with weatherLabel and a two letter short form', () => {
    expect(kinds.map(weatherLabel)).toEqual(['Clear', 'Overcast', 'Rain', 'Storm']);
    expect(kinds.map(weatherShort)).toEqual(['CL', 'OV', 'RN', 'ST']);
  });

  it('shows the word and its short form inside the clock, updated when the kind changes', () => {
    const bar = createStatusBar();
    const clock = bar.clock as unknown as FakeElement;
    for (const kind of kinds) {
      setForcedWeather({ kind, from: kind, blend: 1, intensity: 1 });
      bar.update(stubWorld(), 1);
      expect(find(clock, 'hs-weather-word').textContent).toBe(weatherLabel(kind));
      expect(find(clock, 'hs-weather-short').textContent).toBe(weatherShort(kind));
      expect(find(clock, 'hs-weather').getAttribute('title')).toBe(`Weather: ${weatherLabel(kind)}`);
    }
    // Unpinned, the readout follows the forecast for the tower's seed.
    setForcedWeather(null);
    const world = stubWorld();
    bar.update(world, 1);
    expect(find(clock, 'hs-weather-word').textContent).toBe(weatherLabel(weatherAt(world.seed, world.time.minute).kind));
  });
});
