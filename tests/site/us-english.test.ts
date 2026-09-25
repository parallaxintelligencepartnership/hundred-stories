// Every word a player reads is US English, and the word "seed" never reaches them. The scan
// reads the string literals in the game's sources (comments and identifiers are not player
// text, so `colour` in a variable name is fine) and the visible text of the site pages.
import notfound from '../../404.html?raw';
import guide from '../../how-to-play/index.html?raw';
import landing from '../../index.html?raw';
import play from '../../play/index.html?raw';
import privacy from '../../privacy/index.html?raw';
import { describe, expect, it } from 'vitest';
import { controlLines } from '../../src/ui/controls';
import { speedModeText } from '../../src/ui/status';
import { hintText } from '../../src/ui/ui';

const SOURCES: Record<string, string> = {
  ...import.meta.glob<string>('../../src/ui/*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob<string>('../../src/game/*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob<string>('../../src/sim/*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob<string>('../../src/share/*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob<string>('../../src/site/*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob<string>('../../src/main.ts', { query: '?raw', import: 'default', eager: true }),
};

const UI_SOURCES = Object.fromEntries(Object.entries(SOURCES).filter(([path]) => path.includes('/src/ui/')));

const PAGES: Record<string, string> = {
  'index.html': landing,
  'how-to-play/index.html': guide,
  'play/index.html': play,
  'privacy/index.html': privacy,
  '404.html': notfound,
};

/** UK spellings and words, matched at the start of a word, any case. */
const UK = [
  'colour', 'neighbour', 'favour', 'honour', 'behaviour', 'labour', 'flavour', 'harbour', 'rumour',
  'licence', 'centre', 'metre', 'litre', 'theatre', 'fibre', 'grey',
  'organis', 'realis', 'recognis', 'apologis', 'customis', 'minimis', 'maximis', 'optimis',
  'prioritis', 'summaris', 'visualis', 'authoris', 'finalis', 'emphasis(?:e|ed|es|ing)\\b',
  'travell', 'cancell', 'modell', 'levell', 'fuelled', 'signalled', 'counsell',
  'catalogue', 'programme', 'storey', 'defence', 'offence', 'practise', 'analyse',
  'whilst', 'amongst', 'learnt', 'spelt', 'dreamt', 'aluminium', 'jewellery', 'pyjama', 'cheque',
  'tyre', 'kerb', 'pavement', 'rubbish', 'car park', 'fortnight', 'maths\\b', 'mum\\b',
  'lift\\b', 'lifts\\b(?! the)', 'flat\\b(?! rate)', 'queue', 'post code', 'autumn',
];
const UK_RE = new RegExp(`\\b(?:${UK.join('|')})`, 'i');
const SEED_RE = /\bseeds?\b/i;

/** The string literals in a TypeScript source, with template `${...}` holes blanked out. */
function literals(src: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  while (i < n) {
    const c = src[i] as string;
    if (c === '\n') { line += 1; i += 1; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line += 1; i += 1; }
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const start = line;
      let text = '';
      i += 1;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') { text += src[i + 1] ?? ''; i += 2; continue; }
        if (c === '`' && src[i] === '$' && src[i + 1] === '{') {
          // Skip the hole, braces balanced; nested strings inside are code, not text.
          let depth = 1;
          i += 2;
          while (i < n && depth > 0) {
            if (src[i] === '{') depth += 1;
            else if (src[i] === '}') depth -= 1;
            else if (src[i] === '\n') line += 1;
            i += 1;
          }
          text += ' ';
          continue;
        }
        if (src[i] === '\n') line += 1;
        text += src[i];
        i += 1;
      }
      i += 1;
      out.push({ line: start, text });
      continue;
    }
    i += 1;
  }
  return out;
}

/** Is this literal something a player could read, rather than a key or a class name? */
function isProse(text: string): boolean {
  return /\s/.test(text.trim()) || /^[A-Z][a-z]/.test(text);
}

/** The words a browser shows or reads aloud: text between tags, plus alt, title and aria-label. */
function visibleText(html: string): string {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const attrs = [...body.matchAll(/\b(?:alt|title|aria-label|content)="([^"]*)"/g)].map((m) => m[1]);
  const text = body.replace(/<[^>]+>/g, ' ');
  return `${text} ${attrs.join(' ')}`.replace(/\s+/g, ' ');
}

function ukHits(sources: Record<string, string>): string[] {
  const hits: string[] = [];
  for (const [path, src] of Object.entries(sources)) {
    for (const { line, text } of literals(src)) {
      const m = UK_RE.exec(text);
      if (m && isProse(text)) hits.push(`${path}:${line}: ${m[0]} in "${text.slice(0, 80)}"`);
    }
  }
  return hits;
}

