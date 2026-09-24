export const TEMPO = 76;
export const BAR_SECONDS = 240 / TEMPO;
export const ASCENT = [261.63, 329.63, 392, 440, 523.25];
export const LIVES_INSIDE = [392, 349.23, 329.63, 261.63];
export type Chapter = 1 | 3 | 6;
export function chapterFor(stars: number): Chapter { return stars >= 6 ? 6 : stars >= 3 ? 3 : 1; }
export function isNight(minute: number): boolean { const m = ((minute % 1440) + 1440) % 1440; return m >= 1380 || m < 360; }
export type Voice = 'piano' | 'bass' | 'hat' | 'pulse' | 'brass' | 'pad' | 'lead' | 'counter';
export const CHAPTER_VOICES: Readonly<Record<Chapter, readonly Voice[]>> = { 1: ['piano', 'bass', 'hat'], 3: ['piano', 'bass', 'hat', 'pulse', 'brass'], 6: ['pad', 'bass', 'lead', 'counter', 'hat'] };
