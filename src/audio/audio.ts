// Sound: a Web Audio synthesizer with no audio files. Short effects answer the game's event
// stream; an ambient bed follows the clock. Off by default, and while it is off nothing is
// created: no AudioContext, no listeners on the game.
import type { GameApi, GameEvent } from '../game/api';

export const SOUND_KEY = 'hs.sound';
export const SOUND_EFFECTS_KEY = 'hs.sound.effects';
export const SOUND_AMBIENT_KEY = 'hs.sound.ambient';

export interface SoundSettings {
  on: boolean;
  effects: number; // 0..100
  ambient: number; // 0..100
}

export const DEFAULT_SOUND: Readonly<SoundSettings> = { on: false, effects: 70, ambient: 50 };

export interface SoundStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStore(): SoundStore | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null; // a blocked store: the settings last for this session only
  }
}

function readLevel(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? clampLevel(n) : fallback;
}

export function clampLevel(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n)));
}

export function readSoundSettings(store: SoundStore | null = browserStore()): SoundSettings {
  if (!store) return { ...DEFAULT_SOUND };
  try {
    return {
      on: store.getItem(SOUND_KEY) === 'true',
      effects: readLevel(store.getItem(SOUND_EFFECTS_KEY), DEFAULT_SOUND.effects),
      ambient: readLevel(store.getItem(SOUND_AMBIENT_KEY), DEFAULT_SOUND.ambient),
    };
  } catch {
    return { ...DEFAULT_SOUND };
  }
}

export function writeSoundSettings(settings: SoundSettings, store: SoundStore | null = browserStore()): void {
  if (!store) return;
  try {
    store.setItem(SOUND_KEY, settings.on ? 'true' : 'false');
    store.setItem(SOUND_EFFECTS_KEY, String(clampLevel(settings.effects)));
    store.setItem(SOUND_AMBIENT_KEY, String(clampLevel(settings.ambient)));
  } catch {
    // Nothing to do: the settings last for this session only.
  }
}

// ------------------------------------------------------------------- synth

/** The part of an AudioContext the synth uses, so a test can hand it a stub. */
export type AudioContextLike = Pick<
  AudioContext,
  | 'currentTime'
  | 'sampleRate'
  | 'destination'
  | 'state'
  | 'createOscillator'
  | 'createGain'
  | 'createBiquadFilter'
  | 'createBuffer'
  | 'createBufferSource'
  | 'resume'
  | 'suspend'
>;

export type Effect = 'chime' | 'door' | 'build' | 'register' | 'alert' | 'star';

/** Oscillators each effect schedules; the noise parts are buffer sources, not oscillators. */
export const EFFECT_OSCILLATORS: Readonly<Record<Effect, number>> = {
  chime: 2, // 660 then 880 Hz
  door: 0, // filtered noise only
  build: 1, // 40 Hz thump, plus a noise click
  register: 1, // the 1320 Hz bell, after three noise clicks
  alert: 2, // a 220 Hz triangle, twice
  star: 3, // C E G
};

/**
 * The shortest gap between two plays of one effect, in ms. A big tower opens a door somewhere
 * every frame; the chime marks the rhythm of the shafts, it does not count every car.
 */
export const EFFECT_MIN_GAP_MS: Readonly<Record<Effect, number>> = {
  chime: 700,
  door: 450,
  build: 60,
  register: 500,
  alert: 1200,
  star: 500,
};

const noiseCache = new WeakMap<object, AudioBuffer>();

/** One second of white noise per context, shared by every noise burst. */
function whiteNoise(ctx: AudioContextLike): AudioBuffer {
  let buffer = noiseCache.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, buffer);
  }
  return buffer;
}

/** A tone with a quick attack and an exponential fall to silence. */
function tone(ctx: AudioContextLike, out: AudioNode, type: OscillatorType, hz: number, at: number, dur: number, peak: number): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(hz, at);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.linearRampToValueAtTime(peak, at + Math.min(0.005, dur / 4));
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(env);
  env.connect(out);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

