// Panel builders. Each one returns a detached element that the shell in ui.ts mounts.
// Panels read the world through GameApi only and never reach into the sim modules.

import { hapticsEnabled, setHapticsEnabled } from './haptics';
import type { Sound } from '../audio/audio';
import type { GameApi } from '../game/api';
import {
  exportImageWithDialog,
  exportSaveWithDialog,
  IMAGE_FILE_NAME,
  importSaveWithDialog,
  savePlatform,
  shareImage,
  shareSave,
} from '../game/storage';
import { drawPortrait, personLookCode, type Ctx2D } from '../render/figure';
import type { Renderer } from '../render/renderer';
import { isVenueKind, venueLine, venueOf } from '../render/venue';
import { canvasToPng, composeListImage, composeShareImage, shareMessage, shareStats, shareText, shareUrl } from '../share/share';
import { applyTheme, readTheme, type Theme } from '../site/theme';
import { officeQuarterRent } from '../sim/economy';
import { ECONOMY, EVAL, LIMITS, RENT, ROOMS, SHAFTS, takesRent, WASTE } from '../sim/rules';
import {
  describeBeat,
  followSim,
  goalLine,
  isFollowed,
  personCard,
  storyName,
  STORY_FOLLOWED_CAP,
  unfollowSim,
  type StoryBeat,
} from '../sim/story';
import { milestoneRecap, NO_STORIES_YET } from '../sim/chronicle';
import { centerSummary, producesWaste, recyclingCenters, wasteDayStart } from '../sim/recycling';
import { coverageText } from '../sim/security';
import { carRangeOf, clockOf, spanTop } from '../sim/types';
import type {
  Car,
  Command,
  CommandResult,
  Id,
  LogEntry,
  Room,
  RoomKind,
  Shaft,
  ShaftKind,
  Sim,
  SimKind,
  World,
} from '../sim/types';
import {
  formatCount,
  formatEval,
  formatFloor,
  formatFloorRange,
  formatMoney,
  formatPercent,
  formatSignedMoney,
  stressBandLabel,
  stressBandOf,
} from './format';
import { type IconName } from './icons';
import { createSheet, type Sheet } from './sheet';
import { vipView, vipViewKey, type VipView } from './vip';
import { chevron, controlsDevice, currentDeviceEnv, fillControlsPage } from './controls';
import { getFlag, PREF_KEYS, setFlag } from './prefs';

/** A panel element may expose a cheap refresh that rewrites live numbers without rebuilding. */
export type PanelElement = HTMLDivElement & { refresh?: () => void; sheet?: Sheet };

