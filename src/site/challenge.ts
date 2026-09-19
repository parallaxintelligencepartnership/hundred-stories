// The friend-facing greeting on the landing page: when a shared link carries the sharer's
// numbers in the query string, this line greets the visitor with them. Pure textContent,
// no innerHTML, and it stays hidden when the link carries nothing or something invalid.

import { parseChallenge } from '../share/share';

function starsPhrase(stars: number): string {
  if (stars === 6) return ' and TOWER status';
  return ` and ${stars} star${stars === 1 ? '' : 's'}`;
}

/** Exported for tests: fills and unhides the element, or leaves it alone when nothing is there. */
export function mountChallenge(search: string, el: { textContent: string; hidden: boolean }): void {
  const stats = parseChallenge(search);
  if (!stats) return;
  el.textContent = `A friend built a ${stats.floors}-floor tower with ${stats.people} people${starsPhrase(stats.stars)}. Think you can do better?`;
  el.hidden = false;
}

// Guarded so this module can be imported for its pure `mountChallenge` export in tests,
// which run in vitest's node environment and have no `document`.
if (typeof document !== 'undefined') {
  const banner = document.getElementById('challenge');
  if (banner) mountChallenge(location.search, banner as unknown as { textContent: string; hidden: boolean });
}
