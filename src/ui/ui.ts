// The chrome around the tower: top strip, directory board palette, query panel,
// finances, log, settings, ticker and toasts. It talks to the game through GameApi only.
// Nothing here touches the document until createUi runs, so the module imports cleanly in tests.

import './ui.css';

import type { GameApi, Speed, Tool } from '../game/api';
import { ROOMS, SHAFTS } from '../sim/rules';
import type { Command, LogEntry, RoomKind, ShaftKind, Star } from '../sim/types';
import {
  formatClock,
  formatCount,
  formatDate,
  formatFloorShort,
  formatMoney,
  formatTimestamp,
  starsGlyphs,
  starsTitle,
} from './format';
import {
  button,
  createFinancesPanel,
  createLogPanel,
  createQueryPanel,
  createSettingsPanel,
  el,
} from './panels';
import type { PanelContext, PanelElement } from './panels';

export interface Ui {
  destroy(): void;
  update(): void;
}

type PanelKind = 'none' | 'finances' | 'log' | 'settings';

interface PaletteRow {
  node: HTMLButtonElement;
  cost: HTMLSpanElement;
  tool: Tool;
  star: Star;
  costText: string;
}

const FONT_LINK_ID = 'hs-google-fonts';
const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600&family=Share+Tech+Mono&display=swap';
const REDUCED_MOTION_KEY = 'hundredStories.reducedMotion';
const HINT_KEY = 'hs.hintSeen';
/** The controls hint rides along for the first three loads, then gets out of the way. */
const HINT_LOADS = 3;
const HINT_TEXT = 'Move: drag, scroll, or W A S D. Zoom: ctrl + scroll or pinch. Click to place.';

const GROUPS: { title: string; source: 'rooms' | 'shafts' | 'tools'; group?: string }[] = [
  { title: 'Structure', source: 'rooms', group: 'structure' },
  { title: 'Elevators', source: 'shafts' },
  { title: 'Residential', source: 'rooms', group: 'residential' },
  { title: 'Hotel', source: 'rooms', group: 'hotel' },
  { title: 'Commercial', source: 'rooms', group: 'commercial' },
  { title: 'Services', source: 'rooms', group: 'services' },
  { title: 'Tools', source: 'tools' },
];

/**
 * Should this load show the controls hint, and what does the counter become?
 *
 * A missing, unreadable or nonsense counter counts as nothing seen, so the hint shows: a
 * player who cannot find the controls is worse off than one who sees the line again.
 */
export function nextHintSeen(stored: string | null): { show: boolean; seen: number } {
  const parsed = Number(stored);
  const seen = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  return { show: seen < HINT_LOADS, seen: Math.min(seen + 1, HINT_LOADS) };
}