/** A burst of noise through a filter. */
function noise(ctx: AudioContextLike, out: AudioNode, filter: BiquadFilterType, hz: number, at: number, dur: number, peak: number): void {
  const src = ctx.createBufferSource();
  src.buffer = whiteNoise(ctx);
  const bq = ctx.createBiquadFilter();
  bq.type = filter;
  bq.frequency.setValueAtTime(hz, at);
  const env = ctx.createGain();
  env.gain.setValueAtTime(peak, at);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(bq);
  bq.connect(env);
  env.connect(out);
  src.start(at, Math.random() * 0.5);
  src.stop(at + dur + 0.02);
}

/** Schedule one effect on the context at time `at` (context seconds), into `out`. */
export function playEffect(ctx: AudioContextLike, out: AudioNode, effect: Effect, at: number = ctx.currentTime): void {
  switch (effect) {
    case 'chime':
      tone(ctx, out, 'sine', 660, at, 0.08, 0.5);
      tone(ctx, out, 'sine', 880, at + 0.08, 0.08, 0.5);
      return;
    case 'door':
      noise(ctx, out, 'bandpass', 900, at, 0.06, 0.35);
      return;
    case 'build':
      tone(ctx, out, 'sine', 40, at, 0.18, 0.9);
      noise(ctx, out, 'highpass', 2500, at, 0.015, 0.4);
      return;
    case 'register':
      for (let i = 0; i < 3; i += 1) noise(ctx, out, 'highpass', 3000, at + i * 0.05, 0.012, 0.45);
      tone(ctx, out, 'sine', 1320, at + 0.17, 0.4, 0.4);
      return;
    case 'alert':
      tone(ctx, out, 'triangle', 220, at, 0.15, 0.45);
      tone(ctx, out, 'triangle', 220, at + 0.25, 0.15, 0.45);
      return;
    case 'star':
      // C5 E5 G5
      [523.25, 659.25, 783.99].forEach((hz, i) => tone(ctx, out, 'sine', hz, at + i * 0.09, 0.09, 0.45));
      return;
  }
}

/** Which effect, if any, a game event sounds. */
export function effectFor(event: GameEvent): Effect | null {
  switch (event.kind) {
    case 'car.arrive':
      return 'chime';
    case 'car.doors':
      return 'door';
    case 'build':
      return 'build';
    case 'rentDay':
      return 'register';
    case 'stars':
      return event.to > event.from ? 'star' : 'alert';
    case 'log':
      return event.entry.level === 'alert' ? 'alert' : null;
  }
}

// ------------------------------------------------------------------ ambient

export const TRAFFIC_DB = -30;
export const CRICKETS_DB = -34;

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * How loud each bed is at this minute of the day, 0 to 1 before the dB and the slider.
 *
 * Traffic plays 07:00 to 19:00 and crickets 21:00 to 05:00. Each fades in over the game hour
 * before its window and out over the hour after it: traffic rises 06:00 to 07:00 and falls
 * 19:00 to 20:00, crickets rise 20:00 to 21:00 and fall 05:00 to 06:00.
 */
export function ambientMix(minuteOfDay: number): { traffic: number; crickets: number } {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  const h = m / 60;
  let traffic = 0;
  if (h >= 7 && h < 19) traffic = 1;
  else if (h >= 6 && h < 7) traffic = h - 6;
  else if (h >= 19 && h < 20) traffic = 20 - h;
  let crickets = 0;
  if (h >= 21 || h < 5) crickets = 1;
  else if (h >= 20 && h < 21) crickets = h - 20;
  else if (h >= 5 && h < 6) crickets = 6 - h;
  return { traffic, crickets };
}

interface AmbientBed {
  traffic: GainNode;
  crickets: GainNode;
  gate: GainNode;
  stop(): void;
}

