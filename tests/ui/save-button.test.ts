// The round Save button in the row under the top bar, left of Sound and Watch: a tap runs the same
// save as Settings, Save now (GameApi.save) and says the result in the same notice; it is aria-disabled
// (keeping keyboard focus) while the save is written, reads "Saved" for a moment after, and follows every rule Watch and
// Sound follow (placed by the same measure, hidden in Watch mode, its word folded when quiet).
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult } from '../../src/sim/types';
import { ICON_NAMES } from '../../src/ui/icons';
import { HELD_SAVE_NO, HELD_SAVE_QUESTION, HELD_SAVE_YES, SAVED_MS, SAVED_NOTICE, SAVE_TIP, createSaveAction, createSaveButton, type SaveQuestion } from '../../src/ui/save-button';
import { createUi } from '../../src/ui/ui';
import { WATCH_CLASS } from '../../src/ui/watch';
import { FakeDom, type FakeElement, choosePauseEntry } from './fake-dom';

const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8');
const phone = css.slice(css.indexOf('@media (max-width: 720px) {\n  /* The top bar on a phone'));

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  dom = new FakeDom();
  uninstall = dom.install();
  const store = (globalThis as unknown as { window: { localStorage: { setItem(k: string, v: string): void } } }).window.localStorage;
  store.setItem('hs.intro.seen', 'true');
  store.setItem('hs.guide.done', 'true');
});
afterEach(() => {
  uninstall();
  vi.useRealTimers();
});

const click = (node: FakeElement): void => (node.listeners.get('click') ?? []).forEach((f) => f({}));
const classesOf = (node: FakeElement): string[] => node.className.split(/\s+/).filter(Boolean);
const labelOf = (button: FakeElement): string => button.descendants().find((n) => classesOf(n).includes('hs-btn-label'))!.textContent;
const glyph = (button: FakeElement): string | null =>
  button.descendants().find((n) => n.tagName.toLowerCase() === 'use')?.getAttribute('href') ?? null;
/** Let a resolved save's then run. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

/** A save the test finishes by hand. */
function deferredSave() {
  const calls: ((r: CommandResult) => void)[] = [];
  const save = vi.fn(() => new Promise<CommandResult>((resolve) => calls.push(resolve)));
  return { save, finish: (r: CommandResult) => calls.shift()!(r) };
}

