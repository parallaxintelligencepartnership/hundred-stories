// Design pass P8, the site system: the site's controls are the game's with one amber (D-38), the
// floors below the fold carry specimens drawn by the game's own code (D-39), and the 404 page has
// the header band and a way into the game (D-40). The contract is the markup and the stylesheet.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import notfound from '../../404.html?raw';
import guide from '../../how-to-play/index.html?raw';
import landing from '../../index.html?raw';
import privacy from '../../privacy/index.html?raw';
import { describe, expect, it } from 'vitest';

// Read off disk: vitest hands a .css?raw import over empty.
const css = readFileSync(join(__dirname, '..', '..', 'src', 'site', 'site.css'), 'utf8');
const flat = (text: string): string => text.replace(/\s+/g, ' ');

/** The declarations of the rule whose selector list is exactly `selector`, or null. */
function rule(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const m = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return m ? flat(m[1] as string).trim() : null;
}

/** The markup of the section labelled by `id`, up to its closing tag. */
function section(html: string, id: string): string {
  const start = html.indexOf(`aria-labelledby="${id}"`);
  expect(start, `section ${id}`).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</section>', start));
}

const specimensIn = (html: string): string[] => [...html.matchAll(/data-specimen="([a-z]+)"/g)].map((m) => m[1] as string);

describe('D-38: the site controls are the game controls, with one amber', () => {
  it('sets the nav links and the theme button in the game face, sentence case, untracked', () => {
    const nav = rule('.site-nav a, .theme-toggle');
    expect(nav).not.toBeNull();
    expect(nav).toContain('font-family: var(--font-ui);');
    expect(nav).toContain('font-size: var(--size-14);');
    expect(nav).toContain('text-transform: none;');
    expect(nav).toContain('letter-spacing: 0;');
  });

  it('lights Play as an amber pill that keeps its dark text over the nav link colour', () => {
    const play = rule('.site-nav .nav-play');
    expect(play).not.toBeNull();
    expect(play).toContain('border: 0;');
    expect(play).toContain('border-radius: 999px;');
    expect(play).toContain('background: var(--amber);');
    expect(play).toContain('color: var(--on-amber);');
  });

  it('draws the buttons as pills in the same amber with a soft lift, not a lemon slab with a hard drop', () => {
    const button = rule('.button');
    expect(button).toContain('border: 0;');
    expect(button).toContain('border-radius: 999px;');
    expect(button).toContain('background: var(--amber);');
    expect(button).toContain('box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2), 0 8px 20px rgba(0, 0, 0, 0.18);');
    expect(button).not.toContain('var(--w-car)');
    expect(rule('.button:hover')).toBe('transform: translateY(-1px);');
    const secondary = rule('.button-secondary');
    expect(secondary).toContain('background: var(--w-lobby);');
    expect(secondary).toContain('box-shadow: inset 0 0 0 2px var(--w-outline);');
  });

  it('sets the footer headings and the maker line in Bricolage 600, sentence case, untracked', () => {
    for (const selector of ['.foot-col h2', '.foot-mark']) {
      const r = rule(selector);
      expect(r, selector).toContain('font-family: var(--font-ui);');
      expect(r, selector).toContain('font-weight: 600;');
      expect(r, selector).toContain('text-transform: none;');
      expect(r, selector).toContain('letter-spacing: 0;');
    }
  });

  it('writes the store buttons\' Coming soon to line in sentence case, untracked, weight unchanged', () => {
    const top = rule('.store-link-top');
    expect(top).toContain('text-transform: none;');
    expect(top).toContain('letter-spacing: 0;');
    expect(top).toContain('font-weight: 500;');
  });

  it('rings anything else focused in two tones, amber outside and the world ink inside, so one always reads', () => {
    expect(rule(':focus-visible')).toBe('outline: 2px solid var(--amber-text); outline-offset: 2px; box-shadow: 0 0 0 2px var(--w-text);');
  });

  it('rings a focused button in its own ink, never the amber it is filled with', () => {
    expect(rule('.button:focus-visible')).toBe('outline: 2px solid var(--on-amber); outline-offset: 2px;');
    expect(rule('.button-secondary:focus-visible')).toBe('outline-color: var(--w-text);');
    expect(rule('.site-nav .nav-play:focus-visible')).toBe('outline: 2px solid var(--ink); outline-offset: 2px;');
  });

  it('keeps the floor tag a steel chip with the green readout face, untracked', () => {
    const tag = rule('.floor-tag');
    expect(tag).toContain('background: #1c232e;');
    expect(tag).toContain('color: #8ff0c0;');
    expect(tag).toContain('font-family: var(--font-readout);');
    expect(tag).not.toContain('uppercase');
    expect(tag).not.toContain('letter-spacing');
  });

  it('writes each floor tag as the floor alone on the landing page, the guide and the privacy page', () => {
    for (const page of [landing, guide, privacy]) {
      const tags = [...page.matchAll(/<p class="floor-tag">([^<]*)<\/p>/g)].map((m) => m[1] as string);
      expect(tags.length).toBeGreaterThan(0);
      for (const tag of tags) expect(tag).toMatch(/^B\d+$/);
    }
  });
});

