// The share panel's capture failure path: a snapshot or compose that throws, and a toBlob that
// yields nothing, both say the same notice and leave the message text shared regardless.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Renderer } from '../../src/render/renderer';
import { createSharePanel, type PanelContext } from '../../src/ui/panels';
import { shareMessage } from '../../src/share/share';
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
  dom = new FakeDom();
  uninstall = dom.install();
  shareModule.composeShareImage.mockReset();
});
afterEach(() => {
  uninstall();
  vi.restoreAllMocks();
});

const STATS = { floors: 12, people: 340, stars: 4 };

function setup(renderer: Renderer): { panel: FakeElement; notices: string[] } {
  const notices: string[] = [];
  const game = {
    world: {
      rooms: new Map([[1, { id: 1, floor: 1, height: 12 }]]),
      population: 340,
      stars: 4,
    },
  } as never;
  const ctx: PanelContext = {
    apply: () => ({ ok: true }) as never,
    notice: (text) => notices.push(text),
    close: () => {},
    reducedMotion: false,
    setReducedMotion: () => {},
  };
  const panel = createSharePanel(game, renderer, ctx) as unknown as FakeElement;
  return { panel, notices };
}

const messageText = (panel: FakeElement): string | undefined =>
  (panel.descendants().find((n) => n.tagName === 'TEXTAREA') as (FakeElement & { value?: string }) | undefined)?.value;

const saveButton = (panel: FakeElement): FakeElement | undefined =>
  panel.descendants().find((n) => n.tagName === 'BUTTON' && n.textContent === 'Save image');

describe('share panel capture failure', () => {
  it('says it could not capture the tower when the snapshot throws, and still shares the text', () => {
    const renderer = {
      snapshot: () => {
        throw new Error('no gl context');
      },
    } as unknown as Renderer;

    const { panel, notices } = setup(renderer);

    expect(notices).toEqual(['Could not take a picture of the tower.']);
    expect(shareModule.composeShareImage).not.toHaveBeenCalled();
    expect(messageText(panel)).toBe(shareMessage(STATS));
    expect(saveButton(panel)?.disabled).toBe(true);
  });

  it('says it could not capture the tower when toBlob yields nothing, and still shares the text', () => {
    const fakeCanvas = { toBlob: (cb: (result: Blob | null) => void) => cb(null) };
    shareModule.composeShareImage.mockReturnValue(fakeCanvas);
    const renderer = { snapshot: () => ({}) } as unknown as Renderer;

    const { panel, notices } = setup(renderer);

    expect(notices).toEqual(['Could not take a picture of the tower.']);
    expect(shareModule.composeShareImage).toHaveBeenCalledTimes(1);
    expect(messageText(panel)).toBe(shareMessage(STATS));
    expect(saveButton(panel)?.disabled).toBe(true);
  });
});