describe('createSaveButton', () => {
  it('is a round icon button named Save, with its tooltip, and no pressed state: it is an action', () => {
    const { button } = createSaveButton({ save: vi.fn(), notice: vi.fn() });
    const node = button as unknown as FakeElement;
    expect(classesOf(node)).toEqual(['hs-icon-btn', 'hs-round', 'hs-save-btn']);
    expect([node.getAttribute('aria-label'), node.title, labelOf(node), glyph(node)]).toEqual(['Save', SAVE_TIP, 'Save', '#hs-icon-save']);
    expect(SAVE_TIP).toBe('Save your tower now');
    expect(node.getAttribute('aria-pressed')).toBeNull();
    expect(ICON_NAMES).toContain('save');
  });

  it('a press saves once; while it is written the button is aria-disabled, never disabled (focus stays), and a second press does nothing', async () => {
    const { save, finish } = deferredSave();
    const notice = vi.fn();
    const node = createSaveButton({ save, notice }).button as unknown as FakeElement;
    click(node);
    expect(save).toHaveBeenCalledTimes(1);
    expect([node.getAttribute('aria-disabled'), node.disabled]).toEqual(['true', false]);
    click(node);
    click(node);
    expect(save).toHaveBeenCalledTimes(1);
    finish({ ok: true });
    await settle();
    expect([node.getAttribute('aria-disabled'), node.disabled]).toEqual([null, false]);
    expect(notice.mock.calls).toEqual([[SAVED_NOTICE]]);
    // Written: another press saves again.
    click(node);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('reads "Saved" for about two seconds after a save, then "Save" again', async () => {
    const save = vi.fn(async (): Promise<CommandResult> => ({ ok: true }));
    const node = createSaveButton({ save, notice: vi.fn() }).button as unknown as FakeElement;
    click(node);
    await settle();
    expect(labelOf(node)).toBe('Saved');
    expect(node.getAttribute('aria-label')).toBe('Save');
    expect(SAVED_MS).toBe(2000);
    vi.advanceTimersByTime(SAVED_MS - 1);
    expect(labelOf(node)).toBe('Saved');
    vi.advanceTimersByTime(1);
    expect(labelOf(node)).toBe('Save');
  });

  it('a failed save says the save\'s own reason, the words Save now shows, and keeps "Save"', async () => {
    const reason = 'This device is not saving your tower right now.';
    const save = vi.fn(async (): Promise<CommandResult> => ({ ok: false, reason }));
    const notice = vi.fn();
    const node = createSaveButton({ save, notice }).button as unknown as FakeElement;
    click(node);
    await settle();
    expect(notice.mock.calls).toEqual([[reason]]);
    expect([labelOf(node), node.getAttribute('aria-disabled')]).toEqual(['Save', null]);
    // A save that throws still lets go of the button, with plain words.
    const broken = createSaveButton({ save: () => Promise.reject(new Error('x')), notice }).button as unknown as FakeElement;
    click(broken);
    await settle();
    expect([notice.mock.calls[1], broken.getAttribute('aria-disabled')]).toEqual([['Could not save.'], null]);
  });
});

function mkGame(extra: Record<string, unknown> = {}) {
  const save = vi.fn(async (): Promise<CommandResult> => ({ ok: true }));
  const game = {
    world: {
      seed: 1, cash: 1e6, population: 0, stars: 1, time: { minute: 12 * 60 }, log: [], logTotal: 0, rooms: new Map(), shafts: new Map(),
      sims: new Map(), events: [], stats: { lastQuarter: null, vipRating: 'none', weddingsHeld: 0 },
      story: { followed: [], threads: {}, recent: [], seq: 0 },
    },
    subscribe: () => () => {},
    getHover: () => null,
    getSpeed: () => 1,
    setSpeed: () => {},
    togglePause: () => {},
    getTool: () => ({ kind: 'none' }),
    setTool: () => {},
    getPlacement: () => null,
    getPlacementRect: () => null,
    getSelection: () => null,
    setChrome: () => {},
    setReducedMotion: () => {},
    getSlot: () => 'mine',
    select() {},
    exportSave: () => '',
    save,
    ...extra,
  };
  return { game, save };
}

function mount(extra: Record<string, unknown> = {}) {
  const { game, save } = mkGame(extra);
  const root = dom.createElement('div');
  createUi(root as never, game as never, {} as never);
  const byLabel = (label: string): FakeElement =>
    root.descendants().find((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === label)!;
  return { root, save, byLabel, top: root.descendants().find((n) => n.className === 'hs-top')! };
}

describe('createSaveAction: a save that would replace a saved tower that could not be opened', () => {
  it('asks first while held, saves only on Save anyway, and is one press again once not held', async () => {
    let held = true;
    const asked: SaveQuestion[] = [];
    const save = vi.fn(async (): Promise<CommandResult> => ({ ok: true }));
    const notices: string[] = [];
    const words: string[] = [];
    const action = createSaveAction(
      { save, notice: (t) => notices.push(t), heldSave: { held: () => held, ask: (q) => asked.push(q) } },
      { setWord: (w) => words.push(w), setBusy() {} },
    );
    action.run();
    expect(save).not.toHaveBeenCalled();
    expect(asked).toHaveLength(1);
    expect([asked[0]!.text, asked[0]!.yes, asked[0]!.no]).toEqual([HELD_SAVE_QUESTION, HELD_SAVE_YES, HELD_SAVE_NO]);
    asked[0]!.answer(false);
    await Promise.resolve();
    expect(save).not.toHaveBeenCalled();
    action.run();
    asked[1]!.answer(true);
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    expect(notices).toEqual([SAVED_NOTICE]);
    held = false;
    action.run();
    expect(asked).toHaveLength(2);
    expect(save).toHaveBeenCalledTimes(2);
  });
});

describe('the Save button in the ui', () => {
  it('sits in the top bar before Sound and Watch, placed one gap left of Sound by the measure', () => {
    const { top, byLabel } = mount();
    const [save, sound, watch] = [byLabel('Save'), byLabel('Sound'), byLabel('Watch')];
    expect([top.children.indexOf(save), top.children.indexOf(sound)]).toEqual([top.children.indexOf(watch) - 2, top.children.indexOf(watch) - 1]);
    expect(classesOf(save)).toContain('is-placed');
    // Sound's left edge, from the bar's, goes into --save-x (ui.css takes the gap off).
    sound.getBoundingClientRect = () => ({ width: 52, height: 52, top: 0, left: 140, right: 192, bottom: 52 });
    dom.fireWindow('resize');
    expect(save.style['--save-x']).toBe('140px');
    sound.getBoundingClientRect = () => ({ width: 90, height: 52, top: 0, left: 102, right: 192, bottom: 52 });
    dom.fireWindow('resize');
    expect(save.style['--save-x']).toBe('102px');
  });

  it('runs the same save as Settings, Save now, and says the same words in the same notice', async () => {
    const { root, save, byLabel } = mount();
    click(byLabel('Save'));
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    const said = (): number => root.descendants().filter((n) => n.children.length === 0 && n.textContent === SAVED_NOTICE).length;
    expect(said()).toBeGreaterThan(0);
    // Settings, Save now: the same call and the same words.
    click(byLabel('Menu'));
    choosePauseEntry(root, 'settings');
    const row = root.descendants().find((n) => classesOf(n).includes('hs-set-action') && n.textContent === 'Save now')!;
    const before = said();
    click(row);
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
    expect(said()).toBeGreaterThanOrEqual(before);
  });

  it.each(['mine', 'daily', 'friend'])('shows in %s, like the Save now row', (slot) => {
    const { root, byLabel } = mount({ getSlot: () => slot });
    expect(byLabel('Save').hidden).toBe(false);
    click(byLabel('Menu'));
    choosePauseEntry(root, 'settings');
    expect(root.descendants().some((n) => n.textContent === 'Save now' && classesOf(n).includes('hs-set-action'))).toBe(true);
  });
});

describe('Save button styles', () => {
  it('steps aside in Watch mode with Watch and Sound, and folds its word when the labels go quiet', () => {
    const at = css.indexOf(`.hs-ui.${WATCH_CLASS} :is(`);
    expect(css.slice(at, css.indexOf('{', at))).toMatch(/\.hs-watch-btn, \.hs-sound-btn, \.hs-save-btn,/);
    expect(css).toMatch(/\.hs-ui\.is-quiet-labels :is\(\.hs-watch-btn, \.hs-sound-btn, \.hs-save-btn\):not\(:hover\):not\(:focus-visible\) \{\s*padding: 0;/);
    expect(css).toMatch(/\.hs-ui\.is-quiet-labels :is\(\.hs-watch-btn, \.hs-sound-btn, \.hs-save-btn\):not\(:hover\):not\(:focus-visible\) \.hs-btn-label \{\s*max-width: 0;/);
  });

  it('sits one gap left of Sound in the same row, and is as big a target', () => {
    expect(css).toMatch(/\.hs-save-btn \{\s*position: absolute;\s*top: calc\(100% \+ var\(--gap-float\)\);\s*right: calc\(2 \* \(var\(--touch\) \+ 8px \+ var\(--gap-float\)\)\);/);
    expect(css).toMatch(/\.hs-save-btn\.is-placed \{\s*right: auto;\s*left: calc\(var\(--save-x\) - var\(--gap-float\)\);\s*translate: -100% 0;/);
    expect(css).toMatch(/\.hs-save-btn:not\(\.is-placed\) \{\s*visibility: hidden;/);
    // A phone keeps Watch at the right edge: Save is two buttons and two gaps in, shown at once.
    expect(phone).toMatch(/\.hs-save-btn,\s*\.hs-save-btn\.is-placed \{\s*left: auto;\s*right: calc\(2 \* \(var\(--touch\) \+ 8px \+ var\(--gap-float\)\)\);/);
    expect(phone).toMatch(/\.hs-save-btn:not\(\.is-placed\) \{\s*visibility: visible;/);
    // Only the folds take the padding: the quiet labels, and the widths where the words would
    // reach the open Build dock (I-3 of the P1 review).
    const resting = css
      .replace(/\.hs-ui\.is-quiet-labels[^{]*\{[^}]*\}/g, '')
      .replace(/@media \(min-width: 721px\) and \(max-width: (819|1023)px\) \{[^@]*?\}\s*\}/g, '');
    expect(resting).not.toMatch(/\.hs-save-btn[^{]*\{[^}]*(min-height|min-width|padding):/);
  });
});