export interface PanelContext {
  /** Applies a command, reports the reason when it is refused, and marks the panels dirty. */
  apply(cmd: Command): CommandResult;
  /** Shows a short message to the player. */
  notice(text: string): void;
  /** Closes the panel. */
  close(): void;
  reducedMotion: boolean;
  setReducedMotion(on: boolean): void;
  /** The sound module, when the shell made one; the settings panel shows its switches. */
  sound?: Sound;
  /** Show the intro again, from Help in the settings panel. */
  openIntro?: () => void;
  /** Open the stories panel, from its button beside Save and Export. */
  openStories?: () => void;
  /** Open the last milestone's recap, from the star card and the stories panel. */
  openRecap?: () => void;
  /** Open the tower chronicle, from the stories panel. */
  openChronicle?: () => void;
  /** Open today's tower in its own slot, from the settings panel. */
  openDaily?: () => void;
  /** Go back to My tower, from the settings panel outside it. */
  openMyTower?: () => void;
  /** Put another person or room in the query panel, closing whichever panel asked. */
  select?: (sel: Selection) => void;
  /**
   * A Display switch in Settings changed. The choice is already stored (prefs.ts); this is for
   * the part of the ui that shows it (larger text, the color-blind views) to follow at once.
   */
  setDisplay?: (name: DisplaySwitch, on: boolean) => void;
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** The refusal when the cast of `cap` is full, the number in words up to twelve. */
export function followLimitText(cap: number): string {
  const count = NUMBER_WORDS[cap] ?? String(cap);
  return `You can follow ${count} ${cap === 1 ? 'person' : 'people'} at a time.`;
}

/** The refusal when the cast is full, in the player's words, from the sim's own cap. */
export const FOLLOW_LIMIT_TEXT = followLimitText(STORY_FOLLOWED_CAP);

/** How many names the room panel lists. */
export const OCCUPANTS_SHOWN = 8;
/** How many tower beats the stories panel lists. */
export const STORIES_TOWER_LINES = 12;

/** The long form of the rules, one page away. */
export const HOW_TO_PLAY_HREF = '/how-to-play/';

export type Selection = { roomId?: Id; simId?: Id; shaftId?: Id };

const SIM_KINDS: Record<SimKind, string> = {
  worker: 'Worker',
  resident: 'Resident',
  guest: 'Hotel guest',
  shopper: 'Shopper',
  diner: 'Diner',
  staff: 'Housekeeper',
  visitor: 'Visitor',
  vip: 'VIP guest',
  guard: 'Security guard',
  collector: 'Collection worker',
  thief: 'Visitor', // the card never says thief before the encounter is resolved
};

const SIM_STATES: Record<Sim['state'], string> = {
  inRoom: 'Inside a room',
  walking: 'Walking',
  waiting: 'Waiting for an elevator',
  riding: 'Riding an elevator',
  leaving: 'Leaving the tower',
  gone: 'Gone',
  outside: 'Outside the tower',
};

// ---------------------------------------------------------------- helpers

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

export function row(label: string, value: string): HTMLDivElement {
  const node = el('div', 'hs-row');
  node.append(el('span', 'hs-row-label', label), el('span', 'hs-row-value', value));
  return node;
}

/**
 * One bento tile: a small label and a big value. The label comes first in the markup, so a
 * screen reader says "Cash now, $120,000"; the css puts the number on top. A money value takes
 * the money face (ui.css .hs-money); everything else stays in the ui font.
 */
export function tile(label: string, value: string, options: { wide?: boolean; money?: boolean; text?: boolean } = {}): HTMLDivElement {
  const node = el('div', `hs-tile${options.wide ? ' is-wide' : ''}${options.text ? ' is-text' : ''}`);
  node.append(el('span', 'hs-tile-label', label), el('span', `hs-tile-value${options.money ? ' hs-money' : ''}`, value));
  return node;
}

/** A label and value row whose value is money, in the money face. */
function moneyRow(label: string, value: string): HTMLDivElement {
  const node = row(label, value);
  node.lastElementChild?.classList.add('hs-money');
  return node;
}

function section(title: string): HTMLDivElement {
  const node = el('div', 'hs-section');
  node.append(el('h3', 'hs-section-title', title));
  return node;
}

function flag(label: string, alert = false): HTMLSpanElement {
  return el('span', alert ? 'hs-flag is-alert' : 'hs-flag', label);
}

/**
 * Every panel's frame: one header of section icon, title and Close, then the body.
 *
 * The icon is drawn from the shared symbol sheet (icons.ts) and is decorative: the title
 * beside it is the label. Close stays a word, not a cross, so it needs no explaining.
 */
export function panelShell(title: string, section: IconName, ctx: Pick<PanelContext, 'close'>): { panel: PanelElement; body: HTMLDivElement } {
  // The shared sheet (sheet.ts): a floating card on a wide screen, a bottom sheet on a phone.
  // The owner mounts it with panel.sheet.mount(host) and takes it down with panel.sheet.unmount().
  const sheet = createSheet({ title, icon: section, className: 'hs-panel', onClose: () => ctx.close() });
  const panel = sheet.node as PanelElement;
  panel.sheet = sheet;
  return { panel, body: sheet.body };
}

export function kindLabel(kind: RoomKind | ShaftKind): string {
  if (kind in ROOMS) return ROOMS[kind as RoomKind].label;
  if (kind in SHAFTS) return SHAFTS[kind as ShaftKind].label;
  return kind;
}

/** The blue, yellow and red zones of the original evaluation meter with a marker at the value. */
function evalBar(value: number): { node: HTMLDivElement; set(v: number): void } {
  const node = el('div', 'hs-eval');
  node.setAttribute('role', 'img');
  const poor = el('div', 'hs-eval-zone is-poor');
  const fair = el('div', 'hs-eval-zone is-fair');
  const good = el('div', 'hs-eval-zone is-good');
  const poorEnd = EVAL.leaveThreshold;
  const fairEnd = poorEnd + (1 - poorEnd) / 2;
  poor.style.width = `${poorEnd * 100}%`;
  fair.style.width = `${(fairEnd - poorEnd) * 100}%`;
  good.style.width = `${(1 - fairEnd) * 100}%`;
  const marker = el('div', 'hs-eval-marker');
  node.append(poor, fair, good, marker);
  const set = (v: number): void => {
    const clamped = Math.max(0, Math.min(1, v));
    marker.style.left = `${clamped * 100}%`;
    node.setAttribute('aria-label', `Evaluation ${formatPercent(clamped)}`);
  };
  set(value);
  return { node, set };
}

// ------------------------------------------------------------ query panel

export function createQueryPanel(
  game: GameApi,
  selection: Selection,
  ctx: PanelContext,
): PanelElement {
  const world = game.world;
  const roomId = selection.roomId;
  const simId = selection.simId;
  const shaftId = selection.shaftId;

  if (roomId !== undefined && world.rooms.has(roomId)) return roomPanel(roomId, game, ctx);
  if (shaftId !== undefined && world.shafts.has(shaftId)) return shaftPanel(shaftId, game, ctx);
  if (simId !== undefined && world.sims.has(simId)) return simPanel(simId, game, ctx);

  const { panel, body } = panelShell('Nothing selected', 'query', ctx);
  body.append(el('p', 'hs-note', 'That part of the tower is gone.'));
  return panel;
}

function roomPanel(roomId: Id, game: GameApi, ctx: PanelContext): PanelElement {
  const room = game.world.rooms.get(roomId) as Room;
  const rule = ROOMS[room.kind];
  const { panel, body } = panelShell(rule.label, 'room', ctx);

  const where =
    room.height > 1
      ? formatFloorRange(room.floor, spanTop(room.floor, room.height))
      : formatFloor(room.floor);
  body.append(el('p', 'hs-note', where));
  // A shop or restaurant goes by the brand on its sign, an office by its line of work: the
  // same pure function of seed and room id the renderer draws the sign from (render/venue.ts).
  if (isVenueKind(room.kind)) {
    body.append(el('p', 'hs-note hs-venue', venueLine(room.kind, venueOf(game.world.seed, room.id, room.kind))));
  }

  const evaluation = section('Happiness');
  const bar = evalBar(room.eval);
  const readout = row('Score', formatEval(room.eval));
  evaluation.append(bar.node, readout);
  body.append(evaluation);

  const people = section('People');
  const tenants = row('Tenants', `${formatCount(room.tenants.length)}`);
  const occupancy = row(
    'Inside now',
    rule.capacity > 0
      ? `${formatCount(room.occupancy)} of ${formatCount(rule.capacity)}`
      : formatCount(room.occupancy),
  );
  people.append(tenants, occupancy);
  body.append(people);

  // Occupants: only one person in four is drawn, and a small figure is hard to tap, so the
  // room lists who belongs here or is inside, each one a way into their story. A security
  // office's are its guards, each with where they are (in the office, patrolling floor 7,
  // responding to floor 12, off shift), under the floors their patrol covers.
  // A recycling center's are its collection workers, under what they did today.
  const isSecurity = room.kind === 'security';
  const isRecycling = room.kind === 'recycling';
  const occupants = section(isSecurity ? 'Guards' : isRecycling ? 'Workers' : 'Who is here');
  const coverage = isSecurity ? row('Patrol covers', coverageText(game.world, room)) : null;
  if (coverage) occupants.append(coverage);
  const collection = isRecycling ? collectionRows(game, room) : null;
  if (collection) occupants.append(...collection.nodes);
  const occupantList = el('div', 'hs-occupants');
  occupants.append(occupantList);
  body.append(occupants);
  let occupantKey = '-'; // no list yet: the first refresh always builds one
  let occupantGoals: { id: Id; goal: HTMLSpanElement }[] = [];

  const flags = el('div', 'hs-section');
  body.append(flags);

  // One line of waste for a room that makes it, once the tower has a recycling center.
  const wasteNote = producesWaste(room.kind) ? el('p', 'hs-note hs-waste', '') : null;
  if (wasteNote) body.append(wasteNote);

  let rentValue: HTMLSpanElement | null = null;
  let rentMoney: HTMLSpanElement | null = null;
  let rentMinus: HTMLButtonElement | null = null;
  let rentPlus: HTMLButtonElement | null = null;
  let rentReset: HTMLButtonElement | null = null;
  if (takesRent(room.kind)) {
    // Rent as a stepper pill: minus, the percent, plus. What it comes to in money sits under it.
    const rent = section('Rent');
    rent.classList.add('hs-rent');
    const rentRow = el('div', 'hs-rent-row');
    const stepper = el('div', 'hs-stepper');
    stepper.setAttribute('role', 'group');
    stepper.setAttribute('aria-label', 'Rent');
    rentMinus = button('\u2212', 'hs-stepper-btn', () => {
      const now = game.world.rooms.get(roomId);
      if (!now) return;
      ctx.apply({ kind: 'room.setRent', roomId, rent: now.rent - RENT.step });
    });
    rentMinus.setAttribute('aria-label', 'Lower rent');
    rentValue = el('span', 'hs-stepper-value', `${room.rent}%`);
    rentPlus = button('+', 'hs-stepper-btn', () => {
      const now = game.world.rooms.get(roomId);
      if (!now) return;
      ctx.apply({ kind: 'room.setRent', roomId, rent: now.rent + RENT.step });
    });
    rentPlus.setAttribute('aria-label', 'Raise rent');
    stepper.append(rentMinus, rentValue, rentPlus);
    rentReset = button('Reset', 'hs-btn', () => {
      ctx.apply({ kind: 'room.setRent', roomId, rent: RENT.default });
    });
    rentReset.setAttribute('aria-label', 'Reset rent');
    rentRow.append(stepper, rentReset);
    rentMoney = el('span', 'hs-money', rentMoneyText(room));
    const money = el('p', 'hs-rent-money');
    money.append(rentMoney);
    rent.append(
      rentRow,
      money,
      el(
        'p',
        'hs-note',
        'Lower rent keeps tenants happier next to noise or a slow elevator. Higher rent pays more but makes them less happy.',
      ),
    );
    body.append(rent);
  }

  const refresh = (): void => {
    const room = game.world.rooms.get(roomId);
    if (!room) return;
    bar.set(room.eval);
    setRowValue(readout, formatEval(room.eval));
    setRowValue(tenants, formatCount(room.tenants.length));
    setRowValue(
      occupancy,
      rule.capacity > 0
        ? `${formatCount(room.occupancy)} of ${formatCount(rule.capacity)}`
        : formatCount(room.occupancy),
    );
    // The string is compared first, so a refresh that changes nothing builds nothing.
    const wanted: [string, boolean][] = [];
    if (room.vacant) wanted.push(['Empty', false]);
    if (room.dirty) wanted.push(['Needs cleaning', false]);
    if (room.infested) wanted.push(['Cockroaches', true]);
    if (room.onFire) wanted.push(['On fire', true]);
    const next = wanted.map(([label]) => label).join('|');
    if (flags.dataset['flags'] !== next) {
      flags.dataset['flags'] = next;
      flags.replaceChildren(...wanted.map(([label, alert]) => flag(label, alert)));
    }
    if (coverage) setRowValue(coverage, coverageText(game.world, room));
    if (collection) collection.refresh();
    if (wasteNote) {
      const line = wasteLine(game.world, room);
      wasteNote.hidden = line === null;
      setText(wasteNote, line ?? '');
    }
    const ids = occupantIds(game, room);
    const key = ids.join(',');
    if (key !== occupantKey) {
      occupantKey = key;
      occupantGoals = [];
      if (ids.length === 0) {
        occupantList.replaceChildren(el('p', 'hs-note', 'Nobody here right now.'));
      } else {
        occupantList.replaceChildren(
          ...ids.map((id) => {
            const item = button('', 'hs-occupant', () => ctx.select?.({ simId: id }));
            const goal = el('span', 'hs-occupant-goal');
            item.replaceChildren(el('span', 'hs-occupant-name', storyName(game.world, id)), goal);
            occupantGoals.push({ id, goal });
            return item;
          }),
        );
      }
    }
    for (const { id, goal } of occupantGoals) {
      const sim = game.world.sims.get(id);
      if (sim) setText(goal, goalLine(game.world, sim));
    }
    if (rentValue) setText(rentValue, `${room.rent}%`);
    if (rentMoney) setText(rentMoney, rentMoneyText(room));
    if (rentMinus) rentMinus.disabled = room.rent <= RENT.min;
    if (rentPlus) rentPlus.disabled = room.rent >= RENT.max;
    if (rentReset) rentReset.hidden = room.rent === RENT.default;
  };
  refresh();
  panel.refresh = refresh;
  return panel;
}

function floorWord(floor: number): string {
  return floor < 0 ? `B${-floor}` : String(floor);
}

/** The day a backlog began, in the calendar's words: "weekday 2", "the weekend", "this morning". */
function backlogDayText(now: number, since: number): string {
  if (since >= wasteDayStart(now)) return 'this morning';
  const { dayOfQuarter } = clockOf(since);
  return dayOfQuarter === 2 ? 'the weekend' : `weekday ${dayOfQuarter + 1}`;
}

/**
 * A producing room's waste line, or null while the tower has no recycling center:
 * "Waste: 4 of 9, collected today", "Waste: 7 of 9, piling up since weekday 2",
 * "Waste: 2 of 9, waiting to be picked up".
 */
export function wasteLine(world: World, room: Room): string | null {
  if (!producesWaste(room.kind) || recyclingCenters(world).length === 0) return null;
  const head = `Waste: ${room.waste ?? 0} of ${WASTE.roomCap}`;
  if (room.wasteBacklogSince != null) return `${head}, piling up since ${backlogDayText(world.time.minute, room.wasteBacklogSince)}`;
  if (room.wasteCollectedAt !== undefined && room.wasteCollectedAt >= wasteDayStart(world.time.minute)) return `${head}, collected today`;
  if ((room.waste ?? 0) > 0) return `${head}, waiting to be picked up`;
  return head;
}

/** The recycling center's rows: units collected today, rooms in backlog, floors the workers cannot reach. */
export function collectionLines(world: World, center: Room): [string, string][] {
  const sum = centerSummary(world, center);
  const units = sum.collectedToday === 1 ? '1 unit' : `${formatCount(sum.collectedToday)} units`;
  const floors = sum.unreachableFloors;
  return [
    ['Workers', `${formatCount(sum.workers)} (grows with the tower)`],
    ['Collected today', units],
    ['Rooms piling up', formatCount(sum.backlogRooms)],
    ['Cannot reach', floors.length === 0 ? 'None' : `${floors.length === 1 ? 'Floor' : 'Floors'} ${floors.map(floorWord).join(', ')}`],
  ];
}

function collectionRows(game: GameApi, center: Room): { nodes: HTMLDivElement[]; refresh(): void } {
  const nodes = collectionLines(game.world, center).map(([label, value]) => row(label, value));
  return {
    nodes,
    refresh() {
      const now = game.world.rooms.get(center.id);
      if (!now) return;
      collectionLines(game.world, now).forEach(([, value], i) => setRowValue(nodes[i] as HTMLDivElement, value));
    },
  };
}

/**
 * Rewrite a list of lines only when the words changed, so a refresh that changes nothing
 * builds nothing.
 */
function setLines(list: HTMLElement, lines: readonly string[], tag: 'p' | 'li', className: string): void {
  const key = lines.join('\n');
  if (list.dataset['lines'] === key) return;
  list.dataset['lines'] = key;
  list.replaceChildren(...lines.map((line) => el(tag, className, line)));
}

/**
 * Up to OCCUPANTS_SHOWN people for the room panel: its tenants first, then anyone inside.
 * The tower-wide look for visitors runs only when the tenants leave room on the list and
 * someone is inside who is not a tenant.
 */
function occupantIds(game: GameApi, room: Room): Id[] {
  const sims = game.world.sims;
  const out: Id[] = [];
  let tenantsInside = 0;
  for (const id of room.tenants) {
    const sim = sims.get(id);
    if (!sim) continue;
    if (sim.inRoomId === room.id) tenantsInside += 1;
    if (out.length < OCCUPANTS_SHOWN) out.push(id);
  }
  if (out.length >= OCCUPANTS_SHOWN || room.occupancy <= tenantsInside) return out;
  for (const sim of sims.values()) {
    if (out.length >= OCCUPANTS_SHOWN) break;
    if (sim.inRoomId === room.id && !out.includes(sim.id)) out.push(sim.id);
  }
  return out;
}

/** The person panel's portrait, in css px. */
export const PORTRAIT_PX = 48;

/**
 * A person's portrait: the same figure the world draws (render/figure.ts), from the same build
 * and identity look key, cropped to head and shoulders. Drawn once: a look never changes.
 */
function portrait(game: GameApi, sim: Sim): HTMLCanvasElement {
  const canvas = el('canvas', 'hs-portrait');
  const ratio = Math.min(3, Math.max(1, Math.round(globalThis.devicePixelRatio ?? 1)));
  canvas.width = PORTRAIT_PX * ratio;
  canvas.height = PORTRAIT_PX * ratio;
  canvas.style.width = `${PORTRAIT_PX}px`;
  canvas.style.height = `${PORTRAIT_PX}px`;
  canvas.style.flex = '0 0 auto';
  canvas.style.borderRadius = '12px';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `Portrait of ${storyName(game.world, sim.id)}`);
  const context = canvas.getContext?.('2d');
  if (context) {
    const look = personLookCode(game.world.seed, sim.id, sim.kind);
    context.scale(ratio, ratio);
    drawPortrait(context as unknown as Ctx2D, sim.kind, look, PORTRAIT_PX);
  }
  return canvas;
}

