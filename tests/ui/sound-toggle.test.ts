// The round Sound button beside Watch (Matt, 2026-09-27): it turns the same setting as the
// Settings switch, each follows the other, it wakes the engine on the tap that turns it on (the
// iOS gesture), and watch mode hides it with the rest of the chrome.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SOUND_KEY, createSound } from '../../src/audio/audio';
import { PREF_KEYS } from '../../src/ui/prefs';
import { LABEL_IDLE_MS } from '../../src/ui/quiet-labels';
import { SOUND_TIP, createSoundToggle, setSoundOn } from '../../src/ui/sound-toggle';
import { createUi } from '../../src/ui/ui';
import { WATCH_CLASS } from '../../src/ui/watch';
import { FakeDom, type FakeElement, choosePauseEntry } from './fake-dom';

const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8');

let dom: FakeDom;
let uninstall: () => void;
let store: { getItem(k: string): string | null; setItem(k: string, v: string): void };
beforeEach(() => {
  vi.useFakeTimers();
  dom = new FakeDom();
  uninstall = dom.install();
  store = (globalThis as unknown as { window: { localStorage: typeof store } }).window.localStorage;
  store.setItem('hs.intro.seen', 'true');
  store.setItem('hs.guide.done', 'true');
});
afterEach(() => {
  uninstall();
  vi.useRealTimers();
});

function mkGame(): never {
  return {
    world: {
      seed: 1, cash: 1e6, population: 0, stars: 1, time: { minute: 0 }, log: [], logTotal: 0, rooms: new Map(), shafts: new Map(),
      sims: new Map(), events: [], stats: { lastQuarter: null, vipRating: 'none', weddingsHeld: 0 },
      story: { followed: [], threads: {}, recent: [], seq: 0 },
    },
    subscribe: () => () => {},
    getHover: () => null,
    getSpeed: () => 1,
    setSpeed: () => {},
    togglePause: () => {},
    getTool: () => ({ kind: 'none' }),
    setTool: () => {},
    getPlacement: () => null,
    getPlacementRect: () => null,
    getSelection: () => null,
    setChrome: () => {},
    setReducedMotion: () => {},
    getSlot: () => 'mine',
    select() {},
  } as never;
}

function mount(): { root: FakeElement; shell: FakeElement } {
  const root = dom.createElement('div');
  createUi(root as never, mkGame(), {} as never);
  return { root, shell: root.children[0] as FakeElement };
}

