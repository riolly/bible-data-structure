import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { Scheme } from '../model/scheme';
import { checkBook, checkVerseWords, validate, type BookCheck } from './book-check';
import { normalizeChapters, normalizeUsj, type NormalizeResult, type UsjDoc } from './normalize';
import type { ParseOutcome } from './parse';

// checkBook's normalizeChapters is the real one unless a test below changes what it returns once.
vi.mock('./normalize', async (importOriginal) => {
  const real = await importOriginal<typeof import('./normalize')>();
  return { ...real, normalizeChapters: vi.fn(real.normalizeChapters) };
});

/**
 * The checks the ingest runs on each book (book-check.ts), on the committed
 * fixtures. Each scheme here is made to fit its fixture, so a case that
 * changes one count or one node fails or warns for one reason.
 */
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', `${name}.usj.json`), 'utf8')) as UsjDoc;
const adversarial = fixture('adversarial');
const chapterDoc = fixture('chapter-doc');

const scheme = (book: string, counts: number[], more: { excluded?: string[]; titles?: string[] } = {}): Scheme => ({
  id: 'fix',
  name: 'Fixture',
  sourceUrl: '',
  note: '',
  verseCounts: new Map([[book, counts]]),
  excluded: new Set(more.excluded),
  segments: new Map(),
  titles: new Set(more.titles),
});
const parsed = (usj: UsjDoc, more: Partial<ParseOutcome> = {}): ParseOutcome => ({
  usj,
  parseErrors: [],
  versifiedTitleRewrites: 0,
  ...more,
});
const errorOf = (r: BookCheck) => {
  if (r.ok) throw new Error('the book passed');
  return (r.error as Error).message;
};
/** The adversarial fixture as JHN: chapter 1 ends with the bridge 5-6, chapter 2 at verse 3. */
const jhn = scheme('JHN', [6, 3]);

describe('checkBook on the fixtures', () => {
  it('passes the adversarial fixture with no warnings, and returns the normalized rows', () => {
    const r = checkBook('JHN', parsed(adversarial), jhn, { wordTags: false });
    expect(r).toMatchObject({ ok: true, warnings: [] });
    const rows = normalizeUsj(adversarial);
    if (!r.ok) throw r.error;
    expect(r.rows.tokens).toEqual(rows.tokens);
    expect(r.rows.verses).toEqual(rows.verses);
    expect(r.rows.docs).toEqual(rows.docs);
  });

  it('passes the chapter-doc fixture, warning in the order the checks run', () => {
    // 1:3 holds only a footnote and the scheme lacks it; 1:4 is skipped; chapter 2 stops a verse early
    const psa = scheme('PSA', [5, 4], { excluded: ['PSA 1:3'], titles: ['PSA 2'] });
    const r = checkBook('PSA', parsed(chapterDoc), psa, { wordTags: false });
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([
      { check: 'dropped-verse', text: 'PSA 1:3: printed with no words and not in scheme fix, no verse text' },
      { check: 'verse-gap', text: 'PSA 1: no tokens for verse(s) 3, 4' },
      { check: 'short-chapter', text: 'PSA 2: ends at verse 3, scheme fix has 4' },
    ]);
    if (!r.ok) throw r.error;
    // the scheme numbers the chapter 2 title, so its words are verse 0
    expect(r.rows.tokens.filter((t) => t.chapter === 2 && t.verse === 0).map((t) => t.text)).toEqual([
      'A', 'song', 'for', 'the', 'fixture', '.',
    ]);
  });
});

describe('checkBook stops or warns for the right reason', () => {
  it('reports the parse outcome first', () => {
    const r = checkBook('JHN', parsed(adversarial, { parseErrors: ['bad \\x', 'bad \\f'], versifiedTitleRewrites: 2 }), jhn, {
      wordTags: false,
    });
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([
      { check: 'parse', text: 'JHN: 2 versified \\d title(s) rewritten to \\qd (grammar gap, see parse.ts)' },
      { check: 'parse', text: 'JHN: usfm-grammar strict parse failed, ingested with ignoreErrors —\n      bad \\x\n      bad \\f' },
    ]);
  });

  it('stops when the USJ names another book, keeping the warnings found before', () => {
    const r = checkBook('GEN', parsed(adversarial, { versifiedTitleRewrites: 1 }), jhn, { wordTags: false });
    expect(errorOf(r)).toBe('GEN: USJ book code mismatch ("JHN")');
    expect(r.warnings.map((w) => w.check)).toEqual(['parse']);
  });

  it('names the book when normalizing fails', () => {
    const usj = structuredClone(adversarial);
    usj.content.push({ type: 'para', marker: 'zz', content: ['x'] });
    expect(errorOf(checkBook('JHN', parsed(usj), jhn, { wordTags: false }))).toMatch(/^JHN: unsupported/);
  });

  it('stops on a verse the scheme lacks, each number of a bridge included', () => {
    expect(errorOf(checkBook('JHN', parsed(adversarial), scheme('JHN', [5, 3]), { wordTags: false }))).toBe(
      'JHN: verses not in scheme fix: 1:6',
    );
    const excluded = scheme('JHN', [6, 3], { excluded: ['JHN 2:2'] });
    expect(errorOf(checkBook('JHN', parsed(adversarial), excluded, { wordTags: false }))).toBe('JHN: verses not in scheme fix: 2:2');
  });

  it('warns on a verse with no tokens', () => {
    const usj = structuredClone(adversarial);
    // drop `\v 4` and its paragraph from chapter 1
    const at = usj.content.findIndex((n) => typeof n !== 'string' && n.content?.some((c) => typeof c !== 'string' && c.number === '4'));
    usj.content.splice(at, 1);
    const r = checkBook('JHN', parsed(usj), jhn, { wordTags: false });
    expect(r.warnings).toEqual([{ check: 'verse-gap', text: 'JHN 1: no tokens for verse(s) 4' }]);
  });
});

