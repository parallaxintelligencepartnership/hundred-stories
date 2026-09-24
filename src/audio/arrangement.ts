/** Four eight-bar sections: introduce, answer, lift, then leave room for the tower. */
export type Section = 'introduce' | 'answer' | 'lift' | 'breathe';
export function sectionFor(phraseIndex: number): Section {
  return (['introduce', 'answer', 'lift', 'breathe'] as const)[((phraseIndex % 4) + 4) % 4]!;
}
/** A shared rhythm for the early score's bass, keys and kick (straight beats; swing at playback). */
export function foundationFigure(phraseIndex: number, bar: number): readonly (readonly [number, number, number])[] {
  const section = sectionFor(phraseIndex);
  if (section === 'breathe') return [[0, 3.5, 0.7]];
  if (section === 'introduce') return bar % 2 === 0 ? [[0, 3, 0.85]] : [[0, 1.75, 0.8], [2.5, 1, 0.55]];
  if (section === 'answer') return bar % 2 === 0 ? [[0, 2.5, 0.9]] : [[0.5, 1.5, 0.75], [2.5, 1, 0.65]];
  return bar % 4 === 3 ? [[0, 3, 0.85]] : [[0, 1.5, 0.95], [2.5, 1, 0.7]];
}
