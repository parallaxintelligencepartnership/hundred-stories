// The shared sheet (src/ui/sheet.ts) on the fake DOM: a dialog titled by its heading, focus in
// on open and back on close, Tab kept inside, Escape and the backdrop closing it, the half and
// full heights, a drag down to close, the card on a wide screen, and the panels moved onto it.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SHEET_CARD_MIN_WIDTH,
  createSheet,
  focusablesIn,
  sheetMode,
  snapAfterDrag,
  type Sheet,
} from '../../src/ui/sheet';
import { panelShell } from '../../src/ui/panels';
import { createUi } from '../../src/ui/ui';
import { FakeDom, choosePauseEntry, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
});
afterEach(() => uninstall());

const has = (n: FakeElement, c: string): boolean => n.className.split(/\s+/).includes(c);
const byClass = (root: FakeElement, c: string): FakeElement[] => root.descendants().filter((n) => has(n, c));
const click = (node: FakeElement): void => {
  for (const fn of node.listeners.get('click') ?? []) fn({ target: node, currentTarget: node });
};
const fire = (node: FakeElement, type: string, event: Record<string, unknown>): void => {
  for (const fn of node.listeners.get(type) ?? []) fn({ target: node, currentTarget: node, ...event });
};
function key(node: FakeElement, name: string, shiftKey = false): { prevented: boolean } {
  const state = { prevented: false };
  const event = {
    key: name,
    shiftKey,
    get defaultPrevented() {
      return state.prevented;
    },
    preventDefault() {
      state.prevented = true;
    },
  };
  for (const fn of node.listeners.get('keydown') ?? []) fn(event);
  return state;
}
const el = (s: Sheet): FakeElement => s.node as unknown as FakeElement;

/** A sheet with a few controls in its body, mounted in a host, opened from an opener button. */
function openSheet(onClose?: () => void): { sheet: Sheet; host: FakeElement; opener: FakeElement; buttons: FakeElement[] } {
  const host = dom.createElement('div');
  const opener = dom.createElement('button');
  opener.focus();
  const sheet = createSheet({ title: 'Finances', icon: 'finance', ...(onClose ? { onClose } : {}) });
  const body = sheet.body as unknown as FakeElement;
  const one = dom.createElement('button');
  const off = dom.createElement('button');
  off.disabled = true;
  const hidden = dom.createElement('button');
  hidden.hidden = true;
  const field = dom.createElement('input');
  body.append(one, off, hidden, field);
  sheet.mount(host as never);
  return { sheet, host, opener, buttons: [one, field] };
}

describe('layout rules', () => {
  it('is a card from 900 px wide and a bottom sheet below', () => {
    expect(SHEET_CARD_MIN_WIDTH).toBe(900);
    expect([sheetMode(1440), sheetMode(900), sheetMode(899), sheetMode(390), sheetMode(Number.NaN)]).toEqual([
      'card',
      'card',
      'sheet',
      'sheet',
      'sheet',
    ]);
  });

  it('snaps a drag: up to full, down one step, a flick counts even when short', () => {
    expect(snapAfterDrag('half', -60, 0)).toBe('full');
    expect(snapAfterDrag('half', -20, -0.8)).toBe('full');
    expect(snapAfterDrag('half', 40, 0)).toBe('half'); // not far enough to close
    expect(snapAfterDrag('half', 120, 0)).toBe('closed');
    expect(snapAfterDrag('half', 20, 0.9)).toBe('closed');
    expect(snapAfterDrag('full', 60, 0)).toBe('half');
    expect(snapAfterDrag('full', 20, 0.9)).toBe('half');
    expect(snapAfterDrag('full', -200, 0)).toBe('full');
    expect(snapAfterDrag('full', 10, 0)).toBe('full');
  });
});

