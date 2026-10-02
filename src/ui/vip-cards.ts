// The VIP visit's own cards (Matt, P3c): the booking, the arrival in the lobby and the result,
// each in the news look of the alert stack (an amber icon, no stripe, a polite live region, not
// the assertive alert role), and the one result layout Stories reuses between visits. Words come
// from vip.ts; nothing here scores.

import { drawPortrait, personLookCode, type Ctx2D } from '../render/figure';
import { personName } from '../sim/identity';
import type { ActiveEvent, Id, World } from '../sim/types';
import { button, el } from './panels';
import { vipArrivalLine, vipSuiteLine, type VipResult } from './vip';

type VipEvent = Extract<ActiveEvent, { kind: 'vip' }>;

/** The portrait on a VIP card, in css px. */
export const VIP_PORTRAIT_PX = 40;

export const VIP_BOOKED_HEADLINE = 'A VIP is coming';
export const VIP_HERE_HEADLINE = 'The VIP is here';
export const VIP_SEE_CHECKLIST = 'See the checklist';
export const VIP_SEE_GUEST = 'See the guest';
export const VIP_SEE_SUITE = 'See the suite';
export const VIP_OPEN_STORIES = 'Open Stories';

/** What a VIP card's buttons do; the alert stack hands in the ui's own. */
export interface VipCardActions {
  openStories(): void;
  selectGuest(simId: Id): void;
  centerOn(floor: number, x: number): void;
}

/** A VIP card's body and how it keeps its words true while it stays up. */
export interface VipCardBody {
  nodes: HTMLElement[];
  refresh(world: World): void;
}

/** The guest's face, drawn as the person card draws it (render/figure.ts), once. */
export function vipPortrait(seed: number, simId: Id): HTMLCanvasElement {
  const canvas = el('canvas', 'hs-portrait hs-vip-portrait');
  const ratio = Math.min(3, Math.max(1, Math.round(globalThis.devicePixelRatio ?? 1)));
  canvas.width = VIP_PORTRAIT_PX * ratio;
  canvas.height = VIP_PORTRAIT_PX * ratio;
  canvas.style.width = `${VIP_PORTRAIT_PX}px`;
  canvas.style.height = `${VIP_PORTRAIT_PX}px`;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `Portrait of ${personName(seed, simId)}`);
  const context = canvas.getContext?.('2d');
  if (context) {
    context.scale(ratio, ratio);
    drawPortrait(context as unknown as Ctx2D, 'vip', personLookCode(seed, simId, 'vip'), VIP_PORTRAIT_PX);
  }
  return canvas;
}

/** The portrait with the name and a line or two beside it (words, or a line kept up to date). */
export function vipWho(seed: number, simId: Id, lines: readonly (string | HTMLElement)[]): HTMLDivElement {
  const node = el('div', 'hs-vip-who');
  const words = el('div', 'hs-vip-who-words');
  words.append(
    el('p', 'hs-vip-name', `${personName(seed, simId)}, VIP guest`),
    ...lines.map((line) => (typeof line === 'string' ? el('p', 'hs-vip-line', line) : line)),
  );
  node.append(vipPortrait(seed, simId), words);
  return node;
}

/**
 * A finished visit, laid out once for the departure card and for Stories: the rating as the
 * headline, who it was and how it ended, the reasons as short rows, what it means for the star,
 * and when a new VIP may book.
 */
export function vipResultBlock(seed: number, result: VipResult): HTMLDivElement {
  const node = el('div', `hs-vip-result is-${result.rating}`);
  node.dataset['rating'] = result.rating;
  const headline = el('p', 'hs-vip-headline', result.headline);
  const reasons = el('ul', 'hs-vip-reasons');
  for (const row of result.reasons) {
    const item = el('li', 'hs-row hs-vip-reason');
    item.append(el('span', 'hs-row-label', row.label), el('span', 'hs-row-value', row.value));
    reasons.append(item);
  }
  node.append(
    headline,
    vipWho(seed, result.simId, [result.outcome]),
    reasons,
    el('p', 'hs-vip-progress', result.progress),
    el('p', 'hs-vip-next', result.next),
  );
  return node;
}

function actionRow(...buttons: HTMLButtonElement[]): HTMLDivElement {
  const row = el('div', 'hs-actions');
  row.append(...buttons);
  return row;
}

/** Keep a text node's words in line with `words`, writing only on a change. */
function setText(node: HTMLElement, words: string): void {
  if (node.textContent !== words) node.textContent = words;
}

/** The booking: who, when they arrive in plain words, the suite's floor, and the way to the checklist. */
export function vipBookedBody(world: World, visit: VipEvent, actions: VipCardActions): VipCardBody {
  const when = el('p', 'hs-vip-line');
  const suite = el('p', 'hs-vip-line');
  const who = vipWho(world.seed, visit.simId, [when, suite]);
  const refresh = (now: World): void => {
    const live = (now.events ?? []).find((e): e is VipEvent => e.kind === 'vip' && e.simId === visit.simId);
    if (!live) return;
    setText(when, `${vipArrivalLine(now.time.minute, live.arrivesAt)}.`);
    setText(suite, `${vipSuiteLine(now, live)}.`);
  };
  refresh(world);
  return {
    nodes: [el('p', 'hs-toast-text', VIP_BOOKED_HEADLINE), who, actionRow(button(VIP_SEE_CHECKLIST, 'hs-btn', () => actions.openStories()))],
    refresh,
  };
}

/** The guest in the lobby: who, where they are heading, and a look at the guest or the suite. */
export function vipArrivedBody(world: World, visit: VipEvent, actions: VipCardActions): VipCardBody {
  const room = visit.suiteId === null ? undefined : world.rooms.get(visit.suiteId);
  const heading = room ? `Heading up to the suite on ${room.floor < 0 ? `floor B${-room.floor}` : `floor ${room.floor}`}.` : 'Heading up to the suite.';
  const guest = button(VIP_SEE_GUEST, 'hs-btn', () => actions.selectGuest(visit.simId));
  const suite = button(VIP_SEE_SUITE, 'hs-btn', () => {
    if (room) actions.centerOn(room.floor, room.x + Math.floor(room.width / 2));
  });
  const refresh = (now: World): void => {
    const here = now.sims?.has(visit.simId) ?? false;
    if (guest.disabled !== !here) guest.disabled = !here;
    const standing = room !== undefined && (now.rooms?.has(room.id) ?? false);
    if (suite.disabled !== !standing) suite.disabled = !standing;
  };
  refresh(world);
  return {
    nodes: [el('p', 'hs-toast-text', VIP_HERE_HEADLINE), vipWho(world.seed, visit.simId, [heading]), actionRow(guest, suite)],
    refresh,
  };
}

/** The visit ended: the result block and the way to Stories, where it stays. */
export function vipResultBody(world: World, result: VipResult, actions: VipCardActions): VipCardBody {
  return {
    nodes: [vipResultBlock(world.seed, result), actionRow(button(VIP_OPEN_STORIES, 'hs-btn', () => actions.openStories()))],
    refresh: () => {},
  };
}
