// The landing site is plain HTML with no framework, so its contract is the
// markup itself: the front door at /, the guide at /how-to-play/, the game
// shell at /play/, and the crawler files beside them.

// Raw imports rather than node:fs: this repo has no @types/node and adds no
// dependencies, and Vite hands the files over verbatim either way.
import guide from '../../how-to-play/index.html?raw';
import landing from '../../index.html?raw';
import play from '../../play/index.html?raw';
import robots from '../../public/robots.txt?raw';
import sitemap from '../../public/sitemap.xml?raw';
import { describe, expect, it } from 'vitest';

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

  it('loads the site stylesheet and the hero module, and nothing else', () => {
    expect(landing).toContain('href="/src/site/site.css"');
    expect(landing.match(/<script type="module"[^>]*>/g)).toHaveLength(1);
    expect(landing).toContain('src="/src/site/hero.ts"');
  });

  it('keeps the still hero image as the fallback', () => {
    expect(landing).toContain('id="hero-shot"');
    expect(landing).toContain('id="hero-view"');
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
