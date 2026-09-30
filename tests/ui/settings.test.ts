// Settings on a fake DOM (the pause menu's Settings page, settingsBody): grouped rows like a
// phone's settings app, real toggle switches that remember, the styled Open button over a hidden
// file input, the Theme choice, and the Controls page that shows only the device in the player's
// hands, a page under Settings in the pause card.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { controlLines, controlsDevice } from '../../src/ui/controls';
import { keyHelpLines } from '../../src/ui/keys';
import { GROUPS } from '../../src/ui/palette';
import { controlsBody, el, settingsBody, type PanelContext } from '../../src/ui/panels';
import { createPauseMenu } from '../../src/ui/pause-menu';
import { getFlag, PREF_KEYS } from '../../src/ui/prefs';
import { FakeDom, type FakeElement } from './fake-dom';

/** Settings as the pause menu's Settings page holds them (settingsBody; the old sheet is gone). */
function settingsNode(game: unknown, ctx: PanelContext): FakeElement {
  const root = el('div');
  root.append(settingsBody(game as never, ctx, { openControls() {} }).node);
  return root as unknown as FakeElement;
}

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
});
afterEach(() => {
  uninstall();
  vi.unstubAllGlobals();
});

const game = { world: { seed: 1, log: [], logTotal: 0 } } as never;

function context(over: Partial<PanelContext> = {}): PanelContext & { motion: boolean[]; display: string[] } {
  const motion: boolean[] = [];
  const display: string[] = [];
  return {
    apply: () => ({ ok: true }) as never,
    notice: () => {},
    close: () => {},
    reducedMotion: false,
    setReducedMotion: (on) => motion.push(on),
    setDisplay: (name, on) => display.push(`${name}:${on}`),
    openIntro: () => {},
    openDaily: () => {},
    openStories: () => {},
    motion,
    display,
    ...over,
  };
}

const panelOf = (ctx: PanelContext = context()): FakeElement => settingsNode(game, ctx);
const byId = (root: FakeElement, id: string): FakeElement => {
  const found = root.descendants().find((n) => n.id === id);
  if (!found) throw new Error(`no #${id}`);
  return found;
};
const fire = (target: FakeElement, type: string, event: unknown = {}): void => {
  for (const fn of target.listeners.get(type) ?? []) fn(event);
};
const buttonNamed = (root: FakeElement, text: string): FakeElement => {
  const found = root.descendants().find((n) => n.tagName === 'BUTTON' && n.textContent === text);
  if (!found) throw new Error(`no ${text} button`);
  return found;
};
const store = (): { getItem(k: string): string | null } =>
  (globalThis as unknown as { window: { localStorage: { getItem(k: string): string | null } } }).window.localStorage;

describe('settings groups', () => {
  it('reads like a phone settings app: Saving, Display, Help, each a titled list of rows; the Game group is the pause menu now', () => {
    const panel = panelOf();
    const main = panel.descendants().find((n) => n.className === 'hs-set-main') as FakeElement;
    const titles = main.children.map((s) => s.children[0]?.textContent);
    expect(titles).toEqual(['Saving', 'Display', 'Help']);
    for (const group of main.children) {
      expect(group.className).toBe('hs-section');
      expect(group.lastElementChild?.className).toBe('hs-set-list');
    }
    const words = panel.descendants().filter((n) => n.tagName === 'BUTTON').map((n) => n.textContent);
    for (const moved of ["Today's tower", 'New game', 'My tower', 'Stories', 'Views', 'Share']) expect(words).not.toContain(moved);
    const help = main.children[2] as FakeElement;
    expect(help.lastElementChild?.children.map((r) => r.textContent)).toEqual(['Intro', 'How to play', 'Controls']);
  });
});

