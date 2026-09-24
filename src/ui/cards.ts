// The first run's DOM: the intro panel, the side card that carries the guide and then the
// goals, and the tip toast. The words and the rules come from onboarding.ts; this only draws.

import type { GoalItem, Goals, GuideStep, GuideStepCopy, Tip } from './onboarding';
import { GUIDE_STEP_COUNT, INTRO_SCREENS } from './onboarding';
import { button, el, panelShell } from './panels';
import type { PanelElement } from './panels';
import { icon } from './icons';

/**
 * The intro: three screens in the panel pattern, with Next and Skip on every one. Skip, Close
 * and the last Next all end it, and `onDone` hears which (finished or not) once.
 */
export function createIntroPanel(onDone: (finished: boolean) => void): PanelElement {
  let ended = false;
  const end = (finished: boolean): void => {
    if (ended) return;
    ended = true;
    onDone(finished);
  };
  const { panel, body } = panelShell('Welcome', 'help', { close: () => end(false) });
  panel.classList.add('hs-intro');
  let index = 0;

  const count = el('p', 'hs-card-meta');
  const title = el('h3', 'hs-card-title');
  const lines = el('div', 'hs-intro-lines');
  const actions = el('div', 'hs-actions');
  const next = button('Next', 'hs-btn is-primary', () => {
    if (index >= INTRO_SCREENS.length - 1) {
      end(true);
      return;
    }
    index += 1;
    render();
  });
  const skip = button('Skip', 'hs-btn', () => end(false));
  skip.title = 'Skip the intro';
  actions.append(next, skip);
  body.append(count, title, lines, actions);

  function render(): void {
    const screen = INTRO_SCREENS[index];
    if (!screen) return;
    count.textContent = `${index + 1} of ${INTRO_SCREENS.length}`;
    title.textContent = screen.title;
    lines.replaceChildren(...screen.lines.map((line) => el('p', 'hs-intro-line', line)));
    next.textContent = index === INTRO_SCREENS.length - 1 ? 'Start building' : 'Next';
  }
  render();
  return panel;
}

export interface SideCard {
  node: HTMLDivElement;
  showGuide(step: GuideStep, copy: GuideStepCopy): void;
  showGoals(goals: Goals | null, nudge: string | null, collapsed: boolean): void;
  hide(): void;
}

export interface SideCardHandlers {
  skipGuide(): void;
  /** Phone only: open the palette sheet so the lit tile can be picked. */
  openTools(): void;
  toggleGoals(): void;
}

/**
 * The side card: the query panel's slot on a desktop, a sheet above the folded palette on a
 * phone. It carries one thing at a time, the guide step or the goals checklist.
 */
export function createSideCard(handlers: SideCardHandlers): SideCard {
  const node = el('div', 'hs-card is-hidden');
  node.setAttribute('role', 'region');
  let mode: 'none' | 'guide' | 'goals' = 'none';
  let key = '';

  const head = el('div', 'hs-panel-head');
  const name = el('h2', 'hs-panel-title');
  const titleIcon = el('span', 'hs-card-icon');
  const titleText = el('span', 'hs-panel-title-text');
  name.append(titleIcon, titleText);
  const headButton = button('Skip', 'hs-btn hs-panel-close', () => {
    if (mode === 'guide') handlers.skipGuide();
    else if (mode === 'goals') handlers.toggleGoals();
  });
  head.append(name, headButton);
  const body = el('div', 'hs-panel-body');
  node.append(head, body);

  function setHead(kind: 'help' | 'star', title: string, action: string, description: string): void {
    if (titleIcon.dataset['icon'] !== kind) {
      titleIcon.dataset['icon'] = kind;
      titleIcon.replaceChildren(icon(kind, 'hs-panel-icon') as unknown as HTMLElement);
    }
    setText(titleText, title);
    setText(headButton, action);
    if (headButton.title !== description) headButton.title = description;
    headButton.setAttribute('aria-label', description);
    node.setAttribute('aria-label', title);
  }

  return {
    node,
    showGuide(step, copy) {
      mode = 'guide';
      node.classList.remove('is-hidden', 'is-collapsed');
      setHead('help', 'First tower', 'Skip', 'Skip the guide');
      const nextKey = `guide:${step}:${copy.text}`;
      if (nextKey === key) return;
      key = nextKey;
      const actions = el('div', 'hs-actions hs-card-sheet-only');
      if (copy.tool) actions.append(button('Open build tools', 'hs-btn is-primary', () => handlers.openTools()));
      body.replaceChildren(
        el('p', 'hs-card-meta', `Step ${step + 1} of ${GUIDE_STEP_COUNT}`),
        el('h3', 'hs-card-title', copy.title),
        el('p', 'hs-card-text', copy.text),
        actions,
      );
    },
    showGoals(goals, nudge, collapsed) {
      mode = 'goals';
      node.classList.remove('is-hidden');
      node.classList.toggle('is-collapsed', collapsed);
      setHead('star', goals ? goals.title : 'Tower', collapsed ? 'Show' : 'Hide', collapsed ? 'Show the goals' : 'Hide the goals');
      const nextKey = `goals:${collapsed ? 'c' : 'o'}:${goals ? goals.items.map(itemKey).join('|') : 'top'}:${nudge ?? ''}`;
      if (nextKey === key) return;
      key = nextKey;
      if (collapsed) {
        body.replaceChildren();
        return;
      }
      const parts: HTMLElement[] = [];
      if (!goals) {
        parts.push(el('p', 'hs-card-text', 'Your tower has every star.'));
      } else {
        const list = el('ul', 'hs-goals');
        for (const item of goals.items) {
          const row = el('li', item.done ? 'hs-row hs-goal is-done' : 'hs-row hs-goal');
          row.append(el('span', 'hs-row-label', item.label), el('span', 'hs-row-value', item.value));
          list.append(row);
        }
        parts.push(list);
      }
      if (nudge) parts.push(el('p', 'hs-card-nudge', nudge));
      body.replaceChildren(...parts);
    },
    hide() {
      mode = 'none';
      key = '';
      node.classList.add('is-hidden');
    },
  };
}

function itemKey(item: GoalItem): string {
  return `${item.label}=${item.value}`;
}

/** One tip in the toast slot: its sentence and Got it, which is the only way it goes. */
export function createTipToast(tip: Tip, onGotIt: () => void): HTMLDivElement {
  const toast = el('div', 'hs-toast is-notice is-tip');
  toast.dataset['tip'] = tip.id;
  toast.append(el('p', 'hs-toast-text', tip.text));
  const row = el('div', 'hs-actions');
  row.append(button('Got it', 'hs-btn', onGotIt));
  toast.append(row);
  return toast;
}

/**
 * The star card: the new star, what it opened up, and an optional Stories so far. It sits in the
 * toast slot beside play, never over it, and Close is always there.
 */
export function createStarToast(title: string, unlocks: string, onStories: () => void, onClose: () => void): HTMLDivElement {
  const toast = el('div', 'hs-toast is-notice is-star');
  toast.append(el('p', 'hs-toast-text', title), el('p', 'hs-toast-text', unlocks));
  const row = el('div', 'hs-actions');
  row.append(button('Stories so far', 'hs-btn', onStories), button('Close', 'hs-btn', onClose));
  toast.append(row);
  return toast;
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}
