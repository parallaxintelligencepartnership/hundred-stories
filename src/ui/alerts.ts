// The alert stack: the cards that answer alert lines in the world log, and the short notices a
// refused command leaves. A fire is one incident with one card that updates in place, however
// many rooms catch, and that card always carries the player's response. Every card closes, and
// the stack shows at most three cards with the rest folded into one "and N more" line. A bomb
// threat is one card that trades its ransom button for the outcome; an infestation is one card too.
// A theft is one card that says whether a guard is on the way, then how it ended.
//
// The sim logs one line per burning room and has no incident id, so the incident is derived here
// from the log lines (their text and roomId) and from the fire event in world.events.

import { EVENTS } from '../sim/rules';
import type { Command, CommandResult, Id, LogEntry, World } from '../sim/types';
import { formatMoney } from './format';
import { button, el } from './panels';

/** Cards shown at once; older ones fold into the "and N more" line. */
export const ALERT_STACK_MAX = 3;
/** Real milliseconds a card without a decision stays up. */
export const ALERT_LINGER_MS = 8000;
/** Real milliseconds the "Fire out" closing state stays up. */
export const FIRE_OUT_LINGER_MS = 8000;
/** Real milliseconds a notice stays up. */
export const NOTICE_LINGER_MS = 6000;

export const SECURITY_RESPONDING = 'Security is responding.';
export const SECURITY_LESSON = 'A security office puts fires out on its own.';

export interface AlertStackDeps {
  /** The container the cards go in (the ui's toasts region). */
  host: HTMLElement;
  getWorld(): World;
  apply(cmd: Command): CommandResult;
  /** Run `fn` after `ms` real milliseconds; the ui owns the timers so destroy clears them. */
  later(fn: () => void, ms: number): void;
}

export interface AlertStack {
  /** A fresh alert line from the log. Fire lines feed the incident card instead of a card each. */
  onAlert(entry: LogEntry): void;
  /** A short notice, such as a refusal reason. */
  notice(text: string): void;
  /** Bring the fire card in line with the world. Run after every drain of the log. */
  sync(): void;
  /** Escape: close the newest visible card. False when there is none. */
  dismissNewest(): boolean;
  /** A different world was loaded: its incident is history. */
  reset(): void;
}

type FireLine = 'start' | 'spread' | 'end' | 'helicopter';

/** Which part of a fire a log line is, by the sim's wording in src/sim/events.ts. */
export function fireLineOf(entry: LogEntry): FireLine | null {
  if (entry.level !== 'alert') return null;
  const text = entry.text;
  if (text.startsWith('Fire broke out in the ')) return 'start';
  if (text.startsWith('The fire spread to the ')) return 'spread';
  if (text.startsWith('Security put the fire out.') || text.startsWith('The helicopter soaked the fire.')) return 'end';
  if (text.startsWith('A firefighting helicopter cost ')) return 'helicopter';
  return null;
}

function placeName(floor: number): string {
  return floor < 0 ? `basement ${Math.abs(floor)}` : `floor ${floor}`;
}

/** "Fire on floor 12", "Fire on floor 12, 2 rooms burning", "Fire on floors 12 to 14, 3 rooms burning". */
export function fireHeadline(floors: readonly number[], rooms: number): string {
  let where: string;
  if (floors.length === 0) where = 'Fire in the tower';
  else {
    const min = Math.min(...floors);
    const max = Math.max(...floors);
    if (min === max) where = `Fire on ${placeName(min)}`;
    else if (min > 0) where = `Fire on floors ${min} to ${max}`;
    else where = `Fire from ${placeName(min)} to ${placeName(max)}`;
  }
  return rooms > 1 ? `${where}, ${rooms} rooms burning` : where;
}

/** "Cockroaches on floor 7", "Cockroaches on floor 7, 2 rooms", "Cockroaches on floors 7 to 9, 3 rooms". */
export function roachHeadline(floors: readonly number[], rooms: number): string {
  return fireHeadline(floors, 1).replace(/^Fire/, 'Cockroaches') + (rooms > 1 ? `, ${rooms} rooms` : '');
}

export const ROACHES_GONE = 'The cockroaches are gone';

type TheftLine = 'start' | 'end';

/**
 * Which part of a theft a log line is, by the sim's wording in src/sim/events.ts, and the card's
 * headline for it: the line up to its first full stop ("Theft on floor 7, a guard is on the way",
 * "Thief caught on floor 7", "Thief escaped, $2,000 lost").
 */
