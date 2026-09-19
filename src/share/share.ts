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
}

/** The highest floor with a room on it, 0 if the tower has none. Underground floors never count. */
export function shareStats(world: World): ShareStats {
  let floors = 0;
  for (const room of world.rooms.values()) {
    const top = room.floor + room.height - 1;
    if (top > floors) floors = top;
  }
  return { floors, people: world.population, stars: world.stars };
}

export function shareText(s: ShareStats): string {
  const peopleWord = s.people === 1 ? 'person' : 'people';
  return `I'm building a ${formatCount(s.floors)}-floor tower with ${formatCount(s.people)} ${peopleWord} in Hundred Stories, a free tower sim you play in the browser. Think you can do better?`;
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
  return `${SITE_URL}?${params.toString()}`;
}

const INT_RE = /^\d+$/;

/** Reads the numbers a shared link carries. All three must be present, integer and in range. */
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
  if (floors < 1 || floors > 200) return null;
  if (people < 0 || people > 999_999) return null;
  if (stars < 1 || stars > 6) return null;
  return { floors, people, stars };
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
