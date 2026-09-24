import {
  CHAPTER_VOICES, VOICES, chordColourFor, midiHz, scaleMidi, swingBeat, swingFor,
  type Chapter, type ChordColour, type Voice,
} from './score';

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
function hashedId(seed: number, chapter: Chapter, index: number, id: number, slot: number): number {
  const first = Math.floor(mix(seed | 0, chapter) * 4294967296);
  const second = Math.floor(mix(first, index | 0) * 4294967296);
  const third = Math.floor(mix(second, id) * 4294967296);
  return mix(third, slot);
}
function hashed(seed: number, chapter: Chapter, index: number, voice: Voice, slot: number): number {
  return hashedId(seed, chapter, index, VOICE_IDS.indexOf(voice) + 1, slot);
}

// ------------------------------------------------------------------ harmony

/** Chord roots per bar (scale degrees), two bars a chord. Warmth picks the family. */
export const PROGRESSIONS: Readonly<Record<ChordColour, readonly (readonly number[])[]>> = {
  major9: [[0, 0, 5, 5, 1, 1, 4, 4], [0, 0, 3, 3, 1, 1, 4, 4], [0, 0, 5, 5, 3, 3, 4, 4]],
  dominant9: [[0, 0, 3, 3, 0, 0, 4, 4], [3, 3, 0, 0, 1, 1, 4, 4], [0, 0, 1, 1, 3, 3, 4, 4]],
  minor11: [[5, 5, 3, 3, 5, 5, 1, 1], [5, 5, 1, 1, 3, 3, 4, 4], [5, 5, 3, 3, 0, 0, 4, 4]],
};
function perfectFifth(chapter: Chapter, degree: number): boolean {
  return scaleMidi(chapter, degree + 4) - scaleMidi(chapter, degree) === 7;
}
/** A root whose fifth is perfect in this chapter's mode; the tonic always qualifies. */
export function chordRootFor(chapter: Chapter, degree: number): number {
  if (perfectFifth(chapter, degree)) return degree;
  for (const alt of [4, 3, 0]) if (perfectFifth(chapter, alt)) return alt;
  return 0;
}
/** One progression holds for two phrases (sixteen bars) so the loop repeats before it moves. */
export function progressionFor(seed: number, chapter: Chapter, phraseIndex: number, colour: ChordColour): number[] {
  const bank = PROGRESSIONS[colour];
  const pick = bank[Math.floor(hashedId(seed, chapter, Math.floor(phraseIndex / 2), 90, 0) * bank.length)]!;
  return pick.map(degree => chordRootFor(chapter, degree));
}
/** Scale-degree offsets above the root: sevenths and ninths, with a thirteenth or eleventh. */
const COLOUR_OFFSETS: Readonly<Record<ChordColour, readonly number[]>> = {
  major9: [2, 4, 6, 8],
  dominant9: [2, 6, 8, 12],
  minor11: [2, 6, 8, 10],
};
/** A close rootless voicing in MIDI, from E3 up to E5; the bass supplies the root. */
export function chordTones(chapter: Chapter, root: number, colour: ChordColour): number[] {
  const rootMidi = scaleMidi(chapter, root, -1);
  const majorThird = scaleMidi(chapter, root + 2, -1) - rootMidi === 4;
  const tones = COLOUR_OFFSETS[colour].map(offset => {
    let degree = root + offset;
    const interval = (scaleMidi(chapter, degree, -1) - rootMidi) % 12;
    if (offset === 8 && interval === 1) degree = root + 4; // no flat ninth
    if (offset === 10 && majorThird && interval === 5) degree = root + 4; // no eleventh on a major third
    if (offset === 12 && interval === 8) degree = root + 4; // no flat thirteenth
    let midi = scaleMidi(chapter, degree, -1);
    while (midi > 76) midi -= 12;
    while (midi < 52) midi += 12;
    return midi;
  });
  return [...new Set(tones)].sort((a, b) => a - b);
}

