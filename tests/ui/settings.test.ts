// The settings sheet on a fake DOM: grouped rows like a phone's settings app, real toggle
// switches that remember, the styled Open button over a hidden file input, the Theme choice,
// and the Controls page that shows only the device in the player's hands.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { controlLines, controlsDevice } from '../../src/ui/controls';
import { keyHelpLines } from '../../src/ui/keys';
import { GROUPS } from '../../src/ui/palette';
import { createSettingsPanel, type PanelContext } from '../../src/ui/panels';
import { getFlag, PREF_KEYS } from '../../src/ui/prefs';
import { FakeDom, type FakeElement } from './fake-dom';

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

const panelOf = (ctx: PanelContext = context()): FakeElement => createSettingsPanel(game, ctx) as unknown as FakeElement;
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
  it('reads like a phone settings app: Game, Saving, Display, Help, each a titled list of rows', () => {
    const panel = panelOf();
    const main = panel.descendants().find((n) => n.className === 'hs-set-main') as FakeElement;
    const titles = main.children.map((s) => s.children[0]?.textContent);
    expect(titles).toEqual(['Game', 'Saving', 'Display', 'Help']);
    for (const group of main.children) {
      expect(group.className).toBe('hs-section');
      expect(group.lastElementChild?.className).toBe('hs-set-list');
    }
    const game = main.children[0] as FakeElement;
    expect(game.lastElementChild?.children.map((r) => r.textContent)).toEqual(["Today's tower", 'New game', 'Stories']);
    const help = main.children[3] as FakeElement;
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
  const open = (panel: FakeElement): FakeElement => {
    fire(buttonNamed(panel, 'Controls'), 'click');
    return panel.descendants().find((n) => n.className === 'hs-help-controls') as FakeElement;
  };
  const lines = (page: FakeElement): string[] =>
    page.descendants().filter((n) => n.className === 'hs-controls-text').map((n) => n.textContent);

  it('picks the device: a connected controller first, then touch, then the mouse', () => {
    expect(controlsDevice({ coarse: false, gamepads: [] })).toBe('mouse');
    expect(controlsDevice({ coarse: true, gamepads: [null, null] })).toBe('touch');
    expect(controlsDevice({ coarse: true, gamepads: [null, { connected: true }] })).toBe('controller');
    expect(controlsDevice({ coarse: false, gamepads: [{ connected: false }] })).toBe('mouse');
  });

  it('opens from a Controls row with a chevron, as its own page with a way back', () => {
    const panel = panelOf();
    const row = buttonNamed(panel, 'Controls');
    expect(row.descendants().some((n) => n.getAttribute('class') === 'hs-icon hs-set-chevron')).toBe(true);
    const main = panel.descendants().find((n) => n.className === 'hs-set-main') as FakeElement;
    const page = panel.descendants().find((n) => n.className === 'hs-set-page') as FakeElement;
    expect([main.hidden, page.hidden]).toEqual([false, true]);
    fire(row, 'click');
    expect([main.hidden, page.hidden]).toEqual([true, false]);
    const back = buttonNamed(panel, 'Back');
    expect(back.getAttribute('aria-label')).toBe('Back to settings');
    expect(dom.activeElement).toBe(back);
    const title = panel.descendants().find((n) => n.className === 'hs-panel-title-text') as FakeElement;
    expect(title.textContent).toBe('Controls');
    fire(back, 'click');
    expect([main.hidden, page.hidden]).toEqual([false, true]);
    expect(title.textContent).toBe('Settings');
    expect(dom.activeElement).toBe(row);
  });

  it('Escape on the page goes back to settings instead of closing the sheet', () => {
    const panel = panelOf();
    open(panel);
    const page = panel.descendants().find((n) => n.className === 'hs-set-page') as FakeElement;
    let prevented = false;
    fire(page, 'keydown', { key: 'Escape', defaultPrevented: false, preventDefault: () => (prevented = true) });
    expect(prevented).toBe(true);
    expect(page.hidden).toBe(true);
  });

  it('with a mouse shows only the mouse and keyboard lines, keys included', () => {
    coarse(false);
    const page = open(panelOf());
    expect(page.dataset['device']).toBe('mouse');
    expect(page.children[0]?.textContent).toBe('Mouse and keyboard');
    expect(lines(page)).toEqual(controlLines('mouse').map((l) => l.text));
    for (const line of keyHelpLines(GROUPS.length)) expect(lines(page)).toContain(line);
    expect(page.textContent).not.toMatch(/pinch with two fingers|stick/i);
  });

  it('on a touch screen shows only the touch lines', () => {
    coarse(true);
    const page = open(panelOf());
    expect(page.dataset['device']).toBe('touch');
    expect(page.children[0]?.textContent).toBe('Touch');
    expect(lines(page)).toEqual(controlLines('touch').map((l) => l.text));
    expect(page.textContent).not.toMatch(/mouse|keyboard|W A S D|stick/i);
  });

  it('shows the controller once one is connected, asked again each time the page opens', () => {
    coarse(true);
    const pads: ({ connected: boolean } | null)[] = [null];
    vi.stubGlobal('navigator', { getGamepads: () => pads });
    const panel = panelOf();
    expect(open(panel).dataset['device']).toBe('touch');
    fire(buttonNamed(panel, 'Back'), 'click');
    pads.push({ connected: true });
    const page = open(panel);
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
