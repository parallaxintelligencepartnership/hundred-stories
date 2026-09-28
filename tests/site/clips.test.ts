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

describe('landing hero trailer', () => {
  const css = readFileSync(join(ROOT, 'src', 'site', 'site.css'), 'utf8');

  it('sits between the still and the copy with no sources and no autoplay in the markup', () => {
    const tag =
      '<video id="hero-trailer" class="hero-trailer" muted playsinline preload="metadata" poster="/trailers/site-intro.webp" width="1280" height="720" aria-hidden="true"></video>';
    expect(landing).toContain(tag);
    expect(landing.indexOf('id="hero-shot"')).toBeLessThan(landing.indexOf(tag));
    expect(landing.indexOf(tag)).toBeLessThan(landing.indexOf('<div class="hero-panel">'));
    expect(landing).not.toMatch(/<video[^>]*autoplay/);
    expect(landing).not.toContain('site-intro-hero');
  });

  it('ships the mp4 hero encode only and is loaded through hero.ts', () => {
    expect(existsSync(join(ROOT, 'public', 'trailers', 'site-intro-hero.mp4'))).toBe(true);
    expect(existsSync(join(ROOT, 'public', 'trailers', 'site-intro-hero.webm'))).toBe(false);
    const hero = readFileSync(join(ROOT, 'src', 'site', 'hero.ts'), 'utf8');
    expect(hero).toContain("import './hero-trailer';");
  });

  // The trailer is composed around the centre of its frame; the still's right bottom anchor cut
  // the end card to "RED STORIES" on a 375 px phone and hid the tower behind the desktop panel.
  it('crops the trailer from the centre at every width', () => {
    const rules = [...css.matchAll(/\.hero-trailer \{([^}]*)\}/g)].map((m) => m[1]!);
    const sized = rules.filter((body) => /height:/.test(body));
    expect(sized.length).toBe(2);
    for (const body of sized) expect(body).toMatch(/object-position: center center;/);
    for (const body of rules) expect(body).not.toMatch(/object-position: (?!center center)/);
  });

  // Holds only tower footage: source frames 300 to 745 of the 30 fps intro. The wordmark's title
  // veil fades in from frame 751 (Scene 3 frame 151), so the cut must stay under 15 s.
  it('ships a hero cut that ends before the Scene 3 title', () => {
    const mp4 = readFileSync(join(ROOT, 'public', 'trailers', 'site-intro-hero.mp4'));
    const at = mp4.indexOf('mvhd');
    expect(at).toBeGreaterThan(0);
    expect(mp4.indexOf('moov')).toBeLessThan(mp4.indexOf('mdat'));
    const v1 = mp4[at + 4] === 1;
    const timescale = mp4.readUInt32BE(at + (v1 ? 24 : 16));
    const duration = v1 ? Number(mp4.readBigUInt64BE(at + 28)) : mp4.readUInt32BE(at + 20);
    const seconds = duration / timescale;
    expect(seconds).toBeGreaterThan(14.8);
    expect(seconds).toBeLessThan(15);
  });

  it('fades in on is-playing, stays under the copy and off under reduced motion', () => {
    expect(css).toMatch(/\.hero-trailer \{[^}]*opacity: 0;[^}]*transition: opacity 300ms[^}]*pointer-events: none;/);
    expect(css).toMatch(/\.hero-trailer\.is-playing \{\s*opacity: 1;/);
    expect(css).toMatch(/\.hero > \.wrap \{\s*position: relative;\s*z-index: 2;/);
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)') + 1);
    expect(reduced).toMatch(/^[^@]*\.hero-trailer \{\s*display: none;/);
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
    expect(config).toMatch(/"run_worker_first":\s*\[\s*"\/trailers\/\*"\s*\]/);
  });
});
