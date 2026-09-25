import { FakeDom, type FakeElement } from '/Users/matthew/parallax-private/Projects/hundred-stories/tests/ui/fake-dom.ts';
import { createUi } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/ui/ui.ts';
const dom = new FakeDom();
dom.install();
const subs = new Set<() => void>();
const world: any = { seed: 1, cash: 10, population: 0, stars: 1, time: { minute: 100 }, log: [], logTotal: 0,
  rooms: new Map(), shafts: new Map(), sims: new Map(), events: [], stats: { lastQuarter: null } };
const notify = () => subs.forEach((cb) => cb());
let pending: any = { floor: 2, x: 10, floorMin: 2, floorMax: 2, ok: true, label: 'Office', cost: 40000, pending: true };
const game: any = {
  get world() { return world; },
  subscribe(cb: () => void) { subs.add(cb); return () => subs.delete(cb); },
  getHover: () => null, getSpeed: () => 1, getTool: () => ({ kind: 'room', room: 'office' }), setTool() {},
  getPlacement: () => pending, getPlacementRect: () => ({ x: 10, y: 10, w: 10, h: 10 }), getSelection: () => null,
  setChrome() {}, setReducedMotion() {}, select() {},
  // game.ts apply: log the refusal as a warn line, then notify synchronously, then return
  confirmPending() {
    const reason = 'You need $40,000 to build that.';
    world.log.push({ minute: 100, level: 'warn', text: reason }); world.logTotal += 1;
    notify();
    return { ok: false, reason };
  },
};
const root = dom.createElement('div');
createUi(root as never, game, {} as never);
const build = root.descendants().find((n: FakeElement) => n.tagName === 'BUTTON' && n.className.includes('hs-place-btn') && n.className.includes('is-primary'))!;
console.log("build:", build?.textContent, build?.disabled, world.logTotal); (build.listeners.get("click") ?? []).forEach((fn) => fn({})); console.log("after", world.logTotal, root.descendants().filter((n: FakeElement) => n.textContent.includes("You need")).map((n: FakeElement) => n.className));
const shown = root.descendants().filter((n: FakeElement) => /hs-news-toast|is-notice/.test(n.className)).map((n: FakeElement) => `${n.className} :: ${n.textContent}`);
console.log(shown);