function simPanel(simId: Id, game: GameApi, ctx: PanelContext): PanelElement {
  const sim = game.world.sims.get(simId) as Sim;
  const { panel, body } = panelShell(SIM_KINDS[sim.kind], 'population', ctx);

  // The story card: who, what they are doing about their day, what the tower recorded, and
  // what helps. Words are built here, when the panel opens or refreshes, never in the tick.
  const who = section('Who');
  const whoLines = el('div', 'hs-story-who');
  // The portrait beside the lines: the sprite in the world, head and shoulders.
  const whoRow = el('div', 'hs-story-who-row');
  whoRow.style.display = 'flex';
  whoRow.style.gap = '10px';
  whoRow.style.alignItems = 'flex-start';
  whoRow.append(portrait(game, sim), whoLines);
  who.append(whoRow);
  const mind = section('On their mind');
  const mindLine = el('p', 'hs-story-line');
  mind.append(mindLine);
  const chapter = section('Recent chapter');
  const chapterLines = el('ul', 'hs-story-chapter');
  chapter.append(chapterLines);
  const helps = section('What helps');
  const helpsLine = el('p', 'hs-story-line');
  helps.append(helpsLine);
  const follow = button('Follow', 'hs-btn', () => {
    const story = game.world.story;
    if (isFollowed(story, simId)) unfollowSim(story, simId);
    else if (!followSim(story, simId)) {
      ctx.notice(FOLLOW_LIMIT_TEXT);
      return;
    }
    refresh();
  });
  const followRow = el('div', 'hs-actions');
  followRow.append(follow);
  body.append(who, mind, chapter, helps, followRow);

  const where = row('Position', formatFloor(sim.pos.floor));
  const state = row('Doing', SIM_STATES[sim.state]);
  const stress = row('Stress', stressBandLabel(stressBandOf(sim.stress)));
  body.append(where, state, stress);

  const home = sim.homeRoomId !== null ? game.world.rooms.get(sim.homeRoomId) : undefined;
  if (home) body.append(row('Home', `${ROOMS[home.kind].label}, ${formatFloor(home.floor).toLowerCase()}`));

  const reason = el('p', 'hs-note');
  body.append(reason);

  const refresh = (): void => {
    const sim = game.world.sims.get(simId);
    if (!sim) return;
    const card = personCard(game.world, sim);
    setLines(whoLines, card.who, 'p', 'hs-story-line');
    setText(mindLine, `${card.mind}.`);
    setLines(chapterLines, card.chapter, 'li', 'hs-story-item');
    setText(helpsLine, card.helps);
    const followed = isFollowed(game.world.story, simId);
    setText(follow, followed ? 'Unfollow' : 'Follow');
    follow.setAttribute('aria-pressed', followed ? 'true' : 'false');
    setRowValue(where, formatFloor(sim.pos.floor));
    setRowValue(state, SIM_STATES[sim.state]);
    setRowValue(stress, `${stressBandLabel(stressBandOf(sim.stress))} ${formatPercent(sim.stress)}`);
    const text = sim.leaveReason ?? '';
    if (reason.textContent !== text) reason.textContent = text;
  };
  refresh();
  panel.refresh = refresh;
  return panel;
}

