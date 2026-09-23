// The chrome around the tower: top strip, directory board palette, query panel,
// finances, log, settings, ticker and toasts. It talks to the game through GameApi only.
// Nothing here touches the document until createUi runs, so the module imports cleanly in tests.

import './ui.css';

import { createSound } from '../audio/audio';
import type { GameApi, Placement, Speed, Tool } from '../game/api';
import type { Renderer } from '../render/renderer';
import type { Command, LogEntry } from '../sim/types';
import { formatFloorShort, formatMoney, formatTimestamp } from './format';
import { createIconSheet } from './icons';
import { chromeInsets, isSheetLayout, placementBoxes } from './layout';
import type { Box } from './layout';
import {
  button,
  createFinancesPanel,
  createLogPanel,
  createQueryPanel,
  createSettingsPanel,
  createSharePanel,
  el,
} from './panels';
import type { PanelContext, PanelElement } from './panels';
import { applyRowState, buildPalette, paintThumbnail, sameTool, toolRowState } from './palette';
import type { PaletteRow } from './palette';
import { createStatusBar } from './status';

export interface Ui {
  destroy(): void;
  update(): void;
}

type PanelKind = 'none' | 'finances' | 'log' | 'settings' | 'share';

/** The live measurement of the chrome: stop it, or ask it to measure again. */
interface ChromeWatch {
  measure(): void;
  disconnect(): void;
}

const FONT_LINK_ID = 'hs-google-fonts';
const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600&family=Share+Tech+Mono&display=swap';
const REDUCED_MOTION_KEY = 'hundredStories.reducedMotion';
const PALETTE_COLLAPSED_KEY = 'hs.palette.collapsed';
const HINT_KEY = 'hs.hintSeen';
/** The controls hint rides along for the first three loads, then gets out of the way. */
const HINT_LOADS = 3;
const HINT_TEXT = 'Move: drag, scroll, or W A S D. Zoom: ctrl + scroll or pinch. Click to place.';
/** A phone has no wheel, no keys and no cursor, so it gets the three gestures it does have. */
const TOUCH_HINT_TEXT = 'Move: one finger. Zoom: pinch. Tap to place.';

/** The hint speaks to the pointer in the room: a finger is told about fingers. */
export function hintText(coarsePointer: boolean): string {
  return coarsePointer ? TOUCH_HINT_TEXT : HINT_TEXT;
}

/**
 * The line over the outline: what is being placed and what it costs, or why it cannot go there.
 *
 * A placement the sim refuses says so in the sim's own words, which is the sentence the log
 * would have shown after the money was gone.
 */
export function placementChipText(placement: Placement): string {
  // Stretching an elevator costs nothing: the shaft's price covered every floor it can serve.
  if (placement.ok) return `${placement.label} \u00b7 ${placement.cost === 0 ? 'Free' : formatMoney(placement.cost)}`;
  return placement.reason ?? 'That spot will not take it.';
}

/**
 * What the up and down arrows do, which depends on what is in hand.
 *
 * A room is the size its rule says, so its arrows move it. An elevator is as tall as the
 * player wants, so its arrows stretch the end they point at.
 */
export function placementArrowLabels(shaft: boolean): { up: string; down: string } {
  return shaft
    ? { up: 'Extend the top one floor', down: 'Extend the bottom one floor' }
    : { up: 'Move up one floor', down: 'Move down one floor' };
}

/** The Build button's own words: the price when it can be built, the refusal when it cannot. */
export function placementBuildLabels(placement: Placement): { text: string; title: string } {
  const extending = placement.shaftId !== undefined;
  return {
    text: extending ? 'Extend' : `Build ${formatMoney(placement.cost)}`,
    title: placement.ok ? (extending ? 'Stretch this elevator' : 'Build it here') : placementChipText(placement),
  };
}

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

