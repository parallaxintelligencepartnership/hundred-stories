// The chrome around the tower: top strip, directory board palette, query panel,
// finances, log, settings, ticker and toasts. It talks to the game through GameApi only.
// Nothing here touches the document until createUi runs, so the module imports cleanly in tests.

import './ui.css';

import { createSound } from '../audio/audio';
import type { GameApi, Placement, Speed, Tool } from '../game/api';
import type { Renderer } from '../render/renderer';
import { describeBeat, followSim, isFollowed, storyName, type StoryBeat } from '../sim/story';
import type { Command, LogEntry, World } from '../sim/types';
import { createIntroPanel, createSideCard, createStarToast, createTipToast } from './cards';
import { unlocksText } from '../sim/chronicle';
import { createAlertStack } from './alerts';
import { createDemoCapCard, isDemoCapEntry } from './demo';
import { formatFloorShort, formatMoney, formatTimestamp } from './format';
import {
  GUIDE_DONE,
  TIP_OVER_GUIDE,
  TIP_TEXT,
  TipQueue,
  goalsFor,
  goalsNudge,
  guideBand,
  guideCopy,
  guideStep,
  isNight,
  newLeaveReason,
  nudgeCounts,
  type GuideBand,
  type GuideStep,
  type Tip,
  type TipId,
} from './onboarding';
import { PREF_KEYS, addToList, getFlag, getList, getPref, setFlag, setPref } from './prefs';
import { createIconSheet } from './icons';
import { chromeInsets, isSheetLayout, placementBoxes } from './layout';
import type { Box } from './layout';
import {
  button,
  createChroniclePanel,
  createFinancesPanel,
  createLogPanel,
  createQueryPanel,
  createRecapPanel,
  createSettingsPanel,
  createSharePanel,
  createStoriesPanel,
  el,
} from './panels';
import type { PanelContext, PanelElement } from './panels';
import { GROUPS, applyRowState, buildPalette, paintThumbnail, sameTool, toolRowState } from './palette';
import { hasTextField, isFormField, keyAction, stepSpeed } from './keys';
import { createMinimap, type Minimap } from './minimap';
import type { PaletteRow } from './palette';
import { createStatusBar, speedModeText } from './status';
import { placementNote } from './explain';
import { createHoverCard } from './hover';
import { createViewControl } from './overlays';
import { createDailyPanel, dailyCard } from './daily';

export interface Ui {
  destroy(): void;
  update(): void;
}

type PanelKind = 'none' | 'finances' | 'log' | 'settings' | 'share' | 'intro' | 'stories' | 'recap' | 'chronicle' | 'daily';

/** Real milliseconds the star card stays up unless closed first. */
export const STAR_CARD_LINGER_MS = 20_000;
/** A followed person's story line takes the ticker at most this often, in real time. */
export const STORY_TICKER_GAP_MS = 30_000;

