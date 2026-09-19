// Panel builders. Each one returns a detached element that the shell in ui.ts mounts.
// Panels read the world through GameApi only and never reach into the sim modules.

import type { GameApi } from '../game/api';
import { applyTheme, cycleTheme, readTheme, themeLabel } from '../site/theme';
import { EVAL, LIMITS, ROOMS, SHAFTS } from '../sim/rules';
import type {
  Command,
  CommandResult,
  Id,
  Room,
  RoomKind,
  Shaft,
  ShaftKind,
  Sim,
  SimKind,
} from '../sim/types';
import {
  formatCount,
  formatEval,
  formatFloor,
  formatFloorRange,
  formatMoney,
  formatPercent,
  formatSignedMoney,
  formatTimestamp,
  stressBandLabel,
  stressBandOf,
} from './format';

/** A panel element may expose a cheap refresh that rewrites live numbers without rebuilding. */
export type PanelElement = HTMLDivElement & { refresh?: () => void };

export interface PanelContext {
  /** Applies a command, reports the reason when it is refused, and marks the panels dirty. */
  apply(cmd: Command): CommandResult;
  /** Shows a short message to the player. */
  notice(text: string): void;
  /** Closes the panel. */
  close(): void;
  reducedMotion: boolean;
  setReducedMotion(on: boolean): void;
}

export type Selection = { roomId?: Id; simId?: Id; shaftId?: Id };

/** The same lines as the guide, for the player who looks in the menu instead. */
const CONTROL_LINES: readonly string[] = [
  'Move around: drag anywhere with the mouse, even with most build tools selected. The lobby and elevator tools drag to size, so pan with the right button, scroll, or keys while they are active. Scroll the wheel to move up and down, hold shift to move sideways. On a trackpad, two-finger scroll moves the view.',
  'Zoom: hold ctrl and scroll, or pinch on a trackpad. Plus and minus keys also zoom.',
  'Keys: W A S D or the arrow keys move the view.',
  'Touch: one finger moves the view, pinch zooms, tap places, two fingers drag to pan while sizing a lobby or an elevator.',
  'Place a room: pick it from the palette, then click where it goes. A click that does not move places; a press that moves pans.',
  'Speed: 1, 2, 3 set the clock speed, space pauses.',
  'Escape drops the current tool.',
];

