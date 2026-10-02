// The alert stack: the cards that answer alert lines in the world log, and the short notices a
// refused command leaves. A fire is one incident with one card that updates in place, however
// many rooms catch, and that card always carries the player's response. Every card closes, and
// the stack shows at most three cards with the rest folded into one "and N more" line. A bomb
// threat is one card that trades its ransom button for the outcome; an infestation is one card too.
// A theft is one card that says whether a guard is on the way, then how it ended. A tower the
// bank took is one card, read from world.gameOver, with the ways on and no close control: it
// stands, first in the stack, for as long as the game is over.
//
// The sim logs one line per burning room and has no incident id, so the incident is derived here
// from the log lines (their text and roomId) and from the fire event in world.events.
//
// Stories (Matt, 2026-10-01): the "and N more" line is a button that opens Stories, and a live
// fire or bomb whose card is out of sight (closed, or folded under newer cards) leaves a small
// reminder chip that opens Stories at it. The card itself never comes back. The helicopter and
// ransom controls are built here once (helicopterControl, ransomControl) for the cards and for
// the rows in Stories, so both follow one rule.

import { FIRE_BURN_OUT_TEXT, FIRE_OUT_EMPTY_TEXT, helicopterCost } from '../sim/events';
import { EVENTS } from '../sim/rules';
import type { Command, CommandResult, Id, LogEntry, World } from '../sim/types';
import { formatMoney } from './format';
import type { IconName } from './icons';
import { button, el } from './panels';
import { SAVED_NOTICE } from './save-button';
import type { StoriesTarget } from './stories';
import { toastIcon } from './toast';

/** Cards shown at once; older ones fold into the "and N more" line. */
export const ALERT_STACK_MAX = 3;
/** Real milliseconds a resolved incident's card (a bomb or a theft outcome) stays up. */
export const ALERT_LINGER_MS = 8000;
/** Real milliseconds the "Fire out" closing state stays up. */
export const FIRE_OUT_LINGER_MS = 8000;
/** Real milliseconds a notice stays up. */
export const NOTICE_LINGER_MS = 6000;

/**
 * The fire's line while a security office is on duty. No guard walks to a fire: the office puts
 * it out on a fixed timer (src/sim/events.ts tickFire, securityPutOutMinutes), so the line says that.
 */
export const SECURITY_RESPONDING = 'Security is putting it out.';
export const SECURITY_LESSON = 'A security office puts fires out on its own.';
/**
 * The bomb card's line while the tower has a security office on duty. True at any height the
 * tower allows: the search (src/sim/events.ts tickBomb) starts at 6 AM, the hour the threat is
 * rolled, and takes securitySearchMinutesPerFloor per built floor, at most 110 floors, so 11:30
 * AM at the latest; a security office built later finds it on the next minute.
 */
export const SECURITY_SEARCHING = 'Your security office is searching and will find it before 1 PM.';

export interface AlertStackDeps {
  /** The container the cards go in (the ui's toasts region). */
  host: HTMLElement;
  getWorld(): World;
  apply(cmd: Command): CommandResult;
  /** Run `fn` after `ms` real milliseconds; the ui owns the timers so destroy clears them. */
  later(fn: () => void, ms: number): void;
  /** The ways on from a tower the bank took, as the menu offers them. None when omitted. */
  gameOverActions?(): readonly GameOverAction[];
  /** Open Stories at a section or incident: the "and N more" line and the reminder chips. */
  openStories?(target: StoriesTarget): void;
}

/** Is a security office on duty? One on fire is not, as the sim counts it. */
export function securityOnDuty(world: World): boolean {
  for (const room of world.rooms?.values() ?? []) if (room.kind === 'security' && !room.onFire) return true;
  return false;
}

/**
 * A response that spends money (the helicopter, the ransom): its button, then the refusal line,
 * empty and hidden while the cash covers it. Built once and kept current by sync, so a button with
 * focus stays the same button. The button carries data-command and data-spend: nothing ever puts
 * first focus on it, and it acts on one deliberate press.
 */
export interface SpendControl {
  /** The row with the button, then the refusal line, in the order they go in. */
  nodes: HTMLElement[];
  button: HTMLButtonElement;
  /** Bring the price, the disabled state and the reason in line with the world. */
  sync(world: World): void;
}

