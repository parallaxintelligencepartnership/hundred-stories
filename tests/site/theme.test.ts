// theme.ts touches document.documentElement and localStorage, neither of which exist in the
// plain node test environment this repo uses. Stand in for both with hand-rolled stubs, the same
// way tests/ui/hint.test.ts stands in for window.localStorage: no jsdom, no new dependency.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, cycleTheme, mountThemeToggle, readTheme, themeLabel } from '../../src/site/theme';

type FakeElement = { setAttribute: (name: string, value: string) => void; removeAttribute: (name: string) => void; getAttribute: (name: string) => string | null };

function fakeDocumentElement(): FakeElement {
  const attrs = new Map<string, string>();
  return {
    setAttribute(name, value) {
      attrs.set(name, value);
    },
    removeAttribute(name) {
      attrs.delete(name);
    },
    getAttribute(name) {
      return attrs.has(name) ? attrs.get(name)! : null;
    },
  };
}

function fakeLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

const originalDocument = (globalThis as { document?: unknown }).document;
const originalLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;

let documentElement: FakeElement;
let localStorageStub: Storage;

beforeEach(() => {
  documentElement = fakeDocumentElement();
  localStorageStub = fakeLocalStorage();
  (globalThis as { document: { documentElement: FakeElement } }).document = { documentElement };
  (globalThis as { localStorage: Storage }).localStorage = localStorageStub;
});

afterEach(() => {
  (globalThis as { document?: unknown }).document = originalDocument;
  (globalThis as { localStorage?: unknown }).localStorage = originalLocalStorage;
});

describe('readTheme', () => {
  it('is system when nothing is stored', () => {
    expect(readTheme()).toBe('system');
  });

  it('reads a valid stored choice', () => {
    localStorageStub.setItem('hs.theme', 'light');
    expect(readTheme()).toBe('light');
    localStorageStub.setItem('hs.theme', 'dark');
    expect(readTheme()).toBe('dark');
  });

  it('treats junk as system', () => {
    localStorageStub.setItem('hs.theme', 'purple');
    expect(readTheme()).toBe('system');
  });
});

describe('applyTheme', () => {
  it('sets the attribute and the storage key for light and dark', () => {
    applyTheme('light');
    expect(documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorageStub.getItem('hs.theme')).toBe('light');

    applyTheme('dark');
    expect(documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorageStub.getItem('hs.theme')).toBe('dark');
  });

  it('removes the attribute and the storage key for system', () => {
    applyTheme('dark');
    applyTheme('system');
    expect(documentElement.getAttribute('data-theme')).toBeNull();
    expect(localStorageStub.getItem('hs.theme')).toBeNull();
  });
});

describe('cycleTheme', () => {
  it('goes system to light to dark and back to system', () => {
    expect(cycleTheme('system')).toBe('light');
    expect(cycleTheme('light')).toBe('dark');
    expect(cycleTheme('dark')).toBe('system');
  });
});

describe('themeLabel', () => {
  it('names each state', () => {
    expect(themeLabel('system')).toBe('Theme: System');
    expect(themeLabel('light')).toBe('Theme: Light');
    expect(themeLabel('dark')).toBe('Theme: Dark');
  });
});

describe('storage that throws', () => {
  function fakeThrowingLocalStorage(): Storage {
    const throwing = () => {
      throw new Error('blocked');
    };
    return {
      getItem: throwing,
      setItem: throwing,
      removeItem: throwing,
      clear: () => undefined,
      key: () => null,
      length: 0,
    } as unknown as Storage;
  }

  beforeEach(() => {
    (globalThis as { localStorage: Storage }).localStorage = fakeThrowingLocalStorage();
  });

  it('readTheme returns system and does not throw', () => {
    expect(() => readTheme()).not.toThrow();
    expect(readTheme()).toBe('system');
  });

  it('applyTheme(dark) does not throw and still sets the attribute', () => {
    expect(() => applyTheme('dark')).not.toThrow();
    expect(documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('applyTheme(system) does not throw and removes the attribute', () => {
    expect(() => applyTheme('system')).not.toThrow();
    expect(documentElement.getAttribute('data-theme')).toBeNull();
  });

  it('mountThemeToggle does not throw and labels the button Theme: System', () => {
    const button = {
      textContent: '',
      addEventListener: () => undefined,
    } as unknown as HTMLButtonElement;

    expect(() => mountThemeToggle(button)).not.toThrow();
    expect(button.textContent).toBe('Theme: System');
  });
});

describe('mountThemeToggle', () => {
  it('labels the button for the current theme and cycles it on click', () => {
    let clickHandler: (() => void) | undefined;
    const button = {
      textContent: '',
      addEventListener: (event: string, handler: () => void) => {
        if (event === 'click') clickHandler = handler;
      },
    } as unknown as HTMLButtonElement;

    mountThemeToggle(button);
    expect(button.textContent).toBe('Theme: System');

    clickHandler?.();
    expect(button.textContent).toBe('Theme: Light');
    expect(documentElement.getAttribute('data-theme')).toBe('light');

    clickHandler?.();
    expect(button.textContent).toBe('Theme: Dark');
    expect(documentElement.getAttribute('data-theme')).toBe('dark');

    clickHandler?.();
    expect(button.textContent).toBe('Theme: System');
    expect(documentElement.getAttribute('data-theme')).toBeNull();
  });
});
