import { FakeDom, type FakeElement } from '/Users/matthew/parallax-private/Projects/hundred-stories/tests/ui/fake-dom.ts';
import { createUi } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/ui/ui.ts';

const dom = new FakeDom();
dom.install();
(globalThis as any).history = undefined;
const subs = new Set<() => void>();
function mkWorld(logTotal: number, log: any[]) {
  return { seed: 1, cash: 1_000_000, population: 0, stars: 1, time: { minute: 100 }, log, logTotal,
    rooms: new Map(), shafts: new Map(), sims: new Map(), events: [], stats: { lastQuarter: null } };
}
// World A: the daily, small log. World B: My tower, older and longer, with a fire long over.
const worldA = mkWorld(5, []);
const oldFire = [
  { minute: 10, level: 'alert', text: 'Fire broke out in the office on floor 3. Call a helicopter or wait for security.', roomId: 7 },
  { minute: 40, level: 'alert', text: 'Security put the fire out. 1 room burned down and clearing the damage cost $10,000.' },
  { minute: 60, level: 'alert', text: 'The bank took the tower because your cash stayed too low for too long.' },
];
const worldB = mkWorld(500, oldFire);
let world: any = worldA;
const game: any = {
  get world() { return world; },
  subscribe(cb: () => void) { subs.add(cb); return () => subs.delete(cb); },
  getHover: () => null, getSpeed: () => 1, getTool: () => ({ kind: 'none' }), setTool() {},
  getPlacement: () => null, getPlacementRect: () => null, getSelection: () => null,
  setChrome() {}, setReducedMotion() {}, select() {},
};
const root = dom.createElement('div');
createUi(root as never, game, {} as never);
const cards = (): string[] => root.descendants().filter((n: FakeElement) => n.className.split(' ').includes('hs-toast') || n.className.split(' ').includes('hs-alert-toast')).map((n: FakeElement) => `${n.className} :: ${n.textContent.slice(0, 70)}`);
console.log('before swap:', cards());
world = worldB; // what openMyTower / importSave / load leave in hand
subs.forEach((cb) => cb());
console.log('after swap:', cards());