function spendControl(
  label: string,
  command: Command,
  apply: (cmd: Command) => unknown,
  rule: (world: World) => { label: string; refusal: string | null; secondary: boolean },
): SpendControl {
  const call = button(label, 'hs-btn', () => {
    apply(command);
  });
  call.dataset['command'] = command.kind;
  call.dataset['spend'] = 'true';
  const row = el('div', 'hs-actions');
  row.append(call);
  const note = el('p', 'hs-toast-note');
  note.hidden = true;
  return {
    nodes: [row, note],
    button: call,
    sync(world) {
      const now = rule(world);
      if (call.textContent !== now.label) call.textContent = now.label;
      const short = now.refusal !== null;
      if (call.disabled !== short) call.disabled = short;
      if (call.classList.contains('is-secondary') !== now.secondary) call.classList.toggle('is-secondary', now.secondary);
      const words = now.refusal ?? '';
      if (note.textContent !== words) note.textContent = words;
      if (note.hidden !== !short) note.hidden = !short;
    },
  };
}

/** What a helicopter costs now: the flight and the clearing bill for every room burning, as the sim takes it. */
export function helicopterPrice(world: World): number {
  const event = (world.events ?? []).find((e) => e.kind === 'fire');
  return event && event.kind === 'fire' ? helicopterCost(world, event) : EVENTS.fire.helicopterCost;
}

/** The ransom asked now, from the threat itself. */
export function ransomPrice(world: World): number {
  const event = (world.events ?? []).find((e) => e.kind === 'bomb');
  return event && event.kind === 'bomb' ? event.ransom : EVENTS.bomb.ransom;
}

/** Call a helicopter, with its live price; off with the reason while the cash is short. The sim allows it with or without security. */
export function helicopterControl(apply: (cmd: Command) => unknown): SpendControl {
  return spendControl('Call a helicopter', { kind: 'fire.callHelicopter' }, apply, (world) => {
    const cost = helicopterPrice(world);
    return {
      label: `Call a helicopter (${formatMoney(cost)})`,
      refusal: world.cash >= cost ? null : `Not enough cash. A firefighting helicopter costs ${formatMoney(cost)}.`,
      secondary: false,
    };
  });
}

/** Pay ransom, with the amount; off with the reason while the cash is short, and secondary while security searches. */
export function ransomControl(apply: (cmd: Command) => unknown): SpendControl {
  return spendControl('Pay ransom', { kind: 'bomb.pay' }, apply, (world) => {
    const ransom = ransomPrice(world);
    return {
      label: `Pay ransom (${formatMoney(ransom)})`,
      refusal: world.cash >= ransom ? null : `Not enough cash. The ransom is ${formatMoney(ransom)}.`,
      secondary: securityOnDuty(world),
    };
  });
}

/** The reminder chip's words for a live incident: where it is, in a few words. */
export function bombReminder(world: World): string {
  const event = (world.events ?? []).find((e) => e.kind === 'bomb' && !e.found);
  if (!event || event.kind !== 'bomb') return 'Bomb threat';
  const floor = world.rooms?.get(event.roomId)?.floor ?? event.floor;
  return floor === undefined ? 'Bomb threat' : `Bomb threat on ${placeName(floor)}`;
}

/** One button on the game over card: a new tower, back to My tower, or open a saved file. */
export interface GameOverAction {
  kind: 'newTower' | 'myTower' | 'openFile';
  run(): void;
}

export const GAME_OVER_LABELS: Record<GameOverAction['kind'], string> = {
  newTower: 'New tower',
  myTower: 'My tower',
  openFile: 'Open a saved file',
};

/** The game over card's words under the reason, by the ways on it offers. */
export function gameOverBody(newTower: boolean): string {
  return newTower
    ? 'You ran out of money. Start a new tower, or open a saved file.'
    : 'You ran out of money. Go back to My tower, or open a saved file.';
}