describe('switches', () => {
  const SWITCHES: [string, string][] = [
    ['hs-reduced-motion', 'Reduced motion'],
    ['hs-large-text', 'Larger text'],
    ['hs-color-blind', 'Color-blind friendly views'],
    ['hs-glass-clear', 'See-through buttons'],
  ];

  it('are real toggle switches: a button with role switch, aria-checked, named by its label', () => {
    const panel = panelOf();
    for (const [id, words] of SWITCHES) {
      const control = byId(panel, id);
      expect(control.tagName).toBe('BUTTON');
      expect(control.getAttribute('role')).toBe('switch');
      expect(control.getAttribute('aria-checked')).toBe('false');
      const label = panel.descendants().find((n) => n.tagName === 'LABEL' && n.textContent === words) as unknown as { htmlFor: string };
      expect(label?.htmlFor).toBe(id);
      expect((control.parentNode as FakeElement).className).toBe('hs-set-row hs-set-switch');
    }
  });

  it('flip aria-checked on a tap and back on the next', () => {
    const control = byId(panelOf(), 'hs-large-text');
    fire(control, 'click');
    expect(control.getAttribute('aria-checked')).toBe('true');
    fire(control, 'click');
    expect(control.getAttribute('aria-checked')).toBe('false');
  });

  it('flip once on a tap anywhere on the row: its padding and gap, the words (through the label) or the switch itself', () => {
    const control = byId(panelOf(), 'hs-large-text');
    const row = control.parentNode as FakeElement;
    const label = row.children[0] as FakeElement;
    // The row's padding or the gap before the switch: the row passes the tap to the switch.
    fire(row, 'click', { target: row });
    expect(control.getAttribute('aria-checked')).toBe('true');
    // A tap on the switch reaches the row as well (it bubbles): the row passes nothing on.
    fire(control, 'click', { target: control });
    fire(row, 'click', { target: control });
    expect(control.getAttribute('aria-checked')).toBe('false');
    // A tap on the words: the label hands it to the switch itself, so the row passes nothing on.
    fire(row, 'click', { target: label });
    expect(control.getAttribute('aria-checked')).toBe('false');
  });

  it('remember Larger text, Color-blind friendly views and See-through buttons under their prefs keys', () => {
    const ctx = context();
    const panel = panelOf(ctx);
    fire(byId(panel, 'hs-large-text'), 'click');
    fire(byId(panel, 'hs-color-blind'), 'click');
    fire(byId(panel, 'hs-glass-clear'), 'click');
    expect(store().getItem('hs.largeText')).toBe('true');
    expect(getFlag(PREF_KEYS.largeText)).toBe(true);
    expect(getFlag(PREF_KEYS.colorBlind)).toBe(true);
    expect(getFlag(PREF_KEYS.glassClear)).toBe(true);
    expect(ctx.display).toEqual(['largeText:true', 'colorBlind:true', 'glassClear:true']);

    // A new sheet reads them back as on.
    const again = panelOf();
    for (const id of ['hs-large-text', 'hs-color-blind', 'hs-glass-clear']) expect(byId(again, id).getAttribute('aria-checked')).toBe('true');
    fire(byId(again, 'hs-color-blind'), 'click');
    expect(getFlag(PREF_KEYS.colorBlind)).toBe(false);
  });

  it('See-through buttons puts hs-glass-clear on the page root and takes it off again', () => {
    const root = dom.createElement('html');
    (globalThis as unknown as { document: { documentElement: FakeElement } }).document.documentElement = root;
    const control = byId(panelOf(), 'hs-glass-clear');
    fire(control, 'click');
    expect(root.classList.contains('hs-glass-clear')).toBe(true);
    fire(control, 'click');
    expect(root.classList.contains('hs-glass-clear')).toBe(false);
  });

  it('Reduced motion starts from the shell and hands a change back to it', () => {
    const ctx = context({ reducedMotion: true });
    const control = byId(panelOf(ctx), 'hs-reduced-motion');
    expect(control.getAttribute('aria-checked')).toBe('true');
    fire(control, 'click');
    expect(ctx.motion).toEqual([false]);
  });
});

