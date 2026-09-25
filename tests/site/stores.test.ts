// The landing page's store row: driven by STORE_LINKS, rendered as two-line app-style buttons.
// Steam is left out of every public surface for now (Matt, 2026-09-24); its link and name stay
// in the data so the desktop build code keeps working, but it never appears in the order.
import { describe, expect, it } from 'vitest';

import landing from '../../index.html?raw';
import notFoundPage from '../../404.html?raw';
import howToPlayPage from '../../how-to-play/index.html?raw';
import privacyPage from '../../privacy/index.html?raw';
import viteConfigSource from '../../vite.config.ts?raw';
import { mountStoreRow, STORE_LINKS, storeEntries, storeNamesText } from '../../src/site/stores';
import { FakeDom } from '../ui/fake-dom';

const FORBIDDEN = ['Steam', 'Source on GitHub', 'Source available to read'];

describe('store links', () => {
  it('are empty until a listing exists', () => {
    expect(STORE_LINKS).toEqual({ appStore: '', googlePlay: '', steam: '' });
  });

  it('lists only the App Store and Google Play; Steam is kept in the data but left out of the order', () => {
    expect(storeEntries().map((e) => e.name)).toEqual(['App Store', 'Google Play']);
  });

  it('names the two stores in a sentence', () => {
    expect(storeNamesText()).toBe('the App Store and Google Play');
  });
});

describe('the landing store row', () => {
  it('is in the markup with a two-line coming soon button for each store', () => {
    expect(landing).toContain('id="store-row"');
    expect(landing).toContain('App Store, coming soon');
    expect(landing).toContain('Google Play, coming soon');
    expect(landing).not.toContain('Steam');
    expect(landing).toContain('store-link-top');
    expect(landing).toContain('store-link-name');
    expect(landing.match(/class="store-link-top">Coming soon to</g)).toHaveLength(2);
  });

  it('renders every empty link as a two-line "coming soon" button, not a link', () => {
    const dom = new FakeDom();
    const row = dom.createElement('div');
    mountStoreRow(row, dom);
    expect(row.children).toHaveLength(2);
    expect(row.children.every((n) => n.tagName === 'SPAN')).toBe(true);
    const [appStore, googlePlay] = row.children;
    expect(appStore?.getAttribute('aria-label')).toBe('App Store, coming soon');
    expect(googlePlay?.getAttribute('aria-label')).toBe('Google Play, coming soon');
    for (const node of row.children) {
      const top = node.children.find((c) => c.className === 'store-link-top');
      const name = node.children.find((c) => c.className === 'store-link-name');
      expect(top?.textContent).toBe('Coming soon to');
      expect(name?.textContent).toBeTruthy();
    }
  });

  it('renders a filled link as a link to the listing, with a store-specific lead line', () => {
    const dom = new FakeDom();
    const row = dom.createElement('div');
    mountStoreRow(row, dom, { appStore: 'https://apps.apple.com/app/1', googlePlay: '', steam: '' });
    const appStore = row.children[0];
    expect(appStore?.tagName).toBe('A');
    expect(appStore?.getAttribute('href')).toBe('https://apps.apple.com/app/1');
    expect(appStore?.getAttribute('aria-label')).toBe('Download on App Store');
    expect(appStore?.children.map((c) => c.textContent)).toEqual(['Download on', 'App Store']);

    const googlePlay = row.children[1];
    expect(googlePlay?.tagName).toBe('SPAN');
    expect(googlePlay?.getAttribute('aria-label')).toBe('Google Play, coming soon');
  });

  it('gives Google Play "Get it on" once it has a listing', () => {
    const dom = new FakeDom();
    const row = dom.createElement('div');
    mountStoreRow(row, dom, { appStore: '', googlePlay: 'https://play.google.com/store/apps/details?id=1', steam: '' });
    const googlePlay = row.children[1];
    expect(googlePlay?.tagName).toBe('A');
    expect(googlePlay?.children.map((c) => c.textContent)).toEqual(['Get it on', 'Google Play']);
  });
});

describe('Steam and the source link are off every public page and the install manifest', () => {
  it('keeps 404, how-to-play and privacy free of Steam and the source link text', () => {
    for (const [name, page] of [
      ['404.html', notFoundPage],
      ['how-to-play/index.html', howToPlayPage],
      ['privacy/index.html', privacyPage],
    ] as const) {
      for (const phrase of FORBIDDEN) {
        expect(page, `${name} should not contain "${phrase}"`).not.toContain(phrase);
      }
    }
  });

  it('keeps the PWA manifest description free of Steam and the source link text', () => {
    const match = viteConfigSource.match(/description:\s*\n?\s*'([^']*)'/);
    expect(match, 'manifest description not found in vite.config.ts').toBeTruthy();
    const description = match![1];
    for (const phrase of FORBIDDEN) {
      expect(description, `manifest description should not contain "${phrase}"`).not.toContain(phrase);
    }
  });
});
