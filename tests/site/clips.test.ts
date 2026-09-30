// The clips page at /clips/: the trailer and the three short clips, off the landing page, with a
// poster per video and a VideoObject per video in the structured data. Every footer links to it.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import notfound from '../../404.html?raw';
import clips from '../../clips/index.html?raw';
import guide from '../../how-to-play/index.html?raw';
import landing from '../../index.html?raw';
import privacy from '../../privacy/index.html?raw';
import sitemap from '../../public/sitemap.xml?raw';
import terms from '../../terms/index.html?raw';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const SITE = 'https://hundredstories.xyz';
const VIDEOS = ['site-intro', 'elevator-vs-stairs', 'the-backlog', 'the-wait'];
const flat = (html: string): string => html.replace(/\s+/g, ' ');

/** A site URL's file under public/, or null when the URL is not on the site. */
function publicFile(url: string): string | null {
  if (!url.startsWith(`${SITE}/`)) return null;
  return join(ROOT, 'public', url.slice(SITE.length + 1));
}

describe('clips page', () => {
  it('exists with its title, h1 and canonical', () => {
    expect(clips).toContain('<title>Clips</title>');
    expect(clips).toContain('<h1>Clips</h1>');
    expect(clips).toContain(`<link rel="canonical" href="${SITE}/clips/" />`);
    expect(clips).toContain(`<meta property="og:url" content="${SITE}/clips/" />`);
    expect(clips).toContain('<meta name="twitter:title" content="Clips" />');
    expect(clips).toContain('<script src="/theme.js"></script>');
    expect(clips).toContain('href="/src/site/site.css"');
  });

  it('is a Vite input of the site build, not the app build', () => {
    const config = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
    expect(config).toContain("clips: 'clips/index.html',");
    expect(config).toContain("? { play: 'play/index.html' }");
  });

  it('shows the trailer first, with controls and its poster, then the three clips', () => {
    const feature = flat(clips).match(/<video class="trailer-feature"[^>]*>/)![0];
    expect(feature).toContain(' controls ');
    expect(feature).toContain('poster="/trailers/site-intro.webp"');
    expect(clips).toContain('<h2 id="the-trailer">The trailer</h2>');
    expect(clips.indexOf('/trailers/site-intro.mp4')).toBeLessThan(clips.indexOf('/trailers/elevator-vs-stairs.mp4'));
    expect(clips.match(/<article class="card">/g)).toHaveLength(3);
    for (const [name, title] of [
      ['elevator-vs-stairs', 'The elevator is out'],
      ['the-backlog', 'The backlog'],
      ['the-wait', 'The wait'],
    ]) {
      expect(clips).toContain(`poster="/trailers/${name}.webp"`);
      expect(clips).toContain(`<source src="/trailers/${name}.mp4" type="video/mp4" />`);
      expect(clips).toContain(`<h3>${title}</h3>`);
    }
  });

  it('gives every video on the page a poster', () => {
    const videos = [...flat(clips).matchAll(/<video\b[^>]*>/g)].map((m) => m[0]);
    expect(videos).toHaveLength(4);
    for (const v of videos) expect(v).toMatch(/poster="\/trailers\/[a-z-]+\.webp"/);
  });

  it('has the four poster stills under public/trailers', () => {
    for (const name of VIDEOS) expect(existsSync(join(ROOT, 'public', 'trailers', `${name}.webp`))).toBe(true);
  });

  it('keeps the two lead paragraphs and all three "In the game" notes (a guard against reverting the copy)', () => {
    expect(clips).toContain(
      '<p>Thirty seconds, silent on purpose. An empty lot becomes a tower, the tower fills with people, and every floor gets a story of its own. This is the game the way it plays in your browser.</p>',
    );
    expect(clips).toContain(
      '<p>Three things that happen in every tower. They are a lot funnier when they happen to somebody else.</p>',
    );
    expect(clips).toContain(
      'In the game, people take the stairs for a single floor and wait for a car for anything higher, and every minute they wait adds stress. One more car in the shaft is usually the cure.',
    );
    expect(clips).toContain(
      "In the game, the rooms people use make waste every morning. The recycling center's collection workers ride the elevators to pick it up. Let it pile up two mornings in a row and the room counts as dirty, and dirty rooms drag down their rating.",
    );
    expect(clips).toContain(
      'In the game, every minute spent waiting for a car adds stress, and you can see it over each person\'s head. When the lobby crowd wears red marks, add a car, add a shaft, or run an express car to the busiest floors.',
    );
  });

  it('is in the sitemap', () => {
    expect(sitemap).toContain(`<loc>${SITE}/clips/</loc>\n    <lastmod>2026-09-28</lastmod>`);
    expect(sitemap).toContain(`<loc>${SITE}/</loc>\n    <lastmod>2026-09-28</lastmod>`);
  });
});

