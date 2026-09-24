// The sound module against a stub AudioContext: what each effect schedules, the ambient bed by
// hour, the settings keys, and the promise that sound off never builds a context.
import { afterEach, describe, expect, it } from 'vitest';
import {
  ambientMix,
  createSound,
  DEFAULT_SOUND,
  EFFECT_OSCILLATORS,
  effectFor,
  playEffect,
  readSoundSettings,
  SOUND_AMBIENT_KEY,
  SOUND_EFFECTS_KEY,
  SOUND_KEY,
  SOUND_MUSIC_KEY,
  VINYL_MAX_DB,
  dbToGain,
  writeSoundSettings,
  type AudioContextLike,
  type Effect,
  type SoundStore,
} from '../../src/audio/audio';
import type { GameEvent, GameEventListener } from '../../src/game/api';
import { isNight, chapterFor } from '../../src/audio/score';
import { CHAPTER_SCALES, CHAPTER_VOICES, inChapterScale, scaleMidi, VOICES, type Chapter } from '../../src/audio/score';
import { phraseFor, voicesFor } from '../../src/audio/phrase';
import { vipRatingCue, cueDuration, beatCue } from '../../src/audio/cues';
import { weatherAt } from '../../src/game/weather';

class StubParam {
  value = 0;
  calls: string[] = [];
  setValueAtTime(v: number): this {
    this.calls.push('set');
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  cancelScheduledValues(): this { return this; }
  setTargetAtTime(v: number): this {
    this.value = v;
    return this;
  }
}

class StubNode {
  gain = new StubParam();
  frequency = new StubParam();
  detune = new StubParam();
  delayTime = new StubParam();
  onended: (() => void) | null = null;
  type = '';
  buffer: unknown = null;
  loop = false;
  started = 0;
  connections: unknown[] = [];
  connect(target: unknown): void { this.connections.push(target); }
  disconnect(): void {}
  start(): void {
    this.started += 1;
  }
  stop(): void {}
}

class StubContext {
  static constructed = 0;
  currentTime = 0;
  sampleRate = 8000;
  destination = new StubNode();
  state: AudioContextState = 'suspended';
  oscillators: StubNode[] = [];
  sources: StubNode[] = [];
  gains: StubNode[] = [];
  filters: StubNode[] = [];
  delays: StubNode[] = [];
  constructor() {
    StubContext.constructed += 1;
  }
  createOscillator(): StubNode {
    const n = new StubNode();
    this.oscillators.push(n);
    return n;
  }
  createGain(): StubNode {
    const n = new StubNode(); this.gains.push(n); return n;
  }
  createBiquadFilter(): StubNode {
    const n = new StubNode(); this.filters.push(n); return n;
  }
  createDelay(): StubNode { const n = new StubNode(); this.delays.push(n); return n; }
  createBufferSource(): StubNode {
    const n = new StubNode();
    this.sources.push(n);
    return n;
  }
  createBuffer(_channels: number, length: number): { getChannelData(): Float32Array } {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.state = 'suspended';
    return Promise.resolve();
  }
}

const asCtx = (c: StubContext): AudioContextLike => c as unknown as AudioContextLike;

function memoryStore(): SoundStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

function fakeTarget() {
  const listeners = new Map<string, Array<() => void>>();
  return {
    addEventListener: (type: string, fn: () => void) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    removeEventListener: (type: string, fn: () => void) => listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn)),
    fire(type: string) {
      for (const fn of listeners.get(type) ?? []) fn();
    },
    count: () => [...listeners.values()].reduce((a, l) => a + l.length, 0),
  };
}

function fakeGame() {
  const events = new Set<GameEventListener>();
  const ticks = new Set<() => void>();
  const state = { seed: 1, stars: 1, time: { minute: 12 * 60 }, rooms: new Map<number, { kind: 'restaurant'; occupancy: number; width: number }>() };
  return {
    world: state as never,
    state,
    subscribe(cb: () => void) {
      ticks.add(cb);
      return () => ticks.delete(cb);
    },
    subscribeEvents(fn: GameEventListener) {
      events.add(fn);
      return () => {
        events.delete(fn);
      };
    },
    emit(e: GameEvent) {
      for (const fn of events) fn(e);
    },
    tick() { for (const fn of ticks) fn(); },
    listeners: () => events.size + ticks.size,
  };
}

