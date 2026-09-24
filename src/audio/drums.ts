import type { AudioContextLike } from './audio';
import { swingBeat, swingFor } from './score';

export { swingBeat };

/**
 * The boom-bap kit. A seeded bank of one-bar patterns: kick on one and on the "and" of two or
 * three with small variations, snare (or a rim click when the room is quiet) strictly on two and
 * four, hats on swung eighths with ghost notes, the whole kit laid back behind the beat.
 */
export type DrumKind = 'kick' | 'snare' | 'rim' | 'ghost' | 'hat' | 'open' | 'kinetic';
export interface DrumHit { kind: DrumKind; beat: number; lateSeconds: number; velocity: number }

/** Peak of each piece at velocity 1, in dBFS on the music bus (before the compressor). */
export const KIT_PEAK_DB: Readonly<Record<DrumKind, number>> = {
  kick: -12, snare: -12, rim: -15, ghost: -12, hat: -22, open: -25, kinetic: -30,
};
/** Kept for callers of the earlier kit: the noise pieces' linear peaks. */
export const NOISE_PEAK = {
  hat: 10 ** (KIT_PEAK_DB.hat / 20), open: 10 ** (KIT_PEAK_DB.open / 20),
  ghost: 10 ** (KIT_PEAK_DB.ghost / 20), kinetic: 10 ** (KIT_PEAK_DB.kinetic / 20),
} as const;

/** Kick positions in beats (0 is beat one). Offbeat eighths are swung when played. */
export const KICK_PATTERNS: readonly (readonly number[])[] = [
  [0, 2.5],
  [0, 1.5, 2.5],
  [0, 0.75, 2.5],
  [0, 1.5, 2.75],
  [0, 2.5, 3.75],
];
/** Beats two and four, and nothing else, for the backbeat. */
export const SNARE_BEATS: readonly number[] = [1, 3];

function hash(a: number, b: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ b, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}
const unit = (a: number, b: number): number => hash(a, b) / 4294967296;

export function kickPatternFor(seed: number, phraseIndex: number): readonly number[] {
  return KICK_PATTERNS[hash(seed | 0, phraseIndex | 0) % KICK_PATTERNS.length]!;
}
/** The laid-back offset: 30 ms at rest, 15 ms at full energy. */
export function lazyOffsetMs(energy: number): number {
  return 30 - 15 * Math.min(1, Math.max(0, energy));
}
export function drumHitsFor(seed: number, phraseIndex: number, barIndex: number, energy: number): DrumHit[] {
  if (energy < 0.15) return [];
  const e = Math.min(1, Math.max(0, energy));
  const late = lazyOffsetMs(e) / 1000;
  const swing = swingFor(e);
  const r = (slot: number): number => unit(hash(seed | 0, barIndex | 0), slot);
  const hits: DrumHit[] = [];
  const kicks = kickPatternFor(seed, phraseIndex);
  // The last bar of a phrase sometimes drops the second kick for a breath.
  const lastBar = barIndex % 8 === 7;
  kicks.forEach((beat, i) => {
    if (i > 0 && lastBar && r(1) < 0.5) return;
    hits.push({ kind: 'kick', beat: swingBeat(beat, swing), lateSeconds: late * 0.6, velocity: i === 0 ? 1 : 0.8 + 0.1 * r(2 + i) });
  });
  // Quiet rooms get a rim click instead of the snare; both sit on two and four.
  const back: DrumKind = e < 0.35 ? 'rim' : 'snare';
  for (const beat of SNARE_BEATS) hits.push({ kind: back, beat, lateSeconds: late, velocity: 0.88 + 0.12 * r(10 + beat) });
  // Swung eighth hats: a louder downbeat, a softer skip, with the odd one left out.
  for (let beat = 0; beat < 4; beat += 1) {
    hits.push({ kind: 'hat', beat, lateSeconds: late * 0.8, velocity: 0.75 + 0.15 * r(20 + beat) });
    if (e > 0.3 && !(r(30 + beat) < 0.15)) hits.push({ kind: 'hat', beat: beat + swing, lateSeconds: late * 0.8, velocity: 0.45 + 0.15 * r(40 + beat) });
  }
  if (e > 0.4) {
    // One or two ghost snares on swung sixteenths between the backbeats.
    const ghosts = [1.75, 2.25, 3.75, 0.75];
    const count = e > 0.75 ? 2 : 1;
    for (let i = 0; i < count; i += 1) {
      const beat = ghosts[(hash(seed ^ barIndex, phraseIndex + i) + i) % ghosts.length]!;
      hits.push({ kind: 'ghost', beat: swingBeat(beat, swing), lateSeconds: late, velocity: 0.16 + 0.06 * r(50 + i) });
    }
  }
  if (e > 0.5 && barIndex % 2 === 1) hits.push({ kind: 'open', beat: 3 + swing, lateSeconds: late * 0.8, velocity: 0.7 });
  return hits.sort((a, b) => a.beat - b.beat);
}

/** Seconds each baked piece lasts. */
const PIECE_SECONDS: Readonly<Record<DrumKind, number>> = {
  kick: 0.45, snare: 0.24, rim: 0.07, ghost: 0.12, hat: 0.05, open: 0.2, kinetic: 0.06,
};