describe('clips structured data', () => {
  const raw = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(clips)![1]!;
  const data = JSON.parse(raw) as { '@graph': Array<Record<string, unknown>> };
  const videos = data['@graph'].filter((node) => node['@type'] === 'VideoObject');

  it('parses and keeps the Organization and the page about the game', () => {
    const types = data['@graph'].map((node) => node['@type']);
    expect(types).toContain('Organization');
    expect(types).toContain('WebPage');
  });

  it('holds one VideoObject per video, with absolute URLs that resolve to files under public/', () => {
    expect(videos.length).toBeGreaterThanOrEqual(3);
    expect(videos.length).toBeLessThanOrEqual(4);
    for (const v of videos) {
      expect(typeof v.name).toBe('string');
      expect(typeof v.description).toBe('string');
      expect(v.uploadDate).toBe('2026-09-27');
      expect(v.duration).toMatch(/^PT\d+S$/);
      for (const key of ['contentUrl', 'thumbnailUrl']) {
        const file = publicFile(String(v[key]));
        expect(file, `${key} ${String(v[key])}`).not.toBeNull();
        expect(existsSync(file!), `${key} ${String(v[key])}`).toBe(true);
      }
    }
  });
});

describe('every footer links to the clips page', () => {
  const pages: Array<[string, string]> = [
    ['landing', landing],
    ['guide', guide],
    ['privacy', privacy],
    ['terms', terms],
    ['404', notfound],
    ['clips', clips],
  ];

  it.each(pages)('puts Clips after How to play in the %s footer', (_name, html) => {
    const footer = flat(html.slice(html.indexOf('<footer class="site-foot">')));
    expect(footer).toContain('<a href="/how-to-play/">How to play</a> <a href="/clips/">Clips</a>');
  });
});