describe('synth', () => {
  const effects: Effect[] = ['chime', 'door', 'build', 'register', 'alert', 'star'];
  it.each(effects)('%s schedules its oscillators and nothing more', (effect) => {
    const ctx = new StubContext();
    playEffect(asCtx(ctx), ctx.destination as never, effect, 0);
    expect(ctx.oscillators).toHaveLength(EFFECT_OSCILLATORS[effect]);
    for (const osc of ctx.oscillators) expect(osc.started).toBe(1);
  });

  it('uses the spec pitches', () => {
    const count = { chime: [660, 880], alert: [220, 220], register: [1320], build: [40] } as const;
    for (const [effect, pitches] of Object.entries(count)) {
      const ctx = new StubContext();
      playEffect(asCtx(ctx), ctx.destination as never, effect as Effect, 0);
      expect(ctx.oscillators.map((o) => o.frequency.value)).toEqual(pitches);
    }
    const star = new StubContext();
    playEffect(asCtx(star), star.destination as never, 'star', 0);
    expect(star.oscillators.map((o) => Math.round(o.frequency.value))).toEqual([523, 659, 784]);
  });

  it('noise parts: one burst for the door and the build click, three clicks on rent day', () => {
    const bursts = (effect: Effect): number => {
      const ctx = new StubContext();
      playEffect(asCtx(ctx), ctx.destination as never, effect, 0);
      return ctx.sources.length;
    };
    expect([bursts('door'), bursts('build'), bursts('register'), bursts('chime')]).toEqual([1, 1, 3, 0]);
  });

  it('maps game events to effects', () => {
    expect(effectFor({ kind: 'car.arrive', shaftId: 1, carId: 2 })).toBe('chime');
    expect(effectFor({ kind: 'car.doors', shaftId: 1, carId: 2 })).toBe('door');
    expect(effectFor({ kind: 'build', command: 'build' })).toBe('build');
    expect(effectFor({ kind: 'rentDay' })).toBe('register');
    expect(effectFor({ kind: 'stars', from: 1, to: 2 })).toBe('star');
    expect(effectFor({ kind: 'log', entry: { minute: 0, text: 'Fire', level: 'alert' } })).toBe('alert');
    expect(effectFor({ kind: 'log', entry: { minute: 0, text: 'Built', level: 'info' } })).toBeNull();
  });
});

describe('ambient chooser', () => {
  const at = (h: number, m = 0) => ambientMix(h * 60 + m);
  it('traffic by day, crickets by night, silence in neither window', () => {
    expect(at(12)).toEqual({ traffic: 1, crickets: 0 });
    expect(at(7)).toEqual({ traffic: 1, crickets: 0 });
    expect(at(0)).toEqual({ traffic: 0, crickets: 1 });
    expect(at(21)).toEqual({ traffic: 0, crickets: 1 });
    expect(at(4, 59).crickets).toBe(1);
  });
  it('crossfades over one game hour at each edge', () => {
    expect(at(6, 30).traffic).toBeCloseTo(0.5);
    expect(at(19, 30).traffic).toBeCloseTo(0.5);
    expect(at(20, 30).crickets).toBeCloseTo(0.5);
    expect(at(5, 30).crickets).toBeCloseTo(0.5);
    expect(at(6, 0)).toEqual({ traffic: 0, crickets: 0 });
  });
});

