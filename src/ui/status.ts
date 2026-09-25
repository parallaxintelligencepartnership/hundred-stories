// The status bar: cash and its change this quarter, population and its change today, the
// six stars with what the next one needs, a 24 hour dial with the time and date, and the
// night speed shown as a mode. The pure parts are exported for the tests; the DOM part only
// runs when createStatusBar is called.

import { NIGHT_MULTIPLIER, type Speed } from '../game/api';
import { weatherLabel, type WeatherKind } from '../game/weather';
import { shownWeatherKind } from '../render/weather';
import { ROOMS, SCHEDULES, STARS } from '../sim/rules';
import { clockOf } from '../sim/types';
import type { Star, World } from '../sim/types';
import { formatClock, formatCount, formatDate, formatMoney, formatSignedMoney, starsTitle } from './format';
import { icon, type IconName } from './icons';

/** Shown where a baseline is not known yet (a save from before v3, until the next boundary). */
export const UNKNOWN = '–';

type Baselines = Pick<World, 'cash' | 'population'> & {
  quarterStartCash?: number | null;
  dayStartPopulation?: number | null;
};

// ------------------------------------------------------------------ cash

/** Cash minus the cash the quarter started with, spending included; null until known. */
export function quarterDelta(world: Baselines): number | null {
  const base = world.quarterStartCash;
  return typeof base === 'number' ? world.cash - base : null;
}

export function quarterDeltaText(world: Baselines): string {
  const delta = quarterDelta(world);
  return delta === null ? `${UNKNOWN} this quarter` : `${formatSignedMoney(delta)} this quarter`;
}

// ------------------------------------------------------------ population

export interface PopulationTrend {
  delta: number | null;
  arrow: 'up' | 'down' | 'flat' | 'unknown';
  text: string;
  /** The sentence for a screen reader and the tooltip, since an arrow alone is not a label. */
  label: string;
}

export function populationTrend(world: Baselines): PopulationTrend {
  const base = world.dayStartPopulation;
  if (typeof base !== 'number') {
    return { delta: null, arrow: 'unknown', text: `${UNKNOWN} today`, label: 'Change today not known until midnight' };
  }
  const delta = world.population - base;
  if (delta > 0) return { delta, arrow: 'up', text: `▲ +${formatCount(delta)} today`, label: `Up ${formatCount(delta)} today` };
  if (delta < 0) {
    return { delta, arrow: 'down', text: `▼ -${formatCount(-delta)} today`, label: `Down ${formatCount(-delta)} today` };
  }
  return { delta, arrow: 'flat', text: 'No change today', label: 'No change today' };
}

// ----------------------------------------------------------------- stars

export interface StarNeed {
  text: string;
  met: boolean;
}

export interface NextStar {
  /** The rank being worked toward, or null at the top of the ladder. */
  next: Star | null;
  title: string;
  needs: StarNeed[];
}

const VIP_ORDER = { none: 0, poor: 1, fair: 2, good: 3 } as const;
const VIP_WORDS = { none: 'none', poor: 'poor', fair: 'fair', good: 'good' } as const;

type StarWorld = Pick<World, 'stars' | 'population' | 'rooms'> & {
  stats?: Pick<World['stats'], 'vipRating' | 'weddingsHeld'>;
};

/**
 * Every requirement of the next star from STARS in src/sim/stars.ts's terms, each marked met
 * or not. Read only: the sim decides the rating; this only says what it is looking for.
 */
export function nextStarNeeds(world: StarWorld): NextStar {
  if (world.stars >= 6) return { next: null, title: 'Tower status reached', needs: [] };
  const next = (world.stars + 1) as Star;
  const rule = STARS[next];
  const counts = new Map<string, number>();
  for (const room of world.rooms.values()) counts.set(room.kind, (counts.get(room.kind) ?? 0) + 1);
  const has = (kind: keyof typeof ROOMS): boolean => (counts.get(kind) ?? 0) > 0;

  const needs: StarNeed[] = [
    {
      text: `Population ${formatCount(world.population)} of ${formatCount(rule.population)}`,
      met: world.population >= rule.population,
    },
  ];
  const r = rule.requires;
  if (r.security) needs.push({ text: `A ${ROOMS.security.label.toLowerCase()}`, met: has('security') });
  if (r.hotelSuites !== undefined) {
    const suites = counts.get('hotelSuite') ?? 0;
    const noun = r.hotelSuites === 1 ? 'suite' : 'suites';
    needs.push({ text: `${r.hotelSuites} hotel ${noun} (${suites} built)`, met: suites >= r.hotelSuites });
  }
  if (r.vipRating !== undefined) {
    const now = world.stats?.vipRating ?? 'none';
    needs.push({
      text: `VIP rating ${VIP_WORDS[r.vipRating]} or better (now ${VIP_WORDS[now]})`,
      met: VIP_ORDER[now] >= VIP_ORDER[r.vipRating],
    });
  }
  if (r.recycling) needs.push({ text: `A ${ROOMS.recycling.label.toLowerCase()}`, met: has('recycling') });
  if (r.medical) needs.push({ text: `A ${ROOMS.medical.label.toLowerCase()}`, met: has('medical') });
  if (r.metro) needs.push({ text: `A ${ROOMS.metro.label.toLowerCase()}`, met: has('metro') });
  if (r.cathedral) needs.push({ text: `A ${ROOMS.cathedral.label.toLowerCase()}`, met: has('cathedral') });
  if (r.wedding) needs.push({ text: 'A wedding held', met: (world.stats?.weddingsHeld ?? 0) > 0 });

  const title = next === 6 ? 'Next: tower status' : `Next: ${STARS[next].label}`;
  return { next, title, needs };
}

