// Turning Watch on never discards what the player typed (Matt, 2026-09-28, on the review of
// 38f23ec): a feedback card holding unsent words, or a share panel whose snapshot is still being
// made, stays open and Watch waits for it as before. Every other panel closes as in 38f23ec.
// And the share panel lets go of its preview's object URL even when it closes before the image.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Renderer } from '../../src/render/renderer';
import { createSharePanel, type PanelContext } from '../../src/ui/panels';
import { createUi } from '../../src/ui/ui';
import { WATCH_CLASS, WATCH_IDLE_MS } from '../../src/ui/watch';
import { FakeDom, type FakeElement } from './fake-dom';

const shareModule = vi.hoisted(() => ({
  composeShareImage: vi.fn<(source: unknown, stats: unknown) => unknown>(),
}));
vi.mock('../../src/share/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/share/share')>()),
  composeShareImage: shareModule.composeShareImage,
}));

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  dom = new FakeDom();
  uninstall = dom.install();
  const store = (globalThis as unknown as { window: { localStorage: { setItem(k: string, v: string): void } } }).window.localStorage;
  store.setItem('hs.intro.seen', 'true');
  store.setItem('hs.guide.done', 'true');
  shareModule.composeShareImage.mockReset();
});
afterEach(() => {
  uninstall();
  vi.useRealTimers();
  vi.restoreAllMocks();
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

type Field = FakeElement & { value: string };
const click = (node: FakeElement): void => (node.listeners.get('click') ?? []).forEach((f) => f({}));
const fire = (node: FakeElement, type: string): void => (node.listeners.get(type) ?? []).forEach((f) => f({ target: node }));
const byLabel = (root: FakeElement, label: string): FakeElement =>
  root.descendants().find((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === label)!;
const buttonNamed = (root: FakeElement, text: string): FakeElement =>
  root.descendants().find((n) => n.tagName === 'BUTTON' && n.textContent === text)!;
const dialogs = (shell: FakeElement): FakeElement[] => shell.descendants().filter((n) => n.getAttribute('role') === 'dialog');
const watching = (shell: FakeElement): boolean => shell.classList.contains(WATCH_CLASS);

function mount(renderer: unknown = {}): { root: FakeElement; shell: FakeElement } {
  const root = dom.createElement('div');
  createUi(root as never, mkGame(), renderer as never);
  return { root, shell: root.children[0] as FakeElement };
}

function openFeedback(root: FakeElement): Field {
  click(byLabel(root, 'Menu'));
  click(buttonNamed(root, 'Send feedback'));
  return root.descendants().find((n) => n.id === 'hs-feedback-text') as Field;
}

/** A canvas whose toBlob holds its callback until the test lets it go, as a slow encode would. */
function slowCanvas(): { canvas: unknown; finish(): void } {
  let held: ((blob: Blob | null) => void) | null = null;
  return {
    canvas: { toBlob: (cb: (blob: Blob | null) => void) => (held = cb) },
    finish: () => held?.(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })),
  };
}

describe('turning Watch on keeps what the player has not sent', () => {
  it('a feedback card with typed words stays open with the words, and Watch waits for it', () => {
    const { root, shell } = mount();
    const text = openFeedback(root);
    text.value = 'half a thought';
    fire(text, 'input');
    click(byLabel(root, 'Watch'));
    vi.advanceTimersByTime(3 * WATCH_IDLE_MS);
    expect(dialogs(shell)).toHaveLength(1);
    expect((root.descendants().find((n) => n.id === 'hs-feedback-text') as Field).value).toBe('half a thought');
    expect(watching(shell)).toBe(false);
    // Closed by the player, Watch goes ahead as before.
    click(buttonNamed(dialogs(shell)[0]!, 'Cancel'));
    vi.advanceTimersByTime(WATCH_IDLE_MS);
    expect(watching(shell)).toBe(true);
  });

  it('an empty feedback card closes like any other panel', () => {
    const { root, shell } = mount();
    const text = openFeedback(root);
    text.value = '   ';
    fire(text, 'input');
    expect(dialogs(shell)).toHaveLength(1);
    click(byLabel(root, 'Watch'));
    expect(dialogs(shell)).toHaveLength(0);
    vi.advanceTimersByTime(WATCH_IDLE_MS);
    expect(watching(shell)).toBe(true);
  });

  it('a share panel still making its snapshot stays open; once the image is in, it closes like any other', () => {
    const slow = slowCanvas();
    shareModule.composeShareImage.mockReturnValue(slow.canvas);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const { root, shell } = mount({ snapshot: () => ({}) });
    click(byLabel(root, 'Share'));
    expect(dialogs(shell)).toHaveLength(1);
    expect(shareModule.composeShareImage).toHaveBeenCalledTimes(1);
    click(byLabel(root, 'Watch'));
    vi.advanceTimersByTime(3 * WATCH_IDLE_MS);
    expect(dialogs(shell)).toHaveLength(1);
    expect(watching(shell)).toBe(false);

    // Watch off, the image arrives, Watch on again: nothing is pending, so the panel closes.
    click(byLabel(root, 'Watch'));
    slow.finish();
    click(byLabel(root, 'Watch'));
    expect(dialogs(shell)).toHaveLength(0);
    vi.advanceTimersByTime(WATCH_IDLE_MS);
    expect(watching(shell)).toBe(true);
  });
});

// Review of 38f23ec, A3: a share panel closed before toBlob answered made an object URL after
// its remove() had already run, and nothing ever revoked it.
describe('the share panel preview URL', () => {
  function sharePanel(): { panel: FakeElement; notices: string[] } {
    const notices: string[] = [];
    const ctx: PanelContext = {
      apply: () => ({ ok: true }) as never,
      notice: (text) => notices.push(text),
      close: () => {},
      reducedMotion: false,
      setReducedMotion: () => {},
    };
    const game = { world: { rooms: new Map([[1, { id: 1, floor: 1, height: 12 }]]), population: 340, stars: 4 } } as never;
    const renderer = { snapshot: () => ({}) } as unknown as Renderer;
    return { panel: createSharePanel(game, renderer, ctx) as unknown as FakeElement, notices };
  }

  it('closed before the image is made: no object URL is left behind', () => {
    const slow = slowCanvas();
    shareModule.composeShareImage.mockReturnValue(slow.canvas);
    let live = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${(live += 1)}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => void (live -= 1));
    const { panel } = sharePanel();
    panel.remove();
    slow.finish();
    expect(live).toBe(0);
  });

  it('closed after the image is made: its URL is revoked', () => {
    const slow = slowCanvas();
    shareModule.composeShareImage.mockReturnValue(slow.canvas);
    let live = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${(live += 1)}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => void (live -= 1));
    const { panel } = sharePanel();
    slow.finish();
    expect(live).toBe(1);
    panel.remove();
    expect(live).toBe(0);
  });
});
