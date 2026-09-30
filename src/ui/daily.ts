// Today's tower cards: the start card with the day's twist, the choice between an older
// unfinished daily and today's, and the result card when the daily ends. One panel, whose
// content follows the game's state. Plain markup and the panels' shared classes only.
//
// The pause menu's Today's tower page (dailyPeekBody) says the same, read before any switch
// (GameApi.peekDaily): the player's answer there is what switches towers.

import type { DailyPeek, GameApi } from '../game/api';
import {
  dailyResult,
  dailyShareText,
  dailyShareUrl,
  dailyTwist,
  dailyTwistLine,
  formatDateKey,
  localDateKey,
  DAILY_DAYS,
  type DailyResult,
} from '../game/daily';
import { DAILY_CLOCK_BACK, DAILY_COPY_FAILED, DAILY_DONE } from '../game/game';
import { formatCount, formatMoney, starsGlyphs } from './format';
import { button, el, exportSave, panelShell, row, tile, type PanelContext, type PanelElement } from './panels';

export const DAILY_TITLE = "Today's tower";
/** Said on the card when "Start today's tower instead" could not keep a copy of the later tower. */
export const COPY_FAILED_NOTE = 'We could not keep a copy, so that tower is still here.';
/** The button that gets the kept copy of a later-dated tower back out, as a file. */
export const SAVE_KEPT_DAILY = 'Save the kept tower to a file';
/** The result card of a tower dated after today, in place of "Today's tower is ready for you." */
export const DATE_BEHIND_NOTE = "Your device's date is behind this tower. A new one opens once the date catches up.";

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
  if (card === 'choose' && choice?.locked) {
    // A day already played: nothing starts. An unfinished tower saved here may stand behind it.
    const behind = game.getDaily()?.date === choice.savedDate && choice.locked === 'clock-back';
    if (behind && choice.savedDate > choice.today) {
      body.append(el('p', 'hs-note', `The tower saved here is from ${formatDateKey(choice.savedDate)}, which is later than today.`));
    }
    body.append(el('p', 'hs-note', choice.locked === 'clock-back' ? DAILY_CLOCK_BACK : DAILY_DONE));
    const buttons = el('div', 'hs-actions');
    buttons.append(button(behind ? 'Keep playing that tower' : 'OK', 'hs-btn', () => actions.choose('finish')));
    body.append(buttons);
    return panel;
  }
  if (card === 'choose' && choice?.ahead) {
    // The saved tower is dated after today: the device's date moved back. It is never replaced
    // without the player's say, and starting today's keeps a copy of it first.
    body.append(
      el('p', 'hs-note', `The tower saved here is from ${formatDateKey(choice.savedDate)}, which is later than today.`),
      el('p', 'hs-note', "You can keep playing it, or start today's tower. We keep a copy of it first."),
    );
    // The game logs this line when that copy could not be kept, and the choice stays.
    const newest = game.world.log[game.world.log.length - 1];
    if (newest?.text === DAILY_COPY_FAILED) body.append(el('p', 'hs-note', COPY_FAILED_NOTE));
    const buttons = el('div', 'hs-actions');
    buttons.append(
      button('Keep playing that tower', 'hs-btn', () => actions.choose('finish')),
      button("Start today's tower instead", 'hs-btn', () => actions.choose('today')),
    );
    body.append(buttons);
    return panel;
  }
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
  // "Start today's tower instead" kept a copy of the later tower: this is the way to get it out,
  // through the same dialog, share sheet or download as Save to a file.
  const keptButton = (): HTMLElement | null => {
    const kept = game.getKeptDailyCopy?.() ?? null;
    if (kept === null) return null;
    return button(SAVE_KEPT_DAILY, 'hs-btn', () => exportSave(game.getKeptDailyCopy?.() ?? kept, ctx));
  };
  // An older daily, finished after the choice: today's tower is still there to play.
  const older = daily.date !== today;
  // Dated after today: the device's date is behind a tower already played, and nothing new opens.
  const behind = daily.date > today;

  if (card === 'result') {
    const result = dailyResult(game.world, daily.date);
    body.append(
      ...resultNodes(result),
      el(
        'p',
        'hs-note',
        behind
          ? DATE_BEHIND_NOTE
          : older
            ? `That was the tower from ${formatDateKey(daily.date)}. Today's tower is ready for you.`
            : 'Come back tomorrow for a new tower.',
      ),
    );
    const buttons = el('div', 'hs-actions');
    // A tower dated after today: that date was already played, so today's stays locked (game.ts).
    if (older && !behind) buttons.append(button("Start today's", 'hs-btn is-primary', () => actions.startToday()));
    buttons.append(
      button('Share', older && !behind ? 'hs-btn' : 'hs-btn is-primary', () =>
        actions.share(dailyShareText(result.people, result.date, today), dailyShareUrl(result.date)),
      ),
      button('My tower', 'hs-btn', () => actions.myTower()),
    );
    const keptResult = keptButton();
    if (keptResult) buttons.append(keptResult);
    body.append(buttons);
    return panel;
  }

  // The start card: the twist in one sentence, and how long the day lasts.
  body.append(
    row('Twist', daily.twist.name),
    el('p', 'hs-note', older ? dailyTwistLine(daily.date, today) : daily.twist.line),
    el('p', 'hs-note', startNote(older ? daily.date : null)),
  );
  const buttons = el('div', 'hs-actions');
  buttons.append(button('Start building', 'hs-btn is-primary', () => ctx.close()), button('My tower', 'hs-btn', () => actions.myTower()));
  const keptStart = keptButton();
  if (keptStart) buttons.append(keptStart);
  body.append(buttons);
  return panel;
}

