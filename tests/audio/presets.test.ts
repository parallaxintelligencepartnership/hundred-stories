// Listening presets: each pins the score's inputs over the live world, unknown names change
// nothing, the ?audio flag is inert outside dev, and the WAV encoder writes a correct header.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/audio/mood', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/audio/mood')>();
  return { ...actual, moodFor: vi.fn(actual.moodFor) };
});

import { createSound, setSoundDevHook, SOUND_KEY, type AudioContextLike, type SoundStore } from '../../src/audio/audio';
import { moodFor } from '../../src/audio/mood';
import { armDevAudio, PRESETS, PRESET_NAMES, presetInputs, sessionOnStore, withDevPresets } from '../../src/audio/presets';
import { encodeWav } from '../../src/audio/wav';
import { applyDevAudio } from '../../src/main';

class Param {
  value = 0;
  setValueAtTime(v: number): this { this.value = v; return this; }
  linearRampToValueAtTime(v: number): this { this.value = v; return this; }
  exponentialRampToValueAtTime(v: number): this { this.value = v; return this; }
  setTargetAtTime(v: number): this { this.value = v; return this; }
  cancelScheduledValues(): this { return this; }
}
class Node {
  gain = new Param(); frequency = new Param(); detune = new Param(); delayTime = new Param();
  threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param();
  onended: (() => void) | null = null; type = ''; buffer: unknown = null; loop = false;
  connect(): void {} disconnect(): void {} start(): void {} stop(): void {}
}
class Ctx {
  currentTime = 0; sampleRate = 8000; destination = new Node(); state: AudioContextState = 'suspended';
  createOscillator(): Node { return new Node(); }
  createGain(): Node { return new Node(); }
  createBiquadFilter(): Node { return new Node(); }
  createDelay(): Node { return new Node(); }
  createDynamicsCompressor(): Node { return new Node(); }
  createBufferSource(): Node { return new Node(); }
  createBuffer(_c: number, length: number): { getChannelData(): Float32Array } { const d = new Float32Array(length); return { getChannelData: () => d }; }
  resume(): Promise<void> { this.state = 'running'; return Promise.resolve(); }
  suspend(): Promise<void> { this.state = 'suspended'; return Promise.resolve(); }
}

