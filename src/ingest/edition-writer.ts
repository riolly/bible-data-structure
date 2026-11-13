/**
 * Writes one edition into the corpus DB in one transaction: its translation
 * row, each checked book's rows, its readings (ADR-0007) and original words
 * (plan step 11), then its words stamp and text stamp (ADR-0005 amendments).
 * The stamps hash the books in the order the edition lists them, so the
 * writer takes them in that order only, each once.
 *
 * Integer ids are storage-only and regenerated every ingest; block rows are
 * inserted first and their rowids mapped by the block's local ordinal.
 * Outside references use addresses, never these ids.
 */

import type Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';

import * as schema from '../db/corpus-schema';
import type { Block, ChapterDoc, OriginalWord, Token, VerseText } from '../model/corpus';
import { PIVOT } from '../model/mapping';
import { chapterStamp, textStamp, wordsStamp } from './edition';
import { checkReadings, type OshbReading } from './oshb-xml';
import type { CorpusDb } from './write-db';

export interface TranslationMeta {
  name: string;
  abbrev: string;
  language: string;
  year: number | null;
  license: string | null;
  /** Registry scheme id (ADR-0002), e.g. `kjv`. */
  scheme: string;
  edition: string;
}

/** One checked book's chapter documents and the rows derived from them (`checkBook`). */
export interface BookRows {
  readonly docs: readonly ChapterDoc[];
  readonly verses: readonly VerseText[];
  readonly blocks: readonly Block[];
  readonly tokens: readonly Token[];
}

export interface EditionWriter {
  /**
   * Write the edition's next book, then its OSHB readings once they are
   * checked against its tokens (`checkReadings`).
   */
  addBook(book: string, rows: BookRows, readings?: readonly OshbReading[]): void;
  /** Write the original words of the book added last, with `source` naming whose ids they are. */
  addOriginalWords(book: string, source: string, words: readonly OriginalWord[]): void;
}

/**
 * Write the edition `meta` with the books `books`, in that order: `write`
 * adds them, and may await between books. When it returns, the stamps are set
 * and the transaction commits. When it or an add throws, the edition rolls
 * back, its translation row included. Returns the stamps.
 */
export async function writeEdition(
  db: CorpusDb,
  meta: TranslationMeta,
  books: readonly string[],
  write: (edition: EditionWriter) => Promise<void>,
): Promise<{ words: string; text: string }> {
  const sqlite = db.$client;
  let finished = false;
  const stillOpen = (what: string) => {
    if (finished) throw new Error(`${meta.abbrev}: ${what} after the edition was written`);
  };
  sqlite.exec('BEGIN');
  try {
    const translationId = insertTranslation(db, meta);
    const insert = statements(sqlite);
    const words = wordsStamp();
    const text = textStamp();
    let added = 0;
    await write({
      addBook(book, rows, readings = []) {
        stillOpen(`${book} added`);
        if (books[added] !== book) {
          throw new Error(`${meta.abbrev}: ${book} added where the edition lists ${books[added] ?? 'no more books'}`);
        }
        added++;
        text.add(book, insertBookRows(insert, translationId, book, rows));
        checkReadings(book, readings, rows.tokens);
        for (const r of readings) {
          insert.reading.run(translationId, r.book, r.chapter, r.verse, r.segment ?? '', r.wordIndex, r.wordCount, r.kind,
            r.text, r.owIds.join(' '), 'oshb');
        }
        words.add(book, rows.tokens, rows.verses);
      },
      addOriginalWords(book, source, ow) {
        stillOpen(`${book}'s original words added`);
        if (book !== books[added - 1]) throw new Error(`${meta.abbrev}: original words of ${book} added, not of the book added last`);
        for (const w of ow) {
          insert.originalWord.run(source, w.owId, translationId, w.book, w.chapter, w.verse, w.segment, w.seq, w.wordIndex,
            w.kind, w.text, w.lemma, w.strongs.join(' '), w.morph, w.gloss);
        }
      },
    });
    if (added < books.length) throw new Error(`${meta.abbrev}: finished without ${books.slice(added).join(', ')}`);
    const stamps = { words: words.digest(), text: text.digest() };
    db.update(schema.translation)
      .set({ wordsStamp: stamps.words, textStamp: stamps.text })
      .where(eq(schema.translation.id, translationId))
      .run();
    sqlite.exec('COMMIT');
    return stamps;
  } catch (e) {
    if (sqlite.inTransaction) sqlite.exec('ROLLBACK');
    throw e;
  } finally {
    finished = true;
  }
}