function shaftPanel(shaftId: Id, game: GameApi, ctx: PanelContext): PanelElement {
  const shaft = game.world.shafts.get(shaftId) as Shaft;
  const rule = SHAFTS[shaft.kind];
  const { panel, body } = panelShell(rule.label, 'elevator', ctx);
  body.append(el('p', 'hs-note', formatFloorRange(shaft.floorMin, shaft.floorMax)));

  const cars = row('Cars', `${formatCount(shaft.cars.length)} of ${formatCount(rule.maxCars)}`);
  const riders = row('Riders', formatCount(shaft.cars.reduce((n, c) => n + c.passengers.length, 0)));
  body.append(cars, riders);
  body.append(
    el(
      'p',
      'hs-note',
      `A new elevator costs ${formatMoney(rule.shaftCost)} with its first car. More cars cost ${formatMoney(rule.carCost)} each, up to ${rule.maxCars}.`,
    ),
  );

  const actions = el('div', 'hs-actions');
  const add = button(`Add car ${formatMoney(rule.carCost)}`, 'hs-btn', () => {
    ctx.apply({ kind: 'shaft.addCar', shaftId: shaft.id });
  });
  const remove = button('Remove car', 'hs-btn', () => {
    ctx.apply({ kind: 'shaft.removeCar', shaftId: shaft.id });
  });
  actions.append(add, remove);
  body.append(actions);

  // Stretching a standing elevator, the way the original let you drag one taller or deeper.
  // It costs nothing, so the only question the buttons ask is whether the floor is free.
  const reach = el('div', 'hs-actions');
  const extendUp = button('Extend up', 'hs-btn', () => {
    const now = game.world.shafts.get(shaftId);
    if (!now) return;
    ctx.apply({ kind: 'shaft.extend', shaftId, floorMin: now.floorMin, floorMax: stepFloor(now.floorMax, 1) });
  });
  const extendDown = button('Extend down', 'hs-btn', () => {
    const now = game.world.shafts.get(shaftId);
    if (!now) return;
    ctx.apply({ kind: 'shaft.extend', shaftId, floorMin: stepFloor(now.floorMin, -1), floorMax: now.floorMax });
  });
  reach.append(extendUp, extendDown);
  body.append(reach);

  const stopButtons: { floor: number; node: HTMLButtonElement }[] = [];
  if (shaft.kind === 'express') {
    const stops = section('Stops');
    stops.append(
      el('p', 'hs-note', 'Express elevators stop only at lobbies and underground floors.'),
    );
    const list = el('div', 'hs-stops');
    for (const floor of expressStopFloors(shaft)) {
      const label = floor < 0 ? `B${Math.abs(floor)}` : String(floor);
      const node = button(label, 'hs-stop', () => {
        ctx.apply({
          kind: 'shaft.setStop',
          shaftId: shaft.id,
          floor,
          stops: !shaft.stops.has(floor),
        });
      });
      node.setAttribute('aria-label', `Stop at ${formatFloor(floor).toLowerCase()}`);
      stopButtons.push({ floor, node });
      list.append(node);
    }
    stops.append(list);
    body.append(stops);
  }

  // Each car can take its own slice of the shaft and its own riders. A dedicated car
  // still carries everyone else while its own people have nothing on, so the list is
  // rebuilt whenever the cars change and reread on every refresh.
  const carsSection = section('Cars');
  const carList = el('div', 'hs-cars');
  carsSection.append(
    el(
      'p',
      'hs-note',
      'You can give a car its own floors and its own riders. A car kept for some riders still picks up anyone else when its own riders do not need it.',
    ),
    carList,
  );
  body.append(carsSection);

  interface CarRow {
    carId: Id;
    label: HTMLParagraphElement;
    serves: HTMLButtonElement;
    steps: { node: HTMLButtonElement; edge: 'lo' | 'hi'; step: -1 | 1 }[];
    whole: HTMLButtonElement;
  }
  let carRows: CarRow[] = [];
  let carSignature = '';

  const setCarRange = (car: Car, lo: number, hi: number): void => {
    ctx.apply({ kind: 'shaft.setCarRange', shaftId, carId: car.id, range: { lo, hi } });
  };

  const buildCarRows = (shaft: Shaft): void => {
    carList.replaceChildren();
    carRows = shaft.cars.map((car, index) => {
      const node = el('div', 'hs-car');
      const label = el('p', 'hs-car-label');
      const actions = el('div', 'hs-actions hs-car-actions');

      const serves = button('Serves', 'hs-btn', () => {
        const now = carOf(game, shaftId, car.id);
        if (!now) return;
        ctx.apply({
          kind: 'shaft.setCarServes',
          shaftId,
          carId: car.id,
          serves: nextServes(now.serves),
        });
      });
      serves.setAttribute('aria-label', `Riders for car ${index + 1}`);

      const steps: CarRow['steps'] = [];
      const stepper = (text: string, edge: 'lo' | 'hi', step: -1 | 1): HTMLButtonElement => {
        const btn = button(text, 'hs-btn', () => {
          const shaftNow = game.world.shafts.get(shaftId);
          const now = shaftNow?.cars.find((c) => c.id === car.id);
          if (!shaftNow || !now) return;
          const span = carRangeOf(shaftNow, now);
          const moved = stepFloor(edge === 'lo' ? span.lo : span.hi, step);
          if (edge === 'lo') setCarRange(now, moved, span.hi);
          else setCarRange(now, span.lo, moved);
        });
        btn.setAttribute('aria-label', `${text} floor for car ${index + 1}`);
        steps.push({ node: btn, edge, step });
        return btn;
      };

      const whole = button('Every floor', 'hs-btn', () => {
        ctx.apply({ kind: 'shaft.setCarRange', shaftId, carId: car.id, range: null });
      });

      actions.append(
        serves,
        stepper('Bottom \u2212', 'lo', -1),
        stepper('Bottom +', 'lo', 1),
        stepper('Top \u2212', 'hi', -1),
        stepper('Top +', 'hi', 1),
        whole,
      );
      node.append(label, actions);
      carList.append(node);
      return { carId: car.id, label, serves, steps, whole };
    });
  };

  const refreshCars = (shaft: Shaft): void => {
    const signature = shaft.cars.map((car) => car.id).join(',');
    if (signature !== carSignature) {
      carSignature = signature;
      buildCarRows(shaft);
    }
    for (let i = 0; i < carRows.length; i += 1) {
      const row = carRows[i] as CarRow;
      const car = shaft.cars[i];
      if (!car) continue;
      const span = carRangeOf(shaft, car);
      setText(row.label, `Car ${i + 1} \u00b7 ${floorsLabel(span.lo, span.hi)} \u00b7 ${SERVES_LABEL[car.serves]}`);
      setText(row.serves, `Serves: ${SERVES_LABEL[car.serves]}`);
      const busy = car.passengers.length > 0;
      for (const step of row.steps) {
        const at = step.edge === 'lo' ? span.lo : span.hi;
        const moved = stepFloor(at, step.step);
        const outside = moved < shaft.floorMin || moved > shaft.floorMax;
        const crossed = step.edge === 'lo' ? moved > span.hi : moved < span.lo;
        const newLo = step.edge === 'lo' ? moved : span.lo;
        const newHi = step.edge === 'hi' ? moved : span.hi;
        const tooNarrow = newHi - newLo < 1;
        step.node.disabled = busy || outside || crossed || tooNarrow;
        const edgeWord = step.edge === 'lo' ? 'bottom' : 'top';
        step.node.title = busy
          ? 'People are inside.'
          : outside
            ? `This car already reaches the ${step.step === 1 ? 'top' : 'bottom'} of the elevator.`
            : crossed
              ? 'A car needs at least one floor.'
              : tooNarrow
                ? 'A car must serve at least two floors.'
                : `Move the ${edgeWord} of this car to ${formatFloor(moved).toLowerCase()}`;
      }
      row.whole.hidden = car.range === null;
      row.whole.disabled = busy;
      row.whole.title = busy ? 'People are inside.' : 'Stop at every floor of the elevator again';
    }
  };

  const refresh = (): void => {
    const shaft = game.world.shafts.get(shaftId);
    if (!shaft) return;
    refreshCars(shaft);
    setRowValue(cars, `${formatCount(shaft.cars.length)} of ${formatCount(rule.maxCars)}`);
    setRowValue(riders, formatCount(shaft.cars.reduce((n, c) => n + c.passengers.length, 0)));
    add.disabled = shaft.cars.length >= rule.maxCars;
    add.title = add.disabled ? `This elevator already has ${shaft.cars.length} cars.` : '';
    remove.disabled = shaft.cars.length <= 1;
    remove.title = remove.disabled ? 'An elevator needs at least one car.' : '';
    offerReach(extendUp, game.canExtend(shaftId, shaft.floorMin, stepFloor(shaft.floorMax, 1)), 'Reach one floor higher');
    offerReach(extendDown, game.canExtend(shaftId, stepFloor(shaft.floorMin, -1), shaft.floorMax), 'Reach one floor lower');
    for (const stop of stopButtons) {
      stop.node.setAttribute('aria-pressed', shaft.stops.has(stop.floor) ? 'true' : 'false');
    }
  };
  refresh();
  panel.refresh = refresh;
  return panel;
}

/** What the panel calls each setting, in the label and on the button. */
const SERVES_LABEL: Record<Car['serves'], string> = {
  any: 'Everyone',
  hotel: 'Hotel guests',
  office: 'Office staff',
};

