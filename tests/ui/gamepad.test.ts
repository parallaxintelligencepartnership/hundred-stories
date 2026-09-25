// Controller input on a mocked navigator.getGamepads: the standard mapping, the dead zone, pan,
// zoom, A, B, the shoulders, Start, the d-pad on a menu, the cursor that shows while a pad is
// in use, and a loop that runs only while a pad is connected.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createGamepadInput,
  deadzone,
  newlyPressed,
  PAD_BUTTONS,
  PAN_SPEED,
  panStep,
  readPad,
  zoomStep,
  type PadDirection,
  type PadLike,
} from '../../src/ui/gamepad';
import { createUi } from '../../src/ui/ui';
import { FakeDom } from './fake-dom';

function pad(held: (keyof typeof PAD_BUTTONS)[] = [], axes: number[] = [0, 0, 0, 0]): PadLike {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  for (const name of held) buttons[PAD_BUTTONS[name]] = { pressed: true, value: 1 };
  return { connected: true, axes, buttons };
}

describe('reading a pad', () => {
  it('uses the standard mapping', () => {
    expect(PAD_BUTTONS).toEqual({ a: 0, b: 1, lb: 4, rb: 5, start: 9, up: 12, down: 13, left: 14, right: 15 });
    expect([...readPad(pad(['a', 'rb', 'left'])).held].sort()).toEqual(['a', 'left', 'rb']);
  });

  it('takes the dead zone out of the sticks and rescales the rest', () => {
    expect(deadzone(0.15)).toBe(0);
    expect(deadzone(-0.19)).toBe(0);
    expect(deadzone(1)).toBe(1);
    expect(deadzone(-1)).toBe(-1);
    expect(deadzone(0.6)).toBeCloseTo(0.5);
    expect(deadzone(Number.NaN)).toBe(0);
    const s = readPad(pad([], [0.6, -1, 0, 1]));
    expect([s.panX, s.panY, s.zoom].map((v) => Math.round(v * 100) / 100)).toEqual([0.5, -1, 1]);
  });

  it('pans by the left stick, else the d-pad, and zooms by the right stick', () => {
    const still = readPad(pad());
    expect(panStep(still, 1, true)).toEqual({ dx: 0, dy: 0 });
    expect(panStep(readPad(pad([], [1, 0, 0, 0])), 0.5, true)).toEqual({ dx: PAN_SPEED / 2, dy: 0 });
    expect(panStep(readPad(pad(['up', 'left'])), 1, true)).toEqual({ dx: -PAN_SPEED, dy: -PAN_SPEED });
    expect(panStep(readPad(pad(['up'])), 1, false)).toEqual({ dx: 0, dy: 0 }); // the d-pad is on a menu
    expect(zoomStep(still, 1)).toBe(1);
    expect(zoomStep(readPad(pad([], [0, 0, 0, -1])), 0.1)).toBeGreaterThan(1); // stick up zooms in
    expect(zoomStep(readPad(pad([], [0, 0, 0, 1])), 0.1)).toBeLessThan(1);
  });

  it('counts a press once, on the frame it goes down', () => {
    expect(newlyPressed(new Set(['a', 'b']), new Set(['a']))).toEqual(['b']);
  });
});

