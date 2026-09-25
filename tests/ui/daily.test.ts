// Today's tower on a fake DOM: the result card, its Share, the choice card, and the settings entry.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DailyChoice, DailyInfo } from '../../src/game/api';
import { dailyTwist } from '../../src/game/daily';
import { createDailyPanel, dailyCard, type DailyPanelActions } from '../../src/ui/daily';
import { createSettingsPanel, type PanelContext } from '../../src/ui/panels';
import { FakeDom, type FakeElement } from './fake-dom';

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

describe('settings', () => {
  it("puts Today's tower next to New game in My tower", () => {
    const opened: string[] = [];
    const panel = createSettingsPanel(dailyGame({ slot: 'mine' }), { ...ctx, openDaily: () => opened.push('daily'), openMyTower: () => opened.push('mine') }) as unknown as FakeElement;
    const newGame = buttonNamed(panel, 'New game');
    const today = buttonNamed(panel, "Today's tower");
    expect(newGame.parentNode).toBe(today.parentNode);
    click(today);
    expect(opened).toEqual(['daily']);
  });

  it('outside My tower offers My tower in place of New game, so New game never runs in another slot', () => {
    const opened: string[] = [];
    const panel = createSettingsPanel(dailyGame({ slot: 'daily' }), { ...ctx, openDaily: () => opened.push('daily'), openMyTower: () => opened.push('mine') }) as unknown as FakeElement;
    expect(panel.descendants().some((n) => n.tagName === 'BUTTON' && n.textContent === 'New game')).toBe(false);
    click(buttonNamed(panel, 'My tower'));
    expect(opened).toEqual(['mine']);
  });
});