const SIM_KINDS: Record<SimKind, string> = {
  worker: 'Worker',
  resident: 'Resident',
  guest: 'Hotel guest',
  shopper: 'Shopper',
  diner: 'Diner',
  staff: 'Housekeeper',
  visitor: 'Visitor',
  vip: 'VIP',
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

function row(label: string, value: string): HTMLDivElement {
  const node = el('div', 'hs-row');
  node.append(el('span', 'hs-row-label', label), el('span', 'hs-row-value', value));
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

function shell(title: string, ctx: PanelContext): { panel: PanelElement; body: HTMLDivElement } {
  const panel = el('div', 'hs-panel') as PanelElement;
  const head = el('div', 'hs-panel-head');
  head.append(el('h2', 'hs-panel-title', title), button('Close', 'hs-btn', () => ctx.close()));
  const body = el('div', 'hs-panel-body');
  panel.append(head, body);
  return { panel, body };
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

  const { panel, body } = shell('Nothing selected', ctx);
  body.append(el('p', 'hs-note', 'That part of the tower is gone.'));
  return panel;
}

function roomPanel(roomId: Id, game: GameApi, ctx: PanelContext): PanelElement {
  const room = game.world.rooms.get(roomId) as Room;
  const rule = ROOMS[room.kind];
  const { panel, body } = shell(rule.label, ctx);

  const where =
    room.height > 1
      ? formatFloorRange(room.floor, room.floor + room.height - 1)
      : formatFloor(room.floor);
  body.append(el('p', 'hs-note', where));

  const evaluation = section('Evaluation');
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

  const flags = el('div', 'hs-section');
  body.append(flags);

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
    const wanted: HTMLSpanElement[] = [];
    if (room.vacant) wanted.push(flag('Vacant'));
    if (room.dirty) wanted.push(flag('Needs cleaning'));
    if (room.infested) wanted.push(flag('Cockroaches', true));
    if (room.onFire) wanted.push(flag('On fire', true));
    const next = wanted.map((f) => f.textContent).join('|');
    if (flags.dataset['flags'] !== next) {
      flags.dataset['flags'] = next;
      flags.replaceChildren(...wanted);
    }
  };
  refresh();
  panel.refresh = refresh;
  return panel;
}

function simPanel(simId: Id, game: GameApi, ctx: PanelContext): PanelElement {
  const sim = game.world.sims.get(simId) as Sim;
  const { panel, body } = shell(SIM_KINDS[sim.kind], ctx);
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
  const { panel, body } = shell(rule.label, ctx);
  body.append(el('p', 'hs-note', formatFloorRange(shaft.floorMin, shaft.floorMax)));

  const cars = row('Cars', `${formatCount(shaft.cars.length)} of ${formatCount(rule.maxCars)}`);
  const riders = row('Riders', formatCount(shaft.cars.reduce((n, c) => n + c.passengers.length, 0)));
  body.append(cars, riders);

  const actions = el('div', 'hs-actions');
  const add = button('Add car', 'hs-btn', () => {
    ctx.apply({ kind: 'shaft.addCar', shaftId: shaft.id });
  });
  const remove = button('Remove car', 'hs-btn', () => {
    ctx.apply({ kind: 'shaft.removeCar', shaftId: shaft.id });
  });
  actions.append(add, remove);
  body.append(actions);

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

  const refresh = (): void => {
    const shaft = game.world.shafts.get(shaftId);
    if (!shaft) return;
    setRowValue(cars, `${formatCount(shaft.cars.length)} of ${formatCount(rule.maxCars)}`);
    setRowValue(riders, formatCount(shaft.cars.reduce((n, c) => n + c.passengers.length, 0)));
    add.disabled = shaft.cars.length >= rule.maxCars;
    remove.disabled = shaft.cars.length <= 1;
    for (const stop of stopButtons) {
      stop.node.setAttribute('aria-pressed', shaft.stops.has(stop.floor) ? 'true' : 'false');
    }
  };
  refresh();
  panel.refresh = refresh;
  return panel;
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

function setRowValue(node: HTMLElement, text: string): void {
  const value = node.lastElementChild;
  if (value && value.textContent !== text) value.textContent = text;
}

// --------------------------------------------------------- finances panel

export function createFinancesPanel(game: GameApi, ctx: PanelContext): PanelElement {
  const { panel, body } = shell('Finances', ctx);
  const stats = game.world.stats;
  const lastQuarter = (): { income: number; upkeep: number; net: number } =>
    game.world.stats.lastQuarter;

  const last = section('Last quarter');
  const income = row('Income', formatMoney(stats.lastQuarter.income));
  const upkeep = row('Upkeep', formatMoney(stats.lastQuarter.upkeep));
  const net = row('Net', formatSignedMoney(stats.lastQuarter.net));
  last.append(income, upkeep, net);
  body.append(last);

  const cash = section('Now');
  const cashRow = row('Cash', formatMoney(game.world.cash));
  cash.append(cashRow);
  body.append(cash);

  const incomeSection = section('Income this quarter so far');
  const incomeList = el('div', 'hs-list');
  incomeSection.append(incomeList);
  const upkeepSection = section('Upkeep this quarter so far');
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
      ...entries.map(([kind, value]) => row(kindLabel(kind as RoomKind | ShaftKind), formatMoney(value))),
    );
  };

  const refresh = (): void => {
    setRowValue(income, formatMoney(lastQuarter().income));
    setRowValue(upkeep, formatMoney(lastQuarter().upkeep));
    setRowValue(net, formatSignedMoney(lastQuarter().net));
    setRowValue(cashRow, formatMoney(game.world.cash));
    fillList(incomeList, game.world.stats.incomeByKind);
    fillList(upkeepList, game.world.stats.upkeepByKind);
  };
  refresh();
  panel.refresh = refresh;
  return panel;
}

// -------------------------------------------------------------- log panel