export function theftLineOf(entry: LogEntry): { kind: TheftLine; headline: string } | null {
  if (entry.level !== 'alert') return null;
  const text = entry.text;
  const headline = text.replace(/\.(\s.*)?$/, '');
  if (text.startsWith('Theft on floor ')) return { kind: 'start', headline };
  if (text.startsWith('Thief caught on ') || text.startsWith('Thief escaped, ')) return { kind: 'end', headline };
  return null;
}

/** A theft under way, for a card opened on a loaded save. Never shown for anything else. */
export function theftHeadline(floor: number, guardComing: boolean): string {
  const where = floor < 0 ? `floor B${-floor}` : `floor ${floor}`;
  return guardComing ? `Theft on ${where}, a guard is on the way` : `Theft on ${where}, no guard can reach it`;
}
export const BOMB_OVER = 'The bomb threat is over.';

type BombLine = 'start' | 'end';

/** Which part of a bomb threat a log line is, by the sim's wording in src/sim/events.ts. */
export function bombLineOf(entry: LogEntry): BombLine | null {
  if (entry.level !== 'alert') return null;
  const text = entry.text;
  if (text.startsWith('A caller planted a bomb in the ')) return 'start';
  if (text.startsWith('The bomb went off on floor ') || text.startsWith('Security found the bomb')) return 'end';
  if (text.startsWith('You paid the ') && text.includes(' ransom and the bomb')) return 'end';
  return null;
}

/** A cockroach line: they moved into a room, or spread to one. */
export function isRoachLine(entry: LogEntry): boolean {
  if (entry.level !== 'alert') return false;
  return entry.text.startsWith('Cockroaches moved into the ') || entry.text.startsWith('The cockroaches spread to the ');
}

export function fireOutText(damaged: number): string {
  return `Fire out, ${damaged} room${damaged === 1 ? '' : 's'} damaged`;
}

interface Card {
  node: HTMLElement;
  gone: boolean;
}

interface FireIncident {
  /** Derived id: the minute and room of the line (or event) that started it. */
  key: string;
  rooms: Set<Id>;
  floors: Set<number>;
  /** From the closing log line, when there was one. */
  damaged: number | null;
  closed: boolean;
  /** Null once the player dismissed it; the incident goes on without a card. */
  card: Card | null;
  body: HTMLElement | null;
  shown: string;
}

