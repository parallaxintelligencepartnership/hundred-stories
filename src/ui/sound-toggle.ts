// The round Sound button on the game view, beside Watch (Matt, 2026-09-27: "a sound toggle button
// ... like you did for the watch button"). It turns the same setting the Settings switch does,
// through the sound module, so a tap on it wakes or sleeps the engine exactly as the switch
// would; on iOS the tap's own press is the gesture the engine waits for (audio.ts hears every
// pointerdown on the window before the click lands here). Both controls go through setSoundOn,
// which announces PREF_KEYS.sound, and each follows the other through onPrefChange. Watch mode
// hides it with the rest of the chrome (ui.css).

import type { Sound } from '../audio/audio';
import { icon } from './icons';
import { PREF_KEYS, announcePref, onPrefChange } from './prefs';

/** The Sound button's tooltip. Static, like the Watch button's: the icon says which way it is. */
export const SOUND_TIP = 'Sound on or off. The music, sound effects and background levels are in Settings.';

/** Turn sound on or off, and tell every control that shows it (the button, the Settings switch). */
export function setSoundOn(sound: Sound, on: boolean): void {
  sound.setEnabled(on);
  announcePref(PREF_KEYS.sound);
}

export interface SoundToggle {
  /** The round Sound button, beside Watch. aria-pressed says whether sound is on. */
  button: HTMLButtonElement;
  destroy(): void;
}

export function createSoundToggle(sound: Sound): SoundToggle {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hs-icon-btn hs-round hs-sound-btn';
  const label = document.createElement('span');
  label.className = 'hs-btn-label';
  label.textContent = 'Sound';
  button.setAttribute('aria-label', 'Sound');
  button.title = SOUND_TIP;
  let shown: boolean | null = null;
  const paint = (): void => {
    const on = sound.settings.on;
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on === shown) return;
    shown = on;
    button.replaceChildren(icon(on ? 'sound' : 'mute', 'hs-icon hs-btn-icon') as unknown as HTMLElement, label);
  };
  paint();
  button.addEventListener('click', () => setSoundOn(sound, !sound.settings.on));
  const stop = onPrefChange((key) => {
    if (key === PREF_KEYS.sound) paint();
  });
  return { button, destroy: stop };
}
