// The landing page's store row: driven by STORE_LINKS, an empty link is "coming soon" text.
import { describe, expect, it } from 'vitest';

import landing from '../../index.html?raw';
import { mountStoreRow, STORE_LINKS, storeEntries } from '../../src/site/stores';
import { FakeDom } from '../ui/fake-dom';

describe('store links', () => {
  it('are empty until a listing exists', () => {
    expect(STORE_LINKS).toEqual({ appStore: '', googlePlay: '', steam: '' });
    expect(storeEntries().map((e) => e.name)).toEqual(['App Store', 'Google Play', 'Steam']);
  });
});

describe('the landing store row', () => {
  it('is in the markup with a coming soon fallback for each store', () => {
    expect(landing).toContain('id="store-row"');
    expect(landing).toContain('App Store: coming soon');
    expect(landing).toContain('Google Play: coming soon');
    expect(landing).toContain('Steam: coming soon');
  });

  it('renders every empty link as coming soon text, not a link', () => {
    const dom = new FakeDom();
    const row = dom.createElement('div');
    mountStoreRow(row, dom);
    expect(row.children.map((n) => n.textContent)).toEqual([
      'App Store: coming soon',
      'Google Play: coming soon',
      'Steam: coming soon',
    ]);
    expect(row.children.every((n) => n.tagName === 'SPAN')).toBe(true);
  });

  it('renders a filled link as a link to the listing', () => {
    const dom = new FakeDom();
    const row = dom.createElement('div');
    mountStoreRow(row, dom, { appStore: '', googlePlay: '', steam: 'https://store.steampowered.com/app/1' });
    const steam = row.children[2];
    expect(steam?.tagName).toBe('A');
    expect(steam?.getAttribute('href')).toBe('https://store.steampowered.com/app/1');
    expect(steam?.textContent).toBe('Steam');
    expect(row.children[0]?.textContent).toBe('App Store: coming soon');
  });
});