describe('the input loop', () => {
  function harness(pads: (PadLike | null)[]) {
    const frames: ((t: number) => void)[] = [];
    const listeners = new Map<string, ((e: Event) => void)[]>();
    const log: string[] = [];
    let menuOpen = false;
    const input = createGamepadInput(
      {
        pan: (dx, dy) => log.push(`pan ${Math.round(dx)} ${Math.round(dy)}`),
        zoom: (f) => log.push(`zoom ${f > 1 ? 'in' : 'out'}`),
        a: () => log.push('a'),
        b: () => log.push('b'),
        speed: (step) => log.push(`speed ${step}`),
        start: () => log.push('start'),
        dpad: (dir: PadDirection) => {
          if (!menuOpen) return false;
          log.push(`focus ${dir}`);
          return true;
        },
        active: (on) => log.push(on ? 'cursor on' : 'cursor off'),
      },
      {
        getGamepads: () => pads,
        events: {
          addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
          removeEventListener: (type, fn) => listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn)),
        },
        raf: (fn) => frames.push(fn),
        caf: () => {},
      },
    );
    const run = (t: number): void => {
      const due = frames.splice(0);
      for (const fn of due) fn(t);
    };
    const fire = (type: string, event: Partial<Event> & Record<string, unknown> = {}): void =>
      (listeners.get(type) ?? []).forEach((fn) => fn(event as Event));
    return { input, frames, run, fire, log, setMenu: (on: boolean) => (menuOpen = on) };
  }

  it('does not poll with no pad connected, starts on connect, and stops when the last one goes', () => {
    const pads: (PadLike | null)[] = [];
    const h = harness(pads);
    expect(h.input.polling()).toBe(false);
    expect(h.frames).toHaveLength(0);
    pads.push(pad());
    h.fire('gamepadconnected');
    expect(h.input.polling()).toBe(true);
    h.run(16);
    expect(h.frames).toHaveLength(1); // still going
    pads.length = 0;
    h.fire('gamepaddisconnected');
    expect(h.input.polling()).toBe(false);
  });

  it('maps A, B, the shoulders and Start to their actions, once per press', () => {
    const pads = [pad(['a'])];
    const h = harness(pads);
    h.run(0);
    h.run(16); // still held: not again
    pads[0] = pad(['b', 'lb']);
    h.run(32);
    pads[0] = pad(['rb', 'start']);
    h.run(48);
    expect(h.log).toEqual(['cursor on', 'a', 'b', 'speed -1', 'speed 1', 'start']);
  });

  it('pans with the stick and the d-pad, and zooms with the right stick', () => {
    const pads = [pad([], [1, 0, 0, 0])];
    const h = harness(pads);
    h.run(0);
    h.run(100); // 0.1 s at full stick
    pads[0] = pad(['down']);
    h.run(200);
    pads[0] = pad([], [0, 0, 0, -1]);
    h.run(300);
    expect(h.log).toEqual(['cursor on', `pan ${PAN_SPEED / 60} 0`, `pan ${PAN_SPEED / 10} 0`, `pan 0 ${PAN_SPEED / 10}`, 'zoom in']);
  });

  it('moves focus with the d-pad while a menu is open, instead of panning', () => {
    const pads = [pad(['down'])];
    const h = harness(pads);
    h.setMenu(true);
    h.run(0);
    h.run(16);
    expect(h.log).toEqual(['cursor on', 'focus down']);
  });

  it('shows the cursor on pad input and hides it on a real mouse or finger, never on its own clicks', () => {
    const pads = [pad(['a'])];
    const h = harness(pads);
    h.run(0);
    h.fire('pointermove', { isTrusted: false, pointerType: 'mouse' }); // the ui's own click on the tower
    h.fire('pointerdown', { isTrusted: true, pointerType: 'touch' });
    expect(h.log).toEqual(['cursor on', 'a', 'cursor off']);
  });
});

describe('the controller in the shell', () => {
  let dom: FakeDom;
  let uninstall: () => void;
  let savedNavigator: PropertyDescriptor | undefined;
  beforeEach(() => {
    dom = new FakeDom();
    uninstall = dom.install();
    savedNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  });
  afterEach(() => {
    uninstall();
    if (savedNavigator) Object.defineProperty(globalThis, 'navigator', savedNavigator);
  });

  it('polls a mocked navigator.getGamepads, steps the speed on the shoulders and opens the Menu on Start', () => {
    const pads: PadLike[] = [];
    Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => pads }, configurable: true });
    const speeds: number[] = [];
    let speed = 1;
    const game = {
      world: { cash: 1_000_000, population: 0, stars: 1, time: { minute: 0 }, log: [], logTotal: 0, rooms: new Map(), shafts: new Map(), sims: new Map(), events: [] },
      subscribe: () => () => {},
      getHover: () => null,
      getSpeed: () => speed,
      setSpeed: (s: number) => {
        speed = s;
        speeds.push(s);
      },
      getTool: () => ({ kind: 'none' }),
      setTool: () => {},
      getPlacement: () => null,
      getPlacementRect: () => null,
      getSelection: () => null,
      setChrome: () => {},
      setReducedMotion: () => {},
      getSlot: () => 'mine',
    };
    const root = dom.createElement('div');
    createUi(root as never, game as never, {} as never);
    const shell = root.children[0]!;
    const cursor = shell.children.find((n) => n.className.includes('hs-pad-cursor'))!;
    expect(cursor.className).toContain('is-hidden');
    pads.push(pad(['rb']));
    dom.fireWindow('gamepadconnected');
    dom.runFrame();
    expect(speeds).toEqual([2]);
    expect(cursor.className).not.toContain('is-hidden');
    pads[0] = pad(['start']);
    dom.runFrame();
    expect(shell.descendants().some((n) => n.getAttribute('role') === 'dialog')).toBe(true);
  });
});