export function createUi(root: HTMLElement, game: GameApi, renderer: Renderer): Ui {
  ensureFonts();

  let reducedMotion = readReducedMotion();
  // Sound is off by default and builds nothing until the player turns it on and touches the page.
  const sound = createSound(game);
  let panelKind: PanelKind = 'none';
  let mountedPanel: PanelElement | null = null;
  let mountedKey = '';
  let lastLogTotal = 0;
  let destroyed = false;
  /** The band the chrome covers, so the chip and the bar stay out from under it. */
  let chromeBand = { top: 0, bottom: 0 };
  /** The frame loop that follows the ghost. It only runs while there is a ghost to follow. */
  let placementRaf = 0;
  /**
   * The sizes the chip and the bar are placed with, measured once and kept. Reading them is a
   * forced layout, so they are measured again only after something that can change them: new
   * words on the chip or the bar, either one shown or hidden, a resize, a font arriving. null
   * means measure before the next use. A pan or a zoom moves the ghost, not these, and the
   * ghost's rect is the renderer's own arithmetic, so following it measures nothing.
   */
  let viewSize: Box | null = null;
  let chipSize: Box | null = null;
  let barSize: Box | null = null;
  /** Where the chip and the bar were last put, so an unchanged frame writes no styles. */
  let placedKey = '';
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const shell = el('div', 'hs-ui');
  // The icon symbols, once for the whole chrome; every icon() refers to them by id.
  shell.append(createIconSheet() as unknown as HTMLElement);
  const top = el('header', 'hs-top');
  // Status bar, left to right: cash, population, stars, then the clock, then speed and menu.
  // On a phone the first group is the first row and the clock and controls the second.
  const readouts = el('div', 'hs-readouts');
  const clockGroup = el('div', 'hs-clock-group');
  const actions = el('div', 'hs-top-actions');
  top.append(readouts, clockGroup, actions);

  // Readouts: segmented indicator faces, the one place the mono readout type appears.
  const status = createStatusBar();
  status.cash.addEventListener('click', () => setPanel(panelKind === 'finances' ? 'none' : 'finances'));

  const hoverValue = el('span', 'hs-readout-value');
  const hoverReadout = el('div', 'hs-readout hs-status-hover is-hidden');
  hoverReadout.title = 'Floor under the cursor';
  hoverReadout.append(el('span', 'hs-readout-label', 'Cursor'), hoverValue);

  readouts.append(status.cash, status.population, status.stars);
  clockGroup.append(status.clock, hoverReadout);

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

  const shareButton = button('Share', 'hs-btn', () =>
    setPanel(panelKind === 'share' ? 'none' : 'share'),
  );
  const menuButton = button('Menu', 'hs-btn', () =>
    setPanel(panelKind === 'settings' ? 'none' : 'settings'),
  );
  actions.append(status.mode, speedBar, shareButton, menuButton);

  // Palette: a building directory board, with a header row that folds it away.
  const palette = el('nav', 'hs-palette');
  palette.setAttribute('aria-label', 'Build palette');
  let paletteCollapsed = readPaletteCollapsed();
  let chromeWatch: ChromeWatch | null = null;
  const paletteParts = buildPalette(
    palette,
    (row) => {
      // A locked tile keeps focus so a keyboard can read it, but it does not pick anything up.
      if (game.world.stars < row.star) {
        notice(`${row.label} ${row.star === 1 ? 'needs 1 star' : `needs ${row.star} stars`}.`);
        return;
      }
      const tool = row.tool;
      game.setTool(sameTool(tool, game.getTool()) ? { kind: 'none' } : tool);
      // A sheet sits over the tower. Once a tool is in hand there is nothing left to pick,
      // so the board folds away and the player can see where they are placing it. Their own
      // choice of collapsed or not is not overwritten: this one is not remembered.
      if (game.getTool().kind !== 'none' && inSheetLayout()) setPaletteCollapsed(true, false);
      update();
    },
    () => setPaletteCollapsed(!paletteCollapsed, true),
  );
  // Thumbnails are cut from the renderer's art a few per frame, and only while the board is
  // open, so opening the game does not stall on thirty GPU reads at once.
  let thumbQueue: PaletteRow[] = [];
  let thumbRaf = 0;
  let thumbDpr = 0;
  const rows = paletteParts.rows;
  applyPaletteCollapsed();

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
  hint.append(el('span', 'hs-hint-text', hintText(coarsePointer())));
  const hintClose = button('Close', 'hs-hint-close', () => {
    hint.classList.add('is-hidden');
    writeHintSeen(HINT_LOADS); // closing it means read, not just shown
  });
  hintClose.title = 'Hide the controls hint';
  hint.append(hintClose);
  const hintState = nextHintSeen(readHintSeen());
  if (hintState.show) writeHintSeen(hintState.seen);
  else hint.classList.add('is-hidden');

  // Placement: a chip that names what is being placed and what it costs, and, on touch, the
  // bar that moves it and pays for it. Both ride beside the ghost the renderer draws.
  const chipText = el('span', 'hs-place-chip-text');
  const chip = el('div', 'hs-place-chip is-hidden');
  chip.setAttribute('role', 'status');
  chip.setAttribute('aria-live', 'polite');
  chip.append(chipText);

  const bar = el('div', 'hs-place-bar is-hidden');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Place this');
  const leftButton = placeButton('\u25c0', 'Move left one tile', () => game.nudgePending(-1, 0));
  const rightButton = placeButton('\u25b6', 'Move right one tile', () => game.nudgePending(1, 0));
  const upButton = placeButton('\u25b2', 'Move up one floor', () => {
    if (heldIsShaft()) game.resizePending(1, 0);
    else game.nudgePending(0, 1);
  });
  const downButton = placeButton('\u25bc', 'Move down one floor', () => {
    if (heldIsShaft()) game.resizePending(0, 1);
    else game.nudgePending(0, -1);
  });
  const buildButton = placeButton('Build', 'Build it here', () => {
    const result = game.confirmPending();
    if (!result.ok) notice(result.reason);
  });
  buildButton.classList.add('is-primary');
  const cancelButton = placeButton('Cancel', 'Put this back', () => game.cancelPending());
  bar.append(leftButton, rightButton, upButton, downButton, buildButton, cancelButton);

  const toasts = el('div', 'hs-toasts');
  toasts.setAttribute('role', 'status');
  toasts.setAttribute('aria-live', 'polite');

  shell.append(top, palette, hint, chip, bar, panelSlot, ticker, toasts);
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
    sound,
  };

  applyReducedMotion(reducedMotion);
  // The top strip wraps on a narrow screen, so nothing below it can assume one row: the
  // measured height goes into a variable the palette, the panel and the hint sit under, and
  // into the band the camera frames the street in.
  chromeWatch = watchChrome({ strip: top, palette, ticker, shell }, (topPx, bottomPx) => {
    chromeBand = { top: topPx, bottom: bottomPx };
    viewSize = null; // the chrome moved, so the view may have too
    game.setChrome(topPx, bottomPx);
    refreshPlacement();
  });
  lastLogTotal = game.world.logTotal;
  const unsubscribe = game.subscribe(() => update());
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onPlacementResize);
  window.addEventListener('resize', onThumbResize);
  const fonts = typeof document.fonts?.addEventListener === 'function' ? document.fonts : null;
  fonts?.addEventListener('loadingdone', onPlacementResize);
  queueThumbnails();
  update();

  function update(): void {
    if (destroyed) return;
    const world = game.world;
    const speed = game.getSpeed();

    status.update(world, speed);

    const hover = game.getHover();
    hoverReadout.classList.toggle('is-hidden', hover === null);
    if (hover) setText(hoverValue, formatFloorShort(hover.floor));

    for (const entry of speedButtons) {
      setPressed(entry.node, entry.speed === speed);
    }

    const tool = game.getTool();
    let held = '';
    for (const row of rows) {
      const state = toolRowState(row, world, tool);
      applyRowState(row, state);
      if (state.selected) held = row.label;
    }
    // Collapsed, the header row is the only thing left to say what is in hand.
    setText(paletteParts.current, held);

    refreshPlacement();
    refreshPanel();
    refreshTicker();
    drainAlerts();
  }

  /** Queue every tile's thumbnail to be drawn (again), at the current device pixel ratio. */
  function queueThumbnails(): void {
    if (typeof renderer.thumbnail !== 'function') return; // a renderer without art (tests, fallbacks)
    thumbDpr = window.devicePixelRatio || 1;
    thumbQueue = rows.filter((row) => row.thumb !== null);
    drawThumbnailsSoon();
  }

  function drawThumbnailsSoon(): void {
    if (thumbRaf || destroyed || thumbQueue.length === 0 || paletteCollapsed) return;
    thumbRaf = requestAnimationFrame(drawSomeThumbnails);
  }

  function drawSomeThumbnails(): void {
    thumbRaf = 0;
    if (destroyed) return;
    for (let i = 0; i < 4 && thumbQueue.length > 0; i += 1) {
      const row = thumbQueue.shift() as PaletteRow;
      if (!row.thumb || !row.kind) continue;
      try {
        paintThumbnail(row.thumb, renderer.thumbnail(row.kind), thumbDpr);
      } catch (error) {
        // A failed read leaves the tile without a picture; its name and price still say it all.
        console.warn('ui: palette thumbnail failed', row.kind, error);
      }
    }
    drawThumbnailsSoon();
  }

  /** A move to a screen with another pixel ratio redraws the thumbnails sharp for it. */
  function onThumbResize(): void {
    if ((window.devicePixelRatio || 1) !== thumbDpr) queueThumbnails();
  }

  /** Is the tool in hand an elevator? Its up and down arrows stretch a span instead of moving it. */
  function heldIsShaft(): boolean {
    return game.getTool().kind === 'shaft';
  }

  function placeButton(label: string, description: string, onClick: () => void): HTMLButtonElement {
    const node = button(label, 'hs-btn hs-place-btn', () => {
      onClick();
      update();
    });
    node.setAttribute('aria-label', description);
    node.title = description;
    return node;
  }

  /**
   * Show what is about to be built, where, and for how much.
   *
   * The chip follows every ghost, hover or parked. The bar belongs to the parked one: it is
   * the only placement a player can still move, and the only one that has not been paid for.
   */
  function refreshPlacement(): void {
    const placement = game.getPlacement();
    if (toggleClass(chip, 'is-hidden', placement === null)) chipSize = null;
    if (toggleClass(bar, 'is-hidden', placement?.pending !== true)) barSize = null;
    if (!placement) {
      stopPlacementLoop();
      return;
    }

    if (setText(chipText, placementChipText(placement))) chipSize = null;
    if (toggleClass(chip, 'is-alert', !placement.ok)) chipSize = null;

    if (placement.pending) {
      // An extension is tied to its shaft's column, so sideways is not on offer.
      const anchored = placement.shaftId !== undefined;
      leftButton.disabled = anchored;
      rightButton.disabled = anchored;
      const arrows = placementArrowLabels(heldIsShaft() || anchored);
      describe(upButton, '\u25b2', arrows.up);
      describe(downButton, '\u25bc', arrows.down);
      const build = placementBuildLabels(placement);
      if (setText(buildButton, build.text)) barSize = null;
      buildButton.disabled = !placement.ok;
      buildButton.title = build.title;
      buildButton.setAttribute('aria-label', build.title);
    }

    positionPlacement();
    startPlacementLoop();
  }

  function describe(node: HTMLButtonElement, glyph: string, description: string): void {
    if (setText(node, glyph)) barSize = null;
    node.title = description;
    node.setAttribute('aria-label', description);
  }

  /**
   * Put the chip over the ghost and the bar under it, both inside the view.
   *
   * The bar goes above the chip when the ghost sits too low for it, so a room placed at the
   * bottom of the screen is not asking to be built from behind the palette sheet.
   */
  function positionPlacement(): void {
    const ghost = game.getPlacementRect();
    if (!ghost) return;
    if (!viewSize) {
      const view = sizeOf(shell);
      if (view.width <= 0 || view.height <= 0) return; // not laid out yet: measure next time
      viewSize = view;
    }
    chipSize ??= sizeOf(chip);
    const showBar = !bar.classList.contains('is-hidden');
    if (showBar) barSize ??= sizeOf(bar);
    const boxes = placementBoxes({
      ghost,
      chip: chipSize,
      bar: showBar ? barSize : null,
      view: viewSize,
      chrome: chromeBand,
    });
    const key = `${boxes.chip.left},${boxes.chip.top},${boxes.bar ? `${boxes.bar.left},${boxes.bar.top}` : '-'}`;
    if (key === placedKey) return;
    placedKey = key;
    chip.style.left = `${boxes.chip.left}px`;
    chip.style.top = `${boxes.chip.top}px`;
    if (!boxes.bar) return;
    bar.style.left = `${boxes.bar.left}px`;
    bar.style.top = `${boxes.bar.top}px`;
  }

  /** The view, a media query or a font changed under the chip and the bar: measure them again. */
  function onPlacementResize(): void {
    viewSize = null;
    chipSize = null;
    barSize = null;
    refreshPlacement();
  }

  // A pan or a pinch moves the ghost without telling anyone, so the chip and the bar follow
  // it on their own frames, and only for as long as there is a ghost on the tower.
  function startPlacementLoop(): void {
    if (placementRaf || destroyed) return;
    placementRaf = requestAnimationFrame(onPlacementFrame);
  }

  function onPlacementFrame(): void {
    placementRaf = 0;
    if (destroyed) return;
    if (!game.getPlacement()) {
      chip.classList.add('is-hidden');
      bar.classList.add('is-hidden');
      return;
    }
    positionPlacement();
    startPlacementLoop();
  }

  function stopPlacementLoop(): void {
    if (!placementRaf) return;
    cancelAnimationFrame(placementRaf);
    placementRaf = 0;
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
            : panelKind === 'share'
              ? createSharePanel(game, renderer, ctx)
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
    const world = game.world;
    const log = world.log;
    const total = world.logTotal;
    if (total < lastLogTotal) {
      // A different world was loaded: its old alerts are history, not news.
      lastLogTotal = total;
      return;
    }
    const fresh = Math.min(total - lastLogTotal, log.length);
    for (let i = log.length - fresh; i < log.length; i += 1) {
      const entry = log[i];
      if (entry && entry.level === 'alert') showAlert(entry);
    }
    lastLogTotal = total;
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

  /** The palette spans the shell: it is the phone sheet, not the desktop rail. */
  function inSheetLayout(): boolean {
    return isSheetLayout(palette.getBoundingClientRect().width, shell.getBoundingClientRect().width);
  }

  function setPaletteCollapsed(on: boolean, remember: boolean): void {
    if (paletteCollapsed === on) return;
    paletteCollapsed = on;
    if (remember) writePaletteCollapsed(on);
    applyPaletteCollapsed();
  }

  function applyPaletteCollapsed(): void {
    palette.classList.toggle('is-collapsed', paletteCollapsed);
    paletteParts.toggle.setAttribute('aria-expanded', paletteCollapsed ? 'false' : 'true');
    setText(paletteParts.chevron, paletteCollapsed ? '\u25b8' : '\u25be');
    chromeWatch?.measure(); // the board just changed height, so the camera's band did too
    drawThumbnailsSoon(); // opened: finish any pictures still to draw
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
      stopPlacementLoop();
      unsubscribe();
      sound.destroy();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onPlacementResize);
      window.removeEventListener('resize', onThumbResize);
      if (thumbRaf) cancelAnimationFrame(thumbRaf);
      status.destroy();
      fonts?.removeEventListener('loadingdone', onPlacementResize);
      chromeWatch?.disconnect();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      mountedPanel?.remove();
      mountedPanel = null;
      shell.remove();
    },
  };
}