/** The live measurement of the chrome: stop it, or ask it to measure again. */
interface ChromeWatch {
  measure(): void;
  disconnect(): void;
}

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
  return placement.reason ?? 'You cannot build it there.';
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

  // First run: the intro, the guided first tower, then the goals, and the tips once each.
  let introSeen = getFlag(PREF_KEYS.introSeen) === true;
  let guideDone = getFlag(PREF_KEYS.guideDone) === true;
  let goalsCollapsed = getFlag(PREF_KEYS.goalsCollapsed) === true;
  /** The intro was on screen in this session, which is one way the guide gets offered. */
  let introShownThisSession = false;
  let guideOffered = false;
  /** The step the card last showed, so a phone folds its palette once per new step, not per tick. */
  let shownStep: GuideStep | -1 = -1;
  const tips = new TipQueue(getList(PREF_KEYS.tips));
  let tipToast: { id: TipId; node: HTMLElement } | null = null;
  /** The world the watchers below were primed on; a load or a new game primes them again. */
  let seenWorld: World | null = null;
  let leaveCounts: Record<string, number> = {};
  let leaveTotal = 0;
  let lastQuarterSeen: unknown = null;
  let populationWatch = { population: 0, since: 0 };
  let bandKey = '';
  let hintKey = '';
  /** The hover tile the readout and the chip last showed, so a move within one tile does nothing. */
  let hoverKey = '';
  // The ticker: log lines first, a followed person's story line only in a quiet moment.
  let tickerLogSeen = -1;
  let tickerStorySeq = 0;
  let tickerShowsAlert = false;
  let storyShownAt = Number.NEGATIVE_INFINITY;
  /** The guided first tower follows its first worker once, then leaves the cast to the player. */
  let metFirstWorker = false;
  /** The star card: the story seq it last looked at, and the card on screen, if any. */
  let starStorySeq = 0;
  let starToast: HTMLElement | null = null;
  /** The message and link the share panel uses instead of the tower's own, while it is open for a daily. */
  let shareWords: { text: string; url: string } | null = null;
  /** The daily card last put up by itself, so each one opens once and Close keeps it closed. */
  let dailyShownKey = '';

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

  // View: the information layers, one at a time or none, with the legend under the choice.
  // Off by default and not remembered. A renderer without the method (tests) ignores it.
  const view = createViewControl((kind) => {
    if (typeof renderer.setOverlay === 'function') renderer.setOverlay(kind);
  });

  readouts.append(status.cash, status.population, status.stars);
  clockGroup.append(status.clock, view.root, hoverReadout);

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
  // Outside My tower (today's tower, a friend's tower) one tap goes back to it.
  const myTowerButton = button('My tower', 'hs-btn', () => openMyTower());
  myTowerButton.hidden = true;
  actions.append(status.mode, speedBar, myTowerButton, shareButton, menuButton);

  // Palette: a building directory board, with a header row that folds it away.
  const palette = el('nav', 'hs-palette');
  palette.setAttribute('aria-label', 'Build tools');
  let paletteCollapsed = readPaletteCollapsed();
  let chromeWatch: ChromeWatch | null = null;
  /** The palette group last picked by a number key or a tile, for letters with nothing in hand. */
  let lastGroup: number | null = null;
  const paletteParts = buildPalette(
    palette,
    (row) => pickRow(row, true),
    () => setPaletteCollapsed(!paletteCollapsed, true),
  );
  // Thumbnails are cut from the renderer's art a few per frame, and only while the board is
  // open, so opening the game does not stall on thirty GPU reads at once.
  let thumbQueue: PaletteRow[] = [];
  let thumbRaf = 0;
  let thumbDpr = 0;
  const rows = paletteParts.rows;
  /** Each group's tile letters, in tile order, for the keyboard map. */
  const keyGroups = GROUPS.map((_, group) => rows.filter((row) => row.group === group).map((row) => row.letter));
  applyPaletteCollapsed();

  const panelSlot = el('div', 'hs-panel-slot');
  // The demo edition's cap card, once per session, over whatever the slot holds.
  const demoCap = createDemoCapCard(panelSlot);

  // The side card: the guide's steps, then the goals, in the query panel's slot.
  const card = createSideCard({
    skipGuide: () => finishGuide(),
    openTools: () => {
      setPaletteCollapsed(false, false);
      update();
    },
    toggleGoals: () => {
      goalsCollapsed = !goalsCollapsed;
      setFlag(PREF_KEYS.goalsCollapsed, goalsCollapsed);
      update();
    },
  });

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
  // The second line: the floors an elevator will serve, or what to do about a common refusal.
  const chipNote = el('span', 'hs-place-chip-note is-hidden');
  chip.append(chipText, chipNote);

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
  const alerts = createAlertStack({
    host: toasts,
    getWorld: () => game.world,
    apply: (cmd) => ctx.apply(cmd),
    later(fn, ms) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        fn();
      }, ms);
      timers.add(timer);
    },
  });

  // The card follows the palette in the tree: on a phone the open sheet hides it by selector.
  // The minimap reads the camera the renderer already exposes; a renderer without one (tests,
  // fallbacks) simply gets no map.
  const minimap: Minimap | null = renderer.camera
    ? createMinimap({
        camera: renderer.camera,
        getWorld: () => game.world,
        getChrome: () => chromeBand,
        onMove: () => refreshPlacement(),
      })
    : null;
  shell.append(top, palette, card.node, hint, chip, bar, panelSlot, ticker);
  if (minimap) shell.append(minimap.node);
  shell.append(toasts);
  root.append(shell);

  // The hover card: a preview of the shaft or room under the pointer, or under the tap.
  const hoverCard = createHoverCard(shell, game, () => chromeBand);
  shell.append(hoverCard.node);

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
    openIntro() {
      setPanel('intro');
    },
    openStories() {
      setPanel('stories');
    },
    openRecap() {
      setPanel('recap');
    },
    openChronicle() {
      setPanel('chronicle');
    },
    openDaily() {
      void switchTower(() => game.openDaily());
    },
    openMyTower() {
      openMyTower();
    },
    select(sel) {
      // A name in a list is a way into that person: the list's panel steps aside for theirs.
      if (panelKind !== 'none') panelKind = 'none';
      game.select(sel);
      update();
    },
  };

  applyReducedMotion(reducedMotion);
  // The top strip wraps on a narrow screen, so nothing below it can assume one row: the
  // measured height goes into a variable the palette, the panel and the hint sit under, and
  // into the band the camera frames the street in.
  chromeWatch = watchChrome({ strip: top, palette, ticker, shell }, (topPx, bottomPx) => {
    chromeBand = { top: topPx, bottom: bottomPx };
    shell.style.setProperty('--chrome-bottom', `${Math.round(bottomPx)}px`); // the phone card sits on it
    viewSize = null; // the chrome moved, so the view may have too
    game.setChrome(topPx, bottomPx);
    refreshPlacement();
  });
  lastLogTotal = game.world.logTotal;
  const unsubscribe = game.subscribe(() => update());
  // Capture, so a card with a text field open can hold the camera's keys back as well.
  window.addEventListener('keydown', onKeyDown, { capture: true });
  window.addEventListener('resize', onPlacementResize);
  window.addEventListener('resize', onThumbResize);
  window.addEventListener('pointermove', onHoverMove);
  const fonts = typeof document.fonts?.addEventListener === 'function' ? document.fonts : null;
  fonts?.addEventListener('loadingdone', onPlacementResize);
  queueThumbnails();
  update();

  function update(): void {
    if (destroyed) return;
    const world = game.world;
    const speed = game.getSpeed();
    if (world !== seenWorld) onWorld(world);
    myTowerButton.hidden = (game.getSlot?.() ?? 'mine') === 'mine';
    watchDaily();

    status.update(world, speed);

    refreshHoverReadout();

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
    hoverCard.update();
    refreshPanel();
    refreshOnboarding(world);
    watchForTips(world, speed);
    showNextTip();
    refreshTicker();
    watchStars(world);
    drainAlerts();
  }

  /**
   * A star.gained beat since the last look puts up the star card: the new star, what it opened,
   * and Stories so far. It never pauses play and goes on Close, on the next star, or on its own.
   */
  function watchStars(world: World): void {
    const story = world.story;
    if (!story) return;
    const fresh = Math.max(0, Math.min(story.seq - starStorySeq, story.recent.length));
    starStorySeq = story.seq;
    let gained: StoryBeat | null = null;
    for (let i = story.recent.length - 1; i >= story.recent.length - fresh; i -= 1) {
      const beat = story.recent[i];
      if (beat && beat.code === 'star.gained') {
        gained = beat;
        break;
      }
    }
    if (!gained) return;
    starToast?.remove();
    const node = createStarToast(
      describeBeat(gained, world),
      unlocksText(gained.value ?? 1),
      () => {
        node.remove();
        if (starToast === node) starToast = null;
        setPanel('recap');
      },
      () => {
        node.remove();
        if (starToast === node) starToast = null;
      },
    );
    starToast = node;
    toasts.append(node);
    const timer = setTimeout(() => {
      timers.delete(timer);
      node.remove();
      if (starToast === node) starToast = null;
    }, STAR_CARD_LINGER_MS);
    timers.add(timer);
  }

  /**
   * Today's tower puts up its own card: the twist when a daily starts, the choice when an older
   * one is waiting, the result when it ends. Each once; the intro is never pushed aside.
   */
  function watchDaily(): void {
    const card = dailyCard(game);
    const daily = game.getDaily?.() ?? null;
    const choice = game.getDailyChoice?.() ?? null;
    const key = card === null ? '' : `${card}:${choice ? choice.savedDate : daily?.date ?? ''}`;
    if (key === dailyShownKey) return;
    if (key === '') {
      dailyShownKey = '';
      if (panelKind === 'daily') panelKind = 'none';
      return;
    }
    if (panelKind === 'intro') return;
    dailyShownKey = key;
    shareWords = null;
    panelKind = 'daily';
  }

  /** Point the page address at the tower in hand, so a reload opens the same slot. */
  function syncAddress(): void {
    if (typeof history === 'undefined' || typeof location === 'undefined') return;
    const slot = game.getSlot();
    const daily = game.getDaily();
    const query = slot === 'daily' && daily ? `?daily=${daily.date}` : slot === 'friend' ? `?seed=${game.world.seed}` : '';
    try {
      history.replaceState(null, '', `${location.pathname}${query}`);
    } catch {
      // an address the browser will not rewrite changes nothing about the game
    }
  }

  /** Move to another tower, then show it from the top with nothing open. */
  async function switchTower(open: () => Promise<void>): Promise<void> {
    await open();
    syncAddress();
    panelKind = 'none';
    mountedKey = '';
    update();
  }

  function openMyTower(): void {
    void switchTower(() => game.openMyTower());
  }

  function refreshHoverReadout(): void {
    const hover = game.getHover();
    hoverKey = hover ? `${hover.floor},${hover.x}` : '';
    hoverReadout.classList.toggle('is-hidden', hover === null);
    if (hover) setText(hoverValue, formatFloorShort(hover.floor));
  }

  /**
   * The game re-aims its ghost on the canvas's pointermove, before the window hears the event,
   * but only a tick batch notifies, and a paused game runs none. So while nothing ticks, the ui
   * follows the pointer here: a new tile rewrites the floor readout and the chip. The chip keeps
   * its cached sizes (measured again only if its words change) and the ghost rect is the
   * renderer's arithmetic, so a move costs no layout. The hover card follows on its own
   * listener (src/ui/hover.ts). While the game runs, the tick notify does all of this.
   */
  function onHoverMove(): void {
    if (destroyed) return;
    if (game.getSpeed() !== 0 && !game.world.gameOver) return;
    const hover = game.getHover();
    if ((hover ? `${hover.floor},${hover.x}` : '') === hoverKey) return;
    refreshHoverReadout();
    refreshPlacement();
  }

  // ---------------------------------------------------------- first run

  /**
   * A world arrived: the first one, a load or a new game. Prime the tip watchers on it so what
   * is already true is not news, and on an empty tower show the intro if it was never seen.
   */
  function onWorld(world: World): void {
    seenWorld = world;
    leaveCounts = { ...(world.stats?.tenantsLeftReasons ?? {}) };
    leaveTotal = sumCounts(leaveCounts);
    lastQuarterSeen = world.stats?.lastQuarter ?? null;
    populationWatch = { population: world.population, since: world.time.minute };
    tickerStorySeq = world.story?.seq ?? 0; // beats already recorded are history, not news
    starStorySeq = world.story?.seq ?? 0;
    starToast?.remove();
    starToast = null;
    const empty = world.rooms.size === 0 && world.shafts.size === 0;
    if (empty && !introSeen) {
      introShownThisSession = true;
      panelKind = 'intro';
    }
    if (!guideDone && (introShownThisSession || empty)) guideOffered = true;
  }

  function markIntroSeen(): void {
    if (!introSeen) setFlag(PREF_KEYS.introSeen, true);
    introSeen = true;
    introShownThisSession = true;
    if (!guideDone) guideOffered = true;
  }

  function finishGuide(): void {
    guideDone = true;
    guideOffered = false;
    setFlag(PREF_KEYS.guideDone, true);
    update();
  }

  function guideActive(): boolean {
    return guideOffered && !guideDone;
  }

  /** The side card, the lit palette tile and the band on the tower, all read from the world. */
  function refreshOnboarding(world: World): void {
    if (guideActive()) {
      const step = guideStep(world);
      if (step === GUIDE_DONE) {
        guideDone = true;
        guideOffered = false;
        setFlag(PREF_KEYS.guideDone, true);
      } else {
        watchFirstWorker(world);
        const copy = guideCopy(world, step);
        card.showGuide(step, copy);
        setHintedTool(copy.tool);
        setBand(guideBand(world, step));
        if (step !== shownStep) {
          shownStep = step;
          // On a phone the card and the open sheet share the bottom: show the step first.
          if (panelKind === 'none' && inSheetLayout()) setPaletteCollapsed(true, false);
        }
        return;
      }
    }
    setHintedTool(null);
    setBand(null);
    if (world.population !== populationWatch.population) {
      populationWatch = { population: world.population, since: world.time.minute };
    }
    const counts = nudgeCounts(world);
    const nudge = goalsNudge({ ...counts, populationStillFor: world.time.minute - populationWatch.since });
    card.showGoals(goalsFor(world), nudge, goalsCollapsed);
  }

  /**
   * The guided first tower's first office takes its first worker: follow them, and one tip
   * card introduces them and points at the person panel. Once per player, like every tip.
   */
  function watchFirstWorker(world: World): void {
    if (metFirstWorker || tips.has('meetPerson') || !world.story) return;
    let first: { id: number; tenants: number[] } | null = null;
    for (const room of world.rooms.values()) {
      if (room.kind === 'office' && (first === null || room.id < first.id)) first = room;
    }
    const workerId = first?.tenants?.[0];
    if (workerId === undefined || !world.sims.has(workerId)) return;
    metFirstWorker = true;
    if (!followSim(world.story, workerId)) return;
    offerTip({ id: 'meetPerson', text: TIP_TEXT.meetPerson(storyName(world, workerId)) });
  }

  function setHintedTool(tool: Tool | null): void {
    const key = tool ? JSON.stringify(tool) : '';
    if (key === hintKey) return;
    hintKey = key;
    for (const row of rows) row.node.classList.toggle('hs-tool-hint', tool !== null && sameTool(row.tool, tool));
  }

  function setBand(band: GuideBand | null): void {
    const key = band ? `${band.floorMin},${band.floorMax},${band.xMin},${band.xMax}` : '';
    if (key === bandKey) return;
    bandKey = key;
    if (typeof renderer.setGuideBand === 'function') renderer.setGuideBand(band);
  }

  /** Look for each tip's moment in the world. Found ones queue; the queue decides when to show. */
  function watchForTips(world: World, speed: Speed): void {
    if (!tips.has('longWait')) {
      const counts = nudgeCounts(world);
      if (counts.longWaitsThisHour + counts.longWaitsLastHour > 0) offerTip({ id: 'longWait', text: TIP_TEXT.longWait() });
    }
    const reasons = world.stats?.tenantsLeftReasons;
    if (reasons) {
      const total = sumCounts(reasons);
      if (total !== leaveTotal) {
        const reason = total > leaveTotal ? newLeaveReason(leaveCounts, reasons) : null;
        if (reason && !tips.has('tenantLeft')) offerTip({ id: 'tenantLeft', text: TIP_TEXT.tenantLeft(reason) });
        leaveCounts = { ...reasons };
        leaveTotal = total;
      }
    }
    // The quarter settles at 05:00 by writing a fresh lastQuarter; that is when rent has landed.
    const lastQuarter = world.stats?.lastQuarter;
    if (lastQuarter && lastQuarter !== lastQuarterSeen) {
      lastQuarterSeen = lastQuarter;
      if (lastQuarter.income > 0 && !tips.has('firstRent')) offerTip({ id: 'firstRent', text: TIP_TEXT.firstRent(lastQuarter.income) });
    }
    if (world.events.length > 0 && !tips.has('firstEvent')) offerTip({ id: 'firstEvent', text: TIP_TEXT.firstEvent() });
    if (speed !== 0 && !tips.has('nightSpeed') && isNight(world.time.minute)) {
      offerTip({ id: 'nightSpeed', text: TIP_TEXT.nightSpeed(speedModeText(speed, world.time.minute)) });
    }
  }

  function offerTip(tip: Tip): void {
    tips.offer(tip);
  }

  /** One tip at a time, and none over the intro or a guide step: they wait their turn. */
  function showNextTip(): void {
    if (tipToast) return;
    const tip = tips.next(panelKind === 'intro' || guideActive(), panelKind === 'intro' ? undefined : TIP_OVER_GUIDE);
    if (!tip) return;
    const node = createTipToast(tip, () => {
      tips.done(tip.id);
      addToList(PREF_KEYS.tips, tip.id);
      node.remove();
      tipToast = null;
      update();
    });
    tipToast = { id: tip.id, node };
    toasts.append(node);
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
    const note = placementNote(placement, game.getTool(), game.world);
    if (setText(chipNote, note)) chipSize = null;
    if (toggleClass(chipNote, 'is-hidden', note === '')) chipSize = null;
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
        ? `panel:${panelKind}${panelKind === 'daily' ? `:${dailyCard(game) ?? ''}` : ''}`
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

    if (panelKind !== 'intro' && !tips.has('firstPanel')) offerTip({ id: 'firstPanel', text: TIP_TEXT.firstPanel() });
    const panel =
      panelKind === 'intro'
        ? createIntroPanel(() => {
            markIntroSeen();
            setPanel('none');
          })
        : panelKind === 'finances'
        ? createFinancesPanel(game, ctx)
        : panelKind === 'log'
          ? createLogPanel(game, ctx)
          : panelKind === 'settings'
            ? createSettingsPanel(game, ctx)
            : panelKind === 'share'
              ? createSharePanel(game, renderer, ctx, shareWords ?? undefined)
              : panelKind === 'daily'
                ? createDailyPanel(game, ctx, {
                    share(text, url) {
                      shareWords = { text, url };
                      panelKind = 'share';
                      update();
                    },
                    myTower: () => openMyTower(),
                    choose(which) {
                      void game.chooseDaily(which).then(() => {
                        syncAddress();
                        mountedKey = '';
                        update();
                      });
                    },
                  })
              : panelKind === 'stories'
                ? createStoriesPanel(game, ctx)
                : panelKind === 'recap'
                  ? createRecapPanel(game, ctx)
                  : panelKind === 'chronicle'
                    ? createChroniclePanel(game, ctx)
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

  /**
   * The ticker shows the newest log line. A followed person's new beat takes it only when no
   * log line (an alert, a build, anything) arrived in the same batch, no alert is showing, and
   * the last story line is at least STORY_TICKER_GAP_MS old: alerts and build feedback win.
   */
  function refreshTicker(): void {
    const world = game.world;
    const log = world.log;
    const newest = log.length > 0 ? log[log.length - 1] : undefined;
    const logMoved = world.logTotal !== tickerLogSeen;
    tickerLogSeen = world.logTotal;
    const beat = newFollowedBeat(world);
    if (logMoved && newest) {
      setText(tickerTime, formatTimestamp(newest.minute));
      setText(tickerText, newest.text);
      tickerShowsAlert = newest.level === 'alert';
      ticker.classList.toggle('is-alert', tickerShowsAlert);
      ticker.classList.remove('is-story');
      return;
    }
    if (!beat || tickerShowsAlert || beat.simId === undefined) return;
    const now = performance.now();
    if (now - storyShownAt < STORY_TICKER_GAP_MS) return;
    storyShownAt = now;
    setText(tickerTime, formatTimestamp(beat.minute));
    setText(tickerText, `${storyName(world, beat.simId)}: ${describeBeat(beat, world)}`);
    ticker.classList.remove('is-alert');
    ticker.classList.add('is-story');
  }

  /** The newest beat about a followed person since the ticker last looked, or null. */
  function newFollowedBeat(world: World): StoryBeat | null {
    const story = world.story;
    if (!story) return null;
    const fresh = Math.max(0, Math.min(story.seq - tickerStorySeq, story.recent.length));
    tickerStorySeq = story.seq;
    for (let i = story.recent.length - 1; i >= story.recent.length - fresh; i -= 1) {
      const beat = story.recent[i];
      if (beat && beat.simId !== undefined && isFollowed(story, beat.simId)) return beat;
    }
    return null;
  }

  /** Every unseen alert line becomes a toast, with the command button that alert needs. */
  function drainAlerts(): void {
    const world = game.world;
    const log = world.log;
    const total = world.logTotal;
    if (total < lastLogTotal) {
      // A different world was loaded: its old alerts are history, not news.
      lastLogTotal = total;
      alerts.reset();
      alerts.sync();
      return;
    }
    const fresh = Math.min(total - lastLogTotal, log.length);
    for (let i = log.length - fresh; i < log.length; i += 1) {
      const entry = log[i];
      if (entry && entry.level === 'alert') alerts.onAlert(entry);
      if (entry && !demoCap.offered && isDemoCapEntry(entry)) demoCap.offer();
    }
    lastLogTotal = total;
    alerts.sync();
  }

  function notice(text: string): void {
    alerts.notice(text);
  }

  function setPanel(kind: PanelKind): void {
    // Any way out of the intro (Skip, Close, finishing, another panel) counts as seen.
    if (panelKind === 'intro' && kind !== 'intro') markIntroSeen();
    if (kind !== 'share') shareWords = null;
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

  /**
   * Pick up a tile's tool. A click toggles it; a number key always picks. A locked tile keeps
   * focus so a keyboard can read it, but it does not pick anything up.
   */
  function pickRow(row: PaletteRow, toggle: boolean): void {
    lastGroup = row.group;
    if (game.world.stars < row.star) {
      notice(`${row.label} ${row.star === 1 ? 'needs 1 star' : `needs ${row.star} stars`}.`);
      return;
    }
    const tool = row.tool;
    game.setTool(toggle && sameTool(tool, game.getTool()) ? { kind: 'none' } : tool);
    // A sheet sits over the tower. Once a tool is in hand there is nothing left to pick,
    // so the board folds away and the player can see where they are placing it. Their own
    // choice of collapsed or not is not overwritten: this one is not remembered.
    if (game.getTool().kind !== 'none' && inSheetLayout()) setPaletteCollapsed(true, false);
    update();
  }

  /** The group of the tool in hand, else the group last picked. Letters pick inside it. */
  function activeGroup(): number | null {
    const tool = game.getTool();
    if (tool.kind !== 'none') {
      const held = rows.find((row) => sameTool(row.tool, tool));
      if (held) return held.group;
    }
    return lastGroup;
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    if (isFormField(event.target)) return;
    // A card with a text field is open: no key is ours, and none is the camera's either.
    if (mountedPanel && hasTextField(mountedPanel)) {
      event.stopImmediatePropagation();
      return;
    }
    const action = keyAction(event, keyGroups, activeGroup());
    if (!action) return;
    switch (action.kind) {
      case 'pause':
        event.preventDefault();
        game.togglePause();
        update();
        return;
      case 'speed':
        game.setSpeed(stepSpeed(game.getSpeed(), action.step));
        update();
        return;
      case 'clear':
        // An alert on screen takes the first Escape; the next one drops the tool.
        if (alerts.dismissNewest()) {
          event.preventDefault();
          return;
        }
        game.setTool({ kind: 'none' });
        update();
        return;
      case 'group': {
        // The first tool of the group the player can have; a group all locked says why.
        const inGroup = rows.filter((row) => row.group === action.group);
        const first = inGroup.find((row) => game.world.stars >= row.star) ?? inGroup[0];
        if (first) pickRow(first, false);
        return;
      }
      case 'tool': {
        const row = rows.filter((r) => r.group === action.group)[action.index];
        if (row) pickRow(row, true);
        return;
      }
    }
  }

  return {
    update,
    destroy() {
      destroyed = true;
      if (bandKey !== '' && typeof renderer.setGuideBand === 'function') renderer.setGuideBand(null);
      stopPlacementLoop();
      unsubscribe();
      sound.destroy();
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      minimap?.destroy();
      window.removeEventListener('resize', onPlacementResize);
      window.removeEventListener('pointermove', onHoverMove);
      window.removeEventListener('resize', onThumbResize);
      if (thumbRaf) cancelAnimationFrame(thumbRaf);
      status.destroy();
      hoverCard.destroy();
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

function sumCounts(counts: Readonly<Record<string, number>>): number {
  let total = 0;
  for (const value of Object.values(counts)) total += value;
  return total;
}

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
  // A stored choice wins; with none, or a store that will not answer, the system preference.
  const stored = getFlag(PREF_KEYS.reducedMotion);
  if (stored !== null) return stored;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Was the board left folded away? A store that will not answer means expanded. */
function readPaletteCollapsed(): boolean {
  return getFlag(PREF_KEYS.paletteCollapsed) === true;
}

function writePaletteCollapsed(on: boolean): void {
  setFlag(PREF_KEYS.paletteCollapsed, on);
}

/** A blocked store means the hint shows again, which is the safe way to fail. */
export function readHintSeen(): string | null {
  return getPref(PREF_KEYS.hintSeen);
}

export function writeHintSeen(count: number): void {
  setPref(PREF_KEYS.hintSeen, String(count));
}

function writeReducedMotion(on: boolean): void {
  setFlag(PREF_KEYS.reducedMotion, on);
}
