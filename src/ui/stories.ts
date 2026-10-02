// Stories: the one place for what is going on in the tower (Matt, 2026-10-01: Stories and News
// are one feature, finished under the name Stories, one page inside the pause card). One body,
// built here, in this order, each section left out while it has nothing to show except the first
// and Following:
//
// 1. Needs you now: one row per live incident, read from the world on every refresh (a fire, a
//    bomb threat, a theft under way, cockroaches, money). A fire carries Call a helicopter and a
//    bomb Pay ransom, built by the same functions as the alert cards (alerts.ts), so they follow
//    one rule. Every row with a place has Show on the tower, before any button that spends.
// 2. Tower problems: what is wrong right now, where, and what to do (stories-problems.ts).
// 3. VIP visit: the card the News panel drew, during and between visits (stories-vip.ts).
// 4. Following, then Around the tower: the people followed and the latest beats. Following is
//    shown with nobody in it too, with how to follow someone: nothing else in the game says.
// 5. Today: the log lines of the current game day, newest first; Show older adds fifty at a time
//    and reveals Yesterday and Earlier.
// 6. Milestones: the tower's firsts, newest first, with Last milestone and Tower chronicle.
//
// Each part rewrites only what moved, and the rows of Needs you now are kept and updated in place,
// so a button with focus stays put while the cash, the price or security change. Nothing here
// ever takes first focus on a button that spends money (aim).

import type { GameApi } from '../game/api';
import { describeBeat, goalLine, storyName, unfollowSim, type StoryBeat } from '../sim/story';
import type { Command, CommandResult, LogEntry, Milestone, World } from '../sim/types';
import { helicopterControl, ransomControl, type SpendControl } from './alerts';
import { needsYou, NEEDS_EMPTY, newsDays, TODAY_EMPTY, type NeedKind } from './news';
import { button, el, section, setLines, type PanelBody, type PanelContext } from './panels';
import { focusablesIn } from './sheet';
import { problemsSection } from './stories-problems';
import { vipSection } from './stories-vip';

/** Where Stories can open: a section, or the row of a live incident. */
export type StoriesTarget = 'needs' | 'problems' | 'vip' | 'following' | 'today' | 'milestones' | NeedKind;

/** How many tower beats Around the tower lists. */
export const STORIES_TOWER_LINES = 12;
/** Today shows this many of the newest lines at first, newest on top. */
export const TODAY_LINES = 10;
/** Each tap on Show older adds this many more. */
export const TODAY_OLDER_STEP = 50;
/** The word on each row with a place: it leaves the menu and centers the tower view there. */
export const SHOW_ON_TOWER = 'Show on the tower';
/** Following with nobody in it: the one place that says how to follow someone. */
export const FOLLOW_HINT = 'Nobody yet. Open a person and choose Follow.';

/**
 * When a line happened, in words, from the game clock: "just now", "an hour ago", "5 hours ago",
 * "yesterday", "3 days ago". Days are the game's calendar days, so last night is yesterday.
 */
