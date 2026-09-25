// The landing page's friend-greeting banner. No jsdom in this repo: a minimal element stub
// stands in for the DOM the way tests/ui/hint.test.ts stands in for localStorage.
import { describe, expect, it } from 'vitest';

import { mountChallenge } from '../../src/site/challenge';
import { shareStats, shareUrl } from '../../src/share/share';
import { createWorld } from '../../src/sim/world';

function fakeBanner(): { textContent: string; hidden: boolean } {
  return { textContent: '', hidden: true };
}

describe('mountChallenge', () => {
  it('fills and unhides the banner for 1 star', () => {
    const el = fakeBanner();
    mountChallenge('?floors=12&people=340&stars=1', el);
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe('A friend built a 12-floor tower with 340 people and 1 star. Think you can do better?');
  });

  it('fills and unhides the banner for 3 stars', () => {
    const el = fakeBanner();
    mountChallenge('?floors=40&people=2000&stars=3', el);
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe('A friend built a 40-floor tower with 2,000 people and 3 stars. Think you can do better?');
  });

  it('fills and unhides the banner for 6 stars, calling it TOWER status', () => {
    const el = fakeBanner();
    mountChallenge('?floors=100&people=50000&stars=6', el);
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe('A friend built a 100-floor tower with 50,000 people and TOWER status. Think you can do better?');
  });

  it('leaves the banner untouched and hidden with no query string', () => {
    const el = fakeBanner();
    mountChallenge('', el);
    expect(el.hidden).toBe(true);
    expect(el.textContent).toBe('');
  });

  it('shows Start the same tower, pointed at the play page with the friend’s starting number', () => {
    const el = fakeBanner();
    const play = { href: '/play/', hidden: true };
    mountChallenge('?floors=12&people=340&stars=1&tower=123456', el, play);
    expect(el.hidden).toBe(false);
    expect(play).toEqual({ href: '/play/?seed=123456', hidden: false });
  });

  it('keeps the button hidden when the link carries no starting number', () => {
    const el = fakeBanner();
    const play = { href: '/play/', hidden: true };
    mountChallenge('?floors=12&people=340&stars=1', el, play);
    expect(el.hidden).toBe(false);
    expect(play).toEqual({ href: '/play/', hidden: true });
  });

  it('keeps the button hidden when the challenge itself is invalid', () => {
    const el = fakeBanner();
    const play = { href: '/play/', hidden: true };
    mountChallenge('?floors=201&people=340&stars=1&tower=123456', el, play);
    expect(play).toEqual({ href: '/play/', hidden: true });
  });

  it('leaves the banner untouched and hidden with an invalid query string', () => {
    const el = fakeBanner();
    mountChallenge('?floors=201&people=340&stars=1', el);
    expect(el.hidden).toBe(true);
    expect(el.textContent).toBe('');
  });

  // Audit 2026-09-25, E2 S5: one person is a person.
  it('says "1 person", not "1 people"', () => {
    const el = fakeBanner();
    mountChallenge('?floors=1&people=1&stars=1', el);
    expect(el.textContent).toBe('A friend built a 1-floor tower with 1 person and 1 star. Think you can do better?');
  });

  // Audit 2026-09-25, E2 S6 (decision: floors 0 is allowed): a share from a tower with nothing
  // above ground makes a link its own landing page reads, and the friend keeps the tower button.
  it('reads a share from an empty tower, floors 0, and keeps Start the same tower', () => {
    const url = new URL(shareUrl(shareStats(createWorld(123456))));
    expect(url.searchParams.get('floors')).toBe('0');
    const el = fakeBanner();
    const play = { href: '/play/', hidden: true };
    mountChallenge(url.search, el, play);
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe('A friend just started a tower with 0 people and 1 star. Think you can do better?');
    expect(play).toEqual({ href: '/play/?seed=123456', hidden: false });
  });
});
