// Today's tower on a fake DOM: the result card, its Share, the choice card, and the settings entry.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DailyChoice, DailyInfo } from '../../src/game/api';
import { dailyTwist } from '../../src/game/daily';
import { DAILY_COPY_FAILED } from '../../src/game/game';
import { createDailyPanel, dailyCard, type DailyPanelActions } from '../../src/ui/daily';
import { el, settingsBody, type PanelContext } from '../../src/ui/panels';
import { FakeDom, type FakeElement } from './fake-dom';

/** Settings as the pause menu's Settings page holds them (settingsBody; the old sheet is gone). */
function settingsNode(game: unknown, ctx: PanelContext): FakeElement {
  const root = el('div');
  root.append(settingsBody(game as never, ctx, { openControls() {} }).node);
  return root as unknown as FakeElement;
}

let uninstall: () => void;
beforeEach(() => {
  uninstall = new FakeDom().install();
});
afterEach(() => uninstall());

const ctx: PanelContext = {
  apply: () => ({ ok: true }) as never,
  notice: () => {},
  close: () => {},
  reducedMotion: false,
  setReducedMotion: () => {},
};

const DATE = '2026-09-28';

function dailyGame(opts: { finished?: boolean; choice?: DailyChoice | null; slot?: string; date?: string } = {}) {
  const twist = dailyTwist(opts.date ?? DATE);
  const daily: DailyInfo = { date: opts.date ?? DATE, twist: { name: twist.name, line: twist.line }, endMinute: 11880, finished: opts.finished ?? false };
  const rooms = new Map([[1, { floor: 12, height: 1 }]]);
  return {
    world: { seed: 1, log: [], logTotal: 0, population: 1234, stars: 3, cash: 456_789, rooms },
    getSlot: () => opts.slot ?? 'daily',
    getDaily: () => daily,
    getDailyChoice: () => opts.choice ?? null,
  } as never;
}

function click(node: FakeElement): void {
  for (const fn of node.listeners.get('click') ?? []) fn({} as never);
}

function buttonNamed(panel: FakeElement, label: string): FakeElement {
  const found = panel.descendants().find((n) => n.tagName === 'BUTTON' && n.textContent === label);
  if (!found) throw new Error(`no ${label} button`);
  return found;
}

function recorder(): DailyPanelActions & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    share: (text, url) => calls.push(`share:${text}|${url}`),
    myTower: () => calls.push('mine'),
    choose: (which) => calls.push(`choose:${which}`),
    startToday: () => calls.push('today'),
  };
}

describe('the result card', () => {
  it('shows the date, the twist, the people big, floors, stars and money', () => {
    const game = dailyGame({ finished: true });
    expect(dailyCard(game)).toBe('result');
    const panel = createDailyPanel(game, ctx, recorder(), DATE) as unknown as FakeElement;
    const text = panel.textContent;
    expect(text).toContain("Today's tower");
    expect(text).toContain('September 28, 2026');
    expect(text).toContain(dailyTwist(DATE).name);
    const big = panel.descendants().find((n) => n.className === 'hs-daily-people-count');
    expect(big?.textContent).toBe('1,234');
    expect(text).toContain('Floors12');
    expect(text).toContain('Stars★★★');
    expect(text).toContain('Money$456,789');
  });

  it('shares the plain message and a link to the same day through the share panel', () => {
    const actions = recorder();
    const panel = createDailyPanel(dailyGame({ finished: true }), ctx, actions, DATE) as unknown as FakeElement;
    click(buttonNamed(panel, 'Share'));
    click(buttonNamed(panel, 'My tower'));
    expect(actions.calls).toEqual([
      "share:I got 1,234 people in today's tower. Can you beat it?|https://hundredstories.xyz/play/?daily=2026-09-28",
      'mine',
    ]);
  });
});

