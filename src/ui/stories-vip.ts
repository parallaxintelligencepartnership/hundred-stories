// Stories' VIP visit section: the card the News panel drew (moved here as it was, 2026-10-01),
// shown during a visit and between visits, and left out while vipView has nothing to say (below
// the VIP star with no visit yet). It rebuilds only when the card's words change.

import type { GameApi } from '../game/api';
import { el, section, type PanelBody } from './panels';
import { vipView, vipViewKey, type VipView } from './vip';

/** The VIP visit: who, what they care about, the preparation ticks or the last rating, and the next chance. */
export function vipCard(view: VipView): HTMLDivElement {
  const node = section('VIP visit');
  node.classList.add('hs-vip');
  for (const line of view.lines) node.append(el('p', 'hs-story-line', line));
  const rows = view.checklist
    ? view.checklist.map((check) => ({ label: check.label, value: check.done ? 'Ready' : 'Not yet', done: check.done }))
    : (view.breakdown ?? []).map((r) => ({ label: r.label, value: r.value, done: false }));
  if (rows.length > 0) {
    const list = el('ul', 'hs-goals');
    for (const r of rows) {
      const item = el('li', r.done ? 'hs-row hs-goal is-done' : 'hs-row hs-goal');
      item.append(el('span', 'hs-row-label', r.label), el('span', 'hs-row-value', r.value));
      list.append(item);
    }
    node.append(list);
  }
  if (view.nextChance) node.append(el('p', 'hs-note', view.nextChance));
  return node;
}

/** The section's holder: empty and hidden while there is no card. */
export function vipSection(game: GameApi): PanelBody {
  const node = el('div', 'hs-stories-vip');
  let shown: string | null = null;
  const refresh = (): void => {
    const view = vipView(game.world);
    const key = vipViewKey(view);
    if (key === shown) return;
    shown = key;
    node.replaceChildren(...(view ? [vipCard(view)] : []));
    node.hidden = view === null;
  };
  refresh();
  return { node, refresh };
}
