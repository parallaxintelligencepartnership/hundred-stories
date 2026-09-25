// Toasts (src/ui/toast.ts) on the fake DOM with fake timers: news fades after four seconds, at
// most two show at once, alerts stay until tapped, and each kind speaks through its own live
// region.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NEWS_TOAST_MAX, NEWS_TOAST_MS, TOAST_FADE_MS, createToasts, type Toasts } from '../../src/ui/toast';
import { FakeDom, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
let toasts: Toasts;
beforeEach(() => {
  vi.useFakeTimers();
  dom = new FakeDom();
  uninstall = dom.install();
  toasts = createToasts();
});
afterEach(() => {
  toasts.destroy();
  uninstall();
  vi.useRealTimers();
});

const news = (): FakeElement => toasts.news as unknown as FakeElement;
const alerts = (): FakeElement => toasts.alerts as unknown as FakeElement;
const words = (n: FakeElement): string => n.children.find((c) => c.className === 'hs-toast-words')?.textContent ?? '';
const click = (node: HTMLElement): void => {
  for (const fn of (node as unknown as FakeElement).listeners.get('click') ?? []) fn({});
};

describe('live regions', () => {
  it('speaks news politely and alerts assertively, from regions made before anything lands', () => {
    expect([news().getAttribute('role'), news().getAttribute('aria-live')]).toEqual(['status', 'polite']);
    expect([alerts().getAttribute('role'), alerts().getAttribute('aria-live')]).toEqual(['alert', 'assertive']);
    expect(news().children).toHaveLength(0);
    expect(alerts().children).toHaveLength(0);
    toasts.show('Built a lobby on floor 1.');
    toasts.alert('The bank took the tower.');
    expect(news().children.map(words)).toEqual(['Built a lobby on floor 1.']);
    expect(alerts().children.map(words)).toEqual(['The bank took the tower.']);
  });
});

describe('news', () => {
  it('fades after about four seconds, then leaves the page', () => {
    expect(NEWS_TOAST_MS).toBe(4000);
    const node = toasts.show('Rent came in: $12,000.', { time: '9:00 AM' }) as unknown as FakeElement;
    expect(node.children.map((c) => c.className)).toEqual(['hs-toast-time', 'hs-toast-words']);
    vi.advanceTimersByTime(NEWS_TOAST_MS - 1);
    expect(node.classList.contains('is-leaving')).toBe(false);
    expect(toasts.visibleNews()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(node.classList.contains('is-leaving')).toBe(true);
    expect(toasts.visibleNews()).toHaveLength(0); // fading, it no longer counts
    expect(node.parentNode).toBe(news());
    vi.advanceTimersByTime(TOAST_FADE_MS);
    expect(node.parentNode).toBe(null);
  });

  it('shows at most two: a third pushes the oldest off at once', () => {
    expect(NEWS_TOAST_MAX).toBe(2);
    const first = toasts.show('one') as unknown as FakeElement;
    vi.advanceTimersByTime(1000);
    toasts.show('two');
    toasts.show('three');
    expect(first.parentNode).toBe(null);
    expect(news().children.map(words)).toEqual(['two', 'three']);
    expect(toasts.visibleNews().map((n) => words(n as unknown as FakeElement))).toEqual(['two', 'three']);
    // The pushed one's timer is gone with it; the others keep their own four seconds.
    vi.advanceTimersByTime(NEWS_TOAST_MS + TOAST_FADE_MS);
    expect(news().children).toHaveLength(0);
  });

  it('is a button that does its tap and fades when it has one, plain text when it does not', () => {
    let opened = 0;
    const plain = toasts.show('A quiet line.') as unknown as FakeElement;
    expect(plain.tagName).toBe('DIV');
    const tappable = toasts.show('Built an office.', { onTap: () => (opened += 1), tapLabel: 'Open the event log', className: 'is-story' });
    const node = tappable as unknown as FakeElement;
    expect([node.tagName, node.title, node.classList.contains('is-story')]).toEqual(['BUTTON', 'Open the event log', true]);
    click(tappable);
    expect(opened).toBe(1);
    expect(node.classList.contains('is-leaving')).toBe(true);
    vi.advanceTimersByTime(TOAST_FADE_MS);
    expect(node.parentNode).toBe(null);
  });
});

describe('alerts', () => {
  it('stay until tapped, however long that takes', () => {
    let tapped = 0;
    const node = toasts.alert('The bank took the tower.', { onTap: () => (tapped += 1) }) as unknown as FakeElement;
    expect(node.tagName).toBe('BUTTON');
    expect(node.title).toBe('Tap to close');
    vi.advanceTimersByTime(10 * 60_000);
    expect(node.parentNode).toBe(alerts());
    expect(node.classList.contains('is-leaving')).toBe(false);
    click(node as unknown as HTMLElement);
    expect(tapped).toBe(1);
    vi.advanceTimersByTime(TOAST_FADE_MS);
    expect(node.parentNode).toBe(null);
  });

  it('are never pushed off by news, and Escape closes the newest', () => {
    const first = toasts.alert('First.') as unknown as FakeElement;
    const second = toasts.alert('Second.') as unknown as FakeElement;
    for (let i = 0; i < 5; i += 1) toasts.show(`news ${i}`);
    vi.advanceTimersByTime(NEWS_TOAST_MS * 3);
    expect(alerts().children).toEqual([first, second]);
    expect(toasts.dismissNewestAlert()).toBe(true);
    expect(second.classList.contains('is-leaving')).toBe(true);
    expect(toasts.dismissNewestAlert()).toBe(true);
    expect(toasts.dismissNewestAlert()).toBe(false);
  });
});

describe('clear and destroy', () => {
  it('takes everything down at once and leaves no timer running', () => {
    toasts.show('one');
    toasts.alert('two');
    toasts.clear();
    expect(news().children).toHaveLength(0);
    expect(alerts().children).toHaveLength(0);
    toasts.show('three');
    toasts.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the look', () => {
  const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8');
  const ruleOf = (selector: string): string => {
    const at = css.indexOf(`\n${selector} {`);
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
  };

  it('floats the news on glass above the bottom edge, fading in and out', () => {
    const region = ruleOf('.hs-news');
    expect(region).toContain('position: absolute;');
    expect(region).toContain('bottom: calc(var(--chrome-bottom, 0px) + var(--safe-bottom) + var(--edge) + 4px);');
    const toast = ruleOf('.hs-news-toast');
    expect(toast).toContain('background: var(--glass);');
    expect(toast).toContain('backdrop-filter: var(--glass-blur);');
    expect(toast).toContain('min-height: var(--touch);');
    expect(toast).toContain('opacity var(--motion-fade) var(--ease-standard)');
    expect(css).toContain('.hs-news-toast.is-leaving,\n.hs-alert-toast.is-leaving {\n  opacity: 0;\n}');
    // The fade out in script matches the fade token.
    expect(css).toContain(`--motion-fade: ${TOAST_FADE_MS}ms;`);
    // Under reduced motion the toast only fades: it does not rise.
    const reduced = css.slice(css.indexOf('.hs-ui.is-reduced {'), css.indexOf('}', css.indexOf('.hs-ui.is-reduced {')));
    expect(reduced).toContain('--toast-rise: 0px;');
  });
});
