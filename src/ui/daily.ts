// Today's tower cards: the start card with the day's twist, the choice between an older
// unfinished daily and today's, and the result card when the daily ends. One panel, whose
// content follows the game's state. Plain markup and the panels' shared classes only.

import type { GameApi } from '../game/api';
import { dailyResult, dailyShareText, dailyShareUrl, formatDateKey, DAILY_DAYS } from '../game/daily';
import { formatCount, formatMoney, starsGlyphs } from './format';
import { button, el, panelShell, row, tile, type PanelContext, type PanelElement } from './panels';

export const DAILY_TITLE = "Today's tower";

export interface DailyPanelActions {
  /** Open the share panel with the daily's own message and link. */
  share(text: string, url: string): void;
  /** One tap back to My tower. */
  myTower(): void;
  /** Answer the choice. */
  choose(which: 'finish' | 'today'): void;
}

/** Which card the panel shows now, or null when there is nothing daily to show. */
export type DailyCard = 'choose' | 'result' | 'start';

export function dailyCard(game: Pick<GameApi, 'getDaily' | 'getDailyChoice'>): DailyCard | null {
  if (game.getDailyChoice?.()) return 'choose';
  const daily = game.getDaily?.();
  if (!daily) return null;
  return daily.finished ? 'result' : 'start';
}

export function createDailyPanel(game: GameApi, ctx: PanelContext, actions: DailyPanelActions): PanelElement {
  const { panel, body } = panelShell(DAILY_TITLE, 'star', ctx);
  const card = dailyCard(game);
  panel.dataset.card = card ?? '';

  const choice = game.getDailyChoice();
  if (card === 'choose' && choice) {
    const older = choice.yesterday ? "yesterday's" : `the one from ${formatDateKey(choice.savedDate)}`;
    body.append(el('p', 'hs-note', `You did not finish ${older} tower yet. You can finish it, or start today's.`));
    const buttons = el('div', 'hs-actions');
    buttons.append(
      button(choice.yesterday ? "Finish yesterday's" : 'Finish the old one', 'hs-btn', () => actions.choose('finish')),
      button("Start today's", 'hs-btn', () => actions.choose('today')),
    );
    body.append(buttons);
    return panel;
  }

  const daily = game.getDaily();
  if (!daily) return panel;

  if (card === 'result') {
    const result = dailyResult(game.world, daily.date);
    body.append(row('Date', formatDateKey(result.date)), row('Twist', result.twist.name));
    // The score as a bento grid: the people big across the top, then floors, stars and money.
    const bento = el('div', 'hs-bento');
    const people = el('div', 'hs-tile is-wide hs-daily-people');
    people.append(
      el('span', 'hs-tile-label', result.people === 1 ? 'Person in the tower' : 'People in the tower'),
      el('span', 'hs-daily-people-count', formatCount(result.people)),
    );
    bento.append(
      people,
      tile('Floors', formatCount(result.floors)),
      tile('Stars', starsGlyphs(result.stars)),
      tile('Money', formatMoney(result.money), { wide: true, money: true }),
    );
    body.append(bento, el('p', 'hs-note', 'Come back tomorrow for a new tower.'));
    const buttons = el('div', 'hs-actions');
    buttons.append(
      button('Share', 'hs-btn is-primary', () => actions.share(dailyShareText(result.people), dailyShareUrl(result.date))),
      button('My tower', 'hs-btn', () => actions.myTower()),
    );
    body.append(buttons);
    return panel;
  }

  // The start card: the twist in one sentence, and how long the day lasts.
  body.append(
    row('Twist', daily.twist.name),
    el('p', 'hs-note', daily.twist.line),
    el('p', 'hs-note', `Everyone gets the same start today. You have ${DAILY_DAYS} days in the game to fit in as many people as you can.`),
  );
  const buttons = el('div', 'hs-actions');
  buttons.append(button('Start building', 'hs-btn is-primary', () => ctx.close()), button('My tower', 'hs-btn', () => actions.myTower()));
  body.append(buttons);
  return panel;
}