/** One-bar comping rhythms: [beat, length in beats, velocity]. Offbeats are swung when played. */
export const COMP_FIGURES: readonly (readonly (readonly [number, number, number])[])[] = [
  [[0, 1.5, 1], [2.5, 1.25, 0.8]],
  [[0.5, 1.25, 0.9], [2, 1.75, 0.85]],
  [[0, 2.75, 1], [3.5, 0.5, 0.7]],
  [[0, 0.75, 1], [1.5, 1, 0.8], [3, 0.75, 0.75]],
  [[0, 3.5, 0.9]],
  [[0, 1, 1], [1.5, 0.5, 0.7], [2.5, 1.25, 0.85]],
];
function figureFor(seed: number, chapter: Chapter, phraseIndex: number, energy: number): number {
  const tier = energy < 0.35 ? [4, 2] : energy < 0.7 ? [0, 1, 2, 4] : [0, 1, 3, 5];
  return tier[Math.floor(hashedId(seed, chapter, phraseIndex, 91, 0) * tier.length)]!;
}
/** Short melodic rhythms for the lines, in beats. */
const LINE_RHYTHMS: readonly (readonly number[])[] = [[0, 0.5, 1.5], [0.5, 1, 2], [1, 1.5, 2.5], [0, 1, 1.5]];
const ASCENT = [0, 2, 4, 5, 7];
const LIVES = [4, 3, 2, 0];

// ------------------------------------------------------------------ phrases