function insertTranslation(db: CorpusDb, meta: TranslationMeta): number {
  if (meta.scheme === PIVOT) throw new Error(`${meta.abbrev}: an edition cannot use the pivot scheme (ADR-0006)`);
  const [row] = db
    .insert(schema.translation)
    .values(meta)
    .returning({ id: schema.translation.id })
    .all();
  return row.id;
}

/** Tokens per multi-row INSERT: one call into SQLite per row was most of the insert time. */
const TOKENS_PER_INSERT = 100;
const TOKEN_INSERT = `INSERT INTO token (translation_id, book, chapter, verse, segment, word_index, seq, kind, text,
  block_id, verse_start, ow_id) VALUES `;
const TOKEN_VALUES = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

/**
 * Prepared once per edition: drizzle's insert builder took about 6 s for a
 * 51k-token book. They follow the column order of src/db/corpus-schema.ts,
 * and roundtrip.test.ts reads the rows back through that schema.
 */
function statements(sqlite: Database.Database) {
  return {
    doc: sqlite.prepare('INSERT INTO chapter_doc (translation_id, book, chapter, usj, stamp) VALUES (?, ?, ?, ?, ?)'),
    verse: sqlite.prepare(
      'INSERT INTO verse_text (translation_id, book, chapter, verse, last_verse, segment, text) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ),
    block: sqlite.prepare('INSERT INTO block (translation_id, book, chapter, genre, marker, seq) VALUES (?, ?, ?, ?, ?, ?)'),
    token: sqlite.prepare(TOKEN_INSERT + TOKEN_VALUES),
    tokens: sqlite.prepare(TOKEN_INSERT + Array(TOKENS_PER_INSERT).fill(TOKEN_VALUES).join(', ')),
    reading: sqlite.prepare(
      `INSERT INTO reading (translation_id, book, chapter, verse, segment, word_index, word_count, kind, text, ow_ids, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    originalWord: sqlite.prepare(
      `INSERT INTO original_word (source, ow_id, translation_id, book, chapter, verse, segment, seq, word_index, kind,
         text, lemma, strongs, morph, gloss) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
  };
}

/** Insert one book's chapter documents and the rows derived from them. Returns each chapter's stamp, in order. */
function insertBookRows(
  insert: ReturnType<typeof statements>,
  translationId: number,
  book: string,
  rows: BookRows,
): { chapter: number; stamp: string }[] {
  const stamps = rows.docs.map((d) => {
    const usj = JSON.stringify(d.content);
    const stamp = chapterStamp(usj, rows.verses.filter((v) => v.chapter === d.chapter));
    insert.doc.run(translationId, book, d.chapter, usj, stamp);
    return { chapter: d.chapter, stamp };
  });
  for (const v of rows.verses) insert.verse.run(translationId, book, v.chapter, v.verse, v.lastVerse, v.segment, v.text);
  const blockRowId = new Map<number, number>();
  for (const b of rows.blocks) {
    const { lastInsertRowid } = insert.block.run(translationId, book, b.chapter, b.genre, b.marker, b.seq);
    blockRowId.set(b.id, Number(lastInsertRowid));
  }
  const values = (t: Token) => {
    const blockId = blockRowId.get(t.blockId);
    if (blockId == null) throw new Error(`token ${t.id} references unknown block ${t.blockId}`);
    return [translationId, book, t.chapter, t.verse, t.segment, t.wordIndex, t.seq, t.kind, t.text, blockId,
      t.verseStart ? 1 : 0, t.owId];
  };
  // Rows go in token order either way, so the rowids match one insert per row.
  let i = 0;
  for (; i + TOKENS_PER_INSERT <= rows.tokens.length; i += TOKENS_PER_INSERT) {
    insert.tokens.run(rows.tokens.slice(i, i + TOKENS_PER_INSERT).flatMap(values));
  }
  for (; i < rows.tokens.length; i++) insert.token.run(values(rows.tokens[i]));
  return stamps;
}