describe('US English for players', () => {
  it('finds a UK spelling when one is there, so a clean scan means something', () => {
    expect(ukHits({ 'probe.ts': "const a = 'Pick a colour for the centre.';" })).toHaveLength(1);
    expect(ukHits({ 'probe.ts': 'const colour = 1; // colour' })).toEqual([]);
    expect(ukHits({ 'probe.ts': 'const t = `Built ${colour} rooms.`;' })).toEqual([]);
    expect(UK_RE.test(visibleText('<h2>Licence</h2>'))).toBe(true);
    expect(UK_RE.test(visibleText('<section aria-labelledby="x">Hi</section>'))).toBe(false);
  });

  it('has no UK spelling in any string a player can see in the game', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(40);
    expect(ukHits(SOURCES)).toEqual([]);
  });

  it('has no UK spelling on the site pages', () => {
    for (const [path, html] of Object.entries(PAGES)) {
      const m = UK_RE.exec(visibleText(html));
      expect(m ? `${path}: ${m[0]}` : null).toBeNull();
    }
  });
});

describe('never the word seed', () => {
  it('finds it in a player-facing string when it is there', () => {
    const hits = literals("el('label', 'hs-row-label', 'Seed'); notice('Enter a whole number for the seed.');")
      .filter(({ text }) => SEED_RE.test(text) && isProse(text));
    expect(hits.map((h) => h.text)).toEqual(['Seed', 'Enter a whole number for the seed.']);
  });

  it('is not in any string the game UI shows', () => {
    const hits: string[] = [];
    for (const [path, src] of Object.entries(UI_SOURCES)) {
      for (const { line, text } of literals(src)) {
        if (SEED_RE.test(text) && isProse(text)) hits.push(`${path}:${line}: "${text.slice(0, 80)}"`);
      }
    }
    expect(Object.keys(UI_SOURCES).length).toBeGreaterThan(10);
    expect(hits).toEqual([]);
  });

  it('is not on any site page', () => {
    for (const [path, html] of Object.entries(PAGES)) {
      const m = SEED_RE.exec(visibleText(html));
      expect(m ? `${path}: ${m[0]}` : null).toBeNull();
    }
  });
});

// Plain words (audit 2026-09-25, E1 S7): a reader of about ten. "Haptics", "shaft" and
// "x16 in all" are not words that reader knows, and the touch help names the Build step that
// confirms a parked outline (decision 2026-09-19, two step touch placement).
describe('plain words', () => {
  const NOT_PLAIN = /\bhaptics\b|\bshafts?\b|\bin all\b/i;
  const NAMED = ['panels.ts', 'status.ts', 'onboarding.ts', 'controls.ts', 'ui.ts', 'explain.ts'];

  it('finds a word that is not plain when it is there', () => {
    const hits = literals("switchRow('x', 'Haptics'); button('Whole shaft'); `Night x8, x${n} in all`;").filter(
      ({ text }) => NOT_PLAIN.test(text) && isProse(text),
    );
    expect(hits).toHaveLength(3);
  });

  it('are the only words in the settings, the elevator panel, the night chip, the tips and the help', () => {
    const hits: string[] = [];
    const files = Object.entries(UI_SOURCES).filter(([path]) => NAMED.some((name) => path.endsWith(`/src/ui/${name}`)));
    expect(files).toHaveLength(NAMED.length);
    for (const [path, src] of files) {
      for (const { line, text } of literals(src)) {
        if (NOT_PLAIN.test(text) && isProse(text)) hits.push(`${path}:${line}: "${text.slice(0, 80)}"`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('says the night speed in plain words', () => {
    expect(speedModeText(2, 23 * 60 + 30)).toBe('Night: 16 times as fast');
  });

  it('names the Build step in the touch help and the touch hint', () => {
    const build = controlLines('touch').find((line) => line.icon === 'build');
    expect(build?.text).toMatch(/then tap Build\b/);
    expect(hintText(true)).toMatch(/\bBuild\b/);
  });

  it('names the Build step wherever a site page says tap to place', () => {
    for (const path of ['index.html', 'how-to-play/index.html']) {
      const text = visibleText(PAGES[path] as string);
      expect(text, path).toMatch(/tap to place/);
      expect(text.match(/tap to place[^.]*/g)?.every((said) => /then tap Build\b/.test(said)), path).toBe(true);
    }
  });
});
