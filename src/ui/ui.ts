// The chrome around the tower: the floating top bar, directory board palette, query panel,
// finances, log, settings, and the toasts that carry the news. It talks to the game through GameApi only.
// Nothing here touches the document until createUi runs, so the module imports cleanly in tests.

import './ui.css';

import { createSound } from '../audio/audio';
import type { GameApi, Placement, Speed, Tool } from '../game/api';
import type { Renderer } from '../render/renderer';
import { describeBeat, followSim, isFollowed, storyName, type StoryBeat } from '../sim/story';
import type { Command, CommandResult, LogEntry, World } from '../sim/types';
import { createIntroPanel, createSideCard, createStarToast, createTipToast } from './cards';
import { unlocksText } from '../sim/chronicle';
import { createAlertStack, type GameOverAction } from './alerts';
import { importSaveWithDialog, savePlatform } from '../game/storage';
import { createDemoCapCard, isDemoCapEntry } from './demo';
import { createFeedbackPanel } from './feedback';
import { formatFloorShort, formatMoney } from './format';
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
import { createIconSheet, icon, type IconName } from './icons';
import { chromeInsets, isSheetLayout, placementBoxes, viewInsets } from './layout';
import { createToasts } from './toast';
import type { Box } from './layout';
import {
  applyGlassClear,
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
  readGlassClear,
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
import { createBuildDock, isPhoneWidth } from './build';
import { pageRoot, watchDisplayPrefs } from './display';
import { createPageHaptics, hapticsEnabled } from './haptics';
import { createGamepadInput, pageGamepadDeps, type GamepadInput, type PadDirection } from './gamepad';
import { focusablesIn, SHEET_CARD_MIN_WIDTH } from './sheet';
import { WATCH_CLASS, createWatchMode, createWatchToggle } from './watch';
import { UPDATE_TEXT, type Notifier } from './notify';

export interface Ui {
  destroy(): void;
  update(): void;
  /** A new version has installed: say so once, with a way to reload into it. */
  updateReady(): void;
}

export interface UiOptions {
  /** The web's notifications (main.ts makes none in the native shells or in tests). */
  notifier?: Notifier | null;
  /** Load the page again. The page's own reload unless a test hands in another. */
  reload?: () => void;
}

type PanelKind = 'none' | 'finances' | 'log' | 'settings' | 'share' | 'intro' | 'stories' | 'recap' | 'chronicle' | 'daily' | 'feedback';

/** Real milliseconds the star card stays up unless closed first. */
export const STAR_CARD_LINGER_MS = 20_000;
/** A followed person's story line becomes a news toast at most this often, in real time. */
export const STORY_TOAST_GAP_MS = 30_000;
/** Give-up lines ("Gave up waiting for an elevator...") fold into one toast at most this often. */
export const GIVE_UP_TOAST_GAP_MS = 20_000;
const GIVE_UP_PREFIX = 'Gave up waiting for an elevator';

/** The live measurement of the chrome: stop it, or ask it to measure again. */
interface ChromeWatch {
  measure(): void;
  disconnect(): void;
}

/** ui.css --edge: how far a card open on the right sits from the edge. */
const CARD_EDGE = 12;

/** The controls hint rides along for the first three loads, then gets out of the way. */
const HINT_LOADS = 3;
const HINT_TEXT = 'Move: drag, scroll, or W A S D. Zoom: ctrl + scroll or pinch. Click to place.';
/** A phone has no wheel, no keys and no cursor, so it gets the three gestures it does have. */
const TOUCH_HINT_TEXT = 'Move: one finger. Zoom: pinch. Tap a spot, then tap Build.';

/** The hint speaks to the pointer in the room: a finger is told about fingers. */
/** A button, or anything playing one (role button or switch): Space presses it. */
function isPressable(target: unknown): boolean {
  const node = target as { tagName?: unknown; getAttribute?: (name: string) => string | null } | null;
  if (!node || typeof node.tagName !== 'string') return false;
  if (node.tagName.toUpperCase() === 'BUTTON') return true;
  const role = typeof node.getAttribute === 'function' ? node.getAttribute('role') : null;
  return role === 'button' || role === 'switch';
}

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

/** D-23: how much clear space the selection keeps from the left edge of the card open beside it. */
export const SELECTION_CLEAR_PX = 24;
/** Frames a new selection's check waits for the renderer to draw its ring, at most. */
const SELECTION_CLEAR_FRAMES = 3;

/**
 * The left edge of the card open on the right, in the shell's css px (D-23): the shell's width
 * less the card and two edges. The one rule for it: the hover card keeps out from under this
 * edge (openCardLeft) and the selection keeps SELECTION_CLEAR_PX clear of it.
 */
export function cardLeft(shellWidth: number, panelWidth: number): number {
  return shellWidth - (panelWidth + 2 * CARD_EDGE);
}

/**
 * Where the view's center must go so the selection (`rect`, CSS px) sits left of a card whose
 * left edge is `cardLeft` with SELECTION_CLEAR_PX clear, or null when it already does (D-23).
 */
export function selectionClearX(
  rect: { x: number; w: number },
  cardLeft: number,
  camera: { x: number; zoom: number },
): number | null {
  const over = rect.x + rect.w - (cardLeft - SELECTION_CLEAR_PX);
  return over > 0 ? camera.x + over / camera.zoom : null;
}

export function createUi(root: HTMLElement, game: GameApi, renderer: Renderer, options: UiOptions = {}): Ui {
  const notifier = options.notifier ?? null;
  const reload = options.reload ?? (() => location.reload());
  /** The new version toast is said once per page. */
  let updateToldAt: HTMLElement | null = null;
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
  /** The band the camera frames the tower in: only the top bar, the tower is full bleed. */
  let viewBand = { top: 0, bottom: 0 };
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
  /** The open card's left edge for the hover card, measured once per card (openCardLeft). */
  let cardEdge: number | null = null;
  /** The frame that looks at a new selection beside its card (keepSelectionClearSoon). */
  let selectionRaf = 0;
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
  // The news toasts: log lines first, a followed person's story line only in a quiet moment.
  let newsLogSeen = -1;
  let newsStorySeq = 0;
  let newsShowsAlert = false;
  let storyShownAt = Number.NEGATIVE_INFINITY;
  let giveUps = 0;
  let warns = 0;
  let giveUpShownAt = Number.NEGATIVE_INFINITY;
  /** The last refusal shown as a notice, so its log line does not show a second time. */
  let lastNoticeText = '';
  /**
   * True while a command the player gave through the chrome runs. The game logs a refusal and
   * notifies before it returns, so the news sees the refusal line first; that line is said once,
   * as the notice where the player acted, and never as a news toast too.
   */
  let acting = false;
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
  // First in the tab order: a link past the chrome to the tower, visible when it has focus.
  const skip = el('a', 'hs-skip', 'Skip to tower');
  skip.href = '#view';
  skip.addEventListener('click', (event: Event) => {
    event.preventDefault?.();
    focusTower();
  });
  shell.append(skip);
  // The icon symbols, once for the whole chrome; every icon() refers to them by id.
  shell.append(createIconSheet() as unknown as HTMLElement);
  const top = el('header', 'hs-top');
  // The top bar floats over the tower: one glass pill of cash, people, stars, the clock and
  // the weather; then the speed pill, Views, Share and Menu, which never hide or move. A phone
  // keeps the pill alone on one row at the top and puts the speed pill and Menu in the bottom
  // left corner, under the left thumb (ui.css); Views and Share move into Settings there.
  const pill = el('div', 'hs-status-pill');
  pill.setAttribute('role', 'group');
  pill.setAttribute('aria-label', 'Your tower');
  const actions = el('div', 'hs-top-actions');
  top.append(pill, actions);

  // Readouts: the mono readout type is kept for cash and the clock only.
  // At phone width, whatever the pointer, a tap on the stars opens the goals (below), never the
  // tooltip over them. Only the css that keeps a hovered tooltip shut asks for touch.
  const status = createStatusBar({ starsTip: () => !inSheetLayout() });
  status.cash.addEventListener('click', () => setPanel(panelKind === 'finances' ? 'none' : 'finances'));
  // A phone shows no folded goals card (ui.css), so the star count that names them opens them:
  // the phone's goals card, whose Hide folds it out of sight again.
  status.stars.addEventListener('click', () => {
    if (!inSheetLayout()) return;
    goalsCollapsed = false;
    setFlag(PREF_KEYS.goalsCollapsed, false);
    update();
  });

  const hoverValue = el('span', 'hs-readout-value');
  const hoverReadout = el('div', 'hs-readout hs-status-hover is-hidden');
  hoverReadout.title = 'Floor under the cursor';
  hoverReadout.append(el('span', 'hs-readout-label', 'Cursor'), hoverValue);

  // Views: the information layers, one at a time or none, from a popover under the Views
  // button; the one that is on is a chip under the bar. Off by default and not remembered. A
  // renderer without the method (tests) ignores it.
  const view = createViewControl((kind) => {
    if (typeof renderer.setOverlay === 'function') renderer.setOverlay(kind);
    shell.classList.toggle('has-view', kind !== null);
  });

  pill.append(status.cash, status.population, status.stars, status.clock, hoverReadout);
  top.append(view.chip);
  // Watch mode's round button, under Views (placeWatchButton; on a phone, where Views lives in
  // Settings, under the pill on the right). It steps aside with the rest of the chrome.
  const watchToggle = createWatchToggle();
  top.append(watchToggle.button);

  // Speed: one segmented pill of icons. The keys stay: space pauses, comma and period step.
  const speedBar = el('div', 'hs-speed');
  speedBar.setAttribute('role', 'group');
  speedBar.setAttribute('aria-label', 'Speed');
  const speedButtons: { node: HTMLButtonElement; speed: Speed }[] = (
    [
      ['pause', 'Pause', 'Pause (space bar)', 0],
      ['play', 'Play', 'Play at normal speed (space bar)', 1],
      ['fast', 'Fast', 'Fast, two times as quick (period key)', 2],
      ['faster', 'Faster', 'Faster, four times as quick (period key)', 4],
    ] as [IconName, string, string, Speed][]
  ).map(([glyph, label, tip, speed]) => {
    const node = iconButton(glyph, label, tip, 'hs-speed-btn', () => {
      game.setSpeed(speed);
      update();
    });
    speedBar.append(node);
    return { node, speed };
  });

  // Share and Menu: round buttons, the icon always and the word beside it where there is room.
  const shareButton = iconButton('share', 'Share', 'Share your tower', 'hs-round', () =>
    setPanel(panelKind === 'share' ? 'none' : 'share'),
  );
  const menuButton = iconButton('menu', 'Menu', 'Open the menu', 'hs-round', () =>
    setPanel(panelKind === 'settings' ? 'none' : 'settings'),
  );
  // Outside My tower (today's tower, a friend's tower) one tap goes back to it. The word on a
  // wide screen; a phone shows the house alone (ui.css), named by the aria-label.
  const myTowerButton = button('', 'hs-btn hs-pill-btn hs-my-tower', () => openMyTower());
  myTowerButton.append(icon('home', 'hs-icon hs-btn-icon') as unknown as HTMLElement, el('span', 'hs-btn-label', 'My tower'));
  myTowerButton.setAttribute('aria-label', 'My tower');
  myTowerButton.title = 'Back to My tower';
  myTowerButton.hidden = true;
  actions.append(status.mode, speedBar, myTowerButton, view.button, shareButton, menuButton);

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
    (group) => {
      build.setCategory(group);
      // A tab on the folded dock opens it on that category.
      if (paletteCollapsed && !inSheetLayout()) setPaletteCollapsed(false, true);
    },
  );
  // The dock on a wide screen, the Build button and its sheet on a phone.
  const build = createBuildDock({
    palette,
    parts: paletteParts,
    isPhone: () => inSheetLayout(),
    cancel: () => {
      if (game.getPlacement()?.pending) game.cancelPending();
      game.setTool({ kind: 'none' });
      update();
    },
    changed: () => {
      // The open phone sheet and its placing bar own the bottom: the speed pill and Menu step
      // aside (ui.css) and come back when the sheet shuts.
      shell.classList.toggle('is-building', build.sheet() !== 'closed');
      chromeWatch?.measure();
      queueThumbnails(); // the category shown may be new: draw its tiles
    },
  });
  // Thumbnails are cut from the renderer's art a few per frame, only while the board is open and
  // only for the category it shows, so opening the game does not stall on thirty GPU reads.
  let thumbQueue: PaletteRow[] = [];
  let thumbRaf = 0;
  let thumbDpr = 0;
  /** The tiles already drawn at thumbDpr; a category shown again draws nothing. */
  const thumbDrawn = new Set<PaletteRow>();
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
      if (inSheetLayout()) build.open();
      else setPaletteCollapsed(false, false);
      update();
    },
    toggleGoals: () => {
      goalsCollapsed = !goalsCollapsed;
      setFlag(PREF_KEYS.goalsCollapsed, goalsCollapsed);
      update();
    },
  });

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
    act(() => game.confirmPending());
  });
  buildButton.classList.add('is-primary');
  const cancelButton = placeButton('Cancel', 'Put this back', () => game.cancelPending());
  bar.append(leftButton, rightButton, upButton, downButton, buildButton, cancelButton);

  // Toasts: the news floats above the bottom edge and fades; alerts stay until tapped. The
  // alert cards (fire, bomb, theft) live in the same assertive region as the alert toasts,
  // and tips and the star card sit beside them in the polite stack in the corner.
  const toastLayer = createToasts();
  const toasts = el('div', 'hs-toasts');
  toasts.setAttribute('role', 'status');
  toasts.setAttribute('aria-live', 'polite');
  toasts.append(toastLayer.alerts);
  const alerts = createAlertStack({
    host: toastLayer.alerts,
    getWorld: () => game.world,
    apply: (cmd) => ctx.apply(cmd),
    later(fn, ms) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        fn();
      }, ms);
      timers.add(timer);
    },
    gameOverActions,
  });
  // The game over card's Open a saved file, off the desktop shell: a file input kept out of sight.
  const gameOverFile = el('input');
  gameOverFile.type = 'file';
  gameOverFile.accept = 'application/json,.json';
  gameOverFile.className = 'hs-file';
  gameOverFile.hidden = true;
  gameOverFile.setAttribute('tabindex', '-1');
  gameOverFile.setAttribute('aria-label', 'Open a saved file');
  gameOverFile.addEventListener('change', () => {
    const chosen = gameOverFile.files && gameOverFile.files.length > 0 ? gameOverFile.files[0] : null;
    if (!chosen) return;
    void chosen
      .text()
      .then((text) => openSavedText(text))
      .catch(() => notice('That file could not be read.'))
      .finally(() => {
        gameOverFile.value = '';
      });
  });
  toasts.append(gameOverFile);

  /** A saved file's text, opened as the menu opens it. */
  function openSavedText(text: string): void {
    const result = game.importSave(text);
    notice(result.ok ? 'Tower opened.' : result.reason);
  }

  /**
   * The ways on from a tower the bank took, as the menu offers them: New tower in My tower (a
   * new game only ever replaces My tower, so elsewhere it is My tower), and Open a saved file.
   */
  function gameOverActions(): GameOverAction[] {
    const slot = game.getSlot?.() ?? 'mine';
    const first: GameOverAction =
      slot === 'mine'
        ? {
            kind: 'newTower',
            run() {
              game.newGame(Math.floor(Date.now() % 1_000_000));
              notice('New game started.');
            },
          }
        : { kind: 'myTower', run: () => openMyTower() };
    const open: GameOverAction = {
      kind: 'openFile',
      run() {
        if (savePlatform() !== 'tauri') {
          gameOverFile.click();
          return;
        }
        void importSaveWithDialog()
          .then((text) => {
            if (text !== null) openSavedText(text);
          })
          .catch(() => notice('That file could not be read.'));
      },
    };
    return [first, open];
  }

  // The card follows the palette in the tree: on a phone the open sheet hides it by selector.
  // The minimap reads the camera the renderer already exposes; a renderer without one (tests,
  // fallbacks) simply gets no map.
  const minimap: Minimap | null = renderer.camera
    ? createMinimap({
        camera: renderer.camera,
        getWorld: () => game.world,
        getChrome: () => viewBand,
        onMove: () => refreshPlacement(),
      })
    : null;
  // The controller's cursor: the middle of the tower view, shown only while a pad is in use.
  const padCursor = el('div', 'hs-pad-cursor is-hidden');
  padCursor.setAttribute('aria-hidden', 'true');
  shell.append(top, palette, build.fab, card.node, hint, chip, bar, panelSlot);
  if (minimap) shell.append(minimap.node);
  shell.append(toasts, toastLayer.news, view.menu, padCursor);
  root.append(shell);

  // The hover card: a preview of the shaft or room under the pointer, or under the tap. It
  // keeps out from under the card open on the right.
  const hoverCard = createHoverCard(shell, game, () => chromeBand, openCardLeft);
  shell.append(hoverCard.node);

  // Watch mode (the Watch button, off by default): turned on, the chrome steps aside at once,
  // all but the clock; any input brings it back, and 5 s idle with nothing open hides it again.
  // The phone's build sheet at its row is not "open": it closes as the chrome steps aside.
  const watch = createWatchMode({
    shell,
    busy: () => mountedPanel !== null || view.isOpen() || build.sheet() === 'full' || guideActive(),
    onWatch: () => {
      if (build.sheet() === 'row') build.close();
    },
  });

  const ctx: PanelContext = {
    apply(cmd: Command) {
      const result = act(() => game.apply(cmd));
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
    // Settings on a phone, where the top bar has no Views or Share button. The modal menu steps
    // aside first, so the view picked is not left behind it.
    openViews() {
      setPanel('none');
      view.open();
    },
    openShare() {
      setPanel('share');
    },
    openFeedback() {
      setPanel('feedback');
    },
    setDisplay(name) {
      // The switch is already stored; Larger text and the color-blind views follow at once.
      if (name === 'largeText' || name === 'colorBlind') display.refresh();
    },
    ...(notifier ? { notifications: notifier } : {}),
    select(sel) {
      // A name in a list is a way into that person: the list's panel steps aside for theirs.
      if (panelKind !== 'none') panelKind = 'none';
      game.select(sel);
      update();
    },
  };

  applyReducedMotion(reducedMotion);
  // See-through buttons, as the player left it in Settings (off by default).
  applyGlassClear(readGlassClear());
  // The top bar wraps on a narrow screen, so nothing below it can assume one row: its measured
  // bottom goes into a variable the palette, the panel and the hint sit under, and into the
  // band the camera frames the street in. Nothing else pushes the tower: it is full bleed.
  chromeWatch = watchChrome({ strip: top, palette, shell }, (band, keepOut) => {
    chromeBand = keepOut;
    viewBand = band;
    shell.style.setProperty('--chrome-bottom', `${Math.round(keepOut.bottom)}px`); // the phone card and the news sit on it
    viewSize = null; // the chrome moved, so the view may have too
    game.setChrome(band.top, band.bottom);
    refreshPlacement();
  }, (shellRect) => {
    placeGoalsPill(shellRect);
    placeWatchButton();
  });
  // Larger text and color-blind friendly views, now and whenever Settings changes them.
  const display = watchDisplayPrefs({
    root: pageRoot(),
    colorBlind(on) {
      if (typeof renderer.setOverlayColorBlind === 'function') renderer.setOverlayColorBlind(on);
      view.setColorBlind(on);
    },
  });
  // Haptics: only where something can be felt (the apps, or a touch screen that can vibrate),
  // so a desktop never listens to the event stream for nothing.
  const haptics = createPageHaptics();
  const unsubscribeHaptics =
    hapticsCapable() && typeof game.subscribeEvents === 'function'
      ? game.subscribeEvents((event) => {
          if (event.kind === 'build') haptics.play('place');
          else if (event.kind === 'refused') haptics.play('refuse');
          else if (event.kind === 'stars' && event.to > event.from) haptics.play('star');
        })
      : null;
  // A controller, where the browser has the Gamepad API. It polls only while one is connected.
  const padDeps = pageGamepadDeps();
  const pad: GamepadInput | null = padDeps ? createGamepadInput(watchedPad(padHandlers()), padDeps) : null;

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
    let heldRow: PaletteRow | null = null;
    for (const row of rows) {
      const state = toolRowState(row, world, tool);
      applyRowState(row, state);
      if (state.selected) {
        held = row.label;
        heldRow = row;
      }
    }
    // Collapsed, the header row is the only thing left to say what is in hand.
    setText(paletteParts.current, held);
    // On a phone the sheet shrinks to the placing bar while a tool is in hand.
    build.sync(heldRow);

    refreshPlacement();
    refreshPanel();
    hoverCard.update(); // after the panel, so a card that just opened is kept clear of at once
    refreshOnboarding(world);
    watchForTips(world, speed);
    showNextTip();
    refreshNews();
    watchStars(world);
    drainAlerts();
    watch.sync();
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

  /** The daily card in hand and the date it is for ('' when there is no card). */
  function dailyKey(): string {
    const card = dailyCard(game);
    if (card === null) return '';
    const daily = game.getDaily?.() ?? null;
    const choice = game.getDailyChoice?.() ?? null;
    return `${card}:${choice ? choice.savedDate : daily?.date ?? ''}`;
  }

  /**
   * Today's tower puts up its own card: the twist when a daily starts, the choice when an older
   * one is waiting, the result when it ends. Each once; the intro is never pushed aside. Nor is
   * the feedback card, which may hold half-typed words: that open is skipped, not queued, and
   * the player finds the card in the menu (Today's tower).
   */
  function watchDaily(): void {
    const key = dailyKey();
    if (key === dailyShownKey) return;
    if (key === '') {
      dailyShownKey = '';
      if (panelKind === 'daily') panelKind = 'none';
      return;
    }
    if (panelKind === 'intro') return;
    dailyShownKey = key;
    if (panelKind === 'feedback') return;
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

  /**
   * Move to another tower, then show it from the top: whatever was open closes, and the daily
   * card is decided afresh for the tower just arrived in (shown when there is one, nothing in My
   * tower or a friend's). The open may already have notified and mounted that card; mountedKey
   * is left truthful, so it is kept as it is and closes normally later.
   */
  async function switchTower(open: () => Promise<void>): Promise<void> {
    await open();
    syncAddress();
    panelKind = 'none';
    dailyShownKey = '';
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
    newsStorySeq = world.story?.seq ?? 0; // beats already recorded are history, not news
    newsLogSeen = -1; // and so are its log lines
    starStorySeq = world.story?.seq ?? 0;
    starToast?.remove();
    starToast = null;
    // The alert cards belong to the tower that was on screen. Its lines, and the arriving
    // tower's old ones, are history; the arriving tower's live fire, bomb or theft still gets a
    // card from its events.
    lastLogTotal = world.logTotal;
    alerts.reset();
    alerts.sync();
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
          if (panelKind === 'none' && inSheetLayout()) build.close();
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

  /**
   * Queue the shown category's thumbnails to be drawn at the current device pixel ratio. A new
   * ratio draws every tile again, as each category is shown.
   */
  function queueThumbnails(): void {
    if (typeof renderer.thumbnail !== 'function') return; // a renderer without art (tests, fallbacks)
    const dpr = window.devicePixelRatio || 1;
    if (dpr !== thumbDpr) {
      thumbDpr = dpr;
      thumbDrawn.clear();
    }
    const category = build.category();
    thumbQueue = rows.filter((row) => row.group === category && row.thumb !== null && !thumbDrawn.has(row));
    drawThumbnailsSoon();
  }

  function drawThumbnailsSoon(): void {
    if (thumbRaf || destroyed || thumbQueue.length === 0 || boardHidden()) return;
    thumbRaf = requestAnimationFrame(drawSomeThumbnails);
  }

  /**
   * Are the tiles out of sight? On a phone that is the sheet shut or shrunk to the placing bar;
   * on a wide screen the folded dock. The fold is the dock's alone: the phone sheet never reads it.
   */
  function boardHidden(): boolean {
    return inSheetLayout() ? !(build.sheet() === 'row' || build.sheet() === 'full') : paletteCollapsed;
  }

  function drawSomeThumbnails(): void {
    thumbRaf = 0;
    if (destroyed) return;
    for (let i = 0; i < 4 && thumbQueue.length > 0; i += 1) drawThumbnail(thumbQueue.shift() as PaletteRow);
    drawThumbnailsSoon();
  }

  /** Draw one tile's picture now, once per pixel ratio. */
  function drawThumbnail(row: PaletteRow): void {
    if (!row.thumb || !row.kind || thumbDrawn.has(row) || typeof renderer.thumbnail !== 'function') return;
    if (thumbDpr === 0) thumbDpr = window.devicePixelRatio || 1;
    thumbDrawn.add(row);
    try {
      paintThumbnail(row.thumb, renderer.thumbnail(row.kind), thumbDpr);
    } catch (error) {
      // A failed read leaves the tile without a picture; its name and price still say it all.
      console.warn('ui: palette thumbnail failed', row.kind, error);
    }
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

  /**
   * The left edge of the card open on the right (a panel at SHEET_CARD_MIN_WIDTH and wider), by
   * cardLeft, or null. Measured once per card: its width, since its position may still be sliding in.
   */
  function openCardLeft(): number | null {
    const node = mountedPanel?.sheet?.node as HTMLElement | undefined;
    const width = viewportWidth();
    if (!mountedPanel || !node || width === undefined || width < SHEET_CARD_MIN_WIDTH) return null;
    if (cardEdge === null) {
      const view = viewSize ?? sizeOf(shell);
      cardEdge = cardLeft(view.width, sizeOf(node).width);
    }
    return cardEdge;
  }

  /**
   * The collapsed goals card lives under Share and Menu only, so a popover under Views never
   * touches it: at most as wide as Share's left edge to Menu's right edge, right-aligned under
   * Menu (ui.css reads both only for the pill above 720 px; its title ellipsizes). Runs with
   * every chrome measure: after layout, on resize, and when the top bar changes size.
   */
  function placeGoalsPill(view: { left: number; right: number }): void {
    const from = shareButton.getBoundingClientRect();
    const to = menuButton.getBoundingClientRect();
    const width = Math.round(to.right - from.left);
    if (!(width > 0)) return; // not laid out: leave the css fallback
    card.node.style.setProperty('--pill-max-w', `${width}px`);
    card.node.style.setProperty('--pill-right', `${Math.round(view.right - to.right)}px`);
  }

  /**
   * The Watch button sits centered under Views: its middle, from the top bar's left edge. Where
   * Views is not laid out (a phone keeps it in Settings) ui.css puts it on the right instead.
   */
  function placeWatchButton(): void {
    const views = view.button.getBoundingClientRect();
    const bar = top.getBoundingClientRect();
    const placed = views.width > 0;
    watchToggle.button.classList.toggle('is-placed', placed);
    if (placed) watchToggle.button.style.setProperty('--watch-x', `${Math.round(views.left + views.width / 2 - bar.left)}px`);
  }

  /** The view, a media query or a font changed under the chip and the bar: measure them again. */
  function onPlacementResize(): void {
    cardEdge = null;
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
        ? `panel:${panelKind}${panelKind === 'daily' ? `:${dailyKey()}` : ''}`
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
    cardEdge = null;
    // Closing: the controls an open panel hides on a phone (ui.css) come back before it goes,
    // so focus can return to the button that opened it (Menu, now bottom left).
    if (key === '') shell.classList.remove('is-panel-open');
    // A panel rebuilt in place (new numbers, another room) keeps focus where the player had it,
    // and still sends it back to where it came from when the panel finally closes.
    const old = mountedPanel?.sheet ?? null;
    const carried = old?.isOpen && old.hasFocus() ? { returnFocus: old.returnTarget, focusIndex: old.focusIndex() } : null;
    if (old) old.unmount({ restoreFocus: key === '' });
    else mountedPanel?.remove();
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
                    startToday: () => void switchTower(() => game.openDaily()),
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
                    : panelKind === 'feedback'
                      ? createFeedbackPanel(ctx)
                      : createQueryPanel(game, selection ?? {}, ctx);

    mountedPanel = panel;
    // The sheet slides in on its own (ui.css, @starting-style), a plain fade under reduced motion.
    if (panel.sheet) panel.sheet.mount(panelSlot, carried ?? {});
    else panelSlot.append(panel);
    // A card with its own first control (the feedback card's text box) takes focus there; Menu
    // stays the place focus goes back to when it closes.
    panel.initialFocus?.focus?.();
    if (key.startsWith('query:')) keepSelectionClearSoon();
  }

  /**
   * D-23: the thing clicked stays on screen beside its card. The renderer draws the new ring on
   * its next frame, so the check waits for it: a frame at a time, SELECTION_CLEAR_FRAMES at most
   * (a person the frame does not draw has no ring to keep clear).
   */
  function keepSelectionClearSoon(): void {
    if (selectionRaf) cancelAnimationFrame(selectionRaf);
    let frames = SELECTION_CLEAR_FRAMES;
    const look = (): void => {
      selectionRaf = 0;
      if (destroyed || !mountedKey.startsWith('query:')) return;
      frames -= 1;
      if (!keepSelectionClear() && frames > 0) selectionRaf = requestAnimationFrame(look);
    };
    selectionRaf = requestAnimationFrame(look);
  }

  /**
   * At SHEET_CARD_MIN_WIDTH and wider the query card stands on the right: ease the view so the
   * selection's ring sits left of it with SELECTION_CLEAR_PX clear. False while no ring is drawn.
   */
  function keepSelectionClear(): boolean {
    const edge = openCardLeft(); // null under SHEET_CARD_MIN_WIDTH, where the card is a bottom sheet
    if (edge === null) return true;
    if (typeof renderer.selectionScreenRect !== 'function' || !renderer.camera) return true;
    const rect = renderer.selectionScreenRect();
    if (!rect) return false;
    const x = selectionClearX(rect, edge, renderer.camera);
    if (x !== null) renderer.camera.easeToX(x);
    return true;
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
   * The newest log line of a batch becomes a news toast; an alert line is the alert stack's
   * card instead. A followed person's new beat becomes a toast only when no log line (an alert,
   * a build, anything) arrived in the same batch, no alert is the newest line, and the last
   * story toast is at least STORY_TOAST_GAP_MS old: alerts and build feedback win.
   */
  function refreshNews(): void {
    const world = game.world;
    const log = world.log;
    const newest = log.length > 0 ? log[log.length - 1] : undefined;
    const logMoved = world.logTotal !== newsLogSeen;
    const first = newsLogSeen < 0;
    const fresh = first ? 0 : Math.min(world.logTotal - newsLogSeen, log.length);
    newsLogSeen = world.logTotal;
    for (const line of log.slice(log.length - fresh)) {
      if (line.level !== 'warn') continue;
      warns += 1;
      if (line.text.startsWith(GIVE_UP_PREFIX)) giveUps += 1;
    }
    const beat = newFollowedBeat(world);
    if (logMoved && newest) {
      newsShowsAlert = newest.level === 'alert';
      // The first look is the tower as loaded: its old lines are history, not news.
      if (first || newsShowsAlert) return;
      // Watching: the News panel keeps the line; no toast rises over the tower (alerts still do).
      if (shell.classList.contains(WATCH_CLASS)) return;
      // A full tower logs warnings in bursts (give-ups, move-outs, people with no way out): one
      // folded toast now and then, not one each. The News panel keeps every line.
      if (newest.level === 'warn' && !acting) {
        const at = performance.now();
        if (at - giveUpShownAt < GIVE_UP_TOAST_GAP_MS) return;
        giveUpShownAt = at;
        const count = warns;
        const onlyGiveUps = giveUps === count;
        warns = 0;
        giveUps = 0;
        const text =
          count <= 1
            ? newest.text
            : onlyGiveUps
              ? `${count} people gave up waiting for an elevator.`
              : `${count} problems in the tower. Tap for the news.`;
        toastLayer.show(text, { onTap: openLog, tapLabel: 'Open the news' });
        return;
      }
      // A refusal of the player's own command is said as a notice where they acted.
      if (acting && newest.level === 'warn') return;
      // A refusal was already said as a notice where the player acted.
      if (newest.text === lastNoticeText) {
        lastNoticeText = '';
        return;
      }
      // Routine info (built, rented, checked out, cleaned) goes to the News panel only; a notable
      // one (a VIP, a wedding) still toasts, even when a routine line landed after it.
      const shown =
        newest.level === 'info' && !newest.notable
          ? log.slice(log.length - fresh).reverse().find((line) => line.level === 'info' && line.notable)
          : newest;
      if (!shown) return;
      // Only the sentence, in the News panel's plain voice; the panel keeps when it happened.
      toastLayer.show(shown.text, { onTap: openLog, tapLabel: 'Open the news' });
      return;
    }
    if (!beat || newsShowsAlert || beat.simId === undefined) return;
    if (shell.classList.contains(WATCH_CLASS)) return;
    const now = performance.now();
    if (now - storyShownAt < STORY_TOAST_GAP_MS) return;
    storyShownAt = now;
    toastLayer.show(`${storyName(world, beat.simId)}: ${describeBeat(beat, world)}`, {
      className: 'is-story',
      onTap: openLog,
      tapLabel: 'Open the news',
    });
  }

  function openLog(): void {
    setPanel('log');
  }

  /** The newest beat about a followed person since the news last looked, or null. */
  function newFollowedBeat(world: World): StoryBeat | null {
    const story = world.story;
    if (!story) return null;
    const fresh = Math.max(0, Math.min(story.seq - newsStorySeq, story.recent.length));
    newsStorySeq = story.seq;
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
      if (entry && entry.level === 'alert') {
        alerts.onAlert(entry);
        // Hidden, the system says it too (when the player turned Alerts on); visible, the card is the notice.
        notifier?.alert(entry.text);
      }
      if (entry && !demoCap.offered && isDemoCapEntry(entry)) demoCap.offer();
    }
    lastLogTotal = total;
    alerts.sync();
  }

  function notice(text: string): void {
    lastNoticeText = text;
    alerts.notice(text);
  }

  /** Run a command the player gave; a refusal becomes one notice, not a notice and a news toast. */
  function act(run: () => CommandResult): CommandResult {
    acting = true;
    let result: CommandResult;
    try {
      result = run();
    } finally {
      acting = false;
    }
    if (!result.ok) notice(result.reason);
    return result;
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

  /** The phone layout: the Build button and its sheet instead of the dock. */
  function inSheetLayout(): boolean {
    return isPhoneWidth(viewportWidth());
  }

  /** Skip to tower: focus the tower view itself, where the camera keys work. */
  function focusTower(): void {
    const target = typeof document !== 'undefined' ? (document.getElementById?.('view') as HTMLElement | null) : null;
    if (!target) return;
    if (!target.hasAttribute?.('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus?.();
  }

  // ---------------------------------------------------------- controller

  /** The cursor's point on screen: the middle of the band the camera frames the tower in. */
  function cursorPoint(): { x: number; y: number } {
    const box = shell.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + (viewBand.top + box.height) / 2 };
  }

  /** Something that holds focus for the d-pad: an open panel, the Views list, the build sheet. */
  function padMenu(): HTMLElement | null {
    if (view.isOpen()) return view.menu;
    if (mountedPanel) return (mountedPanel.sheet?.node as HTMLElement | undefined) ?? mountedPanel;
    const sheet = build.sheet();
    if (sheet === 'row' || sheet === 'full') return palette;
    return null;
  }

  /** Point, press and let go on the tower where the cursor is, as a mouse would. */
  function pointAtTower(kind: 'move' | 'click'): void {
    const canvas = typeof document !== 'undefined' ? (document.querySelector?.('#view canvas') as HTMLElement | null) : null;
    if (!canvas || typeof PointerEvent === 'undefined') return;
    const { x, y } = cursorPoint();
    const init = { clientX: x, clientY: y, pointerId: 99, pointerType: 'mouse', button: 0, buttons: 1, bubbles: true };
    canvas.dispatchEvent(new PointerEvent('pointermove', { ...init, buttons: 0 }));
    if (kind === 'move') return;
    canvas.dispatchEvent(new PointerEvent('pointerdown', init));
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
    canvas.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, button: 0, bubbles: true }));
  }

  /** A modal sheet (the phone-width panel, aria-modal) is on screen. */
  function modalSheetOpen(): boolean {
    const node = mountedPanel?.sheet?.node as HTMLElement | undefined;
    return node?.getAttribute?.('aria-modal') === 'true';
  }

  function padHandlers(): Parameters<typeof createGamepadInput>[0] {
    return {
      pan(dx, dy) {
        renderer.camera?.panBy(dx, dy);
        pointAtTower('move');
      },
      zoom(factor) {
        const { x, y } = cursorPoint();
        renderer.camera?.zoomAt(factor, x, y);
        pointAtTower('move');
      },
      a() {
        const active = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
        // A menu is open but focus fell out of it (a row it held was rebuilt): A goes back into
        // the menu, never through to the tower behind it.
        const menu = padMenu();
        if (menu && !(active && menu.contains(active))) {
          focusablesIn(menu)[0]?.focus?.();
          return;
        }
        if (active && active !== shell && shell.contains(active) && typeof active.click === 'function') {
          active.click();
          return;
        }
        pointAtTower('click');
      },
      b() {
        padBack();
        update();
      },
      speed(step) {
        game.setSpeed(stepSpeed(game.getSpeed(), step));
        update();
      },
      start() {
        setPanel(panelKind === 'settings' ? 'none' : 'settings');
      },
      dpad(direction: PadDirection) {
        const menu = padMenu();
        if (!menu) return false;
        const items = focusablesIn(menu);
        if (items.length === 0) return false;
        const active = typeof document !== 'undefined' ? document.activeElement : null;
        const at = items.indexOf(active as HTMLElement);
        const forward = direction === 'down' || direction === 'right';
        const next = at < 0 ? items[0] : items[(at + (forward ? 1 : -1) + items.length) % items.length];
        next?.focus?.();
        return true;
      },
      active(on) {
        padCursor.classList.toggle('is-hidden', !on);
        shell.classList.toggle('is-pad', on);
        if (!on) return;
        const { x, y } = cursorPoint();
        const box = shell.getBoundingClientRect();
        padCursor.style.left = `${Math.round(x - box.left)}px`;
        padCursor.style.top = `${Math.round(y - box.top)}px`;
      },
    };
  }

  /**
   * Every pad input but the connect and disconnect is the player's hand: watch mode hears it,
   * and while the chrome is hidden the first one only brings it back and does nothing else.
   */
  function watchedPad(handlers: ReturnType<typeof padHandlers>): ReturnType<typeof padHandlers> {
    return {
      ...handlers,
      pan(dx, dy) {
        if (!watch.input()) handlers.pan(dx, dy);
      },
      zoom(factor) {
        if (!watch.input()) handlers.zoom(factor);
      },
      a() {
        if (!watch.input()) handlers.a();
      },
      b() {
        if (!watch.input()) handlers.b();
      },
      speed(step) {
        if (!watch.input()) handlers.speed(step);
      },
      start() {
        if (!watch.input()) handlers.start();
      },
      dpad(direction) {
        // A press that only restored the chrome is spent: it does not pan either.
        return watch.input() || handlers.dpad(direction);
      },
    };
  }

  /** B: close the nearest thing open, else put the tool down. */
  function padBack(): void {
    if (view.isOpen()) {
      view.close({ restoreFocus: true });
      return;
    }
    const sheet = build.sheet();
    if (sheet === 'row' || sheet === 'full') {
      build.close();
      return;
    }
    if (panelKind !== 'none' || game.getSelection()) {
      ctx.close();
      return;
    }
    if (game.getPlacement()?.pending) game.cancelPending();
    game.setTool({ kind: 'none' });
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
    build.setCategory(row.group);
    // Picked before its category's pictures were drawn (a key, a quick tap): draw this one now,
    // so the phone's placing bar copies a picture, not a blank.
    drawThumbnail(row);
    if (game.world.stars < row.star) {
      notice(`${row.label} ${row.star === 1 ? 'needs 1 star' : `needs ${row.star} stars`}.`);
      if (hapticsEnabled()) haptics.play('refuse');
      return;
    }
    const tool = row.tool;
    game.setTool(toggle && sameTool(tool, game.getTool()) ? { kind: 'none' } : tool);
    // On a phone the sheet shrinks to the placing bar with the tool in hand (build.sync), so
    // the player can see where they are placing it.
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
    // The Views list and the phone build sheet close on Escape before anything else.
    if (event.key === 'Escape' && view.isOpen()) {
      event.preventDefault();
      view.close({ restoreFocus: true });
      return;
    }
    if (build.handleKey(event)) return;
    // An open sheet takes Escape (close) and Tab (stay inside) before anything else.
    if (mountedPanel?.sheet?.handleKey(event)) return;
    if (isFormField(event.target)) return;
    // A card with a text field is open: no key is ours, and none is the camera's either.
    if (mountedPanel && hasTextField(mountedPanel)) {
      event.stopImmediatePropagation();
      return;
    }
    const action = keyAction(event, keyGroups, activeGroup());
    if (!action) return;
    // Space on a focused button or switch presses that control; it is not the pause key there.
    if (action.kind === 'pause' && isPressable(event.target)) return;
    // Behind an open modal sheet the tower is out of reach: no tool, group or pause keys.
    if ((action.kind === 'pause' || action.kind === 'tool' || action.kind === 'group') && modalSheetOpen()) return;
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
        if (alerts.dismissNewest() || toastLayer.dismissNewestAlert()) {
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

  // A tap on a notification brought the game forward; an alert's also opens the news.
  notifier?.onTap((kind) => {
    if (destroyed || kind !== 'alerts') return;
    setPanel('log');
    update();
  });

  /**
   * A new version has installed. The toast stays until tapped, and a tap saves what moved and
   * then reloads: the pagehide save is fire and forget, so it is not trusted to finish first.
   */
  function updateReady(): void {
    if (destroyed || updateToldAt) return;
    updateToldAt = toastLayer.alert(UPDATE_TEXT, {
      className: 'is-update',
      action: 'Reload',
      tapLabel: 'Reload to get the new version',
      onTap: () => {
        const flushed = game.flush?.() ?? Promise.resolve();
        void flushed.catch(() => {}).finally(() => reload());
      },
    });
    notifier?.updateReady();
  }

  return {
    update,
    updateReady,
    destroy() {
      destroyed = true;
      if (selectionRaf) cancelAnimationFrame(selectionRaf);
      watch.destroy();
      watchToggle.destroy();
      display.stop();
      unsubscribeHaptics?.();
      pad?.destroy();
      view.destroy();
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
      toastLayer.destroy();
      if (mountedPanel?.sheet) mountedPanel.sheet.unmount({ restoreFocus: false });
      else mountedPanel?.remove();
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
 * Keep --top-actual on the shell equal to the bottom edge of the floating top bar, and tell
 * the caller the camera's band and the keep-out band whenever either changes.
 *
 * The bar wraps and the palette folds and turns into a sheet: one observer watches both. Where
 * there is no ResizeObserver the window resize alone keeps it roughly honest, which is what the
 * css falls back to anyway.
 */
function watchChrome(
  parts: { strip: HTMLElement; palette: HTMLElement; shell: HTMLElement },
  onChrome: (view: { top: number; bottom: number }, keepOut: { top: number; bottom: number }) => void,
  onMeasure: (shell: { left: number; right: number }) => void = () => {},
): ChromeWatch {
  let lastKey = '';
  const measure = (): void => {
    const strip = parts.strip.getBoundingClientRect();
    const shell = parts.shell.getBoundingClientRect();
    onMeasure(shell);
    const barBottom = strip.bottom - shell.top;
    parts.shell.style.setProperty('--top-actual', `${Math.round(barBottom)}px`);
    const paletteRect = parts.palette.getBoundingClientRect();
    // A closed phone sheet is not laid out at all: it covers nothing.
    const shown = paletteRect.height > 0;
    const measured = {
      shellHeight: shell.height,
      barBottom,
      paletteTop: shown ? paletteRect.top - shell.top : Infinity,
      sheet: shown && (isPhoneWidth(viewportWidth()) || isSheetLayout(paletteRect.width, shell.width)),
    };
    const view = viewInsets(measured);
    const keepOut = chromeInsets(measured);
    const key = `${view.top},${view.bottom},${keepOut.top},${keepOut.bottom}`;
    if (key === lastKey) return;
    lastKey = key;
    onChrome(view, keepOut);
  };
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
  if (observer) {
    observer.observe(parts.strip);
    observer.observe(parts.palette);
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

/**
 * A button that leads with its icon. The word sits beside it on a wide screen and is hidden on
 * a phone (ui.css), where the aria-label and the tooltip still name it.
 */
function iconButton(glyph: IconName, label: string, tip: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = button('', `hs-icon-btn ${className}`, onClick);
  node.append(icon(glyph, 'hs-icon hs-btn-icon') as unknown as HTMLElement, el('span', 'hs-btn-label', label));
  node.setAttribute('aria-label', label);
  node.title = tip;
  return node;
}

/** The window's width in css pixels, or undefined where there is none to ask. */
function viewportWidth(): number | undefined {
  try {
    return typeof window === 'undefined' ? undefined : (window as { innerWidth?: number }).innerWidth;
  } catch {
    return undefined;
  }
}

/** Can a haptic be felt here: inside the apps, or on a touch screen that can vibrate. */
function hapticsCapable(): boolean {
  try {
    if ((globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() === true) return true;
    const nav = typeof navigator === 'undefined' ? null : (navigator as { vibrate?: unknown });
    return typeof nav?.vibrate === 'function' && coarsePointer();
  } catch {
    return false;
  }
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