const byLabel = (root: FakeElement, label: string): FakeElement =>
  root.descendants().find((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === label)!;
const click = (node: FakeElement): void => (node.listeners.get('click') ?? []).forEach((f) => f({}));
const classesOf = (node: FakeElement): string[] => node.className.split(/\s+/).filter(Boolean);
const glyph = (button: FakeElement): string | null =>
  button.descendants().find((n) => n.tagName.toLowerCase() === 'use')?.getAttribute('href') ?? null;

describe('the Sound button', () => {
  it('sits directly beside Watch in the top bar, round like it, off by default with the crossed speaker', () => {
    const { root } = mount();
    const sound = byLabel(root, 'Sound');
    const watch = byLabel(root, 'Watch');
    const top = root.descendants().find((n) => n.className === 'hs-top')!;
    expect(classesOf(sound)).toEqual(expect.arrayContaining(['hs-icon-btn', 'hs-round', 'hs-sound-btn']));
    expect(top.children.indexOf(sound)).toBe(top.children.indexOf(watch) - 1);
    expect([sound.getAttribute('aria-pressed'), glyph(sound), sound.title]).toEqual(['false', '#hs-icon-mute', SOUND_TIP]);
    expect(sound.textContent).toBe('Sound');
    // Measured beside Watch: its left edge, from the bar's, goes into --sound-x.
    expect(classesOf(sound)).toContain('is-placed');
    expect(sound.style['--sound-x']).toMatch(/^-?\d+px$/);
  });

  it('follows Watch on every frame while the words fold away and come back, until the fold ends', () => {
    const { root } = mount();
    const sound = byLabel(root, 'Sound');
    const watch = byLabel(root, 'Watch');
    // Watch stays centered under Views, so its left edge moves in as its word folds away.
    let watchLeft = 100;
    watch.getBoundingClientRect = () => ({ width: 52, height: 52, top: 0, left: watchLeft, right: watchLeft + 52, bottom: 52 });
    vi.advanceTimersByTime(LABEL_IDLE_MS);
    watchLeft = 110;
    dom.runFrame();
    expect(sound.style['--sound-x']).toBe('110px');
    watchLeft = 130;
    dom.runFrame();
    expect(sound.style['--sound-x']).toBe('130px');
    // The fold's own transition ends: the last measure, and no more frames.
    const label = watch.descendants().find((n) => classesOf(n).includes('hs-btn-label'))!;
    watchLeft = 134;
    (watch.listeners.get('transitionend') ?? []).forEach((f) => f({ target: label, propertyName: 'max-width' }));
    expect(sound.style['--sound-x']).toBe('134px');
    watchLeft = 150;
    dom.runFrame();
    expect(sound.style['--sound-x']).toBe('134px');
    // A pointer move brings the words back, and Sound follows again.
    dom.fireWindow('pointermove', { type: 'pointermove', target: dom.body });
    dom.runFrame();
    expect(sound.style['--sound-x']).toBe('150px');
  });

  it('turns the same stored setting as the Settings switch, one tap each way', () => {
    expect(PREF_KEYS.sound).toBe(SOUND_KEY);
    const { root } = mount();
    const sound = byLabel(root, 'Sound');
    click(sound);
    expect([store.getItem(SOUND_KEY), sound.getAttribute('aria-pressed'), glyph(sound)]).toEqual(['true', 'true', '#hs-icon-sound']);
    click(sound);
    expect([store.getItem(SOUND_KEY), sound.getAttribute('aria-pressed'), glyph(sound)]).toEqual(['false', 'false', '#hs-icon-mute']);
  });

  it('reads pressed when sound was left on', () => {
    store.setItem(SOUND_KEY, 'true');
    const { root } = mount();
    expect(byLabel(root, 'Sound').getAttribute('aria-pressed')).toBe('true');
  });

  it('follows the Settings switch, and the switch follows it while Settings is open', () => {
    const { root } = mount();
    const sound = byLabel(root, 'Sound');
    click(byLabel(root, 'Menu'));
    choosePauseEntry(root, 'settings');
    const toggle = root.descendants().find((n) => n.id === 'hs-sound')!;
    const music = root.descendants().find((n) => n.id === 'hs-sound-music') as unknown as { disabled: boolean };
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    click(toggle);
    expect([sound.getAttribute('aria-pressed'), store.getItem(SOUND_KEY)]).toEqual(['true', 'true']);
    click(sound);
    expect([toggle.getAttribute('aria-checked'), music.disabled]).toEqual(['false', true]);
    click(sound);
    expect([toggle.getAttribute('aria-checked'), music.disabled]).toEqual(['true', false]);
  });

  it('wakes the engine on the tap that turns it on: the press is the gesture iOS asks for', () => {
    const listeners = new Map<string, (() => void)[]>();
    const target = {
      addEventListener: (type: string, fn: () => void) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
      removeEventListener: () => {},
    };
    let contexts = 0;
    const game = { world: { seed: 1, stars: 1, time: { minute: 0 }, rooms: new Map() }, subscribe: () => () => {}, subscribeEvents: () => () => {} };
    const memory = new Map<string, string>();
    const engine = createSound(game as never, {
      target,
      store: { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => void memory.set(k, v) },
      createContext: () => {
        contexts += 1;
        throw new Error('no Web Audio here');
      },
      setInterval: () => 1,
      clearInterval: () => {},
    });
    const button = createSoundToggle(engine).button as unknown as FakeElement;
    // A tap: the press reaches the window's capture listeners first, then the click lands here.
    for (const fn of listeners.get('pointerdown') ?? []) fn();
    expect(contexts).toBe(0); // still off: the press alone builds nothing
    click(button);
    expect([contexts, engine.settings.on, memory.get(SOUND_KEY)]).toEqual([1, true, 'true']);
    setSoundOn(engine, false);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    engine.destroy();
  });
});

/** Enough of an AudioContext for the engine to build its graph on: every node takes every call. */
function stubContext() {
  const param = (): Record<string, unknown> => {
    const p: Record<string, unknown> = { value: 0 };
    for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'cancelScheduledValues', 'setTargetAtTime']) {
      p[m] = (v?: number) => {
        if (typeof v === 'number' && m !== 'cancelScheduledValues') p.value = v;
        return p;
      };
    }
    return p;
  };
  const node = (): Record<string, unknown> => ({
    gain: param(), frequency: param(), detune: param(), delayTime: param(), threshold: param(), knee: param(), ratio: param(),
    attack: param(), release: param(), Q: param(), onended: null, type: '', buffer: null, loop: false,
    connect() {}, disconnect() {}, start() {}, stop() {},
  });
  const ctx = {
    currentTime: 0,
    sampleRate: 8000,
    destination: node(),
    state: 'suspended' as 'suspended' | 'running',
    resumes: 0,
    createOscillator: node, createGain: node, createBiquadFilter: node, createDelay: node, createDynamicsCompressor: node,
    createBufferSource: node, createStereoPanner: node, createWaveShaper: node,
    createBuffer: (_channels: number, length: number) => {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    },
    resume() {
      ctx.resumes += 1;
      ctx.state = 'running';
      return Promise.resolve();
    },
    suspend() {
      ctx.state = 'suspended';
      return Promise.resolve();
    },
  };
  return ctx;
}

