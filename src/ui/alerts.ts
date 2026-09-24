// The alert stack: the cards that answer alert lines in the world log, and the short notices a
// refused command leaves. A fire is one incident with one card that updates in place, however
// many rooms catch, and that card always carries the player's response. Every card closes, and
// the stack shows at most three cards with the rest folded into one "and N more" line.
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
    if (incident?.card === card) {
      incident.card = null;
      incident.body = null;
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
  }

  // ---------------------------------------------------------------- other alerts

  /** Alerts that need a decision other than a fire's: the bomb ransom. */
  function commandFor(entry: LogEntry): { label: string; cmd: Command } | null {
    const text = entry.text.toLowerCase();
    const hasBomb = deps.getWorld().events.some((event) => event.kind === 'bomb' && !event.found);
    if (hasBomb && (text.includes('bomb') || text.includes('ransom'))) return { label: 'Pay ransom', cmd: { kind: 'bomb.pay' } };
    if (hasBomb) return { label: 'Pay ransom', cmd: { kind: 'bomb.pay' } };
    return null;
  }

  function onAlert(entry: LogEntry): void {
    const fireLine = fireLineOf(entry);
    if (fireLine) {
      onFireLine(fireLine, entry);
      return;
    }
    const { card, body } = open('hs-toast');
    body.append(el('p', 'hs-toast-text', entry.text));
    const command = commandFor(entry);
    if (command) {
      const row = el('div', 'hs-actions');
      row.append(
        button(command.label, 'hs-btn', () => {
          if (deps.apply(command.cmd).ok) close(card);
        }),
      );
      body.append(row);
    } else deps.later(() => close(card), ALERT_LINGER_MS);
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
  }

  return { onAlert, notice, sync, dismissNewest, reset };
}
