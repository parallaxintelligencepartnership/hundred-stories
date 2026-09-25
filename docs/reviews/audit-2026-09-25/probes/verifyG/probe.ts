import { createSound, type AudioContextLike } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/audio/audio';
import { tempoFor, keyFor } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/audio/score';

class P { value = 0; setValueAtTime(v: number) { this.value = v; return this; } linearRampToValueAtTime(v: number) { this.value = v; return this; }
  exponentialRampToValueAtTime(v: number) { this.value = v; return this; } setTargetAtTime(v: number) { this.value = v; return this; } cancelScheduledValues() { return this; } }
class N { gain = new P(); frequency = new P(); detune = new P(); delayTime = new P(); threshold = new P(); knee = new P(); ratio = new P(); attack = new P(); release = new P(); Q = new P();
  onended: any = null; type = ''; buffer: any = null; loop = false; connect() {} disconnect() {} start() {} stop() {} }
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

console.log('--- S1a: fire, sound off, fire ends while off, sound on');
{
  const r = rig(W(1, 3)); r.gesture(); r.sound.setEnabled(true); r.run(60); show('calm baseline', r);
  r.emit(beat('fire.started')); r.run(120); show('fire burning', r);
  r.sound.setEnabled(false);
  console.log('listeners while off =', r.listeners());
  r.emit(beat('fire.resolved')); // not heard: the game emits only to listeners, and there are none
  r.sound.setEnabled(true); r.run(600); show('sound on, 10 min after the fire ended', r);
  probeEffects('effects after the fire', r);
  r.emit(beat('theft.started')); console.log('theft.started while stuck: tensionLevel =', r.sound.tensionLevel);
  r.emit(beat('fire.resolved')); r.run(600); show('only a later fire.resolved clears it', r);
}
console.log('--- S1b: fire, then an in-session tower switch (primeTap: no fire.resolved ever emitted)');
{
  const r = rig(W(1, 3)); r.gesture(); r.sound.setEnabled(true); r.run(60);
  r.emit(beat('fire.started')); r.run(30);
  r.game.world = W(2, 1); // swapWorld/newGame/importSave: world replaced, tap primed, no beat
  r.run(600); show('new tower, 10 min later', r);
  probeEffects('effects on the new tower', r);
}
console.log('--- S1c: bomb, sound off, bomb.resolved while off, sound on');
{
  const r = rig(W(1, 3)); r.gesture(); r.sound.setEnabled(true); r.run(60);
  r.emit(beat('bomb.started')); r.sound.setEnabled(false); r.emit(beat('bomb.resolved')); r.sound.setEnabled(true); r.run(600); show('after bomb', r);
}
console.log('--- S1d: theft, tower switch');
{
  const r = rig(W(1, 3)); r.gesture(); r.sound.setEnabled(true); r.run(60);
  r.emit(beat('theft.started')); r.game.world = W(2, 1); r.run(600); show('after theft + switch', r);
  probeEffects('effects after theft + switch', r);
}
console.log('--- S2: tower switch 5 stars -> 1 star');
{
  const r = rig(W(1, 5)); r.gesture(); r.sound.setEnabled(true); r.run(10);
  const delay1 = r.ctx.delays[0]!.delayTime.value;
  r.game.world = W(2, 1); r.run(10);
  console.log(`after switch to seed 2 at 1 star: chapter=${r.sound.chapter} tempo=${r.sound.tempo} delay=${r3(delay1)}s held key=${keyFor(1)}`);
  r.emit({ kind: 'stars', from: 1, to: 2 }); r.game.world.stars = 2;
  console.log(`new tower reaches 2 stars: chapter=${r.sound.chapter}`);
  const f = rig(W(2, 1)); f.gesture(); f.sound.setEnabled(true);
  console.log(`fresh page on seed 2 at 1 star: chapter=${f.sound.chapter} tempo=${f.sound.tempo} (tempoFor=${tempoFor(2)}) key=${keyFor(2)} delay=${r3(f.ctx.delays[0]!.delayTime.value)}s`);
  f.emit({ kind: 'stars', from: 1, to: 2 }); console.log(`fresh page, reaches 2 stars: chapter=${f.sound.chapter}`);
  const up = rig(W(1, 1)); up.gesture(); up.sound.setEnabled(true); up.game.world = W(2, 4);
  console.log(`reverse: 1-star page switched to a 4-star tower: chapter=${up.sound.chapter}`);
}
console.log('--- S3: stars rise while sound off');
{
  const r = rig(W(1, 1)); r.gesture(); r.sound.setEnabled(true); r.sound.setEnabled(false); r.game.world.stars = 3; r.sound.setEnabled(true);
  console.log('chapter after sound back on at 3 stars =', r.sound.chapter);
}
console.log('--- S4: on then off before resume settles');
{
  const r = rig(W(1, 1)); r.gesture(); r.sound.setEnabled(true); r.sound.setEnabled(false);
  console.log('after first on/off (sync resume): state =', r.ctx.state);
  r.ctx.deferResume = true;
  r.sound.setEnabled(true); console.log('on: state =', r.ctx.state, 'pending resumes =', r.ctx.pending.length);
  r.sound.setEnabled(false); console.log('off before resume settles: state =', r.ctx.state, 'live timers =', r.timers(), 'listeners =', r.listeners());
  r.ctx.pending.splice(0).forEach(f => f()); await Promise.resolve();
  console.log('resume settles: state =', r.ctx.state, 'settings.on =', r.sound.settings.on, 'master gain =', r.ctx.gains[0]!.gain.value);
  r.gesture(); console.log('a later gesture with sound off: state =', r.ctx.state);
  r.ctx.deferResume = false;
  r.sound.setEnabled(true); r.sound.setEnabled(false); console.log('next on/off cycle: state =', r.ctx.state);
}
console.log('--- S5: star rises then falls, then reload');
{
  const r = rig(W(1, 3)); r.gesture(); r.sound.setEnabled(true);
  r.emit({ kind: 'stars', from: 3, to: 4 }); r.game.world.stars = 4;
  r.emit({ kind: 'stars', from: 4, to: 3 }); r.game.world.stars = 3;
  const r2 = rig(r.game.world);
  console.log('session chapter =', r.sound.chapter, '| reload of same save chapter =', r2.sound.chapter);
}
