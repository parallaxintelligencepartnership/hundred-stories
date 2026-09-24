// Sound: a Web Audio synthesizer with no audio files. Short effects answer the game's event
// stream; an ambient bed follows the clock. Off by default, and while it is off nothing is
// created: no AudioContext, no listeners on the game.
import type { GameApi, GameEvent } from '../game/api';
import { clockOf } from '../sim/types';
import { weatherAt } from '../game/weather';
import type { MoodInput } from './mood';
import { VOICES, chapterFor, cutoffForWarmth, isNight, hatVelocityMultiplier, keyFor, tempoFor, type Chapter, type Voice } from './score';
import { phraseFor, voicesFor, type Note } from './phrase';
import { activeLayers, easeMood, moodFor, venueFillFor, type Mood } from './mood';
import { drumHitsFor, playDrum } from './drums';
import { beatCue, cueDuration, type Cue } from './cues';

export const SOUND_KEY = 'hs.sound';
export const SOUND_EFFECTS_KEY = 'hs.sound.effects';
export const SOUND_AMBIENT_KEY = 'hs.sound.ambient';
export const SOUND_MUSIC_KEY = 'hs.sound.music';

export interface SoundSettings {
  on: boolean;
  effects: number; // 0..100
  ambient: number; // 0..100
  music?: number; // 0..100; optional for older Sound test doubles
}

export const DEFAULT_SOUND: Readonly<SoundSettings> = { on: false, effects: 70, ambient: 50, music: 60 };

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
      music: readLevel(store.getItem(SOUND_MUSIC_KEY), DEFAULT_SOUND.music!),
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
    store.setItem(SOUND_MUSIC_KEY, String(clampLevel(settings.music ?? DEFAULT_SOUND.music!)));
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
  | 'createDelay'
  | 'createDynamicsCompressor'
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
      tone(ctx, out, 'sine', 40, at, 0.18, 0.5);
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
    case 'beat':
      return null;
  }
}

// ------------------------------------------------------------------ ambient

export const TRAFFIC_DB = -30;
export const CRICKETS_DB = -34;

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export const REVERB_DELAY_SECONDS = 0.31;
export const REVERB_FEEDBACK = 0.35;
export const REVERB_CUTOFF_HZ = 3000;
export const REVERB_WET_DB = -12;
export const VINYL_MAX_DB = -30;

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

/** Brown traffic noise and quiet filtered-noise cricket rustle behind a random gate. */
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

  const chirp = ctx.createBufferSource();
  chirp.buffer = whiteNoise(ctx);
  chirp.loop = true;
  const chirpHigh = ctx.createBiquadFilter(); chirpHigh.type = 'highpass'; chirpHigh.frequency.value = 3000;
  const chirpLow = ctx.createBiquadFilter(); chirpLow.type = 'lowpass'; chirpLow.frequency.value = 7000;
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
  chirp.connect(chirpHigh); chirpHigh.connect(chirpLow); chirpLow.connect(pulse);
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
  setMusic?(level: number): void;
  readonly chapter?: Chapter;
  readonly tension?: boolean;
  readonly tensionLevel?: number;
  readonly weatherKind?: string;
  readonly tempo?: number;
  readonly filterHz?: number;
  readonly mood?: Mood;
  readonly activeVoices?: readonly Voice[];
  /**
   * Pins the mood inputs and the chapter over the live world until called with null. The source
   * gets the context seconds since the pin started counting (from the pin, or from the context's
   * creation when pinned before it). Listening presets use it; the game never does.
   */
  pin?(source: PinSource | null): void;
  destroy(): void;
}

/** Everything the score reads from the world, pinned for listening. */
export interface PinnedInputs extends MoodInput { chapter: Chapter }
export type PinSource = (elapsedSeconds: number) => PinnedInputs;

/**
 * A dev hook: deps and a creation callback applied to the next controllers. src/main.ts sets it
 * only under import.meta.env.DEV (?audio); in production nothing sets it and it stays null.
 */
export interface SoundDevHook {
  deps?: SoundDeps;
  created?(sound: Sound): void;
}
let devHook: SoundDevHook | null = null;
export function setSoundDevHook(hook: SoundDevHook | null): void {
  devHook = hook;
}