// ----------------------------------------------------------------- clock

/** The dial's size in its own units: a 40 by 40 box, radius 18, centre 20. */
export const DIAL = { size: 40, c: 20, r: 18, hand: 13 } as const;

/** Degrees clockwise from the top: midnight at 0, 06:00 at 90, noon at 180, 18:00 at 270. */
export function dialAngle(minuteOfDay: number): number {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  return (m / 1440) * 360;
}

export function dialPoint(degrees: number, radius: number): { x: number; y: number } {
  const t = (degrees * Math.PI) / 180;
  const round = (n: number): number => Math.round(n * 100) / 100;
  return { x: round(DIAL.c + radius * Math.sin(t)), y: round(DIAL.c - radius * Math.cos(t)) };
}

/** Is this minute on the shaded arc, the hours the clock runs at night speed? */
export function isNightMinute(minuteOfDay: number): boolean {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  return m >= SCHEDULES.nightStart || m < SCHEDULES.nightEnd;
}

/** The shaded wedge from night start (23:00) clockwise through midnight to night end (06:00). */
export function nightArcPath(): string {
  const from = dialPoint(dialAngle(SCHEDULES.nightStart), DIAL.r);
  const to = dialPoint(dialAngle(SCHEDULES.nightEnd), DIAL.r);
  const sweep = (dialAngle(SCHEDULES.nightEnd) - dialAngle(SCHEDULES.nightStart) + 360) % 360;
  const large = sweep > 180 ? 1 : 0;
  return `M${DIAL.c} ${DIAL.c}L${from.x} ${from.y}A${DIAL.r} ${DIAL.r} 0 ${large} 1 ${to.x} ${to.y}Z`;
}

// ----------------------------------------------------------------- speed

/**
 * The night speed as a mode beside the speed buttons, so the clock racing at 23:00 is
 * expected rather than a surprise. Empty by day, when the speed buttons say it all.
 */
export function speedModeText(speed: Speed, minute: number): string {
  if (!isNightMinute(clockOf(Math.max(0, Math.floor(minute))).minuteOfDay)) return '';
  if (speed === 0) return `Paused, night x${NIGHT_MULTIPLIER}`;
  return `Night x${NIGHT_MULTIPLIER}, x${speed * NIGHT_MULTIPLIER} in all`;
}

// --------------------------------------------------------------- weather

/** The weather's icon beside the clock. The word goes in its label and tooltip. */
export function weatherIcon(kind: WeatherKind): IconName {
  switch (kind) {
    case 'clear':
      return 'clear';
    case 'overcast':
      return 'cloudy';
    case 'rain':
      return 'rain';
    case 'storm':
      return 'storm';
  }
}

/** The weather word's two letter form, for a place with no room for the word or the icon. */
export function weatherShort(kind: WeatherKind): string {
  switch (kind) {
    case 'clear':
      return 'CL';
    case 'overcast':
      return 'OV';
    case 'rain':
      return 'RN';
    case 'storm':
      return 'ST';
  }
}

// ------------------------------------------------------------------- DOM

