/** Musical time is always real time; game speed only changes the colour controls. */
export const TEMPO = 76;
export const BEAT_SECONDS = 60 / TEMPO;
export const BAR_SECONDS = BEAT_SECONDS * 4;
export const PHRASE_BARS = 8;
export const ASCENT = [261.63, 329.63, 392, 440, 523.25];
export const LIVES_INSIDE = [392, 349.23, 329.63, 261.63];

export type Chapter = 1 | 2 | 3 | 4 | 5 | 6;
export type Voice = 'piano' | 'bass' | 'hat' | 'guitar' | 'pluck' | 'pulse' | 'brass' | 'horn' | 'counter' | 'vibes' | 'kinetic' | 'pad' | 'lead' | 'strings';

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
  1: ['piano', 'bass', 'hat'],
  2: ['piano', 'bass', 'hat', 'guitar'],
  3: ['piano', 'bass', 'hat', 'guitar', 'pulse', 'brass'],
  4: ['piano', 'bass', 'hat', 'guitar', 'pulse', 'brass', 'horn', 'counter'],
  5: ['piano', 'bass', 'hat', 'guitar', 'pulse', 'brass', 'horn', 'counter', 'vibes', 'kinetic'],
  6: ['pad', 'bass', 'lead', 'counter', 'hat', 'strings', 'kinetic'],
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

/** One small replaceable synth recipe per instrument. Peaks remain below -6 dBFS on the music bus. */
export interface VoiceDefinition {
  wave: OscillatorType;
  attack: number;
  release: number;
  peak: number;
  cutoff: number;
  detune?: number;
  tremolo?: number;
}
export const VOICES: Readonly<Record<Voice, VoiceDefinition>> = {
  piano: { wave: 'triangle', attack: 0.012, release: 0.48, peak: 0.036, cutoff: 2300 },
  bass: { wave: 'sine', attack: 0.025, release: 0.65, peak: 0.07, cutoff: 500 },
  hat: { wave: 'triangle', attack: 0.002, release: 0.042, peak: 0.004, cutoff: 5000 },
  guitar: { wave: 'triangle', attack: 0.008, release: 0.2, peak: 0.027, cutoff: 2600, detune: 4 },
  pluck: { wave: 'triangle', attack: 0.008, release: 0.19, peak: 0.015, cutoff: 2300, detune: 3 },
  pulse: { wave: 'triangle', attack: 0.008, release: 0.12, peak: 0.014, cutoff: 1200 },
  brass: { wave: 'sawtooth', attack: 0.17, release: 0.38, peak: 0.015, cutoff: 1350 },
  horn: { wave: 'sawtooth', attack: 0.12, release: 0.5, peak: 0.012, cutoff: 1000 },
  counter: { wave: 'sine', attack: 0.03, release: 0.5, peak: 0.025, cutoff: 2000 },
  vibes: { wave: 'sine', attack: 0.004, release: 0.32, peak: 0.035, cutoff: 3300, detune: 3, tremolo: 6 },
  kinetic: { wave: 'triangle', attack: 0.004, release: 0.075, peak: 0.008, cutoff: 2000 },
  pad: { wave: 'sine', attack: 0.45, release: 2.2, peak: 0.02, cutoff: 1300 },
  lead: { wave: 'triangle', attack: 0.04, release: 0.72, peak: 0.032, cutoff: 2600 },
  strings: { wave: 'sawtooth', attack: 0.58, release: 2.5, peak: 0.01, cutoff: 950, detune: 5 },
};