function browserContext(): AudioContextLike {
  const g = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio is not available.');
  return new Ctor();
}

type SoundGame = Pick<GameApi, 'world' | 'subscribe' | 'subscribeEvents'>;
type Threat = 'none' | 'theft' | 'fire' | 'bomb';
const threatLevel = (threat: Threat): number => threat === 'none' ? 0 : threat === 'theft' ? 0.5 : 1;
const urgent = (threat: Threat): boolean => threat === 'fire' || threat === 'bomb';

export function createSound(game: SoundGame, depsIn: SoundDeps = {}): Sound {
  const deps: SoundDeps = devHook?.deps ? { ...devHook.deps, ...depsIn } : depsIn;
  const store = deps.store === undefined ? browserStore() : deps.store;
  const settings = readSoundSettings(store);
  const target: GestureTarget | null = deps.target ?? (typeof window !== 'undefined' ? window : null);
  const now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const every = deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms) as unknown as number);
  const stopEvery = deps.clearInterval ?? ((id: number) => clearInterval(id));
  const makeContext = deps.createContext ?? browserContext;

  let gestured = false;
  let ctx: AudioContextLike | null = null;
  let master: GainNode | null = null;
  let musicBus: GainNode | null = null;
  let musicColour: BiquadFilterNode | null = null;
  let musicDust: BiquadFilterNode | null = null;
  let musicShelf: BiquadFilterNode | null = null;
  let musicCompressor: DynamicsCompressorNode | null = null;
  let musicMakeup: GainNode | null = null;
  let hatBus: GainNode | null = null;
  let drumsBus: GainNode | null = null;
  let vinylGain: GainNode | null = null;
  let vinylSource: AudioBufferSourceNode | null = null;
  let tapeLfo: OscillatorNode | null = null;
  let tapeDepth: GainNode | null = null;
  let effectsBus: GainNode | null = null;
  let ambientBus: GainNode | null = null;
  let bed: AmbientBed | null = null;
  let gateTimer = 0;
  let unsubEvents: (() => void) | null = null;
  let unsubClock: (() => void) | null = null;
  let lastMinuteOfDay = -1;
  const lastPlayed = new Map<Effect, number>();
  let highest: number = game.world.stars;
  let chapter = chapterFor(highest);
  const tempo = tempoFor(game.world.seed);
  const beatSeconds = 60 / tempo;
  const barSeconds = 4 * beatSeconds;
  const key = keyFor(game.world.seed);
  const initialClock = clockOf(game.world.time.minute);
  let targetMood = moodFor({ minuteOfDay: initialClock.minuteOfDay, isWeekend: initialClock.isWeekend,
    venueFill: venueFillFor(game.world.rooms?.values() ?? []), weather: weatherAt(game.world.seed, game.world.time.minute), tension: 0 });
  let easedMood: Mood = { ...targetMood };
  let lastMoodMs = now();
  const layerMix = new Map<Voice, number>();
  let activeVoices: Voice[] = [];
  let previousChapter: Chapter | null = null;
  let transitionAt = 0;
  let tension = false;
  let threat: Threat = 'none';
  let weatherKind = 'clear';
  let filterHz = 3200;
  let musicTimer = 0;
  let nextBar = 0;
  let nextBarIndex = 0;
  const musicFilters = new Map<BiquadFilterNode, number>();
  const scheduledMusic = new Set<AudioScheduledSourceNode>();
  const scheduledDrums = new Set<AudioScheduledSourceNode>();
  let lastBell = -Infinity;
  let lastThunder = -Infinity;
  let tensionOsc: OscillatorNode | null = null;
  let tensionGain: GainNode | null = null;
  let weatherLfo: OscillatorNode | null = null;
  let weatherGain: GainNode | null = null;
  let weatherSource: AudioBufferSourceNode | null = null;
  let pinned: PinSource | null = null;
  let pinnedAt: number | null = null;

  /** The score's inputs now: the pinned preset while one is set, else the live world. */
  function inputs(): { mood: MoodInput; minute: number } {
    if (pinned) {
      if (ctx && pinnedAt === null) pinnedAt = ctx.currentTime;
      const p = pinned(ctx && pinnedAt !== null ? Math.max(0, ctx.currentTime - pinnedAt) : 0);
      return { mood: { minuteOfDay: p.minuteOfDay, isWeekend: p.isWeekend, venueFill: p.venueFill, weather: p.weather, tension: p.tension }, minute: p.minuteOfDay };
    }
    const clock = clockOf(game.world.time.minute);
    return {
      mood: { minuteOfDay: clock.minuteOfDay, isWeekend: clock.isWeekend, venueFill: venueFillFor(game.world.rooms?.values() ?? []),
        weather: weatherAt(game.world.seed, game.world.time.minute), tension: threatLevel(threat) },
      minute: game.world.time.minute,
    };
  }

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
      master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
      musicBus = ctx.createGain(); musicBus.gain.value = (settings.music ?? 60) / 100;
      musicCompressor = ctx.createDynamicsCompressor();
      musicCompressor.threshold.value = -14; musicCompressor.knee.value = 6;
      musicCompressor.ratio.value = 4; musicCompressor.attack.value = 0.01;
      musicCompressor.release.value = 0.25;
      musicMakeup = ctx.createGain(); musicMakeup.gain.value = dbToGain(10);
      musicBus.connect(musicCompressor); musicCompressor.connect(musicMakeup); musicMakeup.connect(master);
      musicColour = ctx.createBiquadFilter(); musicColour.type = 'lowpass';
      musicColour.frequency.value = cutoffForWarmth(easedMood.warmth);
      musicDust = ctx.createBiquadFilter(); musicDust.type = 'lowpass'; musicDust.frequency.value = 7000;
      musicShelf = ctx.createBiquadFilter(); musicShelf.type = 'highshelf';
      musicShelf.frequency.value = 5000; musicShelf.gain.value = -6;
      musicColour.connect(musicDust); musicDust.connect(musicShelf); musicShelf.connect(musicBus);
      // Feedback delay keeps the score warm without a convolver or recorded impulse.
      const wet = ctx.createGain(); wet.gain.value = dbToGain(REVERB_WET_DB);
      const delay = ctx.createDelay(1); delay.delayTime.value = REVERB_DELAY_SECONDS;
      const low = ctx.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = REVERB_CUTOFF_HZ;
      const feedback = ctx.createGain(); feedback.gain.value = REVERB_FEEDBACK;
      musicBus.connect(wet); wet.connect(delay); delay.connect(low);
      low.connect(musicCompressor); low.connect(feedback); feedback.connect(delay);
      effectsBus = ctx.createGain();
      effectsBus.gain.value = settings.effects / 100;
      effectsBus.connect(master);
      ambientBus = ctx.createGain();
      ambientBus.gain.value = settings.ambient / 100 * dbToGain(-10);
      ambientBus.connect(master);
      hatBus = ctx.createGain(); hatBus.gain.value = 1; hatBus.connect(musicColour);
      drumsBus = ctx.createGain(); drumsBus.gain.value = 1; drumsBus.connect(musicColour);
      vinylGain = ctx.createGain(); vinylGain.gain.value = dbToGain(VINYL_MAX_DB - 2); vinylGain.connect(musicColour);
      tapeDepth = ctx.createGain(); tapeDepth.gain.value = 4;
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    lastMoodMs = now();
    if (master) master.gain.setValueAtTime(1, ctx.currentTime);
    musicBus?.gain.setValueAtTime((settings.music ?? 60) / 100 * dbToGain(-6 * easedMood.tension), ctx.currentTime);
    effectsBus?.gain.setValueAtTime(settings.effects / 100, ctx.currentTime);
    ambientBus?.gain.setValueAtTime(settings.ambient / 100 * dbToGain(-10), ctx.currentTime);
    startTexture();
    if (!unsubEvents) unsubEvents = game.subscribeEvents(onEvent);
    if (!unsubClock) unsubClock = game.subscribe(onClock);
    lastMinuteOfDay = -1;
    onClock();
    syncBed();
    syncWeather();
    syncMusic();
  }

  function startTexture(): void {
    if (!ctx || !vinylGain || !tapeDepth) return;
    if (!vinylSource) {
      const length = ctx.sampleRate * 2;
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let state = (game.world.seed ^ 0x35a1b2c3) >>> 0;
      for (let i = 0; i < data.length; i += 1) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        const hiss = ((state / 4294967296) * 2 - 1) * 0.18;
        data[i] = Math.max(-1, Math.min(1, hiss + (state % 10007 === 0 ? 0.65 : 0)));
      }
      const src = ctx.createBufferSource(); src.buffer = buffer; src.loop = true;
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 4200;
      src.connect(filter); filter.connect(vinylGain); src.start(); vinylSource = src;
    }
    if (!tapeLfo) {
      tapeLfo = ctx.createOscillator(); tapeLfo.type = 'sine'; tapeLfo.frequency.value = 0.3;
      tapeLfo.connect(tapeDepth); tapeLfo.start();
    }
  }

  function sleep(): void {
    unsubEvents?.();
    unsubEvents = null;
    unsubClock?.();
    unsubClock = null;
    stopBed();
    if (musicTimer) stopEvery(musicTimer);
    musicTimer = 0;
    for (const source of scheduledMusic) { try { source.stop(); } catch { /* already stopped */ } }
    scheduledMusic.clear(); musicFilters.clear();
    for (const source of scheduledDrums) { try { source.stop(); } catch { /* already stopped */ } }
    scheduledDrums.clear();
    if (vinylSource) { try { vinylSource.stop(); } catch { /* already stopped */ } }
    if (tapeLfo) { try { tapeLfo.stop(); } catch { /* already stopped */ } }
    vinylSource = null; tapeLfo = null;
    if (weatherSource) { try { weatherSource.stop(); } catch { /* already stopped */ } }
    if (weatherLfo) { try { weatherLfo.stop(); } catch { /* already stopped */ } }
    if (tensionOsc) { try { tensionOsc.stop(); } catch { /* already stopped */ } }
    weatherLfo = null; tensionOsc = null; tensionGain = null;
    weatherSource = null; weatherGain = null;
    if (ctx) {
      for (const bus of [musicBus, ambientBus, effectsBus, drumsBus, hatBus, master]) {
        if (!bus) continue;
        bus.gain.cancelScheduledValues(ctx.currentTime);
        bus.gain.setValueAtTime(0, ctx.currentTime);
      }
    }
    if (ctx && ctx.state === 'running') void ctx.suspend().catch(() => {});
  }

  function onEvent(event: GameEvent): void {
    if (!ctx || !effectsBus) return;
    if (event.kind === 'stars') {
      if (event.to > event.from) {
        highest = Math.max(highest, event.to);
        const next = chapterFor(highest);
        const stinger: Cue = event.to >= 6 ? 'tower' : (`star${Math.max(2, Math.min(5, event.to))}` as Cue);
        playNamedCue(stinger);
        if (next !== chapter && !pinned) {
          previousChapter = chapter; chapter = next;
          transitionAt = Math.ceil((ctx.currentTime + (next === 6 ? cueDuration(stinger) : 0)) / barSeconds) * barSeconds;
        }
      }
      return;
    }
    if (event.kind === 'beat') {
      const name = beatCue(event.beat.code, event.beat.value);
      if (name === 'fire.start' || name === 'bomb.start') {
        startThreat(name === 'fire.start' ? 'fire' : 'bomb', name);
        return;
      }
      if (name === 'theft.start') {
        if (!urgent(threat)) startThreat('theft', name);
        return;
      }
      if (name === 'guard.dispatch') {
        if (!urgent(threat)) playNamedCue(name);
        return;
      }
      if (name === 'release.up' || name === 'release.down') {
        const code = event.beat.code;
        if ((code === 'theft.caught' || code === 'theft.escaped') && threat !== 'theft') return;
        if (code === 'fire.resolved' && threat !== 'fire') return;
        if ((code === 'bomb.resolved' || code === 'bomb.failed') && threat !== 'bomb') return;
        endThreat(name);
        return;
      }
      if (!tension && name) playNamedCue(name);
      return;
    }
    if (tension) return;
    if (event.kind === 'car.arrive' || event.kind === 'car.doors') {
      if (now() - lastBell < 400) return;
      lastBell = now();
      playNamedCue(event.kind === 'car.arrive' ? (`bell${Math.abs(event.shaftId) % 4}` as Cue) : 'door');
      return;
    }
    if (settings.effects <= 0) return;
    const effect = effectFor(event);
    if (!effect) return;
    const t = now();
    const prev = lastPlayed.get(effect);
    if (prev !== undefined && t - prev < EFFECT_MIN_GAP_MS[effect]) return;
    lastPlayed.set(effect, t);
    playEffect(ctx, effectsBus, effect);
  }

  function startThreat(next: Threat, cue: Cue): void {
    if (!ctx) return;
    if (threat === next) return;
    const level = threatLevel(next);
    threat = next; tension = true; targetMood = { ...targetMood, tension: level };
    playNamedCue(cue);
    const kitLevel = urgent(next) ? 0 : 0.7;
    hatBus?.gain.setValueAtTime(kitLevel, ctx.currentTime);
    drumsBus?.gain.setValueAtTime(urgent(next) ? 0 : 0.775, ctx.currentTime);
    musicBus?.gain.setTargetAtTime((settings.music ?? 60) / 100 * dbToGain(-6 * level), ctx.currentTime, 0.1);
    if (tensionOsc) { try { tensionOsc.stop(); } catch { /* already stopped */ } tensionOsc = null; }
    if (musicBus) {
      tensionOsc = ctx.createOscillator(); tensionOsc.type = 'sine';
      tensionOsc.frequency.value = next === 'fire' ? 110 : next === 'bomb' ? 55 : 93;
      tensionGain = ctx.createGain(); tensionGain.gain.value = next === 'theft' ? 0.014 : 0.025;
      tensionOsc.connect(tensionGain); tensionGain.connect(musicBus); tensionOsc.start();
    }
  }

  function endThreat(cue: Cue): void {
    if (!ctx) return;
    threat = 'none'; tension = false; targetMood = { ...targetMood, tension: 0 };
    playNamedCue(cue);
    if (tensionGain) tensionGain.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    if (tensionOsc) { tensionOsc.stop(ctx.currentTime + 1); tensionOsc = null; tensionGain = null; }
  }

  function playNamedCue(name: Cue): void {
    if (!ctx || !effectsBus || settings.effects <= 0) return;
    if (name === 'theft.start') {
      // Three off-beat low notes, the last a short muted stab; no siren rise or bomb pulse.
      const at = ctx.currentTime;
      tone(ctx, effectsBus, 'triangle', 146.83, at + 0.07, 0.13, 0.18);
      tone(ctx, effectsBus, 'triangle', 123.47, at + 0.37, 0.14, 0.16);
      tone(ctx, effectsBus, 'square', 185, at + 0.73, 0.08, 0.22);
      return;
    }
    if (name === 'guard.dispatch') {
      const at = ctx.currentTime;
      tone(ctx, effectsBus, 'sine', 784, at, 0.07, 0.16);
      tone(ctx, effectsBus, 'sine', 988, at + 0.13, 0.07, 0.16);
      return;
    }
    const bells = [[660, 880], [587, 784], [698, 932], [523, 698]];
    const notes: Record<string, number[]> = {
      'fire.start': [220, 262], 'bomb.start': [82, 82, 82], 'release.up': [330, 440], 'release.down': [330, 247],
      'vip.notice': [392, 523], 'vip.arrival': [392, 523, 659], 'vip.poor': [440, 330], 'vip.fair': [392, 392], 'vip.good': [330, 440],
      star2: [523, 659], star3: [523, 659, 784], star4: [523, 659, 784, 1047], star5: [523, 659, 784, 1047, 1318],
      tower: [261, 329, 392, 440, 523, 659, 784, 1047, 784, 1047, 1318, 1047],
    };
    if (name === 'door' || name === 'build' || name === 'register') { playEffect(ctx, effectsBus, name); return; }
    const line = name.startsWith('bell') ? bells[Number(name.slice(-1))]! : notes[name] ?? [];
    const duration = cueDuration(name);
    line.forEach((hz, i) => tone(ctx!, effectsBus!, name === 'fire.start' ? 'triangle' : 'sine', hz, ctx!.currentTime + i * duration / line.length, Math.min(0.45, duration / line.length), 0.32));
  }

  function onClock(): void {
    const m = ((inputs().minute % 1440) + 1440) % 1440;
    if (m === lastMinuteOfDay) return;
    lastMinuteOfDay = m;
    applyMix(m);
    applyMoodSound();
    syncWeather();
  }

  function targetForBar(): void {
    targetMood = moodFor(inputs().mood);
  }

  function advanceMood(): void {
    const current = now();
    easedMood = easeMood(easedMood, targetMood, (current - lastMoodMs) / 1000);
    lastMoodMs = current;
    applyMoodSound();
  }

  function applyMoodSound(): void {
    if (!ctx) return;
    filterHz = cutoffForWarmth(easedMood.warmth);
    musicColour?.frequency.setTargetAtTime(filterHz, ctx.currentTime, 0.15);
    const kitStopped = urgent(threat) || easedMood.tension >= 0.8;
    const minute = inputs().minute;
    hatBus?.gain.setTargetAtTime(kitStopped || isNight(minute) ? 0 : hatVelocityMultiplier(minute) * (1 - 0.6 * easedMood.tension), ctx.currentTime, 0.08);
    drumsBus?.gain.setTargetAtTime(kitStopped ? 0 : 1 - 0.45 * easedMood.tension, ctx.currentTime, 0.08);
    musicBus?.gain.setTargetAtTime((settings.music ?? 60) / 100 * dbToGain(-6 * easedMood.tension), ctx.currentTime, 0.1);
    for (const [filter, cutoff] of musicFilters) filter.frequency.setTargetAtTime(Math.min(cutoff, filterHz), ctx.currentTime, 0.15);
  }

  function playScoreNote(voice: Voice, note: Note, when: number, fade: number): void {
    if (!ctx || !musicColour) return;
    const c = ctx;
    const def = VOICES[voice];
    const duration = Math.max(def.attack + 0.02, Math.min(def.release, note.dur * beatSeconds));
    const peak = Math.max(0.0002, def.peak * note.vel * fade);
    const osc = c.createOscillator(); osc.type = def.wave;
    osc.frequency.setValueAtTime(note.freq, when);
    if (def.detune) osc.detune.setValueAtTime(def.detune, when);
    if ((voice === 'piano' || voice === 'pluck' || voice === 'guitar') && tapeDepth) tapeDepth.connect(osc.detune);
    const filter = c.createBiquadFilter(); filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(def.cutoff, filterHz), when);
    musicFilters.set(filter, def.cutoff);
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, when);
    env.gain.linearRampToValueAtTime(peak, when + Math.min(def.attack, duration * 0.5));
    env.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    osc.connect(filter); filter.connect(env); env.connect(voice === 'hat' && hatBus ? hatBus : musicColour);
    osc.start(when); osc.stop(when + duration + 0.02);
    scheduledMusic.add(osc);
    osc.onended = () => {
      scheduledMusic.delete(osc); musicFilters.delete(filter);
      if ((voice === 'piano' || voice === 'pluck' || voice === 'guitar') && tapeDepth) tapeDepth.disconnect(osc.detune);
      osc.disconnect(); filter.disconnect(); env.disconnect();
    };
    if (voice === 'piano') {
      const chorus = c.createOscillator(); chorus.type = 'triangle';
      chorus.frequency.setValueAtTime(note.freq, when); chorus.detune.setValueAtTime(4, when);
      if (tapeDepth) tapeDepth.connect(chorus.detune);
      const soft = c.createGain(); soft.gain.value = 0.12;
      chorus.connect(soft); soft.connect(filter); chorus.start(when); chorus.stop(when + duration + 0.02);
      scheduledMusic.add(chorus);
      chorus.onended = () => { scheduledMusic.delete(chorus); tapeDepth?.disconnect(chorus.detune); chorus.disconnect(); soft.disconnect(); };
    }
    if (def.tremolo) {
      const lfo = c.createOscillator(); lfo.type = 'sine'; lfo.frequency.setValueAtTime(def.tremolo, when);
      const depth = c.createGain(); depth.gain.value = peak * 0.12;
      lfo.connect(depth); depth.connect(env.gain); lfo.start(when); lfo.stop(when + duration + 0.02);
      scheduledMusic.add(lfo);
      lfo.onended = () => { scheduledMusic.delete(lfo); lfo.disconnect(); depth.disconnect(); };
    }
  }

  function syncMusic(): void {
    if (!ctx || !musicBus || musicTimer) return;
    nextBar = Math.ceil(ctx.currentTime / barSeconds) * barSeconds;
    nextBarIndex = 0;
    const schedule = () => {
      if (!ctx || !musicBus || !settings.on) return;
      advanceMood();
      while (nextBar < ctx.currentTime + 4) {
        const at = nextBar; nextBar += barSeconds;
        targetForBar(); // venue occupancy is read only here, once per musical bar
        const barIndex = nextBarIndex++;
        const phraseIndex = Math.floor(barIndex / 8);
        const barInPhrase = barIndex % 8;
        const heard = inputs();
        const night = isNight(heard.minute);
        const weekend = heard.mood.isWeekend;
        const chapters = previousChapter && at >= transitionAt && at < transitionAt + 3 ? [previousChapter, chapter] : [at < transitionAt && previousChapter ? previousChapter : chapter];
        const available = new Set<Voice>(chapters.flatMap(playing => voicesFor(playing, weekend)));
        const wanted = new Set<Voice>(chapters.flatMap(playing => activeLayers(playing, easedMood.energy, easedMood.tension, weekend, phraseIndex)));
        const layers = new Map<Voice, { from: number; to: number }>();
        for (const voice of new Set<Voice>([...available, ...layerMix.keys()])) {
          const from = layerMix.get(voice) ?? 0;
          const to = Math.max(0, Math.min(1, from + (wanted.has(voice) ? 0.5 : -0.5)));
          layerMix.set(voice, to);
          layers.set(voice, { from, to });
        }
        activeVoices = [...available].filter(voice => (layers.get(voice)?.to ?? 0) > 0);
        const density = 0.4 + 0.6 * easedMood.energy;
        for (const playing of chapters) {
          for (const voice of voicesFor(playing, weekend)) {
            if (voice === 'drums' || voice === 'hat') continue;
            const layer = layers.get(voice);
            if (!layer || layer.from === 0 && layer.to === 0) continue;
            const phrase = phraseFor(game.world.seed, playing, phraseIndex, voice,
              { density, key, warmth: easedMood.warmth, tension: easedMood.tension, energy: easedMood.energy, night });
            for (const note of phrase) {
              if (note.beat < barInPhrase * 4 || note.beat >= (barInPhrase + 1) * 4) continue;
              const within = note.beat - barInPhrase * 4;
              const when = at + within * beatSeconds;
              const fade = previousChapter && when >= transitionAt && when < transitionAt + 3
                ? playing === chapter ? (when - transitionAt) / 3 : 1 - (when - transitionAt) / 3 : 1;
              const layerFade = layer.from + (layer.to - layer.from) * within / 4;
              if (layerFade > 0 && voice === 'kinetic' && hatBus) {
                const sources = playDrum(ctx, hatBus, { kind: 'kinetic', beat: within, lateSeconds: 0, velocity: note.vel * fade * layerFade }, when);
                for (const source of sources) {
                  scheduledMusic.add(source);
                  source.onended = () => scheduledMusic.delete(source);
                }
              } else if (layerFade > 0) playScoreNote(voice, note, when, fade * layerFade);
            }
          }
        }
        if (!urgent(threat) && easedMood.tension < 0.8) {
          const drumLayer = layers.get('drums');
          const hatLayer = layers.get('hat') ?? (chapter === 5 ? drumLayer : undefined);
          if (drumsBus && hatBus && ctx && (drumLayer?.to || hatLayer?.to)) {
            for (const hit of drumHitsFor(game.world.seed, phraseIndex, barIndex, Math.max(0.15, easedMood.energy))) {
              if (easedMood.tension >= 0.3 && (hit.kind === 'ghost' || hit.kind === 'open')) continue;
              const layer = hit.kind === 'kick' || hit.kind === 'snare' ? drumLayer : hatLayer;
              if (!layer) continue;
              const fade = layer.from + (layer.to - layer.from) * hit.beat / 4;
              if (fade <= 0) continue;
              const out = hit.kind === 'kick' || hit.kind === 'snare' ? drumsBus : hatBus;
              const when = at + hit.beat * beatSeconds + hit.lateSeconds;
              const sources = playDrum(ctx, out, { ...hit, velocity: hit.velocity * fade }, when);
              for (const source of sources) {
                scheduledDrums.add(source);
                source.onended = () => scheduledDrums.delete(source);
              }
            }
          }
        }
        if (previousChapter && at >= transitionAt + 3) previousChapter = null;
      }
    };
    schedule(); musicTimer = every(schedule, 500);
  }

  function syncWeather(): void {
    if (!ctx || !ambientBus) return;
    const snapshot = inputs().mood.weather;
    if (snapshot.kind !== weatherKind) {
      weatherKind = snapshot.kind;
      if (weatherGain) weatherGain.gain.setTargetAtTime(0, ctx.currentTime, 1);
      if (weatherSource) { try { weatherSource.stop(ctx.currentTime + 4); } catch { /* stopped */ } }
      if (weatherLfo) { try { weatherLfo.stop(ctx.currentTime + 4); } catch { /* stopped */ } }
      weatherLfo = null;
      weatherGain = null; weatherSource = null;
      if (weatherKind !== 'clear') {
        const src = ctx.createBufferSource(); src.buffer = whiteNoise(ctx); src.loop = true;
        const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = weatherKind === 'overcast' ? 280 : 1800;
        const gain = ctx.createGain(); gain.gain.setValueAtTime(0, ctx.currentTime); gain.gain.linearRampToValueAtTime(dbToGain(weatherKind === 'overcast' ? -30 : -22) * snapshot.intensity, ctx.currentTime + 4);
        src.connect(filter); filter.connect(gain); gain.connect(ambientBus); src.start(); weatherSource = src; weatherGain = gain;
        if (weatherKind === 'rain' || weatherKind === 'storm') {
          const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.15;
          const depth = ctx.createGain(); depth.gain.value = dbToGain(-30) * snapshot.intensity;
          lfo.connect(depth); depth.connect(gain.gain); lfo.start(); weatherLfo = lfo;
        }
      }
    }
    if (weatherKind === 'storm' && !(typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) && now() - lastThunder >= 20000) {
      lastThunder = now(); noise(ctx, ambientBus, 'lowpass', 80, ctx.currentTime, 1.3, dbToGain(-24));
    }
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
      if (on) { if (ctx && master) master.gain.setValueAtTime(1, ctx.currentTime); wake(); }
      else sleep();
    },
    setEffects(level) {
      settings.effects = clampLevel(level);
      writeSoundSettings(settings, store);
      if (ctx && effectsBus) effectsBus.gain.setTargetAtTime(settings.effects / 100, ctx.currentTime, 0.02);
    },
    setMusic(level) {
      settings.music = clampLevel(level);
      writeSoundSettings(settings, store);
      if (ctx && musicBus) musicBus.gain.setTargetAtTime((settings.music ?? 60) / 100 * dbToGain(-6 * easedMood.tension), ctx.currentTime, 0.05);
    },
    get chapter() { return chapter; },
    get tension() { return tension; },
    get tensionLevel() { return threatLevel(threat); },
    get weatherKind() { return weatherKind; },
    get tempo() { return tempo; },
    get filterHz() { return filterHz; },
    get mood() { return { ...easedMood }; },
    get activeVoices() { return [...activeVoices]; },
    pin(source) {
      pinned = source;
      pinnedAt = ctx ? ctx.currentTime : null;
      if (source) chapter = source(0).chapter;
      else chapter = chapterFor(highest);
      previousChapter = null;
      // A listening preset is heard at once: the mood snaps to it rather than easing over minutes.
      targetForBar();
      easedMood = { ...targetMood };
      lastMoodMs = now();
      lastMinuteOfDay = -1;
      if (ctx) { onClock(); syncMusic(); }
    },
    setAmbient(level) {
      settings.ambient = clampLevel(level);
      writeSoundSettings(settings, store);
      if (ctx && ambientBus) ambientBus.gain.setTargetAtTime(settings.ambient / 100 * dbToGain(-10), ctx.currentTime, 0.05);
      if (settings.on) syncBed();
    },
    destroy() {
      target?.removeEventListener('pointerdown', onGesture, true);
      target?.removeEventListener('keydown', onGesture, true);
      sleep();
    },
  };
  devHook?.created?.(sound);
  return sound;
}
