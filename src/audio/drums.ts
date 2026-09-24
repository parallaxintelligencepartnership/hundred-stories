import type { AudioContextLike } from './audio';
import { swingFor } from './score';

export type DrumKind = 'kick' | 'snare' | 'hat' | 'ghost' | 'open' | 'kinetic';
/** Conservative source peaks; both noise layers also pass through the music bus. */
export const NOISE_PEAK = { hat: 0.06, open: 0.06, ghost: 0.02, kinetic: 0.035 } as const;
export interface DrumHit { kind: DrumKind; beat: number; lateSeconds: number; velocity: number }
export const KICK_PATTERNS: readonly (readonly number[])[] = [
  [0, 2.5], [0, 2], [0, 1.75, 2.5], [0, 2.75],
];
function hash(a: number, b: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ b, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}
export function kickPatternFor(seed: number, phraseIndex: number): readonly number[] {
  return KICK_PATTERNS[hash(seed | 0, phraseIndex | 0) % KICK_PATTERNS.length]!;
}
/** The laid-back offset ranges from 30 ms at rest to 15 ms at full energy. */
export function lazyOffsetMs(energy: number): number {
  return 30 - 15 * Math.min(1, Math.max(0, energy));
}
export function drumHitsFor(seed: number, phraseIndex: number, barIndex: number, energy: number): DrumHit[] {
  if (energy < 0.15) return [];
  const lateSeconds = lazyOffsetMs(energy) / 1000;
  const hits: DrumHit[] = [];
  for (const beat of kickPatternFor(seed, phraseIndex)) hits.push({ kind: 'kick', beat, lateSeconds, velocity: 0.62 });
  for (const beat of [1, 3]) hits.push({ kind: 'snare', beat, lateSeconds, velocity: 0.52 });
  const swing = swingFor(energy);
  for (let beat = 0; beat < 4; beat += 1) {
    hits.push({ kind: 'hat', beat, lateSeconds, velocity: 0.22 });
    hits.push({ kind: 'hat', beat: beat + swing, lateSeconds, velocity: 0.15 });
  }
  if (energy > 0.5) {
    const ghostBeat = hash(seed ^ barIndex, phraseIndex) % 2 ? 1.75 : 3.75;
    hits.push({ kind: 'ghost', beat: ghostBeat, lateSeconds, velocity: 0.11 });
    hits.push({ kind: 'open', beat: 3 + swing, lateSeconds, velocity: 0.17 });
  }
  return hits.sort((a, b) => a.beat - b.beat);
}

const noiseBuffers = new WeakMap<object, AudioBuffer>();
function noiseBuffer(ctx: AudioContextLike): AudioBuffer {
  let buffer = noiseBuffers.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buffer);
  }
  return buffer;
}
/** Small one-shot Web Audio voices, returned so master mute can stop queued hits. */
export function playDrum(ctx: AudioContextLike, out: AudioNode, hit: DrumHit, at: number): AudioScheduledSourceNode[] {
  const started: AudioScheduledSourceNode[] = [];
  const tone = (hz: number, duration: number, peak: number, drop = false) => {
    const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.setValueAtTime(hz, at);
    if (drop) osc.frequency.exponentialRampToValueAtTime(50, at + duration);
    const gain = ctx.createGain(); gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(peak * hit.velocity, at + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain); gain.connect(out); osc.start(at); osc.stop(at + duration + 0.01); started.push(osc);
  };
  const burst = (kind: 'bandpass' | 'highpass', hz: number, duration: number, peak: number, bounded = false) => {
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter(); filter.type = kind; filter.frequency.setValueAtTime(hz, at);
    const top = bounded ? ctx.createBiquadFilter() : null;
    if (top) { top.type = 'lowpass'; top.frequency.setValueAtTime(7000, at); }
    const gain = ctx.createGain(); gain.gain.setValueAtTime(peak * hit.velocity, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    src.connect(filter); if (top) { filter.connect(top); top.connect(gain); } else filter.connect(gain);
    gain.connect(out); src.start(at); src.stop(at + duration + 0.01); started.push(src);
  };
  if (hit.kind === 'kick') tone(120, 0.12, 0.22, true);
  else if (hit.kind === 'snare') { burst('bandpass', 1450, 0.09, 0.16); tone(180, 0.09, 0.075); }
  else burst('highpass', hit.kind === 'open' ? 4100 : 5200,
    hit.kind === 'open' ? 0.07 : hit.kind === 'kinetic' ? 0.055 : 0.045,
    NOISE_PEAK[hit.kind], true);
  return started;
}
