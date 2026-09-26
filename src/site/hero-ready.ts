// The hero's one-time "settled" signal: the landing hero has drawn its first frame, or has given up
// (no WebGL, reduced motion, an error), so the page is free for other work. The room specimens
// wait on it so their drawing never delays the tower (D-39 follow-up), and the design sheet waits
// on the same attribute before it shoots the landing page.
//
// The signal is an attribute on <html>, data-hero-settled="drawn" or "none", plus one event. A
// page with no #hero (the guide, the 404) is settled from the start.

export const HERO_SETTLED_EVENT = 'hs:hero-settled';
export const HERO_SETTLED_ATTR = 'data-hero-settled';

export type HeroSettled = 'drawn' | 'none';

/** The parts of the document the signal touches, so a test can hand in a stand in. */
export interface HeroDocument {
  documentElement: { getAttribute(name: string): string | null; setAttribute(name: string, value: string): void };
  getElementById(id: string): unknown;
  addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void;
  dispatchEvent(event: Event): boolean;
}

/** Marks the hero settled, once: a second call (the failure path after a frame) changes nothing. */
export function markHeroSettled(doc: HeroDocument, how: HeroSettled): void {
  // Best effort, like the rest of the hero: a missing or partial document never throws from here.
  try {
    if (doc.documentElement.getAttribute(HERO_SETTLED_ATTR)) return;
    doc.documentElement.setAttribute(HERO_SETTLED_ATTR, how);
    doc.dispatchEvent(new Event(HERO_SETTLED_EVENT));
  } catch {
    // Nothing waits on a page that cannot carry the signal.
  }
}

/** Resolves once the hero has settled; at once on a page with no hero or a hero already settled. */
export function whenHeroSettled(doc: HeroDocument): Promise<void> {
  if (!doc.getElementById('hero') || doc.documentElement.getAttribute(HERO_SETTLED_ATTR)) return Promise.resolve();
  return new Promise((resolve) => doc.addEventListener(HERO_SETTLED_EVENT, () => resolve(), { once: true }));
}