export function createUi(root: HTMLElement, game: GameApi): Ui {
  ensureFonts();

  let reducedMotion = readReducedMotion();
  let panelKind: PanelKind = 'none';
  let mountedPanel: PanelElement | null = null;
  let mountedKey = '';
  let lastLogLength = 0;
  let destroyed = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const shell = el('div', 'hs-ui');
  const top = el('header', 'hs-top');
  const readouts = el('div', 'hs-readouts');
  const actions = el('div', 'hs-top-actions');
  top.append(readouts, actions);

  // Readouts: segmented indicator faces, the one place the mono readout type appears.
  const cashValue = el('span', 'hs-readout-value');
  const cashButton = button('', 'hs-readout', () => setPanel(panelKind === 'finances' ? 'none' : 'finances'));
  cashButton.replaceChildren(el('span', 'hs-readout-label', 'Cash'), cashValue);
  cashButton.title = 'Open finances';

  const popValue = el('span', 'hs-readout-value');
  const popReadout = el('div', 'hs-readout');
  popReadout.append(el('span', 'hs-readout-label', 'Population'), popValue);

  const starsValue = el('span', 'hs-readout-value hs-stars');
  const starsReadout = el('div', 'hs-readout');
  starsReadout.append(el('span', 'hs-readout-label', 'Stars'), starsValue);

  const clockValue = el('span', 'hs-readout-value');
  const dateValue = el('span', 'hs-readout-sub');
  const clockReadout = el('div', 'hs-readout');
  clockReadout.append(clockValue, dateValue);

  const hoverValue = el('span', 'hs-readout-value');
  const hoverReadout = el('div', 'hs-readout is-hidden');
  hoverReadout.title = 'Floor under the cursor';
  hoverReadout.append(hoverValue);

  readouts.append(cashButton, popReadout, starsReadout, clockReadout, hoverReadout);

  const speedBar = el('div', 'hs-speed');
  speedBar.setAttribute('role', 'group');
  speedBar.setAttribute('aria-label', 'Speed');
  const speedButtons: { node: HTMLButtonElement; speed: Speed }[] = (
    [
      ['Pause', 0],
      ['1x', 1],
      ['2x', 2],
      ['4x', 4],
    ] as [string, Speed][]
  ).map(([label, speed]) => {
    const node = button(label, 'hs-btn', () => {
      game.setSpeed(speed);
      update();
    });
    speedBar.append(node);
    return { node, speed };
  });

  const menuButton = button('Menu', 'hs-btn', () =>
    setPanel(panelKind === 'settings' ? 'none' : 'settings'),
  );
  actions.append(speedBar, menuButton);

  // Palette: a building directory board.
  const palette = el('nav', 'hs-palette');
  palette.setAttribute('aria-label', 'Build palette');
  const rows: PaletteRow[] = buildPalette(palette, (tool) => {
    game.setTool(sameTool(tool, game.getTool()) ? { kind: 'none' } : tool);
    update();
  });

  const panelSlot = el('div', 'hs-panel-slot');

  const ticker = el('button', 'hs-ticker');
  ticker.type = 'button';
  ticker.title = 'Open the event log';
  const tickerTime = el('span', 'hs-ticker-time');
  const tickerText = el('span', 'hs-ticker-text', 'Welcome to your tower.');
  ticker.append(tickerTime, tickerText);
  ticker.addEventListener('click', () => setPanel(panelKind === 'log' ? 'none' : 'log'));

  // Controls hint: one line over the view, for the first few loads only.
  const hint = el('div', 'hs-hint');
  hint.append(el('span', 'hs-hint-text', HINT_TEXT));
  const hintClose = button('Close', 'hs-hint-close', () => {
    hint.classList.add('is-hidden');
    writeHintSeen(HINT_LOADS); // closing it means read, not just shown
  });
  hintClose.title = 'Hide the controls hint';
  hint.append(hintClose);
  const hintState = nextHintSeen(readHintSeen());
  if (hintState.show) writeHintSeen(hintState.seen);
  else hint.classList.add('is-hidden');

  const toasts = el('div', 'hs-toasts');
  toasts.setAttribute('role', 'status');
  toasts.setAttribute('aria-live', 'polite');

  shell.append(top, palette, hint, panelSlot, ticker, toasts);
  root.append(shell);

  const ctx: PanelContext = {
    apply(cmd: Command) {
      const result = game.apply(cmd);
      if (!result.ok) notice(result.reason);
      mountedKey = '';
      update();
      return result;
    },
    notice,
    close() {
      if (panelKind !== 'none') setPanel('none');
      else game.select(null);
      update();
    },
    get reducedMotion() {
      return reducedMotion;
    },
    setReducedMotion(on: boolean) {
      applyReducedMotion(on);
    },
  };

  applyReducedMotion(reducedMotion);
  lastLogLength = game.world.log.length;
  const unsubscribe = game.subscribe(() => update());
  window.addEventListener('keydown', onKeyDown);
  update();

  function update(): void {
    if (destroyed) return;
    const world = game.world;

    setText(cashValue, formatMoney(world.cash));
    setText(popValue, formatCount(world.population));
    setText(starsValue, starsGlyphs(world.stars));
    const title = starsTitle(world.stars);
    if (starsReadout.title !== title) {
      starsReadout.title = title;
      starsValue.setAttribute('aria-label', title);
    }
    setText(clockValue, formatClock(world.time.minute));
    setText(dateValue, formatDate(world.time.minute));

    const hover = game.getHover();
    hoverReadout.classList.toggle('is-hidden', hover === null);
    if (hover) setText(hoverValue, formatFloorShort(hover.floor));

    const speed = game.getSpeed();
    for (const entry of speedButtons) {
      setPressed(entry.node, entry.speed === speed);
    }

    const tool = game.getTool();
    for (const row of rows) {
      const locked = world.stars < row.star;
      if (row.node.disabled !== locked) row.node.disabled = locked;
      row.node.classList.toggle('is-locked', locked);
      setText(row.cost, locked ? needsStars(row.star) : row.costText);
      const active = !locked && sameTool(row.tool, tool);
      row.node.classList.toggle('is-active', active);
      setPressed(row.node, active);
    }

    refreshPanel();
    refreshTicker();
    drainAlerts();
  }

  function refreshPanel(): void {
    const selection = game.getSelection();
    const key =
      panelKind !== 'none'
        ? `panel:${panelKind}`
        : selection
          ? `query:${selection.roomId ?? ''}:${selection.simId ?? ''}:${selection.shaftId ?? ''}:${
              selectionExists(selection) ? '1' : '0'
            }`
          : '';

    if (key === mountedKey) {
      mountedPanel?.refresh?.();
      return;
    }
    mountedKey = key;
    mountedPanel?.remove();
    mountedPanel = null;
    shell.classList.toggle('is-panel-open', key !== '');
    if (key === '') return;

    const panel =
      panelKind === 'finances'
        ? createFinancesPanel(game, ctx)
        : panelKind === 'log'
          ? createLogPanel(game, ctx)
          : panelKind === 'settings'
            ? createSettingsPanel(game, ctx)
            : createQueryPanel(game, selection ?? {}, ctx);

    mountedPanel = panel;
    panelSlot.append(panel);
    if (!reducedMotion) {
      panel.classList.add('is-entering');
      window.requestAnimationFrame(() => panel.classList.remove('is-entering'));
    }
  }

  /** A demolished room or a sim that went home rebuilds the panel instead of showing stale numbers. */
  function selectionExists(selection: { roomId?: number; simId?: number; shaftId?: number }): boolean {
    const world = game.world;
    if (selection.roomId !== undefined) return world.rooms.has(selection.roomId);
    if (selection.shaftId !== undefined) return world.shafts.has(selection.shaftId);
    if (selection.simId !== undefined) return world.sims.has(selection.simId);
    return false;
  }

  function refreshTicker(): void {
    const log = game.world.log;
    const newest = log.length > 0 ? log[log.length - 1] : undefined;
    if (!newest) return;
    setText(tickerTime, formatTimestamp(newest.minute));
    setText(tickerText, newest.text);
    ticker.classList.toggle('is-alert', newest.level === 'alert');
  }

  /** Every unseen alert line becomes a toast, with the command button that alert needs. */
  function drainAlerts(): void {
    const log = game.world.log;
    if (log.length < lastLogLength) lastLogLength = 0;
    for (let i = lastLogLength; i < log.length; i += 1) {
      const entry = log[i];
      if (entry && entry.level === 'alert') showAlert(entry);
    }
    lastLogLength = log.length;
  }

  function showAlert(entry: LogEntry): void {
    const toast = el('div', 'hs-toast');
    toast.append(el('p', 'hs-toast-text', entry.text));
    const row = el('div', 'hs-actions');
    const command = commandFor(entry);
    if (command) {
      row.append(
        button(command.label, 'hs-btn', () => {
          const result = ctx.apply(command.cmd);
          if (result.ok) toast.remove();
        }),
      );
    }
    row.append(button('Dismiss', 'hs-btn', () => toast.remove()));
    toast.append(row);
    toasts.append(toast);
    if (!command) dismissLater(toast, 8000);
  }

  /** Alerts that need a decision: the bomb ransom and the fire helicopter. */
  function commandFor(entry: LogEntry): { label: string; cmd: Command } | null {
    const text = entry.text.toLowerCase();
    const events = game.world.events;
    const hasBomb = events.some((event) => event.kind === 'bomb' && !event.found);
    const hasFire = events.some((event) => event.kind === 'fire');
    if (hasBomb && (text.includes('bomb') || text.includes('ransom'))) {
      return { label: 'Pay ransom', cmd: { kind: 'bomb.pay' } };
    }
    if (hasFire && (text.includes('fire') || text.includes('helicopter'))) {
      return { label: 'Call helicopter', cmd: { kind: 'fire.callHelicopter' } };
    }
    if (hasBomb) return { label: 'Pay ransom', cmd: { kind: 'bomb.pay' } };
    if (hasFire) return { label: 'Call helicopter', cmd: { kind: 'fire.callHelicopter' } };
    return null;
  }

  function notice(text: string): void {
    const toast = el('div', 'hs-toast is-notice');
    toast.append(el('p', 'hs-toast-text', text));
    const row = el('div', 'hs-actions');
    row.append(button('Dismiss', 'hs-btn', () => toast.remove()));
    toast.append(row);
    toasts.append(toast);
    dismissLater(toast, 6000);
  }

  function dismissLater(toast: HTMLElement, ms: number): void {
    const timer = setTimeout(() => {
      timers.delete(timer);
      toast.remove();
    }, ms);
    timers.add(timer);
  }

  function setPanel(kind: PanelKind): void {
    panelKind = kind;
    update();
  }

  function applyReducedMotion(on: boolean): void {
    reducedMotion = on;
    shell.classList.toggle('is-reduced', on);
    game.setReducedMotion(on);
    writeReducedMotion(on);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTyping(event.target)) return;
    if (event.key === ' ' || event.code === 'Space') {
      event.preventDefault();
      game.togglePause();
      update();
      return;
    }
    if (event.key === '1' || event.key === '2' || event.key === '3') {
      const speed: Speed = event.key === '1' ? 1 : event.key === '2' ? 2 : 4;
      game.setSpeed(speed);
      update();
      return;
    }
    if (event.key === 'Escape') {
      game.setTool({ kind: 'none' });
      update();
    }
  }

  return {
    update,
    destroy() {
      destroyed = true;
      unsubscribe();
      window.removeEventListener('keydown', onKeyDown);
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      mountedPanel?.remove();
      mountedPanel = null;
      shell.remove();
    },
  };
}

