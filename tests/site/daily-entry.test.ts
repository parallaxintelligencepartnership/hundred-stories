// The landing hero's second button opens today's tower, under the main Play button.
import landing from '../../index.html?raw';
import { describe, expect, it } from 'vitest';
import { sameTowerHref } from '../../src/site/challenge';

describe("today's tower on the landing page", () => {
  it("puts Play today's tower, a secondary button, right under Play in your browser", () => {
    const flat = landing.replace(/\s+/g, ' ');
    expect(flat).toContain(
      '<a class="button" href="/play/">Play in your browser</a> <a class="button button-secondary" href="/play/?daily=today">Play today\'s tower</a>',
    );
  });

  it("keeps the friend greeting's link on ?seed=N, which the game opens in the Friend's tower slot", () => {
    expect(sameTowerHref(4242)).toBe('/play/?seed=4242');
  });
});
