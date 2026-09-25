// What the Display switches in Settings do. Settings only stores them (src/ui/prefs.ts); this
// reads them at boot and again on every write, so a switch takes at once.
//
// Larger text: the page root gets hs-large-text, and ui.css scales every size token (type,
// touch targets, the bars and cards built on them) by 1.25 through --ui-scale.
// Color-blind friendly views: the renderer draws the information views in the blue to orange
// ramp with stripes on the worst step, and the chip's legend follows. Render only: the sim and
// the world hash never hear of it.

import { PREF_KEYS, getFlag, onPrefChange } from './prefs';

/** How much Larger text scales the ui. ui.css holds the same number. */
export const LARGE_TEXT_SCALE = 1.25;

export interface DisplayPrefs {
  largeText: boolean;
  colorBlind: boolean;
}

/** Both switches, off unless the player turned them on. */
export function readDisplayPrefs(): DisplayPrefs {
  return {
    largeText: getFlag(PREF_KEYS.largeText) === true,
    colorBlind: getFlag(PREF_KEYS.colorBlind) === true,
  };
}

interface ClassTarget {
  classList: { toggle(name: string, on?: boolean): boolean };
}

export interface DisplayTargets {
  /** The page root (document.documentElement), where the size tokens live. */
  root: ClassTarget | null;
  /** Where the color-blind choice goes: the renderer and the view chip. */
  colorBlind(on: boolean): void;
}

/** Put the switches into effect. */
export function applyDisplayPrefs(prefs: DisplayPrefs, targets: DisplayTargets): void {
  targets.root?.classList.toggle('hs-large-text', prefs.largeText);
  targets.colorBlind(prefs.colorBlind);
}

/** Apply now and after every write to either key. Returns the way to stop. */
export function watchDisplayPrefs(targets: DisplayTargets): () => void {
  let last: DisplayPrefs | null = null;
  // Each switch is put into effect when it moves, and only then.
  const apply = (): void => {
    const prefs = readDisplayPrefs();
    if (!last || prefs.largeText !== last.largeText) targets.root?.classList.toggle('hs-large-text', prefs.largeText);
    if (!last || prefs.colorBlind !== last.colorBlind) targets.colorBlind(prefs.colorBlind);
    last = prefs;
  };
  apply();
  return onPrefChange((key) => {
    if (key === PREF_KEYS.largeText || key === PREF_KEYS.colorBlind) apply();
  });
}

/** The page root, where there is one. */
export function pageRoot(): ClassTarget | null {
  try {
    return (typeof document !== 'undefined' && (document as { documentElement?: ClassTarget }).documentElement) || null;
  } catch {
    return null;
  }
}