/** Everyone, then hotel guests, then office staff, then round again. */
function nextServes(serves: Car['serves']): Car['serves'] {
  if (serves === 'any') return 'hotel';
  if (serves === 'hotel') return 'office';
  return 'any';
}

function carOf(game: GameApi, shaftId: Id, carId: Id): Car | undefined {
  return game.world.shafts.get(shaftId)?.cars.find((car) => car.id === carId);
}

/** "Floors 3-12", or "Floor 5" when a car works one floor, with B for the basements. */
function floorsLabel(lo: number, hi: number): string {
  const short = (floor: number): string => (floor < 0 ? `B${Math.abs(floor)}` : String(floor));
  if (lo === hi) return `Floor ${short(lo)}`;
  return `Floors ${short(lo)}\u2013${short(hi)}`;
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** One floor up or down, stepping over the ground: floor 0 does not exist. */
function stepFloor(floor: number, step: number): number {
  const next = floor + step;
  return next === 0 ? floor + step * 2 : next;
}

/** Offer the reach, or refuse it in the sim's own words. */
function offerReach(node: HTMLButtonElement, result: CommandResult, title: string): void {
  node.disabled = !result.ok;
  node.title = result.ok ? title : result.reason;
}

/** Lobby, sky lobby and underground floors inside the span: the only floors an express may serve. */
function expressStopFloors(shaft: Shaft): number[] {
  const floors: number[] = [];
  for (let floor = shaft.floorMin; floor <= shaft.floorMax; floor += 1) {
    if (floor === 0) continue;
    if (floor === 1 || floor < 0 || LIMITS.skyLobbyFloors.includes(floor)) floors.push(floor);
  }
  return floors;
}

/** What the rent comes to: "$60,000 sale", "$450 per night", "$12,000 per quarter". */
export function rentMoneyText(room: Room): string {
  const rent = room.rent;
  if (room.kind === 'condo') {
    return `${formatMoney(ECONOMY.condoSalePrice * (rent / 100))} sale`;
  }
  if (room.kind === 'hotelSingle' || room.kind === 'hotelTwin' || room.kind === 'hotelSuite') {
    const rule = ROOMS[room.kind];
    const nightly = rule.incomePerQuarter * ECONOMY.hotelNightlyIncomeFraction * (rent / 100);
    return `${formatMoney(nightly)} per night`;
  }
  if (room.kind === 'office') {
    return `${formatMoney(officeQuarterRent(room))} per quarter now`;
  }
  const rule = ROOMS[room.kind];
  const quarterly = rule.incomePerQuarter * (rent / 100);
  return `${formatMoney(quarterly)} per quarter`;
}

function setRowValue(node: HTMLElement, text: string): void {
  const value = node.lastElementChild;
  if (value && value.textContent !== text) value.textContent = text;
}

// --------------------------------------------------------- finances panel

export function createFinancesPanel(game: GameApi, ctx: PanelContext): PanelElement {
  const { panel, body } = panelShell('Finances', 'finance', ctx);
  const stats = game.world.stats;
  const lastQuarter = (): { income: number; upkeep: number; net: number } =>
    game.world.stats.lastQuarter;

  // The summary as a bento grid: cash now across the top, then last quarter's three numbers.
  const bento = el('div', 'hs-bento');
  const cashRow = tile('Cash now', formatMoney(game.world.cash), { wide: true, money: true });
  const income = tile('Income last quarter', formatMoney(stats.lastQuarter.income), { money: true });
  const upkeep = tile('Costs last quarter', formatMoney(stats.lastQuarter.upkeep), { money: true });
  const net = tile('Profit last quarter', formatSignedMoney(stats.lastQuarter.net), { wide: true, money: true });
  bento.append(cashRow, income, upkeep, net);
  body.append(bento);

  const incomeSection = section('Income this quarter so far');
  const incomeList = el('div', 'hs-list');
  incomeSection.append(incomeList);
  const upkeepSection = section('Costs this quarter so far');
  const upkeepList = el('div', 'hs-list');
  upkeepSection.append(upkeepList);
  body.append(incomeSection, upkeepSection);

  const fillList = (list: HTMLDivElement, map: Partial<Record<string, number>>): void => {
    const entries = Object.entries(map)
      .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] !== 0)
      .sort((a, b) => b[1] - a[1]);
    const key = entries.map(([k, v]) => `${k}:${v}`).join('|');
    if (list.dataset['key'] === key) return;
    list.dataset['key'] = key;
    if (entries.length === 0) {
      list.replaceChildren(el('p', 'hs-note', 'Nothing yet.'));
      return;
    }
    list.replaceChildren(
      ...entries.map(([kind, value]) => moneyRow(kindLabel(kind as RoomKind | ShaftKind), formatMoney(value))),
    );
  };

  const refresh = (): void => {
    setRowValue(income, formatMoney(lastQuarter().income));
    setRowValue(upkeep, formatMoney(lastQuarter().upkeep));
    setRowValue(net, formatSignedMoney(lastQuarter().net));
    net.classList.toggle('is-up', lastQuarter().net > 0);
    net.classList.toggle('is-down', lastQuarter().net < 0);
    setRowValue(cashRow, formatMoney(game.world.cash));
    fillList(incomeList, game.world.stats.incomeByKind);
    fillList(upkeepList, game.world.stats.upkeepByKind);
  };
  refresh();
  panel.refresh = refresh;
  return panel;
}

// ------------------------------------------------------------- news panel

/** News shows this many of the newest lines at first, newest on top. */
export const NEWS_LINES = 10;
/** Each tap on Show older adds this many more. */
export const NEWS_OLDER_STEP = 50;

/**
 * When a line happened, in words, from the game clock: "just now", "an hour ago", "5 hours ago",
 * "yesterday", "3 days ago". Days are the game's calendar days, so last night is yesterday.
 */