describe('the start card and the choice', () => {
  it('says the twist in one plain sentence when the daily starts', () => {
    const game = dailyGame();
    expect(dailyCard(game)).toBe('start');
    const text = (createDailyPanel(game, ctx, recorder(), DATE) as unknown as FakeElement).textContent;
    expect(text).toContain(dailyTwist(DATE).line);
    expect(text).not.toMatch(/seed/i);
  });

  it("offers Finish yesterday's and Start today's", () => {
    const actions = recorder();
    const game = dailyGame({ choice: { savedDate: '2026-09-27', today: DATE, yesterday: true } });
    expect(dailyCard(game)).toBe('choose');
    const panel = createDailyPanel(game, ctx, actions, DATE) as unknown as FakeElement;
    click(buttonNamed(panel, "Finish yesterday's"));
    click(buttonNamed(panel, "Start today's"));
    expect(actions.calls).toEqual(['choose:finish', 'choose:today']);
  });
});

// Audit 2026-09-25, E2 S3 and verify-E E2 S4: whole sentences in the choice, and an older daily
// (finished after the choice) never says "today" or "Come back tomorrow" while today's is unplayed.
describe('an older daily', () => {
  it('names the older tower in a whole sentence', () => {
    const game = dailyGame({ choice: { savedDate: '2026-09-20', today: DATE, yesterday: false } });
    const text = (createDailyPanel(game, ctx, recorder(), DATE) as unknown as FakeElement).textContent;
    expect(text).toContain("You did not finish the tower from September 20, 2026 yet. You can finish it, or start today's.");
    expect(text).toContain('Finish the old one');
  });

  it("says yesterday's tower when it is yesterday's", () => {
    const game = dailyGame({ choice: { savedDate: '2026-09-27', today: DATE, yesterday: true } });
    const text = (createDailyPanel(game, ctx, recorder(), DATE) as unknown as FakeElement).textContent;
    expect(text).toContain("You did not finish yesterday's tower yet.");
  });

  it("finished on a later day: date-aware words and a Start today's button", () => {
    const actions = recorder();
    const game = dailyGame({ finished: true, date: '2026-09-24' });
    const panel = createDailyPanel(game, ctx, actions, '2026-09-25') as unknown as FakeElement;
    const notes = panel.descendants().filter((n) => n.className === 'hs-note').map((n) => n.textContent);
    expect(notes.join(' ')).not.toContain('Come back tomorrow');
    expect(notes).toContain("That was the tower from September 24, 2026. Today's tower is ready for you.");
    click(buttonNamed(panel, "Start today's"));
    click(buttonNamed(panel, 'Share'));
    expect(actions.calls[0]).toBe('today');
  });

  it('finished, dated after today (the date is behind it): no Start today\'s, and says why', () => {
    const game = dailyGame({ finished: true, date: '2026-09-30' });
    const panel = createDailyPanel(game, ctx, recorder(), DATE) as unknown as FakeElement;
    const notes = panel.descendants().filter((n) => n.className === 'hs-note').map((n) => n.textContent);
    expect(notes).toContain("Your device's date is behind this tower. A new one opens once the date catches up.");
    expect(panel.textContent).not.toContain("Today's tower is ready for you.");
    expect(panel.descendants().some((n) => n.tagName === 'BUTTON' && n.textContent === "Start today's")).toBe(false);
    buttonNamed(panel, 'Share');
  });

  it('finished on its own day still says come back tomorrow, with no Start button', () => {
    const panel = createDailyPanel(dailyGame({ finished: true }), ctx, recorder(), DATE) as unknown as FakeElement;
    expect(panel.textContent).toContain('Come back tomorrow for a new tower.');
    expect(panel.descendants().some((n) => n.tagName === 'BUTTON' && n.textContent === "Start today's")).toBe(false);
  });

  it('the start card of an older daily does not say today', () => {
    const game = dailyGame({ date: '2026-09-24' });
    const panel = createDailyPanel(game, ctx, recorder(), '2026-09-25') as unknown as FakeElement;
    const notes = panel.descendants().filter((n) => n.className === 'hs-note').map((n) => n.textContent);
    expect(notes).toContain(`Everyone who plays the tower from September 24, 2026 gets the same start. You have 8 days in the game to fit in as many people as you can.`);
  });
});