/** How long the day lasts, and that everyone starts the same: `olderDate` for a daily from before today. */
function startNote(olderDate: string | null): string {
  const same = olderDate ? `Everyone who plays the tower from ${formatDateKey(olderDate)} gets the same start.` : 'Everyone gets the same start today.';
  return `${same} You have ${DAILY_DAYS} days in the game to fit in as many people as you can.`;
}

/** The result: its date and twist, then the score as a bento grid (the people big across the top, then floors, stars and money). */
function resultNodes(result: DailyResult): HTMLElement[] {
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
  return [row('Date', formatDateKey(result.date)), row('Twist', result.twist.name), bento];
}

/** What the player can answer on the Today's tower page: each switches towers and closes the menu. */
export type DailyGo = 'open' | 'finish' | 'today';

/** The start card's words when nothing was read (a stand-in game with no peekDaily): today's, fresh. */
export function freshPeek(today: string = localDateKey()): DailyPeek {
  return { today, opening: 'fresh', savedDate: null, savedUnfinished: false, yesterday: false, result: null };
}

/**
 * The pause menu's Today's tower page: the card openDaily would put up, said before the switch.
 * Every answer is `go`, which switches and closes the menu; a locked day with nothing to go on
 * with has no answer but Back.
 */
export function dailyPeekBody(peek: DailyPeek, go: (which: DailyGo) => void): HTMLDivElement {
  const body = el('div', 'hs-daily');
  body.dataset['card'] = peek.opening;
  const actions = el('div', 'hs-actions');
  const answer = (words: string, which: DailyGo, primary = false): void => {
    actions.append(button(words, primary ? 'hs-btn is-primary' : 'hs-btn', () => go(which)));
  };
  const later = peek.savedDate !== null && peek.savedDate > peek.today;
  const laterLine = (): HTMLElement =>
    el('p', 'hs-note', `The tower saved here is from ${formatDateKey(peek.savedDate ?? '')}, which is later than today.`);

  if (peek.opening === 'clock-back' || peek.opening === 'done') {
    // A day already played: nothing starts. An unfinished tower saved here may stand behind it.
    const behind = peek.opening === 'clock-back' && peek.savedUnfinished;
    if (behind && later) body.append(laterLine());
    body.append(el('p', 'hs-note', peek.opening === 'clock-back' ? DAILY_CLOCK_BACK : DAILY_DONE));
    if (behind) answer('Keep playing that tower', 'finish', true);
  } else if (peek.opening === 'ahead') {
    body.append(laterLine(), el('p', 'hs-note', "You can keep playing it, or start today's tower. We keep a copy of it first."));
    answer('Keep playing that tower', 'finish');
    answer("Start today's tower instead", 'today');
  } else if (peek.opening === 'choose') {
    const older = peek.yesterday ? "yesterday's tower" : `the tower from ${formatDateKey(peek.savedDate ?? '')}`;
    body.append(el('p', 'hs-note', `You did not finish ${older} yet. You can finish it, or start today's.`));
    answer(peek.yesterday ? "Finish yesterday's" : 'Finish the old one', 'finish');
    answer("Start today's", 'today');
  } else if (peek.result) {
    body.append(...resultNodes(peek.result), el('p', 'hs-note', 'Come back tomorrow for a new tower.'));
    answer("Open today's tower", 'open', true);
  } else {
    const twist = dailyTwist(peek.today);
    body.append(row('Twist', twist.name), el('p', 'hs-note', twist.line), el('p', 'hs-note', startNote(null)));
    answer(peek.opening === 'resume' ? 'Keep building' : 'Start building', 'open', true);
  }
  if (actions.children.length > 0) body.append(actions);
  return body;
}
