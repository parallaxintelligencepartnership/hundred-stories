// The lofi beat pass (2026-09-23): the rules the rendered samples were tuned against, pinned so
// a later change cannot quietly bring back the clipped, alarm-topped score Matt heard.
import { describe, expect, it } from 'vitest';
import {
  BELL, BELL_TIMBRES, createBellGate, playBell, playBellTick, playDoorSwish,
  createSound, dbToGain, LIMITER, LOOKAHEAD_SECONDS, MASTER_CHAIN, TAPE_WOBBLE_CENTS, TEXTURE_DB,
  type AudioContextLike,
} from '../../src/audio/audio';
import { drumHitsFor, KICK_PATTERNS, KIT_PEAK_DB, lazyOffsetMs, renderPiece, SNARE_BEATS, type DrumKind } from '../../src/audio/drums';
import { activeLayers, moodFor } from '../../src/audio/mood';
import { chordTones, progressionFor, phraseFor, voicesFor } from '../../src/audio/phrase';
import { presetInputs, PRESETS, PRESET_NAMES } from '../../src/audio/presets';
import {
  CHAPTER_VOICES, KEYS_CUTOFF_HZ, MAX_MELODIC, MELODIC, VOICES, keyFor, swingFor,
  type Chapter, type Voice,
} from '../../src/audio/score';

// ------------------------------------------------------------------ stub context

class Param {
  value = 0;
  setValueAtTime(v: number): this { this.value = v; return this; }
  linearRampToValueAtTime(v: number): this { this.value = v; return this; }
  exponentialRampToValueAtTime(v: number): this { this.value = v; return this; }
  setTargetAtTime(): this { return this; }
  cancelScheduledValues(): this { return this; }
}
class Node {
  gain = new Param(); frequency = new Param(); detune = new Param(); delayTime = new Param(); Q = new Param();
  threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param();
  onended: (() => void) | null = null; type = ''; buffer: { length: number } | null = null; loop = false;
  connections: unknown[] = [];
  startedAt: number | null = null;
  constructor(readonly kind: string) {}
  connect(to: unknown): void { this.connections.push(to); }
  disconnect(): void {}
  start(at = 0): void { this.startedAt = at; }
  stop(): void {}
}
class Ctx {
  currentTime = 0; sampleRate = 8000; state: AudioContextState = 'running';
  destination = new Node('destination');
  nodes: Node[] = [];
  private make(kind: string): Node { const n = new Node(kind); this.nodes.push(n); return n; }
  createOscillator(): Node { return this.make('osc'); }
  createGain(): Node { return this.make('gain'); }
  createBiquadFilter(): Node { return this.make('filter'); }
  createDelay(): Node { return this.make('delay'); }
  createDynamicsCompressor(): Node { return this.make('compressor'); }
  createBufferSource(): Node { return this.make('source'); }
  createBuffer(_c: number, length: number): { length: number; getChannelData(): Float32Array } {
    const d = new Float32Array(length); return { length, getChannelData: () => d };
  }
  resume(): Promise<void> { return Promise.resolve(); }
  suspend(): Promise<void> { return Promise.resolve(); }
  of(kind: string): Node[] { return this.nodes.filter(n => n.kind === kind); }
}

/** The real controller on a stub context, pinned to a preset, stepped like the offline render. */
function listen(preset: (typeof PRESET_NAMES)[number], seed: number) {
  const ctx = new Ctx();
  const timers: Array<() => void> = [];
  const gestures: Array<() => void> = [];
  const sound = createSound({ world: { seed, stars: 1, time: { minute: 600 }, rooms: new Map() } as never, subscribe: () => () => {}, subscribeEvents: () => () => {} }, {
    store: { getItem: k => (k === 'hs.sound' ? 'true' : null), setItem: () => {} },
    createContext: () => ctx as unknown as AudioContextLike,
    target: { addEventListener: (_t, fn) => void gestures.push(fn), removeEventListener: () => {} },
    now: () => ctx.currentTime * 1000,
    setInterval: fn => timers.push(fn),
    clearInterval: () => {},
  });
  sound.pin!(elapsed => presetInputs(preset, elapsed));
  gestures.forEach(fn => fn());
  const run = (until: number, each?: () => void) => {
    for (let t = ctx.currentTime + 0.5; t <= until; t += 0.5) { ctx.currentTime = t; timers.forEach(fn => fn()); each?.(); }
  };
  return { ctx, sound, run };
}