// Audit 2026-09-25, C S2 (the ui half): the saved Today's tower is dated after today because the
// device's date moved back. The card says so, names the date, and offers both ways on.
describe('a saved tower dated after today', () => {
  const ahead: DailyChoice = { savedDate: '2026-09-30', today: DATE, yesterday: false, ahead: true };
  const notesOf = (panel: FakeElement): string[] => panel.descendants().filter((n) => n.className === 'hs-note').map((n) => n.textContent);

  it('says plainly the saved tower is from a later date, and names it', () => {
    const panel = createDailyPanel(dailyGame({ choice: ahead }), ctx, recorder(), DATE) as unknown as FakeElement;
    const notes = notesOf(panel);
    expect(notes).toContain('The tower saved here is from September 30, 2026, which is later than today.');
    expect(panel.textContent).not.toContain('You did not finish');
    expect(panel.textContent).not.toMatch(/seed/i);
  });

  it('Keep playing that tower finishes it; Start today\'s tower instead starts today\'s', () => {
    const actions = recorder();
    const panel = createDailyPanel(dailyGame({ choice: ahead }), ctx, actions, DATE) as unknown as FakeElement;
    click(buttonNamed(panel, 'Keep playing that tower'));
    click(buttonNamed(panel, "Start today's tower instead"));
    expect(actions.calls).toEqual(['choose:finish', 'choose:today']);
  });

  it('when the copy could not be kept, says so in a plain line and keeps the choice', () => {
    const game = dailyGame({ choice: ahead }) as unknown as { world: { log: unknown[]; logTotal: number } };
    game.world.log.push({ minute: 0, text: DAILY_COPY_FAILED, level: 'warn' });
    game.world.logTotal += 1;
    const panel = createDailyPanel(game as never, ctx, recorder(), DATE) as unknown as FakeElement;
    expect(notesOf(panel)).toContain('We could not keep a copy, so that tower is still here.');
    buttonNamed(panel, 'Keep playing that tower');
    buttonNamed(panel, "Start today's tower instead");
  });

  it('says nothing about a copy before the player has tried', () => {
    const panel = createDailyPanel(dailyGame({ choice: ahead }), ctx, recorder(), DATE) as unknown as FakeElement;
    expect(panel.textContent).not.toContain('We could not keep a copy');
  });
});

// 2026-09-29 (Matt: "lock it"): a Today's tower date already played never opens a second try.
describe('a locked day', () => {
  const notesOf = (panel: FakeElement): string[] => panel.descendants().filter((n) => n.className === 'hs-note').map((n) => n.textContent);
  // The card's own buttons, not the sheet's close.
  const buttonsOf = (panel: FakeElement): string[] =>
    panel
      .descendants()
      .filter((n) => n.className === 'hs-actions')
      .flatMap((row) => row.descendants().filter((n) => n.tagName === 'BUTTON'))
      .map((n) => n.textContent);

  it('the date moved back: says so plainly, with no way to start a tower', () => {
    const locked: DailyChoice = { savedDate: DATE, today: DATE, yesterday: false, ahead: false, locked: 'clock-back' };
    const actions = recorder();
    const panel = createDailyPanel(dailyGame({ choice: locked, slot: 'mine', date: '2026-09-01' }), ctx, actions, DATE) as unknown as FakeElement;
    expect(notesOf(panel)).toEqual(["Your device's date has moved back. Today's tower opens again once the date catches up."]);
    expect(buttonsOf(panel)).toEqual(['OK']);
    click(buttonNamed(panel, 'OK'));
    expect(actions.calls).toEqual(['choose:finish']);
    expect(panel.textContent).not.toMatch(/seed/i);
  });

  it("an unfinished later tower behind the card: keep playing it, never start today's", () => {
    const locked: DailyChoice = { savedDate: '2026-09-30', today: DATE, yesterday: false, ahead: false, locked: 'clock-back' };
    const panel = createDailyPanel(dailyGame({ choice: locked, date: '2026-09-30' }), ctx, recorder(), DATE) as unknown as FakeElement;
    expect(notesOf(panel)).toEqual([
      'The tower saved here is from September 30, 2026, which is later than today.',
      "Your device's date has moved back. Today's tower opens again once the date catches up.",
    ]);
    expect(buttonsOf(panel)).toEqual(['Keep playing that tower']);
  });

  it("today's already finished: says a new one opens tomorrow", () => {
    const locked: DailyChoice = { savedDate: DATE, today: DATE, yesterday: false, ahead: false, locked: 'done' };
    const panel = createDailyPanel(dailyGame({ choice: locked, slot: 'mine', date: '2026-09-01' }), ctx, recorder(), DATE) as unknown as FakeElement;
    expect(notesOf(panel)).toEqual(["You already finished today's tower. A new one opens tomorrow."]);
    expect(buttonsOf(panel)).toEqual(['OK']);
  });
});

