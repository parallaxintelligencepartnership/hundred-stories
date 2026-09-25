import { createSound, type AudioContextLike } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/audio/audio';
import { tempoFor, keyFor } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/audio/score';

class P { value = 0; setValueAtTime(v: number) { this.value = v; return this; } linearRampToValueAtTime(v: number) { this.value = v; return this; }
  exponentialRampToValueAtTime(v: number) { this.value = v; return this; } setTargetAtTime(v: number) { this.value = v; return this; } cancelScheduledValues() { return this; } }
class N { gain = new P(); frequency = new P(); detune = new P(); delayTime = new P(); threshold = new P(); knee = new P(); ratio = new P(); attack = new P(); release = new P(); Q = new P();
  onended: any = null; type = ''; buffer: any = null; loop = false; kind: string; constructor(k: string) { this.kind = k; }
  connect() {} disconnect() {} start() {} stop() {} }
class C { currentTime = 0; sampleRate = 8000; destination = new N('dest'); state: AudioContextState = 'suspended'; nodes: N[] = [];
  pendingResume: (() => void) | null = null; deferResume = false;
  mk(k: string) { const n = new N(k); this.nodes.push(n); return n; }
  createOscillator() { return this.mk('osc'); } createGain() { return this.mk('gain'); } createBiquadFilter() { return this.mk('filter'); }
  createDelay() { return this.mk('delay'); } createDynamicsCompressor() { return this.mk('comp'); } createBufferSource() { return this.mk('src'); }
  createBuffer(_c: number, l: number) { const d = new Float32Array(l); return { length: l, getChannelData: () => d }; }
  resume() { if (this.deferResume) return new Promise<void>(r => { this.pendingResume = () => { this.state = 'running'; r(); }; }); this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); } }

function rig(world: any) {
  const ev = new Set<any>(); const ticks = new Set<any>(); const gestures: any[] = []; const timers: any[] = [];
  const ctx = new C();
  const game = { get world() { return world; }, set world(w) { world = w; },
    subscribe(cb: any) { ticks.add(cb); return () => ticks.delete(cb); },
    subscribeEvents(fn: any) { ev.add(fn); return () => ev.delete(fn); } } as any;
  const sound = createSound(game, { store: { getItem: () => null, setItem: () => {} }, createContext: () => ctx as unknown as AudioContextLike,
    target: { addEventListener: (_t: any, fn: any) => gestures.push(fn), removeEventListener: () => {} },
    now: () => ctx.currentTime * 1000, setInterval: (fn: any) => timers.push(fn), clearInterval: () => {} });
  const emit = (e: any) => ev.forEach(fn => fn(e));
  return { ctx, sound, game, emit, gesture: () => gestures.forEach(f => f()), listeners: () => ev.size };
}
const w = (seed: number, stars: number) => ({ seed, stars, time: { minute: 600 }, rooms: new Map() });

// P1: fire in progress, sound turned off, fire resolves while off, sound on again
{
  const r = rig(w(1, 3)); r.gesture(); r.sound.setEnabled(true);
  r.emit({ kind: 'beat', beat: { code: 'fire.started', minute: 0 } });
  r.sound.setEnabled(false);
  r.emit({ kind: 'beat', beat: { code: 'fire.resolved', minute: 5 } }); // listeners while off: 
  const offListeners = r.listeners();
  r.sound.setEnabled(true);
  const osc0 = r.ctx.nodes.filter(n => n.kind === 'osc').length;
  r.ctx.currentTime = 10;
  r.emit({ kind: 'car.arrive', shaftId: 1, carId: 1 });
  r.emit({ kind: 'rentDay' });
  const osc1 = r.ctx.nodes.filter(n => n.kind === 'osc').length;
  console.log('P1 listeners while off =', offListeners, '| after on: tension =', r.sound.tension, 'tensionLevel =', r.sound.tensionLevel, '| oscillators from bell+rentDay =', osc1 - osc0);
}
// P2: world swap in session (newGame / openDaily / openFriend / importSave): tower B keeps tower A's chapter, tempo, key
{
  const r = rig(w(1, 5)); r.gesture(); r.sound.setEnabled(true);
  r.game.world = w(2, 1);
  console.log('P2 after swap to seed 2 stars 1: chapter =', r.sound.chapter, 'tempo =', r.sound.tempo, '| fresh load of that tower would be chapter 1 tempo', tempoFor(2), 'key', keyFor(2), 'vs held key', keyFor(1));
  r.emit({ kind: 'stars', from: 1, to: 2 });
  console.log('P2 tower B reaches 2 stars: chapter =', r.sound.chapter);
}
// P3: stars rise while sound is off
{
  const r = rig(w(1, 1)); r.gesture(); r.sound.setEnabled(true); r.sound.setEnabled(false);
  r.game.world.stars = 3; // rose while unsubscribed
  r.sound.setEnabled(true);
  console.log('P3 stars 3 reached while off, sound on again: chapter =', r.sound.chapter, '(reload would give 3)');
}
// P3b: stars fall in session vs reload
{
  const r = rig(w(1, 3)); r.gesture(); r.sound.setEnabled(true);
  r.emit({ kind: 'stars', from: 3, to: 4 }); r.game.world.stars = 4;
  r.emit({ kind: 'stars', from: 4, to: 3 }); r.game.world.stars = 3;
  const r2 = rig(r.game.world);
  console.log('P3b in session chapter =', r.sound.chapter, '| after reload of the same save chapter =', r2.sound.chapter);
}
// P4: on then off before resume() settles
{
  const r = rig(w(1, 1)); r.ctx.deferResume = true; r.gesture(); r.sound.setEnabled(true);
  r.sound.setEnabled(false);
  r.ctx.pendingResume?.();
  await Promise.resolve();
  console.log('P4 after on->off inside resume latency: ctx.state =', r.ctx.state, 'settings.on =', r.sound.settings.on);
}
