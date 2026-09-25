// The demo edition's cap card: the first time a build hits the demo's box in a session, a card in
// the panel pattern says where the demo stops and names the stores the full game is coming to.
// Store links come from src/site/stores.ts; an empty one is "coming soon" text, never a dead link.

import { DEMO_CAP_REASON, DEMO_MAX_FLOOR, DEMO_MAX_WIDTH_TILES, DEMO_MIN_FLOOR, LIMITS } from '../sim/rules';
import type { LogEntry } from '../sim/types';
import { storeLinkNodes, storeNamesText, type StoreDoc } from '../site/stores';
import { button, el, panelShell, type PanelElement } from './panels';

export interface DemoCapCard {
  /** Show the card if it has not been shown this session. True when it opened. */
  offer(): boolean;
  /** Whether the card has been offered this session. */
  readonly offered: boolean;
  /** Take the card down, if it is up. */
  close(): void;
}

/** A demo cap refusal as the world log records it (every refused command is logged verbatim). */
export function isDemoCapEntry(entry: Pick<LogEntry, 'level' | 'text'>): boolean {
  return entry.level === 'warn' && entry.text === DEMO_CAP_REASON;
}

export const DEMO_CAP_TITLE = 'The demo';

export function demoCapLines(): string[] {
  return [
    `This demo stops at ${DEMO_MAX_FLOOR} floors, ${-DEMO_MIN_FLOOR} basements and ${DEMO_MAX_WIDTH_TILES} tiles across.`,
    `The full game, all ${LIMITS.maxFloor} floors across the whole ${LIMITS.towerWidth} tile lot, is coming to ${storeNamesText()}.`,
    'Everything else is open here: every room, every star, events, saves and sharing.',
  ];
}

/** One card per ui, so once per session: the ui is built once per page load. */
export function createDemoCapCard(host: { append(node: HTMLElement): void }): DemoCapCard {
  let offered = false;
  let node: PanelElement | null = null;

  const close = (): void => {
    node?.sheet?.unmount();
    node = null;
  };

  return {
    get offered() {
      return offered;
    },
    offer() {
      if (offered) return false;
      offered = true;
      const { panel, body } = panelShell(DEMO_CAP_TITLE, 'star', { close });
      panel.classList.add('hs-demo-cap');
      body.append(el('h3', 'hs-card-title', 'Where the demo stops'));
      for (const line of demoCapLines()) body.append(el('p', 'hs-intro-line', line));
      // Laid out by .hs-demo-cap .hs-demo-stores in ui.css.
      const stores = el('div', 'hs-demo-stores');
      for (const item of storeLinkNodes(document as unknown as StoreDoc)) {
        const itemNode = item as unknown as HTMLElement;
        // A live listing is a button-like link; "coming soon" stays quiet text.
        itemNode.classList.add(itemNode.tagName === 'A' ? 'hs-btn' : 'hs-card-meta');
        stores.append(itemNode);
      }
      const actions = el('div', 'hs-actions');
      actions.append(button('Keep building', 'hs-btn is-primary', close));
      body.append(stores, actions);
      node = panel;
      panel.sheet?.mount(host);
      return true;
    },
    close,
  };
}