describe('settings keys', () => {
  it('defaults to off with both levels set', () => {
    expect(readSoundSettings(memoryStore())).toEqual(DEFAULT_SOUND);
    expect(DEFAULT_SOUND.on).toBe(false);
  });
  it('round trips under hs.sound, hs.sound.effects and hs.sound.ambient', () => {
    const store = memoryStore();
    writeSoundSettings({ on: true, effects: 35, ambient: 80, music: 60 }, store);
    expect(Object.fromEntries(store.map)).toEqual({ [SOUND_KEY]: 'true', [SOUND_EFFECTS_KEY]: '35', [SOUND_AMBIENT_KEY]: '80', [SOUND_MUSIC_KEY]: '60' });
    expect(SOUND_KEY).toBe('hs.sound');
    expect(SOUND_EFFECTS_KEY).toBe('hs.sound.effects');
    expect(SOUND_AMBIENT_KEY).toBe('hs.sound.ambient');
    expect(readSoundSettings(store)).toEqual({ on: true, effects: 35, ambient: 80, music: 60 });
  });
  it('clamps junk levels', () => {
    const store = memoryStore();
    store.setItem(SOUND_EFFECTS_KEY, '250');
    store.setItem(SOUND_AMBIENT_KEY, 'loud');
    store.setItem(SOUND_MUSIC_KEY, '250');
    expect(readSoundSettings(store)).toEqual({ on: false, effects: 100, ambient: DEFAULT_SOUND.ambient, music: 100 });
    writeSoundSettings({ on: false, effects: 70, ambient: 50, music: -20 }, store);
    expect(store.getItem(SOUND_MUSIC_KEY)).toBe('0');
    writeSoundSettings({ on: false, effects: 70, ambient: 50, music: 150 }, store);
    expect(store.getItem(SOUND_MUSIC_KEY)).toBe('100');
  });
});

describe('the AudioContext and the master toggle', () => {
  const g = globalThis as Record<string, unknown>;
  const saved = g['AudioContext'];
  afterEach(() => {
    if (saved === undefined) delete g['AudioContext'];
    else g['AudioContext'] = saved;
  });

  it('with the toggle off, no AudioContext is ever constructed, gestures or not', () => {
    StubContext.constructed = 0;
    g['AudioContext'] = StubContext; // the default factory reads the global
    const target = fakeTarget();
    const game = fakeGame();
    const sound = createSound(game, { target, store: memoryStore(), setInterval: () => 1, clearInterval: () => {} });
    target.fire('pointerdown');
    target.fire('keydown');
    game.emit({ kind: 'rentDay' });
    sound.setEffects(90);
    sound.setAmbient(90);
    expect(StubContext.constructed).toBe(0);
    expect(sound.hasContext).toBe(false);
    expect(game.listeners()).toBe(0); // and it does not even listen to the game
    sound.destroy();
    expect(target.count()).toBe(0);
  });

  it('with the toggle on, the context waits for the first gesture, then plays events', () => {
    StubContext.constructed = 0;
    g['AudioContext'] = StubContext;
    const store = memoryStore();
    writeSoundSettings({ on: true, effects: 70, ambient: 0, music: 60 }, store);
    const target = fakeTarget();
    const game = fakeGame();
    const sound = createSound(game, { target, store, now: () => 0, setInterval: () => 1, clearInterval: () => {} });
    expect(StubContext.constructed).toBe(0); // no gesture yet
    target.fire('keydown');
    expect(StubContext.constructed).toBe(1);
    target.fire('pointerdown');
    expect(StubContext.constructed).toBe(1); // one context for the life of the page
    sound.setEnabled(false);
    expect(game.listeners()).toBe(0);
    sound.destroy();
  });

  it('turning the toggle on after a gesture wakes it; an effect is rate limited', () => {
    const ctxs: StubContext[] = [];
    const target = fakeTarget();
    const game = fakeGame();
    let t = 0;
    const sound = createSound(game, {
      target,
      store: memoryStore(),
      now: () => t,
      createContext: () => {
        const c = new StubContext();
        ctxs.push(c);
        return asCtx(c);
      },
      setInterval: () => 1,
      clearInterval: () => {},
    });
    target.fire('pointerdown'); // the click on the checkbox, while it is still off
    expect(ctxs).toHaveLength(0);
    sound.setAmbient(0);
    sound.setEnabled(true);
    expect(ctxs).toHaveLength(1);
    const scoreVoices = ctxs[0]!.oscillators.length;
    game.emit({ kind: 'car.arrive', shaftId: 1, carId: 1 });
    game.emit({ kind: 'car.arrive', shaftId: 1, carId: 2 }); // same instant: dropped
    expect(ctxs[0]!.oscillators).toHaveLength(scoreVoices + 2);
    t = 399;
    game.emit({ kind: 'car.arrive', shaftId: 1, carId: 3 });
    expect(ctxs[0]!.oscillators).toHaveLength(scoreVoices + 2);
    t = 400;
    game.emit({ kind: 'car.arrive', shaftId: 1, carId: 3 });
    expect(ctxs[0]!.oscillators).toHaveLength(scoreVoices + 4);
    sound.setEnabled(false);
    expect(ctxs[0]!.gains[0]!.gain.value).toBe(0);
    sound.destroy();
  });

  it('builds the ambient bed only with sound on and ambient above zero', () => {
    const ctxs: StubContext[] = [];
    const store = memoryStore();
    writeSoundSettings({ on: true, effects: 0, ambient: 50, music: 60 }, store);
    const target = fakeTarget();
    const sound = createSound(fakeGame(), {
      target,
      store,
      createContext: () => {
        const c = new StubContext();
        ctxs.push(c);
        return asCtx(c);
      },
      setInterval: () => 1,
      clearInterval: () => {},
    });
    target.fire('pointerdown');
    // The bed: the 4 kHz chirp and its 12 Hz pulse, and one looping brown noise source.
    expect(ctxs[0]!.oscillators.map((o) => o.frequency.value)).toContain(4000);
    expect(ctxs[0]!.oscillators.map((o) => o.frequency.value)).toContain(12);
    expect(ctxs[0]!.sources.filter((s) => s.loop).length).toBeGreaterThanOrEqual(2);
    sound.destroy();
  });
});