export interface AlertStack {
  /** A fresh alert line from the log. Fire lines feed the incident card instead of a card each. */
  onAlert(entry: LogEntry): void;
  /**
   * A short notice, such as a refusal reason. With `replace`, a notice with the same words still
   * on screen closes first, so a repeat shows fresh rather than stacking beside it.
   */
  notice(text: string, options?: { replace?: boolean }): void;
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
  if (
    text.startsWith('Security put the fire out.') ||
    text.startsWith('The helicopter soaked the fire.') ||
    text.startsWith('The fire burned itself out.') ||
    text === FIRE_OUT_EMPTY_TEXT
  ) {
    return 'end';
  }
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

/**
 * The fire card's closing line: the rooms lost and what the fire cost in all, the helicopter
 * included when one was called. "Fire out. 5 rooms lost, $100,000." The amount is left off
 * when the card did not hear it (a save loaded as the fire ended) and when nothing was paid.
 */
export function fireOutText(lost: number, cost: number | null): string {
  const rooms = lost === 0 ? 'No rooms lost' : `${lost} room${lost === 1 ? '' : 's'} lost`;
  return cost === null || cost === 0 ? `Fire out. ${rooms}.` : `Fire out. ${rooms}, ${formatMoney(cost)}.`;
}

/** The dollar amount in a sim money line ("... cost $250,000 and ..."), or null. */
export function moneyIn(text: string): number | null {
  const match = /cost \$([\d,]+)/.exec(text);
  return match?.[1] === undefined ? null : Number(match[1].replace(/,/g, ''));
}

interface Card {
  node: HTMLElement;
  gone: boolean;
  /** A notice's words, for a repeat that replaces it. */
  notice?: string;
}

interface FireIncident {
  /** Derived id: the minute and room of the line (or event) that started it. */
  key: string;
  rooms: Set<Id>;
  floors: Set<number>;
  /** From the closing log line, when there was one. */
  damaged: number | null;
  /** What the fire cost: the clearing bill from the closing line plus the helicopter's flight. */
  cost: number | null;
  closed: boolean;
  /** Null once the player dismissed it; the incident goes on without a card. */
  card: Card | null;
  body: HTMLElement | null;
  shown: string;
}

export function createAlertStack(deps: AlertStackDeps): AlertStack {
  const { host } = deps;
  const cards: Card[] = [];
  // The folded cards' line: a tap opens Stories, where everything they said is kept.
  const more = button('', 'hs-toast-more', () => deps.openStories?.('needs'));
  more.title = 'Open Stories';
  /** The reminder chips, fire then bomb: shown while the incident is live and its card is out of sight. */
  const chips = new Map<'fire' | 'bomb', { node: HTMLButtonElement; words: HTMLElement }>();
  let incident: FireIncident | null = null;
  /**
   * The bomb threat's card: the ransom line and its button (off while cash is short), then the
   * outcome. With a security office on duty the card says it will find the bomb, and the ransom
   * steps back to a secondary action.
   */
  let bomb: {
    card: Card | null;
    body: HTMLElement | null;
    closed: boolean;
    pay: SpendControl;
    searching: HTMLElement;
  } | null = null;
  /** The theft's card: the response, then the outcome. */
  let theft: { card: Card | null; body: HTMLElement | null; closed: boolean } | null = null;
  /** The infestation's card, drawn from the infested rooms in the world. */
  let roaches: { card: Card | null; body: HTMLElement | null; closed: boolean; shown: string } | null = null;
  /** The game over card. Kept out of `cards`: nothing closes it, folds it or lets it linger. */
  let ending: { node: HTMLElement; key: string } | null = null;

  function layout(): void {
    for (let i = cards.length - 1; i >= 0; i -= 1) if (cards[i]?.gone) cards.splice(i, 1);
    const hidden = Math.max(0, cards.length - ALERT_STACK_MAX);
    cards.forEach((card, i) => card.node.classList.toggle('is-collapsed', i < hidden));
    if (hidden > 0) {
      more.textContent = `and ${hidden} more`;
      more.setAttribute('aria-label', `and ${hidden} more. Open Stories`);
      if (more.parentNode !== host) host.prepend(more);
    } else more.remove();
    syncChips();
    // The game over card stays first, above the fold line.
    if (ending && host.firstElementChild !== ending.node) host.prepend(ending.node);
  }

  /** On screen and not folded: the player can see it and its button. */
  function inSight(card: Card | null | undefined): boolean {
    return !!card && !card.gone && !card.node.classList.contains('is-collapsed');
  }

  /**
   * A live fire or bomb with no card in sight (closed, or folded under newer ones) keeps a chip:
   * the red icon and a few words, and a tap opens Stories at it. It goes when the incident ends;
   * the card is never made again. The chips sit over the fold line, under the game over card.
   */
  function syncChips(): void {
    const world = deps.getWorld();
    const events = world.events ?? [];
    const fireEvent = events.find((e) => e.kind === 'fire');
    const fireWords =
      fireEvent && fireEvent.kind === 'fire' && !inSight(incident && !incident.closed ? incident.card : null)
        ? fireHeadline(
            fireEvent.roomIds.flatMap((id) => {
              const room = world.rooms?.get(id);
              return room ? [room.floor] : [];
            }),
            1,
          )
        : null;
    const bombLive = events.some((e) => e.kind === 'bomb' && !e.found);
    const bombWords = bombLive && !inSight(bomb && !bomb.closed ? bomb.card : null) ? bombReminder(world) : null;
    let moved = false;
    for (const [kind, words, glyph] of [
      ['fire', fireWords, 'fire'],
      ['bomb', bombWords, 'alert'],
    ] as const) {
      const held = chips.get(kind);
      if (words === null) {
        if (held) {
          held.node.remove();
          chips.delete(kind);
        }
        continue;
      }
      if (!held) {
        const node = button('', 'hs-toast-chip', () => deps.openStories?.(kind));
        node.dataset['incident'] = kind;
        node.title = 'Open Stories';
        const text = el('span', 'hs-toast-chip-words', words);
        node.append(toastIcon(glyph, 'alert'), text);
        node.setAttribute('aria-label', `${words}. Open Stories`);
        chips.set(kind, { node, words: text });
        moved = true;
      } else if (held.words.textContent !== words) {
        held.words.textContent = words;
        held.node.setAttribute('aria-label', `${words}. Open Stories`);
      }
    }
    // Over the cards and under the fold line: put back in order only when out of it.
    const shownChips = (['fire', 'bomb'] as const).flatMap((kind) => {
      const held = chips.get(kind);
      return held ? [held.node] : [];
    });
    const head = [...(more.parentNode === host ? [more] : []), ...shownChips];
    const firsts = Array.from(host.children).filter((n) => n !== ending?.node);
    if (moved || head.some((node, i) => firsts[i] !== node)) host.prepend(...head);
    if (ending && host.firstElementChild !== ending.node) host.prepend(ending.node);
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

  /**
   * A card with its icon (red for trouble, amber for a notice) and its close control; `body` is
   * where the content goes.
   */
  function open(className: string, glyph: IconName, tone: 'amber' | 'alert' = 'alert'): { card: Card; body: HTMLElement } {
    const node = el('div', className);
    const body = el('div', 'hs-toast-body');
    const card: Card = { node, gone: false };
    const shut = button('×', 'hs-toast-close', () => close(card));
    shut.setAttribute('aria-label', 'Close this alert');
    shut.title = 'Dismiss (Escape)';
    node.append(toastIcon(glyph, tone), shut, body);
    host.append(node);
    cards.push(card);
    layout();
    return { card, body };
  }

  // ---------------------------------------------------------------- fire

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
    const { card, body } = open('hs-toast is-fire', 'fire');
    incident = { key, rooms: new Set(), floors: new Set(), damaged: null, cost: null, closed: false, card, body, shown: '' };
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
    // The full charge, flight and clearing bill for every room burning, as the sim will take it.
    const cost = helicopterPrice(world);
    const security = securityOnDuty(world);
    const affordable = world.cash >= cost;
    const headline = fire.closed ? fireOutText(fire.damaged ?? fire.rooms.size, fire.cost) : fireHeadline([...fire.floors], fire.rooms.size);
    const key = `${headline}|${fire.closed}|${security}|${affordable}|${cost}`;
    if (key === fire.shown) return;
    fire.shown = key;
    const parts: HTMLElement[] = [el('p', 'hs-toast-text', headline)];
    if (!fire.closed) {
      if (security) parts.push(el('p', 'hs-toast-note', SECURITY_RESPONDING));
      // The sim lets the player call the helicopter with or without security on duty.
      const call = helicopterControl(deps.apply);
      call.sync(world);
      parts.push(...call.nodes.filter((node) => !node.hidden));
      if (!security) parts.push(el('p', 'hs-toast-note', FIRE_BURN_OUT_TEXT), el('p', 'hs-toast-note', SECURITY_LESSON));
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
    if (kind === 'helicopter' && incident && !incident.closed) {
      // The flight's line comes just before the closing line; the card adds the two.
      const flight = moneyIn(entry.text);
      if (flight !== null) incident.cost = (incident.cost ?? 0) + flight;
      return;
    }
    if (kind === 'end' && incident && !incident.closed) {
      // "The fire is out." names no rooms: the fire ended with nothing left to burn.
      if (entry.text === FIRE_OUT_EMPTY_TEXT) incident.damaged = 0;
      const count = /(\d+) rooms? burned down/.exec(entry.text)?.[1];
      if (count !== undefined) incident.damaged = Number(count);
      const clearing = moneyIn(entry.text);
      if (clearing !== null) incident.cost = (incident.cost ?? 0) + clearing;
      closeIncident(incident);
    }
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
    syncGameOver(world);
    syncChips();
  }

  // ---------------------------------------------------------------- game over

  /** The bank took the tower: the reason, what that means, and the ways on, until a new world. */
  function syncGameOver(world: World): void {
    const over = world.gameOver ?? null;
    if (!over) {
      ending?.node.remove();
      ending = null;
      return;
    }
    const actions = deps.gameOverActions?.() ?? [];
    const key = `${over.at}|${over.reason}|${actions.map((a) => a.kind).join('|')}`;
    if (ending?.key === key) {
      if (ending.node.parentNode !== host) host.prepend(ending.node);
      return;
    }
    ending?.node.remove();
    const node = el('div', 'hs-toast is-over');
    const body = el('div', 'hs-toast-body');
    const newTower = !actions.some((a) => a.kind === 'myTower');
    body.append(el('p', 'hs-toast-text', over.reason), el('p', 'hs-toast-note', gameOverBody(newTower)));
    if (actions.length > 0) {
      const row = el('div', 'hs-actions');
      for (const action of actions) row.append(button(GAME_OVER_LABELS[action.kind], 'hs-btn', () => action.run()));
      body.append(row);
    }
    // The bank took it: the money icon, in the alert red.
    node.append(toastIcon('finance', 'alert'), body);
    host.prepend(node);
    ending = { node, key };
  }

  // ---------------------------------------------------------------- other alerts

  // ---------------------------------------------------------------- bomb

  function startBomb(text: string): void {
    if (bomb && !bomb.closed) endBomb(null);
    const { card, body } = open('hs-toast is-bomb', 'alert');
    const pay = ransomControl(deps.apply);
    const searching = el('p', 'hs-toast-note');
    searching.hidden = true;
    body.append(el('p', 'hs-toast-text', text), searching, ...pay.nodes);
    bomb = { card, body, closed: false, pay, searching };
    renderRansom(deps.getWorld());
  }

  /** Like the helicopter: Pay ransom is off, with the reason, while the tower cannot afford it. */
  function renderRansom(world: World): void {
    if (!bomb || bomb.closed) return;
    bomb.pay.sync(world);
    const security = securityOnDuty(world);
    const searchLine = security ? SECURITY_SEARCHING : '';
    if (bomb.searching.textContent !== searchLine) bomb.searching.textContent = searchLine;
    if (bomb.searching.hidden !== !security) bomb.searching.hidden = !security;
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
    renderRansom(world);
  }

  // ---------------------------------------------------------------- theft

  function startTheftCard(headline: string): void {
    if (theft && !theft.closed) endTheftCard(null);
    const { card, body } = open('hs-toast is-theft', 'alert');
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
      const { card, body } = open('hs-toast is-roaches', 'alert');
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
    // The game over card speaks for the tower from the minute the game ended.
    const over = deps.getWorld().gameOver ?? null;
    if (over && entry.minute >= over.at) return;
    // Any other alert line stays until the player closes it.
    const { body } = open('hs-toast', 'alert');
    body.append(el('p', 'hs-toast-text', entry.text));
  }

  function notice(text: string, options: { replace?: boolean } = {}): void {
    if (options.replace) for (const held of [...cards]) if (!held.gone && held.notice === text) close(held);
    const { card, body } = open('hs-toast is-notice', text === SAVED_NOTICE ? 'save' : 'info', 'amber');
    card.notice = text;
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
    ending?.node.remove();
    ending = null;
    for (const chip of chips.values()) chip.node.remove();
    chips.clear();
  }

  return { onAlert, notice, sync, dismissNewest, reset };
}
