// Today's tower cards: the start card with the day's twist, the choice between an older
// unfinished daily and today's, and the result card when the daily ends. One panel, whose
// content follows the game's state. Plain markup and the panels' shared classes only.

import type { GameApi } from '../game/api';
import { dailyResult, dailyShareText, dailyShareUrl, formatDateKey, localDateKey, DAILY_DAYS } from '../game/daily';
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
  /** Open today's tower, from the result card of an older one. */
  startToday(): void;
}

/** Which card the panel shows now, or null when there is nothing daily to show. */
export type DailyCard = 'choose' | 'result' | 'start';

export function dailyCard(game: Pick<GameApi, 'getDaily' | 'getDailyChoice'>): DailyCard | null {
  if (game.getDailyChoice?.()) return 'choose';
  const daily = game.getDaily?.();
  if (!daily) return null;
  return daily.finished ? 'result' : 'start';
}

/** `today` is the player's local date (YYYY-MM-DD); a daily from another date is spoken of by its date. */
export function createDailyPanel(
  game: GameApi,
  ctx: PanelContext,
  actions: DailyPanelActions,
  today: string = localDateKey(),
): PanelElement {
  const { panel, body } = panelShell(DAILY_TITLE, 'star', ctx);
  const card = dailyCard(game);
  panel.dataset.card = card ?? '';

  const choice = game.getDailyChoice();
  if (card === 'choose' && choice) {
    const older = choice.yesterday ? "yesterday's tower" : `the tower from ${formatDateKey(choice.savedDate)}`;
    body.append(el('p', 'hs-note', `You did not finish ${older} yet. You can finish it, or start today's.`));
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
  // An older daily, finished after the choice: today's tower is still there to play.
  const older = daily.date !== today;

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
    body.append(
      bento,
      el(
        'p',
        'hs-note',
        older ? `That was the tower from ${formatDateKey(daily.date)}. Today's tower is ready for you.` : 'Come back tomorrow for a new tower.',
      ),
    );
    const buttons = el('div', 'hs-actions');
    if (older) buttons.append(button("Start today's", 'hs-btn is-primary', () => actions.startToday()));
    buttons.append(
      button('Share', older ? 'hs-btn' : 'hs-btn is-primary', () => actions.share(dailyShareText(result.people), dailyShareUrl(result.date))),
      button('My tower', 'hs-btn', () => actions.myTower()),
    );
    body.append(buttons);
    return panel;
  }

  // The start card: the twist in one sentence, and how long the day lasts.
  body.append(
    row('Twist', daily.twist.name),
    el('p', 'hs-note', daily.twist.line),
    el(
      'p',
      'hs-note',
      `${older ? `Everyone who plays the tower from ${formatDateKey(daily.date)} gets the same start.` : 'Everyone gets the same start today.'} You have ${DAILY_DAYS} days in the game to fit in as many people as you can.`,
    ),
  );
  const buttons = el('div', 'hs-actions');
  buttons.append(button('Start building', 'hs-btn is-primary', () => ctx.close()), button('My tower', 'hs-btn', () => actions.myTower()));
  body.append(buttons);
  return panel;
}
