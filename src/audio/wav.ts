// 16-bit PCM WAV from float channels, for the dev render path (?audio=<preset>&render=<seconds>).
// Only src/audio/presets.ts imports this, and main.ts reaches that module only under
// import.meta.env.DEV, so none of it ships in the production bundle.

/** A RIFF WAVE file: 44-byte header, then interleaved little-endian 16-bit samples. */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
  const count = channels.length;
  if (count === 0) throw new Error('A WAV needs at least one channel.');
  const frames = channels[0]!.length;
  const blockAlign = count * 2;
  const dataBytes = frames * blockAlign;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const text = (at: number, s: string): void => { for (let i = 0; i < s.length; i += 1) out[at + i] = s.charCodeAt(i); };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, dataBytes, true);
  let at = 44;
  for (let f = 0; f < frames; f += 1) {
    for (let c = 0; c < count; c += 1) {
      const v = Math.max(-1, Math.min(1, channels[c]![f] ?? 0));
      view.setInt16(at, v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff), true);
      at += 2;
    }
  }
  return out;
}

/** Base64 without a data URL prefix, in chunks so a 45 second file does not overflow the call stack. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
