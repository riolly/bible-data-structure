import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { chapterStamp, textStamp, wordsStamp } from './edition';
import type { EditionWriter } from './edition-writer';
import { sqliteLoads } from './native-probe';
import { normalizeUsj, type UsjDoc } from './normalize';

/**
 * The edition writer (edition-writer.ts) on in-memory SQLite, with the two
 * committed fixtures as books: PSA (chapter-doc) and JHN (adversarial), in
 * that order. Skipped where better-sqlite3 is unbuilt, as roundtrip.test.ts.
 */
const native = sqliteLoads();

const rowsOf = (name: string) =>
  normalizeUsj(JSON.parse(readFileSync(join(__dirname, 'fixtures', `${name}.usj.json`), 'utf8')) as UsjDoc);
const PSA = rowsOf('chapter-doc');
const JHN = rowsOf('adversarial');
const TABLES = ['translation', 'chapter_doc', 'verse_text', 'block', 'token', 'reading', 'original_word'];

const meta = (abbrev: string) => ({
  name: abbrev, abbrev, language: 'english', year: null, license: null, scheme: 'fix', edition: 'sha256:0',
});

async function corpus() {
  const { createCorpusDb, seedBooksAndCanons, seedSchemes } = await import('./write-db');
  const { writeEdition } = await import('./edition-writer');
  const { db, sqlite } = createCorpusDb(':memory:');
  seedBooksAndCanons(db);
  const fix = { id: 'fix', name: 'Fixture', sourceUrl: '', note: '', verseCounts: new Map(), excluded: new Set<string>(), segments: new Map(), titles: new Set<string>() };
  seedSchemes(db, new Map([['fix', fix]]));
  const counts = () => TABLES.map((t) => (sqlite.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n);
  return { db, sqlite, writeEdition, counts };
}

describe.skipIf(!native)('writeEdition', () => {
  it('stores stamps that the rows read back give again', async () => {
    const { db, sqlite, writeEdition } = await corpus();
    const stamps = await writeEdition(db, meta('FIX'), ['PSA', 'JHN'], async (edition) => {
      edition.addBook('PSA', PSA);
      await Promise.resolve(); // books arrive asynchronously in the ingest
      edition.addBook('JHN', JHN);
    });
    const { id, words_stamp, text_stamp } = sqlite.prepare(`SELECT id, words_stamp, text_stamp FROM translation WHERE abbrev = 'FIX'`).get() as {
      id: number; words_stamp: string; text_stamp: string;
    };
    expect({ words: words_stamp, text: text_stamp }).toEqual(stamps);

    const words = wordsStamp();
    const text = textStamp();
    const all = (sql: string, ...args: unknown[]) => sqlite.prepare(sql).all(id, ...args) as never[];
    for (const book of ['PSA', 'JHN']) {
      const units = all(`SELECT chapter, verse, last_verse AS lastVerse, segment, text FROM verse_text WHERE translation_id = ? AND book = ?
        ORDER BY chapter, verse, segment`, book) as { chapter: number; verse: number; lastVerse: number; segment: string; text: string }[];
      words.add(book, all(`SELECT chapter, verse, segment, word_index AS wordIndex, text FROM token WHERE translation_id = ? AND book = ?
        ORDER BY id`, book), units);
      const docs = all('SELECT chapter, usj FROM chapter_doc WHERE translation_id = ? AND book = ? ORDER BY chapter', book) as {
        chapter: number; usj: string;
      }[];
      text.add(book, docs.map((d) => ({ chapter: d.chapter, stamp: chapterStamp(d.usj, units.filter((u) => u.chapter === d.chapter)) })));
    }
    expect({ words: words.digest(), text: text.digest() }).toEqual(stamps);
    sqlite.close();
  });

  it('rolls back an edition when a book throws, leaving the editions written before', async () => {
    const { db, sqlite, writeEdition, counts } = await corpus();
    await writeEdition(db, meta('A'), ['JHN'], async (edition) => edition.addBook('JHN', JHN));
    const before = counts();
    // a reading whose ketiv is not the word at its index fails checkReadings
    const verseWords = JHN.tokens.filter((t) => t.chapter === 1 && t.verse === 1 && t.wordIndex !== null).map((t) => t.text);
    const reading = {
      book: 'JHN', chapter: 1, verse: 1, segment: '', kind: 'qere' as const, wordIndex: 0, wordCount: 1, text: 'x', owIds: [],
      qere: [], ketiv: ['nothing'], verseWords,
    };
    await expect(
      writeEdition(db, meta('B'), ['PSA', 'JHN'], async (edition) => {
        edition.addBook('PSA', PSA);
        edition.addBook('JHN', JHN, [reading]);
      }),
    ).rejects.toThrow(/^JHN 1:1!1: reading "x"/);
    expect(counts()).toEqual(before);
    expect(sqlite.inTransaction).toBe(false);
    sqlite.close();
  });

  it('takes the listed books in order, and nothing after it finishes', async () => {
    const { db, sqlite, writeEdition, counts } = await corpus();
    const write = (books: string[], add: (e: EditionWriter) => void) =>
      writeEdition(db, meta('X'), books, async (edition) => add(edition));
    await expect(write(['PSA', 'JHN'], (e) => e.addBook('JHN', JHN))).rejects.toThrow('X: JHN added where the edition lists PSA');
    await expect(write(['PSA', 'JHN'], (e) => e.addBook('PSA', PSA))).rejects.toThrow('X: finished without JHN');
    await expect(write(['PSA'], (e) => e.addOriginalWords('PSA', 'oshb', []))).rejects.toThrow(/not of the book added last/);
    expect(counts()).toEqual([0, 0, 0, 0, 0, 0, 0]);

    let kept: EditionWriter | undefined;
    await write(['PSA'], (e) => {
      kept = e;
      e.addBook('PSA', PSA);
    });
    const after = counts();
    expect(() => kept!.addBook('JHN', JHN)).toThrow('X: JHN added after the edition was written');
    expect(() => kept!.addOriginalWords('PSA', 'oshb', [])).toThrow(/after the edition was written/);
    expect(counts()).toEqual(after);
    sqlite.close();
  });
});