/** Brown noise low passed at 300 Hz, and a 4 kHz sine pulsed at 12 Hz behind a random gate. */
function createBed(ctx: AudioContextLike, out: AudioNode): AmbientBed {
  const seconds = 4;
  const brown = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = brown.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i += 1) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    data[i] = last * 3.5;
  }
  const trafficSrc = ctx.createBufferSource();
  trafficSrc.buffer = brown;
  trafficSrc.loop = true;
  const low = ctx.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 300;
  const traffic = ctx.createGain();
  traffic.gain.value = 0;
  trafficSrc.connect(low);
  low.connect(traffic);
  traffic.connect(out);

  const chirp = ctx.createOscillator();
  chirp.type = 'sine';
  chirp.frequency.value = 4000;
  const pulse = ctx.createGain();
  pulse.gain.value = 0.5;
  const lfo = ctx.createOscillator();
  lfo.type = 'square';
  lfo.frequency.value = 12;
  const depth = ctx.createGain();
  depth.gain.value = 0.5;
  lfo.connect(depth);
  depth.connect(pulse.gain); // 0.5 +- 0.5: on and off twelve times a second
  const gate = ctx.createGain();
  gate.gain.value = 0;
  const crickets = ctx.createGain();
  crickets.gain.value = 0;
  chirp.connect(pulse);
  pulse.connect(gate);
  gate.connect(crickets);
  crickets.connect(out);

  const t = ctx.currentTime;
  trafficSrc.start(t);
  chirp.start(t);
  lfo.start(t);
  return {
    traffic,
    crickets,
    gate,
    stop() {
      trafficSrc.stop();
      chirp.stop();
      lfo.stop();
      traffic.disconnect();
      crickets.disconnect();
    },
  };
}

// --------------------------------------------------------------- controller

/** Where the first pointer or key press is heard. */
export interface GestureTarget {
  addEventListener(type: 'pointerdown' | 'keydown', fn: () => void, capture: boolean): void;
  removeEventListener(type: 'pointerdown' | 'keydown', fn: () => void, capture: boolean): void;
}

export interface SoundDeps {
  /** Builds the context. Default: the browser's AudioContext. Only called after a gesture with sound on. */
  createContext?: () => AudioContextLike;
  /** Where gestures are heard. Default: window. */
  target?: GestureTarget;
  store?: SoundStore | null;
  now?: () => number;
  /** Timer for the crickets' random gate. */
  setInterval?: (fn: () => void, ms: number) => number;
  clearInterval?: (id: number) => void;
}

export interface Sound {
  readonly settings: Readonly<SoundSettings>;
  /** True once an AudioContext exists; for the tests and the settings panel. */
  readonly hasContext: boolean;
  setEnabled(on: boolean): void;
  setEffects(level: number): void;
  setAmbient(level: number): void;
  destroy(): void;
}

function browserContext(): AudioContextLike {
  const g = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio is not available.');
  return new Ctor();
}

type SoundGame = Pick<GameApi, 'world' | 'subscribe' | 'subscribeEvents'>;

