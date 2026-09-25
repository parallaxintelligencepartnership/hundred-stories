import { createSound, type AudioContextLike } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/audio/audio';
import { tempoFor, keyFor } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/audio/score';

class P { value = 0; setValueAtTime(v: number) { this.value = v; return this; } linearRampToValueAtTime(v: number) { this.value = v; return this; }
  exponentialRampToValueAtTime(v: number) { this.value = v; return this; } setTargetAtTime(v: number) { this.value = v; return this; } cancelScheduledValues() { return this; } }
class N { gain = new P(); frequency = new P(); detune = new P(); delayTime = new P(); threshold = new P(); knee = new P(); ratio = new P(); attack = new P(); release = new P(); Q = new P();
  onended: any = null; type = ''; buffer: any = null; loop = false; connect() {} disconnect() {} started = false; stopped = false; start() { this.started = true; } stop() { this.stopped = true; } }
class C { currentTime = 0; sampleRate = 8000; destination = new N(); state: AudioContextState = 'suspended';
  oscillators: N[] = []; gains: N[] = []; delays: N[] = []; deferResume = false; pending: (() => void)[] = [];
  createOscillator() { const n = new N(); this.oscillators.push(n); return n; } createGain() { const n = new N(); this.gains.push(n); return n; }
  createBiquadFilter() { return new N(); } createDelay() { const n = new N(); this.delays.push(n); return n; } createDynamicsCompressor() { return new N(); } createBufferSource() { return new N(); }
  createBuffer(_c: number, l: number) { const d = new Float32Array(l); return { length: l, getChannelData: () => d }; }
  resume() { if (this.deferResume) return new Promise<void>(r => this.pending.push(() => { this.state = 'running'; r(); })); this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); } }

const W = (seed: number, stars: number) => ({ seed, stars, time: { minute: 600 }, rooms: new Map() });
function rig(world: any) {
  const ev = new Set<any>(); const ticks = new Set<any>(); const gestures: any[] = [];
  const timers = new Map<number, () => void>(); let id = 0; let cleared = 0; let t = 0;
  const ctx = new C();
  const game = { get world() { return world; }, set world(w) { world = w; },
    subscribe(cb: any) { ticks.add(cb); return () => ticks.delete(cb); },
    subscribeEvents(fn: any) { ev.add(fn); return () => ev.delete(fn); } } as any;
  const sound = createSound(game, { store: { getItem: () => null, setItem: () => {} }, createContext: () => ctx as unknown as AudioContextLike,
    target: { addEventListener: (_t: any, fn: any) => gestures.push(fn), removeEventListener: () => {} },
    now: () => t, setInterval: (fn: any) => { timers.set(++id, fn); return id; }, clearInterval: (i: number) => { if (timers.delete(i)) cleared++; } });
  const emit = (e: any) => ev.forEach(fn => fn(e));
  // run the live timers for `sec` seconds of real time, every 500 ms
  const run = (sec: number) => { for (let i = 0; i < sec * 2; i++) { t += 500; ctx.currentTime += 0.5; [...timers.values()].forEach(f => f()); } };
  return { ctx, sound, game, emit, run, gesture: () => gestures.forEach(f => f()), listeners: () => ev.size, timers: () => timers.size, cleared: () => cleared };
}
const beat = (code: string) => ({ kind: 'beat', beat: { code, minute: 0 } });
const r3 = (x: number) => Math.round(x * 1000) / 1000;
function show(label: string, r: ReturnType<typeof rig>) {
  const m = r.sound.mood!; const g = r.ctx.gains;
  console.log(`${label}: tension=${r.sound.tension} tensionLevel=${r.sound.tensionLevel} mood={energy:${r3(m.energy)}, warmth:${r3(m.warmth)}, tension:${r3(m.tension)}} hatBus=${r3(g[7]!.gain.value)} drumsBus=${r3(g[8]!.gain.value)} musicBus=${r3(g[1]!.gain.value)}`);
}
function probeEffects(label: string, r: ReturnType<typeof rig>) {
  const before = r.ctx.oscillators.length;
  r.run(10);
  const afterRun = r.ctx.oscillators.length;
  r.emit({ kind: 'car.arrive', shaftId: 1, carId: 1 }); r.emit({ kind: 'rentDay' }); r.emit({ kind: 'build', command: 'build' });
  r.emit(beat('vip.arrived'));
  console.log(`${label}: oscillators from bell+rentDay+build = ${r.ctx.oscillators.length - afterRun} (music scheduled ${afterRun - before} in the 10 s before)`);
}

{
  const r = rig(W(1, 3)); r.gesture(); r.sound.setEnabled(true);
  const live = () => r.ctx.oscillators.filter(o => o.frequency.value === 110 && o.started && !o.stopped).length;
  r.emit(beat('fire.started')); r.run(5);
  console.log('control, fire burning, sound on: live 110 Hz drones =', live(), '| tensionLevel =', r.sound.tensionLevel);
  r.sound.setEnabled(false);
  console.log('sound off: live drones =', live());
  r.sound.setEnabled(true); r.run(30);
  console.log('sound on again, fire still burning, 30 s later: live drones =', live(), '| tension =', r.sound.tension, '| tensionLevel =', r.sound.tensionLevel, '| hatBus', r.ctx.gains[7]!.gain.value, 'drumsBus', r.ctx.gains[8]!.gain.value);
  r.emit(beat('fire.started')); r.run(1);
  console.log('a second fire.started beat for the same fire: live drones =', live());
}
