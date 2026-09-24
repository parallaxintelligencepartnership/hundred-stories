// Measures the rendered soundtrack samples against the lofi pass criteria.
//
//   node scripts/analyze-audio-samples.mjs [--onsets] [dir-or-wav ...]
//
// Default input: docs/reviews/audio-samples-2026-09-23/*.wav. Node only; the WAV parser, the FFT
// and the onset detector are all here. Per file it prints, each with PASS or FAIL:
//   level     integrated RMS in dBFS (-20 to -14) and sample peak (at or below -1 dBFS)
//   balance   energy below 300 Hz, 300 Hz to 2 kHz, 2 to 5 kHz, above 5 kHz (>5 kHz under 5 %,
//             >2 kHz under 20 %)
//   tempo     beat period from the onsets of the low band (under 300 Hz: kick, snare body, bass)
//             and the snare band together, 70 to 85 BPM, with at least 60 low-band onsets per 45 s
//   snare     the bar grid comes from the kick (under 120 Hz, beat one is the beat class with the
//             most kick); a bar counts when loud snare-band onsets (1.2 to 4 kHz, at least 60 % of
//             the 90th percentile rise) land within 60 ms of both beat two and beat four; at least
//             70 % of bars
//   tone      the loudest narrowband tone above 1 kHz holding over 30 % of a frame's energy for
//             more than 0.5 s; none allowed
// fire-3star is judged on seconds 20 to 45 (its first 20 s are the tension state); every other
// file on the whole render. The onset floor scales with the judged length. Exit code 1 on any FAIL.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DIR = join(ROOT, 'docs', 'reviews', 'audio-samples-2026-09-23');
const WINDOWS = { 'fire-3star': [20, 45] };
// --onsets prints the detected onsets of the first 12 judged seconds, for debugging the detector.
const SHOW_ONSETS = process.argv.includes('--onsets');

// ------------------------------------------------------------------ wav

