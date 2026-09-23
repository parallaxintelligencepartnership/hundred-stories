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
  writeSoundSettings,
  type AudioContextLike,
  type Effect,
  type SoundStore,
} from '../../src/audio/audio';
import type { GameEvent, GameEventListener } from '../../src/game/api';

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
  setTargetAtTime(v: number): this {
    this.value = v;
    return this;
  }
}

class StubNode {
  gain = new StubParam();
  frequency = new StubParam();
  type = '';
  buffer: unknown = null;
  loop = false;
  started = 0;
  connect(): void {}
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
  constructor() {
    StubContext.constructed += 1;
  }
  createOscillator(): StubNode {
    const n = new StubNode();
    this.oscillators.push(n);
    return n;
  }
  createGain(): StubNode {
    return new StubNode();
  }
  createBiquadFilter(): StubNode {
    return new StubNode();
  }
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
  return {
    world: { time: { minute: 12 * 60 } } as never,
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
    writeSoundSettings({ on: true, effects: 35, ambient: 80 }, store);
    expect(Object.fromEntries(store.map)).toEqual({ [SOUND_KEY]: 'true', [SOUND_EFFECTS_KEY]: '35', [SOUND_AMBIENT_KEY]: '80' });
    expect(SOUND_KEY).toBe('hs.sound');
    expect(SOUND_EFFECTS_KEY).toBe('hs.sound.effects');
    expect(SOUND_AMBIENT_KEY).toBe('hs.sound.ambient');
    expect(readSoundSettings(store)).toEqual({ on: true, effects: 35, ambient: 80 });
  });
  it('clamps junk levels', () => {
    const store = memoryStore();
    store.setItem(SOUND_EFFECTS_KEY, '250');
    store.setItem(SOUND_AMBIENT_KEY, 'loud');
    expect(readSoundSettings(store)).toEqual({ on: false, effects: 100, ambient: DEFAULT_SOUND.ambient });
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
    writeSoundSettings({ on: true, effects: 70, ambient: 0 }, store);
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
    game.emit({ kind: 'car.arrive', shaftId: 1, carId: 1 });
    game.emit({ kind: 'car.arrive', shaftId: 1, carId: 2 }); // same instant: dropped
    expect(ctxs[0]!.oscillators).toHaveLength(2);
    t = 5000;
    game.emit({ kind: 'car.arrive', shaftId: 1, carId: 3 });
    expect(ctxs[0]!.oscillators).toHaveLength(4);
    sound.destroy();
  });

  it('builds the ambient bed only with sound on and ambient above zero', () => {
    const ctxs: StubContext[] = [];
    const store = memoryStore();
    writeSoundSettings({ on: true, effects: 0, ambient: 50 }, store);
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
    expect(ctxs[0]!.oscillators.map((o) => o.frequency.value)).toEqual([4000, 12]);
    expect(ctxs[0]!.sources.filter((s) => s.loop)).toHaveLength(1);
    sound.destroy();
  });
});
