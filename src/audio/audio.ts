// Sound: a Web Audio synthesizer with no audio files. Short effects answer the game's event
// stream; an ambient bed follows the clock. Off by default, and while it is off nothing is
// created: no AudioContext, no listeners on the game.
import type { GameApi, GameEvent } from '../game/api';
import { clockOf } from '../sim/types';
import { weatherAt } from '../game/weather';
import { BAR_SECONDS, BEAT_SECONDS, TEMPO, VOICES, chapterFor, isNight, hatVelocityMultiplier, type Chapter, type Voice } from './score';
import { phraseFor, voicesFor, type Note } from './phrase';
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
  setMusic?(level: number): void;
  readonly chapter?: Chapter;
  readonly tension?: boolean;
  readonly weatherKind?: string;
  readonly tempo?: number;
  readonly filterHz?: number;
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
  let master: GainNode | null = null;
  let musicBus: GainNode | null = null;
  let musicColour: BiquadFilterNode | null = null;
  let hatBus: GainNode | null = null;
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
  let previousChapter: Chapter | null = null;
  let transitionAt = 0;
  let tension = false;
  let weatherKind = 'clear';
  let filterHz = 3200;
  let musicTimer = 0;
  let nextBar = 0;
  let nextBarIndex = 0;
  const musicFilters = new Map<BiquadFilterNode, number>();
  const scheduledMusic = new Set<OscillatorNode>();
  let lastBell = -Infinity;
  let lastThunder = -Infinity;
  let tensionOsc: OscillatorNode | null = null;
  let tensionGain: GainNode | null = null;
  let weatherLfo: OscillatorNode | null = null;
  let weatherGain: GainNode | null = null;
  let weatherSource: AudioBufferSourceNode | null = null;

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
      musicBus = ctx.createGain(); musicBus.gain.value = (settings.music ?? 60) / 100; musicBus.connect(master);
      musicColour = ctx.createBiquadFilter(); musicColour.type = 'lowpass';
      musicColour.frequency.value = isNight(game.world.time.minute) ? 900 : 3200;
      musicColour.connect(musicBus);
      // Feedback delay keeps the score warm without a convolver or recorded impulse.
      const wet = ctx.createGain(); wet.gain.value = dbToGain(REVERB_WET_DB);
      const delay = ctx.createDelay(1); delay.delayTime.value = REVERB_DELAY_SECONDS;
      const low = ctx.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = REVERB_CUTOFF_HZ;
      const feedback = ctx.createGain(); feedback.gain.value = REVERB_FEEDBACK;
      musicBus.connect(wet); wet.connect(delay); delay.connect(low);
      low.connect(master); low.connect(feedback); feedback.connect(delay);
      effectsBus = ctx.createGain();
      effectsBus.gain.value = settings.effects / 100;
      effectsBus.connect(master);
      ambientBus = ctx.createGain();
      ambientBus.gain.value = settings.ambient / 100;
      ambientBus.connect(master);
      hatBus = ctx.createGain(); hatBus.gain.value = 1; hatBus.connect(musicColour);
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    if (master) master.gain.setValueAtTime(1, ctx.currentTime);
    musicBus?.gain.setValueAtTime((settings.music ?? 60) / 100 * (tension ? 0.5 : 1), ctx.currentTime);
    effectsBus?.gain.setValueAtTime(settings.effects / 100, ctx.currentTime);
    ambientBus?.gain.setValueAtTime(settings.ambient / 100, ctx.currentTime);
    if (!unsubEvents) unsubEvents = game.subscribeEvents(onEvent);
    if (!unsubClock) unsubClock = game.subscribe(onClock);
    lastMinuteOfDay = -1;
    onClock();
    syncBed();
    syncWeather();
    syncMusic();
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
    if (weatherSource) { try { weatherSource.stop(); } catch { /* already stopped */ } }
    if (weatherLfo) { try { weatherLfo.stop(); } catch { /* already stopped */ } }
    if (tensionOsc) { try { tensionOsc.stop(); } catch { /* already stopped */ } }
    weatherLfo = null; tensionOsc = null; tensionGain = null;
    weatherSource = null; weatherGain = null;
    if (ctx) {
      for (const bus of [musicBus, ambientBus, effectsBus, master]) {
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
        if (next !== chapter) {
          previousChapter = chapter; chapter = next;
          transitionAt = Math.ceil((ctx.currentTime + (next === 6 ? cueDuration(stinger) : 0)) / BAR_SECONDS) * BAR_SECONDS;
        }
      }
      return;
    }
    if (event.kind === 'beat') {
      const name = beatCue(event.beat.code, event.beat.value);
      if (name === 'fire.start' || name === 'bomb.start') {
        tension = true; musicBus?.gain.setTargetAtTime((settings.music ?? 60) / 200, ctx.currentTime, 0.1); playNamedCue(name);
        if (!tensionOsc && musicBus) { tensionOsc = ctx.createOscillator(); tensionOsc.type = 'sine'; tensionOsc.frequency.value = name === 'fire.start' ? 110 : 55; tensionGain = ctx.createGain(); tensionGain.gain.value = 0.025; tensionOsc.connect(tensionGain); tensionGain.connect(musicBus); tensionOsc.start(); }
        return;
      }
      if (name === 'release.up' || name === 'release.down') {
        tension = false; playNamedCue(name); musicBus?.gain.setTargetAtTime((settings.music ?? 60) / 100, ctx.currentTime, 2);
        if (tensionGain) tensionGain.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
        if (tensionOsc) { tensionOsc.stop(ctx.currentTime + 1); tensionOsc = null; tensionGain = null; }
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

  function playNamedCue(name: Cue): void {
    if (!ctx || !effectsBus || settings.effects <= 0) return;
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
    const m = game.world.time.minute % 1440;
    if (m === lastMinuteOfDay) return;
    lastMinuteOfDay = m;
    applyMix(m);
    filterHz = isNight(m) ? 900 : 3200;
    musicColour?.frequency.setTargetAtTime(filterHz, ctx?.currentTime ?? 0, 0.15);
    hatBus?.gain.setValueAtTime(isNight(m) ? 0 : hatVelocityMultiplier(m), ctx?.currentTime ?? 0);
    if (ctx) for (const [filter, cutoff] of musicFilters) filter.frequency.setTargetAtTime(Math.min(cutoff, filterHz), ctx.currentTime, 0.15);
    syncWeather();
  }

  function playScoreNote(voice: Voice, note: Note, when: number, fade: number): void {
    if (!ctx || !musicColour) return;
    const c = ctx;
    const def = VOICES[voice];
    const duration = Math.max(def.attack + 0.02, Math.min(def.release, note.dur * BEAT_SECONDS));
    const peak = Math.max(0.0002, def.peak * note.vel * fade);
    const osc = c.createOscillator(); osc.type = def.wave;
    osc.frequency.setValueAtTime(note.freq, when);
    if (def.detune) osc.detune.setValueAtTime(def.detune, when);
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
    osc.onended = () => { scheduledMusic.delete(osc); musicFilters.delete(filter); osc.disconnect(); filter.disconnect(); env.disconnect(); };
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
    nextBar = Math.ceil(ctx.currentTime / BAR_SECONDS) * BAR_SECONDS;
    nextBarIndex = 0;
    const schedule = () => {
      if (!ctx || !musicBus || !settings.on) return;
      while (nextBar < ctx.currentTime + 4) {
        const at = nextBar; nextBar += BAR_SECONDS;
        const barIndex = nextBarIndex++;
        const phraseIndex = Math.floor(barIndex / 8);
        const barInPhrase = barIndex % 8;
        const night = isNight(game.world.time.minute);
        const weekend = clockOf(game.world.time.minute).isWeekend;
        filterHz = night ? 900 : 3200;
        const chapters = previousChapter && at >= transitionAt && at < transitionAt + 3 ? [previousChapter, chapter] : [at < transitionAt && previousChapter ? previousChapter : chapter];
        for (const playing of chapters) {
          for (const voice of voicesFor(playing, weekend)) {
            if (voice === 'hat' && night) continue;
            const phrase = phraseFor(game.world.seed, playing, phraseIndex, voice);
            for (const note of phrase) {
              if (note.beat < barInPhrase * 4 || note.beat >= (barInPhrase + 1) * 4) continue;
              const when = at + (note.beat - barInPhrase * 4) * BEAT_SECONDS;
              const fade = previousChapter && when >= transitionAt && when < transitionAt + 3
                ? playing === chapter ? (when - transitionAt) / 3 : 1 - (when - transitionAt) / 3 : 1;
              playScoreNote(voice, note, when, fade);
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
    const snapshot = weatherAt(game.world.seed, game.world.time.minute);
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
      if (ctx && musicBus) musicBus.gain.setTargetAtTime((settings.music ?? 60) / 100 * (tension ? 0.5 : 1), ctx.currentTime, 0.05);
    },
    get chapter() { return chapter; },
    get tension() { return tension; },
    get weatherKind() { return weatherKind; },
    get tempo() { return TEMPO; },
    get filterHz() { return filterHz; },
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
