/** Musical time is always real time; game speed only changes the colour controls. */
/** Nominal exports remain useful to callers; a world chooses its actual tempo once. */
export const TEMPO = 76;
export function tempoFor(seed: number): number {
  const h = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  return 72 + (h % 11);
}
export function keyFor(seed: number): number {
  const keys = [0, 2, 3, 5, 7, 9, 10]; // C, D, E-flat, F, G, A, B-flat
  return keys[(Math.imul((seed | 0) ^ 0x5bd1e995, 0xc2b2ae35) >>> 0) % keys.length]!;
}
export function swingFor(energy: number): number { return 0.66 - 0.08 * Math.min(1, Math.max(0, energy)); }
/** Straight grid position to swung position: offbeat eighths land at `swing` of the beat. */
export function swingBeat(beat: number, swing: number): number {
  const whole = Math.floor(beat);
  const frac = beat - whole;
  if (Math.abs(frac - 0.5) < 1e-9) return whole + swing;
  if (Math.abs(frac - 0.25) < 1e-9) return whole + swing / 2;
  if (Math.abs(frac - 0.75) < 1e-9) return whole + swing + (1 - swing) / 2;
  return beat;
}

export const BEAT_SECONDS = 60 / TEMPO;
export const BAR_SECONDS = BEAT_SECONDS * 4;
export const PHRASE_BARS = 8;
export const ASCENT = [261.63, 329.63, 392, 440, 523.25];
export const LIVES_INSIDE = [392, 349.23, 329.63, 261.63];

export type Chapter = 1 | 2 | 3 | 4 | 5 | 6;
export type Voice = 'piano' | 'bass' | 'drums' | 'hat' | 'guitar' | 'pluck' | 'pulse' | 'brass' | 'horn' | 'counter' | 'vibes' | 'kinetic' | 'pad' | 'lead' | 'strings';

export function chapterFor(stars: number): Chapter {
  return Math.max(1, Math.min(6, Math.floor(stars))) as Chapter;
}
export function isNight(minute: number): boolean {
  const m = ((minute % 1440) + 1440) % 1440;
  return m >= 1380 || m < 360;
}
export function isDaytime(minute: number): boolean {
  const m = ((minute % 1440) + 1440) % 1440;
  return m >= 420 && m < 1020;
}
export function hatVelocityMultiplier(minute: number): number { return isDaytime(minute) ? 1.12 : 1; }

/** The permanent instruments in each mood. Optional weekend voices are selected in the player. */
export const CHAPTER_VOICES: Readonly<Record<Chapter, readonly Voice[]>> = {
  1: ['piano', 'bass', 'drums', 'hat'],
  2: ['piano', 'bass', 'drums', 'hat', 'guitar'],
  3: ['piano', 'bass', 'drums', 'hat', 'guitar', 'pulse', 'brass'],
  4: ['piano', 'bass', 'drums', 'hat', 'guitar', 'pulse', 'brass', 'horn', 'counter'],
  5: ['piano', 'bass', 'drums', 'hat', 'pad', 'guitar', 'pulse', 'brass', 'horn', 'counter', 'vibes', 'kinetic'],
  6: ['piano', 'bass', 'drums', 'hat', 'pad', 'lead', 'counter', 'strings', 'guitar', 'pulse', 'brass', 'horn', 'vibes', 'kinetic'],
};

/** Semitones above each chapter's tonic. The modes change the colour without leaving the motif family. */
export const CHAPTER_SCALES: Readonly<Record<Chapter, readonly number[]>> = {
  1: [0, 2, 4, 5, 7, 9, 11],
  2: [0, 2, 3, 5, 7, 9, 10],
  3: [0, 2, 3, 5, 7, 8, 10],
  4: [0, 2, 4, 6, 7, 9, 11],
  5: [0, 2, 4, 5, 7, 9, 10],
  6: [0, 2, 4, 5, 7, 9, 11],
};

export function scaleMidi(chapter: Chapter, degree: number, octave = 0): number {
  const scale = CHAPTER_SCALES[chapter];
  const wraps = Math.floor(degree / 7);
  const index = ((degree % 7) + 7) % 7;
  return 60 + 12 * (wraps + octave) + scale[index]!;
}
export function midiHz(midi: number): number { return 440 * 2 ** ((midi - 69) / 12); }
export function inChapterScale(chapter: Chapter, frequency: number): boolean {
  const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
  return CHAPTER_SCALES[chapter].includes(((midi - 60) % 12 + 12) % 12);
}

/**
 * One small replaceable synth recipe per instrument. `maxHz` bounds the fundamental: every
 * phrase folds notes down by octaves until they sit at or under it, so no voice can hold a
 * tone above 1 kHz. Peaks are linear on the music bus before the compressor.
 */
