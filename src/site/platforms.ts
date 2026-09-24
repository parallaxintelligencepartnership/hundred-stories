// The B3 platform switcher: three tabs (Web, iPhone & iPad, Android), each showing a short
// account/save/backup/tracking summary for that platform. This module only hides the two panels
// that are not selected: without it, all three panels stay visible, stacked, so nothing here is
// load bearing for reading the copy.

export type PlatformId = 'web' | 'ios' | 'android';

export const PLATFORM_IDS: readonly PlatformId[] = ['web', 'ios', 'android'];

/** The slice of an element this file needs: shared by the real DOM and a test's fakes. */
export interface PlatformNode {
  addEventListener(type: string, fn: (event: { key?: string; preventDefault(): void }) => void): void;
}

export interface PlatformTab extends PlatformNode {
  setAttribute(name: string, value: string): void;
  tabIndex: number;
  focus(): void;
}

export interface PlatformPanel {
  hidden: boolean;
}

export interface PlatformHighlight {
  style: { transform: string };
}

export interface PlatformSwitcherParts {
  tablist: PlatformNode;
  tabs: Record<PlatformId, PlatformTab>;
  panels: Record<PlatformId, PlatformPanel>;
  highlight: PlatformHighlight;
}

const ARROW_DELTA: Record<string, 1 | -1> = { ArrowRight: 1, ArrowLeft: -1 };

/** Wires up the tabs: click or arrow keys select a platform, which shows its panel and moves
 *  the sliding highlight. Exported for tests. */
export function mountPlatformSwitcher(parts: PlatformSwitcherParts): void {
  let current: PlatformId = 'web';

  const select = (id: PlatformId, focus: boolean): void => {
    current = id;
    for (const key of PLATFORM_IDS) {
      const isSelected = key === id;
      parts.tabs[key].setAttribute('aria-selected', String(isSelected));
      parts.tabs[key].tabIndex = isSelected ? 0 : -1;
      parts.panels[key].hidden = !isSelected;
    }
    parts.highlight.style.transform = `translateX(${PLATFORM_IDS.indexOf(id) * 100}%)`;
    if (focus) parts.tabs[id].focus();
  };

  // The default is Web, already selected in the markup; this only hides the other two panels.
  select('web', false);

  for (const id of PLATFORM_IDS) {
    parts.tabs[id].addEventListener('click', () => select(id, false));
  }

  parts.tablist.addEventListener('keydown', (event) => {
    const delta = event.key ? ARROW_DELTA[event.key] : undefined;
    if (!delta) return;
    event.preventDefault();
    const next = PLATFORM_IDS[(PLATFORM_IDS.indexOf(current) + delta + PLATFORM_IDS.length) % PLATFORM_IDS.length] ?? 'web';
    select(next, true);
  });
}

// Guarded like challenge.ts and stores.ts: tests import the pure export in node, and /play/ and
// the guide have no switcher.
if (typeof document !== 'undefined') {
  const tablist = document.getElementById('platform-tablist');
  const highlight = document.getElementById('platform-tab-highlight');
  const tabs = {
    web: document.getElementById('platform-tab-web'),
    ios: document.getElementById('platform-tab-ios'),
    android: document.getElementById('platform-tab-android'),
  };
  const panels = {
    web: document.getElementById('platform-panel-web'),
    ios: document.getElementById('platform-panel-ios'),
    android: document.getElementById('platform-panel-android'),
  };
  if (
    tablist &&
    highlight &&
    tabs.web &&
    tabs.ios &&
    tabs.android &&
    panels.web &&
    panels.ios &&
    panels.android
  ) {
    mountPlatformSwitcher({
      tablist: tablist as unknown as PlatformNode,
      highlight: highlight as unknown as PlatformHighlight,
      tabs: tabs as unknown as Record<PlatformId, PlatformTab>,
      panels: panels as unknown as Record<PlatformId, PlatformPanel>,
    });
  }
}
