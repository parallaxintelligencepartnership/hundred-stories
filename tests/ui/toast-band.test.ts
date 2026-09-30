import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommandResult, LogEntry } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';
import { createAlertStack } from '../../src/ui/alerts';
import { createStarToast, createTipToast } from '../../src/ui/cards';
import { SAVED_NOTICE } from '../../src/ui/save-button';
import { createToasts } from '../../src/ui/toast';
import { FakeDom, type FakeElement } from './fake-dom';

const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8');

/** The body of a block opened by `head`, up to its closing brace at the same depth. */
function blockOf(head: string): string {
  const at = css.indexOf(head);
  if (at < 0) return '';
  let depth = 0;
  for (let i = at + head.length - 1; i < css.length; i++) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}' && --depth === 0) return css.slice(at, i);
  }
  return '';
}

/** The body of the phone `.hs-toasts` rule: found from `--toast-bleed: 24px;` back to the
    nearest `.hs-toasts {` and forward to the next `}`. */
function phoneToastsRule(): string {
  const bleedAt = css.indexOf('--toast-bleed: 24px;');
  if (bleedAt < 0) return '';
  const ruleStart = css.lastIndexOf('.hs-toasts {', bleedAt);
  if (ruleStart < 0) return '';
  const open = css.indexOf('{', ruleStart);
  return css.slice(ruleStart, css.indexOf('}', open));
}

describe('the phone alert band', () => {
  it('gives the .hs-toasts band bleed room around the cards', () => {
    const mediaAt = css.indexOf('@media (max-width: 720px) {');
    const rule = phoneToastsRule();
    expect(rule).not.toBe('');
    expect(css.indexOf(rule)).toBeGreaterThan(mediaAt);
    expect(rule).toContain('--toast-bleed: 24px;');
    expect(rule).toContain('padding: var(--toast-bleed);');
    expect(rule).toContain('max-height: calc(25vh + 2 * var(--toast-bleed));');
    expect(rule).toContain('left: calc(var(--pad) + var(--safe-left) - var(--toast-bleed));');
    expect(rule).toContain(
      'right: calc(64px + 2 * var(--edge) + var(--safe-right) - var(--toast-bleed));',
    );
    expect(rule).toContain(
      // Under the round buttons' row (a 52 px button and a gap), or under the view chip when lower.
      'top: calc(var(--top-actual, calc(var(--top-h) * 2 + var(--safe-top))) + var(--gap-float) + max(var(--chip-h, 0px), calc(var(--touch) + 8px + var(--gap-float))) - var(--toast-bleed));',
    );
  });

  it('keeps the news toast on its own layer so Safari does not square its corners', () => {
    const news = blockOf('.hs-news-toast {');
    expect(news).toContain('isolation: isolate;');
  });
});

// The text cards carry an icon at their left in place of the old colour stripe: amber for news
// (tips, the star card, notices, Game saved, the update notice), red for trouble (fire, bomb,
// theft, cockroaches, any other alert line, game over). The headline is the first line of words.

/** The Toasts block of ui.css, from its header to the Views header. */
function toastsBlock(): string {
  const start = css.indexOf('/* Toasts ---');
  const end = css.indexOf('/* Views: the information layers');
  return start >= 0 && end > start ? css.slice(start, end) : '';
}

/** One declaration's value in the first rule whose selector is exactly `selector`. */
function declOf(selector: string, prop: string): string {
  const at = css.indexOf(`\n${selector} {`);
  if (at < 0) return '';
  const body = css.slice(at, css.indexOf('}', at));
  return new RegExp(`[;{\\s]${prop}:\\s*([^;]+);`).exec(body)?.[1]?.trim() ?? '';
}

