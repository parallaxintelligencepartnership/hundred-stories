// The rules ui.css carries for package P4a, read as text since the fake DOM lays nothing out (the
// rendered geometry is measured in headless Chrome): pause-menu entries center their icon and
// word, Save keeps the room of "Saved", and at 900 px and wider a card stands below the round
// buttons, or beside its selection with no slide.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SAVED_WORD, SAVE_WORD } from '../../src/ui/save-button';

const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8');
/** The declarations of the first rule with exactly this selector (from its brace to the next). */
function rule(selector: string, from = 0): string {
  // At the start of a line, so `.hs-face-word` is not found inside a longer selector.
  const at = css.indexOf(`\n${selector} {`, from);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('pause-menu entries', () => {
  it('center the icon and word as one group, the word taking only its own width', () => {
    const item = rule('.hs-ui .hs-pause-item');
    expect(item).toContain('justify-content: center;');
    expect(item).not.toContain('text-align: left');
    expect(rule('.hs-ui .hs-pause-item .hs-face-word')).toContain('flex: 0 1 auto;');
  });

  it('leave the other faces alone: settings, level and switch rows keep the word that fills the row', () => {
    expect(rule('.hs-ui .hs-face')).not.toContain('justify-content');
    expect(rule('.hs-face-word')).toContain('flex: 1 1 auto;');
  });

  it('keep Save the width of its wider word, so its icon does not move between Save and Saved', () => {
    expect(SAVED_WORD.length).toBeGreaterThan(SAVE_WORD.length);
    const reserve = rule(".hs-ui .hs-pause-item[data-entry='save'] .hs-face-word::after");
    expect(reserve).toContain(`content: '${SAVED_WORD}';`);
    expect(reserve).toContain('height: 0;');
    expect(reserve).toContain('visibility: hidden;');
  });
});

describe('cards at 900 px and wider', () => {
  const wide = css.indexOf('@media (min-width: 900px) {\n  .hs-sheet {');

  it('start below the row of round buttons, never 8 px under Menu where the Views dropdown hangs', () => {
    expect(wide).toBeGreaterThan(0);
    const sheet = rule('  .hs-sheet', wide);
    expect(sheet).toContain('2 * var(--gap-float) + var(--touch) + 8px');
    expect(sheet).not.toMatch(/top: calc\(var\(--top-actual, calc\(var\(--top-h\) \+ var\(--safe-top\)\)\) \+ var\(--gap-float\)\);/);
    // The Views dropdown keeps that spot under its button for itself.
    expect(rule('.hs-views-menu')).toContain('top: calc(var(--top-actual, calc(var(--top-h) + var(--safe-top))) + var(--gap-float));');
  });

  it('stand where ui.ts puts a card beside its selection, capped to the room it measured', () => {
    const anchored = rule('  .hs-sheet.is-anchored', wide);
    expect(anchored).toContain('top: var(--card-top);');
    expect(anchored).toContain('left: var(--card-left);');
    expect(anchored).toContain('right: auto;');
    expect(anchored).toContain('max-height: var(--card-max-h);');
  });

  it('move with the camera without a slide: left and top are never transitioned', () => {
    const base = rule('.hs-sheet');
    expect(base).toContain('transition:');
    expect(base).not.toMatch(/\b(left|top|inset)\s+var/);
    expect(rule('.hs-ui.is-reduced .hs-sheet')).toBe('\n  transition: opacity var(--motion-fade) var(--ease-standard);\n');
  });
});
