// One try per date (audit 2026-09-25, C S8): inside Today's tower the saving menu offers nothing
// that rewinds or replaces the run. "Go back to last save" and "Open a saved file" (and the file
// input behind it) are not there; Save now and Save to a file still are. My tower keeps all four.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSettingsPanel, type PanelContext } from '../../src/ui/panels';
import { FakeDom, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
});
afterEach(() => uninstall());

const ctx: PanelContext = {
  apply: () => ({ ok: true }) as never,
  notice: () => {},
  close: () => {},
  reducedMotion: false,
  setReducedMotion: () => {},
  openDaily: () => {},
  openMyTower: () => {},
};

function menu(slot: 'mine' | 'daily' | 'friend'): FakeElement {
  const game = { world: { seed: 1, log: [], logTotal: 0 }, getSlot: () => slot } as never;
  return createSettingsPanel(game, ctx) as unknown as FakeElement;
}
const texts = (root: FakeElement): string[] => root.descendants().map((n) => n.textContent);
const offers = (root: FakeElement, words: string): boolean =>
  root.descendants().some((n) => (n.tagName === 'BUTTON' || n.tagName === 'INPUT') && (n.textContent === words || n.getAttribute('aria-label') === words));

describe("the saving menu in Today's tower", () => {
  it('offers no way to rewind or replace the run', () => {
    const panel = menu('daily');
    expect(offers(panel, 'Go back to last save')).toBe(false);
    expect(offers(panel, 'Open a saved file')).toBe(false);
    expect(panel.descendants().some((n) => n.id === 'hs-import')).toBe(false);
    expect(texts(panel)).toContain('Save now');
    expect(texts(panel)).toContain('Save to a file');
  });

  it('My tower and a friend tower keep all four rows', () => {
    for (const slot of ['mine', 'friend'] as const) {
      const panel = menu(slot);
      for (const words of ['Save now', 'Go back to last save', 'Save to a file', 'Open a saved file']) {
        expect(offers(panel, words), `${slot}: ${words}`).toBe(true);
      }
    }
  });
});
