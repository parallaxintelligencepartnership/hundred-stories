// The chrome around the tower: the floating top bar, directory board palette, query panel,
// finances, settings, Stories, and the toasts that carry the news. It talks to the game through GameApi only.
// Nothing here touches the document until createUi runs, so the module imports cleanly in tests.

import './ui.css';

import { createSound } from '../audio/audio';
import type { GameApi, LeaveResult, Placement, Speed, Tool } from '../game/api';
import { DAILY_OVER_REASON, LEAVE_NOT_SAVED } from '../game/game';
import { showLeaveCard } from './leave-card';
import type { Renderer } from '../render/renderer';
import { describeBeat, followSim, isFollowed, storyName, type StoryBeat } from '../sim/story';
import type { Command, CommandResult, LogEntry, World } from '../sim/types';
import { createIntroPanel, createSideCard, createStarToast, createTipToast } from './cards';
import { unlocksText } from '../sim/chronicle';
import { createAlertStack, isVipArrivalLine, type GameOverAction } from './alerts';
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
import { PREF_KEYS, addToList, getFlag, getList, getPref, onPrefChange, setFlag, setPref } from './prefs';
import { createIconSheet, icon, type IconName } from './icons';
import { chromeInsets, createViewChipRow, isSheetLayout, placementBoxes, viewChipMeets, viewInsets } from './layout';
import { createToasts } from './toast';
import type { Box } from './layout';
import { anchorCard, CARD_RING_WAIT_FRAMES, cardMaxHeight, cardStaysPut, type CardBounds } from './card-anchor';
import {
  applyGlassClear,
  button,
  createChroniclePanel,
  createFinancesPanel,
  createQueryPanel,
  controlsBody,
  createRecapPanel,
  createSharePanel,
  el,
  exportSave,
  freshStart,
  HOW_TO_PLAY_HREF,
  guideOpensOutside,
  openGuideOutside,
  readGlassClear,
  settingsBody,
  shareBody,
} from './panels';
import { towerProblems } from './problems';
import { storiesBody, type StoriesBody, type StoriesTarget } from './stories';
import type { PanelBody, PanelContext, PanelElement } from './panels';
import { GROUPS, applyRowState, buildPalette, paintThumbnail, sameTool, toolRowState } from './palette';
import { hasTextField, isFormField, keyAction, stepSpeed } from './keys';
import { createMinimap, type Minimap } from './minimap';
import type { PaletteRow } from './palette';
import { createStatusBar, speedModeText } from './status';
import { demolishNotice, placementNote } from './explain';
import { createHoverCard } from './hover';
import { createViewControl } from './overlays';
import { createDailyPanel, dailyCard, dailyPeekBody, DAILY_TITLE, freshPeek, type DailyGo } from './daily';
import { createBuildDock, isPhoneWidth } from './build';
import { pageRoot, watchDisplayPrefs } from './display';
import { createPageHaptics, hapticsEnabled } from './haptics';
import { createGamepadInput, pageGamepadDeps, type GamepadInput, type PadDirection } from './gamepad';
import { focusablesIn, SHEET_CARD_MIN_WIDTH } from './sheet';
import { createQuietLabels } from './quiet-labels';
import { WATCH_CLASS, createWatchMode, createWatchToggle } from './watch';
import { createSoundToggle } from './sound-toggle';
import { createSaveAction, createSaveButton, SAVE_TIP, SAVE_WORD, type SaveAction, type SaveQuestion } from './save-button';
import { createPauseMenu, NEW_TOWER_NO, NEW_TOWER_QUESTION, NEW_TOWER_YES, type PauseEntry, type PausePage } from './pause-menu';
import { UPDATE_TEXT, type Notifier } from './notify';
import { clipsBody, clipsOpenOutside, CLIPS_TITLE, openClipsOutside, toggleClip, type ClipsBody } from './clips';
import { createExitScreen, EXIT_SAVING_WORD, EXIT_WORD, type ExitScreen } from './exit-screen';

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

type PanelKind = 'none' | 'finances' | 'share' | 'intro' | 'recap' | 'chronicle' | 'daily' | 'feedback';

/** Real milliseconds the star card stays up unless closed first. */
export const STAR_CARD_LINGER_MS = 20_000;
/** A followed person's story line becomes a news toast at most this often, in real time. */
export const STORY_TOAST_GAP_MS = 30_000;
/** What a tap on a news toast does, for the tooltip and a screen reader. */
export const STORIES_TAP_LABEL = 'Open Stories';
/** Give-up lines ("Gave up waiting for an elevator...") fold into one toast at most this often. */
export const GIVE_UP_TOAST_GAP_MS = 20_000;

/** The live measurement of the chrome: stop it, or ask it to measure again. */
interface ChromeWatch {
  measure(): void;
  disconnect(): void;
}

/** ui.css --edge: how far a card open on the right sits from the edge. */
const CARD_EDGE = 12;
/** A card beside a selection keeps this far from the dock and from the round buttons' row (ui.css --gap-float). */
const CARD_GAP = 8;
/** ui.css --gap-float: the least room kept between the view's chip and a round button. */
const VIEW_CHIP_GAP = 8;

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

/**
 * The left edge of a card open on the right, in the shell's css px: the shell's width less the
 * card and two edges. Only panels that are not about a thing on the tower stand there now (a
 * room, person or elevator card stands beside its selection, card-anchor.ts); the hover card
 * keeps out from under this edge (openCardLeft).
 */
