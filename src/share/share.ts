// The share feature: turns the current tower into a numbers-and-link challenge, both as a
// composed PNG (see composeShareImage, the only function here that touches the DOM) and as
// a URL a friend can open. No backend: the numbers travel in the query string, and the
// landing page (src/site/challenge.ts) reads them back with parseChallenge.

import { formatCount, starsGlyphs } from '../ui/format';
import type { World } from '../sim/types';

export const SITE_URL = 'https://hundredstories.xyz/';

export interface ShareStats {
  floors: number;
  people: number;
  stars: number;
  /**
   * The tower's starting number (world.seed), so a friend can start the same tower. Travels as
   * `tower` in the link; absent from links made before it was added, and from invalid ones.
   */
  start?: number;
}

/** The largest starting number a link may carry: the range of the 32 bit rng state. */
export const MAX_START = 4_294_967_295;

function validStart(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 0 && n <= MAX_START;
}

/** The highest floor with a room on it, 0 if the tower has none. Underground floors never count. */
export function shareStats(world: World): ShareStats {
  let floors = 0;
  for (const room of world.rooms.values()) {
    const top = room.floor + room.height - 1;
    if (top > floors) floors = top;
  }
  const stats: ShareStats = { floors, people: world.population, stars: world.stars };
  if (validStart(world.seed)) stats.start = world.seed;
  return stats;
}

export function shareText(s: ShareStats): string {
  const peopleWord = s.people === 1 ? 'person' : 'people';
  return `I'm building a ${formatCount(s.floors)}-floor tower with ${formatCount(s.people)} ${peopleWord} in Hundred Stories, a free tower-building game you play in your browser. Think you can do better?`;
}

/** The full message a share sends: the text, then the link, on their own lines. */
export function shareMessage(s: ShareStats): string {
  return `${shareText(s)}\n${shareUrl(s)}`;
}

export function shareUrl(s: ShareStats): string {
  const params = new URLSearchParams({
    floors: String(s.floors),
    people: String(s.people),
    stars: String(s.stars),
  });
  if (s.start !== undefined && validStart(s.start)) params.set('tower', String(s.start));
  return `${SITE_URL}?${params.toString()}`;
}

const INT_RE = /^\d+$/;

/**
 * Reads the numbers a shared link carries. Floors, people and stars must be present, integer
 * and in range. Floors 0 is in range: a tower with nothing above ground yet shares it. The starting number is optional: when it is missing or invalid the challenge
 * still reads, just without `start`.
 */
export function parseChallenge(search: string): ShareStats | null {
  const params = new URLSearchParams(search);
  const floorsRaw = params.get('floors');
  const peopleRaw = params.get('people');
  const starsRaw = params.get('stars');
  if (floorsRaw === null || peopleRaw === null || starsRaw === null) return null;
  if (!INT_RE.test(floorsRaw) || !INT_RE.test(peopleRaw) || !INT_RE.test(starsRaw)) return null;
  const floors = Number(floorsRaw);
  const people = Number(peopleRaw);
  const stars = Number(starsRaw);
  if (floors < 0 || floors > 200) return null;
  if (people < 0 || people > 999_999) return null;
  if (stars < 1 || stars > 6) return null;
  const stats: ShareStats = { floors, people, stars };
  const startRaw = params.get('tower');
  if (startRaw !== null && INT_RE.test(startRaw) && validStart(Number(startRaw))) stats.start = Number(startRaw);
  return stats;
}

const BAND_HEIGHT = 96;
const MAX_WIDTH = 1200;
const BAND_BG = '#1c232e';
const BAND_TEXT = '#e8ecf2';

function bandFont(): string {
  const family = "'Bricolage Grotesque', system-ui, sans-serif";
  try {
    if (document.fonts?.check?.(`600 28px 'Bricolage Grotesque'`)) {
      return `600 28px ${family}`;
    }
  } catch {
    // fall through to the system font
  }
  return `600 28px system-ui, sans-serif`;
}

