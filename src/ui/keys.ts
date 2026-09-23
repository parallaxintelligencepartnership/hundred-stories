// The keyboard map for the build palette, as pure decisions.
//
// Number keys 1 to 9 pick a palette group in the palette's order and put its first tool in
// hand; a letter picks a tool inside the active group (the tile shows its letter); Escape drops
// the tool; Space pauses and resumes. W A S D, the arrows, plus, minus and Home belong to the
// camera (src/render/renderer.ts), so no tile is ever given W, A, S or D.

/** Letters the camera already answers to. A tile never takes one of these. */
export const RESERVED_LETTERS: ReadonlySet<string> = new Set(['W', 'A', 'S', 'D']);

/**
 * One letter per label, unique within the list: the first letter of the label that is not
 * reserved and not taken by an earlier label, else the first free letter of the alphabet.
 * Deterministic, so a tile keeps its letter from one load to the next.
 */
export function assignLetters(labels: readonly string[]): string[] {
  const taken = new Set<string>();
  const pick = (candidates: string): string => {
    for (const ch of candidates.toUpperCase()) {
      if (ch < 'A' || ch > 'Z') continue;
      if (RESERVED_LETTERS.has(ch) || taken.has(ch)) continue;
      return ch;
    }
    return '';
  };
  return labels.map((label) => {
    const letter = pick(label) || pick('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    if (letter) taken.add(letter);
    return letter;
  });
}

/** The words a tile's tooltip uses for its keys: "1 then L". */
export function keysLabel(group: number, letter: string): string {
  return letter ? `${group + 1} then ${letter}` : `${group + 1}`;
}

/** The parts of a KeyboardEvent the map reads, so tests can pass a plain object. */
export interface KeyLike {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}

export type KeyAction =
  | { kind: 'pause' }
  | { kind: 'speed'; step: 1 | -1 }
  | { kind: 'clear' }
  | { kind: 'group'; group: number }
  | { kind: 'tool'; group: number; index: number };

/**
 * What a key press asks for, or null when it is not ours.
 *
 * groups[g] is the list of letters for group g's tiles, in tile order. activeGroup is the group
 * of the tool in hand, or the group last picked, or null; a letter with no active group, or a
 * letter the active group does not use, does nothing.
 */
export function keyAction(event: KeyLike, groups: readonly (readonly string[])[], activeGroup: number | null): KeyAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.key === ' ' || event.code === 'Space') return { kind: 'pause' };
  if (event.key === 'Escape') return { kind: 'clear' };
  if (event.key === ',' || event.key === '<') return { kind: 'speed', step: -1 };
  if (event.key === '.' || event.key === '>') return { kind: 'speed', step: 1 };
  if (/^[1-9]$/.test(event.key)) {
    const group = Number(event.key) - 1;
    return group < groups.length ? { kind: 'group', group } : null;
  }
  if (/^[a-zA-Z]$/.test(event.key)) {
    if (activeGroup === null) return null;
    const letters = groups[activeGroup];
    if (!letters) return null;
    const index = letters.indexOf(event.key.toUpperCase());
    return index >= 0 ? { kind: 'tool', group: activeGroup, index } : null;
  }
  return null;
}

/** Is focus in a form field? Then no key is ours: a checkbox takes Space, a field takes letters. */
export function isFormField(target: unknown): boolean {
  const node = target as NodeLike | null;
  if (!node || typeof node.tagName !== 'string') return false;
  if (node.isContentEditable === true) return true;
  const tag = node.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** The speeds in order, slowest first: comma steps left, period steps right. */
const SPEED_STEPS = [0, 1, 2, 4] as const;

/** One speed step up or down from the current one, held at pause and at 4x. */
export function stepSpeed(speed: number, step: 1 | -1): 0 | 1 | 2 | 4 {
  const at = SPEED_STEPS.indexOf(speed as 0 | 1 | 2 | 4);
  const from = at < 0 ? 1 : at;
  return SPEED_STEPS[Math.max(0, Math.min(SPEED_STEPS.length - 1, from + step))] as 0 | 1 | 2 | 4;
}

/** Input types that take typing. A checkbox, a button or a file picker does not. */
const TEXT_INPUT_TYPES = new Set(['', 'text', 'number', 'search', 'email', 'url', 'tel', 'password', 'date', 'time']);

interface NodeLike {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  children?: ArrayLike<unknown>;
}

/** Is this node one a player types into? A focused one means no key is ours. */
export function isTextEntry(target: unknown): boolean {
  const node = target as NodeLike | null;
  if (!node || typeof node.tagName !== 'string') return false;
  if (node.isContentEditable === true) return true;
  const tag = node.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return TEXT_INPUT_TYPES.has(String(node.type ?? '').toLowerCase());
  return false;
}

/** Does this card hold a text field anywhere inside it? While it is open, no key is ours. */
export function hasTextField(root: unknown): boolean {
  const node = root as NodeLike | null;
  if (!node) return false;
  if (isTextEntry(node)) return true;
  const children = node.children;
  if (!children) return false;
  for (let i = 0; i < children.length; i += 1) {
    if (hasTextField(children[i])) return true;
  }
  return false;
}

/** The keyboard lines the Help section shows, for a palette of this many groups. */
export function keyHelpLines(groupCount: number): string[] {
  return [
    `Tools: 1 to ${Math.min(9, groupCount)} pick a palette group and its first tool, then the letter on a tile picks that tool. Hover a tile to see its keys.`,
    'Speed: comma slows down one step and period speeds up one step (pause, 1x, 2x, 4x). Space pauses and resumes.',
    'Escape drops the current tool.',
  ];
}
