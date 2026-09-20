// The landing site is plain HTML with no framework, so its contract is the
// markup itself: the front door at /, the guide at /how-to-play/, the game
// shell at /play/, and the crawler files beside them.

// Raw imports rather than node:fs: this repo has no @types/node and adds no
// dependencies, and Vite hands the files over verbatim either way.
import notfound from '../../404.html?raw';
import guide from '../../how-to-play/index.html?raw';
import landing from '../../index.html?raw';
import play from '../../play/index.html?raw';
import robots from '../../public/robots.txt?raw';
import sitemap from '../../public/sitemap.xml?raw';
import { describe, expect, it } from 'vitest';

/** Copy is wrapped in the markup, so read it the way a browser lays it out: one line. */
const flat = (html: string): string => html.replace(/\s+/g, ' ');

describe('landing page', () => {
  it('is the front door, not the game shell', () => {
    expect(landing).toContain('<h1>Build a tower. Run it well.</h1>');
    expect(landing).toContain('href="/play/"');
    expect(landing).toContain('href="/how-to-play/"');
    expect(landing).not.toContain('/src/main.ts');
  });

  it('carries the link preview and canonical tags once each', () => {
    expect(landing.match(/property="og:image"/g)).toHaveLength(1);
    expect(landing).toContain('content="https://hundredstories.xyz/og.png"');
    expect(landing).toContain('<link rel="canonical" href="https://hundredstories.xyz/" />');
    expect(landing).toContain('name="twitter:card" content="summary_large_image"');
    expect(landing).toContain('application/ld+json');
  });

  it('loads the site stylesheet, the hero module and the theme init module, and nothing else', () => {
    expect(landing).toContain('href="/src/site/site.css"');
    expect(landing.match(/<script type="module"[^>]*>/g)).toHaveLength(2);
    expect(landing).toContain('src="/src/site/hero.ts"');
    expect(landing).toContain('src="/src/site/theme-init.ts"');
  });

  it('keeps the still hero image as the fallback', () => {
    expect(landing).toContain('id="hero-shot"');
    expect(landing).toContain('id="hero-view"');
  });

  it('carries a hidden challenge line for a friend arriving from a shared link', () => {
    expect(landing).toContain('<p id="challenge" class="challenge" hidden></p>');
  });

  it('invites a phone and a tablet, not a desktop only', () => {
    expect(landing).toContain('<h2 id="platforms">Phone, tablet or desktop</h2>');
    expect(landing).toContain('aria-labelledby="platforms"');
    expect(flat(landing)).toContain(
      'Play in a desktop browser with a mouse, or on a phone or tablet with touch: one finger moves, pinch zooms, tap to place. Install it from the browser menu and it opens like an app.',
    );
    expect(landing).not.toContain('Best on a desktop');
    expect(landing).not.toContain('desktop-note');
  });
});

describe('the page is the building in cross section', () => {
  it('opens on the name, before what it is', () => {
    expect(landing).toContain('<h2 id="the-name">Why Hundred Stories</h2>');
    expect(flat(landing)).toContain(
      "A hundred stories is the height of a tower worth building. It is also what goes on inside one: the tenant on 40 who wants a quieter floor, the shop on 2 that lives on the lunch crowd, the hotel guest who missed the last express lift and is not coming back. Every floor is a story. Everyone's got one.",
    );
  });

  it('sends the landing page underground below the hero, one floor per section', () => {
    expect(landing).toContain('<div class="underground">');
    expect(landing.match(/<section class="floor"/g)).toHaveLength(4);
    for (const tag of [
      'B1 &middot; THE NAME',
      'B2 &middot; WHAT IT IS',
      'B3 &middot; HOW IT PLAYS',
      'B4 &middot; PHONE, TABLET OR DESKTOP',
    ]) {
      expect(landing).toContain(`<p class="floor-tag">${tag}</p>`);
    }
    // The floors carry the sections; no bare .wrap column of copy is left behind.
    expect(flat(landing)).not.toContain('<div class="wrap"> <section aria-labelledby="features">');
  });

  it('numbers the elevator steps in the markup, not with list bullets', () => {
    expect(landing.match(/<span class="step-num">/g)).toHaveLength(3);
    expect(landing).toContain('<span class="step-num">01</span>');
    expect(landing).toContain('<span class="step-num">03</span>');
  });

  it('lights the Play link in the nav on both pages', () => {
    expect(landing).toContain('<a class="nav-play" href="/play/">Play</a>');
    expect(guide).toContain('<a class="nav-play" href="/play/">Play</a>');
  });

  it('gives the guide the same shell, numbered B1 upward', () => {
    expect(guide).toContain('<div class="underground">');
    expect(guide.match(/<section class="floor guide"/g)).toHaveLength(7);
    expect(guide).toContain('<p class="floor-tag">B1 &middot; ROOMS</p>');
    expect(guide).toContain('<p class="floor-tag">B7 &middot; CONTROLS</p>');
    // Heading order survives the rebuild: one h1, then the topic h2s.
    expect(guide.match(/<h1>/g)).toHaveLength(1);
  });
});