// ------------------------------------------------------------------ the kit

describe('boom-bap kit', () => {
  it('has four to six patterns, each with a kick on one', () => {
    expect(KICK_PATTERNS.length).toBeGreaterThanOrEqual(4);
    expect(KICK_PATTERNS.length).toBeLessThanOrEqual(6);
    for (const pattern of KICK_PATTERNS) expect(pattern[0]).toBe(0);
    // The second kick lands on the "and" of two or three, or near it.
    for (const pattern of KICK_PATTERNS) expect(pattern.slice(1).some(beat => beat >= 0.75 && beat <= 2.75)).toBe(true);
  });
  it('puts the snare or rim on two and four, and only there, in every pattern, bar and energy', () => {
    expect(SNARE_BEATS).toEqual([1, 3]);
    for (let phrase = 0; phrase < 40; phrase += 1) {
      for (const energy of [0.2, 0.34, 0.5, 0.8, 1]) {
        const hits = drumHitsFor(9 + phrase, phrase, phrase * 8 + (phrase % 8), energy);
        const backbeat = hits.filter(h => h.kind === 'snare' || h.kind === 'rim');
        expect(backbeat.map(h => h.beat)).toEqual([1, 3]);
        expect(new Set(backbeat.map(h => h.kind)).size).toBe(1);
        expect(hits.filter(h => h.kind === 'kick').some(h => h.beat === 0)).toBe(true);
      }
    }
    expect(drumHitsFor(3, 0, 0, 0.2).some(h => h.kind === 'rim')).toBe(true);
    expect(drumHitsFor(3, 0, 0, 0.8).some(h => h.kind === 'snare')).toBe(true);
  });
  it('shuffles hats on swung eighths with ghost notes when the room is busy', () => {
    const energy = 0.8;
    const hats = drumHitsFor(5, 0, 1, energy).filter(h => h.kind === 'hat').map(h => h.beat);
    const offbeats = hats.filter(beat => beat % 1 !== 0);
    expect(offbeats.length).toBeGreaterThan(0);
    for (const beat of offbeats) expect(beat % 1).toBeCloseTo(swingFor(energy));
    expect(drumHitsFor(5, 0, 1, energy).some(h => h.kind === 'ghost')).toBe(true);
  });
  it('lies back 15 to 30 ms, later as energy falls', () => {
    expect(lazyOffsetMs(1)).toBe(15);
    expect(lazyOffsetMs(0)).toBe(30);
    const snareLate = (e: number) => drumHitsFor(1, 0, 0, e).find(h => h.kind === 'snare' || h.kind === 'rim')!.lateSeconds;
    expect(snareLate(0.2)).toBeGreaterThan(snareLate(0.9));
    expect(snareLate(0.9) * 1000).toBeGreaterThanOrEqual(15);
    expect(snareLate(0.2) * 1000).toBeLessThanOrEqual(30);
  });
  it('has real level: kick and snare peak at -12 dBFS on the music bus, hats well under', () => {
    expect(KIT_PEAK_DB.kick).toBe(-12);
    expect(KIT_PEAK_DB.snare).toBe(-12);
    for (const kind of ['hat', 'open', 'kinetic'] as const) expect(KIT_PEAK_DB[kind]).toBeLessThanOrEqual(-20);
    // Each baked piece is normalised to a peak of exactly 1, so KIT_PEAK_DB is its true peak.
    for (const kind of Object.keys(KIT_PEAK_DB) as DrumKind[]) {
      const piece = renderPiece(kind, 44100);
      expect(Math.max(...piece.map(Math.abs))).toBeCloseTo(1, 5);
    }
    const { ctx, run } = listen('weekend-night-5star', 303);
    run(8);
    const loudest = Math.max(...ctx.of('gain').filter(g => g.connections.length && ctx.of('source').some(s => s.connections.includes(g))).map(g => g.gain.value));
    expect(20 * Math.log10(loudest)).toBeCloseTo(-12, 1);
  });
  it('schedules snares exactly on beats two and four of the live score', () => {
    const { ctx, sound, run } = listen('sunny-morning-1star', 101);
    run(20);
    const beat = 60 / sound.tempo!;
    const snareLength = renderPiece('snare', 8000).length;
    const snares = ctx.of('source').filter(s => s.buffer?.length === snareLength && s.startedAt !== null);
    expect(snares.length).toBeGreaterThan(8);
    for (const s of snares) {
      const inBar = (s.startedAt! / beat) % 4;
      expect(Math.min(Math.abs(inBar - 1), Math.abs(inBar - 3))).toBeLessThan(0.05);
    }
  });
});