export function createLogPanel(game: GameApi, ctx: PanelContext): PanelElement {
  const { panel, body } = shell('Event log', ctx);
  const list = el('ul', 'hs-log-list');
  body.append(list);

  let shown = -1;
  const refresh = (): void => {
    const log = game.world.log;
    if (shown === log.length) return;
    shown = log.length;
    const items = log
      .slice(-200)
      .reverse()
      .map((entry) => {
        const item = el('li', `hs-log-item is-${entry.level}`);
        item.append(
          el('span', 'hs-log-time', formatTimestamp(entry.minute)),
          el('span', 'hs-log-text', entry.text),
        );
        return item;
      });
    if (items.length === 0) {
      list.replaceChildren(el('li', 'hs-log-item', 'Nothing has happened yet.'));
      return;
    }
    list.replaceChildren(...items);
  };
  refresh();
  panel.refresh = refresh;
  return panel;
}

// --------------------------------------------------------- settings panel

export function createSettingsPanel(game: GameApi, ctx: PanelContext): PanelElement {
  const { panel, body } = shell('Settings', ctx);

  const controls = section('Controls');
  for (const line of CONTROL_LINES) controls.append(el('p', 'hs-note', line));
  body.append(controls);

  const saves = el('div', 'hs-actions');
  saves.append(
    button('Save', 'hs-btn', () => {
      void game.save().then((result) => {
        ctx.notice(result.ok ? 'Game saved.' : result.reason);
      });
    }),
    button('Load', 'hs-btn', () => {
      void game.load().then((result) => {
        ctx.notice(result.ok ? 'Game loaded.' : result.reason);
      });
    }),
    button('Export', 'hs-btn', () => {
      downloadSave(game.exportSave(), ctx);
    }),
  );
  body.append(section('Saved games'), saves);

  const file = el('input');
  file.type = 'file';
  file.accept = 'application/json,.json';
  file.className = 'hs-file';
  file.setAttribute('aria-label', 'Import a saved game file');
  file.addEventListener('change', () => {
    const chosen = file.files && file.files.length > 0 ? file.files[0] : null;
    if (!chosen) return;
    void chosen
      .text()
      .then((text) => {
        const result = game.importSave(text);
        ctx.notice(result.ok ? 'Game imported.' : result.reason);
      })
      .catch(() => ctx.notice('That file could not be read.'))
      .finally(() => {
        file.value = '';
      });
  });
  file.id = 'hs-import';
  const importField = el('div', 'hs-field');
  const importLabel = el('label', 'hs-row-label', 'Import');
  importLabel.htmlFor = file.id;
  importField.append(importLabel, file);
  body.append(importField);

  const seedField = el('div', 'hs-field');
  const seedLabel = el('label', 'hs-row-label', 'Seed');
  const seed = el('input');
  seed.type = 'number';
  seed.id = 'hs-seed';
  seed.value = String(game.world.seed);
  seedLabel.htmlFor = seed.id;
  seedField.append(seedLabel, seed);
  const newGame = el('div', 'hs-actions');
  newGame.append(
    button('New game', 'hs-btn', () => {
      const value = Number(seed.value);
      if (!Number.isFinite(value)) {
        ctx.notice('Enter a whole number for the seed.');
        return;
      }
      game.newGame(Math.trunc(value));
      ctx.notice('New game started.');
    }),
  );
  body.append(section('New game'), seedField, newGame);

  const motion = section('Display');
  const motionField = el('div', 'hs-field');
  const motionBox = el('input');
  motionBox.type = 'checkbox';
  motionBox.id = 'hs-reduced-motion';
  motionBox.checked = ctx.reducedMotion;
  motionBox.addEventListener('change', () => {
    ctx.setReducedMotion(motionBox.checked);
  });
  const motionLabel = el('label', 'hs-row-label', 'Reduced motion');
  motionLabel.htmlFor = motionBox.id;
  motionField.append(motionBox, motionLabel);
  motion.append(motionField);

  let theme = readTheme();
  const themeField = el('div', 'hs-field');
  const themeLabelEl = el('span', 'hs-row-label', 'Theme');
  const themeButton = button(themeLabel(theme), 'hs-btn', () => {
    theme = cycleTheme(theme);
    applyTheme(theme);
    themeButton.textContent = themeLabel(theme);
  });
  themeField.append(themeLabelEl, themeButton);
  motion.append(themeField);

  body.append(motion);

  return panel;
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
    ctx.notice('Save exported.');
  } catch {
    ctx.notice('The save could not be exported.');
  }
}

export { SIM_KINDS };
