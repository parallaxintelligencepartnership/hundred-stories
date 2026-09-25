// The chrome's one icon set: inline SVG symbols defined once in the DOM and referenced by
// <use>. No icon font. Each icon is aria-hidden: the words carry the meaning, the drawing only
// helps find it. The words are a visible label beside it, or, on an icon-only button (phones,
// the speed pill), the button's aria-label and its title tooltip.

const SVG_NS = 'http://www.w3.org/2000/svg';

export type IconName =
  | 'finance'
  | 'population'
  | 'elevator'
  | 'room'
  | 'settings'
  | 'log'
  | 'share'
  | 'star'
  | 'demolish'
  | 'query'
  | 'help'
  | 'pause'
  | 'play'
  | 'fast'
  | 'faster'
  | 'menu'
  | 'close'
  | 'clear'
  | 'cloudy'
  | 'rain'
  | 'storm';

/** A 16 by 16 drawing per icon, 1.5 px lines in the current text color. */
const LINE = 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"';
const SYMBOLS: Record<IconName, string> = {
  finance: `<rect x="1.75" y="4" width="12.5" height="8" ${LINE}/><circle cx="8" cy="8" r="2" ${LINE}/>`,
  population: `<circle cx="8" cy="5" r="2.5" ${LINE}/><path d="M3 14c0-3 2.2-4.75 5-4.75s5 1.75 5 4.75" ${LINE}/>`,
  elevator: `<rect x="3" y="1.75" width="10" height="12.5" ${LINE}/><path d="M6 6.5l2-2 2 2M6 9.5l2 2 2-2" ${LINE}/>`,
  room: `<rect x="1.75" y="3" width="12.5" height="10" ${LINE}/><path d="M4.5 6h3v3h-3zM10 13V8.5h2V13" ${LINE}/>`,
  settings: `<circle cx="8" cy="8" r="2.25" ${LINE}/><path d="M8 1.5v2.25M8 12.25v2.25M1.5 8h2.25M12.25 8h2.25M3.4 3.4l1.6 1.6M11 11l1.6 1.6M3.4 12.6L5 11M11 5l1.6-1.6" ${LINE}/>`,
  log: `<path d="M5.5 4h8M5.5 8h8M5.5 12h8" ${LINE}/><path d="M2.25 4h.5M2.25 8h.5M2.25 12h.5" ${LINE}/>`,
  share: `<path d="M8 10V1.75M5 4.5L8 1.75l3 2.75" ${LINE}/><path d="M4.5 7H2.75v7.25h10.5V7H11.5" ${LINE}/>`,
  // No fill here: the star's fill comes from the css on its host, so one symbol draws earned
  // (filled) and unearned (outline) stars.
  star: `<path d="M8 1.5l1.9 4.1 4.5.5-3.35 3 .95 4.4L8 11.2l-4 2.3.95-4.4-3.35-3 4.5-.5z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>`,
  demolish: `<rect x="1.75" y="1.75" width="12.5" height="12.5" ${LINE}/><path d="M5 5l6 6M11 5l-6 6" ${LINE}/>`,
  query: `<circle cx="7" cy="7" r="4.5" ${LINE}/><path d="M10.5 10.5l3.75 3.75" ${LINE}/>`,
  help: `<circle cx="8" cy="8" r="6.25" ${LINE}/><path d="M6.25 6.25a1.75 1.75 0 1 1 2.5 1.6c-.5.25-.75.6-.75 1.15v.5M8 11.5v.25" ${LINE}/>`,
  // The speed pill: two bars, one triangle, two and three triangles.
  pause: `<path d="M5.5 3v10M10.5 3v10" ${LINE} stroke-width="2"/>`,
  play: `<path d="M5 2.75v10.5L13 8z" ${LINE}/>`,
  fast: `<path d="M2 3.5v9L8 8zM8 3.5v9L14 8z" ${LINE}/>`,
  faster: `<path d="M1.25 4v8L5.5 8zM5.75 4v8L10 8zM10.25 4v8L14.5 8z" ${LINE}/>`,
  menu: `<path d="M2.5 4h11M2.5 8h11M2.5 12h11" ${LINE}/>`,
  close: `<path d="M4 4l8 8M12 4l-8 8" ${LINE}/>`,
  // The weather beside the clock (src/game/weather.ts kinds).
  clear: `<circle cx="8" cy="8" r="3" ${LINE}/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" ${LINE}/>`,
  cloudy: `<path d="M4.5 12.5h7a2.75 2.75 0 0 0 .3-5.5 3.75 3.75 0 0 0-7.2-.9A3.2 3.2 0 0 0 4.5 12.5z" ${LINE}/>`,
  rain: `<path d="M4.5 9.5h7a2.5 2.5 0 0 0 .3-5 3.5 3.5 0 0 0-6.7-.8A2.9 2.9 0 0 0 4.5 9.5z" ${LINE}/><path d="M5.5 11.5l-.75 2M8.5 11.5l-.75 2M11.5 11.5l-.75 2" ${LINE}/>`,
  storm: `<path d="M4.5 9.5h7a2.5 2.5 0 0 0 .3-5 3.5 3.5 0 0 0-6.7-.8A2.9 2.9 0 0 0 4.5 9.5z" ${LINE}/><path d="M8.75 10.5l-1.75 2.5h2.25l-1.5 2.25" ${LINE}/>`,
};

export const ICON_NAMES = Object.keys(SYMBOLS) as IconName[];

function symbolId(name: IconName): string {
  return `hs-icon-${name}`;
}

function svg(tag: string): SVGElement {
  return document.createElementNS(SVG_NS, tag) as SVGElement;
}

/**
 * The hidden sheet of symbols. Mount it once, anywhere in the document; every icon() refers
 * to it by id, so an icon drawn before or after it was mounted resolves all the same.
 */
export function createIconSheet(): SVGElement {
  const sheet = svg('svg');
  sheet.setAttribute('class', 'hs-icon-sheet');
  sheet.setAttribute('aria-hidden', 'true');
  sheet.setAttribute('width', '0');
  sheet.setAttribute('height', '0');
  sheet.setAttribute('focusable', 'false');
  for (const name of ICON_NAMES) {
    const symbol = svg('symbol');
    symbol.setAttribute('id', symbolId(name));
    symbol.setAttribute('viewBox', '0 0 16 16');
    symbol.innerHTML = SYMBOLS[name];
    sheet.append(symbol);
  }
  return sheet;
}

/** One icon, drawn by reference to its symbol. Decorative: the label next to it is the name. */
export function icon(name: IconName, className = 'hs-icon'): SVGElement {
  const node = svg('svg');
  node.setAttribute('class', className);
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('focusable', 'false');
  node.setAttribute('viewBox', '0 0 16 16');
  const use = svg('use');
  use.setAttribute('href', `#${symbolId(name)}`);
  node.append(use);
  return node;
}
