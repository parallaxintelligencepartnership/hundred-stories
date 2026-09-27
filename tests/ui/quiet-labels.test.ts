// Smart hiding for the round Watch and Sound buttons (Matt, 2026-09-27): their words collapse to
// the icon after LABEL_IDLE_MS without input, and come back with any pointer move, press or key;
// hover or keyboard focus keeps a button's word out (ui.css). The Watch eye is drawn with more
// detail: iris, pupil and lashes.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIconSheet } from '../../src/ui/icons';
import { LABEL_IDLE_MS, LABELS_QUIET_CLASS, createQuietLabels } from '../../src/ui/quiet-labels';
import { FakeDom, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  dom = new FakeDom();
  uninstall = dom.install();
});
afterEach(() => {
  uninstall();
  vi.useRealTimers();
});

function setup(): { shell: FakeElement; changes: boolean[]; labels: ReturnType<typeof createQuietLabels> } {
  const shell = dom.createElement('div');
  shell.className = 'hs-ui';
  const changes: boolean[] = [];
  const labels = createQuietLabels({ shell, onChange: (quiet) => changes.push(quiet) });
  return { shell, changes, labels };
}

const quiet = (shell: FakeElement): boolean => shell.classList.contains(LABELS_QUIET_CLASS);
const move = (): void => dom.fireWindow('pointermove', { type: 'pointermove', target: dom.body });

describe('quiet labels', () => {
  it('starts with the words out, and collapses them after LABEL_IDLE_MS without input', () => {
    const { shell, changes, labels } = setup();
    expect([quiet(shell), labels.isQuiet(), changes]).toEqual([false, false, []]);
    vi.advanceTimersByTime(LABEL_IDLE_MS - 1);
    expect(quiet(shell)).toBe(false);
    vi.advanceTimersByTime(1);
    expect([quiet(shell), labels.isQuiet(), changes]).toEqual([true, true, [true]]);
  });

  it('a pointer move brings the words back, and they go again after another idle stretch', () => {
    const { shell, changes } = setup();
    vi.advanceTimersByTime(LABEL_IDLE_MS);
    move();
    expect([quiet(shell), changes]).toEqual([false, [true, false]]);
    vi.advanceTimersByTime(LABEL_IDLE_MS);
    expect([quiet(shell), changes]).toEqual([true, [true, false, true]]);
    // A press and a key count too.
    dom.fireWindow('pointerdown', { type: 'pointerdown', target: dom.body });
    expect(quiet(shell)).toBe(false);
    vi.advanceTimersByTime(LABEL_IDLE_MS);
    dom.fireWindow('keydown', { type: 'keydown', key: 'Shift', target: dom.body });
    expect(quiet(shell)).toBe(false);
  });

  it('a moving pointer keeps the words out, with one timer at most', () => {
    const { shell, changes } = setup();
    vi.advanceTimersByTime(1500);
    for (let i = 0; i < 20; i += 1) move();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1500);
    expect(quiet(shell)).toBe(false);
    vi.advanceTimersByTime(600);
    expect([quiet(shell), changes]).toEqual([true, [true]]);
  });

  it('never prevents or stops the input it hears', () => {
    setup();
    vi.advanceTimersByTime(LABEL_IDLE_MS);
    const event = { type: 'pointerdown', target: dom.body, preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn() };
    dom.fireWindow('pointerdown', event);
    expect([event.preventDefault, event.stopPropagation, event.stopImmediatePropagation].map((f) => f.mock.calls.length)).toEqual([0, 0, 0]);
  });

  it('destroy stops the timer and the listeners', () => {
    const { shell, changes, labels } = setup();
    labels.destroy();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(LABEL_IDLE_MS * 3);
    move();
    expect([quiet(shell), changes]).toEqual([false, []]);
    expect(dom.windowListeners.get('pointermove') ?? []).toEqual([]);
  });
});

describe('quiet labels styles', () => {
  const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8');
  const sheet = css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('collapses the Watch and Sound words while quiet, unless hovered or focused', () => {
    const heads = sheet.split('{').map((part) => part.slice(part.lastIndexOf('}') + 1).trim());
    const collapse = heads.find(
      (head) =>
        head.includes(`.${LABELS_QUIET_CLASS}`) &&
        head.includes('.hs-watch-btn') &&
        head.includes('.hs-sound-btn') &&
        head.includes(':not(:hover)') &&
        head.includes(':not(:focus-visible)') &&
        head.endsWith('.hs-btn-label'),
    );
    expect(collapse).toBeDefined();
    const body = sheet.slice(sheet.indexOf(`${collapse as string} {`));
    expect(body.slice(0, body.indexOf('}'))).toContain('max-width: 0;');
  });

  it('has no label fade under reduced motion, the setting or the system', () => {
    const block = (start: string): string => {
      const at = css.indexOf(start);
      return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
    };
    expect(block(':root {')).toContain('--label-fade: 220ms;');
    expect(block('.hs-ui.is-reduced {')).toContain('--label-fade: 0ms;');
    const system = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n  .hs-ui {'));
    expect(system.slice(0, system.indexOf('}'))).toContain('--label-fade: 0ms;');
  });
});

describe('the Watch eye', () => {
  it('has an iris, a filled pupil and lashes', () => {
    // icon('watch') refers to this symbol by id; the drawing lives here.
    const sheet = createIconSheet() as unknown as FakeElement;
    const eye = sheet.children.find((n) => n.getAttribute('id') === 'hs-icon-watch') as FakeElement & { innerHTML: string };
    const sprite = eye.innerHTML;
    expect(sprite).toContain('<circle cx="8" cy="8" r="2.6"');
    expect(sprite).toContain('fill="currentColor"');
    expect(sprite).toContain('M4.2 4.6l-.7-1.1M11.8 4.6l.7-1.1');
  });
});
