// The theme is a three-way choice: system (default, follows the OS), light,
// dark. The choice lives in localStorage under hs.theme ('light' or 'dark');
// anything else, including nothing at all, means system. public/theme.js
// applies a stored choice before first paint; this module is the toggle.

export type Theme = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'hs.theme';

export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Storage may be unavailable (private mode, disabled). Fall back to system.
  }
  return 'system';
}

export function applyTheme(theme: Theme): void {
  try {
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem(STORAGE_KEY, theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Best effort only; the page still renders with whatever theme it has.
  }
}

export function cycleTheme(theme: Theme): Theme {
  if (theme === 'system') return 'light';
  if (theme === 'light') return 'dark';
  return 'system';
}

export function themeLabel(theme: Theme): string {
  if (theme === 'light') return 'Theme: Light';
  if (theme === 'dark') return 'Theme: Dark';
  return 'Theme: System';
}

export function mountThemeToggle(button: HTMLButtonElement): void {
  let theme = readTheme();
  button.textContent = themeLabel(theme);
  button.addEventListener('click', () => {
    theme = cycleTheme(theme);
    applyTheme(theme);
    button.textContent = themeLabel(theme);
  });
}