// ------------------------------------------------------------------ parts

function buildPalette(palette: HTMLElement, onPick: (tool: Tool) => void): PaletteRow[] {
  const rows: PaletteRow[] = [];
  for (const group of GROUPS) {
    palette.append(el('h2', 'hs-group-title', group.title));
    if (group.source === 'rooms') {
      for (const kind of Object.keys(ROOMS) as RoomKind[]) {
        const rule = ROOMS[kind];
        if (rule.group !== group.group) continue;
        rows.push(
          addRow(palette, rule.label, formatMoney(rule.cost), rule.star, { kind: 'room', room: kind }, onPick),
        );
      }
    } else if (group.source === 'shafts') {
      for (const kind of Object.keys(SHAFTS) as ShaftKind[]) {
        const rule = SHAFTS[kind];
        rows.push(
          addRow(palette, rule.label, formatMoney(rule.shaftCost), rule.star, { kind: 'shaft', shaft: kind }, onPick),
        );
      }
    } else {
      rows.push(addRow(palette, 'Demolish', '', 1, { kind: 'demolish' }, onPick));
      rows.push(addRow(palette, 'Query', '', 1, { kind: 'query' }, onPick));
    }
  }
  return rows;
}

function addRow(
  palette: HTMLElement,
  label: string,
  costText: string,
  star: Star,
  tool: Tool,
  onPick: (tool: Tool) => void,
): PaletteRow {
  const node = button('', 'hs-tool', () => onPick(tool));
  const cost = el('span', 'hs-tool-cost', costText);
  node.title = label;
  node.replaceChildren(el('span', 'hs-tool-label', label), cost);
  node.setAttribute('aria-pressed', 'false');
  palette.append(node);
  return { node, cost, tool, star, costText };
}