describe('guide page', () => {
  it('covers every topic', () => {
    for (const topic of [
      'Rooms',
      'Elevators',
      'Tenants and stress',
      'Money and the quarter',
      'Stars',
      'Saving and exporting',
      'Controls',
    ]) {
      expect(guide).toContain(`>${topic}</h2>`);
    }
  });

  it('tells a player with a touch screen what their fingers do', () => {
    expect(flat(guide)).toContain(
      'Touch: one finger moves the view, pinch zooms, tap places, two fingers drag to pan while sizing a lobby or an elevator.',
    );
  });

  it('points at itself and at the game', () => {
    expect(guide).toContain('<link rel="canonical" href="https://hundredstories.xyz/how-to-play/" />');
    expect(guide).toContain('href="/play/"');
  });
});

describe('game shell', () => {
  it('still boots the game from /play/', () => {
    expect(play).toContain('<div id="app"></div>');
    expect(play).toContain('src="/src/main.ts"');
    expect(play).toContain('<title>Play Hundred Stories</title>');
    expect(play).toContain('Hundred Stories needs JavaScript and WebGL.');
    expect(play).toContain('<link rel="canonical" href="https://hundredstories.xyz/play/" />');
  });

  it('lets the view reach under the notch and the home indicator', () => {
    expect(play).toContain('viewport-fit=cover');
    // The canvas takes the touch gestures itself, so the page never has to forbid zooming.
    expect(play).not.toContain('user-scalable=no');
  });
});

describe('crawler files', () => {
  it('robots points at the sitemap', () => {
    expect(robots).toBe(
      'User-agent: *\nAllow: /\nSitemap: https://hundredstories.xyz/sitemap.xml\n',
    );
  });

  it('the sitemap lists all three pages', () => {
    expect(sitemap.match(/<url>/g)).toHaveLength(3);
    for (const path of ['/', '/how-to-play/', '/play/']) {
      expect(sitemap).toContain(`<loc>https://hundredstories.xyz${path}</loc>`);
    }
  });
});

describe('theme', () => {
  it('applies a stored choice before first paint on every page', () => {
    for (const page of [landing, guide, notfound, play]) {
      const head = page.slice(0, page.indexOf('</head>'));
      expect(head).toContain('<script src="/theme.js"></script>');
    }
  });

  it('gives the landing page and the guide a toggle in the nav', () => {
    for (const page of [landing, guide]) {
      expect(page).toContain('<button type="button" class="theme-toggle" id="theme-toggle">Theme</button>');
      expect(page).toContain('src="/src/site/theme-init.ts"');
    }
  });

  it('leaves the 404 page without a toggle, since it has no nav', () => {
    expect(notfound).not.toContain('theme-toggle');
    expect(notfound).not.toContain('theme-init');
  });
});

describe('footer', () => {
  const pages: Array<[string, string]> = [
    ['landing', landing],
    ['guide', guide],
    ['404', notfound],
  ];

  it.each(pages)('gives the %s page the site footer with the contact address', (_name, html) => {
    expect(html.match(/<footer class="site-foot">/g)).toHaveLength(1);
    expect(html).toContain('href="mailto:hello@parallaxintelligence.ai"');
    expect(html).toContain('>hello@parallaxintelligence.ai<');
    expect(html).toContain('href="https://www.gnu.org/licenses/agpl-3.0.html"');
    expect(flat(html)).toContain('Hundred Stories is a from-scratch homage to SimTower');
    expect(html).toContain('src="/wordmark-line-dark.svg"');
  });

  it('keeps the footer off the game shell', () => {
    expect(play).not.toContain('site-foot');
  });
});

describe('nav', () => {
  const pages: Array<[string, string]> = [
    ['landing', landing],
    ['guide', guide],
  ];

  it.each(pages)('gives the %s page a Requests link instead of Source in the nav', (_name, html) => {
    const nav = html.slice(html.indexOf('<nav class="site-nav"'), html.indexOf('</nav>'));
    expect(nav).toContain(
      '<a href="https://github.com/parallaxintelligencepartnership/hundred-stories/issues/new">Requests</a>',
    );
    expect(nav).not.toMatch(/<a[^>]*>Source<\/a>/);
  });
});