/** RBJ biquad over a Float32Array in place. */
function filterInPlace(x: Float32Array, rate: number, type: 'lowpass' | 'highpass' | 'bandpass', hz: number, q = Math.SQRT1_2): void {
  const w = (2 * Math.PI * Math.min(hz, rate * 0.45)) / rate;
  const alpha = Math.sin(w) / (2 * q);
  const cos = Math.cos(w);
  const [b0, b1, b2] = type === 'lowpass' ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2]
    : type === 'highpass' ? [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2] : [alpha, 0, -alpha];
  const a0 = 1 + alpha; const a1 = -2 * cos; const a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i += 1) {
    const y = (b0 * x[i]! + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]!; y2 = y1; y1 = y; x[i] = y;
  }
}

/**
 * Renders one kit piece at the context's rate, normalised to a peak of exactly 1, so the gain
 * that plays it is its true peak. Seeded noise: every render of a piece is identical.
 */
export function renderPiece(kind: DrumKind, rate: number): Float32Array {
  const n = Math.max(1, Math.round(PIECE_SECONDS[kind] * rate));
  let state = 0x2545f491 ^ kind.length * 7919;
  const white = (): number => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return (state / 4294967296) * 2 - 1; };
  const noise = (type: 'bandpass' | 'highpass', hz: number, q: number, top: number, decay: number): Float32Array => {
    const x = new Float32Array(n);
    for (let i = 0; i < n; i += 1) x[i] = white();
    filterInPlace(x, rate, type, hz, q);
    filterInPlace(x, rate, 'lowpass', top);
    for (let i = 0; i < n; i += 1) x[i] = x[i]! * Math.min(1, i / (0.002 * rate)) * Math.exp(-i / (decay * rate));
    return x;
  };
  const tone = (from: number, to: number, drop: number, decay: number, wave: 'sine' | 'triangle'): Float32Array => {
    const x = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i += 1) {
      const t = i / rate;
      const hz = to + (from - to) * Math.exp(-t / drop);
      phase += hz / rate;
      const p = phase % 1;
      const v = wave === 'sine' ? Math.sin(2 * Math.PI * p) : 1 - 4 * Math.abs(p - 0.5);
      x[i] = v * Math.min(1, t / 0.003) * Math.exp(-t / decay);
    }
    return x;
  };
  let out: Float32Array;
  switch (kind) {
    case 'kick': { // a round thump falling from 120 to 46 Hz, with a soft felt click
      out = tone(120, 46, 0.035, 0.16, 'sine');
      const click = noise('bandpass', 1200, 0.8, 3000, 0.004);
      for (let i = 0; i < n; i += 1) out[i] = out[i]! + 0.08 * click[i]!;
      break;
    }
    case 'snare':
    case 'ghost': { // dusty and soft: band-limited noise over a short 190 Hz body
      const body = tone(210, 185, 0.02, 0.05, 'sine');
      const skin = noise('bandpass', 2000, 0.6, 4500, kind === 'ghost' ? 0.03 : 0.06);
      let skinPeak = 0;
      for (let i = 0; i < n; i += 1) skinPeak = Math.max(skinPeak, Math.abs(skin[i]!));
      out = new Float32Array(n);
      for (let i = 0; i < n; i += 1) out[i] = body[i]! + skin[i]! / (skinPeak || 1);
      break;
    }
    case 'rim': { // a woody cross-stick click
      const wood = tone(430, 410, 0.02, 0.018, 'sine');
      const tick = noise('bandpass', 2400, 2, 5000, 0.012);
      out = new Float32Array(n);
      for (let i = 0; i < n; i += 1) out[i] = 0.5 * wood[i]! + tick[i]! * 3;
      break;
    }
    case 'hat':
      out = noise('highpass', 6000, 0.7, 9000, 0.012);
      break;
    case 'open':
      out = noise('highpass', 5500, 0.7, 8500, 0.06);
      break;
    case 'kinetic':
      out = noise('bandpass', 4200, 1.2, 7000, 0.015);
      break;
  }
  let peak = 0;
  for (let i = 0; i < n; i += 1) peak = Math.max(peak, Math.abs(out[i]!));
  if (peak > 0) for (let i = 0; i < n; i += 1) out[i] = out[i]! / peak;
  return out;
}

const pieces = new WeakMap<object, Map<DrumKind, AudioBuffer>>();
function pieceBuffer(ctx: AudioContextLike, kind: DrumKind): AudioBuffer {
  let kit = pieces.get(ctx);
  if (!kit) { kit = new Map(); pieces.set(ctx, kit); }
  let buffer = kit.get(kind);
  if (!buffer) {
    const data = renderPiece(kind, ctx.sampleRate);
    buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buffer.getChannelData(0).set(data);
    kit.set(kind, buffer);
  }
  return buffer;
}

/** Plays one baked piece at its true peak times velocity; returned so a mute can stop it. */
export function playDrum(ctx: AudioContextLike, out: AudioNode, hit: DrumHit, at: number): AudioScheduledSourceNode[] {
  const src = ctx.createBufferSource(); src.buffer = pieceBuffer(ctx, hit.kind);
  const gain = ctx.createGain(); gain.gain.value = 10 ** (KIT_PEAK_DB[hit.kind] / 20) * hit.velocity;
  src.connect(gain); gain.connect(out);
  src.start(at);
  src.onended = () => { src.disconnect(); gain.disconnect(); };
  return [src];
}