export function newsTime(now: number, minute: number): string {
  const ago = Math.max(0, Math.floor(now) - Math.floor(minute));
  if (ago < 60) return 'just now';
  if (ago < 120) return 'an hour ago';
  const days = Math.floor(Math.max(0, now) / 1440) - Math.floor(Math.max(0, minute) / 1440);
  if (days <= 0 || ago < 6 * 60) return `${Math.floor(ago / 60)} hours ago`;
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/**
 * News: what has happened in the tower lately, in plain sentences, newest first, each with when
 * it happened in words. The newest ten at first; Show older adds fifty at a time. The VIP card
 * sits on top while there is a visit to talk about.
 */
export function createLogPanel(game: GameApi, ctx: PanelContext): PanelElement {
  const { panel, body } = panelShell('News', 'log', ctx);
  panel.classList.add('hs-news');
  const list = el('ul', 'hs-log-list');
  let limit = NEWS_LINES;
  const older = button('Show older', 'hs-news-older', () => {
    limit += NEWS_OLDER_STEP;
    refresh();
  });
  older.hidden = true;
  body.append(list, older);

  // The VIP card sits above the news, built only while there is something to say about a visit.
  let vipNode: HTMLDivElement | null = null;
  let vipKey = '';
  const refreshVip = (): void => {
    const view = vipView(game.world);
    const key = vipViewKey(view);
    if (key === vipKey) return;
    vipKey = key;
    if (!view) {
      vipNode?.remove();
      vipNode = null;
      return;
    }
    vipNode?.remove();
    vipNode = vipCard(view);
    body.prepend(vipNode);
  };

  /** The time span of each line on show, newest first, with the minute it stands for. */
  let stamps: { node: HTMLElement; minute: number }[] = [];
  const item = (entry: LogEntry, now: number): HTMLLIElement => {
    const node = el('li', `hs-log-item is-${entry.level}`);
    const time = el('span', 'hs-log-time', newsTime(now, entry.minute));
    node.append(el('span', 'hs-log-text', entry.text), time);
    stamps.push({ node: time, minute: entry.minute });
    return node;
  };

  /** What the list was built from: the log array, its total and the limit. A load swaps the array. */
  let shownLog: readonly LogEntry[] | null = null;
  let shownKey = '';
  const refresh = (): void => {
    refreshVip();
    const world = game.world;
    const log = world.log;
    const now = world.time?.minute ?? 0;
    const key = `${world.logTotal}:${limit}`;
    if (shownLog !== log || key !== shownKey) {
      shownLog = log;
      shownKey = key;
      stamps = [];
      const lines = log.slice(-limit).reverse();
      list.replaceChildren(
        ...(lines.length === 0 ? [el('li', 'hs-log-item', 'Nothing has happened yet.')] : lines.map((entry) => item(entry, now))),
      );
      older.hidden = log.length <= limit;
      return;
    }
    // No new line: only the words for when move on with the clock.
    for (const stamp of stamps) {
      const words = newsTime(now, stamp.minute);
      if (stamp.node.textContent !== words) stamp.node.textContent = words;
    }
  };
  refresh();
  panel.refresh = refresh;
  return panel;
}

/** The VIP visit: who, what they care about, the preparation ticks or the last rating, and the next chance. */
function vipCard(view: VipView): HTMLDivElement {
  const node = section('VIP visit');
  node.classList.add('hs-vip');
  for (const line of view.lines) node.append(el('p', 'hs-story-line', line));
  const rows = view.checklist
    ? view.checklist.map((check) => ({ label: check.label, value: check.done ? 'Ready' : 'Not yet', done: check.done }))
    : (view.breakdown ?? []).map((r) => ({ label: r.label, value: r.value, done: false }));
  if (rows.length > 0) {
    const list = el('ul', 'hs-goals');
    for (const r of rows) {
      const item = el('li', r.done ? 'hs-row hs-goal is-done' : 'hs-row hs-goal');
      item.append(el('span', 'hs-row-label', r.label), el('span', 'hs-row-value', r.value));
      list.append(item);
    }
    node.append(list);
  }
  if (view.nextChance) node.append(el('p', 'hs-note', view.nextChance));
  return node;
}

// ---------------------------------------------------------- stories panel

/** A beat as the tower list shows it: a person's line carries their name. */
function towerBeatText(game: GameApi, beat: StoryBeat): string {
  const line = describeBeat(beat, game.world);
  const personal = beat.code === 'wait.long' || beat.code === 'trip.arrived' || beat.code === 'trip.gaveUp' || beat.code === 'room.vacated';
  return personal && beat.simId !== undefined ? `${storyName(game.world, beat.simId)}: ${line}` : line;
}

/**
 * The people being followed, each with their latest line, and the last few beats from around
 * the tower. Built from the recorded beats when the panel opens and when they change.
 */
export function createStoriesPanel(game: GameApi, ctx: PanelContext): PanelElement {
  const { panel, body } = panelShell('Stories', 'population', ctx);
  const following = section('Following');
  const followList = el('div', 'hs-occupants');
  following.append(followList);
  const tower = section('Around the tower');
  const towerList = el('ul', 'hs-story-chapter');
  tower.append(towerList);
  const milestones = section('Milestones');
  const milestoneActions = el('div', 'hs-actions');
  milestones.append(milestoneActions);
  body.append(following, tower, milestones);

  let followKey = '';
  const refresh = (): void => {
    const world = game.world;
    const story = world.story;
    const rows = story.followed.map((id) => {
      const sim = world.sims.get(id);
      const thread = story.threads[id] ?? [];
      const last = thread[thread.length - 1];
      const line = last ? describeBeat(last, world) : sim ? `${goalLine(world, sim)}.` : 'Left the tower.';
      return { id, name: storyName(world, id), line, here: sim !== undefined };
    });
    const key = rows.map((r) => `${r.id}:${r.line}:${r.here ? 1 : 0}`).join('|');
    if (key !== followKey) {
      followKey = key;
      if (rows.length === 0) {
        followList.replaceChildren(el('p', 'hs-note', 'Nobody yet. Open a person and choose Follow.'));
      } else {
        followList.replaceChildren(
          ...rows.map((r) => {
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
            });
            release.setAttribute('aria-label', `Unfollow ${r.name}`);
            wrap.append(item, release);
            return wrap;
          }),
        );
      }
    }
    const lines = story.recent.slice(-STORIES_TOWER_LINES).map((beat) => towerBeatText(game, beat));
    setLines(towerList, lines.length > 0 ? lines : ['Nothing recorded yet.'], 'li', 'hs-story-item');

    // Reopen the last milestone and the chronicle, whenever the record holds them.
    const hasRecap = ctx.openRecap !== undefined && story.recent.some((beat) => beat.code === 'star.gained');
    const hasChronicle = ctx.openChronicle !== undefined && story.chronicle !== null && story.chronicle !== undefined;
    const milestoneKey = `${hasRecap ? 1 : 0}${hasChronicle ? 1 : 0}`;
    if (milestoneActions.dataset['key'] !== milestoneKey) {
      milestoneActions.dataset['key'] = milestoneKey;
      const actions: HTMLElement[] = [];
      if (hasRecap) actions.push(button('Last milestone', 'hs-btn', () => ctx.openRecap?.()));
      if (hasChronicle) actions.push(button('Tower chronicle', 'hs-btn', () => ctx.openChronicle?.()));
      milestoneActions.replaceChildren(...actions);
      milestones.hidden = actions.length === 0;
    }
  };
  refresh();
  panel.refresh = refresh;
  return panel;
}

// ------------------------------------------------ milestone recap and chronicle

/**
 * Stories so far: the last milestone's star, what it opened up, and up to six people and places
 * whose circumstances changed since the milestone before it. Read from the record when it opens.
 */
export function createRecapPanel(game: GameApi, ctx: PanelContext): PanelElement {
  const { panel, body } = panelShell('Stories so far', 'population', ctx);
  const recap = milestoneRecap(game.world);
  if (!recap) {
    body.append(el('p', 'hs-note', NO_STORIES_YET));
    return panel;
  }
  const star = Math.min(6, Math.max(1, Math.round(recap.star)));
  // The summary as a bento grid: the milestone and how much changed, then what it opened up.
  const bento = el('div', 'hs-bento');
  bento.append(
    tile('Milestone', star === 6 ? 'Tower status' : `${star} stars`),
    tile('New stories', formatCount(recap.lines.length)),
    tile('Opened up', recap.unlocks, { wide: true, text: true }),
  );
  const people = section('Since the last milestone');
  const list = el('ul', 'hs-story-chapter');
  setLines(list, recap.lines.length > 0 ? recap.lines : [NO_STORIES_YET], 'li', 'hs-story-item');
  people.append(list);
  body.append(bento, people);
  return panel;
}

/** A PNG blob as base64, for the phone share sheet. */
async function blobBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * An image out by platform, the same doors a save uses: the desktop save dialog, the phone share
 * sheet, or the browser download. Nothing is uploaded. A cancelled dialog or sheet says nothing.
 */
export async function exportImage(blob: Blob, ctx: Pick<PanelContext, 'notice'>): Promise<void> {
  const platform = savePlatform();
  try {
    if (platform === 'tauri') {
      if (await exportImageWithDialog(new Uint8Array(await blob.arrayBuffer()))) ctx.notice('Image saved.');
    } else if (platform === 'capacitor') {
      await shareImage(await blobBase64(blob));
      ctx.notice('Image saved.');
    } else {
      const url = URL.createObjectURL(blob);
      const link = el('a');
      link.href = url;
      link.download = IMAGE_FILE_NAME;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      ctx.notice('Image saved.');
    }
  } catch (err) {
    if (/cancel/i.test(String((err as { message?: unknown } | null)?.message ?? err))) return;
    ctx.notice('The image could not be saved.');
  }
}

export const CHRONICLE_TITLE = 'Tower chronicle';

/** The tower chronicle as recorded at Tower status, with a button that saves it as an image. */
export function createChroniclePanel(game: GameApi, ctx: PanelContext): PanelElement {
  const { panel, body } = panelShell(CHRONICLE_TITLE, 'population', ctx);
  const chronicle = game.world.story.chronicle;
  if (!chronicle) {
    body.append(el('p', 'hs-note', 'The chronicle is written when the tower reaches Tower status.'));
    return panel;
  }
  const list = el('ul', 'hs-story-chapter');
  setLines(list, chronicle.lines, 'li', 'hs-story-item');
  const actions = el('div', 'hs-actions');
  const save = button('Save as image', 'hs-btn', () => {
    save.disabled = true;
    let blob: Promise<Blob>;
    try {
      blob = canvasToPng(composeListImage(CHRONICLE_TITLE, chronicle.lines));
    } catch {
      blob = Promise.reject(new Error('compose'));
    }
    void blob
      .then((png) => exportImage(png, ctx))
      .catch(() => ctx.notice('The image could not be made.'))
      .finally(() => {
        save.disabled = false;
      });
  });
  actions.append(save);
  body.append(list, actions);
  return panel;
}

// --------------------------------------------------------- settings panel

/** A fresh random start for New game, drawn the same way main.ts draws one for a first visit. */
function freshStart(): number {
  return Math.floor(Date.now() % 1_000_000);
}

/** The Display switches another part of the ui reads back (prefs.ts keys). */
export type DisplaySwitch = 'largeText' | 'colorBlind' | 'glassClear';

/** The class on the page root that makes the controls layer clearer (ui.css, package 1). */
export const GLASS_CLEAR_CLASS = 'hs-glass-clear';

/** See-through buttons: on or off on the page root. A page with no root does nothing. */
export function applyGlassClear(on: boolean): void {
  try {
    document.documentElement?.classList.toggle(GLASS_CLEAR_CLASS, on);
  } catch {
    // No page root to mark: the controls keep the tinted look.
  }
}

