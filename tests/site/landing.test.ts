// The landing site is plain HTML with no framework, so its contract is the
// markup itself: the front door at /, the guide at /how-to-play/, the game
// shell at /play/, and the crawler files beside them.

// Raw imports rather than node:fs: this repo has no @types/node and adds no
// dependencies, and Vite hands the files over verbatim either way.
import notfound from '../../404.html?raw';
import clips from '../../clips/index.html?raw';
import guide from '../../how-to-play/index.html?raw';
import landing from '../../index.html?raw';
import play from '../../play/index.html?raw';
import privacy from '../../privacy/index.html?raw';
import robots from '../../public/robots.txt?raw';
import sitemap from '../../public/sitemap.xml?raw';
import terms from '../../terms/index.html?raw';
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

  it('loads the site stylesheet, the hero module, the theme init module and the specimens module, and nothing else', () => {
    expect(landing).toContain('href="/src/site/site.css"');
    expect(landing.match(/<script type="module"[^>]*>/g)).toHaveLength(3);
    expect(landing).toContain('src="/src/site/hero.ts"');
    expect(landing).toContain('src="/src/site/theme-init.ts"');
    expect(landing).toContain('src="/src/site/specimens.ts"');
  });

  it('describes the illustrated cross section the game draws, not the old pixel art', () => {
    expect(flat(landing)).toContain(
      'Hundred Stories is a tower-building game. You see the whole tower cut open like a dollhouse, so you can watch every tenant, shop and elevator car.',
    );
    expect(landing).not.toContain('pixel art');
    expect(guide).not.toContain('pixel art');
  });

  it('points players to the in-game feedback menu from the fineprint and the footer', () => {
    expect(flat(landing)).toContain(
      'Free in your browser. No sign-up. Found a bug? Send feedback from the game menu.',
    );
    expect(flat(landing)).toContain('Or use Send feedback in the game menu. No account needed.');
  });

  it('serves the still hero image as a preloaded, high priority WebP, with its size reserved', () => {
    const shot = flat(landing).match(/<img id="hero-shot"[^>]*>/)![0];
    expect(shot).toContain('src="/hero-still.webp"');
    expect(shot).toContain('fetchpriority="high"');
    expect(shot).toContain('decoding="async"');
    expect(shot).toContain('width="1600"');
    expect(shot).toContain('height="479"');
    const head = landing.slice(0, landing.indexOf('</head>'));
    expect(head).toContain('<link rel="preload" as="image" href="/hero-still.webp" fetchpriority="high" />');
  });

  it('keeps the still hero image as the fallback', () => {
    expect(landing).toContain('id="hero-shot"');
    expect(landing).toContain('id="hero-view"');
  });

  it('describes the still hero image as it is: a frame of the demo tower as the game draws it', () => {
    const shot = flat(landing).match(/<img id="hero-shot"[^>]*>/)![0];
    expect(shot).toContain('alt="The demo tower in daylight, cut open to show its rooms, people and elevator, as the game draws it"');
    expect(shot).not.toContain('Hundred Stories name');
    expect(landing).not.toContain('A tower of cream office cells against a dark sky');
  });

  it('carries a hidden challenge line for a friend arriving from a shared link', () => {
    expect(landing).toContain('<p id="challenge" class="challenge" hidden></p>');
  });

  it('carries a hidden Start the same tower button beside the challenge line', () => {
    expect(landing).toContain('<a id="challenge-play" class="button" href="/play/" hidden>Start the same tower</a>');
  });

  it('invites a phone and a tablet, not a desktop only', () => {
    expect(landing).toContain('<h2 id="platforms">Phone, tablet or desktop</h2>');
    expect(landing).toContain('aria-labelledby="platforms"');
    expect(flat(landing)).toContain(
      'Play in a desktop browser with a mouse, or on a phone or tablet with touch: one finger moves, pinch zooms, tap to place, then tap Build. Install it from the browser menu and it opens like an app.',
    );
    expect(landing).not.toContain('Best on a desktop');
    expect(landing).not.toContain('desktop-note');
  });
});

