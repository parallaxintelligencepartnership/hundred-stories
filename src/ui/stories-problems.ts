// Stories' Tower problems section: what is wrong in the tower right now (towerProblems in
// problems.ts), one row each, with where, how bad and one or two buttons. Stories (stories.ts)
// shows it between Needs you now and the VIP visit, hidden while there is nothing wrong.
//
// A button leaves the menu the way Show on the tower does: the camera centers on the place, and
// an elevator's or a room's card opens after it. Rows are kept by their problem's key and their
// words updated in place, so a refresh never moves the focus a row's button holds.

import type { GameApi } from '../game/api';
import { button, el, section, type PanelBody, type PanelContext } from './panels';
import { towerProblems, type ProblemAction } from './problems';

export const PROBLEMS_TITLE = 'Tower problems';

interface ProblemRow {
  node: HTMLLIElement;
  text: HTMLElement;
  actions: HTMLElement;
  actionKey: string;
  /** What the buttons do now: read at the press, so a moved place is followed. */
  current: ProblemAction[];
}

/** The Tower problems section; its node is hidden while the tower has no problem. */
export function problemsSection(game: GameApi, ctx: PanelContext): PanelBody {
  const node = section(PROBLEMS_TITLE);
  node.classList.add('hs-problems');
  const list = el('ul', 'hs-log-list');
  node.append(list);
  const rows = new Map<string, ProblemRow>();

  const run = (action: ProblemAction): void => {
    ctx.centerOn?.(action.at.floor, action.at.x);
    if (action.select) ctx.select?.(action.select);
  };

  const makeRow = (key: string): ProblemRow => {
    const item = el('li', 'hs-log-item hs-problem is-warn');
    item.dataset['problem'] = key;
    const text = el('span', 'hs-log-text');
    const actions = el('div', 'hs-actions');
    item.append(text, actions);
    return { node: item, text, actions, actionKey: '', current: [] };
  };

  const refresh = (): void => {
    const problems = towerProblems(game.world);
    const order: HTMLElement[] = [];
    const open = new Set<string>();
    for (const problem of problems) {
      open.add(problem.key);
      let row = rows.get(problem.key);
      if (!row) {
        row = makeRow(problem.key);
        rows.set(problem.key, row);
      }
      if (row.text.textContent !== problem.text) row.text.textContent = problem.text;
      row.current = problem.actions;
      const actionKey = problem.actions.map((a) => a.label).join('|');
      if (row.actionKey !== actionKey) {
        row.actionKey = actionKey;
        const owner = row;
        row.actions.replaceChildren(
          ...problem.actions.map((a, i) =>
            button(a.label, 'hs-btn', () => {
              const now = owner.current[i];
              if (now) run(now);
            }),
          ),
        );
        row.actions.hidden = problem.actions.length === 0;
      }
      order.push(row.node);
    }
    for (const key of [...rows.keys()]) if (!open.has(key)) rows.delete(key);
    node.hidden = order.length === 0;
    // Put back in order only when out of it: moving a row would drop the focus it holds.
    if (order.length !== list.children.length || order.some((n, i) => list.children[i] !== n)) list.replaceChildren(...order);
  };

  refresh();
  return { node, refresh };
}