describe('the text cards: an icon, no stripe', () => {
  it('draws no stripe: no ::before bar in the Toasts block and no --toast-edge anywhere', () => {
    const block = toastsBlock();
    expect(block).not.toBe('');
    expect(block).not.toMatch(/::before/);
    expect(css).not.toMatch(/--toast-edge/);
  });

  it('sizes the icon at 20 px, amber by default and red for trouble', () => {
    expect(declOf('.hs-toast-icon', 'width')).toBe('20px');
    expect(declOf('.hs-toast-icon', 'height')).toBe('20px');
    expect(declOf('.hs-toast-icon', 'color')).toBe('var(--amber-text)');
    expect(declOf('.hs-toast-icon.is-alert', 'color')).toBe('var(--alert)');
    expect(declOf('.hs-toast', 'display')).toBe('flex');
    expect(declOf('.hs-toast', 'align-items')).toBe('flex-start');
  });

  it('sets the headline in 600 weight at 14 px and the notes at 12 px in the dim ink', () => {
    expect(declOf('.hs-toast-body > .hs-toast-text:first-child', 'font-weight')).toBe('600');
    expect(declOf('.hs-toast-text', 'font-size')).toBe('var(--size-14)');
    expect(declOf('.hs-toast-note', 'font-size')).toBe('var(--size-12)');
    expect(declOf('.hs-toast-note', 'color')).toBe('var(--ink-dim)');
    expect(declOf('.hs-toast.is-star .hs-toast-body > .hs-toast-text:first-child', 'font-size')).toBe('var(--size-20)');
  });
});

describe("the star card's star sits on its headline's first line (review A7)", () => {
  it('by layout: the icon box is the headline line box on desktop and phone, the 20 px star drawn in its middle, no nudge', () => {
    const icon = '.hs-toast.is-star .hs-toast-icon';
    const head = '.hs-toast.is-star .hs-toast-body > .hs-toast-text:first-child';
    expect(declOf(icon, 'height')).toBe('var(--star-line)');
    expect(declOf(icon, 'margin-top')).toBe('');
    expect(declOf(head, 'line-height')).toBe('var(--star-line)');
    const phoneAt = css.indexOf('@media (max-width: 720px) {\n  /* A phone');
    const phone = phoneAt < 0 ? '' : css.slice(phoneAt, css.indexOf('\n}\n', phoneAt));
    const size = (text: string, selector: string, prop: string): number => {
      const at = text.indexOf(`${selector} {`);
      const body = at < 0 ? '' : text.slice(at, text.indexOf('}', at));
      const m = new RegExp(`${prop}:\\s*calc\\(var\\(--size-(\\d+)\\) \\* ([\\d.]+)\\)|${prop}:\\s*var\\(--size-(\\d+)\\)`).exec(body);
      if (!m) throw new Error(`no ${prop} in ${selector}`);
      return m[1] ? Number(m[1]) * Number(m[2]) : Number(m[3]);
    };
    // The card's own rule: at the top level on desktop, indented inside the phone block.
    const cases: [string, string, string][] = [
      ['desktop', css, '\n.hs-toast.is-star'],
      ['phone', phone, '\n  .hs-toast.is-star'],
    ];
    const offsets = cases.map(([name, text, card]) => {
      const line = size(text, card, '--star-line');
      const font = size(text, head, 'font-size');
      // The line box is the headline's own: its size at 1.25, as the headline sets it.
      expect(line, name).toBe(font * 1.25);
      // The star (20 px wide, a square viewBox) is centred in a box the height of that line.
      return (line - Number.parseFloat(declOf('.hs-toast-icon', 'width'))) / 2;
    });
    expect(offsets).toEqual([2.5, 0]); // 25 px line on desktop, 20 px on a phone
  });
});

