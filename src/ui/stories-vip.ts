// Stories' VIP visit section. Before arrival and during the stay: the guest with their portrait,
// when they arrive or where they are, the suite, what they like (character, not scoring), what
// every VIP rates, and the live checklist. Between visits: the last result in the same layout as
// the departure card (vip-cards.ts), read from the saved record, so it is still here after the
// card is closed and after a reload. Left out while there has never been a visit and none is
// booked. It rebuilds only when the words change.

import type { GameApi } from '../game/api';
import { el, section, type PanelBody } from './panels';
import { vipResultBlock, vipWho } from './vip-cards';
import { vipRule, vipView, vipViewKey, type VipView } from './vip';

/** The VIP visit: the booking or stay with its checklist, or the last result. */
export function vipCard(view: VipView, seed: number): HTMLDivElement {
  const node = section('VIP visit');
  node.classList.add('hs-vip');
  if (view.result) {
    node.append(vipResultBlock(seed, view.result));
    // lines[0] is the name, which the block already shows.
    for (const line of view.lines.slice(1)) node.append(el('p', 'hs-note', line));
    node.append(el('p', 'hs-note', vipRule()));
    return node;
  }
  node.append(vipWho(seed, view.simId, view.lines.slice(1)));
  const list = el('ul', 'hs-goals');
  for (const check of view.checklist ?? []) {
    const item = el('li', check.done ? 'hs-row hs-goal is-done' : 'hs-row hs-goal');
    item.append(el('span', 'hs-row-label', check.label), el('span', 'hs-row-value', check.done ? 'Ready' : 'Not yet'));
    list.append(item);
  }
  if (list.children.length > 0) node.append(list);
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
    node.replaceChildren(...(view ? [vipCard(view, game.world.seed)] : []));
    node.hidden = view === null;
  };
  refresh();
  return { node, refresh };
}