// ------------------------------------------------------------------ keys, bass, tones

describe('voices', () => {
  it('keeps the keys a soft Rhodes under a 2.5 kHz low-pass', () => {
    expect(KEYS_CUTOFF_HZ).toBe(2500);
    expect(VOICES.piano.cutoff).toBe(KEYS_CUTOFF_HZ);
    expect(VOICES.piano.attack).toBeGreaterThanOrEqual(0.01);
    expect(VOICES.piano.detune).toBeGreaterThan(0);
  });
  it('comps sevenths and ninths in short repeating figures', () => {
    const colour = 'major9';
    for (const chapter of [1, 2, 3, 4, 5, 6] as Chapter[]) {
      for (const root of progressionFor(7, chapter, 0, colour)) {
        const tones = chordTones(chapter, root, colour);
        expect(tones.length).toBeGreaterThanOrEqual(3);
        expect(Math.max(...tones)).toBeLessThanOrEqual(76);
      }
    }
    const piano = phraseFor(11, 1, 3, 'piano', { energy: 0.6, warmth: 0.8 });
    const onsetsPerBar = Array.from({ length: 8 }, (_, bar) => new Set(piano.filter(n => Math.floor(n.beat / 4) === bar).map(n => n.beat % 4)).size);
    expect(Math.max(...onsetsPerBar)).toBeLessThanOrEqual(5);
    expect(Math.min(...onsetsPerBar)).toBeGreaterThanOrEqual(1);
  });
  it('holds no fundamental above 1 kHz in any voice, chapter, key or mood', () => {
    for (const voice of Object.keys(VOICES) as Voice[]) expect(VOICES[voice].maxHz).toBeLessThanOrEqual(1000);
    for (let seed = 0; seed < 12; seed += 1) {
      for (const chapter of [1, 2, 3, 4, 5, 6] as Chapter[]) {
        for (const voice of CHAPTER_VOICES[chapter]) {
          for (const style of [{ energy: 0.2, warmth: 0.1, night: true }, { energy: 1, warmth: 1 }]) {
            for (const note of phraseFor(seed, chapter, seed * 3, voice, { ...style, key: keyFor(seed) })) {
              expect(note.freq).toBeLessThanOrEqual(VOICES[voice].maxHz);
            }
          }
        }
      }
    }
  });
  it('strikes the vibes as a bar under C6 with a fast decay', () => {
    expect(VOICES.vibes.maxHz).toBeLessThan(1046.5);
    expect(VOICES.vibes.sustain).toBe(0);
    expect(VOICES.vibes.release).toBeLessThan(0.5);
  });
  it('keeps the bass round and under 200 Hz', () => {
    expect(VOICES.bass.wave).toBe('sine');
    expect(VOICES.bass.cutoff).toBeLessThanOrEqual(200);
    for (let seed = 0; seed < 20; seed += 1) {
      for (const note of phraseFor(seed, 5, seed, 'bass', { energy: 0.9, key: keyFor(seed) })) expect(note.freq).toBeLessThan(200);
    }
  });
});

// ------------------------------------------------------------------ the master chain