describe('every text card leads with one icon in its colour', () => {
  let dom: FakeDom;
  let uninstall: () => void;
  beforeEach(() => {
    dom = new FakeDom();
    uninstall = dom.install();
  });
  afterEach(() => uninstall());

  // An svg icon's class is its class attribute (icons.ts sets it so; className is not a string there).
  const has = (n: FakeElement, c: string): boolean => `${n.className} ${n.getAttribute('class') ?? ''}`.split(/\s+/).includes(c);
  const line = (text: string): LogEntry => ({ minute: 400, level: 'alert', text }) as LogEntry;

  /** The card's first child is its one icon: the symbol and the tone. */
  function iconOf(card: FakeElement): [string | null | undefined, string] {
    const icons = card.descendants().filter((n) => has(n, 'hs-toast-icon'));
    expect(icons).toHaveLength(1);
    const first = card.children[0]!;
    expect(first).toBe(icons[0]);
    return [first.children[0]?.getAttribute('href'), has(first, 'is-alert') ? 'alert' : has(first, 'is-amber') ? 'amber' : '?'];
  }

  /** The first line of words in the card's body. */
  const headline = (card: FakeElement): string | undefined =>
    card.children.find((n) => has(n, 'hs-toast-body'))?.children[0]?.textContent;

  function stack() {
    const world = createWorld(1);
    const host = dom.createElement('div');
    const alerts = createAlertStack({
      host: host as never,
      getWorld: () => world,
      apply: () => ({ ok: true }) as CommandResult,
      later: () => {},
    });
    const card = (cls: string): FakeElement => host.children.find((n) => has(n, 'hs-toast') && has(n, cls))!;
    return { world, host, alerts, card };
  }

  it('fire, bomb, theft, cockroaches, other alerts and game over are red', () => {
    const { world, host, alerts, card } = stack();
    alerts.onAlert(line('Fire broke out in the office on floor 3.'));
    alerts.onAlert(line('A caller planted a bomb in the tower. Pay the ransom.'));
    alerts.onAlert(line('Theft on floor 7, a guard is on the way. Watch the shop.'));
    alerts.onAlert(line('The water main burst.'));
    expect(iconOf(card('is-fire'))).toEqual(['#hs-icon-fire', 'alert']);
    expect(iconOf(card('is-bomb'))).toEqual(['#hs-icon-alert', 'alert']);
    expect(iconOf(card('is-theft'))).toEqual(['#hs-icon-alert', 'alert']);
    expect(headline(card('is-theft'))).toBe('Theft on floor 7, a guard is on the way');
    const other = host.children.find((n) => n.className === 'hs-toast')!;
    expect(iconOf(other)).toEqual(['#hs-icon-alert', 'alert']);
    expect(headline(other)).toBe('The water main burst.');

    world.rooms.set(99, { id: 99, kind: 'office', floor: 5, height: 1, infested: true } as never);
    alerts.onAlert(line('Cockroaches moved into the office on floor 5.'));
    alerts.sync();
    expect(iconOf(card('is-roaches'))).toEqual(['#hs-icon-alert', 'alert']);

    world.gameOver = { at: 500, reason: 'The bank took the tower.' };
    alerts.sync();
    expect(iconOf(card('is-over'))).toEqual(['#hs-icon-finance', 'alert']);
    expect(headline(card('is-over'))).toBe('The bank took the tower.');
  });

  it('a notice is amber, and Game saved shows the save icon', () => {
    const { host, alerts } = stack();
    alerts.notice('Not enough cash.');
    alerts.notice(SAVED_NOTICE);
    const [refusal, saved] = host.children.filter((n) => has(n, 'is-notice'));
    expect(iconOf(refusal!)).toEqual(['#hs-icon-info', 'amber']);
    expect(headline(refusal!)).toBe('Not enough cash.');
    expect(iconOf(saved!)).toEqual(['#hs-icon-save', 'amber']);
  });

  it('the tip and the star card are amber, the star card with a star', () => {
    const tip = createTipToast({ id: 't', text: 'Lobbies go on floor 1.' } as never, () => {}) as unknown as FakeElement;
    expect(iconOf(tip)).toEqual(['#hs-icon-info', 'amber']);
    expect(headline(tip)).toBe('Lobbies go on floor 1.');
    const star = createStarToast('The tower reached 2 stars.', 'Hotels open.', () => {}, () => {}) as unknown as FakeElement;
    expect(iconOf(star)).toEqual(['#hs-icon-star', 'amber']);
    expect(headline(star)).toBe('The tower reached 2 stars.');
  });

  it('the alert toast leads with its icon: amber reload for the update notice, red otherwise', () => {
    const toasts = createToasts();
    const update = toasts.alert('A new version is ready.', { className: 'is-update', action: 'Reload' }) as unknown as FakeElement;
    expect(iconOf(update)).toEqual(['#hs-icon-reload', 'amber']);
    const plain = toasts.alert('The bank took the tower.') as unknown as FakeElement;
    expect(iconOf(plain)).toEqual(['#hs-icon-alert', 'alert']);
    toasts.destroy();
  });
});