/** Scales the snapshot down to at most MAX_WIDTH and adds a caption band with the numbers. */
export function composeShareImage(source: HTMLCanvasElement, s: ShareStats): HTMLCanvasElement {
  const scale = Math.min(1, MAX_WIDTH / source.width);
  const width = Math.round(source.width * scale);
  const imageHeight = Math.round(source.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = imageHeight + BAND_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('share: no 2d context');

  ctx.drawImage(source, 0, 0, width, imageHeight);

  ctx.fillStyle = BAND_BG;
  ctx.fillRect(0, imageHeight, width, BAND_HEIGHT);

  ctx.fillStyle = BAND_TEXT;
  ctx.font = bandFont();
  ctx.textBaseline = 'middle';
  const bandCenterY = imageHeight + BAND_HEIGHT / 2;

  ctx.textAlign = 'left';
  ctx.fillText('Hundred Stories  ·  hundredstories.xyz', 24, bandCenterY);

  const starGlyphs = starsGlyphs(s.stars);
  ctx.textAlign = 'right';
  ctx.fillText(
    `${formatCount(s.floors)} floors  ·  ${formatCount(s.people)} people  ·  ${starGlyphs}`,
    width - 24,
    bandCenterY,
  );

  return canvas;
}

// ------------------------------------------------------- chronicle image

export const LIST_IMAGE_WIDTH = 1200;
const LIST_PAD = 48;
const LIST_TITLE_PX = 36;
const LIST_BODY_PX = 24;
const LIST_LINE_GAP = 12;

/** The share card's family at a given weight and size, or the system font when it is not loaded. */
function listFont(weight: number, px: number): string {
  const family = "'Bricolage Grotesque', system-ui, sans-serif";
  try {
    if (document.fonts?.check?.(`${weight} ${px}px 'Bricolage Grotesque'`)) return `${weight} ${px}px ${family}`;
  } catch {
    // fall through to the system font
  }
  return `${weight} ${px}px system-ui, sans-serif`;
}

/** Words into rows no wider than maxWidth; a single word wider than that gets a row of its own. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  let row = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = row ? `${row} ${word}` : word;
    if (row && ctx.measureText(next).width > maxWidth) {
      out.push(row);
      row = word;
    } else row = next;
  }
  if (row) out.push(row);
  return out.length > 0 ? out : [''];
}

/**
 * A plain list as a canvas in the share card's typography and palette: a title, the lines, and
 * the site name in the band at the foot. 1200 px wide, as tall as the lines need.
 */
export function composeListImage(title: string, lines: readonly string[]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const width = LIST_IMAGE_WIDTH;
  canvas.width = width;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('share: no 2d context');

  const bodyFont = listFont(400, LIST_BODY_PX);
  ctx.font = bodyFont;
  const wrapped = lines.map((line) => wrapText(ctx, line, width - LIST_PAD * 2));
  const rowCount = wrapped.reduce((sum, rows) => sum + rows.length, 0);
  const rowHeight = Math.round(LIST_BODY_PX * 1.35);
  const height = LIST_PAD + LIST_TITLE_PX + LIST_LINE_GAP * 2 + rowCount * rowHeight + wrapped.length * LIST_LINE_GAP + BAND_HEIGHT;
  canvas.height = height; // a resize resets the context, so every style is set after it

  ctx.fillStyle = BAND_BG;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = BAND_TEXT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  let y = LIST_PAD;
  ctx.font = listFont(600, LIST_TITLE_PX);
  ctx.fillText(title, LIST_PAD, y);
  y += LIST_TITLE_PX + LIST_LINE_GAP * 2;

  ctx.font = bodyFont;
  for (const rows of wrapped) {
    for (const row of rows) {
      ctx.fillText(row, LIST_PAD, y);
      y += rowHeight;
    }
    y += LIST_LINE_GAP;
  }

  ctx.font = bandFont();
  ctx.textBaseline = 'middle';
  ctx.fillText('Hundred Stories  ·  hundredstories.xyz', LIST_PAD, height - BAND_HEIGHT / 2);
  return canvas;
}

/** The canvas as a PNG blob; rejects when the browser cannot encode it. */
export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('share: no png'))), 'image/png');
  });
}