export function timeAgo(now: number, minute: number): string {
  const ago = Math.max(0, Math.floor(now) - Math.floor(minute));
  if (ago < 60) return 'just now';
  if (ago < 120) return 'an hour ago';
  const days = Math.floor(Math.max(0, now) / 1440) - Math.floor(Math.max(0, minute) / 1440);
  if (days <= 0 || ago < 6 * 60) return `${Math.floor(ago / 60)} hours ago`;
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/** The Stories body, and how its host opens it at a place. */
export interface StoriesBody extends PanelBody {
  /** Rewrite what moved; the page calls it on every redraw. */
  refresh: () => void;
  /**
   * Bring a section or incident into view and name the control focus should land on: its first
   * control that does not spend money, or null for none (the host keeps focus on Back). With no
   * target, nothing moves and the answer is null.
   */
  aim(target?: StoriesTarget): HTMLElement | null;
}

/** A beat as the tower list shows it: a person's line carries their name. */
function towerBeatText(world: World, beat: StoryBeat): string {
  const line = describeBeat(beat, world);
  const personal = beat.code === 'wait.long' || beat.code === 'trip.arrived' || beat.code === 'trip.gaveUp' || beat.code === 'room.vacated';
  return personal && beat.simId !== undefined ? `${storyName(world, beat.simId)}: ${line}` : line;
}

/** A row of Needs you now, kept while its matter is open. */
interface NeedRow {
  node: HTMLLIElement;
  text: HTMLElement;
  go: HTMLButtonElement;
  at: { floor: number; x: number } | null;
  spend: SpendControl | null;
}

/** The first control in `root` a press can safely land on: never one that spends money. */
function firstSafe(root: HTMLElement): HTMLElement | null {
  return focusablesIn(root).find((node) => node.dataset?.['spend'] !== 'true') ?? null;
}

/** Scroll the pause card's page (the nearest hs-pause-page around it) so `target` sits at its top. */
function bringIntoView(target: HTMLElement): void {
  let box = target.parentNode as HTMLElement | null;
  while (box && !box.classList?.contains('hs-pause-page')) box = box.parentNode as HTMLElement | null;
  if (!box || typeof box.getBoundingClientRect !== 'function' || typeof target.getBoundingClientRect !== 'function') return;
  const offset = target.getBoundingClientRect().top - box.getBoundingClientRect().top;
  if (offset === 0) return;
  box.scrollTop = Math.max(0, (Number(box.scrollTop) || 0) + offset);
}

export function storiesBody(game: GameApi, ctx: PanelContext): StoriesBody {
  const node = el('div', 'hs-stories');

  // ------------------------------------------------------------ needs you now

  const needs = section('Needs you now');
  needs.classList.add('hs-needs');
  const needList = el('ul', 'hs-log-list');
  needs.append(needList);
  const needsEmpty = el('li', 'hs-log-item is-empty', NEEDS_EMPTY);
  const rows = new Map<NeedKind, NeedRow>();

  const makeRow = (kind: NeedKind): NeedRow => {
    const item = el('li', `hs-log-item hs-need is-${kind}`);
    item.dataset['need'] = kind;
    const text = el('span', 'hs-log-text');
    const actions = el('div', 'hs-actions');
    const row: NeedRow = { node: item, text, go: null as unknown as HTMLButtonElement, at: null, spend: null };
    // Show on the tower comes first in the row: it is never a press that spends.
    row.go = button(SHOW_ON_TOWER, 'hs-btn hs-need-go', () => {
      if (row.at) ctx.centerOn?.(row.at.floor, row.at.x);
    });
    actions.append(row.go);
    item.append(text, actions);
    // A press that ends the incident takes its row away: focus goes on in the page (A1).
    const spend = (cmd: Command): CommandResult => {
      const result = ctx.apply(cmd);
      afterSpend(row);
      return result;
    };
    if (kind === 'fire') row.spend = helicopterControl(spend);
    if (kind === 'bomb') row.spend = ransomControl(spend);
    if (row.spend) item.append(...row.spend.nodes);
    return row;
  };

  const refreshNeeds = (world: World): void => {
    const lines = needsYou(world);
    const open = new Set<NeedKind>();
    const order: HTMLElement[] = [];
    for (const line of lines) {
      open.add(line.kind);
      let row = rows.get(line.kind);
      if (!row) {
        row = makeRow(line.kind);
        rows.set(line.kind, row);
      }
      if (row.text.textContent !== line.text) row.text.textContent = line.text;
      row.at = line.at ?? null;
      if (row.go.hidden !== !line.at) row.go.hidden = !line.at;
      row.spend?.sync(world);
      order.push(row.node);
    }
    for (const kind of [...rows.keys()]) if (!open.has(kind)) rows.delete(kind);
    if (order.length === 0) order.push(needsEmpty);
    // Put back in order only when out of it: moving a row would drop the focus it holds.
    if (order.length !== needList.children.length || order.some((n, i) => needList.children[i] !== n)) needList.replaceChildren(...order);
  };

  /**
   * After Call a helicopter or Pay ransom: the page catches up at once. A row still open (the press
   * was refused) keeps its focus; a row that went gives it to the next row's first safe control,
   * else the one before, else the page's first safe control, else Back. Never a spend button.
   */
  const afterSpend = (row: NeedRow): void => {
    const before = Array.from(needList.children);
    const index = before.indexOf(row.node);
    refresh();
    if (row.node.parentNode === needList) return;
    const at = (i: number): HTMLElement | null => {
      const other = needList.children[i] as HTMLElement | undefined;
      return other && other !== needsEmpty ? firstSafe(other) : null;
    };
    const next = at(index) ?? at(index - 1) ?? firstSafe(node);
    if (ctx.rowsChanged) ctx.rowsChanged(next);
    else next?.focus?.();
  };

  // ------------------------------------------------------------ the slots

  const problems = problemsSection(game, ctx);
  const vip = vipSection(game);

  // ------------------------------------------------------------ following and the tower

  const following = section('Following');
  const followList = el('div', 'hs-occupants');
  following.append(followList);
  const tower = section('Around the tower');
  const towerList = el('ul', 'hs-story-chapter');
  tower.append(towerList);

  let followKey: string | null = null;
  /** The row at this place in the Following list, as the control focus lands on: the person, or a gone one's Unfollow. */
  const rowControl = (index: number): HTMLElement | null => {
    const row = index >= 0 ? (followList.children[index] as HTMLElement | undefined) : undefined;
    if (!row) return null;
    if (row.tagName === 'BUTTON') return (row as HTMLButtonElement).disabled ? null : row;
    const kids = Array.from(row.children) as HTMLElement[];
    return kids.find((kid) => kid.tagName === 'BUTTON' && !(kid as HTMLButtonElement).disabled) ?? null;
  };
  const refreshFollowing = (world: World): void => {
    // A world with no story record yet (a stub in the shell's tests) follows nobody.
    const story = world.story;
    const people = (story?.followed ?? []).map((id) => {
      const sim = world.sims.get(id);
      const thread = story?.threads[id] ?? [];
      const last = thread[thread.length - 1];
      const line = last ? describeBeat(last, world) : sim ? `${goalLine(world, sim)}.` : 'Left the tower.';
      return { id, name: storyName(world, id), line, here: sim !== undefined };
    });
    const key = people.map((r) => `${r.id}:${r.line}:${r.here ? 1 : 0}`).join('|');
    if (key === followKey) return;
    followKey = key;
    if (people.length === 0) {
      followList.replaceChildren(el('p', 'hs-note hs-follow-hint', FOLLOW_HINT));
      return;
    }
    followList.replaceChildren(
      ...people.map((r, index) => {
        const item = button('', 'hs-occupant', () => {
          if (r.here) ctx.select?.({ simId: r.id });
        });
        item.disabled = !r.here;
        item.replaceChildren(el('span', 'hs-occupant-name', r.name), el('span', 'hs-occupant-goal', r.line));
        if (r.here) return item;
        // Someone who left keeps their place until the player lets it go.
        const wrap = el('div', 'hs-occupant-gone');
        const release = button('Unfollow', 'hs-btn', () => {
          unfollowSim(game.world.story, r.id);
          refresh();
          // Focus stays in the list: the row that took this one's place, else the one before.
          const next = rowControl(index) ?? rowControl(index - 1);
          if (ctx.rowsChanged) ctx.rowsChanged(next);
          else next?.focus?.();
        });
        release.setAttribute('aria-label', `Unfollow ${r.name}`);
        wrap.append(item, release);
        return wrap;
      }),
    );
  };
  const refreshTower = (world: World): void => {
    const lines = (world.story?.recent ?? []).slice(-STORIES_TOWER_LINES).map((beat) => towerBeatText(world, beat));
    tower.hidden = lines.length === 0;
    setLines(towerList, lines, 'li', 'hs-story-item');
  };

  // ------------------------------------------------------------ today

  const today = section('Today');
  const todayList = el('ul', 'hs-log-list');
  const yesterdayTitle = el('h4', 'hs-news-day', 'Yesterday');
  const yesterdayList = el('ul', 'hs-log-list');
  const earlierTitle = el('h4', 'hs-news-day', 'Earlier');
  const earlierList = el('ul', 'hs-log-list');
  for (const part of [yesterdayTitle, yesterdayList, earlierTitle, earlierList]) part.hidden = true;
  let limit = TODAY_LINES;
  let olderOpen = false;
  const older = button('Show older', 'hs-btn hs-news-older', () => {
    limit = olderOpen ? limit + TODAY_OLDER_STEP : TODAY_LINES + TODAY_OLDER_STEP;
    olderOpen = true;
    refresh();
    ctx.rowsChanged?.(older.hidden ? null : older);
  });
  older.hidden = true;
  today.append(todayList, yesterdayTitle, yesterdayList, earlierTitle, earlierList, older);

  // ------------------------------------------------------------ milestones

  const milestones = section('Milestones');
  const milestoneList = el('ul', 'hs-log-list');
  const milestoneActions = el('div', 'hs-actions');
  milestones.append(milestoneList, milestoneActions);

  node.append(needs, problems.node, vip.node, following, tower, today, milestones);

  /** The time words of each line on show, with the minute each stands for, so they move with the clock. */
  let logStamps: { node: HTMLElement; minute: number }[] = [];
  let milestoneStamps: { node: HTMLElement; minute: number }[] = [];
  const item = (text: string, minute: number, now: number, level: LogEntry['level'], stamps: typeof logStamps): HTMLLIElement => {
    const line = el('li', `hs-log-item is-${level}`);
    const time = el('span', 'hs-log-time', timeAgo(now, minute));
    line.append(el('span', 'hs-log-text', text), time);
    stamps.push({ node: time, minute });
    return line;
  };

  /** What the day lists were built from: the log array, and a key of its total, the limit and the day. */
  let shownLog: readonly LogEntry[] | null = null;
  let shownKey = '';
  const refreshToday = (world: World, now: number): boolean => {
    const log = world.log ?? [];
    const key = `${world.logTotal}:${limit}:${olderOpen ? 1 : 0}:${Math.floor(Math.max(0, now) / 1440)}`;
    if (shownLog === log && key === shownKey) return false;
    shownLog = log;
    shownKey = key;
    logStamps = [];
    today.hidden = log.length === 0;
    const days = newsDays(log, now, limit, olderOpen);
    const lines = (entries: LogEntry[]) => entries.map((e) => item(e.text, e.minute, now, e.level, logStamps));
    todayList.replaceChildren(...(days.today.length > 0 ? lines(days.today) : [el('li', 'hs-log-item is-empty', TODAY_EMPTY)]));
    yesterdayList.replaceChildren(...lines(days.yesterday));
    earlierList.replaceChildren(...lines(days.earlier));
    yesterdayTitle.hidden = yesterdayList.hidden = days.yesterday.length === 0;
    earlierTitle.hidden = earlierList.hidden = days.earlier.length === 0;
    older.hidden = !days.more;
    return true;
  };

  let shownMilestones: readonly Milestone[] | null = null;
  let shownMilestoneCount = -1;
  const refreshMilestones = (world: World, now: number): boolean => {
    const story = world.story;
    // Reopen the last milestone and the chronicle, whenever the record holds them.
    const hasRecap = ctx.openRecap !== undefined && (story?.recent ?? []).some((beat) => beat.code === 'star.gained');
    const hasChronicle = ctx.openChronicle !== undefined && story?.chronicle !== null && story?.chronicle !== undefined;
    const actionKey = `${hasRecap ? 1 : 0}${hasChronicle ? 1 : 0}`;
    if (milestoneActions.dataset['key'] !== actionKey) {
      milestoneActions.dataset['key'] = actionKey;
      const actions: HTMLElement[] = [];
      if (hasRecap) actions.push(button('Last milestone', 'hs-btn', () => ctx.openRecap?.()));
      if (hasChronicle) actions.push(button('Tower chronicle', 'hs-btn', () => ctx.openChronicle?.()));
      milestoneActions.replaceChildren(...actions);
      milestoneActions.hidden = actions.length === 0;
    }
    const list = world.milestones ?? [];
    milestones.hidden = list.length === 0 && milestoneActions.hidden;
    if (list === shownMilestones && list.length === shownMilestoneCount) return false;
    shownMilestones = list;
    shownMilestoneCount = list.length;
    milestoneStamps = [];
    milestoneList.replaceChildren(...[...list].reverse().map((m) => item(m.text, m.minute, now, 'info', milestoneStamps)));
    milestoneList.hidden = list.length === 0;
    return true;
  };

  const refresh = (): void => {
    const world = game.world;
    const now = world.time?.minute ?? 0;
    refreshNeeds(world);
    problems.refresh?.();
    vip.refresh?.();
    refreshFollowing(world);
    refreshTower(world);
    const logBuilt = refreshToday(world, now);
    const milestonesBuilt = refreshMilestones(world, now);
    // Nothing new: only the words for when move on with the clock.
    for (const stamps of [logBuilt ? [] : logStamps, milestonesBuilt ? [] : milestoneStamps]) {
      for (const stamp of stamps) {
        const words = timeAgo(now, stamp.minute);
        if (stamp.node.textContent !== words) stamp.node.textContent = words;
      }
    }
  };

  const aim = (target?: StoriesTarget): HTMLElement | null => {
    if (!target) return null;
    refresh();
    const places: Partial<Record<StoriesTarget, HTMLElement>> = { needs, problems: problems.node, vip: vip.node, following, today, milestones };
    const place = places[target] ?? rows.get(target as NeedKind)?.node ?? needs;
    // A section with nothing to show (the incident just ended, no VIP yet) opens at the top.
    const shown = place.hidden ? needs : place;
    bringIntoView(shown);
    return firstSafe(shown);
  };

  refresh();
  return {
    node,
    refresh,
    aim,
    dispose: () => problems.dispose?.(),
  };
}