describe('the page is the building in cross section', () => {
  it('opens on the name, before what it is', () => {
    expect(landing).toContain('<h2 id="the-name">Why Hundred Stories</h2>');
    expect(flat(landing)).toContain(
      "A hundred stories is the height of a tower worth building. It is also what goes on inside one: the tenant on 40 who wants a quieter floor, the shop on 2 that counts on the lunch crowd, the hotel guest who missed the last express elevator and is not coming back. Every floor is a story. Everyone's got one.",
    );
  });

  it('sends the landing page underground below the hero, one floor per section', () => {
    expect(landing).toContain('<div class="underground">');
    expect(landing.match(/<section class="floor"/g)).toHaveLength(5);
    // The tag is the floor alone; the h2 names the section (D-38).
    const tags = [...landing.matchAll(/<p class="floor-tag">([^<]*)<\/p>/g)].map((m) => m[1]);
    expect(tags).toEqual(['B1', 'B2', 'B3', 'B4', 'B5']);
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
    expect(guide.match(/<section class="floor guide"/g)).toHaveLength(15);
    // Numbered in order, one floor each, with no gaps, and the tag is the floor alone (D-38).
    const tags = [...guide.matchAll(/<p class="floor-tag">([^<]*)<\/p>/g)].map((m) => m[1]);
    expect(tags).toEqual(Array.from({ length: 15 }, (_, i) => `B${i + 1}`));
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
      'Saving',
      'Controls',
      'People and their stories',
      'Weather',
      'The VIP visit',
      'Guards and the shop thief',
      'Waste and collection',
      'Milestones and the chronicle',
      'Sound',
    ]) {
      expect(guide).toContain(`>${topic}</h2>`);
    }
  });

  it('describes stress by the mark over a head, not by body colour', () => {
    expect(flat(guide)).toContain(
      'You can see it over their head. A calm person has no mark. A stressed person shows a small pink dot, and someone who has almost run out of patience shows a red exclamation mark.',
    );
    expect(guide).not.toContain('You can see it in their color');
    expect(guide).not.toMatch(/turn pink, then red/);
  });

  it('covers what shipped with the stories: following, the VIP checklist, the thief, waste, the chronicle and the music slider', () => {
    const text = flat(guide);
    expect(text).toContain('Choose Follow on the card to keep up with someone. You can follow eight people at a time.');
    expect(text).toContain('The Stories panel, opened from the menu, lists the people you follow');
    expect(text).toContain('The weather can change every six hours: clear, cloudy, rain or storm.');
    expect(text).toContain('Weather stays outside. It never changes how the tower runs');
    expect(text).toContain('a suite ready for them, the suite clean, an elevator that stops at the suite floor, and no fire or bomb in the tower.');
    expect(text).toContain('A security office has six guards: half work the day shift and half work the night.');
    expect(text).toContain('If the thief gets away, the tower loses $2,000 and the shop is left a mess.');
    expect(text).toContain('The center has collection workers, two at first and more as the tower grows.');
    expect(text).toContain('At Tower status the game writes the tower chronicle');
    expect(text).toContain('Save as image keeps a copy on your device. Nothing is uploaded.');
    expect(text).toContain('Three sliders in Settings set the music, the sound effects and the background sound.');
  });

  it('keeps the house style: no em dashes and no spaced hyphens as dashes', () => {
    for (const page of [landing, guide]) {
      const text = flat(page.slice(page.indexOf('<main>'), page.indexOf('</main>')));
      expect(text).not.toContain('\u2014');
      expect(text).not.toMatch(/ - /);
    }
  });

  it('tells a player with a touch screen what their fingers do', () => {
    expect(flat(guide)).toContain(
      'Touch: one finger moves the view, pinch to zoom, tap to place, then tap Build. While you size a lobby or an elevator, drag with two fingers to move the view.',
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

  it('the sitemap lists all six pages', () => {
    expect(sitemap.match(/<url>/g)).toHaveLength(6);
    for (const path of ['/', '/how-to-play/', '/play/', '/privacy/', '/terms/', '/clips/']) {
      expect(sitemap).toContain(`<loc>https://hundredstories.xyz${path}</loc>`);
    }
  });
});

describe('privacy page', () => {
  it('exists and carries the title', () => {
    expect(privacy).toContain('<title>Privacy</title>');
    expect(privacy).toContain('<h1>Privacy</h1>');
  });

  it('points at itself', () => {
    expect(privacy).toContain('<link rel="canonical" href="https://hundredstories.xyz/privacy/" />');
  });

  it('states that the game makes one network request, feedback, and the last-updated date', () => {
    const text = flat(privacy);
    expect(text).toContain('The game makes one network request of its own, and only when you ask it to:');
    const start = privacy.indexOf('<h2 id="fonts">Network requests</h2>');
    const list = privacy.slice(privacy.indexOf('<ul>', start), privacy.indexOf('</ul>', start));
    const items = [...list.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => flat(m[1] as string).trim());
    expect(items).toEqual([
      '/api/feedback: sent only when you press Send on the feedback card. It carries the text you typed, the email you typed if any, the game version, the platform and the screen size.',
    ]);
    expect(privacy).not.toMatch(/googleapis|gstatic|google\.com|googletagmanager|google-analytics/i);
    expect(privacy).toContain('Last updated 2026-09-27.');
  });

  it('says what feedback sends, where it is kept, and that nothing else goes with it', () => {
    const heads = [...privacy.matchAll(/<h2 id="[^"]+">([^<]*)<\/h2>/g)].map((m) => m[1]);
    expect(heads.indexOf('Feedback you send')).toBe(heads.indexOf('Network requests') - 1);
    const start = privacy.indexOf('<h2 id="feedback">');
    const text = flat(privacy.slice(start, privacy.indexOf('</section>', start)));
    expect(text).toContain('only ever sends something when you press Send on the feedback card');
    expect(text).toContain('the text you typed, the email you typed if any, the game version, the platform');
    expect(text).toContain('the platform, meaning the browser or app and the operating system (for example "web-safari" or "ios"), and your screen size');
    expect(text).toContain('stored at Cloudflare until it is emailed to requests@hundredstories.xyz, then it is deleted');
    expect(text).toContain('No account, no IP address and no tracking is attached to it.');
    expect(text).toContain('it is used only to reply to you');
  });

  it('mentions Cloudflare Web Analytics', () => {
    expect(flat(privacy)).toContain('Cloudflare Web Analytics');
  });

  it('covers purchases and links right after network requests', () => {
    const tags = [...privacy.matchAll(/<p class="floor-tag">([^<]*)<\/p>/g)].map((m) => m[1]);
    expect(tags).toEqual(Array.from({ length: tags.length }, (_, i) => `B${i + 1}`));
    const heads = [...privacy.matchAll(/<h2 id="[^"]+">([^<]*)<\/h2>/g)].map((m) => m[1]);
    expect(heads.indexOf('Purchases and links')).toBe(heads.indexOf('Network requests') + 1);
    const text = flat(privacy);
    expect(text).toContain('Buy me a coffee link');
    expect(text).toContain('which has its own privacy policy');
    expect(text).toContain('handled by that store (Apple or Google)');
    expect(text).not.toMatch(/sponsor/i);
    expect(text).toContain('No payment details reach us.');
  });
});

describe('terms page', () => {
  it('exists and carries the title', () => {
    expect(terms).toContain('<title>Terms</title>');
    expect(terms).toContain('<h1>Terms</h1>');
  });

  it('points at itself', () => {
    expect(terms).toContain('<link rel="canonical" href="https://hundredstories.xyz/terms/" />');
    expect(terms).toContain('<meta property="og:url" content="https://hundredstories.xyz/terms/" />');
  });

  it('has the sections, numbered B1 upward, and the last-updated date', () => {
    const tags = [...terms.matchAll(/<p class="floor-tag">([^<]*)<\/p>/g)].map((m) => m[1]);
    expect(tags).toEqual(Array.from({ length: 9 }, (_, i) => `B${i + 1}`));
    const main = terms.slice(terms.indexOf('<main>'), terms.indexOf('</main>'));
    const heads = [...main.matchAll(/<h2 id="[^"]+">([^<]*)<\/h2>/g)].map((m) => m[1]);
    expect(heads).toEqual([
      'Who runs this',
      'Using the game',
      'Your tower',
      'Purchases',
      'Links to other sites',
      'No warranty',
      'Who can play',
      'Michigan law',
      'Changes',
    ]);
    expect(terms).toContain('Last updated 2026-09-26.');
  });

  it('names who runs it, the license, and who handles purchases', () => {
    const text = flat(terms);
    expect(text).toContain('Parallax Intelligence Partnership');
    expect(terms).toContain('href="mailto:requests@hundredstories.xyz?subject=Hundred%20Stories%20request"');
    expect(terms).toContain('href="mailto:requests@hundredstories.xyz"');
    expect(terms.split('href="https://polyformproject.org/licenses/strict/1.0.0"').length).toBeGreaterThan(2);
    expect(text).toContain('through Apple or Google');
    expect(text).toContain('We never see your payment details.');
  });

  it('carries the age rule (13 and up) and Michigan law', () => {
    const text = flat(terms.slice(terms.indexOf('<main>'), terms.indexOf('</main>')));
    expect(text).toContain('at least 13 years old');
    expect(text).toContain('laws of the State of Michigan');
    expect(text).toContain('Calhoun County, Michigan');
  });

  it('keeps the house style: no em dashes and no spaced hyphens as dashes', () => {
    for (const page of [terms, privacy]) {
      const text = flat(page.slice(page.indexOf('<main>'), page.indexOf('</main>')));
      expect(text).not.toContain('\u2014');
      expect(text).not.toMatch(/ - /);
    }
  });
});

describe('sponsor slot', () => {
  const features = (): string => {
    const start = landing.indexOf('aria-labelledby="features"');
    return landing.slice(start, landing.indexOf('</section>', start));
  };

  it('has no sponsor aside in the B2 section', () => {
    const html = features();
    expect(html).not.toContain('class="sponsor"');
    expect(html).not.toContain('<aside');
  });

  it('carries no sponsor wording or swap-in comment', () => {
    expect(landing).not.toMatch(/sponsor-label|rel="sponsored|Sponsor slot/);
    expect(features()).not.toContain('<!--');
  });

  it('adds no script, no outside image and no iframe to the page', () => {
    expect(landing.match(/<script\b/g)).toHaveLength(5);
    expect(landing).not.toContain('<iframe');
    expect(landing).not.toMatch(/<img[^>]*src="https?:/);
  });

  it('keeps the floors as they were, less the B6 trailer section the hero now carries', () => {
    const tags = [...landing.matchAll(/<p class="floor-tag">([^<]*)<\/p>/g)].map((m) => m[1]);
    expect(tags).toEqual(['B1', 'B2', 'B3', 'B4', 'B5']);
  });

  it('has no See it in action section: the clips live on /clips/', () => {
    expect(landing).not.toContain('id="trailers"');
    expect(landing).not.toContain('See it in action');
    expect(landing).not.toContain('class="trailer-feature"');
    expect(landing).not.toContain('class="trailer-clip"');
  });

  it('sends the hero secondary button to the clips page', () => {
    expect(landing).toContain('<a class="button button-secondary" href="/clips/">Watch the clips</a>');
    expect(landing).not.toContain('Watch the trailer');
    expect(landing).not.toContain('href="#trailers"');
  });

  it('says in the web panel that the game tracks nothing', () => {
    const web = landing.slice(landing.indexOf('id="platform-panel-web"'), landing.indexOf('id="platform-panel-ios"'));
    expect(flat(web)).toContain(
      '<dd> None: the game tracks nothing, and nothing leaves your device unless you send us feedback. </dd>',
    );
  });
});

describe('theme', () => {
  it('applies a stored choice before first paint on every page', () => {
    for (const page of [landing, guide, notfound, play]) {
      const head = page.slice(0, page.indexOf('</head>'));
      expect(head).toContain('<script src="/theme.js"></script>');
    }
  });

  it('gives the landing page, the guide and the 404 a toggle in the nav (D-40)', () => {
    for (const page of [landing, guide, notfound]) {
      expect(page).toContain('<button type="button" class="theme-toggle" id="theme-toggle">Theme</button>');
      expect(page).toContain('src="/src/site/theme-init.ts"');
    }
  });
});

describe('favicon', () => {
  const pages: Array<[string, string]> = [
    ['landing', landing],
    ['guide', guide],
    ['clips', clips],
    ['privacy', privacy],
    ['terms', terms],
    ['404', notfound],
    ['game shell', play],
  ];
  const FAVICON = '<link rel="icon" type="image/png" sizes="48x48" href="/icons/icon-48.png" />';
  const ICON_192 = '<link rel="icon" href="/icons/icon-192.png" />';

  it.each(pages)('links the drawn 48 px favicon on the %s page, ahead of the 192 px icon it keeps', (_name, html) => {
    expect(html.split(FAVICON)).toHaveLength(2);
    expect(html).toContain(ICON_192);
    expect(html.indexOf(FAVICON)).toBeLessThan(html.indexOf(ICON_192));
  });
});

describe('footer', () => {
  const pages: Array<[string, string]> = [
    ['landing', landing],
    ['guide', guide],
    ['clips', clips],
    ['404', notfound],
    ['privacy', privacy],
    ['terms', terms],
  ];

  it.each(pages)('gives the %s page the site footer with the contact address', (_name, html) => {
    expect(html.match(/<footer class="site-foot">/g)).toHaveLength(1);
    expect(html).toContain('href="mailto:requests@hundredstories.xyz"');
    expect(html).toContain('>requests@hundredstories.xyz<');
    expect(html).toContain('href="https://polyformproject.org/licenses/strict/1.0.0"');
    expect(flat(html)).toContain('Hundred Stories is a from-scratch homage to SimTower');
    expect(html).toContain('src="/wordmark-line-dark.svg"');
  });

  it('keeps the footer off the game shell', () => {
    expect(play).not.toContain('site-foot');
  });

  it.each(pages)('links to /privacy/ from the %s footer', (_name, html) => {
    const footer = html.slice(html.indexOf('<footer class="site-foot">'));
    expect(footer).toContain('href="/privacy/"');
  });

  it.each(pages)('links to /terms/ right after Privacy in the %s footer', (_name, html) => {
    const footer = flat(html.slice(html.indexOf('<footer class="site-foot">')));
    expect(footer).toContain('<a href="/privacy/">Privacy</a> <a href="/terms/">Terms</a>');
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
      '<a href="mailto:requests@hundredstories.xyz?subject=Hundred%20Stories%20request">Requests</a>',
    );
    expect(nav).not.toMatch(/<a[^>]*>Source<\/a>/);
  });

  it.each(pages)('gives the %s page the tagline', (_name, html) => {
    expect(html).toContain("Everyone's got one.");
  });
});
