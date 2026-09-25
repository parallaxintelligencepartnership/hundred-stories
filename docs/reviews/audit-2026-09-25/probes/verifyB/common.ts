export const R = '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim';
export const { createWorld } = await import(R + '/world.ts');
export const { applyCommand } = await import(R + '/build.ts');
export const { tick } = await import(R + '/tick.ts');
export const { clockOf } = await import(R + '/types.ts');
export function hhmm(m) { const d = Math.floor(m / 1440), md = m % 1440; return `d${d} ${String(Math.floor(md/60)).padStart(2,'0')}:${String(md%60).padStart(2,'0')}`; }
export function base(seed = 11, width = 60) {
  const w = createWorld(seed); w.cash = 50_000_000;
  for (let x = 100; x < 100 + width; x++) { const r = applyCommand(w, { kind: 'build', room: 'lobby', floor: 1, x }); if (!r.ok) throw new Error('lobby ' + r.reason); }
  return w;
}
export function realOcc(w, room) { let n = 0; for (const s of w.sims.values()) if (s.inRoomId === room.id && s.kind !== 'guard' && s.kind !== 'collector') n++; return n; }
