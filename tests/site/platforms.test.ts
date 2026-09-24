// The B3 platform switcher on a fake DOM: three tabs, Web selected by default, and clicking or
// arrow-keying moves aria-selected and the hidden panels. No jsdom in this repo, so the parts the
// module touches are hand-rolled the way tests/site/theme.test.ts stands in for the toggle button.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import landing from '../../index.html?raw';
import {
  mountPlatformSwitcher,
  PLATFORM_IDS,
  type PlatformHighlight,
  type PlatformPanel,
  type PlatformSwitcherParts,
  type PlatformTab,
} from '../../src/site/platforms';

type Handler = (event: { key?: string; preventDefault(): void }) => void;

function fakeTab(): PlatformTab & { listeners: Map<string, Handler[]>; attrs: Map<string, string>; focused: number } {
  const listeners = new Map<string, Handler[]>();
  const attrs = new Map<string, string>();
  return {
    listeners,
    attrs,
    tabIndex: -1,
    focused: 0,
    setAttribute(name, value) {
      attrs.set(name, value);
    },
    focus() {
      this.focused += 1;
    },
    addEventListener(type, fn) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
  };
}

function fakePanel(): PlatformPanel {
  return { hidden: false };
}

function fakeHighlight(): PlatformHighlight {
  return { style: { transform: '' } };
}

function fakeTablist(): { listeners: Map<string, Handler[]>; addEventListener(type: string, fn: Handler): void } {
  const listeners = new Map<string, Handler[]>();
  return {
    listeners,
    addEventListener(type, fn) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
  };
}

function setup(): {
  parts: PlatformSwitcherParts;
  tabs: Record<'web' | 'ios' | 'android', ReturnType<typeof fakeTab>>;
  panels: Record<'web' | 'ios' | 'android', PlatformPanel>;
  tablist: ReturnType<typeof fakeTablist>;
} {
  const tabs = { web: fakeTab(), ios: fakeTab(), android: fakeTab() };
  const panels = { web: fakePanel(), ios: fakePanel(), android: fakePanel() };
  const tablist = fakeTablist();
  const highlight = fakeHighlight();
  const parts: PlatformSwitcherParts = { tablist, tabs, panels, highlight };
  return { parts, tabs, panels, tablist };
}

describe('mountPlatformSwitcher', () => {
  it('has three platforms, in order', () => {
    expect(PLATFORM_IDS).toEqual(['web', 'ios', 'android']);
  });

  it('selects Web by default, hiding the other two panels', () => {
    const { parts, tabs, panels } = setup();
    mountPlatformSwitcher(parts);
    expect(tabs.web.attrs.get('aria-selected')).toBe('true');
    expect(tabs.ios.attrs.get('aria-selected')).toBe('false');
    expect(tabs.android.attrs.get('aria-selected')).toBe('false');
    expect(panels.web.hidden).toBe(false);
    expect(panels.ios.hidden).toBe(true);
    expect(panels.android.hidden).toBe(true);
  });

  it('switches on a tab click: aria-selected and hidden move together', () => {
    const { parts, tabs, panels } = setup();
    mountPlatformSwitcher(parts);
    tabs.android.listeners.get('click')?.[0]?.({ preventDefault() {} });
    expect(tabs.android.attrs.get('aria-selected')).toBe('true');
    expect(tabs.web.attrs.get('aria-selected')).toBe('false');
    expect(panels.android.hidden).toBe(false);
    expect(panels.web.hidden).toBe(true);
    expect(panels.ios.hidden).toBe(true);
  });

  it('moves with the right and left arrow keys, wrapping at each end', () => {
    const { parts, tabs, panels, tablist } = setup();
    mountPlatformSwitcher(parts);
    let prevented = 0;
    const fire = (key: string): void => {
      tablist.listeners.get('keydown')?.[0]?.({ key, preventDefault: () => (prevented += 1) });
    };

    fire('ArrowRight');
    expect(tabs.ios.attrs.get('aria-selected')).toBe('true');
    expect(panels.ios.hidden).toBe(false);
    expect(tabs.ios.focused).toBe(1);

    fire('ArrowRight');
    expect(tabs.android.attrs.get('aria-selected')).toBe('true');

    fire('ArrowRight');
    expect(tabs.web.attrs.get('aria-selected')).toBe('true');

    fire('ArrowLeft');
    expect(tabs.android.attrs.get('aria-selected')).toBe('true');
    expect(prevented).toBe(4);

    fire('Enter');
    expect(tabs.android.attrs.get('aria-selected')).toBe('true');
    expect(prevented).toBe(4);
  });
});

describe('the platform switcher markup', () => {
  it('has three tabs, Web selected by default', () => {
    expect(landing).toContain('id="platform-tab-web"');
    expect(landing).toContain('id="platform-tab-ios"');
    expect(landing).toContain('id="platform-tab-android"');
    expect(landing).toMatch(/id="platform-tab-web"[^>]*aria-selected="true"/);
    expect(landing).toMatch(/id="platform-tab-ios"[^>]*aria-selected="false"/);
    expect(landing).toMatch(/id="platform-tab-android"[^>]*aria-selected="false"/);
  });

  it('leaves all three panels visible without hidden attributes, for no-JS visitors', () => {
    const section = landing.slice(landing.indexOf('id="platform-switcher"'), landing.indexOf('</section>', landing.indexOf('id="platform-switcher"')));
    expect(section).not.toMatch(/id="platform-panel-\w+"[^>]*\bhidden\b/);
  });

  it('gives each panel the same four rows: Account, Where it saves, Backup, Tracking', () => {
    for (const id of ['web', 'ios', 'android']) {
      const start = landing.indexOf(`id="platform-panel-${id}"`);
      const end = landing.indexOf('</dl>', start);
      const panel = landing.slice(start, end);
      expect(panel).toContain('<dt>Account</dt>');
      expect(panel).toContain('<dt>Where it saves</dt>');
      expect(panel).toContain('<dt>Backup</dt>');
      expect(panel).toContain('<dt>Tracking</dt>');
    }
  });

  it('is mounted from the hero module, the way stores.ts is', () => {
    expect(landing).toContain('src="/src/site/hero.ts"');
  });
});

describe('hero.ts loads the platform switcher', () => {
  it('imports ./platforms for its self-mounting guard', () => {
    const heroSrc = readFileSync(new URL('../../src/site/hero.ts', import.meta.url), 'utf8');
    expect(heroSrc).toContain("import './platforms';");
  });
});