describe('the row checks no USJ input reaches', () => {
  const { blocks, tokens, verses } = normalizeUsj(adversarial);
  const word = tokens.findIndex((t) => t.kind === 'word' && t.verse !== null);
  const punct = tokens.findIndex((t) => t.kind === 'punct');
  const withToken = (i: number, change: object) => tokens.map((t, j) => (j === i ? { ...t, ...change } : t));

  it('validate: the corpus invariants', () => {
    expect(() => validate('JHN', blocks, tokens)).not.toThrow();
    expect(() => validate('JHN', blocks, withToken(word, { blockId: blocks.length }))).toThrow(/unknown block/);
    expect(() => validate('JHN', blocks, withToken(word, { text: 'a b' }))).toThrow(/whitespace leaked/);
    expect(() => validate('JHN', blocks, withToken(word, { verse: 0 }))).toThrow(/verse 0 outside a psalm title/);
    expect(() => validate('JHN', blocks, withToken(word, { verse: null }))).toThrow(/non-verse token carries a word_index/);
    expect(() => validate('JHN', blocks, withToken(punct, { wordIndex: 0 }))).toThrow(/punct token carries a word_index/);
    expect(() => validate('JHN', [...blocks, { ...blocks[0], id: blocks.length }], tokens)).toThrow(/1 empty block/);
  });

  it('checkVerseWords: a verse text whose words are not its word tokens', () => {
    expect(() => checkVerseWords('JHN', tokens, verses)).not.toThrow();
    const changed = verses.map((v, i) => (i === 0 ? { ...v, text: `${v.text} more` } : v));
    expect(() => checkVerseWords('JHN', tokens, changed)).toThrow(/^JHN 1:1: the verse text's words differ from its word tokens/);
  });
});

describe('checkBook runs the row checks on the rows normalize returns', () => {
  /** Run checkBook on the adversarial fixture with its normalized rows changed. */
  const withRows = async (change: (rows: NormalizeResult) => void) => {
    const real = await vi.importActual<typeof import('./normalize')>('./normalize');
    vi.mocked(normalizeChapters).mockImplementationOnce((docs, opts) => {
      const rows = real.normalizeChapters(docs, opts);
      change(rows);
      return rows;
    });
    return checkBook('JHN', parsed(adversarial), jhn, { wordTags: false });
  };

  it('stops on rows that break a corpus invariant', async () => {
    const r = await withRows((rows) => {
      const i = rows.tokens.findIndex((t) => t.kind === 'word' && t.verse !== null);
      rows.tokens[i] = { ...rows.tokens[i], text: 'a b' };
    });
    expect(errorOf(r)).toMatch(/whitespace leaked/);
  });

  it('stops on a verse text whose words are not its word tokens', async () => {
    const r = await withRows((rows) => {
      rows.verses[0] = { ...rows.verses[0], text: `${rows.verses[0].text} more` };
    });
    expect(errorOf(r)).toMatch(/^JHN 1:1: the verse text's words differ from its word tokens/);
  });
});

describe('checkBook with wordTags', () => {
  const w = (text: string, strong: string) => ({ type: 'char', marker: 'w', strong, content: [text] });
  const gen: UsjDoc = {
    type: 'USJ',
    version: '3.1',
    content: [
      { type: 'book', marker: 'id', code: 'GEN', content: [] },
      { type: 'chapter', marker: 'c', number: '1' },
      { type: 'para', marker: 'p', content: [{ type: 'verse', marker: 'v', number: '1' }, 'In the ', w('beginning', 'H7225'), '.'] },
    ],
  };
  const tagsWith = (wordTags: boolean) => {
    const r = checkBook('GEN', parsed(gen), scheme('GEN', [1]), { wordTags });
    if (!r.ok) throw r.error;
    return r.rows.wordTags.map((t) => [t.wordIndexes, t.strongs]);
  };

  it('collects the `\\w strong=` tags only when the source asks for them', () => {
    expect(tagsWith(true)).toEqual([[[2], ['H7225']]]);
    expect(tagsWith(false)).toEqual([]);
  });
});