describe('landing splash', () => {
  const css = readFileSync(join(ROOT, 'src', 'site', 'site.css'), 'utf8');
  const tag =
    '<div id="splash" class="splash" hidden><video id="splash-video" muted playsinline preload="auto" width="1280" height="720" aria-hidden="true" tabindex="-1"></video><button type="button" id="splash-skip" class="splash-skip">Skip</button></div>';

  it('is the first child of body, hidden, with no sources, no poster and no autoplay in the markup: splash.ts sets the poster on the play path, so a declined visitor downloads nothing', () => {
    expect(landing).toContain(`<body>\n    ${tag}\n    <header class="site-head">`);
    expect(landing).not.toContain('poster=');
    expect(landing).not.toMatch(/<video[^>]*autoplay/);
    expect(landing).not.toMatch(/<source[^>]*site-splash/);
    expect(landing).not.toContain('hero-trailer');
    expect(landing).not.toContain('site-intro-hero');
  });

  it('gates it before first paint with splash-init.js, right after theme.js, on the landing page only', () => {
    const head = landing.slice(0, landing.indexOf('</head>'));
    expect(head).toContain('<script src="/theme.js"></script>\n    <script src="/splash-init.js"></script>');
    for (const page of [guide, privacy, terms, notfound, clips]) expect(page).not.toContain('splash');
    expect(existsSync(join(ROOT, 'public', 'splash-init.js'))).toBe(true);
  });

  it('ships the splash mp4 only, drops the hero cut, and is loaded through hero.ts', () => {
    expect(existsSync(join(ROOT, 'public', 'trailers', 'site-splash.mp4'))).toBe(true);
    expect(existsSync(join(ROOT, 'public', 'trailers', 'site-intro-hero.mp4'))).toBe(false);
    expect(existsSync(join(ROOT, 'src', 'site', 'hero-trailer.ts'))).toBe(false);
    const hero = readFileSync(join(ROOT, 'src', 'site', 'hero.ts'), 'utf8');
    expect(hero).toContain("import './splash';");
    expect(hero).not.toContain('hero-trailer');
  });

  // Source frames 300 to 839 of the 30 fps intro: Build, then Every Floor through the wordmark and
  // its caption, stopping before "Play Free" and the blackout. 18 s, moov first, small.
  it('ships an 18 s faststart cut under 1.3 MB', () => {
    const mp4 = readFileSync(join(ROOT, 'public', 'trailers', 'site-splash.mp4'));
    expect(mp4.length).toBeLessThan(1_300_000);
    const at = mp4.indexOf('mvhd');
    expect(at).toBeGreaterThan(0);
    expect(mp4.indexOf('moov')).toBeLessThan(mp4.indexOf('mdat'));
    const v1 = mp4[at + 4] === 1;
    const timescale = mp4.readUInt32BE(at + (v1 ? 24 : 16));
    const duration = v1 ? Number(mp4.readBigUInt64BE(at + 28)) : mp4.readUInt32BE(at + 20);
    const seconds = duration / timescale;
    expect(seconds).toBeGreaterThan(17.9);
    expect(seconds).toBeLessThan(18.1);
  });

  // The same 18 s reframed upright (trailer/ SiteSplashPortrait) for a portrait viewport: moov
  // first, near the landscape cut's size, and 720x1280 in its track header, not a stretched 16:9.
  it('ships an 18 s faststart 720x1280 portrait cut under 1.3 MB, with a small portrait poster', () => {
    const mp4 = readFileSync(join(ROOT, 'public', 'trailers', 'site-splash-portrait.mp4'));
    expect(mp4.length).toBeLessThan(1_300_000);
    const at = mp4.indexOf('mvhd');
    expect(at).toBeGreaterThan(0);
    expect(mp4.indexOf('moov')).toBeLessThan(mp4.indexOf('mdat'));
    const v1 = mp4[at + 4] === 1;
    const timescale = mp4.readUInt32BE(at + (v1 ? 24 : 16));
    const duration = v1 ? Number(mp4.readBigUInt64BE(at + 28)) : mp4.readUInt32BE(at + 20);
    const seconds = duration / timescale;
    expect(seconds).toBeGreaterThan(17.9);
    expect(seconds).toBeLessThan(18.1);
    // tkhd ends with the width and height, 16.16 fixed point, in its last 8 bytes.
    const tkhd = mp4.indexOf('tkhd');
    const size = mp4.readUInt32BE(tkhd - 4);
    const end = tkhd - 4 + size;
    expect([mp4.readUInt32BE(end - 8) / 65536, mp4.readUInt32BE(end - 4) / 65536]).toEqual([720, 1280]);
    const poster = readFileSync(join(ROOT, 'public', 'trailers', 'site-splash-portrait.webp'));
    expect(poster.subarray(8, 12).toString('latin1')).toBe('WEBP');
    expect(poster.length).toBeLessThan(40_000);
  });

  it('shows only under splash-pending, fixed over everything, fading on is-done', () => {
    expect(css).toMatch(/html\.splash-pending \{\s*overflow: hidden;/);
    expect(css).toMatch(/html\.splash-pending \.splash\[hidden\] \{\s*display: block;/);
    expect(css).toMatch(/\.splash \{[^}]*position: fixed;[^}]*inset: 0;[^}]*z-index: 1000;[^}]*transition: opacity 400ms/);
    expect(css).toMatch(/\.splash\.is-done \{\s*opacity: 0;/);
    // With no module, the same 30 s mark hides the overlay and gives the page its scroll back.
    expect(css).toMatch(/html\.splash-pending \{[^}]*animation: splash-failsafe-scroll 0s linear 30s forwards;/);
    expect(css).toMatch(/@keyframes splash-failsafe-scroll \{\s*to \{\s*overflow: visible;/);
    expect(css).toMatch(/html\.splash-pending \.splash\[hidden\] \{[^}]*animation: splash-failsafe 0s linear 30s forwards;/);
    expect(css).not.toContain('.hero-trailer');
  });

  // The wordmark must never be cropped off a phone: contain below 720 px, cover from it.
  it('letterboxes below 720 px and fills from 720 px, centred', () => {
    expect(css).toMatch(/\.splash video \{[^}]*object-fit: contain;[^}]*object-position: center center;/);
    expect(css).toMatch(/@media \(min-width: 720px\) \{\s*\.splash video \{\s*object-fit: cover;/);
    expect(css).toMatch(/\.splash-skip \{[^}]*min-height: 44px;/);
  });

  // The portrait cut matches a phone held upright: it fills there, and is letterboxed if turned.
  it('fills the viewport with the portrait cut when portrait, letterboxes it otherwise', () => {
    expect(css).toMatch(/\.splash video\[data-cut='portrait'\] \{\s*object-fit: contain;/);
    expect(css).toMatch(/@media \(orientation: portrait\) \{\s*\.splash video\[data-cut='portrait'\] \{\s*object-fit: cover;/);
    expect(css.indexOf("@media (orientation: portrait)")).toBeGreaterThan(css.indexOf('@media (min-width: 720px) {\n  .splash video'));
  });

  it('keeps the trailer videos and posters out of the service worker precache', () => {
    const config = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
    const block = /globIgnores:\s*\[([^\]]*)\]/.exec(config)![1]!;
    expect(block).toContain("'trailers/**'");
    expect(block).toContain("'clips/**'");
    const patterns = /globPatterns:\s*\[([^\]]*)\]/.exec(config)![1]!;
    expect(patterns).not.toMatch(/mp4|webm|webp/);
  });

  it('lets the CSP load the video and poster from the site itself', () => {
    const headers = readFileSync(join(ROOT, 'public', '_headers'), 'utf8');
    const csp = /Content-Security-Policy: ([^\n]*)/.exec(headers)![1]!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toContain('media-src');
    expect(csp).toContain("img-src 'self'");
  });
});

describe('video byte ranges', () => {
  // Safari and iOS play mp4 only with 206 range answers. The assets layer ignores Range, so
  // /trailers/* must reach the Worker first (src/worker/range.ts; tests/worker/range.test.ts).
  // Production answered bytes=0-99 with the whole 2.5 MB file and 200 before this.
  it('routes /trailers/* to the Worker first in wrangler.jsonc', () => {
    const config = readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8');
    expect(config).toMatch(/"run_worker_first":\s*\[\s*"\/trailers\/\*",\s*"\/api\/\*"\s*\]/);
  });

  // With the list form and not_found_handling "404-page", a path not listed never reaches the
  // Worker: POST /api/feedback got an empty 405 from the assets layer live (0.6.8 to 0.6.11).
  it('routes /api/* to the Worker first so the feedback card reaches it', () => {
    const config = readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8');
    const list = /"run_worker_first":\s*(\[[^\]]*\])/.exec(config)![1]!;
    expect(JSON.parse(list)).toContain('/api/*');
  });
});