export function cardLeft(shellWidth: number, panelWidth: number): number {
  return shellWidth - (panelWidth + 2 * CARD_EDGE);
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
  // Save and exit (saveAndExit): the exited screen while it is up, and a leave in flight from the
  // menu entry (its entry busy and saying so for the whole save).
  let exitScreen: ExitScreen | null = null;
  let exitInFlight = false;
  // The update toast's Reload, from the tap until the player keeps playing: a second tap starts nothing.
  let reloading = false;
  // A leave card owed while Send feedback or the intro covers the menu: shown once the menu is back.
  let leaveCardOwed: (() => void) | null = null;
  let exitEntry: { setBusy(busy: boolean): void; setWord(text: string): void } | null = null;
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
  /**
   * A room, person or elevator card at SHEET_CARD_MIN_WIDTH and wider stands beside its selection
   * (anchorCard) and follows it on the placement loop's frames; a person's card is placed once and
   * stays put (cardStaysPut). The area it may use and its size
   * are measured once and kept until something can change them (a resize, the chrome or the dock
   * moving, the card's own size); where it last stood is kept for a selection off screen.
   */
  let cardBounds: CardBounds | null = null;
  /** The rows cardBounds was measured under (cardRowsKey). */
  let cardRows = '';
  let cardBox: Box | null = null;
  let cardDock: 'left' | 'right' = 'left';
  let cardPlace: { left: number; top: number } | null = null;
  let cardPlacedKey = '';
  /** The open card is about a person: placed once, then it stays put (cardStaysPut). */
  let cardStill = false;
  /** The open card has had its own place: beside its ring, or the fixed spot after the wait. */
  let cardSettled = false;
  /** Placement frames the open card has waited for its ring (CARD_RING_WAIT_FRAMES). */
  let cardWait = 0;
  /** The open card still stands where the card before it stood, until its own ring is drawn. */
  let cardCarried = false;
  const cardSizeWatch =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          cardBox = null;
        });
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
  /** A switch to Today's tower answered on the menu's page is under way: its card waits (switchTower decides). */
  let dailyQuiet = false;

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
    // The chip is up, gone or another width: whether it shares the buttons' row is new.
    placeWatchButton();
  });
  const viewChipRow = createViewChipRow();
  // The first-run hint's row under Save, Sound and Watch: decided per layout, like the view chip's.
  const hintRow = createViewChipRow();

  pill.append(status.cash, status.population, status.stars, status.clock, hoverReadout);
  top.append(view.chip);
  // Watch mode's round button, under Views (placeWatchButton; on a phone, where Views lives in
  // Settings, under the pill on the right). It steps aside with the rest of the chrome.
  const watchToggle = createWatchToggle();
  // Sound's round button, directly left of Watch (placeWatchButton), the same size and hidden
  // with it. It and the Settings switch turn the same setting and follow each other.
  const soundToggle = createSoundToggle(sound);
  // Save's round button, directly left of Sound (placeWatchButton): the same save and the same
  // notice as Settings, Save now, in every tower that row shows in (all three). Hidden with them.
  // In the one state where a save replaces something (My tower's save did not open and a stand-in
  // runs) it asks first, in the pause card, opened for the question and closed by its answer.
  const saveButton = createSaveButton({
    save: () => game.save(),
    notice: (text) => notice(text),
    heldSave: { held: () => game.saveHeld?.() ?? false, ask: (question) => askSaveInMenu(question, true) },
  });
  top.append(saveButton.button, soundToggle.button, watchToggle.button);
  const stopSoundPref = onPrefChange((key) => {
    if (key !== PREF_KEYS.sound) return;
    mountedPanel?.refresh?.();
    pauseMenu.refresh(); // the Settings page's switch too
  });

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
      // The pause menu holds the speed (Settings over it leaves this pill in reach): only Resume
      // sets it again, so the card never reads "Paused" over a running game.
      if (pauseMenu.isOpen()) return;
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
  // Menu opens the pause menu (src/ui/pause-menu.ts); a second press, with it or anything it
  // opened still up, resumes.
  const menuButton = iconButton('menu', 'Menu', 'Open the menu', 'hs-round', () => togglePauseMenu());
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
    syncHintStep(true);
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
    openStories: (target) => openStories(target),
    // The VIP arrival card's See the guest and See the suite.
    selectGuest: (simId) => ctx.select?.({ simId }),
    centerOn: (floor, x) => ctx.centerOn?.(floor, x),
    // A finished Today's tower refuses every command: its spend buttons say so, its chips go.
    refusal: () => (game.getDaily?.()?.finished ? DAILY_OVER_REASON : null),
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
  function openSavedText(text: string): Promise<void> {
    return game.importSave(text).then((result) => {
      // The file lands in My tower: the address drops a friend's or today's query with it.
      if (result.ok) syncAddress();
      notice(result.ok ? 'Tower opened.' : result.reason);
    });
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
              const saved = game.newGame(Math.floor(Date.now() % 1_000_000));
              notice('New game started.');
              void saved.then((res) => {
                if (!res.ok) notice(res.reason);
              });
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
          .then((text) => (text !== null ? openSavedText(text) : undefined))
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
  const hoverCard = createHoverCard(shell, game, () => chromeBand, openCardLeft, anchoredCardBox);
  shell.append(hoverCard.node);

  // Smart hiding: after 2 s idle the Watch and Sound words fold to the icon (ui.css), and any
  // input brings them back. Watch's width changes over --label-fade, so Sound, which ends one gap
  // left of it, is measured again on every frame until the fold ends (or 500 ms, whichever first).
  // Made before Watch mode so it hears the input that only brings Watch's chrome back, too.
  let labelRaf = 0;
  let labelUntil = 0;
  const onLabelFrame = (): void => {
    labelRaf = 0;
    if (destroyed) return;
    placeWatchButton();
    if (Date.now() < labelUntil) labelRaf = requestAnimationFrame(onLabelFrame);
  };
  const stopLabelFrames = (): void => {
    labelUntil = 0;
    if (labelRaf) cancelAnimationFrame(labelRaf);
    labelRaf = 0;
  };
  const onLabelTransitionEnd = (event: Event): void => {
    const { target, propertyName } = event as TransitionEvent;
    if (propertyName !== 'max-width' && !propertyName?.startsWith('padding')) return;
    if (target && watchToggle.button.contains(target as Node)) {
      stopLabelFrames();
      placeWatchButton();
    }
  };
  watchToggle.button.addEventListener('transitionend', onLabelTransitionEnd);
  const quietLabels = createQuietLabels({
    shell,
    onChange: () => {
      if (typeof requestAnimationFrame !== 'function') {
        placeWatchButton();
        return;
      }
      labelUntil = Date.now() + 500;
      if (!labelRaf) labelRaf = requestAnimationFrame(onLabelFrame);
    },
  });

  // Watch mode (the Watch button, off by default): turned on, the chrome steps aside at once,
  // all but the clock; any input brings it back, and 5 s idle with nothing open hides it again.
  // The phone's build sheet at its row is not "open": it closes as the chrome steps aside.
  // A room or an elevator in hand is a placement in progress: its placing bar (Cancel, Build,
  // the nudges) stays up, or the game looks stuck mid-placement.
  const placing = (): boolean => {
    const kind = game.getTool().kind;
    return kind === 'room' || kind === 'shaft';
  };
  const watch = createWatchMode({
    shell,
    busy: () =>
      mountedPanel !== null || pauseMenu.isOpen() || view.isOpen() || build.sheet() === 'full' || guideActive() || placing(),
    onWatch: () => {
      if (build.sheet() === 'row') build.close();
    },
    // Turned on: whatever is open closes, so the countdown starts at once (Matt, 2026-09-28).
    // The guided first tower still holds Watch off; a room in hand stays in hand. A panel holding
    // the player's work (unsent feedback, a share image still being made) is never thrown away:
    // it stays open and Watch waits for it as before (Matt, 2026-09-28, review of 38f23ec).
    onEnable: () => {
      if (guideActive()) return;
      if (view.isOpen()) view.close();
      const sheet = build.sheet();
      if (sheet === 'row' || sheet === 'full') build.close();
      if (game.getSelection()) game.select(null);
      // The pause menu closes like any other panel, the speed put back, focus left on Watch; it
      // closes even under a card holding work, so that card closing later goes back to the game.
      pauseMenu.close({ restoreFocus: false });
      if (!mountedPanel?.holdsWork?.()) setPanel('none');
      else update();
    },
  });

  // The pause menu: a card over the dimmed tower, the game held still while it is up. Its Save
  // runs the same save and says the same notice as the round Save button.
  let menuSave: SaveAction | null = null;
  /** True while update() runs, so the menu's own redraw request does not re-enter it. */
  let updating = false;
  const pauseMenu = createPauseMenu({
    host: shell,
    getSpeed: () => game.getSpeed(),
    setSpeed: (speed) => game.setSpeed(speed),
    entries: () => pauseEntries(),
    cue: (name) => sound.cue?.(name),
    returnFocus: () => menuButton,
    changed() {
      shell.classList.toggle('is-paused-menu', pauseMenu.isShown());
      if (!updating) update();
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
    syncAddress,
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
    centerOn(floor, x) {
      // A renderer without a camera (tests) has nowhere to look.
      renderer.camera?.centerOn(floor, x);
    },
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
    // The bar, its round buttons or the dock moved: the card beside a selection measures its room again.
    cardBounds = null;
    if (anchoredCard()) startPlacementLoop();
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
  const pad: GamepadInput | null = padDeps ? createGamepadInput(exitPad(watchedPad(padHandlers())), padDeps) : null;

  lastLogTotal = game.world.logTotal;
  // The menu holds the game still while it is open: a saved file opened from its Settings page
  // starts the tower's clock, and the menu takes that speed as the one to give back on close.
  const unsubscribe = game.subscribe(() => {
    if (pauseMenu.isOpen()) pauseMenu.hold();
    update();
  });
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
    const outer = !updating;
    updating = true;
    try {
      updateNow();
    } finally {
      if (outer) updating = false;
    }
  }

  function updateNow(): void {
    const world = game.world;
    const speed = game.getSpeed();
    if (world !== seenWorld) onWorld(world);
    myTowerButton.hidden = (game.getSlot?.() ?? 'mine') === 'mine';
    watchDaily();

    status.update(world, speed);
    syncHintStep();

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
        openPanelFromToast('recap');
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
    if (dailyQuiet) return;
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
  async function switchTower(open: () => Promise<CommandResult | void>, quiet = false): Promise<void> {
    const result = await open();
    // A switch refused (the tower being left did not save) says why, every time.
    if (result && !result.ok) notice(result.reason);
    syncAddress();
    panelKind = 'none';
    // Quiet: the menu's Today's tower page already said what the card would, and the player
    // answered it there, so the card does not come up again by itself. A choice still waiting
    // (a copy that could not be kept, a slot that changed since the page read it) still shows.
    dailyShownKey = quiet && !game.getDailyChoice?.() ? dailyKey() : '';
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
      if (!anchoredCard()) stopPlacementLoop(); // a card beside a selection still follows it
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
    // A card beside its selection is not on the right edge: the preview keeps off its box
    // instead (anchoredCardBox). One on the fixed spot (no ring drawn) is kept to, as any card.
    if (mountedKey.startsWith('query:') && node.classList.contains('is-anchored')) return null;
    if (cardEdge === null) {
      const view = viewSize ?? sizeOf(shell);
      cardEdge = cardLeft(view.width, sizeOf(node).width);
    }
    return cardEdge;
  }

  /**
   * The card standing beside its selection, from where it was last put and its kept size (no
   * layout read), for the hover card to keep off. Null while no card is anchored.
   */
  function anchoredCardBox(): { left: number; top: number; right: number; bottom: number } | null {
    const node = anchoredCard();
    if (!node || !cardPlace || !cardBox || !node.classList.contains('is-anchored')) return null;
    const height = cardBounds ? Math.min(cardBox.height, cardMaxHeight(cardBounds)) : cardBox.height;
    return { left: cardPlace.left, top: cardPlace.top, right: cardPlace.left + cardBox.width, bottom: cardPlace.top + height };
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
    // Sound ends one gap left of Watch's left edge, wherever Watch landed (ui.css adds the gap).
    const watch = watchToggle.button.getBoundingClientRect();
    const soundPlaced = watch.width > 0;
    soundToggle.button.classList.toggle('is-placed', soundPlaced);
    if (soundPlaced) soundToggle.button.style.setProperty('--sound-x', `${Math.round(watch.left - bar.left)}px`);
    // Save ends the same gap left of Sound's left edge. Right of Watch is the goals pill's (under
    // Share and Menu), and a phone keeps Watch at the right edge, so Save takes the left end.
    const soundBox = soundToggle.button.getBoundingClientRect();
    const savePlaced = soundPlaced && soundBox.width > 0;
    saveButton.button.classList.toggle('is-placed', savePlaced);
    if (savePlaced) saveButton.button.style.setProperty('--save-x', `${Math.round(soundBox.left - bar.left)}px`);
    placeViewChip(bar);
    syncHintStep(true);
  }

  /**
   * The view's chip is centered under the bar, in the row of Save, Sound and Watch. Where it would
   * meet one of them it takes the row under theirs (ui.css is-view-low), so none of them covers
   * its close button. A phone keeps it clear of them by its own width (ui.css).
   *
   * What hangs under it (the night speed chip, the first-run hint) steps down by --chip-h: here
   * the chip's measured bottom below the bar's, taken after its row is settled, so a chip whose
   * words wrap to two lines pushes them down by its real height, not a one-line guess. Without a
   * laid out chip (none up, or a phone) ui.css's own figure stands.
   */
  function placeViewChip(bar: { width: number; bottom: number }): void {
    const chip = view.chip.getBoundingClientRect();
    if (inSheetLayout() || !(chip.width > 0)) {
      shell.classList.remove('is-view-low');
      shell.style.removeProperty('--chip-h');
      return;
    }
    const buttons = [saveButton.button, soundToggle.button, watchToggle.button].map((b) => b.getBoundingClientRect());
    const meets = viewChipMeets(chip, buttons, VIEW_CHIP_GAP);
    shell.classList.toggle('is-view-low', viewChipRow(`${Math.round(chip.width)}|${Math.round(bar.width)}`, meets));
    const settled = view.chip.getBoundingClientRect();
    shell.style.setProperty('--chip-h', `${Math.ceil(settled.bottom - bar.bottom)}px`);
  }

  /**
   * On a wide screen the night speed chip hangs under the bar in the first-run hint's row: while
   * both are up the hint takes the row under (ui.css is-hint-low), so neither covers the other.
   * The hint is centered in the round buttons' row too: where it would meet Save, Sound or Watch
   * (measured, as the view chip is) it takes the row under theirs (ui.css is-hint-under), so no
   * tap aimed at Save lands on the hint for its first three loads (P1 review A-2).
   *
   * That measure runs only with `measure` set: when the bar re-measures (placeWatchButton, on a
   * resize or the chrome moving) and when the hint is shown or closed. updateNow runs every step
   * and keeps is-hint-low only, so the hint and the round buttons are not read every frame.
   */
  function syncHintStep(measure = false): void {
    const up = !hint.classList.contains('is-hidden');
    shell.classList.toggle('is-hint-low', up && !status.mode.classList.contains('is-hidden'));
    if (!measure && up) return;
    let under = false;
    if (up && !inSheetLayout()) {
      const box = hint.getBoundingClientRect();
      if (box.width > 0) {
        const buttons = [saveButton.button, soundToggle.button, watchToggle.button].map((b) => b.getBoundingClientRect());
        const bar = top.getBoundingClientRect();
        under = hintRow(`${Math.round(box.width)}|${Math.round(bar.width)}`, viewChipMeets(box, buttons, VIEW_CHIP_GAP));
      }
    }
    shell.classList.toggle('is-hint-under', under);
  }

  /** The view, a media query or a font changed under the chip and the bar: measure them again. */
  function onPlacementResize(): void {
    cardEdge = null;
    viewSize = null;
    chipSize = null;
    barSize = null;
    cardBounds = null;
    cardBox = null;
    refreshPlacement();
    if (anchoredCard()) startPlacementLoop();
  }

  // A pan or a pinch moves the ghost and the selection without telling anyone, so the chip, the
  // bar and a card beside a selection follow them on these frames, and only for as long as there
  // is a ghost on the tower or such a card open.
  function startPlacementLoop(): void {
    if (placementRaf || destroyed) return;
    placementRaf = requestAnimationFrame(onPlacementFrame);
  }

  function onPlacementFrame(): void {
    placementRaf = 0;
    if (destroyed) return;
    const ghost = !!game.getPlacement();
    if (ghost) positionPlacement();
    else {
      chip.classList.add('is-hidden');
      bar.classList.add('is-hidden');
    }
    const following = placeAnchoredCard();
    if (ghost || following) startPlacementLoop();
  }

  /** The open room, person or elevator card's dialog, while there is one. */
  function anchoredCard(): HTMLElement | null {
    if (!mountedKey.startsWith('query:')) return null;
    return (mountedPanel?.sheet?.node as HTMLElement | undefined) ?? null;
  }

  /**
   * The room a card beside a selection may use, in the shell's css px: clear of the dock (on the
   * left at these widths), below the top bar and its row of round buttons, and inside the edges
   * and the safe area. The sides are read off the top bar, which stands an edge and the safe area
   * in on both; the bottom off the alerts' corner, an edge and the safe area up from the bottom.
   * Null while nothing is laid out.
   */
  function measureCardBounds(): CardBounds | null {
    cardRows = cardRowsKey();
    return measureCardBox();
  }

  /**
   * What decides the rows the card stays below, read off classes only (no layout): the view chip
   * and the hint up or not, and the rows ui.css gives them. A change measures the bounds again.
   */
  function cardRowsKey(): string {
    const on = (node: HTMLElement, name: string): string => (node.classList.contains(name) ? '1' : '0');
    return `${on(view.chip, 'is-hidden')}${on(hint, 'is-hidden')}${on(shell, 'is-view-low')}${on(shell, 'is-hint-under')}${on(shell, 'is-hint-low')}`;
  }

  function measureCardBox(): CardBounds | null {
    const shellBox = shell.getBoundingClientRect();
    if (!(shellBox.width > 0 && shellBox.height > 0)) return null;
    const laidOut = (r: { width: number; height: number }): boolean => r.width > 0 && r.height > 0;
    const bar = top.getBoundingClientRect();
    // The view chip and the first-run hint, while up, take a row under the round buttons (ui.css
    // is-view-low, is-hint-under): the card stays below them too, so it never covers their close.
    const below = [view.chip, hint].filter((n) => !n.classList.contains('is-hidden'));
    const rows = [bar, ...[saveButton.button, soundToggle.button, watchToggle.button, view.button, shareButton, menuButton, ...below].map((n) => n.getBoundingClientRect())].filter(laidOut);
    const rowBottom = rows.reduce((at, r) => Math.max(at, r.bottom - shellBox.top), 0);
    const barShown = laidOut(bar);
    let left = barShown ? Math.max(0, bar.left - shellBox.left) : CARD_EDGE;
    let right = barShown ? Math.min(shellBox.width, bar.right - shellBox.left) : shellBox.width - CARD_EDGE;
    const corner = toasts.getBoundingClientRect();
    const bottom = corner.bottom > shellBox.top && corner.bottom <= shellBox.bottom ? corner.bottom - shellBox.top : shellBox.height - CARD_EDGE;
    const dock = palette.getBoundingClientRect();
    const dockShown = laidOut(dock);
    cardDock = dockShown && dock.left + dock.width / 2 - shellBox.left > shellBox.width / 2 ? 'right' : 'left';
    if (dockShown && cardDock === 'left') left = Math.max(left, dock.right - shellBox.left + CARD_GAP);
    if (dockShown && cardDock === 'right') right = Math.min(right, dock.left - shellBox.left - CARD_GAP);
    return { left: Math.round(left), top: Math.round(rowBottom + CARD_GAP), right: Math.round(right), bottom: Math.round(bottom) };
  }

  /**
   * Stand the open room, person or elevator card beside its selection (anchorCard): written as
   * --card-left, --card-top and --card-max-h on the dialog with ui.css .is-anchored, and only
   * when they change. True while there is such a card to keep following. Under
   * SHEET_CARD_MIN_WIDTH it is a bottom sheet and nothing is written; a resize back starts again.
   */
  function placeAnchoredCard(): boolean {
    const node = anchoredCard();
    if (!node) return false;
    const width = viewportWidth();
    if (width === undefined || width < SHEET_CARD_MIN_WIDTH) {
      if (node.classList.contains('is-anchored')) node.classList.remove('is-anchored');
      cardPlace = null;
      cardPlacedKey = '';
      // Wide again, the card is placed afresh beside its selection, a person's card too.
      cardSettled = false;
      cardWait = 0;
      cardCarried = false;
      return false;
    }
    if (cardBounds && cardRowsKey() !== cardRows) cardBounds = null; // the chip or the hint came or went
    if (!cardBounds) {
      cardBounds = measureCardBounds();
      if (!cardBounds) return true; // not laid out yet: next frame
      node.style.setProperty('--card-max-h', `${cardMaxHeight(cardBounds)}px`);
      cardPlacedKey = '';
    }
    if (!cardBox) {
      const box = sizeOf(node);
      if (!(box.width > 0)) return true;
      cardBox = box;
    }
    // A person's card, once placed, no longer reads the ring: it stays where it was put, only
    // kept inside the bounds (a resize, the chrome moving).
    const ring = typeof renderer.selectionScreenRect === 'function' ? renderer.selectionScreenRect() : null;
    const selection = cardStill && cardSettled ? null : ring;
    const at = anchorCard({
      selection,
      card: cardBox,
      bounds: cardBounds,
      view: viewSize ?? (viewSize = sizeOf(shell)),
      dock: cardDock,
      previous: cardPlace,
    });
    if (!at || at.side === 'kept') {
      // No ring of its own yet. Past the wait, a card still on the last card's spot goes to the
      // fixed spot instead (ui.css, without is-anchored); a ring drawn later still places a room's.
      if (!cardSettled && ++cardWait >= CARD_RING_WAIT_FRAMES) {
        cardSettled = true;
        if (cardCarried) {
          cardCarried = false;
          cardPlace = null;
          cardPlacedKey = '';
          node.classList.remove('is-anchored');
          node.removeAttribute('data-side');
          return true;
        }
      }
      if (!at) return true;
      // A person's card that stands where it was put writes nothing.
      if (cardStill && cardPlace && at.left === cardPlace.left && at.top === cardPlace.top) return true;
    } else {
      cardSettled = true;
      cardCarried = false;
    }
    const key = `${at.left},${at.top},${at.side}`;
    if (key === cardPlacedKey) return true;
    cardPlacedKey = key;
    cardPlace = { left: at.left, top: at.top };
    node.style.setProperty('--card-left', `${at.left}px`);
    node.style.setProperty('--card-top', `${at.top}px`);
    node.setAttribute('data-side', at.side);
    if (!node.classList.contains('is-anchored')) node.classList.add('is-anchored');
    return true;
  }

  function stopPlacementLoop(): void {
    if (!placementRaf) return;
    cancelAnimationFrame(placementRaf);
    placementRaf = 0;
  }

  function refreshPanel(): void {
    // What the Settings page opened over the game (Send feedback, the intro) has closed: the menu
    // comes back on that page, not the game.
    // The exited screen keeps the menu out of sight under it.
    if (panelKind === 'none' && pauseMenu.isOpen() && !pauseMenu.isShown() && !exitScreen) pauseMenu.show();
    showOwedLeaveCard();
    // A page in the pause menu (Settings, Stories) keeps its live parts current, as a panel does.
    pauseMenu.refresh();
    const selection = game.getSelection();
    // While the menu is on screen no card stands beside it; the one it covered comes back after.
    // The exited screen too: no card waits under it to take focus; Continue tower brings it back.
    const key = pauseMenu.isShown() || exitScreen
      ? ''
      : panelKind !== 'none'
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
    cardSizeWatch?.disconnect();
    if (key.startsWith('panel:')) cardPlace = null;
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
    if (key.startsWith('query:')) keepSelectionClear(panel.sheet?.node as HTMLElement | undefined, selection);
  }

  /**
   * The thing clicked stays in sight beside its card (owner ruling 2026-10-01, which replaced the
   * D-23 camera ease): at SHEET_CARD_MIN_WIDTH and wider the card stands beside the selection's
   * ring and follows it on the placement loop's frames (placeAnchoredCard), so the view never
   * has to move. The renderer draws the new ring on its next frame; until then the card keeps
   * its fixed spot under the round buttons. A phone's bottom sheet needs none of it.
   */
  function keepSelectionClear(node: HTMLElement | undefined, selection: Parameters<typeof cardStaysPut>[0]): void {
    const carried = cardPlace;
    cardBox = null;
    cardPlace = null;
    cardPlacedKey = '';
    cardStill = cardStaysPut(selection);
    cardSettled = false;
    cardWait = 0;
    cardCarried = false;
    cardSizeWatch?.disconnect();
    if (!node) return;
    cardSizeWatch?.observe(node);
    // Another selection while a card stood beside the last one: the new card starts where that
    // one stood and moves to its own selection once the ring is drawn, rather than from the corner.
    // A ring not drawn within CARD_RING_WAIT_FRAMES sends it to the fixed spot (placeAnchoredCard).
    const width = viewportWidth();
    if (carried && cardBounds && width !== undefined && width >= SHEET_CARD_MIN_WIDTH) {
      node.style.setProperty('--card-max-h', `${cardMaxHeight(cardBounds)}px`);
      node.style.setProperty('--card-left', `${carried.left}px`);
      node.style.setProperty('--card-top', `${carried.top}px`);
      node.classList.add('is-anchored');
      cardPlace = carried;
      cardCarried = true;
      cardPlacedKey = `${carried.left},${carried.top},kept`;
      node.setAttribute('data-side', 'kept');
    } else if (cardBounds) {
      node.style.setProperty('--card-max-h', `${cardMaxHeight(cardBounds)}px`);
    }
    startPlacementLoop();
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
    /** The newest line was a refused demolish from a tap on the tower, already said as a notice. */
    let newestNoticed = false;
    for (const line of log.slice(log.length - fresh)) {
      if (line.level !== 'warn') continue;
      // The player's own refused command is said as a notice, never as the next warning toast:
      // logged while acting, or seen a frame later as the notice's words.
      if ((acting && line === newest) || line.text === lastNoticeText) continue;
      // A refused demolish from a tap on the tower is the player's own too: a notice with what to
      // do, where the warning toast's gap, its count and Watch mode cannot swallow it.
      const said = acting ? null : demolishNotice(line.text);
      if (said !== null) {
        // Straight to the stack, not notice(): this line is already handled, and its words kept
        // as lastNoticeText would make the skip above eat the next tap's identical line (review
        // of 38f23ec, S1). A repeat replaces the card on screen instead of stacking.
        alerts.notice(said, { replace: true });
        if (line === newest) newestNoticed = true;
        continue;
      }
    }
    const beat = newFollowedBeat(world);
    if (logMoved && newest) {
      newsShowsAlert = newest.level === 'alert';
      // The first look is the tower as loaded: its old lines are history, not news.
      if (first) return;
      // Watching: Stories keeps the line; no toast rises over the tower (alerts still do).
      if (shell.classList.contains(WATCH_CLASS)) return;
      if (newsShowsAlert) {
        // An alert is its card. A notable line in the same batch still toasts beside it: the
        // quarter settle line is logged just before the debt warnings it explains.
        const notable = log.slice(log.length - fresh).reverse().find((line) => line.level === 'info' && line.notable && !isVipArrivalLine(line));
        if (notable) toastLayer.show(notable.text, { onTap: () => openStories(lineTarget(notable)), tapLabel: STORIES_TAP_LABEL });
        return;
      }
      if (newestNoticed) return;
      // A full tower logs warnings in bursts (give-ups, move-outs, people with no way out): one
      // folded toast now and then, not one each. It speaks for what is wrong right now, as the
      // page's Tower problems lists it, so its number is the page's number of rows: one problem
      // in its own words, several as a count. With nothing wrong now, the newest warning is
      // history (a move-out, say) and the toast is that line, kept in Today.
      if (newest.level === 'warn' && !acting) {
        const at = performance.now();
        if (at - giveUpShownAt < GIVE_UP_TOAST_GAP_MS) return;
        giveUpShownAt = at;
        // A snapshot: the count is taken now, and the page counts again when the toast is tapped.
        const problems = towerProblems(world);
        const only = problems.length === 1 ? problems[0] : undefined;
        if (problems.length === 0) {
          toastLayer.show(newest.text, { onTap: () => openStories('today'), tapLabel: STORIES_TAP_LABEL });
        } else {
          const text = only ? only.text : `${problems.length} problems in the tower. Tap to open Stories.`;
          toastLayer.show(text, { onTap: () => openStories('problems'), tapLabel: STORIES_TAP_LABEL });
        }
        return;
      }
      // A refusal of the player's own command is said as a notice where they acted.
      if (acting && newest.level === 'warn') return;
      // A refusal was already said as a notice where the player acted.
      if (newest.text === lastNoticeText) {
        lastNoticeText = '';
        return;
      }
      // Routine info (built, rented, checked out, cleaned) goes to Stories only; a notable
      // one (a VIP, a wedding) still toasts, even when a routine line landed after it. The VIP
      // walking into the lobby is its own card (the alert stack), not a toast.
      const shown =
        newest.level === 'info' && (!newest.notable || isVipArrivalLine(newest))
          ? log.slice(log.length - fresh).reverse().find((line) => line.level === 'info' && line.notable && !isVipArrivalLine(line))
          : newest;
      if (!shown) return;
      // Only the sentence, in Stories' plain voice; Stories keeps when it happened.
      toastLayer.show(shown.text, { onTap: () => openStories(lineTarget(shown)), tapLabel: STORIES_TAP_LABEL });
      return;
    }
    if (!beat || newsShowsAlert || beat.simId === undefined) return;
    if (shell.classList.contains(WATCH_CLASS)) return;
    const now = performance.now();
    if (now - storyShownAt < STORY_TOAST_GAP_MS) return;
    storyShownAt = now;
    toastLayer.show(`${storyName(world, beat.simId)}: ${describeBeat(beat, world)}`, {
      className: 'is-story',
      onTap: () => openStories('following'),
      tapLabel: STORIES_TAP_LABEL,
    });
  }

  /** Where a toast's line is kept in Stories: the VIP visit for a VIP line, else Today. */
  function lineTarget(line: LogEntry): StoriesTarget {
    return /\bVIP\b/.test(line.text) ? 'vip' : 'today';
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
      } else if (entry && isVipArrivalLine(entry)) alerts.onVipArrival(entry);
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

  // ---------------------------------------------------------- pause menu

  /**
   * No panel, card, list or sheet is up: the one time Escape opens the menu. The game-over card
   * counts as up (it stays out of alerts' Escape on purpose), so Escape never traps focus in a
   * menu over it and away from its buttons (P4 review A4).
   */
  function nothingOpen(): boolean {
    return panelKind === 'none' && mountedPanel === null && !view.isOpen() && build.sheet() === 'closed' && !game.world.gameOver;
  }

  /** `page`: open straight on it (Stories from a toast). */
  function openPauseMenu(page?: PausePage): void {
    if (pauseMenu.isOpen()) return;
    if (view.isOpen()) view.close();
    const sheet = build.sheet();
    if (sheet === 'row' || sheet === 'full') build.close();
    if (panelKind !== 'none') setPanel('none');
    pauseMenu.open(page);
    update();
  }

  function closePauseMenu(): void {
    pauseMenu.close();
    if (panelKind !== 'none') setPanel('none');
    update();
  }

  function togglePauseMenu(): void {
    if (pauseMenu.isOpen()) closePauseMenu();
    else openPauseMenu();
  }

  /** The save question (save-button.ts) in the pause card; `close`: the menu closes on the answer. */
  function askSaveInMenu(question: SaveQuestion, close: boolean): void {
    if (close) openPauseMenu();
    if (!pauseMenu.isOpen()) return;
    pauseMenu.ask({
      id: 'heldSave',
      text: question.text,
      yes: { label: question.yes, icon: 'save', close, run: () => question.answer(true) },
      no: { label: question.no, icon: 'close', close, run: () => question.answer(false) },
    });
  }

  /** New tower replaces My tower and cannot be undone, so it asks first, in the card. */
  function askNewTower(): void {
    pauseMenu.ask({
      id: 'newTower',
      text: NEW_TOWER_QUESTION,
      yes: {
        label: NEW_TOWER_YES,
        icon: 'structure',
        close: true,
        run: () => startNewTower(),
      },
      no: { label: NEW_TOWER_NO, icon: 'home', close: false },
    });
  }

  /** Start over in My tower, once the player said so (the menu's question, or the exited screen's). */
  function startNewTower(): void {
    const saved = game.newGame(freshStart());
    notice('New game started.');
    void saved.then((res) => {
      if (!res.ok) notice(res.reason);
    });
  }

  /**
   * The menu's entries, in order: Resume, Save, New tower in My tower (it asks first: it replaces
   * My tower) or My tower anywhere else (a new game only ever replaces My tower), Today's tower
   * (inside it too), Stories, Clips, on a phone Views and Share, Settings, How to play, and last
   * Save and exit. A new tower always gets a fresh random start; the starting number is only in
   * the page address (?seed=, read in main.ts) for testing, never here.
   */
  function pauseEntries(): PauseEntry[] {
    const slot = game.getSlot?.() ?? 'mine';
    const entries: PauseEntry[] = [
      { id: 'resume', label: 'Resume', icon: 'play', kind: 'resume' },
      {
        id: 'save',
        label: SAVE_WORD,
        icon: 'save',
        kind: 'stay',
        title: SAVE_TIP,
        bind(item) {
          menuSave?.destroy();
          menuSave = createSaveAction(
            {
              save: () => game.save(),
              notice: (text) => notice(text),
              heldSave: { held: () => game.saveHeld?.() ?? false, ask: (question) => askSaveInMenu(question, false) },
            },
            item,
          );
        },
        run: () => menuSave?.run(),
      },
      slot === 'mine'
        ? { id: 'newTower', label: 'New tower', icon: 'structure', kind: 'stay', run: () => askNewTower() }
        : { id: 'myTower', label: 'My tower', icon: 'home', kind: 'leave', run: () => openMyTower() },
    ];
    // In every tower, Today's tower included: its page carries the result's Share and the kept copy.
    entries.push({ id: 'daily', label: "Today's tower", icon: 'star', kind: 'page', run: () => openDailyPage() });
    entries.push({
      id: 'stories',
      label: 'Stories',
      icon: 'population',
      kind: 'page',
      title: 'What needs you, the people you follow and the latest from around the tower',
      run: () => showStories(storiesPage(), undefined),
    });
    // The site's four videos, a page in the card; in the desktop shell, whose content policy
    // refuses remote media, the site's Clips page in the system browser, as How to play does.
    entries.push(
      clipsOpenOutside()
        ? { id: 'clips', label: CLIPS_TITLE, icon: 'clips', kind: 'stay', title: 'The trailer and short clips, in your browser', run: () => openClipsOutside() }
        : { id: 'clips', label: CLIPS_TITLE, icon: 'clips', kind: 'page', title: 'The trailer and short clips', run: () => pauseMenu.pushPage(clipsPage()) },
    );
    // A phone's top bar is the pill alone (ui.css), so Views and Share live here instead.
    if (inSheetLayout()) {
      entries.push(
        { id: 'views', label: 'Views', icon: 'views', kind: 'leave', title: 'Stress, noise, vacancy and elevator wait', run: () => ctx.openViews?.() },
        { id: 'share', label: 'Share', icon: 'share', kind: 'page', title: 'Share your tower', run: () => pauseMenu.pushPage(sharePage()) },
      );
    }
    entries.push(
      { id: 'settings', label: 'Settings', icon: 'settings', kind: 'page', run: () => pauseMenu.pushPage(settingsPage()) },
      // The guide, linked the way Settings links it: on the web the page, in a new tab; in the app
      // shells, which carry no copy of it, the site's page in the system browser.
      guideOpensOutside()
        ? { id: 'guide', label: 'How to play', icon: 'help', kind: 'stay', title: 'The full guide, in your browser', run: () => openGuideOutside() }
        : {
            id: 'guide',
            label: 'How to play',
            icon: 'help',
            kind: 'link',
            href: HOW_TO_PLAY_HREF,
            target: '_blank',
            rel: 'noopener',
            title: 'The full guide, in a new tab',
          },
      // Saves the tower in hand, then the exited screen; busy while the save runs, as Save is.
      {
        id: 'exit',
        label: EXIT_WORD,
        icon: 'close',
        kind: 'stay',
        bind(item) {
          exitEntry = item;
          showExitBusy();
        },
        run: () => void saveAndExit(),
      },
    );
    return entries;
  }

  /** Clips, a page in the card: pausing and letting the files go when it goes (clips.ts). */
  function clipsPage(): PausePage {
    let body: ClipsBody | null = null;
    return {
      id: 'clips',
      title: CLIPS_TITLE,
      build() {
        body?.dispose();
        body = clipsBody();
        return body.node;
      },
      dispose() {
        body?.dispose();
        body = null;
      },
    };
  }

  /**
   * Save and exit: save the tower in hand (GameApi.leave), then the exited screen. Written, or
   * nothing had moved: the screen at once. Anything else keeps the tower and shows the leave card:
   * Try again leaves again, Leave without saving goes to the screen, which then says the tower was
   * not saved, Save anyway (a held My tower) saves first, Open the newer tower (another window's
   * save) loads the page again, and Keep playing gives the tower back.
   */
  async function saveAndExit(): Promise<void> {
    if (destroyed || exitInFlight || exitScreen) return;
    exitInFlight = true;
    showExitBusy();
    let last: LeaveResult = { ok: false, reason: LEAVE_NOT_SAVED };
    let savedAnyway = false;
    const leave = async (): Promise<LeaveResult> => {
      last = await game.leave('exit').catch((): LeaveResult => ({ ok: false, reason: LEAVE_NOT_SAVED }));
      return last;
    };
    const first = await leave();
    exitInFlight = false;
    showExitBusy();
    if (destroyed) return;
    if (first.ok && !first.unsaved) {
      showExitScreen(true);
      return;
    }
    showLeaveCard({
      menu: pauseMenu,
      result: first,
      retry: leave,
      proceed: () => {
        // A conflict's way on is Open the newer tower: this page loads again on it.
        const res = last as LeaveResult;
        if (!res.ok) {
          reload();
          return;
        }
        showExitScreen(savedAnyway || !res.unsaved);
      },
      stay: () => game.resumeAfterLeave(),
      saveFile: (text) => exportSave(text, pageCtx),
      game: {
        exportSave: () => game.exportSave(),
        getKeptCopy: () => game.getKeptCopy(),
        save: async () => {
          const res = await game.save();
          if (res.ok) savedAnyway = true;
          return res;
        },
      },
    });
  }

  /**
   * The Save and exit entry while its save runs: busy, and its word says so, so a slow save never
   * looks stuck. A save in flight is not called off: it holds the clock and the input so nothing
   * changes after its snapshot (by design).
   */
  function showExitBusy(): void {
    exitEntry?.setBusy(exitInFlight);
    exitEntry?.setWord(exitInFlight ? EXIT_SAVING_WORD : EXIT_WORD);
  }

  /**
   * The exited screen (exit-screen.ts) over everything. The leave's hold stays (the clock stopped,
   * nothing to build, so nothing to save in the background); the menu stays open out of sight so
   * Continue tower gives back the speed from before it opened; the score goes quiet without its
   * saved setting being touched (sound.silence), so a game closed from here opens with Sound as the
   * player had it. A card that was open stays closed under it (refreshPanel), so focus is the
   * screen's: Continue tower.
   */
  function showExitScreen(saved: boolean): void {
    if (destroyed || exitScreen) return;
    sound.silence?.(true);
    if (!pauseMenu.isOpen()) openPauseMenu();
    if (panelKind !== 'none') setPanel('none');
    const inMine = (game.getSlot?.() ?? 'mine') === 'mine';
    exitScreen = createExitScreen({
      host: shell,
      saved,
      third: inMine ? 'newTower' : 'myTower',
      onContinue: () => endExit(),
      onThird: () => {
        endExit();
        if (inMine) startNewTower();
        else openMyTower();
      },
      // The desktop shell cannot play the clips: the site's Clips page, as the menu entry opens.
      ...(clipsOpenOutside() ? { clipsOutside: () => openClipsOutside() } : {}),
    });
    shell.classList.add('is-exited');
    pauseMenu.stepAside(() => {});
    update();
    exitScreen?.focusFirst();
  }

  /** Off the exited screen and back to the tower: the hold let go, the speed and Sound given back. */
  function endExit(): void {
    const screen = exitScreen;
    if (!screen) return;
    exitScreen = null;
    screen.destroy();
    shell.classList.remove('is-exited');
    game.resumeAfterLeave();
    pauseMenu.close();
    sound.silence?.(false);
    update();
  }

  // ------------------------------------------------ the pause menu's pages

  /** Out of the menu (the speed given back, focus on Menu), then on to what a page opened. */
  function leaveMenu(run: () => void): void {
    pauseMenu.close();
    run();
  }

  /**
   * The context a page's body gets: the panels' own, and Close is Back. What it opens over the
   * game goes as it did when these were sheets: Settings' Send feedback and Intro open with the
   * menu stepped aside, still paused, and close back to it; Stories' person, milestone and
   * chronicle leave the menu, as its Stories entry used to before the card opened.
   */
  const pageCtx: PanelContext = Object.assign(Object.create(ctx) as PanelContext, {
    close: () => void pauseMenu.popPage(),
    // Stories' Show on the tower: out of the menu, so the place is in sight.
    // On a phone or portrait tablet the card open before Stories is a bottom sheet over half the
    // view: it stays closed, so the place stays in sight (as the old News did).
    centerOn: (floor: number, x: number) =>
      leaveMenu(() => {
        const width = viewportWidth();
        if ((width === undefined || width < SHEET_CARD_MIN_WIDTH) && game.getSelection()) game.select(null);
        ctx.centerOn?.(floor, x);
      }),
    select: (sel: Parameters<NonNullable<PanelContext['select']>>[0]) => leaveMenu(() => ctx.select?.(sel)),
    openIntro: () => pauseMenu.stepAside(() => ctx.openIntro?.()),
    openFeedback: () => pauseMenu.stepAside(() => ctx.openFeedback?.()),
    openRecap: () => leaveMenu(() => ctx.openRecap?.()),
    openChronicle: () => leaveMenu(() => ctx.openChronicle?.()),
    rowsChanged: (focus: HTMLElement | null) => pauseMenu.settle(focus),
  });

  function settingsPage(): PausePage {
    let body: PanelBody | null = null;
    return {
      id: 'settings',
      title: 'Settings',
      build() {
        const made = settingsBody(game, pageCtx, { openControls: () => pauseMenu.pushPage(controlsPage(), made.controlsRow) });
        body = made;
        const root = el('div', 'hs-settings');
        root.append(made.node);
        return root;
      },
      refresh: () => body?.refresh?.(),
    };
  }

  /** Controls, a page under Settings: built for the device in hand each time it opens. */
  function controlsPage(): PausePage {
    return { id: 'controls', title: 'Controls', build: () => controlsBody() };
  }

  /** The Stories page, and its body once built, so a later toast can aim the page on show. */
  type StoriesPage = PausePage & { body(): StoriesBody | null };

  function storiesPage(): StoriesPage {
    let body: StoriesBody | null = null;
    return {
      id: 'stories',
      title: 'Stories',
      build() {
        body = storiesBody(game, pageCtx);
        return body.node;
      },
      refresh: () => body?.refresh(),
      dispose: () => body?.dispose?.(),
      body: () => body,
    };
  }

  /**
   * Stories is on show: bring the target into view and put focus on its first control that does
   * not spend money, or on Back. Never on Call a helicopter or Pay ransom: those take a press of
   * their own.
   */
  function showStories(page: StoriesPage, target: StoriesTarget | undefined, push = true): void {
    if (push) pauseMenu.pushPage(page);
    pauseMenu.settle(page.body()?.aim(target) ?? null);
  }

  /**
   * The one way into Stories from outside the menu (Matt, 2026-10-01): every news toast, the folded
   * warning toast, the alert stack's "and N more" and reminder chips, and an alert notification.
   * The pause menu opens straight on the Stories page, so the game pauses; with the menu already
   * open on another page Stories goes over it, and on Stories itself the page turns to the target.
   */
  function openStories(target?: StoriesTarget): void {
    if (destroyed || exitScreen) return;
    // A card holding the player's work (unsent feedback, a share image being made) is never thrown
    // away for it: the card stays and Stories does not open (as Watch, Matt 2026-09-28).
    if (panelKind !== 'none' && mountedPanel?.holdsWork?.()) return;
    // A card a page opened over the menu (Send feedback, the intro) gives way to it.
    if (pauseMenu.isOpen() && !pauseMenu.isShown()) {
      setPanel('none');
      pauseMenu.show();
    }
    const onShow = pauseMenu.page();
    if (onShow?.id === 'stories' && 'body' in onShow) {
      showStories(onShow as StoriesPage, target, false);
    } else if (pauseMenu.isOpen()) {
      showStories(storiesPage(), target);
    } else {
      const page = storiesPage();
      openPauseMenu(page);
      showStories(page, target, false);
    }
    update();
  }

  /** `words`: a message and link of its own (Today's tower's result shares its score). */
  function sharePage(words?: { text: string; url: string }): PausePage {
    let body: PanelBody | null = null;
    return {
      id: 'share',
      title: 'Share',
      build() {
        body = shareBody(game, renderer, pageCtx, words);
        return body.node;
      },
      dispose: () => body?.dispose?.(),
    };
  }

  /**
   * Today's tower: a page with the card opening it would put up (the twist, the older tower's
   * choice, the result with its Share, the kept copy), read before any switch. A game that cannot
   * read ahead shows today's start card at once.
   */
  function openDailyPage(): void {
    const asked = pauseMenu.generation();
    const push = (peek: ReturnType<typeof freshPeek>): void => {
      // Closed (even if opened again since), or on another page, while the slot was being read:
      // the answer is for a menu that is gone, so it is dropped.
      if (!pauseMenu.isOpen() || pauseMenu.generation() !== asked || pauseMenu.page()) return;
      const kept = game.getKeptDailyCopy?.() ?? null;
      pauseMenu.pushPage({
        id: 'daily',
        title: DAILY_TITLE,
        build: () =>
          dailyPeekBody(peek, playDaily, {
            // The result card's Share: the share page, with the daily's own message and link.
            share: (text, url) => pauseMenu.pushPage(sharePage({ text, url })),
            saveKept: kept === null ? null : () => exportSave(game.getKeptDailyCopy?.() ?? kept, pageCtx),
          }),
      });
    };
    if (!game.peekDaily) {
      push(freshPeek());
      return;
    }
    void game.peekDaily().then(push, () => push(freshPeek()));
  }

  /** An answer on the Today's tower page: the menu closes, the speed given back, and the switch runs. */
  function playDaily(which: DailyGo): void {
    pauseMenu.close();
    dailyQuiet = true;
    void switchTower(async () => {
      try {
        const opened = await game.openDaily();
        if (opened && !opened.ok) return opened;
        if (which !== 'open' && game.getDailyChoice?.()) await game.chooseDaily(which);
        return opened;
      } finally {
        dailyQuiet = false;
      }
    }, true);
  }

  /**
   * A tap on something over the dimmed tower that opens a panel (the star card's Stories so far):
   * toasts sit above the pause menu's scrim, so with the menu on screen it closes first, the speed
   * given back, and the panel opens. Before, the panel waited unseen behind the menu (P4 review
   * A3). Stories itself is a page in the menu (openStories).
   */
  function openPanelFromToast(kind: PanelKind): void {
    if (pauseMenu.isShown()) pauseMenu.close({ restoreFocus: false });
    setPanel(kind);
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
    if (exitScreen) return exitScreen.node;
    if (pauseMenu.isShown()) return pauseMenu.card;
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
        // A clip with focus plays or pauses, as Enter and Space do.
        if (active && menu && menu.contains(active) && toggleClip(active)) return;
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
        if (pauseMenu.isOpen()) return; // the menu holds the speed; Resume puts it back
        game.setSpeed(stepSpeed(game.getSpeed(), step));
        update();
      },
      start() {
        togglePauseMenu();
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

  /**
   * While the exited screen is up the controller moves and presses inside it (A and the d-pad,
   * through padMenu), B steps back from its clips or question, and nothing reaches the tower:
   * no pan, zoom, speed or Start.
   */
  function exitPad(handlers: ReturnType<typeof padHandlers>): ReturnType<typeof padHandlers> {
    return {
      ...handlers,
      pan(dx, dy) {
        if (!exitScreen) handlers.pan(dx, dy);
      },
      zoom(factor) {
        if (!exitScreen) handlers.zoom(factor);
      },
      b() {
        if (exitScreen) exitScreen.back();
        else handlers.b();
      },
      speed(step) {
        if (!exitScreen) handlers.speed(step);
      },
      start() {
        if (!exitScreen) handlers.start();
      },
    };
  }

  /** B: close the nearest thing open, else put the tool down. */
  function padBack(): void {
    if (pauseMenu.isShown()) {
      // A question backs out with its safe answer and a page goes back one, as Escape does; else B resumes.
      if (!pauseMenu.cancel() && !pauseMenu.popPage()) closePauseMenu();
      return;
    }
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
    // The exited screen: every key is its own (Tab stays inside, Escape does nothing), and no
    // game key reaches the tower.
    if (exitScreen) {
      exitScreen.handleKey(event);
      event.stopImmediatePropagation?.();
      return;
    }
    // A clip with focus on the Clips page: Space and Enter play or pause it (toggleClip, the
    // same as the controller's A), Left and Right stay the player's own (seeking). Up, Down, Tab
    // and Escape stay the menu's, so they move on to the next clip.
    if (pauseMenu.isShown() && pauseMenu.page()?.id === 'clips' && videoKey(event)) {
      if ((event.key === ' ' || event.key === 'Enter') && toggleClip(event.target)) event.preventDefault();
      event.stopImmediatePropagation?.();
      return;
    }
    // The pause menu is modal: its keys are its own, and nothing reaches the tower behind it.
    if (pauseMenu.isShown()) {
      pauseMenu.handleKey(event);
      event.stopImmediatePropagation?.();
      return;
    }
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
    // With a card the Settings page opened over the game (Send feedback), the menu still holds the speed.
    if ((action.kind === 'pause' || action.kind === 'speed') && pauseMenu.isOpen()) {
      event.preventDefault();
      return;
    }
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
        // Nothing in hand and nothing open: Escape opens the pause menu.
        if (game.getTool().kind === 'none' && !game.getPlacement()?.pending && nothingOpen()) {
          event.preventDefault();
          openPauseMenu();
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

  // A tap on a notification brought the game forward; an alert's also opens Stories at what needs you.
  notifier?.onTap((kind) => {
    if (destroyed || kind !== 'alerts') return;
    openStories('needs');
  });

  /**
   * A new version has installed. The toast stays until tapped, and a tap saves the tower and then
   * reloads (the pagehide save is fire and forget, so it is not trusted to finish first), but only
   * once the tower is written or nothing had moved. Anything else keeps the tower and shows the
   * leave card (leave-card.ts); a player who keeps playing gets the toast back, to reload later.
   */
  function updateReady(): void {
    if (destroyed || updateToldAt) return;
    putUpdateToast();
    notifier?.updateReady();
  }

  function putUpdateToast(): void {
    updateToldAt = toastLayer.alert(UPDATE_TEXT, {
      className: 'is-update',
      action: 'Reload',
      tapLabel: 'Reload to get the new version',
      onTap: () => void reloadWhenSaved(),
    });
  }

  async function reloadWhenSaved(): Promise<void> {
    // From the exited screen the tower is already saved, or the player chose to leave it: the
    // hold stands, nothing changed since, so the page goes without asking again.
    if (exitScreen) {
      reload();
      return;
    }
    if (reloading) return; // a double tap: the first tap's leave answers for both
    reloading = true;
    const leave = (): Promise<LeaveResult> =>
      game.leave('reload').catch((): LeaveResult => ({ ok: false, reason: LEAVE_NOT_SAVED }));
    const left = await leave();
    if (destroyed) return;
    if (left.ok && !left.unsaved) {
      reload();
      return;
    }
    const card = (): void =>
      showLeaveCard({
        menu: pauseMenu,
        result: left,
        retry: leave,
        proceed: () => reload(),
        stay: () => {
          reloading = false;
          game.resumeAfterLeave();
          if (!destroyed) putUpdateToast();
        },
        saveFile: (text) => exportSave(text, pageCtx),
        game,
      });
    if (pauseMenu.isOpen() && !pauseMenu.isShown()) {
      // Send feedback or the intro covers the menu, and closing it for the card could lose typed
      // words: the card waits until the menu is back (refreshPanel), and the tower is not held meanwhile.
      game.resumeAfterLeave();
      leaveCardOwed = card;
      return;
    }
    card();
  }

  /** The owed leave card, once nothing covers the menu (or the menu has closed). */
  function showOwedLeaveCard(): void {
    if (!leaveCardOwed || destroyed || exitScreen) return;
    if (pauseMenu.isOpen() && !pauseMenu.isShown()) return;
    const card = leaveCardOwed;
    leaveCardOwed = null;
    card();
  }

  // A save refused because another window saved this tower after this page opened it
  // (GameApi.takeSaveConflict): the leave card's conflict answers, with no leave to hold or resume.
  game.subscribe(() => {
    // Not over the exited screen: one still owed is said once the player is back at the tower.
    const owed = destroyed || exitScreen ? null : (game.takeSaveConflict?.() ?? null);
    if (!owed || pauseMenu.page()?.id === 'leave') return; // a leave card up already answers it
    showLeaveCard({ menu: pauseMenu, result: owed, retry: async () => owed, proceed: () => reload(), stay: () => {}, saveFile: (text) => exportSave(text, pageCtx), game });
  });

  return {
    update,
    updateReady,
    destroy() {
      destroyed = true;
      exitScreen?.destroy();
      exitScreen = null;
      cardSizeWatch?.disconnect();
      watch.destroy();
      quietLabels.destroy();
      stopLabelFrames();
      watchToggle.button.removeEventListener('transitionend', onLabelTransitionEnd);
      watchToggle.destroy();
      soundToggle.destroy();
      saveButton.destroy();
      menuSave?.destroy();
      pauseMenu.destroy();
      stopSoundPref();
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

/** A key a focused clip plays with (the Clips page): Space, Enter, Left and Right on a video. */
function videoKey(event: { key: string; target?: unknown }): boolean {
  const tag = ((event.target as { tagName?: string } | null | undefined)?.tagName ?? '').toUpperCase();
  return tag === 'VIDEO' && [' ', 'Enter', 'ArrowLeft', 'ArrowRight'].includes(event.key);
}

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