function readWav(path) {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${path}: not a WAV`);
  let at = 12;
  let fmt = null;
  let data = null;
  while (at + 8 <= buf.length) {
    const id = buf.toString('ascii', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    else if (id === 'data') data = { start: body, size: Math.min(size, buf.length - body) };
    at = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error(`${path}: missing fmt or data chunk`);
  if (fmt.format !== 1 || fmt.bits !== 16) throw new Error(`${path}: only 16-bit PCM is supported`);
  const frames = Math.floor(data.size / (2 * fmt.channels));
  const channels = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < fmt.channels; c += 1) channels[c][i] = buf.readInt16LE(data.start + 2 * (i * fmt.channels + c)) / 32768;
  }
  return { rate: fmt.rate, channels };
}

// ------------------------------------------------------------------ dsp

const db = (x) => (x > 0 ? 10 * Math.log10(x) : -Infinity);

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Power spectra of Hann-windowed frames. */
function* spectra(x, rate, size, hop) {
  const win = new Float64Array(size);
  for (let i = 0; i < size; i += 1) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const power = new Float64Array(size / 2);
  for (let start = 0; start + size <= x.length; start += hop) {
    for (let i = 0; i < size; i += 1) { re[i] = x[start + i] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < size / 2; k += 1) power[k] = re[k] * re[k] + im[k] * im[k];
    yield { time: (start + size / 2) / rate, power };
  }
}

/** RBJ biquad, run in place over a copy. */
function biquad(x, rate, type, hz, q = Math.SQRT1_2) {
  const w = (2 * Math.PI * hz) / rate;
  const alpha = Math.sin(w) / (2 * q);
  const cos = Math.cos(w);
  let b0, b1, b2;
  if (type === 'lowpass') { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; }
  else if (type === 'highpass') { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; }
  else throw new Error(type);
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i += 1) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

/**
 * Onsets as rises in a band's short-term level: 20 ms RMS every 5 ms, a rise of at least `rise`
 * dB over the quietest of the previous 10 to 40 ms, a local maximum within 50 ms, above a floor
 * 30 dB under the band's loud (95th percentile) level. Returns [{ time, strength }].
 */
function onsets(x, rate, rise = 4) {
  const hop = Math.round(rate * 0.005);
  const win = Math.round(rate * 0.02);
  const env = [];
  for (let s = 0; s + win <= x.length; s += hop) {
    let sum = 0;
    for (let i = s; i < s + win; i += 1) sum += x[i] * x[i];
    env.push(db(sum / win + 1e-12));
  }
  const sorted = [...env].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.95)] - 30;
  const d = env.map((v, n) => {
    if (n < 8 || v < floor) return 0;
    let low = Infinity;
    for (let k = n - 8; k <= n - 2; k += 1) low = Math.min(low, env[k]);
    return Math.max(0, v - low);
  });
  const out = [];
  let last = -Infinity;
  for (let n = 0; n < d.length; n += 1) {
    if (d[n] < rise) continue;
    let peak = true;
    for (let k = Math.max(0, n - 10); k <= Math.min(d.length - 1, n + 10); k += 1) if (d[k] > d[n] || (d[k] === d[n] && k < n)) { peak = false; break; }
    if (!peak) continue;
    // Report the time the rise started (the hit), not where the 20 ms window caught up with it.
    const time = (n * hop + win / 2) / rate - 0.01;
    if (time - last < 0.1) continue;
    out.push({ time, strength: d[n] });
    last = time;
  }
  return out;
}

// ------------------------------------------------------------------ measures

function level(channels) {
  let sum = 0, n = 0, peak = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i += 1) { const v = ch[i]; sum += v * v; n += 1; const a = Math.abs(v); if (a > peak) peak = a; }
  return { rms: db(sum / n), peak: 20 * Math.log10(peak || 1e-9) };
}

function balanceAndTone(mono, rate) {
  const size = 4096;
  const hop = 1024;
  const binHz = rate / size;
  const edges = [300, 2000, 5000];
  const bands = [0, 0, 0, 0];
  let run = null;
  let loudest = null;
  const close = (end) => {
    if (run && end - run.start > 0.5 && (!loudest || run.power > loudest.power)) loudest = { hz: run.hz, seconds: end - run.start, share: run.share, power: run.power, at: run.start };
    run = null;
  };
  for (const { time, power } of spectra(mono, rate, size, hop)) {
    let total = 0;
    for (let k = 1; k < power.length; k += 1) {
      total += power[k];
      const hz = k * binHz;
      bands[hz < edges[0] ? 0 : hz < edges[1] ? 1 : hz < edges[2] ? 2 : 3] += power[k];
    }
    // Silence cannot hold a tone worth hearing: skip frames under -60 dBFS.
    if (db(total / (size * size * 0.375 / 2)) < -60) { close(time); continue; }
    let best = 0, bestK = 0;
    for (let k = Math.ceil(1000 / binHz); k < power.length - 1; k += 1) {
      const p = power[k - 1] + power[k] + power[k + 1];
      if (p > best) { best = p; bestK = k; }
    }
    const share = best / total;
    if (share > 0.3) {
      if (run && Math.abs(run.k - bestK) <= 2) { run.share = Math.max(run.share, share); run.power = Math.max(run.power, best); }
      else { close(time); run = { k: bestK, hz: bestK * binHz, start: time, share, power: best }; }
    } else close(time);
  }
  close(mono.length / rate);
  const total = bands.reduce((a, b) => a + b, 0) || 1;
  return { bands: bands.map((b) => b / total), tone: loudest };
}

/**
 * Beat grid: for each tempo from 60 to 110 BPM, the phase where the most onset strength lands
 * within about 25 ms of a beat, less what chance would land; the best tempo and phase win, then
 * both are refined. A fit
 * rather than a Fourier comb, because a syncopated kick (one and the swung "and" of three)
 * aliases a comb onto the wrong tempo.
 */
function beatGrid(groups) {
  const sigma = 0.025;
  // Each onset group (low band, snare) carries equal weight whatever its loudness.
  const events = groups.flatMap((group) => {
    const sum = group.reduce((a, e) => a + e.strength, 0) || 1;
    return group.map((e) => ({ time: e.time, strength: e.strength / sum }));
  });
  const total = events.reduce((sum, e) => sum + e.strength, 0);
  // Alignment above chance: a faster grid catches more stray onsets by luck, so each tempo
  // gives back what randomly placed onsets would score on it.
  const fit = (period, offset) => {
    let score = 0;
    for (const e of events) {
      const d = (((e.time - offset) % period) + period) % period;
      const off = Math.min(d, period - d);
      score += e.strength * Math.exp(-((off / sigma) ** 2));
    }
    return score - (total * Math.sqrt(Math.PI) * sigma) / period;
  };
  const search = (from, to, step, phaseStep) => {
    let best = { bpm: from, first: 0, score: -1 };
    for (let bpm = from; bpm <= to + 1e-9; bpm += step) {
      const period = 60 / bpm;
      for (let offset = 0; offset < period; offset += phaseStep) {
        const score = fit(period, offset);
        if (score > best.score) best = { bpm, first: offset, score };
      }
    }
    return best;
  };
  const coarse = search(60, 110, 0.25, 0.01);
  const fine = search(coarse.bpm - 0.3, coarse.bpm + 0.3, 0.02, 0.002);
  return { bpm: fine.bpm, period: 60 / fine.bpm, first: fine.first };
}

function rhythm(mono, rate, seconds) {
  const low = onsets(biquad(biquad(mono, rate, 'lowpass', 300), rate, 'lowpass', 300), rate);
  const kick = onsets(biquad(biquad(mono, rate, 'lowpass', 120), rate, 'lowpass', 120), rate);
  const snareBand = biquad(biquad(biquad(mono, rate, 'highpass', 1200), rate, 'highpass', 1200), rate, 'lowpass', 4000);
  const snareAll = onsets(snareBand, rate);
  if (low.length < 8) return { bpm: 0, lowOnsets: low.length, bars: 0, snareBars: 0 };
  // Snare: snare-band onsets at least 60 % as strong as the loud ones (the 90th percentile);
  // hats and key attacks sit well under that.
  const strengths = snareAll.map((e) => e.strength).sort((a, b) => a - b);
  const cut = strengths.length ? 0.6 * strengths[Math.floor(strengths.length * 0.9)] : 0;
  const snare = snareAll.filter((e) => e.strength >= cut);
  // The beat comes from the low band and the snare together, weighted equally: a syncopated
  // kick alone (one and the swung "and" of three) can fit a wrong grid; the backbeat pins it.
  const grid = beatGrid([low, snare]);
  const beats = [];
  for (let t = grid.first; t < seconds; t += grid.period) beats.push(t);
  const near = (list, t, tol = 0.06) => list.some((e) => Math.abs(e.time - t) <= tol);
  // Beat one: the beat class (mod 4) with the most kick onset strength.
  const classKick = [0, 0, 0, 0];
  beats.forEach((t, i) => { for (const e of kick) if (Math.abs(e.time - t) <= 0.06) classKick[i % 4] += e.strength; });
  const one = classKick.indexOf(Math.max(...classKick));
  let bars = 0, snareBars = 0;
  for (let i = one; i + 3 < beats.length; i += 4) {
    bars += 1;
    if (near(snare, beats[i + 1]) && near(snare, beats[i + 3])) snareBars += 1;
  }
  if (SHOW_ONSETS) {
    const fmt = (list) => list.filter((e) => e.time < 12).map((e) => `${e.time.toFixed(2)}(${e.strength.toFixed(0)})`).join(' ');
    console.log(`    grid ${grid.bpm.toFixed(2)} BPM, first beat ${grid.first.toFixed(3)} s, beat one class ${one}`);
    console.log(`    low   ${fmt(low)}`);
    console.log(`    kick  ${fmt(kick)}`);
    console.log(`    snare ${fmt(snare)}`);
  }
  return { bpm: grid.bpm, lowOnsets: low.length, bars, snareBars };
}

// ------------------------------------------------------------------ report

function analyse(path) {
  const name = basename(path, '.wav');
  const wav = readWav(path);
  const [from, to] = WINDOWS[name] ?? [0, wav.channels[0].length / wav.rate];
  const a = Math.floor(from * wav.rate);
  const b = Math.min(wav.channels[0].length, Math.floor(to * wav.rate));
  const channels = wav.channels.map((ch) => ch.subarray(a, b));
  const mono = new Float32Array(b - a);
  for (const ch of channels) for (let i = 0; i < mono.length; i += 1) mono[i] += ch[i] / channels.length;
  const seconds = mono.length / wav.rate;
  const lv = level(channels);
  const bt = balanceAndTone(mono, wav.rate);
  const rh = rhythm(mono, wav.rate, seconds);
  const pct = (x) => `${(100 * x).toFixed(1)}%`;
  const minOnsets = Math.ceil((60 * seconds) / 45);
  const snareShare = rh.bars ? rh.snareBars / rh.bars : 0;
  const checks = [
    ['rms', lv.rms >= -20 && lv.rms <= -14, `RMS ${lv.rms.toFixed(1)} dBFS (want -20 to -14)`],
    ['peak', lv.peak <= -1, `peak ${lv.peak.toFixed(1)} dBFS (want <= -1)`],
    ['balance', bt.bands[3] < 0.05 && bt.bands[2] + bt.bands[3] < 0.2,
      `<300 Hz ${pct(bt.bands[0])}  300-2k ${pct(bt.bands[1])}  2-5k ${pct(bt.bands[2])}  >5k ${pct(bt.bands[3])} (want >5k < 5%, >2k < 20%)`],
    ['tempo', rh.bpm >= 70 && rh.bpm <= 85 && rh.lowOnsets >= minOnsets,
      `${rh.bpm.toFixed(1)} BPM from ${rh.lowOnsets} low-band onsets (want 70 to 85 BPM, >= ${minOnsets} onsets)`],
    ['snare', snareShare >= 0.7, `snare on 2 and 4 in ${rh.snareBars}/${rh.bars} bars, ${pct(snareShare)} (want >= 70%)`],
    ['tone', !bt.tone, bt.tone ? `sustained ${bt.tone.hz.toFixed(0)} Hz for ${bt.tone.seconds.toFixed(2)} s from ${(from + bt.tone.at).toFixed(1)} s, ${pct(bt.tone.share)} of frame energy` : 'no sustained tone above 1 kHz'],
  ];
  const lines = [`${name}.wav  (judged on ${from.toFixed(0)} to ${to.toFixed(0)} s)`];
  for (const [id, ok, text] of checks) lines.push(`  ${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(8)}${text}`);
  return { lines, failed: checks.filter((c) => !c[1]).length };
}

function inputs(args) {
  const list = args.length ? args : [DEFAULT_DIR];
  return list.flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p).filter((f) => f.endsWith('.wav')).sort().map((f) => join(p, f)) : [p]));
}

let failed = 0;
for (const file of inputs(process.argv.slice(2).filter((a) => !a.startsWith('--')))) {
  const r = analyse(file);
  failed += r.failed;
  console.log(r.lines.join('\n'));
}
console.log(failed ? `${failed} check(s) failed` : 'all checks pass');
process.exit(failed ? 1 : 0);