describe('the dialog', () => {
  it('is a dialog labelled by its heading, with a grab handle, the head and the body', () => {
    const { sheet, host } = openSheet();
    const node = el(sheet);
    expect(node.getAttribute('role')).toBe('dialog');
    const heading = node.descendants().find((n) => n.tagName === 'H2') as FakeElement;
    expect(heading.id).toBe(sheet.titleId);
    expect(node.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(heading.textContent).toBe('Finances');
    expect(node.children.map((n) => n.className)).toEqual(['hs-sheet-handle', 'hs-panel-head', 'hs-panel-body']);
    // A phone: modal, over a backdrop that comes first in the host.
    expect(sheet.mode).toBe('sheet');
    expect(node.getAttribute('aria-modal')).toBe('true');
    expect(host.children).toEqual([sheet.backdrop, node]);
    expect(sheet.isOpen).toBe(true);
    expect(sheet.snap).toBe('half');
    expect(node.getAttribute('data-snap')).toBe('half');
  });

  it('takes focus on open and gives it back to the opener on close', () => {
    const { sheet, opener } = openSheet();
    expect(dom.activeElement).toBe(el(sheet));
    sheet.unmount();
    expect(dom.activeElement).toBe(opener);
    expect(sheet.isOpen).toBe(false);
    expect(el(sheet).parentNode).toBe(null);
    expect((sheet.backdrop as unknown as FakeElement).parentNode).toBe(null);
  });

  it('keeps Tab inside: forward from the last wraps to the first, back from the first to the last', () => {
    const { sheet, buttons } = openSheet();
    const node = el(sheet);
    const items = focusablesIn(node) as unknown as FakeElement[];
    // The handle, Close, then the body's reachable controls: disabled and hidden ones skipped.
    expect(items.map((n) => n.className || n.tagName)).toEqual(['hs-sheet-handle', 'hs-btn hs-panel-close', 'BUTTON', 'INPUT']);
    expect(items.slice(2)).toEqual(buttons);
    expect(key(node, 'Tab').prevented).toBe(true);
    expect(dom.activeElement).toBe(items[0]);
    key(node, 'Tab');
    key(node, 'Tab');
    key(node, 'Tab');
    expect(dom.activeElement).toBe(items[3]);
    key(node, 'Tab');
    expect(dom.activeElement).toBe(items[0]); // wrapped
    key(node, 'Tab', true);
    expect(dom.activeElement).toBe(items[3]); // and back
    // Focus somewhere outside a modal sheet: the next Tab brings it back in.
    dom.body.focus();
    expect(sheet.handleKey({ key: 'Tab', preventDefault() {} })).toBe(true);
    expect(dom.activeElement).toBe(items[0]);
  });

  it('closes on Escape through its owner, who takes it down; focus goes back', () => {
    let asked = 0;
    let sheet: Sheet | null = null;
    const opened = openSheet(() => {
      asked += 1;
      sheet?.unmount();
    });
    sheet = opened.sheet;
    expect(key(el(sheet), 'Escape').prevented).toBe(true);
    expect(asked).toBe(1);
    expect(sheet.isOpen).toBe(false);
    expect(dom.activeElement).toBe(opened.opener);
    // Closed, it answers no keys at all.
    expect(sheet.handleKey({ key: 'Escape', preventDefault() {} })).toBe(false);
  });

  it('closes itself when it has no owner: Escape, the backdrop, and Close', () => {
    for (const how of ['escape', 'backdrop', 'close'] as const) {
      const { sheet, opener } = openSheet();
      if (how === 'escape') key(el(sheet), 'Escape');
      if (how === 'backdrop') click(sheet.backdrop as unknown as FakeElement);
      if (how === 'close') click(byClass(el(sheet), 'hs-panel-close')[0] as FakeElement);
      expect([how, sheet.isOpen]).toEqual([how, false]);
      expect(dom.activeElement).toBe(opener);
    }
  });

  it('toggles half and full from its handle, and a drag snaps or closes', () => {
    const { sheet } = openSheet();
    const handle = byClass(el(sheet), 'hs-sheet-handle')[0] as FakeElement;
    expect(handle.getAttribute('aria-label')).toBe('Make this bigger');
    click(handle);
    expect([sheet.snap, el(sheet).getAttribute('data-snap')]).toEqual(['full', 'full']);
    expect(handle.getAttribute('aria-label')).toBe('Make this smaller');
    sheet.setSnap('half');

    // Up 80 px over 400 ms: full.
    fire(handle, 'pointerdown', { clientY: 500, timeStamp: 1000, pointerId: 1 });
    fire(handle, 'pointermove', { clientY: 420, timeStamp: 1400, pointerId: 1 });
    fire(handle, 'pointerup', { clientY: 420, timeStamp: 1400, pointerId: 1 });
    expect(sheet.snap).toBe('full');
    click(handle); // the click that follows a drag is not a toggle
    expect(sheet.snap).toBe('full');

    // Down 70 px from full: half. Then down 140 px from half: closed.
    const head = byClass(el(sheet), 'hs-panel-head')[0] as FakeElement;
    fire(head, 'pointerdown', { clientY: 100, timeStamp: 2000, pointerId: 2 });
    fire(head, 'pointermove', { clientY: 170, timeStamp: 2500, pointerId: 2 });
    fire(head, 'pointerup', { clientY: 170, timeStamp: 2500, pointerId: 2 });
    expect(sheet.snap).toBe('half');
    expect(el(sheet).style['--sheet-drag']).toBe('0px');
    fire(handle, 'pointerdown', { clientY: 300, timeStamp: 3000, pointerId: 3 });
    fire(handle, 'pointermove', { clientY: 440, timeStamp: 3600, pointerId: 3 });
    expect(el(sheet).style['--sheet-drag']).toBe('140px'); // it follows the finger down
    fire(handle, 'pointerup', { clientY: 440, timeStamp: 3600, pointerId: 3 });
    expect(sheet.isOpen).toBe(false);
  });
});

describe('the card on a wide screen', () => {
  it('floats without a backdrop, is not modal, and only takes keys while focus is in it', () => {
    (globalThis as unknown as { window: { innerWidth: number } }).window.innerWidth = 1280;
    const { sheet, host, opener } = openSheet();
    const node = el(sheet);
    expect(sheet.mode).toBe('card');
    expect(node.getAttribute('data-mode')).toBe('card');
    expect(node.getAttribute('aria-modal')).toBe(null);
    expect(host.children).toEqual([node]);
    // Focus out on the tower: Escape is the tower's (drop the tool), not the card's.
    opener.focus();
    expect(sheet.handleKey({ key: 'Escape', preventDefault() {} })).toBe(false);
    expect(sheet.isOpen).toBe(true);
    node.focus();
    expect(sheet.handleKey({ key: 'Escape', preventDefault() {} })).toBe(true);
    expect(sheet.isOpen).toBe(false);
  });
});

describe('crossing 900 px while open (an iPad turned, a window resized)', () => {
  /** A media query the test flips, as the browser does when the screen crosses the breakpoint. */
  function breakpoint(width: number) {
    const win = (globalThis as unknown as { window: Record<string, unknown> }).window;
    const listeners = new Set<() => void>();
    const query = {
      get matches() {
        return (win['innerWidth'] as number) >= SHEET_CARD_MIN_WIDTH;
      },
      addEventListener: (_type: string, fn: () => void) => void listeners.add(fn),
      removeEventListener: (_type: string, fn: () => void) => void listeners.delete(fn),
    };
    const asked: string[] = [];
    win['innerWidth'] = width;
    win['matchMedia'] = (q: string) => {
      asked.push(q);
      return query;
    };
    return {
      listeners,
      asked,
      resize(to: number) {
        win['innerWidth'] = to;
        for (const fn of [...listeners]) fn();
      },
    };
  }

  /** The feedback card's shape: a text box with words typed in it, focus in it. */
  function openWithTyping() {
    const host = dom.createElement('div');
    const opener = dom.createElement('button');
    opener.focus();
    const sheet = createSheet({ title: 'Send feedback' });
    const field = dom.createElement('textarea') as FakeElement & { value?: string };
    const send = dom.createElement('button');
    (sheet.body as unknown as FakeElement).append(field, send);
    sheet.mount(host as never);
    field.focus();
    field.value = 'The lobby elevator is slow';
    return { sheet, host, opener, field, send };
  }

  const handleOf = (s: Sheet): FakeElement => byClass(el(s), 'hs-sheet-handle')[0]!;
  const press = (handle: FakeElement): void => fire(handle, 'pointerdown', { clientY: 400, timeStamp: 1, pointerId: 9 });

  it('card to sheet: becomes modal with its backdrop, takes Escape from anywhere, and its handle drags; the body, the words and focus stay', () => {
    const media = breakpoint(1440);
    const { sheet, host, opener, field, send } = openWithTyping();
    const node = el(sheet);
    expect(media.asked).toEqual(['(min-width: 900px)']);
    expect([sheet.mode, node.getAttribute('aria-modal'), host.children.length]).toEqual(['card', null, 1]);
    press(handleOf(sheet));
    expect(node.classList.contains('is-dragging')).toBe(false); // a card has no drag

    media.resize(800);
    expect(sheet.mode).toBe('sheet');
    expect(node.getAttribute('data-mode')).toBe('sheet');
    expect(node.getAttribute('aria-modal')).toBe('true');
    expect(host.children).toContain(sheet.backdrop as unknown as FakeElement);
    expect(host.children).toContain(node);
    expect(node.style['--sheet-drag']).toBe('0px');
    // Nothing rebuilt, nothing typed lost, focus where the player had it.
    expect((sheet.body as unknown as FakeElement).children).toEqual([field, send]);
    expect(field.value).toBe('The lobby elevator is slow');
    expect(dom.activeElement).toBe(field);
    // The handle drags now.
    press(handleOf(sheet));
    expect(node.classList.contains('is-dragging')).toBe(true);
    // A modal sheet's Escape is its own wherever focus is.
    fire(handleOf(sheet), 'pointercancel', { clientY: 400, timeStamp: 2, pointerId: 9 });
    opener.focus();
    expect(sheet.handleKey({ key: 'Escape', preventDefault() {} })).toBe(true);
    expect(sheet.isOpen).toBe(false);
  });

  it('sheet to card: drops the backdrop and aria-modal, leaves Escape to the tower while focus is outside, and the handle stops dragging', () => {
    const media = breakpoint(800);
    const { sheet, host, opener, field } = openWithTyping();
    const node = el(sheet);
    expect([sheet.mode, node.getAttribute('aria-modal')]).toEqual(['sheet', 'true']);
    expect(host.children[0]).toBe(sheet.backdrop as unknown as FakeElement);
    press(handleOf(sheet)); // a drag in progress when the screen turns is dropped
    expect(node.classList.contains('is-dragging')).toBe(true);

    media.resize(1440);
    expect(sheet.mode).toBe('card');
    expect(node.getAttribute('data-mode')).toBe('card');
    expect(node.getAttribute('aria-modal')).toBe(null);
    expect(host.children).toEqual([node]);
    expect(node.classList.contains('is-dragging')).toBe(false);
    expect(node.style['--sheet-drag']).toBe('0px');
    expect(field.value).toBe('The lobby elevator is slow');
    expect(dom.activeElement).toBe(field);
    press(handleOf(sheet));
    expect(node.classList.contains('is-dragging')).toBe(false);
    opener.focus();
    expect(sheet.handleKey({ key: 'Escape', preventDefault() {} })).toBe(false);
    expect(sheet.isOpen).toBe(true);
    // And back again.
    media.resize(800);
    expect([sheet.mode, node.getAttribute('aria-modal'), host.children.length]).toEqual(['sheet', 'true', 2]);
  });

  it('a watchable sheet (the elevator card) never gets a backdrop on the way', () => {
    const media = breakpoint(1440);
    const host = dom.createElement('div');
    const sheet = createSheet({ title: 'Elevator', watchable: true });
    sheet.mount(host as never);
    media.resize(800);
    expect([sheet.mode, el(sheet).getAttribute('aria-modal'), host.children]).toEqual(['sheet', null, [el(sheet)]]);
  });

  it('stops listening when it is taken down, and a resize after that changes nothing', () => {
    const media = breakpoint(1440);
    const { sheet } = openWithTyping();
    expect(media.listeners.size).toBe(1);
    sheet.unmount();
    expect(media.listeners.size).toBe(0);
    media.resize(800);
    expect(el(sheet).getAttribute('data-mode')).toBe('card');
    // Mounted again, it listens once, not twice.
    sheet.mount(dom.createElement('div') as never);
    sheet.mount(dom.createElement('div') as never);
    expect(media.listeners.size).toBe(1);
  });
});

describe('reduced motion', () => {
  const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8');
  const block = (head: string): string => {
    const at = css.indexOf(head);
    return css.slice(at, css.indexOf('}', at));
  };

  it('turns the slide into a plain fade, for the setting and for the system', () => {
    for (const head of ['.hs-ui.is-reduced {', '@media (prefers-reduced-motion: reduce) {\n  .hs-ui {']) {
      const rules = block(head);
      expect(rules).toContain('--enter-y: 0px;');
      expect(rules).toContain('--enter-x: 0px;');
      expect(rules).toContain('--ease-spring: var(--ease-standard);');
      expect(rules).toContain('--press-scale: 1;');
    }
    expect(block('.hs-ui.is-reduced .hs-sheet {')).toContain('transition: opacity var(--motion-fade) var(--ease-standard);');
    // The sheet enters from --enter-y and --enter-x, which reduced motion zeroes.
    expect(css).toContain('transform: translateY(var(--enter-y));');
    expect(css).toContain('transform: translateX(var(--enter-x));');
  });
});

describe('panels on the sheet', () => {
  it('builds every panel frame as a sheet: the node is the dialog, Close asks the owner', () => {
    let closed = 0;
    const { panel, body } = panelShell('Event log', 'log', { close: () => (closed += 1) });
    const node = panel as unknown as FakeElement;
    expect(panel.sheet?.node).toBe(panel);
    expect(panel.sheet?.body).toBe(body);
    expect(has(node, 'hs-panel') && has(node, 'hs-sheet')).toBe(true);
    expect(node.getAttribute('role')).toBe('dialog');
    click(byClass(node, 'hs-panel-close')[0] as FakeElement);
    expect(closed).toBe(1);
  });

  // Since 2026-09-30 the menu's Settings is a page inside the pause card, not a sheet: nothing
  // goes into the panel slot, Escape goes back to the menu, and a second Escape closes it.
  it('opens Settings from the menu as a page in the card, no sheet; Escape goes back to the menu, and a second Escape puts focus back on Menu', () => {
    const world = { cash: 1, population: 0, stars: 1, seed: 1, time: { minute: 600 }, log: [], logTotal: 0, rooms: new Map(), shafts: new Map(), sims: new Map(), events: [] };
    const api = {
      world,
      subscribe: () => () => {},
      getHover: () => null,
      getSpeed: () => 1,
      setSpeed: () => {},
      getTool: () => ({ kind: 'none' }),
      setTool: () => {},
      getPlacement: () => null,
      getPlacementRect: () => null,
      getSelection: () => null,
      select: () => {},
      setChrome: () => {},
      setReducedMotion: () => {},
      getSlot: () => 'mine',
    } as never;
    const root = dom.createElement('div');
    createUi(root as never, api, {} as never);
    const menu = root.descendants().find((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Menu') as FakeElement;
    menu.focus();
    click(menu);
    choosePauseEntry(root, 'settings');
    const slot = byClass(root, 'hs-panel-slot')[0] as FakeElement;
    expect(slot.children).toHaveLength(0);
    const dialog = byClass(root, 'hs-pause-card')[0] as FakeElement;
    expect(byClass(dialog, 'hs-plate-title')[0]?.textContent).toBe('Settings');
    expect(byClass(root, 'hs-sheet')).toHaveLength(0);
    expect(byClass(root, 'hs-sheet-backdrop')).toHaveLength(0);
    expect(dialog.contains(dom.activeElement)).toBe(true);
    let prevented = false;
    const escape = (target: unknown): void => {
      prevented = false;
      dom.fireWindow('keydown', {
        key: 'Escape',
        code: 'Escape',
        target,
        get defaultPrevented() {
          return prevented;
        },
        preventDefault() {
          prevented = true;
        },
        stopImmediatePropagation() {},
      });
    };
    escape(dialog);
    expect(prevented).toBe(true);
    expect(slot.children).toHaveLength(0);
    // Back in the pause menu, on its Settings entry.
    expect((dom.activeElement as FakeElement).dataset['entry']).toBe('settings');
    escape(dom.activeElement);
    expect(prevented).toBe(true);
    expect(byClass(root, 'hs-pause')).toHaveLength(0);
    expect(dom.activeElement).toBe(menu);
  });
});