/** Pure, seeded eight bars for one voice: comping, bass, beds and short lines over the chords. */
export function phraseFor(seed: number, chapter: Chapter, phraseIndex: number, voice: Voice, style: PhraseStyle = {}): Note[] {
  if (voice === 'drums' || voice === 'hat') return []; // both are noise percussion
  const energy = style.energy ?? 0.7;
  const colour = chordColourFor(style.warmth ?? 0.7, style.tension);
  const roots = progressionFor(seed, chapter, phraseIndex, colour);
  const swing = swingFor(energy);
  const sw = (beat: number): number => swingBeat(beat, swing);
  const h = (slot: number): number => hashed(seed, chapter, phraseIndex, voice, slot);
  const notes: Note[] = [];
  const push = (beat: number, midi: number, dur: number, vel: number): void => {
    notes.push({ beat, freq: midiHz(midi), dur, vel: Math.min(1, vel) });
  };
  const quiet = style.night === true || energy < 0.4;
  const figure = COMP_FIGURES[figureFor(seed, chapter, phraseIndex, energy)]!;
  const rhythm = LINE_RHYTHMS[Math.floor(h(5) * LINE_RHYTHMS.length)]!;
  for (let bar = 0; bar < 8; bar += 1) {
    const at = bar * 4;
    const root = roots[bar]!;
    const chord = chordTones(chapter, root, colour);
    const velocity = 0.8 + 0.2 * h(70 + bar);
    const newChord = bar % 2 === 0;
    switch (voice) {
      case 'bass': {
        const rootMidi = scaleMidi(chapter, root, -2);
        push(at, rootMidi, energy < 0.35 ? 3.5 : 1.75, velocity);
        if (energy >= 0.35) push(at + sw(2.5), h(10 + bar) < 0.4 ? rootMidi + 12 : rootMidi + 7, 1, velocity * 0.8);
        // A swung pickup on the "and" of four walks into each chord change, and now and then
        // into the second bar of a chord.
        if (energy >= 0.45 && (!newChord || h(15 + bar) < 0.35)) push(at + sw(3.5), rootMidi + 7, 0.45, velocity * 0.7);
        break;
      }
      case 'piano': {
        // The figure repeats every bar; a bar sometimes drops its last hit or lifts its top note.
        const drop = figure.length > 1 && h(20 + bar) < 0.2;
        const lift = h(30 + bar) < 0.3;
        const voicing = lift ? [...chord.slice(1), chord[0]! + 12] : chord;
        figure.forEach(([beat, dur, vel], i) => {
          if (drop && i === figure.length - 1) return;
          for (const midi of voicing) push(at + sw(beat), midi, dur, velocity * vel * 0.85);
        });
        // A two-note answer at the end of bars four and eight.
        if (!quiet && (bar === 3 || bar === 7)) {
          const top = chord[chord.length - 1]!;
          push(at + sw(3.5), top + 12 > 81 ? top : top + 12, 0.5, velocity * 0.55);
          push(at + sw(3.75), chord[chord.length - 2]! + 12 > 81 ? chord[chord.length - 2]! : chord[chord.length - 2]! + 12, 0.75, velocity * 0.45);
        }
        break;
      }
      case 'pad':
      case 'strings':
        if (newChord) for (const midi of chord) push(at, midi - (voice === 'strings' ? 0 : 12), 7.5, velocity * 0.6);
        break;
      case 'guitar':
      case 'pluck': {
        const top = chord.slice(-2);
        for (const beat of [1.5, 3.5]) {
          if (h(40 + bar * 2 + beat) < 0.25) continue;
          for (const midi of top) push(at + sw(beat), midi, 0.35, velocity * 0.8);
        }
        break;
      }
      case 'pulse':
        // A lazy broken chord on the quarter notes, with the odd swung pickup.
        for (let i = 0; i < 4; i += 1) {
          if (i > 0 && h(100 + bar * 8 + i) < 0.25) continue;
          push(at + i, chord[i % chord.length]! - 12, 0.6, velocity * 0.6);
        }
        if (h(110 + bar) < 0.3) push(at + sw(3.5), chord[chord.length - 1]! - 12, 0.4, velocity * 0.45);
        break;
      case 'brass':
      case 'horn':
        // One long, soft guide tone per chord: the third, or the seventh.
        if (newChord) push(at + sw(0.5), chord[h(60 + bar) < 0.5 ? 0 : 1]! - 12, 3, velocity * 0.8);
        break;
      case 'kinetic':
        // A brushed shaker on the swung off-beats. The notes carry timing only; drums.ts plays them.
        for (let i = 0; i < 4; i += 1) {
          if (h(bar * 16 + i + 100) < 0.2) continue;
          push(at + sw(i + 0.5), scaleMidi(chapter, 0, -2), 0.06, velocity * 0.6);
        }
        break;
      default: {
        // Lines: lead and vibes answer on even bars, the counter line on odd bars.
        const odd = bar % 2 === 1;
        if ((voice === 'counter') !== odd) break;
        const motif = voice === 'counter' || quiet ? LIVES : ASCENT;
        const shift = [0, 2, 4][Math.floor(hashed(seed, chapter, phraseIndex, voice, 200 + (bar >> 1)) * 3)]!;
        rhythm.forEach((beat, i) => {
          if (i > 0 && h(210 + bar * 4 + i) < 0.2) return;
          const degree = root + shift + motif[i % motif.length]!;
          push(at + sw(beat), scaleMidi(chapter, degree, 0), voice === 'vibes' ? 0.5 : 0.9, velocity * 0.9);
        });
      }
    }
  }
  // Density thins whole hits (every note at one beat together), never the downbeats.
  const density = Math.min(1, Math.max(0.4, style.density ?? 1));
  const selected = density === 1 || voice === 'bass' || voice === 'pad' || voice === 'strings' ? notes
    : notes.filter(note => note.beat % 4 === 0 || hashed(seed, chapter, phraseIndex, voice, 400 + Math.round(note.beat * 8)) < density);
  if (style.key) for (const note of selected) note.freq *= 2 ** (style.key / 12);
  // Octave folding keeps the pitch class and bounds every fundamental under the voice's ceiling.
  const ceiling = VOICES[voice].maxHz;
  for (const note of selected) while (note.freq > ceiling) note.freq /= 2;
  // A tiny velocity signature keeps adjacent long-session phrases distinct.
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