describe('adaptive score', () => {
  it('keeps the highest chapter and changes night colour without changing tempo', () => {
    const game = fakeGame(); const target = fakeTarget(); const ctx = new StubContext();
    const sound = createSound(game, { target, store: memoryStore(), createContext: () => asCtx(ctx), setInterval: () => 1, clearInterval: () => {} });
    target.fire('pointerdown'); sound.setEnabled(true);
    expect(sound.chapter).toBe(1);
    game.emit({ kind: 'stars', from: 1, to: 3 }); expect(sound.chapter).toBe(3);
    game.emit({ kind: 'stars', from: 3, to: 2 }); expect(sound.chapter).toBe(3);
    expect(isNight(23 * 60 + 30)).toBe(true);
    expect(chapterFor(4)).toBe(4);
    expect(sound.tempo).toBeGreaterThanOrEqual(72);
    expect(sound.tempo).toBeLessThanOrEqual(82);
    sound.destroy();
  });
  it('suppresses ordinary bells during an emergency', () => {
    const game = fakeGame(); const target = fakeTarget(); const ctx = new StubContext();
    const sound = createSound(game, { target, store: memoryStore(), createContext: () => asCtx(ctx), now: () => 1000, setInterval: () => 1, clearInterval: () => {} });
    target.fire('pointerdown'); sound.setEnabled(true);
    game.emit({ kind: 'beat', beat: { code: 'fire.started', minute: 0 } });
    const count = ctx.oscillators.length;
    game.emit({ kind: 'car.arrive', shaftId: 0, carId: 1 }); expect(ctx.oscillators).toHaveLength(count);
    game.emit({ kind: 'beat', beat: { code: 'fire.resolved', minute: 1 } }); expect(sound.tension).toBe(false);
    sound.destroy();
  });
});

describe('cue definitions', () => {
  it('rates the VIP in three different directions and gives Tower a full fanfare', () => {
    expect([0, 1, 2].map(vipRatingCue)).toEqual(['vip.poor', 'vip.fair', 'vip.good']);
    expect(cueDuration('tower')).toBeGreaterThanOrEqual(10);
    expect(cueDuration('tower')).toBeLessThanOrEqual(15);
  });
});