describe('theme', () => {
  it('is Auto, Light and Dark joined in one control, with the chosen one pressed', () => {
    const panel = panelOf();
    const group = panel.descendants().find((n) => n.className === 'hs-segmented') as FakeElement;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.children.map((b) => b.textContent)).toEqual(['Auto', 'Light', 'Dark']);
    expect(group.children.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    fire(group.children[2] as FakeElement, 'click');
    expect(group.children.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
  });
});

describe('open a saved file', () => {
  it('is our own button over a file input kept out of sight', () => {
    const panel = panelOf();
    const input = byId(panel, 'hs-import') as FakeElement & { type: string; accept: string };
    expect(input.tagName).toBe('INPUT');
    expect(input.type).toBe('file');
    expect(input.hidden).toBe(true);
    expect(input.getAttribute('tabindex')).toBe('-1');
    // No label points at the input, so nothing of the browser's own picker is drawn.
    expect(panel.descendants().some((n) => n.tagName === 'LABEL' && (n as unknown as { htmlFor: string }).htmlFor === 'hs-import')).toBe(false);
    const open = buttonNamed(panel, 'Open a saved file');
    expect(open.className).toBe('hs-set-row hs-set-action');
    fire(open, 'click');
    expect(dom.clicked).toEqual([input]);
  });
});

describe('controls page', () => {
  const coarse = (on: boolean): void => {
    (globalThis as unknown as { window: { matchMedia: (q: string) => { matches: boolean } } }).window.matchMedia = (q) => ({
      matches: on && q.includes('coarse'),
    });
  };
  /** The Settings page in the pause card, as ui.ts pushes it, with Controls a page under it. */
  const settingsPage = (): { card: FakeElement; page(): string | undefined; key(name: string): boolean } => {
    const host = dom.createElement('div');
    const menu = createPauseMenu({
      host: host as never,
      getSpeed: () => 0,
      setSpeed: () => {},
      entries: () => [{ id: 'settings', label: 'Settings', icon: 'settings', kind: 'page' }],
      returnFocus: () => null,
    });
    menu.open();
    const made = settingsBody(game, context(), {
      openControls: () => menu.pushPage({ id: 'controls', title: 'Controls', build: () => controlsBody() }, made.controlsRow),
    });
    menu.pushPage({ id: 'settings', title: 'Settings', build: () => made.node });
    return {
      card: menu.card as unknown as FakeElement,
      page: () => menu.page()?.id,
      key(name) {
        let prevented = false;
        menu.handleKey({ key: name, preventDefault: () => (prevented = true) });
        return prevented;
      },
    };
  };
  const open = (card: FakeElement): FakeElement => {
    fire(buttonNamed(card, 'Controls'), 'click');
    return card.descendants().find((n) => n.className === 'hs-help-controls') as FakeElement;
  };
  const plate = (card: FakeElement): string | undefined => card.descendants().find((n) => n.className.includes('hs-plate-title'))?.textContent;
  const back = (card: FakeElement): FakeElement => card.descendants().find((n) => n.getAttribute('aria-label') === 'Back') as FakeElement;
  const lines = (page: FakeElement): string[] =>
    page.descendants().filter((n) => n.className === 'hs-controls-text').map((n) => n.textContent);

  it('picks the device: a connected controller first, then touch, then the mouse', () => {
    expect(controlsDevice({ coarse: false, gamepads: [] })).toBe('mouse');
    expect(controlsDevice({ coarse: true, gamepads: [null, null] })).toBe('touch');
    expect(controlsDevice({ coarse: true, gamepads: [null, { connected: true }] })).toBe('controller');
    expect(controlsDevice({ coarse: false, gamepads: [{ connected: false }] })).toBe('mouse');
  });

  it('opens from a Controls row with a chevron, as its own page with a way back', () => {
    const { card, page } = settingsPage();
    const row = buttonNamed(card, 'Controls');
    expect(row.descendants().some((n) => n.getAttribute('class') === 'hs-icon hs-set-chevron')).toBe(true);
    expect(page()).toBe('settings');
    expect(card.descendants().some((n) => n.className === 'hs-set-main')).toBe(true);
    fire(row, 'click');
    expect(page()).toBe('controls');
    expect(card.descendants().some((n) => n.className === 'hs-set-main')).toBe(false);
    expect(card.descendants().some((n) => n.className === 'hs-help-controls')).toBe(true);
    const way = back(card);
    expect(way.hidden).toBe(false);
    expect(dom.activeElement).toBe(way);
    expect(plate(card)).toBe('Controls');
    fire(way, 'click');
    expect(page()).toBe('settings');
    expect(plate(card)).toBe('Settings');
    expect(dom.activeElement).toBe(row);
  });

  it('Escape on the page goes back to settings instead of closing the menu', () => {
    const { card, page, key } = settingsPage();
    open(card);
    expect(key('Escape')).toBe(true);
    expect(page()).toBe('settings');
    expect(card.descendants().some((n) => n.className === 'hs-help-controls')).toBe(false);
  });

  it('with a mouse shows only the mouse and keyboard lines, keys included', () => {
    coarse(false);
    const page = open(settingsPage().card);
    expect(page.dataset['device']).toBe('mouse');
    expect(page.children[0]?.textContent).toBe('Mouse and keyboard');
    expect(lines(page)).toEqual(controlLines('mouse').map((l) => l.text));
    for (const line of keyHelpLines(GROUPS.length)) expect(lines(page)).toContain(line);
    expect(page.textContent).not.toMatch(/pinch with two fingers|stick/i);
  });

  it('on a touch screen shows only the touch lines', () => {
    coarse(true);
    const page = open(settingsPage().card);
    expect(page.dataset['device']).toBe('touch');
    expect(page.children[0]?.textContent).toBe('Touch');
    expect(lines(page)).toEqual(controlLines('touch').map((l) => l.text));
    expect(page.textContent).not.toMatch(/mouse|keyboard|W A S D|stick/i);
  });

  it('shows the controller once one is connected, asked again each time the page opens', () => {
    coarse(true);
    const pads: ({ connected: boolean } | null)[] = [null];
    vi.stubGlobal('navigator', { getGamepads: () => pads });
    const { card } = settingsPage();
    expect(open(card).dataset['device']).toBe('touch');
    fire(back(card), 'click');
    pads.push({ connected: true });
    const page = open(card);
    expect(page.dataset['device']).toBe('controller');
    expect(lines(page)).toEqual(controlLines('controller').map((l) => l.text));
    expect(page.textContent).not.toMatch(/mouse|pinch|tap/i);
  });

  it('keeps every line short and plain: one sentence or two, no "seed"', () => {
    for (const device of ['touch', 'mouse', 'controller'] as const) {
      for (const line of controlLines(device)) {
        expect(line.text.length).toBeLessThanOrEqual(160);
        expect(line.text).not.toMatch(/seed/i);
      }
    }
  });
});
