// The store listings: one place for the links the landing page and the demo's cap card show.
// Empty until a listing exists; an empty link is drawn as "coming soon" text, never a dead link.

export type StoreId = 'appStore' | 'googlePlay' | 'steam';

export const STORE_LINKS: Record<StoreId, string> = {
  appStore: '',
  googlePlay: '',
  steam: '',
};

export const STORE_NAMES: Record<StoreId, string> = {
  appStore: 'App Store',
  googlePlay: 'Google Play',
  steam: 'Steam',
};

const ORDER: readonly StoreId[] = ['appStore', 'googlePlay', 'steam'];

export interface StoreEntry {
  id: StoreId;
  name: string;
  /** Empty when the listing does not exist yet. */
  href: string;
}

export function storeEntries(links: Record<StoreId, string> = STORE_LINKS): StoreEntry[] {
  return ORDER.map((id) => ({ id, name: STORE_NAMES[id], href: links[id].trim() }));
}

/** "the App Store, Google Play and Steam", for a sentence. */
export function storeNamesText(): string {
  return `the ${STORE_NAMES.appStore}, ${STORE_NAMES.googlePlay} and ${STORE_NAMES.steam}`;
}

/** The slice of an element this file writes, so the landing page and the game's fake dom both fit. */
export interface StoreNode {
  className: string;
  textContent: string | null;
  setAttribute(name: string, value: string): void;
}

export interface StoreDoc {
  createElement(tag: 'a' | 'span'): StoreNode;
}

/** One item per store: a link when it has one, else the name and "coming soon" as plain text. */
export function storeLinkNodes(doc: StoreDoc, links: Record<StoreId, string> = STORE_LINKS): StoreNode[] {
  return storeEntries(links).map((entry) => {
    if (entry.href) {
      const a = doc.createElement('a');
      a.className = 'store-link';
      a.setAttribute('href', entry.href);
      a.setAttribute('rel', 'noopener');
      a.textContent = entry.name;
      return a;
    }
    const span = doc.createElement('span');
    span.className = 'store-link is-soon';
    span.textContent = `${entry.name}: coming soon`;
    return span;
  });
}

/** Fills the landing page's store row. Exported for tests. */
export function mountStoreRow<N extends StoreNode>(
  row: { replaceChildren(...nodes: N[]): void },
  doc: { createElement(tag: 'a' | 'span'): N },
  links: Record<StoreId, string> = STORE_LINKS,
): void {
  row.replaceChildren(...(storeLinkNodes(doc, links) as N[]));
}

// Guarded like challenge.ts: tests import the pure exports in node, and /play/ has no row.
if (typeof document !== 'undefined') {
  const row = document.getElementById('store-row');
  if (row) mountStoreRow<HTMLElement>(row, document);
}