describe('six chapter moods and seeded eight-bar phrases', () => {
  it('maps each star directly and defines its own voice set', () => {
    for (const star of [1, 2, 3, 4, 5, 6] as Chapter[]) {
      expect(chapterFor(star)).toBe(star);
      expect(CHAPTER_VOICES[star].length).toBeGreaterThan(0);
      expect(CHAPTER_SCALES[star]).toHaveLength(7);
    }
    expect(CHAPTER_VOICES[2]).toContain('guitar');
    expect(CHAPTER_VOICES[3]).toContain('brass');
    expect(CHAPTER_VOICES[4]).toContain('horn');
    expect(CHAPTER_VOICES[5]).toContain('vibes');
    expect(CHAPTER_VOICES[5]).toContain('kinetic');
    expect(CHAPTER_VOICES[6]).toContain('strings');
    expect(VOICES.guitar.detune).toBeGreaterThan(0);
    expect(VOICES.vibes.tremolo).toBeGreaterThan(0);
  });
  it('changes weekend voices and the daytime hat level without changing the mood', async () => {
    const { hatVelocityMultiplier } = await import('../../src/audio/score');
    expect(voicesFor(1, true)).toContain('guitar');
    expect(voicesFor(3, true)).toContain('counter');
    expect(voicesFor(6, true)).toContain('pluck');
    expect(hatVelocityMultiplier(7 * 60)).toBeGreaterThan(hatVelocityMultiplier(18 * 60));
  });
  it('is deterministic and varies through 60 consecutive chapter-one phrases', () => {
    const phrases = Array.from({ length: 60 }, (_, i) => phraseFor(4242, 1, i, 'piano'));
    expect(phraseFor(4242, 1, 13, 'piano')).toEqual(phraseFor(4242, 1, 13, 'piano'));
    const hashes = phrases.map(p => JSON.stringify(p));
    expect(new Set(hashes).size).toBeGreaterThanOrEqual(40);
    for (let i = 1; i < hashes.length; i += 1) expect(hashes[i]).not.toBe(hashes[i - 1]);
    expect(phrases.every(p => p.length > 0 && p.every(n => n.beat >= 0 && n.beat < 32))).toBe(true);
  });
  it('keeps every voice in its chapter scale and bass on roots or perfect fifths', () => {
    const roots = [0, 3, 4, 0, 5, 3, 4, 0];
    for (const chapter of [1, 2, 3, 4, 5, 6] as Chapter[]) {
      for (const voice of CHAPTER_VOICES[chapter]) {
        for (const note of phraseFor(99, chapter, 7, voice)) expect(inChapterScale(chapter, note.freq)).toBe(true);
      }
      const bass = phraseFor(99, chapter, 7, 'bass');
      expect(bass).toHaveLength(16);
      for (let bar = 0; bar < 8; bar += 1) {
        const root = bass[bar * 2]!;
        const fifth = bass[bar * 2 + 1]!;
        const candidate = roots[bar]!;
        const degree = scaleMidi(chapter, candidate + 4) - scaleMidi(chapter, candidate) === 7 ? candidate : 0;
        expect(root.freq).toBeCloseTo(440 * 2 ** ((scaleMidi(chapter, degree, -2) - 69) / 12));
        expect(12 * Math.log2(fifth.freq / root.freq)).toBeCloseTo(7);
      }
    }
    const hat = phraseFor(99, 5, 7, 'hat');
    expect(new Set(hat.map(n => n.freq)).size).toBe(1);
    const leadBars = new Set(phraseFor(99, 6, 7, 'lead').map(n => Math.floor(n.beat / 4)));
    const counterBars = new Set(phraseFor(99, 6, 7, 'counter').map(n => Math.floor(n.beat / 4)));
    expect([...leadBars].some(bar => counterBars.has(bar))).toBe(false);
  });
});

