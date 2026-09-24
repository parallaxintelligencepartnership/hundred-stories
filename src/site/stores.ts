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

// Steam is left out of every public surface for now (Matt, 2026-09-24); the desktop build code stays.
const ORDER: readonly StoreId[] = ['appStore', 'googlePlay'];

export interface StoreEntry {
  id: StoreId;
  name: string;
  /** Empty when the listing does not exist yet. */
  href: string;
}

export function storeEntries(links: Record<StoreId, string> = STORE_LINKS): StoreEntry[] {
  return ORDER.map((id) => ({ id, name: STORE_NAMES[id], href: links[id].trim() }));
}

/** "the App Store and Google Play", for a sentence. */
export function storeNamesText(): string {
  return `the ${STORE_NAMES.appStore} and ${STORE_NAMES.googlePlay}`;
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

/**
 * Appends children to a store node. Every real element (HTMLElement, the test's FakeElement)
 * has `append` at runtime; the shared StoreNode type leaves it out because HTMLElement's own
 * `append(...nodes: (Node | string)[])` cannot structurally satisfy a same-shaped constraint, the
 * same reason challenge.ts and demo.ts cast through `unknown` at their one DOM boundary.
 */
function appendChildren(parent: StoreNode, children: StoreNode[]): void {
  (parent as unknown as { append(...nodes: StoreNode[]): void }).append(...children);
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

/** The small top line above a store name: what the button says it will do. */
function storeLead(id: StoreId, hasHref: boolean): string {
  if (!hasHref) return 'Coming soon to';
  return id === 'appStore' ? 'Download on' : 'Get it on';
}

/**
 * One big, app-style button per store: a small line ("Coming soon to", "Download on", "Get it
 * on") above the store's name. Soon entries stay non-links with a muted look; live entries stay
 * <a>. No store logos or trademark badge artwork, by design.
 */
export function storeButtonNodes(doc: StoreDoc, links: Record<StoreId, string> = STORE_LINKS): StoreNode[] {
  return storeEntries(links).map((entry) => {
    const lead = storeLead(entry.id, Boolean(entry.href));
    const top = doc.createElement('span');
    top.className = 'store-link-top';
    top.textContent = lead;
    const name = doc.createElement('span');
    name.className = 'store-link-name';
    name.textContent = entry.name;

    const wrapper = entry.href ? doc.createElement('a') : doc.createElement('span');
    wrapper.className = entry.href ? 'store-link' : 'store-link is-soon';
    wrapper.setAttribute('aria-label', entry.href ? `${lead} ${entry.name}` : `${entry.name}, coming soon`);
    if (entry.href) {
      wrapper.setAttribute('href', entry.href);
      wrapper.setAttribute('rel', 'noopener');
    }
    appendChildren(wrapper, [top, name]);
    return wrapper;
  });
}

/** Fills the landing page's store row with the two-line app-style buttons. Exported for tests. */
export function mountStoreRow<N extends StoreNode>(
  row: { replaceChildren(...nodes: N[]): void },
  doc: { createElement(tag: 'a' | 'span'): N },
  links: Record<StoreId, string> = STORE_LINKS,
): void {
  row.replaceChildren(...(storeButtonNodes(doc, links) as N[]));
}

// Guarded like challenge.ts: tests import the pure exports in node, and /play/ has no row.
if (typeof document !== 'undefined') {
  const row = document.getElementById('store-row');
  if (row) mountStoreRow<HTMLElement>(row, document);
}
