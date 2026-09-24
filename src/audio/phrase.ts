import { CHAPTER_VOICES, CHORD_INTERVALS, chordColourFor, midiHz, scaleMidi, type Chapter, type Voice } from './score';

/** Beat is measured from the start of an eight-bar phrase; dur is in beats. */
export interface Note { beat: number; freq: number; dur: number; vel: number }
export interface PhraseStyle { density?: number; key?: number; warmth?: number; tension?: number; energy?: number; night?: boolean }

// Same 32-bit avalanche as weatherAt's mix; local so audio cannot change the weather contract.
function mix(a: number, b: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ b, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const VOICE_IDS: readonly Voice[] = ['piano', 'bass', 'hat', 'guitar', 'pluck', 'pulse', 'brass', 'horn', 'counter', 'vibes', 'kinetic', 'pad', 'lead', 'strings'];
function hashed(seed: number, chapter: Chapter, index: number, voice: Voice, slot: number): number {
  const id = VOICE_IDS.indexOf(voice) + 1;
  const first = Math.floor(mix(seed | 0, chapter) * 4294967296);
  const second = Math.floor(mix(first, index | 0) * 4294967296);
  const third = Math.floor(mix(second, id) * 4294967296);
  return mix(third, slot);
}
function degreeNote(chapter: Chapter, degree: number, octave: number, beat: number, dur: number, vel: number): Note {
  return { beat, freq: midiHz(scaleMidi(chapter, degree, octave)), dur, vel };
}

/** Pure, seeded variation of ASCENT and LIVES-INSIDE across eight bars. */
export function phraseFor(seed: number, chapter: Chapter, phraseIndex: number, voice: Voice, style: PhraseStyle = {}): Note[] {
  if (voice === 'drums' || voice === 'hat') return []; // both are noise percussion
  const notes: Note[] = [];
  const roots = [0, 3, 4, 0, 5, 3, 4, 0];
  const ascent = [0, 2, 4, 5, 7];
  const lives = [4, 3, 2, 0];
  for (let bar = 0; bar < 8; bar += 1) {
    const at = bar * 4;
    const candidate = roots[bar]!;
    const root = scaleMidi(chapter, candidate + 4) - scaleMidi(chapter, candidate) === 7 ? candidate : 0;
    const choice = hashed(seed, chapter, phraseIndex, voice, bar);
    const shift = [0, 1, 3, 4][Math.floor(choice * 4)]!;
    const invert = hashed(seed, chapter, phraseIndex, voice, 30 + bar) < 0.32;
    const offset = [0, 0.125, 0.25][Math.floor(hashed(seed, chapter, phraseIndex, voice, 50 + bar) * 3)]!;
    const velocity = 0.72 + 0.22 * hashed(seed, chapter, phraseIndex, voice, 70 + bar);
    if (voice === 'bass') {
      // Roots and their diatonic fifths only. No transposition may escape the chord.
      notes.push(degreeNote(chapter, root, -2, at, 1.7, velocity));
      notes.push(degreeNote(chapter, root + 4, -2, at + 2, 1.2, velocity * 0.8));
      continue;
    }
    if (voice === 'pulse' || voice === 'kinetic') {
      const divisions = voice === 'kinetic' ? 16 : 8;
      for (let i = 0; i < divisions; i += 1) {
        if (i % 4 !== 0 && hashed(seed, chapter, phraseIndex, voice, bar * 16 + i + 100) < 0.26) continue;
        // Kinetic notes carry timing only; drums.ts renders each as a filtered noise click.
        notes.push(degreeNote(chapter, voice === 'kinetic' ? 0 : root + (i % 4 === 0 ? 0 : 4), voice === 'kinetic' ? -2 : -1, at + i * 4 / divisions, voice === 'kinetic' ? 0.06 : 0.22, velocity * 0.5));
      }
      continue;
    }
    if (voice === 'pad' || voice === 'strings') {
      if (style.warmth !== undefined) {
        const chordRoot = scaleMidi(chapter, root, -2);
        for (const semitones of CHORD_INTERVALS[chordColourFor(style.warmth, style.tension)]) {
          notes.push({ beat: at, freq: midiHz(chordRoot + semitones), dur: 3.8, vel: velocity * 0.38 });
        }
        continue;
      }
      for (const degree of [root, root + 2, root + 4]) notes.push(degreeNote(chapter, degree, voice === 'strings' ? -1 : -2, at, 3.8, velocity * 0.55));
      continue;
    }
    // Lead and answer alternate bars. Their melodic density never competes in one bar.
    if (voice === 'lead' && bar % 2 === 1 || voice === 'counter' && bar % 2 === 0) continue;
    const quietAnswer = (voice === 'piano' || voice === 'lead' || voice === 'brass') && (style.night || (style.energy ?? 0.7) < 0.4);
    const motif = voice === 'counter' || quietAnswer || (voice === 'guitar' || voice === 'pluck') && bar % 2 === 1 ? lives : ascent;
    const count = voice === 'brass' || voice === 'horn' ? 2 : voice === 'guitar' || voice === 'pluck' ? 4 : voice === 'vibes' ? 3 : motif.length;
    for (let i = 0; i < count; i += 1) {
      if (i > 0 && hashed(seed, chapter, phraseIndex, voice, 200 + bar * 8 + i) < 0.2) continue;
      const base = motif[i % motif.length]!;
      const degree = shift + (invert ? motif[0]! - (base - motif[0]!) : base);
      const beat = at + Math.min(3.75, i * (voice === 'guitar' || voice === 'pluck' ? 0.75 : 0.7) + offset);
      const octave = voice === 'horn' || voice === 'brass' ? -1 : voice === 'vibes' ? 1 : 0;
      notes.push(degreeNote(chapter, degree, octave, beat, voice === 'guitar' || voice === 'pluck' || voice === 'vibes' ? 0.32 : 0.6, velocity));
    }
    // A fixed harmonic reply lets chapter 4's VIP colour resolve into LIVES-INSIDE.
    if (chapter >= 4 && voice === 'horn' && bar === 3) {
      lives.forEach((degree, i) => notes.push(degreeNote(chapter, degree, -1, at + i * 0.8, 0.55, velocity * 0.7)));
    }
    if (voice === 'piano' && style.warmth !== undefined) {
      const chordRoot = scaleMidi(chapter, root, -1);
      for (const semitones of CHORD_INTERVALS[chordColourFor(style.warmth, style.tension)]) {
        notes.push({ beat: at, freq: midiHz(chordRoot + semitones), dur: 2.5, vel: velocity * 0.42 });
      }
    }
  }
  const density = Math.min(1, Math.max(0.4, style.density ?? 1));
  const selected = density === 1 ? notes : notes.filter((note, index) => note.beat % 4 === 0 || hashed(seed, chapter, phraseIndex, voice, 400 + index) < density);
  if (style.key) for (const note of selected) note.freq *= 2 ** (style.key / 12);
  // Octave folding preserves the chosen scale while bounding every sustained fundamental.
  for (const note of selected) {
    const ceiling = voice === 'vibes' ? 1046 : 1500;
    while (note.freq > ceiling) note.freq /= 2;
  }
  // Index influences the seed, and therefore the entire pattern. A tiny velocity signature
  // ensures adjacent long-session phrases stay distinct even if two random choices coincide.
  if (selected[0]) selected[0].vel = Math.min(1, selected[0].vel + (phraseIndex % 997) * 0.000001);
  return selected;
}

export function voicesFor(chapter: Chapter, weekend: boolean): readonly Voice[] {
  const base = CHAPTER_VOICES[chapter];
  if (weekend && chapter === 1) return [...base, 'guitar'];
  if (weekend && (chapter === 2 || chapter === 3)) return [...base, 'counter'];
  if (weekend && chapter >= 4) return [...base, 'pluck'];
  return base;
}