describe('mixer and weather integration', () => {
  it('keeps every bus silent after one off call and has a music-only feedback delay', () => {
    const game = fakeGame(); const target = fakeTarget(); const ctx = new StubContext();
    const sound = createSound(game, { target, store: memoryStore(), createContext: () => asCtx(ctx), setInterval: () => 1, clearInterval: () => {} });
    target.fire('pointerdown'); sound.setEnabled(true);
    expect(ctx.delays).toHaveLength(1);
    expect(ctx.delays[0]!.delayTime.value).toBeCloseTo(0.31);
    expect(ctx.gains.some(g => g.gain.value === 0.35)).toBe(true);
    expect(ctx.filters.some(f => f.frequency.value === 3000)).toBe(true);
    expect(ctx.gains[8]!.gain.value).toBeLessThanOrEqual(dbToGain(VINYL_MAX_DB));
    expect(ctx.oscillators.some(o => o.frequency.value === 0.3)).toBe(true);
    sound.setEnabled(false);
    for (const bus of [ctx.gains[0], ctx.gains[1], ctx.gains[4], ctx.gains[5]]) expect(bus!.gain.value).toBe(0);
    sound.destroy();
  });
  it('stops the kit and ducks music on a fire beat; tempo stays fixed as energy changes', () => {
    const game = fakeGame(); const target = fakeTarget(); const ctx = new StubContext();
    let t = 0; const timers: Array<() => void> = [];
    const sound = createSound(game, { target, store: memoryStore(), createContext: () => asCtx(ctx), now: () => t,
      setInterval: fn => { timers.push(fn); return timers.length; }, clearInterval: () => {} });
    target.fire('pointerdown'); sound.setEnabled(true);
    const tempo = sound.tempo;
    const before = ctx.gains[1]!.gain.value;
    game.emit({ kind: 'beat', beat: { code: 'fire.started', minute: 0 } });
    expect(ctx.gains[6]!.gain.value).toBe(0);
    expect(ctx.gains[7]!.gain.value).toBe(0);
    expect(ctx.gains[1]!.gain.value).toBeLessThan(before);
    game.state.rooms.set(1, { kind: 'restaurant', occupancy: 24, width: 12 });
    game.state.time.minute = 2 * 1440 + 21 * 60;
    ctx.currentTime = 10; timers.at(-1)!();
    t = 20000; ctx.currentTime = 20; timers.at(-1)!();
    expect(sound.tempo).toBe(tempo);
    sound.destroy();
  });
  it('changes the active music filter at 23:30 without changing tempo', () => {
    const game = fakeGame(); const target = fakeTarget(); const ctx = new StubContext();
    game.state.seed = Array.from({ length: 100 }, (_, i) => i).find(i => weatherAt(i, 720).kind === 'clear' && weatherAt(i, 1410).kind === 'clear')!;
    let t = 0; const timers: Array<() => void> = [];
    const sound = createSound(game, { target, store: memoryStore(), createContext: () => asCtx(ctx), now: () => t,
      setInterval: fn => { timers.push(fn); return timers.length; }, clearInterval: () => {} });
    target.fire('pointerdown'); sound.setEnabled(true);
    const tempo = sound.tempo;
    const dayFilter = sound.filterHz!;
    game.state.time.minute = 23 * 60 + 30; game.tick();
    ctx.currentTime = 5; timers.at(-1)!(); // request the new bar's night target
    t = 20000; ctx.currentTime = 10; timers.at(-1)!(); // ease toward it in real time
    expect(sound.filterHz).toBeGreaterThanOrEqual(1200);
    expect(sound.filterHz).toBeLessThan(dayFilter);
    expect(sound.tempo).toBe(tempo);
    expect(ctx.filters.some(f => f.frequency.value === sound.filterHz)).toBe(true);
    sound.destroy();
  });
  it('selects weatherAt beds for every kind and skips thunder under reduced motion', () => {
    const g = globalThis as Record<string, unknown>;
    const oldMatchMedia = g['matchMedia'];
    g['matchMedia'] = () => ({ matches: true });
    try {
      for (const kind of ['clear', 'overcast', 'rain', 'storm']) {
        const seed = Array.from({ length: 100 }, (_, i) => i).find(i => weatherAt(i, 720).kind === kind);
        expect(seed).toBeDefined();
        const game = fakeGame(); game.state.seed = seed!; game.state.time.minute = 720;
        const target = fakeTarget(); const ctx = new StubContext();
        const sound = createSound(game, { target, store: memoryStore(), createContext: () => asCtx(ctx), now: () => 30000, setInterval: () => 1, clearInterval: () => {} });
        target.fire('pointerdown'); sound.setEnabled(true);
        expect(sound.weatherKind).toBe(kind);
        if (kind === 'storm') expect(ctx.filters.some(f => f.type === 'lowpass' && f.frequency.value === 80)).toBe(false);
        sound.destroy();
      }
    } finally {
      if (oldMatchMedia === undefined) delete g['matchMedia']; else g['matchMedia'] = oldMatchMedia;
    }
  });
});

