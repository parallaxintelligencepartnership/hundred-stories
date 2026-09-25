// The friend-facing greeting on the landing page: when a shared link carries the sharer's
// numbers in the query string, this line greets the visitor with them. Pure textContent,
// no innerHTML, and it stays hidden when the link carries nothing or something invalid.
// When the link also carries the sharer's starting number, a second button starts the same
// tower: /play/?seed=N, which main.ts opens in the Friend's tower save slot, so it starts the
// same tower and never replaces the visitor's own (My tower).

import { parseChallenge } from '../share/share';
import { formatCount } from '../ui/format';

function starsPhrase(stars: number): string {
  if (stars === 6) return ' and TOWER status';
  return ` and ${stars} star${stars === 1 ? '' : 's'}`;
}

/** Where the Start the same tower button goes for a starting number. */
export function sameTowerHref(start: number): string {
  return `/play/?seed=${start}`;
}

/**
 * Exported for tests: fills and unhides the element, or leaves it alone when nothing is there.
 * The play button, when given, is unhidden and pointed at the same tower only when the link
 * carries a valid starting number.
 */
export function mountChallenge(
  search: string,
  el: { textContent: string; hidden: boolean },
  play?: { href: string; hidden: boolean },
): void {
  const stats = parseChallenge(search);
  if (!stats) return;
  const built = stats.floors === 0 ? 'just started a tower' : `built a ${formatCount(stats.floors)}-floor tower`;
  const people = `${formatCount(stats.people)} ${stats.people === 1 ? 'person' : 'people'}`;
  el.textContent = `A friend ${built} with ${people}${starsPhrase(stats.stars)}. Think you can do better?`;
  el.hidden = false;
  if (play && stats.start !== undefined) {
    play.href = sameTowerHref(stats.start);
    play.hidden = false;
  }
}

// Guarded so this module can be imported for its pure `mountChallenge` export in tests,
// which run in vitest's node environment and have no `document`.
if (typeof document !== 'undefined') {
  const banner = document.getElementById('challenge');
  const play = document.getElementById('challenge-play') as unknown as { href: string; hidden: boolean } | null;
  if (banner) mountChallenge(location.search, banner as unknown as { textContent: string; hidden: boolean }, play ?? undefined);
}