export interface VoiceDefinition {
  wave: OscillatorType;
  attack: number;
  release: number;
  peak: number;
  cutoff: number;
  maxHz: number;
  /** Level the note settles to after its strike, as a fraction of peak; 0 rings straight out. */
  sustain: number;
  detune?: number;
  tremolo?: number;
}
/** The Rhodes-like keys never open above this, however warm the room. */
export const KEYS_CUTOFF_HZ = 2500;
export const VOICES: Readonly<Record<Voice, VoiceDefinition>> = {
  piano: { wave: 'sine', attack: 0.014, release: 2.2, peak: 0.075, cutoff: KEYS_CUTOFF_HZ, maxHz: 880, sustain: 0.3, detune: 6 },
  drums: { wave: 'sine', attack: 0.004, release: 0.42, peak: 0, cutoff: 6000, maxHz: 200, sustain: 0 }, // drums.ts
  bass: { wave: 'sine', attack: 0.022, release: 1.2, peak: 0.075, cutoff: 200, maxHz: 200, sustain: 0.4 },
  hat: { wave: 'sine', attack: 0.002, release: 0.04, peak: 0, cutoff: 7000, maxHz: 200, sustain: 0 }, // noise voice in drums.ts
  guitar: { wave: 'triangle', attack: 0.006, release: 0.28, peak: 0.07, cutoff: 1800, maxHz: 700, sustain: 0, detune: 4 },
  pluck: { wave: 'triangle', attack: 0.006, release: 0.26, peak: 0.06, cutoff: 1800, maxHz: 700, sustain: 0, detune: 3 },
  pulse: { wave: 'triangle', attack: 0.01, release: 0.22, peak: 0.035, cutoff: 1200, maxHz: 600, sustain: 0 },
  brass: { wave: 'sawtooth', attack: 0.18, release: 1.2, peak: 0.03, cutoff: 1100, maxHz: 520, sustain: 0.8 },
  horn: { wave: 'sawtooth', attack: 0.14, release: 1.2, peak: 0.028, cutoff: 950, maxHz: 440, sustain: 0.8 },
  counter: { wave: 'triangle', attack: 0.04, release: 0.6, peak: 0.055, cutoff: 1600, maxHz: 800, sustain: 0.6 },
  vibes: { wave: 'sine', attack: 0.003, release: 0.34, peak: 0.07, cutoff: 3000, maxHz: 1000, sustain: 0, detune: 3, tremolo: 4.5 },
  kinetic: { wave: 'sine', attack: 0.002, release: 0.05, peak: 0, cutoff: 7000, maxHz: 200, sustain: 0 }, // noise voice in drums.ts
  pad: { wave: 'sine', attack: 0.6, release: 2.4, peak: 0.022, cutoff: 1100, maxHz: 700, sustain: 1 },
  lead: { wave: 'triangle', attack: 0.03, release: 0.7, peak: 0.055, cutoff: 1800, maxHz: 880, sustain: 0.6 },
  strings: { wave: 'sawtooth', attack: 0.7, release: 2.6, peak: 0.012, cutoff: 900, maxHz: 700, sustain: 1, detune: 5 },
};
/** Voices that carry a line or comping part; at most three of them sound at once. */
export const MELODIC: ReadonlySet<Voice> = new Set<Voice>(['piano', 'guitar', 'pluck', 'pulse', 'brass', 'horn', 'counter', 'vibes', 'lead']);
export const MAX_MELODIC = 3;
/** Sustained harmony under the band; at most one plays. */
export const BEDS: ReadonlySet<Voice> = new Set<Voice>(['pad', 'strings']);

/** Entries are relative to the continuous arrangement, not separate tracks. */
export const ENTRY_THRESHOLD: Readonly<Record<Voice, number>> = {
  piano: 0, bass: 0, drums: 0.15, hat: 0.2,
  guitar: 0.35, pluck: 0.35, pulse: 0.45, counter: 0.5,
  brass: 0.6, horn: 0.65, vibes: 0.7, kinetic: 0.8,
  pad: 0.3, lead: 0.55, strings: 0.3,
};
export type ChordColour = 'major9' | 'dominant9' | 'minor11';
export function chordColourFor(warmth: number, tension = 0): ChordColour {
  if (tension > 0.2 || warmth < 0.3) return 'minor11';
  return warmth > 0.6 ? 'major9' : 'dominant9';
}
export function cutoffForWarmth(warmth: number): number {
  return 1200 + 4800 * Math.min(1, Math.max(0, (warmth - 0.3) / 0.7));
}
/** Close upper voicings; the bass supplies the root. */
export const CHORD_INTERVALS: Readonly<Record<ChordColour, readonly number[]>> = {
  major9: [4, 7, 11, 14, 18],
  dominant9: [4, 7, 10, 14],
  minor11: [3, 7, 10, 14, 17],
};

/** Fit a musical cue to the active mode and world key; alerts keep their distinct pitches. */
export function musicalHz(hz: number, key: number, chapter: Chapter): number {
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  let nearest = midi;
  let distance = Infinity;
  for (let candidate = midi - 2; candidate <= midi + 2; candidate += 1) {
    if (CHAPTER_SCALES[chapter].includes(((candidate % 12) + 12) % 12) && Math.abs(candidate - midi) < distance) {
      nearest = candidate; distance = Math.abs(candidate - midi);
    }
  }
  return midiHz(nearest + key);
}