describe('D-39: specimens drawn by the game below the fold', () => {
  it('loads the specimens module on the landing page and the guide', () => {
    for (const page of [landing, guide]) expect(page).toContain('<script type="module" src="/src/site/specimens.ts"></script>');
  });

  it('places people on B1, an office and a shop in the B2 cards and a car on B4 of the landing page', () => {
    expect(specimensIn(section(landing, 'the-name'))).toEqual(['people']);
    expect(specimensIn(section(landing, 'features'))).toEqual(['office', 'shop']);
    const cards = section(landing, 'features').split('<article class="card">').slice(1);
    expect(cards.map(specimensIn)).toEqual([['office'], ['shop']]);
    expect(specimensIn(section(landing, 'how-it-plays'))).toEqual(['car']);
    expect(specimensIn(landing)).toEqual(['people', 'office', 'shop', 'car']);
  });

  it('places an office in Rooms, a car in Elevators, the stress marks in Tenants and stress and people in People and their stories', () => {
    expect(specimensIn(section(guide, 'rooms'))).toEqual(['office']);
    expect(specimensIn(section(guide, 'elevators'))).toEqual(['car']);
    expect(specimensIn(section(guide, 'tenants-and-stress'))).toEqual(['stress']);
    expect(specimensIn(section(guide, 'people-and-their-stories'))).toEqual(['people']);
    expect(specimensIn(guide)).toEqual(['office', 'car', 'stress', 'people']);
  });

  it('gives every specimen canvas its size and a label that becomes the image alt', () => {
    for (const page of [landing, guide]) {
      const canvases = [...page.matchAll(/<canvas class="specimen"[^>]*><\/canvas>/g)].map((m) => m[0]);
      expect(canvases.length).toBe(4);
      for (const c of canvases) {
        expect(c).toContain('width="288" height="144"');
        expect(c).toMatch(/aria-label="[A-Z][^"]{20,}"/);
      }
    }
  });

  it('keeps an undrawn specimen\'s space but shows nothing in it, so nothing shifts when it is drawn', () => {
    expect(rule('.specimen:not(.is-drawn)')).toBe('visibility: hidden;');
  });
});

describe('D-40: the 404 page has the header band and a way into the game', () => {
  const navOf = (html: string): string => html.slice(html.indexOf('<nav class="site-nav"'), html.indexOf('</nav>') + 6);

  it('carries the same nav as the landing page', () => {
    expect(navOf(notfound)).toContain('<a class="nav-play" href="/play/">Play</a>');
    expect(navOf(notfound)).toBe(navOf(landing));
  });

  it('sets its message in the page head panel, with the lobby link and then the Play button', () => {
    const main = flat(notfound.slice(notfound.indexOf('<main>'), notfound.indexOf('</main>')));
    expect(main).toContain('<div class="page-head"> <div class="wrap"> <div class="hero-panel"> <h1>That floor does not exist.</h1>');
    expect(main).toContain(
      '<p><a href="/">Back to the lobby</a></p> <a class="button" href="/play/">Play in your browser</a> </div> </div> </div>',
    );
  });

  it('loads the theme module so the Theme button works, with no inline script or handler', () => {
    expect(notfound).toContain('<script type="module" src="/src/site/theme-init.ts"></script>');
    const scripts = [...notfound.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    for (const s of scripts) expect(s).toMatch(/\ssrc="\//);
    expect(notfound).not.toMatch(/<script\b[^>]*>[^<\s]/);
    expect(notfound).not.toMatch(/\son[a-z]+=/i);
  });

  it('gives a plain link on the marble panel the world ink, so it reads in the dark scheme', () => {
    const link = rule('.hero-panel a:not(.button)');
    expect(link).toContain('color: var(--w-text);');
  });
});

describe('the service worker leaves the site-only specimens out of its precache', () => {
  const config = readFileSync(join(__dirname, '..', '..', 'vite.config.ts'), 'utf8');
  const block = /globIgnores:\s*\[([^\]]*)\]/.exec(config);
  const ignores = [...(block?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1] as string);

  it('ignores assets/specimens-* and keeps the theme chunk, which the game shares (src/ui/panels.ts)', () => {
    expect(ignores.length).toBeGreaterThan(5);
    expect(ignores).toContain('assets/specimens-*');
    expect(ignores.filter((g) => g.startsWith('assets/theme-') && !g.startsWith('assets/theme-init-'))).toEqual([]);
  });
});