describe('hostile encounter cues and priority', () => {
  function setup() {
    const game = fakeGame(); const target = fakeTarget(); const ctx = new StubContext();
    const sound = createSound(game, { target, store: memoryStore(), createContext: () => asCtx(ctx),
      setInterval: () => 1, clearInterval: () => {} });
    target.fire('pointerdown'); sound.setEnabled(true);
    return { game, target, ctx, sound };
  }
  const beat = (code: 'theft.started' | 'guard.dispatched' | 'theft.caught' | 'theft.escaped' | 'fire.started' | 'fire.resolved'): GameEvent =>
    ({ kind: 'beat', beat: { code, minute: 0 } });

  it('uses a distinct sub-1.2-second cue and half tension for theft', () => {
    expect(new Set([beatCue('theft.started'), beatCue('fire.started'), beatCue('bomb.started')]).size).toBe(3);
    expect(cueDuration('theft.start')).toBeLessThan(1.2);
    const { game, ctx, sound } = setup();
    const before = ctx.oscillators.length;
    game.emit(beat('theft.started'));
    expect(sound.tensionLevel).toBe(0.5);
    expect(ctx.oscillators.slice(before, before + 3).map(o => o.frequency.value)).toEqual([146.83, 123.47, 185]);
    expect(ctx.gains[6]!.gain.value).toBeGreaterThan(0);
    expect(ctx.gains[7]!.gain.value).toBeGreaterThan(0);
    expect(ctx.gains[7]!.gain.value).toBeLessThan(1);
    sound.destroy();
  });

  it('routes guard dispatch to effects without changing tension', () => {
    const { game, ctx, sound } = setup();
    game.emit(beat('theft.started'));
    const before = ctx.oscillators.length;
    game.emit(beat('guard.dispatched'));
    expect(sound.tensionLevel).toBe(0.5);
    const ticks = ctx.oscillators.slice(before);
    expect(ticks.map(o => o.frequency.value)).toEqual([784, 988]);
    for (const tick of ticks) expect((tick.connections[0] as StubNode).connections).toContain(ctx.gains[4]);
    sound.destroy();
  });

  it('uses different releases for caught and escaped theft', () => {
    const { game, ctx, sound } = setup();
    game.emit(beat('theft.started'));
    let before = ctx.oscillators.length;
    game.emit(beat('theft.caught'));
    expect(ctx.oscillators.slice(before).map(o => o.frequency.value)).toEqual([330, 440]);
    expect(sound.tensionLevel).toBe(0);
    game.emit(beat('theft.started'));
    before = ctx.oscillators.length;
    game.emit(beat('theft.escaped'));
    expect(ctx.oscillators.slice(before).map(o => o.frequency.value)).toEqual([330, 247]);
    expect(sound.tensionLevel).toBe(0);
    sound.destroy();
  });

  it('suppresses theft during fire and raises theft to full tension when fire starts', () => {
    const first = setup();
    first.game.emit(beat('fire.started'));
    const count = first.ctx.oscillators.length;
    first.game.emit(beat('theft.started'));
    expect(first.ctx.oscillators).toHaveLength(count);
    expect(first.sound.tensionLevel).toBe(1);
    first.sound.destroy();

    const second = setup();
    second.game.emit(beat('theft.started'));
    expect(second.sound.tensionLevel).toBe(0.5);
    second.game.emit(beat('fire.started'));
    expect(second.sound.tensionLevel).toBe(1);
    expect(second.ctx.gains[6]!.gain.value).toBe(0);
    expect(second.ctx.gains[7]!.gain.value).toBe(0);
    second.game.emit(beat('theft.caught'));
    expect(second.sound.tensionLevel).toBe(1); // theft's late outcome cannot clear the fire
    second.sound.destroy();
  });
});