// Audit 2026-09-25, E1 S7: an older daily's twist line and share message do not say "today".
describe('the words for an older daily', () => {
  /** The first September date whose twist is this one. */
  const dateWith = (id: string): string => {
    for (let d = 1; d <= 28; d += 1) {
      const date = `2026-09-${String(d).padStart(2, '0')}`;
      if (dailyTwist(date).id === id) return date;
    }
    throw new Error(`no date with ${id}`);
  };

  it('the twist line on the start card speaks of that day, not today', () => {
    // A date whose twist is the normal day, so the line would be "No twist today."
    const date = dateWith('normal');
    const panel = createDailyPanel(dailyGame({ date }), ctx, recorder(), '2026-09-29') as unknown as FakeElement;
    const notes = panel.descendants().filter((n) => n.className === 'hs-note').map((n) => n.textContent);
    expect(notes.join(' ')).not.toMatch(/today/i);
    expect(notes).toContain('No twist on that day. Build the best tower you can.');
  });

  it('the tight money line on an older daily does not say today', () => {
    const date = dateWith('tightMoney');
    const panel = createDailyPanel(dailyGame({ date }), ctx, recorder(), '2026-09-29') as unknown as FakeElement;
    const notes = panel.descendants().filter((n) => n.className === 'hs-note').map((n) => n.textContent);
    expect(notes).toContain('This tower starts with less money, so spend it with care.');
  });

  it('the share message names the date of an older daily', () => {
    const actions = recorder();
    const panel = createDailyPanel(dailyGame({ finished: true, date: '2026-09-24' }), ctx, actions, '2026-09-25') as unknown as FakeElement;
    click(buttonNamed(panel, 'Share'));
    expect(actions.calls).toEqual([
      'share:I got 1,234 people in the tower from September 24, 2026. Can you beat it?|https://hundredstories.xyz/play/?daily=2026-09-24',
    ]);
  });
});

describe('settings', () => {
  // New game, My tower and Today's tower moved to the pause menu (2026-09-29): its slot rules are
  // pinned in tests/ui/pause-menu.test.ts. Settings carries none of them in any tower.
  it.each(['mine', 'daily', 'friend'] as const)('carries no New game, My tower or Today\'s tower in %s', (slot) => {
    const opened: string[] = [];
    const panel = settingsNode(dailyGame({ slot }), { ...ctx, openDaily: () => opened.push('daily'), openMyTower: () => opened.push('mine') });
    const words = panel.descendants().filter((n) => n.tagName === 'BUTTON').map((n) => n.textContent);
    for (const gone of ['New game', 'My tower', "Today's tower"]) expect(words).not.toContain(gone);
    expect(opened).toEqual([]);
  });
});