export interface StatusBar {
  /** Cash: a button, because it opens the finances panel. */
  cash: HTMLButtonElement;
  population: HTMLDivElement;
  stars: HTMLDivElement;
  clock: HTMLDivElement;
  /** The weather icon beside the time, with its word for a screen reader and the tooltip. */
  weather: HTMLSpanElement;
  /** The night mode chip that sits beside the speed buttons. */
  mode: HTMLSpanElement;
  update(world: World, speed: Speed): void;
  destroy(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function setAttr(node: Element, name: string, value: string): void {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

let tooltipIds = 0;

export function createStatusBar(): StatusBar {
  // Each readout leads with its icon, so a player who does not read yet can still tell cash
  // from people; the word stays in the label, which ui.css keeps for screen readers only.
  const lead = (name: IconName): HTMLElement => icon(name, 'hs-icon hs-readout-icon') as unknown as HTMLElement;

  // Cash
  const cash = h('button', 'hs-readout hs-status-cash');
  cash.type = 'button';
  cash.title = 'Open finances';
  const cashValue = h('span', 'hs-readout-value');
  const cashMeta = h('span', 'hs-readout-meta');
  cash.append(lead('finance'), h('span', 'hs-readout-label', 'Cash'), cashValue, cashMeta);

  // Population
  const population = h('div', 'hs-readout hs-status-pop');
  const popValue = h('span', 'hs-readout-value');
  const popMeta = h('span', 'hs-readout-meta');
  population.append(lead('population'), h('span', 'hs-readout-label', 'Population'), popValue, popMeta);

  // Stars: a button so a keyboard can reach the tooltip and a finger can open it.
  const stars = h('div', 'hs-readout hs-status-stars');
  const starsButton = h('button', 'hs-stars-button');
  starsButton.type = 'button';
  const tipId = `hs-stars-tip-${++tooltipIds}`;
  starsButton.setAttribute('aria-describedby', tipId);
  starsButton.setAttribute('aria-expanded', 'false');
  const starIcons: SVGElement[] = [];
  const starRow = h('span', 'hs-star-row');
  for (let i = 0; i < 6; i += 1) {
    const star = icon('star', 'hs-star');
    starIcons.push(star);
    starRow.append(star as unknown as HTMLElement);
  }
  // A phone has no room for six stars: one star and the count stand in (ui.css).
  const starsCount = h('span', 'hs-stars-count');
  starsCount.setAttribute('aria-hidden', 'true');
  starsCount.append(icon('star', 'hs-icon hs-count-glyph') as unknown as HTMLElement);
  const starsCountText = h('span', 'hs-stars-count-text');
  starsCount.append(starsCountText);
  const starsMeta = h('span', 'hs-readout-meta');
  starsButton.append(h('span', 'hs-readout-label', 'Stars'), starRow, starsCount, starsMeta);
  const tip = h('div', 'hs-tip');
  tip.id = tipId;
  tip.setAttribute('role', 'tooltip');
  const tipTitle = h('p', 'hs-tip-title');
  const tipList = h('ul', 'hs-tip-list');
  tip.append(tipTitle, tipList);
  stars.append(starsButton, tip);
  const setOpen = (open: boolean): void => {
    stars.classList.toggle('is-open', open);
    setAttr(starsButton, 'aria-expanded', open ? 'true' : 'false');
  };
  const onStarsClick = (): void => setOpen(!stars.classList.contains('is-open'));
  const onStarsBlur = (): void => setOpen(false);
  starsButton.addEventListener('click', onStarsClick);
  starsButton.addEventListener('blur', onStarsBlur);

  // Clock: the dial, then the time and the date beside it.
  const clock = h('div', 'hs-readout hs-status-clock');
  const dial = svg('svg', {
    class: 'hs-dial',
    viewBox: `0 0 ${DIAL.size} ${DIAL.size}`,
    'aria-hidden': 'true',
    focusable: 'false',
  });
  const hand = svg('line', { class: 'hs-dial-hand', x1: String(DIAL.c), y1: String(DIAL.c), x2: String(DIAL.c), y2: String(DIAL.c - DIAL.hand) });
  dial.append(
    svg('circle', { class: 'hs-dial-face', cx: String(DIAL.c), cy: String(DIAL.c), r: String(DIAL.r) }),
    svg('path', { class: 'hs-dial-night', d: nightArcPath() }),
    svg('line', { class: 'hs-dial-tick', x1: String(DIAL.c), y1: String(DIAL.c - DIAL.r), x2: String(DIAL.c), y2: String(DIAL.c - DIAL.r + 4) }),
    hand,
    svg('circle', { class: 'hs-dial-pin', cx: String(DIAL.c), cy: String(DIAL.c), r: '2' }),
  );
  const clockText = h('span', 'hs-clock-text');
  const clockValue = h('span', 'hs-readout-value');
  // The digits and AM or PM apart, so a phone can stack the suffix under the digits.
  const clockDigits = h('span', 'hs-clock-digits');
  const clockAmPm = h('span', 'hs-clock-ampm');
  clockValue.append(clockDigits, clockAmPm);
  const dateValue = h('span', 'hs-readout-meta');
  // The weather beside the time: an icon, with the word for a screen reader and the tooltip.
  const weather = h('span', 'hs-weather');
  const weatherWord = h('span', 'hs-weather-word');
  let weatherGlyph: HTMLElement | null = null;
  weather.append(weatherWord);
  clockText.append(clockValue, dateValue);
  clock.append(dial as unknown as HTMLElement, clockText, weather);

  const mode = h('span', 'hs-speed-mode is-hidden');

  let lastMinuteOfDay = -1;
  let weatherShown: WeatherKind | null = null;
  let tipKey = '';
  let earnedShown = -1;

  function update(world: World, speed: Speed): void {
    setText(cashValue, formatMoney(world.cash));
    const delta = quarterDelta(world);
    setText(cashMeta, quarterDeltaText(world));
    cashMeta.classList.toggle('is-down', delta !== null && delta < 0);
    setAttr(cashMeta, 'title', delta === null ? 'Change this quarter, shown once the next quarter starts' : 'Change since the quarter began');
    // Under 400 px the delta lines are hidden (ui.css), so each readout's tooltip carries its change.
    setAttr(cash, 'title', `Open finances. ${quarterDeltaText(world)}`);

    setText(popValue, formatCount(world.population));
    const trend = populationTrend(world);
    setText(popMeta, trend.text);
    setAttr(popMeta, 'aria-label', trend.label);
    setAttr(popMeta, 'title', trend.label);
    setAttr(population, 'title', trend.label);
    popMeta.classList.toggle('is-down', trend.arrow === 'down');
    popMeta.classList.toggle('is-up', trend.arrow === 'up');

    if (earnedShown !== world.stars) {
      earnedShown = world.stars;
      starIcons.forEach((star, i) => star.classList.toggle('is-earned', i < world.stars));
      setText(starsCountText, String(world.stars));
      setAttr(starsButton, 'aria-label', `Stars: ${starsTitle(world.stars)}. What the next star needs.`);
    }
    const need = nextStarNeeds(world);
    const key = `${need.title}|${need.needs.map((n) => `${n.text}:${n.met ? 1 : 0}`).join('|')}`;
    if (key !== tipKey) {
      tipKey = key;
      setText(tipTitle, need.title);
      tipList.replaceChildren(
        ...(need.next === null
          ? [h('li', 'hs-tip-item is-met', 'Every star is earned.')]
          : need.needs.map((n) => {
              const item = h('li', n.met ? 'hs-tip-item is-met' : 'hs-tip-item');
              item.append(h('span', 'hs-tip-mark', n.met ? 'Done' : 'Needed'), h('span', 'hs-tip-text', n.text));
              return item;
            })),
      );
      const left = need.needs.filter((n) => !n.met).length;
      setText(starsMeta, need.next === null ? 'Tower status' : left === 0 ? 'Next star due' : need.title);
    }

    const minuteOfDay = clockOf(Math.max(0, Math.floor(world.time.minute))).minuteOfDay;
    if (minuteOfDay !== lastMinuteOfDay) {
      lastMinuteOfDay = minuteOfDay;
      const tipPoint = dialPoint(dialAngle(minuteOfDay), DIAL.hand);
      hand.setAttribute('x2', String(tipPoint.x));
      hand.setAttribute('y2', String(tipPoint.y));
      clock.classList.toggle('is-night', isNightMinute(minuteOfDay));
    }
    const time = formatClock(world.time.minute);
    const split = time.lastIndexOf(' ');
    setText(clockDigits, time.slice(0, split));
    setText(clockAmPm, time.slice(split));
    const date = formatDate(world.time.minute);
    setText(dateValue, date);
    // The weather the tower view is drawing, so the word and the rain on screen agree.
    const kind = shownWeatherKind(world.seed, world.time.minute);
    if (kind !== weatherShown) {
      weatherShown = kind;
      setText(weatherWord, weatherLabel(kind));
      const glyph = icon(weatherIcon(kind), 'hs-icon hs-weather-icon') as unknown as HTMLElement;
      if (weatherGlyph) weatherGlyph.remove();
      weatherGlyph = glyph;
      weather.prepend(glyph);
      setAttr(weather, 'title', `Weather: ${weatherLabel(kind)}`);
    }
    setAttr(clock, 'title', date); // a phone hides the date line; the tooltip keeps it

    const modeText = speedModeText(speed, world.time.minute);
    setText(mode, modeText);
    mode.classList.toggle('is-hidden', modeText === '');
  }

  return {
    cash,
    population,
    stars,
    clock,
    weather,
    mode,
    update,
    destroy() {
      starsButton.removeEventListener('click', onStarsClick);
      starsButton.removeEventListener('blur', onStarsBlur);
    },
  };
}