// ------------------------------------------------------------------ parts

function sizeOf(node: HTMLElement): { width: number; height: number } {
  const box = node.getBoundingClientRect();
  return { width: box.width, height: box.height };
}

/** Write the text only if it differs. True when it did, which is when the node may have resized. */
function setText(node: HTMLElement, text: string): boolean {
  if (node.textContent === text) return false;
  node.textContent = text;
  return true;
}

/** Set a class only if it differs. True when it did. */
function toggleClass(node: HTMLElement, name: string, on: boolean): boolean {
  if (node.classList.contains(name) === on) return false;
  node.classList.toggle(name, on);
  return true;
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

/**
 * Keep --top-actual on the shell equal to the height the top strip really takes, and tell
 * the caller how much of the view the chrome covers whenever that changes.
 *
 * The strip wraps, the palette folds and turns into a sheet, and the ticker sits on a safe
 * area that rotates: one observer watches all three. Where there is no ResizeObserver the
 * window resize alone keeps it roughly honest, which is what the css falls back to anyway.
 */
function watchChrome(
  parts: { strip: HTMLElement; palette: HTMLElement; ticker: HTMLElement; shell: HTMLElement },
  onChrome: (topPx: number, bottomPx: number) => void,
): ChromeWatch {
  let lastTop = -1;
  let lastBottom = -1;
  const measure = (): void => {
    const strip = parts.strip.getBoundingClientRect();
    parts.shell.style.setProperty('--top-actual', `${Math.round(strip.height)}px`);
    const shell = parts.shell.getBoundingClientRect();
    const paletteRect = parts.palette.getBoundingClientRect();
    const insets = chromeInsets({
      shellHeight: shell.height,
      stripHeight: strip.height,
      tickerTop: parts.ticker.getBoundingClientRect().top,
      paletteTop: paletteRect.top,
      sheet: isSheetLayout(paletteRect.width, shell.width),
    });
    if (insets.top === lastTop && insets.bottom === lastBottom) return;
    lastTop = insets.top;
    lastBottom = insets.bottom;
    onChrome(insets.top, insets.bottom);
  };
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
  if (observer) {
    observer.observe(parts.strip);
    observer.observe(parts.palette);
    observer.observe(parts.ticker);
  }
  window.addEventListener('resize', measure);
  measure();
  return {
    measure,
    disconnect(): void {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    },
  };
}

/** True on a touch screen. A browser that will not answer is treated as a mouse. */
function coarsePointer(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
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

/** Was the board left folded away? A store that will not answer means expanded. */
function readPaletteCollapsed(): boolean {
  try {
    const stored = window.localStorage.getItem(PALETTE_COLLAPSED_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch {
    // Private browsing or a blocked store: the board opens expanded, as it does by default.
  }
  return false;
}

function writePaletteCollapsed(on: boolean): void {
  try {
    window.localStorage.setItem(PALETTE_COLLAPSED_KEY, on ? 'true' : 'false');
  } catch {
    // Nothing to do: the choice stays for this session only.
  }
}

export function readHintSeen(): string | null {
  try {
    return window.localStorage.getItem(HINT_KEY);
  } catch {
    return null; // a blocked store means the hint shows again, which is the safe way to fail
  }
}

export function writeHintSeen(count: number): void {
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