describe('music master chain', () => {
  it('runs compressor, makeup, 7 kHz low-pass, 5 kHz shelf cut, then the slider and a limiter', () => {
    expect(MASTER_CHAIN.compressor.threshold).toBe(-14);
    expect(MASTER_CHAIN.compressor.ratio).toBe(4);
    expect(MASTER_CHAIN.lowpassHz).toBe(7000);
    expect(MASTER_CHAIN.shelf).toEqual({ hz: 5000, db: -6 });
    expect(LIMITER.threshold).toBeLessThanOrEqual(-3);
    const { ctx } = listen('rainy-tuesday-5star', 202);
    const [compressor, limiter] = ctx.of('compressor');
    expect([compressor!.threshold.value, compressor!.ratio.value]).toEqual([-14, 4]);
    const makeup = compressor!.connections[0] as Node;
    expect(makeup.gain.value).toBeCloseTo(dbToGain(MASTER_CHAIN.makeupDb));
    const lowpass = makeup.connections[0] as Node;
    expect([lowpass.type, lowpass.frequency.value]).toEqual(['lowpass', 7000]);
    const shelf = lowpass.connections[0] as Node;
    expect([shelf.type, shelf.frequency.value, shelf.gain.value]).toEqual(['highshelf', 5000, -6]);
    const slider = shelf.connections[0] as Node;
    const master = slider.connections[0] as Node;
    expect(master.connections).toContain(limiter);
    expect(limiter!.connections).toContain(ctx.destination);
    expect([limiter!.threshold.value, limiter!.ratio.value]).toEqual([LIMITER.threshold, LIMITER.ratio]);
  });
  it('adds sparse crackle only, -48 dB before the slider and about -52.8 dBFS at the default, and a 4 cent tape wobble', () => {
    expect(TEXTURE_DB).toBe(-48);
    expect(TAPE_WOBBLE_CENTS).toBe(4);
    const { ctx } = listen('sunny-morning-1star', 101);
    const lowpass = ctx.of('filter').find(f => f.type === 'lowpass' && f.frequency.value === 7000)!;
    const makeup = ctx.of('compressor')[0]!.connections[0];
    const texture = ctx.of('gain').find(g => g !== makeup && g.connections.includes(lowpass))!;
    // No lift: the texture gain is the level itself, and the music slider after it scales it.
    expect(texture.gain.value).toBeCloseTo(dbToGain(-48), 8);
    const shelf = lowpass.connections[0] as Node;
    const slider = shelf.connections[0] as Node;
    expect(slider.gain.value).toBeCloseTo(0.6);
    // At the default slider: -48 dB times 0.6 is -52.4 dB of gain; the 4 kHz low-pass takes
    // another 0.4 dB off the unit-RMS pops, so the crackle measures -52.8 dBFS RMS at the output.
    expect(20 * Math.log10(texture.gain.value * slider.gain.value)).toBeCloseTo(-52.4, 1);
    // The crackle source goes through a 4 kHz low-pass into the texture gain.
    const crackleLow = ctx.of('filter').find(f => f.connections.includes(texture))!;
    expect([crackleLow.type, crackleLow.frequency.value]).toEqual(['lowpass', 4000]);
    const source = ctx.of('source').find(s => s.connections.includes(crackleLow))!;
    const data = (source.buffer as unknown as { getChannelData(): Float32Array }).getChannelData();
    // No hiss: silence between pops. Pops: at most 6 in any second, each under 15 ms.
    const pops: Array<[number, number]> = [];
    for (let i = 0; i < data.length; i += 1) {
      if (data[i] === 0) continue;
      const last = pops[pops.length - 1];
      if (last && i - last[1] < ctx.sampleRate * 0.02) last[1] = i; else pops.push([i, i]);
    }
    expect(data.filter(v => v !== 0).length / data.length).toBeLessThan(0.05);
    expect(pops.length).toBeGreaterThan(0);
    for (const [from, to] of pops) expect((to - from + 1) / ctx.sampleRate).toBeLessThan(0.015);
    const looped = [...pops.map(p => p[0]), ...pops.map(p => p[0] + data.length)];
    for (const at of looped) expect(looped.filter(t => t >= at && t <= at + ctx.sampleRate).length).toBeLessThanOrEqual(6);
    expect(ctx.of('gain').some(g => g.gain.value === TAPE_WOBBLE_CENTS)).toBe(true);
  });
  it('mutes the crackle while rain or a storm plays and brings it back when the weather clears', () => {
    for (const [name, seed] of [['rainy-tuesday-5star', 202], ['storm-night-tower', 404]] as const) {
      const { ctx, sound, run } = listen(name, seed);
      const lowpass = ctx.of('filter').find(f => f.type === 'lowpass' && f.frequency.value === 7000)!;
      const makeup = ctx.of('compressor')[0]!.connections[0];
      const texture = ctx.of('gain').find(g => g !== makeup && g.connections.includes(lowpass))!;
      expect(sound.weatherKind).toBe(name === 'rainy-tuesday-5star' ? 'rain' : 'storm');
      expect(texture.gain.value).toBe(0);
      run(2);
      sound.pin!(elapsed => presetInputs('sunny-morning-1star', elapsed));
      expect(sound.weatherKind).toBe('clear');
      expect(texture.gain.value).toBeCloseTo(dbToGain(TEXTURE_DB), 8);
    }
  });
  it('schedules only a short way ahead so a changed mood is heard within a bar or so', () => {
    expect(LOOKAHEAD_SECONDS).toBeGreaterThan(0.5);
    expect(LOOKAHEAD_SECONDS).toBeLessThanOrEqual(2);
  });
});