export function createSound(game: SoundGame, deps: SoundDeps = {}): Sound {
  const store = deps.store === undefined ? browserStore() : deps.store;
  const settings = readSoundSettings(store);
  const target: GestureTarget | null = deps.target ?? (typeof window !== 'undefined' ? window : null);
  const now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const every = deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms) as unknown as number);
  const stopEvery = deps.clearInterval ?? ((id: number) => clearInterval(id));
  const makeContext = deps.createContext ?? browserContext;

  let gestured = false;
  let ctx: AudioContextLike | null = null;
  let effectsBus: GainNode | null = null;
  let ambientBus: GainNode | null = null;
  let bed: AmbientBed | null = null;
  let gateTimer = 0;
  let unsubEvents: (() => void) | null = null;
  let unsubClock: (() => void) | null = null;
  let lastMinuteOfDay = -1;
  const lastPlayed = new Map<Effect, number>();

  const onGesture = (): void => {
    gestured = true;
    if (settings.on) wake();
  };
  target?.addEventListener('pointerdown', onGesture, true);
  target?.addEventListener('keydown', onGesture, true);

  function wake(): void {
    if (!gestured || !settings.on) return;
    if (!ctx) {
      try {
        ctx = makeContext();
      } catch {
        return; // no Web Audio in this browser: stay silent
      }
      effectsBus = ctx.createGain();
      effectsBus.gain.value = settings.effects / 100;
      effectsBus.connect(ctx.destination);
      ambientBus = ctx.createGain();
      ambientBus.gain.value = settings.ambient / 100;
      ambientBus.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    if (!unsubEvents) unsubEvents = game.subscribeEvents(onEvent);
    if (!unsubClock) unsubClock = game.subscribe(onClock);
    syncBed();
  }

  function sleep(): void {
    unsubEvents?.();
    unsubEvents = null;
    unsubClock?.();
    unsubClock = null;
    stopBed();
    if (ctx && ctx.state === 'running') void ctx.suspend().catch(() => {});
  }

  function onEvent(event: GameEvent): void {
    if (!ctx || !effectsBus || settings.effects <= 0) return;
    const effect = effectFor(event);
    if (!effect) return;
    const t = now();
    const prev = lastPlayed.get(effect);
    if (prev !== undefined && t - prev < EFFECT_MIN_GAP_MS[effect]) return;
    lastPlayed.set(effect, t);
    playEffect(ctx, effectsBus, effect);
  }

  function onClock(): void {
    const m = game.world.time.minute % 1440;
    if (m === lastMinuteOfDay) return;
    lastMinuteOfDay = m;
    applyMix(m);
  }

  function applyMix(minuteOfDay: number): void {
    if (!ctx || !bed) return;
    const mix = ambientMix(minuteOfDay);
    const t = ctx.currentTime;
    bed.traffic.gain.setTargetAtTime(mix.traffic * dbToGain(TRAFFIC_DB), t, 0.5);
    bed.crickets.gain.setTargetAtTime(mix.crickets * dbToGain(CRICKETS_DB), t, 0.5);
  }

  /** The bed exists only while sound is on and the ambient slider is above zero. */
  function syncBed(): void {
    if (!ctx || !ambientBus) return;
    if (settings.on && settings.ambient > 0) {
      if (!bed) {
        bed = createBed(ctx, ambientBus);
        lastMinuteOfDay = -1;
        onClock();
        // The crickets sing in bursts: a random gate, re-drawn every 400 ms.
        gateTimer = every(() => {
          if (!ctx || !bed) return;
          bed.gate.gain.setTargetAtTime(Math.random() < 0.6 ? 1 : 0, ctx.currentTime, 0.03);
        }, 400);
      }
    } else stopBed();
  }

  function stopBed(): void {
    if (gateTimer) stopEvery(gateTimer);
    gateTimer = 0;
    bed?.stop();
    bed = null;
  }

  const sound: Sound = {
    get settings() {
      return settings;
    },
    get hasContext() {
      return ctx !== null;
    },
    setEnabled(on) {
      settings.on = on;
      writeSoundSettings(settings, store);
      if (on) wake();
      else sleep();
    },
    setEffects(level) {
      settings.effects = clampLevel(level);
      writeSoundSettings(settings, store);
      if (ctx && effectsBus) effectsBus.gain.setTargetAtTime(settings.effects / 100, ctx.currentTime, 0.02);
    },
    setAmbient(level) {
      settings.ambient = clampLevel(level);
      writeSoundSettings(settings, store);
      if (ctx && ambientBus) ambientBus.gain.setTargetAtTime(settings.ambient / 100, ctx.currentTime, 0.05);
      if (settings.on) syncBed();
    },
    destroy() {
      target?.removeEventListener('pointerdown', onGesture, true);
      target?.removeEventListener('keydown', onGesture, true);
      sleep();
    },
  };
  return sound;
}