/** Is See-through buttons on? Off by default and when the store will not answer. */
export function readGlassClear(): boolean {
  return getFlag(PREF_KEYS.glassClear) === true;
}

/** A settings group: its title, a line under it when it needs one, then one rounded list of rows. */
function settingsGroup(title: string, note?: string): { node: HTMLDivElement; list: HTMLDivElement } {
  const node = section(title);
  if (note) node.append(el('p', 'hs-note', note));
  const list = el('div', 'hs-set-list');
  node.append(list);
  return { node, list };
}

/** A row that does one thing when tapped. Its words are the whole of its name. */
function actionRow(label: string, onClick: () => void, title?: string): HTMLButtonElement {
  const node = button(label, 'hs-set-row hs-set-action', onClick);
  if (title) node.title = title;
  return node;
}

export interface SwitchRow {
  row: HTMLDivElement;
  control: HTMLButtonElement;
  set(on: boolean): void;
}

/**
 * A real toggle switch: a button with role switch and aria-checked, named by the label beside
 * it (a tap on the words flips it too). The whole row is at least 44 px tall and the switch
 * itself 44 px wide.
 */
export function switchRow(id: string, label: string, on: boolean, onChange: (on: boolean) => void): SwitchRow {
  const row = el('div', 'hs-set-row hs-set-switch');
  const text = el('label', 'hs-set-label', label);
  text.htmlFor = id;
  const control = el('button', 'hs-switch');
  control.type = 'button';
  control.id = id;
  control.setAttribute('role', 'switch');
  control.append(el('span', 'hs-switch-thumb'));
  const set = (next: boolean): void => {
    control.setAttribute('aria-checked', next ? 'true' : 'false');
  };
  set(on);
  control.addEventListener('click', () => {
    const next = control.getAttribute('aria-checked') !== 'true';
    set(next);
    onChange(next);
  });
  row.append(text, control);
  return { row, control, set };
}

const THEME_CHOICES: readonly [Theme, string][] = [
  ['system', 'Auto'],
  ['light', 'Light'],
  ['dark', 'Dark'],
];

/** Theme as three joined buttons: Auto (follow the device), Light, Dark. The chosen one is pressed. */
function themeRow(): HTMLDivElement {
  const row = el('div', 'hs-set-row hs-set-choice');
  const label = el('span', 'hs-set-label', 'Theme');
  label.id = 'hs-theme-label';
  const group = el('div', 'hs-segmented');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-labelledby', label.id);
  let theme = readTheme();
  const buttons = THEME_CHOICES.map(([value, words]) => {
    const node = button(words, 'hs-seg-btn', () => {
      theme = value;
      applyTheme(theme);
      paint();
    });
    node.dataset['theme'] = value;
    return node;
  });
  const paint = (): void => {
    buttons.forEach((node, i) => node.setAttribute('aria-pressed', THEME_CHOICES[i]?.[0] === theme ? 'true' : 'false'));
  };
  paint();
  group.append(...buttons);
  row.append(label, group);
  return row;
}

/** The title words in a sheet's head, to name the page the settings sheet is on. */
function titleText(panel: PanelElement): HTMLElement | null {
  const heading = panel.sheet?.head.firstElementChild as HTMLElement | null | undefined;
  return (heading?.lastElementChild as HTMLElement | null | undefined) ?? null;
}

export function createSettingsPanel(game: GameApi, ctx: PanelContext): PanelElement {
  const { panel, body } = panelShell('Settings', 'settings', ctx);
  panel.classList.add('hs-settings');
  const main = el('div', 'hs-set-main');

  // Game: Today's tower, then New game in My tower or My tower anywhere else, then Stories.
  // A new tower always gets a fresh random start; the starting number is only in the page
  // address (?seed=, read in main.ts) for testing, never in this panel. New game only ever
  // replaces My tower, so outside it the row is My tower instead.
  const gameGroup = settingsGroup('Game');
  const slot = game.getSlot?.() ?? 'mine';
  const openDaily = ctx.openDaily;
  if (openDaily && slot !== 'daily') gameGroup.list.append(actionRow("Today's tower", () => openDaily()));
  const openMine = ctx.openMyTower;
  if (slot === 'mine') {
    gameGroup.list.append(
      actionRow('New game', () => {
        game.newGame(freshStart());
        ctx.notice('New game started.');
      }),
    );
  } else if (openMine) {
    gameGroup.list.append(actionRow('My tower', () => openMine()));
  }
  const openStories = ctx.openStories;
  if (openStories) {
    gameGroup.list.append(actionRow('Stories', () => openStories(), 'The people you follow and the latest from around the tower'));
  }
  if (gameGroup.list.children.length > 0) main.append(gameGroup.node);

  // Saving: the tower saves itself; these are for the player who wants to be sure, or a copy.
  // Today's tower is one try per date, so there nothing rewinds or replaces the run: no Go back
  // to last save and no Open a saved file. Saving a copy to a file is still fine.
  const oneTry = slot === 'daily';
  const saving = settingsGroup('Saving', 'Your tower saves by itself.');
  saving.list.append(
    actionRow('Save now', () => {
      void game.save().then((result) => {
        ctx.notice(result.ok ? 'Game saved.' : result.reason);
      });
    }),
  );
  if (!oneTry) {
    saving.list.append(
      actionRow('Go back to last save', () => {
        void game.load().then((result) => {
          ctx.notice(result.ok ? 'Back to your last save.' : result.reason);
        });
      }),
    );
  }
  saving.list.append(
    actionRow('Save to a file', () => {
      exportSave(game.exportSave(), ctx);
    }),
  );
  // A My tower save that could not be opened was kept aside: this is the way to get it back out.
  const kept = game.getKeptCopy?.() ?? null;
  if (kept !== null) {
    saving.list.append(
      actionRow('Save the old tower to a file', () => {
        exportSave(game.getKeptCopy?.() ?? kept, ctx);
      }),
    );
  }
  if (!oneTry && savePlatform() === 'tauri') {
    // The desktop shell: a system open dialog, not a file input.
    const pick = actionRow('Open a saved file', () => {
      void importSaveWithDialog()
        .then((text) => {
          if (text === null) return;
          const result = game.importSave(text);
          ctx.notice(result.ok ? 'Tower opened.' : result.reason);
        })
        .catch(() => ctx.notice('That file could not be read.'));
    });
    pick.id = 'hs-import';
    pick.setAttribute('aria-label', 'Open a saved file');
    saving.list.append(pick);
  } else if (!oneTry) {
    // The web and the phones: our own button opens a file input kept out of sight, so the
    // browser's "Choose file" and "No file chosen" never show.
    const file = importFileInput(game, ctx);
    const pick = actionRow('Open a saved file', () => file.click());
    pick.setAttribute('aria-controls', file.id);
    saving.list.append(pick, file);
  }
  main.append(saving.node);

  if (ctx.sound) main.append(soundSection(ctx.sound));

  // Display: the theme, then the switches. Larger text and Color-blind friendly views are read
  // back by the rest of the ui (prefs.ts); See-through buttons marks the page root here.
  const display = settingsGroup('Display');
  display.list.append(
    themeRow(),
    switchRow('hs-reduced-motion', 'Reduced motion', ctx.reducedMotion, (on) => ctx.setReducedMotion(on)).row,
    switchRow('hs-large-text', 'Larger text', getFlag(PREF_KEYS.largeText) === true, (on) => {
      setFlag(PREF_KEYS.largeText, on);
      ctx.setDisplay?.('largeText', on);
    }).row,
    switchRow('hs-color-blind', 'Color-blind friendly views', getFlag(PREF_KEYS.colorBlind) === true, (on) => {
      setFlag(PREF_KEYS.colorBlind, on);
      ctx.setDisplay?.('colorBlind', on);
    }).row,
    switchRow('hs-glass-clear', 'See-through buttons', readGlassClear(), (on) => {
      setFlag(PREF_KEYS.glassClear, on);
      applyGlassClear(on);
      ctx.setDisplay?.('glassClear', on);
    }).row,
    // Vibration (haptics), last: on by default (src/ui/haptics.ts).
    switchRow('hs-haptics', 'Vibration', hapticsEnabled(), (on) => setHapticsEnabled(on)).row,
  );
  main.append(display.node);

  // Help: the intro again, the guide page, and the Controls page.
  const help = settingsGroup('Help');
  const openIntro = ctx.openIntro;
  if (openIntro) help.list.append(actionRow('Intro', () => openIntro(), 'Show the three intro screens again'));
  const guide = el('a', 'hs-set-row hs-set-action hs-link', 'How to play');
  guide.href = HOW_TO_PLAY_HREF;
  guide.target = '_blank';
  guide.rel = 'noopener';
  guide.title = 'The full guide, in a new tab';
  help.list.append(guide);
  const controlsRow = actionRow('Controls', () => showControls(true));
  controlsRow.append(chevron() as unknown as HTMLElement);
  controlsRow.title = 'The controls for what you are playing with';
  help.list.append(controlsRow);
  main.append(help.node);

  // The Controls page: its own page inside the sheet, with a way back. Built now for the device
  // in hand, and again each time it opens, in case a controller was plugged in since.
  const controlsPage = el('div', 'hs-set-page');
  controlsPage.hidden = true;
  const back = button('Back', 'hs-set-back', () => showControls(false));
  back.setAttribute('aria-label', 'Back to settings');
  const controls = el('div', 'hs-help-controls');
  fillControlsPage(controls, controlsDevice(currentDeviceEnv()));
  controlsPage.append(back, controls);
  controlsPage.addEventListener('keydown', (event: Event) => {
    const key = event as KeyboardEvent;
    if (key.key !== 'Escape' || key.defaultPrevented) return;
    key.preventDefault();
    showControls(false);
  });

  function showControls(on: boolean): void {
    if (on) fillControlsPage(controls, controlsDevice(currentDeviceEnv()));
    main.hidden = on;
    controlsPage.hidden = !on;
    const title = titleText(panel);
    if (title) title.textContent = on ? 'Controls' : 'Settings';
    (on ? back : controlsRow).focus?.({ preventScroll: true });
  }

  body.append(main, controlsPage);
  return panel;
}