describe('the Sound button and a suspended engine', () => {
  it('off then on again resumes the suspended context', async () => {
    const listeners = new Map<string, (() => void)[]>();
    const target = {
      addEventListener: (type: string, fn: () => void) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
      removeEventListener: () => {},
    };
    const ctx = stubContext();
    const game = { world: { seed: 1, stars: 1, time: { minute: 12 * 60 }, rooms: new Map(), events: [] }, subscribe: () => () => {}, subscribeEvents: () => () => {} };
    const memory = new Map<string, string>();
    const engine = createSound(game as never, {
      target,
      store: { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => void memory.set(k, v) },
      createContext: () => ctx as never,
      now: () => 0,
      setInterval: () => 1,
      clearInterval: () => {},
    });
    const button = createSoundToggle(engine).button as unknown as FakeElement;
    for (const fn of listeners.get('pointerdown') ?? []) fn();
    click(button); // on: the context is built and resumed
    await Promise.resolve();
    expect([ctx.resumes, ctx.state]).toEqual([1, 'running']);
    click(button); // off: the engine sleeps and suspends the context
    await Promise.resolve();
    await Promise.resolve();
    expect([ctx.state, button.getAttribute('aria-pressed')]).toEqual(['suspended', 'false']);
    click(button); // on again: the suspended context resumes
    await Promise.resolve();
    expect([ctx.resumes, ctx.state, button.getAttribute('aria-pressed')]).toEqual([2, 'running', 'true']);
    engine.destroy();
  });
});

