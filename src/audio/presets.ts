// Listening presets, dev only. main.ts imports this module only under import.meta.env.DEV, for
// ?audio=<preset> (hear it live after the first pointer or key press) and ?audio=<preset>&render=<s>
// (render it offline to a WAV on window.__audioSample for scripts/render-audio-samples.mjs).
import type { WeatherKind } from '../game/weather';
import type { Chapter } from './score';
import { SOUND_KEY, setSoundDevHook, type AudioContextLike, type GestureTarget, type PinnedInputs, type Sound, type SoundStore } from './audio';
import { encodeWav, toBase64 } from './wav';

export interface Preset {
  minuteOfDay: number;
  isWeekend: boolean;
  venueFill: number;
  weather: WeatherKind;
  intensity: number;
  chapter: Chapter;
  /** Tension held for this many seconds from the start, then released to 0. */
  tensionSeconds?: number;
  /** Offline renders only: a car.arrive every this many ms, alternating four shafts. */
  arrivalsEveryMs?: number;
}

export const PRESETS = {
  'empty-foundations': { minuteOfDay: 8 * 60 + 30, isWeekend: false, venueFill: 0, weather: 'clear', intensity: 1, chapter: 1 },
  'sunny-morning-1star': { minuteOfDay: 8 * 60 + 30, isWeekend: false, venueFill: 0.3, weather: 'clear', intensity: 1, chapter: 1 },
  'rainy-tuesday-5star': { minuteOfDay: 10 * 60, isWeekend: false, venueFill: 0.2, weather: 'rain', intensity: 0.8, chapter: 5 },
  'weekend-night-5star': { minuteOfDay: 21 * 60 + 30, isWeekend: true, venueFill: 1, weather: 'clear', intensity: 1, chapter: 5 },
  'storm-night-tower': { minuteOfDay: 23 * 60 + 30, isWeekend: false, venueFill: 0.5, weather: 'storm', intensity: 0.9, chapter: 6 },
  'fire-3star': { minuteOfDay: 14 * 60, isWeekend: false, venueFill: 0.4, weather: 'clear', intensity: 1, chapter: 3, tensionSeconds: 20 },
  'rush-hour-3star': { minuteOfDay: 8 * 60 + 30, isWeekend: false, venueFill: 0.6, weather: 'clear', intensity: 1, chapter: 3, arrivalsEveryMs: 700 },
} as const satisfies Record<string, Preset>;

export type PresetName = keyof typeof PRESETS;
export const PRESET_NAMES = Object.keys(PRESETS) as PresetName[];

export function isPreset(name: string): name is PresetName {
  return Object.prototype.hasOwnProperty.call(PRESETS, name);
}

/** The inputs a preset pins, `elapsedSeconds` into listening. */
export function presetInputs(name: PresetName, elapsedSeconds: number): PinnedInputs {
  const p: Preset = PRESETS[name];
  return {
    minuteOfDay: p.minuteOfDay,
    isWeekend: p.isWeekend,
    venueFill: p.venueFill,
    weather: { kind: p.weather, from: p.weather, blend: 1, intensity: p.intensity },
    tension: p.tensionSeconds !== undefined && elapsedSeconds < p.tensionSeconds ? 1 : 0,
    chapter: p.chapter,
  };
}

export type DevSound = Sound & { setDevPreset(name: string): boolean };

/** Adds setDevPreset to the controller. An unknown name changes nothing and returns false. */
export function withDevPresets(sound: Sound): DevSound {
  const dev = sound as DevSound;
  dev.setDevPreset = (name: string): boolean => {
    if (!isPreset(name) || !sound.pin) return false;
    sound.pin((elapsed) => presetInputs(name, elapsed));
    return true;
  };
  return dev;
}

/** The saved settings with the master switch read as on; writes to it are dropped for this load. */
export function sessionOnStore(real: SoundStore | null): SoundStore {
  return {
    getItem: (key) => (key === SOUND_KEY ? 'true' : (real?.getItem(key) ?? null)),
    setItem: (key, value) => {
      if (key !== SOUND_KEY) real?.setItem(key, value);
    },
  };
}

function localStore(): SoundStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Arms the next sound controller (the one the ui creates) with the preset. Returns false and
 * arms nothing for an unknown name. With `render` a positive number of seconds, the controller
 * gets an OfflineAudioContext instead and the result lands on window.__audioSample.
 */
export function armDevAudio(name: string, render: string | null): boolean {
  // "<preset>:quiet" renders the preset without its elevator arrivals, as a level reference.
  const quiet = name.endsWith(':quiet');
  if (quiet) name = name.slice(0, -':quiet'.length);
  if (!isPreset(name)) return false;
  const seconds = render === null ? NaN : Number(render);
  if (Number.isFinite(seconds) && seconds > 0) armRender(name, seconds, quiet);
  else setSoundDevHook({ deps: { store: sessionOnStore(localStore()) }, created: (sound) => void withDevPresets(sound).setDevPreset(name) });
  return true;
}

export const RENDER_RATE = 44100;
const STEP_SECONDS = 0.5;
/** Finer render steps when a preset fires arrivals, so each lands on its own time. */
const EVENT_STEP_SECONDS = 0.1;

interface RenderWindow { __audioSample?: string; __audioSampleError?: string }

function armRender(name: PresetName, seconds: number, quiet = false): void {
  const p: Preset = PRESETS[name];
  const every = quiet ? undefined : p.arrivalsEveryMs;
  const step = p.arrivalsEveryMs ? EVENT_STEP_SECONDS : STEP_SECONDS;
  const w = window as unknown as RenderWindow;
  const offline = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(seconds * RENDER_RATE), sampleRate: RENDER_RATE });
  const timers: Array<() => void> = [];
  const gestures: Array<() => void> = [];
  const target: GestureTarget = {
    addEventListener: (_type, fn) => void gestures.push(fn),
    removeEventListener: () => {},
  };
  setSoundDevHook({
    deps: {
      store: sessionOnStore(localStore()),
      createContext: () => offline as unknown as AudioContextLike,
      target,
      now: () => offline.currentTime * 1000,
      // The controller's timers run on the render clock: every half second of audio, all of them.
      setInterval: (fn) => timers.push(fn),
      clearInterval: () => {},
    },
    created: (sound) => {
      setSoundDevHook(null);
      withDevPresets(sound).setDevPreset(name);
      for (const fire of gestures) fire();
      if (!sound.hasContext) { w.__audioSampleError = 'The controller did not build its context.'; return; }
      void (async () => {
        try {
          let arrival = 0;
          const steps = Math.floor(seconds / step - 1e-9);
          for (let i = 1; i <= steps; i += 1) {
            const t = Math.round(i * step * 1000) / 1000;
            void offline.suspend(t).then(() => {
              for (const tick of timers) tick();
              if (every && Math.round(t * 1000) % every === 0) {
                sound.devEvent?.({ kind: 'car.arrive', shaftId: arrival % 4, carId: arrival });
                arrival += 1;
              }
              void offline.resume();
            });
          }
          const buffer = await offline.startRendering();
          const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
          w.__audioSample = toBase64(encodeWav(channels, buffer.sampleRate));
        } catch (e) {
          w.__audioSampleError = String((e as { message?: unknown })?.message ?? e);
        }
      })();
    },
  });
}
