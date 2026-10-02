// Stories' Tower problems section: what is wrong in the tower right now, each with where and what
// to do. A slot for now: a later package fills it. Stories (src/ui/stories.ts) shows it between
// Needs you now and the VIP visit, and leaves it out while this returns null.

import type { GameApi } from '../game/api';
import type { PanelBody, PanelContext } from './panels';

/** The Tower problems section, or null when there is none to show. */
export function problemsSection(_game: GameApi, _ctx: PanelContext): PanelBody | null {
  return null;
}