export function createAlertStack(deps: AlertStackDeps): AlertStack {
  const { host } = deps;
  const cards: Card[] = [];
  const more = el('p', 'hs-toast-more');
  let incident: FireIncident | null = null;
  /** The bomb threat's card: the ransom line and its button, then the outcome. */
  let bomb: { card: Card | null; body: HTMLElement | null; closed: boolean } | null = null;
  /** The theft's card: the response, then the outcome. */
  let theft: { card: Card | null; body: HTMLElement | null; closed: boolean } | null = null;
  /** The infestation's card, drawn from the infested rooms in the world. */
  let roaches: { card: Card | null; body: HTMLElement | null; closed: boolean; shown: string } | null = null;

  function layout(): void {
    for (let i = cards.length - 1; i >= 0; i -= 1) if (cards[i]?.gone) cards.splice(i, 1);
    const hidden = Math.max(0, cards.length - ALERT_STACK_MAX);
    cards.forEach((card, i) => card.node.classList.toggle('is-collapsed', i < hidden));
    if (hidden > 0) {
      more.textContent = `and ${hidden} more`;
      if (more.parentNode !== host) host.prepend(more);
    } else more.remove();
  }

  function close(card: Card): void {
    if (card.gone) return;
    card.gone = true;
    card.node.remove();
    for (const held of [incident, bomb, roaches, theft]) {
      if (held?.card === card) {
        held.card = null;
        held.body = null;
      }
    }
    layout();
  }

  /** A card with its close control; `body` is where the content goes. */
  function open(className: string): { card: Card; body: HTMLElement } {
    const node = el('div', className);
    const body = el('div', 'hs-toast-body');
    const card: Card = { node, gone: false };
    const shut = button('×', 'hs-toast-close', () => close(card));
    shut.setAttribute('aria-label', 'Dismiss this alert');
    shut.title = 'Dismiss (Escape)';
    node.append(shut, body);
    host.append(node);
    cards.push(card);
    layout();
    return { card, body };
  }

  // ---------------------------------------------------------------- fire

  function securityOnDuty(world: World): boolean {
    for (const room of world.rooms.values()) if (room.kind === 'security' && !room.onFire) return true;
    return false;
  }

  function addRoom(fire: FireIncident, roomId: Id | undefined, text: string): void {
    if (roomId !== undefined) fire.rooms.add(roomId);
    const room = roomId !== undefined ? deps.getWorld().rooms.get(roomId) : undefined;
    if (room) {
      for (let f = room.floor; f < room.floor + room.height; f += 1) fire.floors.add(f);
      return;
    }
    const match = /on floor (-?\d+)\.?$/.exec(text.replace(/\. Call a helicopter.*$/, '.'));
    if (match?.[1] !== undefined) fire.floors.add(Number(match[1]));
  }

  function startIncident(key: string): FireIncident {
    if (incident && !incident.closed) closeIncident(incident);
    const { card, body } = open('hs-toast is-fire');
    incident = { key, rooms: new Set(), floors: new Set(), damaged: null, closed: false, card, body, shown: '' };
    return incident;
  }

  function closeIncident(fire: FireIncident): void {
    fire.closed = true;
    render(fire);
    const card = fire.card;
    if (card) deps.later(() => close(card), FIRE_OUT_LINGER_MS);
  }

  function render(fire: FireIncident): void {
    const body = fire.body;
    if (!body) return;
    const world = deps.getWorld();
    const cost = EVENTS.fire.helicopterCost;
    const security = securityOnDuty(world);
    const affordable = world.cash >= cost;
    const headline = fire.closed ? fireOutText(fire.damaged ?? fire.rooms.size) : fireHeadline([...fire.floors], fire.rooms.size);
    const key = `${headline}|${fire.closed}|${security}|${affordable}`;
    if (key === fire.shown) return;
    fire.shown = key;
    const parts: HTMLElement[] = [el('p', 'hs-toast-text', headline)];
    if (!fire.closed) {
      if (security) parts.push(el('p', 'hs-toast-note', SECURITY_RESPONDING));
      // The sim lets the player call the helicopter with or without security on duty.
      const call = button(`Call a helicopter (${formatMoney(cost)})`, 'hs-btn', () => {
        deps.apply({ kind: 'fire.callHelicopter' });
      });
      call.dataset['command'] = 'fire.callHelicopter';
      const row = el('div', 'hs-actions');
      row.append(call);
      parts.push(row);
      if (!affordable) {
        call.disabled = true;
        parts.push(el('p', 'hs-toast-note', `Not enough cash. A firefighting helicopter costs ${formatMoney(cost)}.`));
      }
      if (!security) parts.push(el('p', 'hs-toast-note', SECURITY_LESSON));
    }
    body.replaceChildren(...parts);
  }

  function onFireLine(kind: FireLine, entry: LogEntry): void {
    if (kind === 'start') {
      addRoom(startIncident(`${entry.minute}:${entry.roomId ?? ''}`), entry.roomId, entry.text);
      return;
    }
    if (kind === 'spread') {
      const fire = incident && !incident.closed ? incident : startIncident(`${entry.minute}:${entry.roomId ?? ''}`);
      addRoom(fire, entry.roomId, entry.text);
      return;
    }
    if (kind === 'end' && incident && !incident.closed) {
      const count = /(\d+) rooms? burned down/.exec(entry.text)?.[1];
      if (count !== undefined) incident.damaged = Number(count);
      closeIncident(incident);
    }
    // The helicopter's own line is part of the closing; the log keeps it.
  }

  function sync(): void {
    const world = deps.getWorld();
    const event = (world.events ?? []).find((e) => e.kind === 'fire');
    if (event && event.kind === 'fire') {
      // A fire with no card yet (a save loaded mid fire): its first room names the incident.
      if (!incident || incident.closed) startIncident(`${event.startedAt}:${event.roomIds[0] ?? ''}`);
      const fire = incident as FireIncident;
      for (const id of event.roomIds) if (!fire.rooms.has(id)) addRoom(fire, id, '');
    } else if (incident && !incident.closed) {
      closeIncident(incident);
    }
    if (incident) render(incident);
    syncBomb(world);
    syncTheft(world);
    syncRoaches(world, roachHeard);
    roachHeard = false;
  }

  // ---------------------------------------------------------------- other alerts

  // ---------------------------------------------------------------- bomb

  function startBomb(text: string): void {
    if (bomb && !bomb.closed) endBomb(null);
    const { card, body } = open('hs-toast is-bomb');
    bomb = { card, body, closed: false };
    const pay = button('Pay ransom', 'hs-btn', () => {
      deps.apply({ kind: 'bomb.pay' });
    });
    pay.dataset['command'] = 'bomb.pay';
    const row = el('div', 'hs-actions');
    row.append(pay);
    body.append(el('p', 'hs-toast-text', text), row);
  }

  /** The threat ended: the button goes, the outcome shows, and the card leaves after a while. */
  function endBomb(outcome: string | null): void {
    if (!bomb || bomb.closed) return;
    bomb.closed = true;
    bomb.body?.replaceChildren(el('p', 'hs-toast-text', outcome ?? BOMB_OVER));
    const card = bomb.card;
    if (card) deps.later(() => close(card), ALERT_LINGER_MS);
  }

  function syncBomb(world: World): void {
    const live = (world.events ?? []).some((e) => e.kind === 'bomb' && !e.found);
    // A save loaded mid threat still gets its card and its button.
    if (live && (!bomb || bomb.closed)) startBomb('A bomb is hidden in the tower. Pay the ransom or let security search the tower.');
    else if (!live && bomb && !bomb.closed) endBomb(null);
  }

  // ---------------------------------------------------------------- theft

  function startTheftCard(headline: string): void {
    if (theft && !theft.closed) endTheftCard(null);
    const { card, body } = open('hs-toast is-theft');
    theft = { card, body, closed: false };
    body.append(el('p', 'hs-toast-text', headline));
  }

  function endTheftCard(outcome: string | null): void {
    if (!theft || theft.closed) return;
    theft.closed = true;
    if (outcome) theft.body?.replaceChildren(el('p', 'hs-toast-text', outcome));
    const card = theft.card;
    if (card) deps.later(() => close(card), ALERT_LINGER_MS);
  }

  function syncTheft(world: World): void {
    // Only a theft that has begun (the thief at the target) is news; before that it is a visitor.
    const live = (world.events ?? []).find((e) => e.kind === 'theft' && (e.phase === 'acting' || e.phase === 'leaving'));
    if (live && live.kind === 'theft' && (!theft || theft.closed)) {
      startTheftCard(theftHeadline(live.floor ?? 1, live.guardId !== null));
    } else if (!live && theft && !theft.closed) endTheftCard(null);
  }

  // ---------------------------------------------------------------- cockroaches

  function syncRoaches(world: World, heard: boolean): void {
    const floors: number[] = [];
    let count = 0;
    for (const room of world.rooms?.values() ?? []) {
      if (!room.infested) continue;
      count += 1;
      for (let f = room.floor; f < room.floor + room.height; f += 1) floors.push(f);
    }
    if (count > 0 && (!roaches || roaches.closed)) {
      // A new infestation opens a card; one already on screen when a save loads is not news.
      if (!heard) return;
      const { card, body } = open('hs-toast is-roaches');
      roaches = { card, body, closed: false, shown: '' };
    }
    if (!roaches) return;
    if (count === 0 && !roaches.closed) {
      roaches.closed = true;
      const card = roaches.card;
      if (card) deps.later(() => close(card), ALERT_LINGER_MS);
    }
    const headline = roaches.closed ? ROACHES_GONE : roachHeadline(floors, count);
    if (headline === roaches.shown || !roaches.body) return;
    roaches.shown = headline;
    roaches.body.replaceChildren(el('p', 'hs-toast-text', headline));
  }

  // ---------------------------------------------------------------- other alerts

  let roachHeard = false;

  function onAlert(entry: LogEntry): void {
    const fireLine = fireLineOf(entry);
    if (fireLine) {
      onFireLine(fireLine, entry);
      return;
    }
    const bombLine = bombLineOf(entry);
    if (bombLine === 'start') {
      startBomb(entry.text);
      return;
    }
    if (bombLine === 'end') {
      endBomb(entry.text);
      return;
    }
    if (isRoachLine(entry)) {
      roachHeard = true;
      return;
    }
    const theftLine = theftLineOf(entry);
    if (theftLine?.kind === 'start') {
      startTheftCard(theftLine.headline);
      return;
    }
    if (theftLine?.kind === 'end') {
      endTheftCard(theftLine.headline);
      return;
    }
    const { card, body } = open('hs-toast');
    body.append(el('p', 'hs-toast-text', entry.text));
    deps.later(() => close(card), ALERT_LINGER_MS);
  }

  function notice(text: string): void {
    const { card, body } = open('hs-toast is-notice');
    body.append(el('p', 'hs-toast-text', text));
    deps.later(() => close(card), NOTICE_LINGER_MS);
  }

  function dismissNewest(): boolean {
    const card = cards.filter((c) => !c.gone).at(-1);
    if (!card) return false;
    close(card);
    return true;
  }

  function reset(): void {
    for (const card of [...cards]) close(card);
    incident = null;
    bomb = null;
    theft = null;
    roaches = null;
    roachHeard = false;
  }

  return { onAlert, notice, sync, dismissNewest, reset };
}