function memoryStore(on: boolean): SoundStore & { map: Map<string, string> } {
  const map = new Map<string, string>([[SOUND_KEY, on ? 'true' : 'false']]);
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

/** A live world at noon on a weekday with seed 1, stars 1: nothing like any preset. */
function fakeGame() {
  return {
    world: { seed: 1, stars: 1, time: { minute: 12 * 60 }, rooms: new Map() } as never,
    subscribe: () => () => {},
    subscribeEvents: () => () => {},
  };
}

function listen() {
  const ctx = new Ctx();
  const timers: Array<() => void> = [];
  const gestures: Array<() => void> = [];
  const sound = withDevPresets(createSound(fakeGame(), {
    store: memoryStore(true),
    createContext: () => ctx as unknown as AudioContextLike,
    target: { addEventListener: (_t, fn) => void gestures.push(fn), removeEventListener: () => {} },
    now: () => ctx.currentTime * 1000,
    setInterval: (fn) => timers.push(fn),
    clearInterval: () => {},
  }));
  return { ctx, sound, gesture: () => gestures.forEach((fn) => fn()), tick: () => timers.forEach((fn) => fn()) };
}

const lastMoodInput = () => vi.mocked(moodFor).mock.calls.at(-1)![0];

afterEach(() => {
  setSoundDevHook(null);
  vi.mocked(moodFor).mockClear();
});

describe('listening presets', () => {
  it.each(PRESET_NAMES)('%s pins its inputs and chapter over the live world', (name) => {
    const { sound, gesture } = listen();
    expect(sound.setDevPreset(name)).toBe(true);
    gesture();
    const p = PRESETS[name];
    const { chapter: _chapter, ...pinned } = presetInputs(name, 0);
    expect(lastMoodInput()).toEqual(pinned);
    expect(lastMoodInput()).toMatchObject({ minuteOfDay: p.minuteOfDay, isWeekend: p.isWeekend, venueFill: p.venueFill,
      weather: { kind: p.weather, intensity: p.intensity } });
    expect(sound.chapter).toBe(p.chapter);
    expect(sound.mood).toEqual(moodFor(pinned));
    expect(sound.weatherKind).toBe(p.weather);
  });

  it('fire-3star holds tension for the first 20 seconds, then releases it', () => {
    const { ctx, sound, gesture, tick } = listen();
    sound.setDevPreset('fire-3star');
    gesture();
    expect(lastMoodInput().tension).toBe(1);
    ctx.currentTime = 19; tick();
    expect(lastMoodInput().tension).toBe(1);
    ctx.currentTime = 21; tick();
    expect(lastMoodInput().tension).toBe(0);
  });

  it('ignores an unknown preset name', () => {
    const { sound, gesture } = listen();
    gesture();
    const before = { mood: sound.mood, chapter: sound.chapter, weather: sound.weatherKind };
    vi.mocked(moodFor).mockClear();
    expect(sound.setDevPreset('hurricane-9star')).toBe(false);
    expect(sound.setDevPreset('toString')).toBe(false);
    expect(vi.mocked(moodFor)).not.toHaveBeenCalled();
    expect({ mood: sound.mood, chapter: sound.chapter, weather: sound.weatherKind }).toEqual(before);
    expect(armDevAudio('hurricane-9star', null)).toBe(false);
    const next = createSound(fakeGame(), { store: memoryStore(false), setInterval: () => 1, clearInterval: () => {} });
    expect('setDevPreset' in next).toBe(false);
  });

  it('turns sound on for the load without writing the preference', () => {
    const real = memoryStore(false);
    const store = sessionOnStore(real);
    expect(store.getItem(SOUND_KEY)).toBe('true');
    store.setItem(SOUND_KEY, 'true');
    store.setItem('hs.sound.music', '40');
    expect(real.map.get(SOUND_KEY)).toBe('false');
    expect(real.map.get('hs.sound.music')).toBe('40');
  });
});

describe('?audio flag', () => {
  it('does nothing when DEV is false', async () => {
    const load = vi.fn(async () => ({ armDevAudio: vi.fn(() => true) }));
    expect(await applyDevAudio('?new&audio=sunny-morning-1star', false, load)).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it('arms the preset in dev, and only when ?audio is present', async () => {
    const arm = vi.fn(() => true);
    const load = vi.fn(async () => ({ armDevAudio: arm }));
    expect(await applyDevAudio('?new', true, load)).toBe(false);
    expect(load).not.toHaveBeenCalled();
    expect(await applyDevAudio('?new&audio=storm-night-tower&render=45', true, load)).toBe(true);
    expect(arm).toHaveBeenCalledWith('storm-night-tower', '45');
  });
});

describe('encodeWav', () => {
  it('writes a valid 16-bit stereo 44.1 kHz header for one second of silence', () => {
    const rate = 44100;
    const wav = encodeWav([new Float32Array(rate), new Float32Array(rate)], rate);
    const view = new DataView(wav.buffer);
    const text = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
    const dataBytes = rate * 2 * 2;
    expect(wav.length).toBe(44 + dataBytes);
    expect(text(0)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(text(8)).toBe('WAVE');
    expect(text(12)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(rate);
    expect(view.getUint32(28, true)).toBe(rate * 4);
    expect(view.getUint16(32, true)).toBe(4);
    expect(view.getUint16(34, true)).toBe(16);
    expect(text(36)).toBe('data');
    expect(view.getUint32(40, true)).toBe(dataBytes);
    expect(wav.subarray(44).every((b) => b === 0)).toBe(true);
  });
});