// ------------------------------------------------------------------ the mood

describe('mood shapes the band', () => {
  const melodic = (voices: readonly Voice[]) => voices.filter(v => MELODIC.has(v)).length;
  it('never plays more than three melodic voices, in any chapter, energy or phrase', () => {
    expect(MAX_MELODIC).toBe(3);
    for (const chapter of [1, 2, 3, 4, 5, 6] as Chapter[]) {
      for (const weekend of [false, true]) {
        for (let e = 0; e <= 1; e += 0.1) {
          for (let phrase = 0; phrase < 8; phrase += 1) expect(melodic(activeLayers(chapter, e, 0, weekend, phrase))).toBeLessThanOrEqual(3);
        }
      }
    }
  });
  it('holds the cap in the live scheduler, through the featured rotations', () => {
    for (const name of PRESET_NAMES) {
      const { sound, run } = listen(name, 303);
      let most = 0;
      run(90, () => { most = Math.max(most, melodic(sound.activeVoices!)); });
      expect(most).toBeLessThanOrEqual(3);
    }
  });
  it('makes weekend night at five stars the fullest and warmest scene', () => {
    const voices = (name: (typeof PRESET_NAMES)[number]) => {
      const p = PRESETS[name];
      const mood = moodFor(presetInputs(name, 30));
      return { mood, layers: activeLayers(p.chapter, mood.energy, mood.tension, p.isWeekend, 0) };
    };
    const weekend = voices('weekend-night-5star');
    for (const name of PRESET_NAMES.filter(n => n !== 'weekend-night-5star')) {
      const other = voices(name);
      expect(weekend.layers.length).toBeGreaterThan(other.layers.length);
      expect(weekend.mood.warmth).toBeGreaterThanOrEqual(other.mood.warmth);
    }
    expect(melodic(weekend.layers)).toBe(3);
  });
  it('thins the band and stops the kit under tension, and brings the kit back on the bar after an all-clear', () => {
    expect(activeLayers(5, 1, 1)).not.toContain('drums');
    expect(melodic(activeLayers(6, 1, 0.5))).toBeLessThan(melodic(activeLayers(6, 1, 0)));
    const { ctx, sound, run } = listen('fire-3star', 505);
    const kicks = () => ctx.of('source').filter(s => s.buffer?.length === renderPiece('kick', 8000).length && s.startedAt !== null);
    run(19.5);
    expect(kicks()).toHaveLength(0);
    run(30);
    const bar = 4 * 60 / sound.tempo!;
    const first = Math.min(...kicks().map(k => k.startedAt!));
    // Released at 20 s: the first kick falls within two bars of the release.
    expect(first).toBeLessThan(20 + 2 * bar + 0.1);
  });
  it('keeps the dark storm night on the minor colour and the weekend night on the warm one', () => {
    const storm = moodFor(presetInputs('storm-night-tower', 0));
    const weekend = moodFor(presetInputs('weekend-night-5star', 0));
    expect(storm.warmth).toBeLessThan(0.3);
    expect(weekend.warmth).toBeGreaterThan(0.6);
    expect(voicesFor(5, true)).toContain('pluck');
  });
});

// ------------------------------------------------------------------ elevator bells

