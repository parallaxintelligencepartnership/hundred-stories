// Haptics: a light tap when something is built, a double tap when the tower says no, and a
// short success pattern when a star is earned. On by default; Settings, Display turns them off.
//
// Inside the iOS and Android apps they go through @capacitor/haptics, loaded only there. On the
// web, navigator.vibrate where the browser has it (Android); elsewhere they do nothing.

import { PREF_KEYS, getFlag, setFlag } from './prefs';

export type HapticKind = 'place' | 'refuse' | 'star';

/** The web patterns, in ms: on, off, on. */
export const VIBRATE_PATTERNS: Record<HapticKind, number | number[]> = {
  place: 10,
  refuse: [12, 70, 12],
  star: [16, 50, 16, 50, 40],
};

/** The gap in the app's double tap, in ms. */
export const DOUBLE_TAP_GAP_MS = 90;

/** The same kind again within this many ms is not felt twice (a burst of builds in one batch). */
export const HAPTIC_MIN_GAP_MS = 60;

/** The little of @capacitor/haptics used here, as plain functions (never the plugin Proxy). */
export interface NativeHaptics {
  lightTap(): Promise<void>;
  success(): Promise<void>;
}

export interface HapticsDeps {
  /** True inside the iOS or Android shell. */
  native(): boolean;
  /** navigator.vibrate, bound, where the browser has it. */
  vibrate: ((pattern: number | number[]) => boolean) | null;
  /** Loads the native plugin; only called inside the apps. */
  loadNative(): Promise<NativeHaptics>;
  /** The player's switch. */
  enabled(): boolean;
  now(): number;
  later(fn: () => void, ms: number): void;
}

export interface Haptics {
  play(kind: HapticKind): void;
}

/** On unless the player turned them off. */
export function hapticsEnabled(): boolean {
  return getFlag(PREF_KEYS.haptics) !== false;
}

export function setHapticsEnabled(on: boolean): void {
  setFlag(PREF_KEYS.haptics, on);
}

export function createHaptics(deps: HapticsDeps): Haptics {
  const lastAt = new Map<HapticKind, number>();
  let native: Promise<NativeHaptics | null> | null = null;

  function plugin(): Promise<NativeHaptics | null> {
    native ??= deps.loadNative().catch(() => null);
    return native;
  }

  function playNative(kind: HapticKind): void {
    void plugin().then((haptics) => {
      if (!haptics) return;
      if (kind === 'star') void haptics.success().catch(() => {});
      else void haptics.lightTap().catch(() => {});
      if (kind === 'refuse') deps.later(() => void haptics.lightTap().catch(() => {}), DOUBLE_TAP_GAP_MS);
    });
  }

  return {
    play(kind) {
      if (!deps.enabled()) return;
      const now = deps.now();
      const last = lastAt.get(kind);
      if (last !== undefined && now - last < HAPTIC_MIN_GAP_MS) return;
      lastAt.set(kind, now);
      if (deps.native()) {
        playNative(kind);
        return;
      }
      try {
        deps.vibrate?.(VIBRATE_PATTERNS[kind]);
      } catch {
        // A browser that refuses (no user gesture yet, a blocked frame) just stays still.
      }
    },
  };
}

interface CapacitorGlobal {
  Capacitor?: { isNativePlatform?: () => boolean };
}

/** The page's own haptics: the apps' plugin, the Vibration API, or nothing. */
export function createPageHaptics(): Haptics {
  const nav = typeof navigator === 'undefined' ? null : (navigator as { vibrate?: (p: number | number[]) => boolean });
  const vibrate = nav && typeof nav.vibrate === 'function' ? nav.vibrate.bind(nav) : null;
  return createHaptics({
    native: () => {
      try {
        return (globalThis as CapacitorGlobal).Capacitor?.isNativePlatform?.() === true;
      } catch {
        return false;
      }
    },
    vibrate,
    // The plugin is a Proxy that answers every property, `then` included, so it is never the
    // value a promise resolves with: plain wrappers go back instead (see src/game/storage.ts).
    async loadNative() {
      const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics');
      return {
        lightTap: () => Haptics.impact({ style: ImpactStyle.Light }),
        success: () => Haptics.notification({ type: NotificationType.Success }),
      };
    },
    enabled: hapticsEnabled,
    now: () => (typeof performance === 'undefined' ? Date.now() : performance.now()),
    later: (fn, ms) => {
      setTimeout(fn, ms);
    },
  });
}

/**
 * The Haptics switch for Settings, Display: one row, a checkbox and its label, the same shape
 * as the rows beside it.
 */
export function createHapticsRow(): HTMLElement {
  const field = document.createElement('div');
  field.className = 'hs-field';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.id = 'hs-haptics';
  box.checked = hapticsEnabled();
  box.addEventListener('change', () => setHapticsEnabled(box.checked));
  const label = document.createElement('label');
  label.className = 'hs-row-label';
  label.textContent = 'Haptics';
  label.htmlFor = box.id;
  field.append(box, label);
  return field;
}
