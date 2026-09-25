// The landing page's friend-greeting banner. No jsdom in this repo: a minimal element stub
// stands in for the DOM the way tests/ui/hint.test.ts stands in for localStorage.
import { describe, expect, it } from 'vitest';

import { mountChallenge } from '../../src/site/challenge';

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
    mountChallenge('?floors=0&people=340&stars=1&tower=123456', el, play);
    expect(play).toEqual({ href: '/play/', hidden: true });
  });

  it('leaves the banner untouched and hidden with an invalid query string', () => {
    const el = fakeBanner();
    mountChallenge('?floors=0&people=340&stars=1', el);
    expect(el.hidden).toBe(true);
    expect(el.textContent).toBe('');
  });
});