/** Sound on or off, and its three levels. Off by default; nothing plays until it is on. */
function soundSection(sound: Sound): HTMLDivElement {
  const group = settingsGroup('Sound');
  const levels: HTMLInputElement[] = [];
  const toggle = switchRow('hs-sound', 'Sound', sound.settings.on, (on) => {
    sound.setEnabled(on);
    for (const input of levels) input.disabled = !on;
  });
  group.list.append(toggle.row);

  const level = (id: string, name: string, value: number, set: (n: number) => void): HTMLDivElement => {
    const row = el('div', 'hs-set-row hs-level');
    const input = el('input');
    input.type = 'range';
    input.id = id;
    input.min = '0';
    input.max = '100';
    input.step = '5';
    input.value = String(value);
    input.disabled = !sound.settings.on;
    const text = el('label', 'hs-set-label', name);
    text.htmlFor = input.id;
    const readout = el('span', 'hs-level-value', String(value));
    const paint = (): void => {
      input.style.setProperty('--level', `${input.value}%`);
    };
    paint();
    input.addEventListener('input', () => {
      set(Number(input.value));
      readout.textContent = input.value;
      paint();
    });
    levels.push(input);
    row.append(text, input, readout);
    return row;
  };
  group.list.append(
    level('hs-sound-music', 'Music', sound.settings.music ?? 60, (n) => sound.setMusic?.(n)),
    level('hs-sound-effects', 'Sound effects', sound.settings.effects, (n) => sound.setEffects(n)),
    level('hs-sound-ambient', 'Background', sound.settings.ambient, (n) => sound.setAmbient(n)),
  );
  group.node.append(
    el('p', 'hs-note', 'Music grows with the tower. Sound effects play for events and stars. Background sound follows the time of day and the weather.'),
  );
  return group.node;
}

// ----------------------------------------------------------- share panel

/**
 * The share panel. `words`, when given, replaces the message and the link (today's tower shares
 * its score and a link to the same day); the picture and the share sheet are the same.
 */
export function createSharePanel(
  game: GameApi,
  renderer: Renderer,
  ctx: PanelContext,
  words?: { text: string; url: string },
): PanelElement {
  const { panel, body } = panelShell('Share', 'share', ctx);

  const stats = shareStats(game.world);
  const text = words ? words.text : shareText(stats);
  const url = words ? words.url : shareUrl(stats);
  const message = words ? `${text}\n${url}` : shareMessage(stats);

  const preview = el('div', 'hs-share-preview');
  body.append(preview);

  const textarea = el('textarea', 'hs-share-text');
  textarea.readOnly = true;
  textarea.value = message;
  textarea.rows = 4;
  const messageField = el('div', 'hs-field');
  messageField.append(el('label', 'hs-row-label', 'Message'), textarea);
  body.append(messageField);

  const shareActions = el('div', 'hs-actions');
  body.append(shareActions);

  let blob: Blob | null = null;
  let previewUrl: string | null = null;

  const saveButton = button('Save image', 'hs-btn', () => {
    if (!blob) return;
    const link = el('a');
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = 'hundred-stories-tower.png';
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  });
  saveButton.disabled = true;

  const copyButton = button('Copy message', 'hs-btn', () => {
    const clipboard = navigator.clipboard;
    if (clipboard?.writeText) {
      clipboard
        .writeText(message)
        .then(() => ctx.notice('Message copied.'))
        .catch(() => {
          textarea.select();
          ctx.notice('Select the text and copy it.');
        });
    } else {
      textarea.select();
      ctx.notice('Select the text and copy it.');
    }
  });

  let sendButton: HTMLButtonElement | null = null;
  if (navigator.share) {
    sendButton = button('Share…', 'hs-btn is-primary', () => {
      if (!blob) return;
      const file = new File([blob], 'hundred-stories-tower.png', { type: 'image/png' });
      const canShareFiles = navigator.canShare?.({ files: [file] }) ?? false;
      const payload = canShareFiles
        ? { title: 'Hundred Stories', text, url, files: [file] }
        : { title: 'Hundred Stories', text, url };
      navigator.share!(payload).catch((error: unknown) => {
        if ((error as { name?: string } | null)?.name === 'AbortError') return;
        ctx.notice('Sharing did not work here. Save the image and copy the message instead.');
      });
    });
    sendButton.disabled = true;
  }

  if (sendButton) shareActions.append(sendButton);
  shareActions.append(saveButton, copyButton);

  try {
    const source = renderer.snapshot();
    const composed = composeShareImage(source, stats);
    composed.toBlob((result) => {
      if (!result) {
        ctx.notice('Could not take a picture of the tower.');
        return;
      }
      blob = result;
      previewUrl = URL.createObjectURL(result);
      const img = el('img', 'hs-share-image');
      img.src = previewUrl;
      img.alt = 'A preview of your tower';
      preview.replaceChildren(img);
      saveButton.disabled = false;
      if (sendButton) sendButton.disabled = false;
    }, 'image/png');
  } catch {
    ctx.notice('Could not take a picture of the tower.');
  }

  const removeSelf = panel.remove.bind(panel);
  panel.remove = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    removeSelf();
  };

  return panel;
}

/**
 * The web and phone import: a file input (the system picker in both native shells), kept out of
 * sight and out of the Tab order. The Open a saved file row clicks it.
 */
function importFileInput(game: GameApi, ctx: PanelContext): HTMLInputElement {
  const file = el('input');
  file.type = 'file';
  file.accept = 'application/json,.json';
  file.className = 'hs-file';
  file.hidden = true;
  file.setAttribute('tabindex', '-1');
  file.setAttribute('aria-label', 'Open a saved file');
  file.addEventListener('change', () => {
    const chosen = file.files && file.files.length > 0 ? file.files[0] : null;
    if (!chosen) return;
    void chosen
      .text()
      .then((text) => {
        const result = game.importSave(text);
        ctx.notice(result.ok ? 'Tower opened.' : result.reason);
      })
      .catch(() => ctx.notice('That file could not be read.'))
      .finally(() => {
        file.value = '';
      });
  });
  file.id = 'hs-import';
  return file;
}

/**
 * Export by platform (storage.ts decides which): the desktop save dialog, the phone share sheet,
 * or the browser download. A cancelled dialog or share sheet says nothing.
 */
function exportSave(text: string, ctx: PanelContext): void {
  const platform = savePlatform();
  if (platform === 'tauri') {
    void exportSaveWithDialog(text)
      .then((written) => {
        if (written) ctx.notice('Saved to a file.');
      })
      .catch(() => ctx.notice('The tower could not be saved to a file.'));
  } else if (platform === 'capacitor') {
    void shareSave(text)
      .then(() => ctx.notice('Saved to a file.'))
      .catch((err: unknown) => {
        // The Share plugin rejects with "Share canceled" when the player dismisses the sheet.
        if (/cancel/i.test(String((err as { message?: unknown } | null)?.message ?? err))) return;
        ctx.notice('The tower could not be saved to a file.');
      });
  } else {
    downloadSave(text, ctx);
  }
}

function downloadSave(text: string, ctx: PanelContext): void {
  try {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a');
    link.href = url;
    link.download = 'hundred-stories.json';
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    ctx.notice('Saved to a file.');
  } catch {
    ctx.notice('The tower could not be saved to a file.');
  }
}

export { SIM_KINDS };