function needsStars(star: Star): string {
  return star === 1 ? 'Needs 1 star' : `Needs ${star} stars`;
}

function sameTool(a: Tool, b: Tool): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'room' && b.kind === 'room') return a.room === b.room;
  if (a.kind === 'shaft' && b.kind === 'shaft') return a.shaft === b.shaft;
  return true;
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function setPressed(node: HTMLElement, pressed: boolean): void {
  const value = pressed ? 'true' : 'false';
  if (node.getAttribute('aria-pressed') !== value) node.setAttribute('aria-pressed', value);
}

function isTyping(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node || !node.tagName) return false;
  return (
    node.tagName === 'INPUT' ||
    node.tagName === 'TEXTAREA' ||
    node.tagName === 'SELECT' ||
    node.isContentEditable === true
  );
}

function ensureFonts(): void {
  if (document.getElementById(FONT_LINK_ID)) return;
  const link = document.createElement('link');
  link.id = FONT_LINK_ID;
  link.rel = 'stylesheet';
  link.href = FONT_HREF;
  document.head.append(link);
}

function readReducedMotion(): boolean {
  try {
    const stored = window.localStorage.getItem(REDUCED_MOTION_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch {
    // Private browsing or a blocked store: fall back to the system preference.
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function readHintSeen(): string | null {
  try {
    return window.localStorage.getItem(HINT_KEY);
  } catch {
    return null; // a blocked store means the hint shows again, which is the safe way to fail
  }
}

function writeHintSeen(count: number): void {
  try {
    window.localStorage.setItem(HINT_KEY, String(count));
  } catch {
    // Nothing to do: the hint stays for this session only.
  }
}

function writeReducedMotion(on: boolean): void {
  try {
    window.localStorage.setItem(REDUCED_MOTION_KEY, on ? 'true' : 'false');
  } catch {
    // Nothing to do: the setting stays for this session only.
  }
}