describe('muted elevator bells', () => {
  it('has four wooden timbres with fundamentals between 330 and 520 Hz', () => {
    expect(BELL_TIMBRES).toHaveLength(4);
    for (const pair of BELL_TIMBRES) for (const hz of pair) { expect(hz).toBeGreaterThanOrEqual(330); expect(hz).toBeLessThanOrEqual(520); }
    expect(new Set(BELL_TIMBRES.map(p => p.join())).size).toBe(4);
    const ctx = new Ctx();
    playBell(ctx as unknown as AudioContextLike, ctx.destination as never, 2, 0);
    const fundamentals = ctx.of('osc').map(o => o.frequency.value).filter(hz => hz < 1000);
    expect(fundamentals.sort()).toEqual([...BELL_TIMBRES[2]!].sort());
  });
  it('strikes like a bar: attack under 5 ms, decay under 250 ms, a 2.5 kHz low-pass, -14 dBFS peak', () => {
    expect(BELL.attack).toBeLessThan(0.005);
    expect(BELL.decay).toBeLessThan(0.25);
    expect(BELL.lowpassHz).toBe(2500);
    expect(BELL.peakDb).toBe(-14);
    for (const play of [
      (c: AudioContextLike, n: AudioNode) => playBell(c, n, 0, 0),
      (c: AudioContextLike, n: AudioNode) => playBellTick(c, n, 0),
      (c: AudioContextLike, n: AudioNode) => playDoorSwish(c, n, 0),
    ]) {
      const ctx = new Ctx();
      play(ctx as unknown as AudioContextLike, ctx.destination as never);
      const lowpasses = ctx.of('filter').filter(f => f.type === 'lowpass');
      expect(lowpasses.length).toBeGreaterThan(0);
      for (const f of lowpasses) expect(f.frequency.value).toBe(2500);
      // Envelope gains end at silence; their loudest point is at most -14 dBFS.
      const envelopes = ctx.of('gain').filter(g => g.connections.includes(ctx.destination));
      expect(envelopes.length).toBeGreaterThan(0);
      for (const env of envelopes) expect(env.gain.value).toBeLessThanOrEqual(0.0001);
    }
    // The first note's envelope rises to exactly -14 dBFS; the partial levels sum to at most 1.
    const ctx = new Ctx();
    const peaks: number[] = [];
    const orig = Param.prototype.linearRampToValueAtTime;
    Param.prototype.linearRampToValueAtTime = function (this: Param, v: number) { peaks.push(v); return orig.call(this, v); };
    try { playBell(ctx as unknown as AudioContextLike, ctx.destination as never, 1, 0); } finally { Param.prototype.linearRampToValueAtTime = orig; }
    expect(20 * Math.log10(Math.max(...peaks))).toBeCloseTo(-14, 5);
    const partials = ctx.of('gain').filter(g => ctx.of('osc').some(o => o.connections.includes(g)));
    expect(partials.slice(0, 2).reduce((sum, g) => sum + g.gain.value, 0)).toBeLessThanOrEqual(1);
  });
  it('waits 1.5 s between any two bell or door sounds', () => {
    const gate = createBellGate();
    expect(gate.arrive(0)).toBe('bell');
    expect(gate.doors(500)).toBe(null);
    expect(gate.arrive(1400)).toBe(null);
    expect(gate.doors(3000)).toBe('door');
    expect(gate.doors(4000)).toBe(null);
    expect(gate.arrive(4600)).toBe('bell'); // three arrivals in 5 s: not a burst
  });
  it('drops to one soft tick per 5 s when more than three cars arrive within 5 s, until the burst passes', () => {
    const gate = createBellGate();
    const heard: [number, string | null][] = [];
    for (let t = 0; t <= 20000; t += 700) heard.push([t, gate.arrive(t)]);
    expect(heard[0]![1]).toBe('bell');
    const ticks = heard.filter(([, h]) => h === 'tick').map(([t]) => t);
    expect(heard.filter(([, h]) => h === 'bell')).toHaveLength(1);
    expect(ticks[0]).toBe(2100); // the fourth arrival in 5 s
    for (let i = 1; i < ticks.length; i += 1) expect(ticks[i]! - ticks[i - 1]!).toBeGreaterThanOrEqual(5000);
    expect(gate.doors(20100)).toBe(null); // no doors inside a burst
    // Quiet for 5 s: the burst has passed and the next arrival rings again.
    expect(gate.arrive(26000)).toBe('bell');
  });
  it('rings the controller through the gate, one timbre per shaft', () => {
    const { ctx, sound } = listen('rush-hour-3star', 606);
    const before = ctx.of('osc').length;
    sound.devEvent!({ kind: 'car.arrive', shaftId: 3, carId: 1 });
    const rung = ctx.of('osc').slice(before).map(o => o.frequency.value).filter(hz => hz < 1000);
    expect(rung.sort()).toEqual([...BELL_TIMBRES[3]!].sort());
    const after = ctx.of('osc').length;
    sound.devEvent!({ kind: 'car.arrive', shaftId: 1, carId: 2 }); // same instant: inside the cooldown
    expect(ctx.of('osc')).toHaveLength(after);
  });
});