describe('Sound button styles', () => {
  it('steps aside in watch mode with the rest of the chrome', () => {
    const at = css.indexOf(`.hs-ui.${WATCH_CLASS} :is(`);
    const hide = css.slice(at, css.indexOf('}', at));
    expect(hide).toMatch(/\.hs-watch-btn, \.hs-sound-btn,/);
    expect(hide).toContain('pointer-events: none;');
  });

  it('sits one gap left of Watch in the same row, and is as big a target', () => {
    expect(css).toMatch(/\.hs-sound-btn \{\s*position: absolute;\s*top: calc\(100% \+ var\(--gap-float\)\);\s*right: calc\(var\(--touch\) \+ 8px \+ var\(--gap-float\)\);/);
    expect(css).toMatch(/\.hs-sound-btn\.is-placed \{\s*right: auto;\s*left: calc\(var\(--sound-x\) - var\(--gap-float\)\);\s*translate: -100% 0;/);
    const phone = css.slice(css.indexOf('@media (max-width: 720px) {\n  /* The top bar on a phone'));
    expect(phone).toMatch(/\.hs-sound-btn,\s*\.hs-sound-btn\.is-placed \{\s*left: auto;\s*right: calc\(var\(--touch\) \+ 8px \+ var\(--gap-float\)\);/);
    // On a wide screen Watch shows its word, so Sound waits hidden for the measure; a phone's fallback is right.
    expect(css).toMatch(/\.hs-sound-btn:not\(\.is-placed\) \{\s*visibility: hidden;/);
    expect(phone).toMatch(/\.hs-sound-btn:not\(\.is-placed\),\s*\.hs-save-btn:not\(\.is-placed\) \{\s*visibility: visible;/);
    // Its size is .hs-round's, the Watch button's own: no rule of its own sets one. The quiet
    // fold (quiet-labels.ts) takes Watch's and Sound's padding to 0 alike while the words are away.
    // So does the fold where the words would reach the open Build dock (P1 review I-3).
    const resting = css
      .replace(/\.hs-ui\.is-quiet-labels[^{]*\{[^}]*\}/g, '')
      .replace(/@media \(min-width: 721px\) and \(max-width: (819|1023)px\) \{[^@]*?\}\s*\}/g, '');
    expect(resting).not.toMatch(/\.hs-sound-btn[^{]*\{[^}]*(min-height|min-width|padding):/);
  });
});

describe('a phone at 390 px: the alerts band stops short of Sound and Save', () => {
  // The phone's own values (ui.css :root and its 720 px block), no safe area, a 1x ui scale.
  const vars: Record<string, number> = { '--edge': 8, '--touch': 44, '--gap-float': 8, '--safe-right': 0, '--toast-bleed': 24 };
  const px = (expr: string): number => {
    const js = expr
      .replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
        if (!(name in vars)) throw new Error(`no value for ${name}`);
        return String(vars[name]);
      })
      .replace(/calc\(/g, '(')
      .replace(/(\d+(?:\.\d+)?)px/g, '$1');
    if (!/^[\d\s+\-*/().]+$/.test(js)) throw new Error(`not arithmetic: ${js}`);
    return Function(`return (${js});`)() as number;
  };
  const phone = css.slice(css.indexOf('@media (max-width: 720px) {\n  /* The top bar on a phone'));
  const declIn = (block: string, selector: string, prop: string): string => {
    const at = block.indexOf(`${selector} {`);
    if (at < 0) throw new Error(`no ${selector}`);
    const body = block.slice(at, block.indexOf('}', at));
    const m = new RegExp(`\\n\\s*${prop}: ([^;]+);`).exec(body);
    if (!m) throw new Error(`no ${prop} in ${selector}`);
    return m[1] as string;
  };

  it('starts every alert card a gap under Save, Sound and Watch, map up or not, left of the map (P1 review A-3)', () => {
    const width = 390;
    expect(vars['--edge']).toBe(Number(/--edge: (\d+)px;/.exec(phone)?.[1]));
    // The round buttons' row: one gap under the bar, a round button (touch plus 8 px) tall.
    const bar = 56; // any bar bottom: both sides of the comparison carry it
    const rowBottom = bar + vars['--gap-float']! + px('calc(var(--touch) + 8px)');
    const alertsBlock = css.slice(css.lastIndexOf('@media (max-width: 720px) {'));
    const top = declIn(alertsBlock, '  .hs-toasts', 'top')
      .replace('var(--top-actual, calc(var(--top-h) * 2 + var(--safe-top)))', String(bar))
      .replace('max(var(--chip-h, 0px), ', 'M(0, ');
    const js = top.replace(/var\((--[\w-]+)\)/g, (_, name: string) => String(vars[name])).replace(/calc\(/g, '(').replace(/(\d+(?:\.\d+)?)px/g, '$1');
    expect(/^[\dM\s+\-*/().,]+$/.test(js)).toBe(true);
    // The cards start --toast-bleed inside the band's top edge.
    const cardsTop = (Function('M', `return (${js});`)(Math.max) as number) + vars['--toast-bleed']!;
    expect(cardsTop).toBeGreaterThanOrEqual(rowBottom + vars['--gap-float']!);
    for (const selector of ['  .hs-toasts', '.hs-minimap:not(.is-hidden) ~ .hs-toasts']) {
      // The cards end --toast-bleed inside the band's right edge, left of the 64 px map's column.
      const cardsRight = width - px(declIn(alertsBlock, selector, 'right')) - vars['--toast-bleed']!;
      expect(cardsRight).toBeLessThanOrEqual(width - vars['--edge']! - 64 - vars['--edge']!);
      // The cards' own left edge is --pad in (8 px): 302 px of card at 390, from 182 beside Save.
      const cardsLeft = Number(/--pad: (\d+)px;/.exec(css)?.[1]);
      expect(declIn(alertsBlock, '  .hs-toasts', 'left')).toBe('calc(var(--pad) + var(--safe-left) - var(--toast-bleed))');
      expect(cardsRight - cardsLeft).toBe(302);
    }
  });

});
