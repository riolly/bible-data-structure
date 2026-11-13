/**
 * Corpus DB writer — the build-time side of the old-repo ADR-0009 Drizzle seam. Writes
 * through drizzle-orm/better-sqlite3 using the SAME schema module
 * (src/db/corpus-schema.ts) the app reads through drizzle-orm/expo-sqlite.
 *
 * Integer ids are storage-only and regenerated every ingest; block rows are
 * inserted first and their rowids mapped by the block's local ordinal.
 * Outside references use addresses, never these ids.
 */

import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { BOOKS, ENGLISH_NAMES, USFM_SPEC_URL } from '../model/books';
import { CANONS } from '../model/canon';
import type { Block, ChapterDoc, OriginalWord, Reading, Token, VerseText } from '../model/corpus';
import { PIVOT, type MappingRow } from '../model/mapping';
import { chapterStamp } from './edition';
import { LIBPALASO_URL } from './schemes';
import { CLEAR_BSB, MACULA_GREEK, MACULA_HEBREW, OSHB, TVTMS } from './sources';
import type { WordAlignment } from './alignment';
import { WORD_TEST_MARGIN } from './tvtms';
import type { Scheme } from '../model/scheme';
import * as schema from '../db/corpus-schema';

export type CorpusDb = BetterSQLite3Database<typeof schema>;

/** DDL mirroring src/db/corpus-schema.ts (and schema.dbml). */
const DDL = `
CREATE TABLE data_source (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  sha256 TEXT,
  license TEXT NOT NULL,
  attribution TEXT NOT NULL,
  changes TEXT NOT NULL
);
CREATE TABLE scheme (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  note TEXT NOT NULL
);
CREATE TABLE scheme_verse_count (
  scheme TEXT NOT NULL REFERENCES scheme(id),
  book TEXT NOT NULL REFERENCES book(code),
  chapter INTEGER NOT NULL,
  verse_count INTEGER NOT NULL,
  PRIMARY KEY (scheme, book, chapter)
);
CREATE TABLE scheme_excluded_verse (
  scheme TEXT NOT NULL REFERENCES scheme(id),
  book TEXT NOT NULL REFERENCES book(code),
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  PRIMARY KEY (scheme, book, chapter, verse)
);
CREATE TABLE translation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  abbrev TEXT NOT NULL UNIQUE,
  language TEXT NOT NULL,
  year INTEGER,
  license TEXT,
  scheme TEXT NOT NULL REFERENCES scheme(id),
  edition TEXT NOT NULL,
  words_stamp TEXT,
  text_stamp TEXT
);
CREATE TABLE book (
  code TEXT PRIMARY KEY,
  usfm_number TEXT NOT NULL
);
CREATE TABLE canon (
  id TEXT PRIMARY KEY,
  tradition TEXT NOT NULL,
  source_url TEXT NOT NULL,
  note TEXT NOT NULL
);
CREATE TABLE canon_section (
  canon_id TEXT NOT NULL REFERENCES canon(id),
  section_id TEXT NOT NULL,
  parent_section_id TEXT,
  ordinal INTEGER NOT NULL,
  label_key TEXT NOT NULL,
  PRIMARY KEY (canon_id, section_id)
);
CREATE TABLE canon_entry (
  canon_id TEXT NOT NULL REFERENCES canon(id),
  entry_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  status TEXT NOT NULL,
  label_key TEXT,
  PRIMARY KEY (canon_id, entry_id),
  FOREIGN KEY (canon_id, section_id) REFERENCES canon_section(canon_id, section_id)
);
CREATE TABLE canon_entry_book (
  canon_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  book_code TEXT NOT NULL REFERENCES book(code),
  PRIMARY KEY (canon_id, entry_id, ordinal),
  FOREIGN KEY (canon_id, entry_id) REFERENCES canon_entry(canon_id, entry_id)
);
CREATE TABLE book_name (
  book_code TEXT NOT NULL REFERENCES book(code),
  lang TEXT NOT NULL,
  canon_id TEXT REFERENCES canon(id),
  long TEXT NOT NULL,
  short TEXT NOT NULL,
  abbr TEXT,
  source TEXT NOT NULL REFERENCES data_source(id)
);
CREATE TABLE chapter_doc (
  translation_id INTEGER NOT NULL REFERENCES translation(id),
  book TEXT NOT NULL REFERENCES book(code),
  chapter INTEGER NOT NULL,
  usj TEXT NOT NULL,
  stamp TEXT NOT NULL,
  PRIMARY KEY (translation_id, book, chapter)
);
CREATE TABLE verse_text (
  translation_id INTEGER NOT NULL REFERENCES translation(id),
  book TEXT NOT NULL REFERENCES book(code),
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  last_verse INTEGER NOT NULL,
  segment TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  PRIMARY KEY (translation_id, book, chapter, verse, segment)
);
CREATE TABLE block (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  translation_id INTEGER NOT NULL REFERENCES translation(id),
  book TEXT NOT NULL REFERENCES book(code),
  chapter INTEGER NOT NULL,
  genre TEXT NOT NULL,
  marker TEXT NOT NULL,
  seq INTEGER NOT NULL
);
CREATE INDEX block_order ON block (translation_id, book, seq);
CREATE TABLE token (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  translation_id INTEGER NOT NULL REFERENCES translation(id),
  book TEXT NOT NULL REFERENCES book(code),
  chapter INTEGER NOT NULL,
  verse INTEGER,
  segment TEXT NOT NULL DEFAULT '',
  word_index INTEGER,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  block_id INTEGER NOT NULL REFERENCES block(id),
  verse_start INTEGER NOT NULL DEFAULT 0,
  ow_id TEXT
);
CREATE INDEX token_render ON token (translation_id, book, chapter, verse, seq);
CREATE UNIQUE INDEX token_anchor ON token (translation_id, book, chapter, verse, segment, word_index);
CREATE TABLE reading (
  translation_id INTEGER NOT NULL REFERENCES translation(id),
  book TEXT NOT NULL REFERENCES book(code),
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  segment TEXT NOT NULL DEFAULT '',
  word_index INTEGER NOT NULL,
  word_count INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  ow_ids TEXT NOT NULL,
  source TEXT NOT NULL REFERENCES data_source(id),
  PRIMARY KEY (translation_id, book, chapter, verse, segment, word_index, word_count)
);
CREATE TABLE original_word (
  source TEXT NOT NULL REFERENCES data_source(id),
  ow_id TEXT NOT NULL,
  translation_id INTEGER NOT NULL REFERENCES translation(id),
  book TEXT NOT NULL REFERENCES book(code),
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  segment TEXT NOT NULL DEFAULT '',
  seq INTEGER NOT NULL,
  word_index INTEGER,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  lemma TEXT NOT NULL,
  strongs TEXT NOT NULL,
  morph TEXT NOT NULL,
  gloss TEXT,
  PRIMARY KEY (source, ow_id)
);
CREATE UNIQUE INDEX original_word_verse ON original_word (translation_id, book, chapter, verse, segment, seq);
CREATE TABLE word_alignment (
  translation_id INTEGER NOT NULL REFERENCES translation(id),
  book TEXT NOT NULL REFERENCES book(code),
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  segment TEXT NOT NULL DEFAULT '',
  word_index INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  source TEXT NOT NULL REFERENCES data_source(id),
  ow_id TEXT NOT NULL,
  strongs TEXT NOT NULL,
  aligned_by TEXT NOT NULL REFERENCES data_source(id),
  PRIMARY KEY (translation_id, book, chapter, verse, segment, word_index, seq)
);
CREATE TABLE scheme_segment (
  scheme TEXT NOT NULL REFERENCES scheme(id),
  book TEXT NOT NULL REFERENCES book(code),
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  ordinal INTEGER NOT NULL,
  segment TEXT NOT NULL,
  PRIMARY KEY (scheme, book, chapter, verse, ordinal)
);
CREATE TABLE scheme_title (
  scheme TEXT NOT NULL REFERENCES scheme(id),
  book TEXT NOT NULL REFERENCES book(code),
  chapter INTEGER NOT NULL,
  PRIMARY KEY (scheme, book, chapter)
);
CREATE TABLE scheme_mapping (
  scheme TEXT NOT NULL REFERENCES scheme(id),
  book TEXT NOT NULL REFERENCES book(code),
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  segment TEXT NOT NULL,
  pivot_book TEXT REFERENCES book(code),
  pivot_chapter INTEGER,
  pivot_verse INTEGER,
  pivot_segment TEXT,
  kind TEXT NOT NULL,
  source TEXT NOT NULL REFERENCES data_source(id)
);
CREATE INDEX mapping_from ON scheme_mapping (scheme, book, chapter, verse);
CREATE INDEX mapping_to ON scheme_mapping (scheme, pivot_book, pivot_chapter, pivot_verse);
`;

const INDEX_DDL = DDL.match(/^CREATE (?:UNIQUE )?INDEX .*;$/gm)!.join('\n');
const TABLE_DDL = DDL.replace(/^CREATE (?:UNIQUE )?INDEX .*;\n/gm, '');
if (/\bINDEX\b/.test(TABLE_DDL)) throw new Error('write-db.ts: an index in DDL is not one line of `CREATE INDEX ...;`');

/**
 * `deferIndexes` leaves the indexes out until createIndexes runs. Sorting the
 * rows once after a bulk load is faster than updating the indexes on every
 * insert.
 */
export function createCorpusDb(
  path: string,
  { deferIndexes = false }: { deferIndexes?: boolean } = {},
): { db: CorpusDb; sqlite: Database.Database } {
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = OFF'); // build artifact — no crash safety needed
  sqlite.pragma('synchronous = OFF');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(deferIndexes ? TABLE_DDL : DDL);
  // rc.4 driver: the client must be passed via config (the positional
  // (client, config) form silently opens a NEW anonymous database)
  return { db: drizzle({ client: sqlite, schema }), sqlite };
}

/** Create the indexes a `deferIndexes` database left out. */
export function createIndexes(sqlite: Database.Database): void {
  sqlite.exec(INDEX_DDL);
}

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

export function insertTranslation(db: CorpusDb, meta: TranslationMeta): number {
  if (meta.scheme === PIVOT) throw new Error(`${meta.abbrev}: an edition cannot use the pivot scheme (ADR-0006)`);
  const [row] = db
    .insert(schema.translation)
    .values(meta)
    .returning({ id: schema.translation.id })
    .all();
  return row.id;
}

/** Record an edition's words and text stamps once its books are written (ADR-0005 amendments). */
export function setStamps(db: CorpusDb, translationId: number, stamps: { words: string; text: string }): void {
  db.update(schema.translation)
    .set({ wordsStamp: stamps.words, textStamp: stamps.text })
    .where(eq(schema.translation.id, translationId))
    .run();
}

/** Write the data sources, every USFM book, every canon and the default English names (ADR-0002). */
export function seedBooksAndCanons(db: CorpusDb): void {
  db.insert(schema.dataSource).values([...DATA_SOURCES]).run();
  db.insert(schema.book).values(BOOKS.map((b) => ({ code: b.code, usfmNumber: b.usfmNumber }))).run();
  for (const c of CANONS) {
    db.insert(schema.canon)
      .values({ id: c.id, tradition: c.tradition, sourceUrl: c.sourceUrl, note: c.note })
      .run();
    db.insert(schema.canonSection)
      .values(
        c.sections.map((s, i) => ({
          canonId: c.id,
          sectionId: s.id,
          parentSectionId: s.parent,
          ordinal: i + 1,
          labelKey: s.labelKey,
        })),
      )
      .run();
    db.insert(schema.canonEntry)
      .values(
        c.entries.map((e, i) => ({
          canonId: c.id,
          entryId: e.id,
          sectionId: e.section,
          ordinal: i + 1,
          status: e.status,
          labelKey: e.labelKey,
        })),
      )
      .run();
    db.insert(schema.canonEntryBook)
      .values(
        c.entries.flatMap((e) =>
          e.books.map((code, i) => ({ canonId: c.id, entryId: e.id, ordinal: i + 1, bookCode: code })),
        ),
      )
      .run();
  }
  db.insert(schema.bookName).values([...ENGLISH_NAMES]).run();
}

/** Write the scheme registry: one row per scheme plus its verse-count table. */
export function seedSchemes(db: CorpusDb, schemes: ReadonlyMap<string, Scheme>): void {
  db.transaction((tx) => seedSchemesIn(tx as unknown as CorpusDb, schemes));
}

function seedSchemesIn(db: CorpusDb, schemes: ReadonlyMap<string, Scheme>): void {
  for (const s of schemes.values()) {
    db.insert(schema.scheme).values({ id: s.id, name: s.name, sourceUrl: s.sourceUrl, note: s.note }).run();
    const counts = [...s.verseCounts].flatMap(([book, chapters]) =>
      chapters.map((verseCount, i) => ({ scheme: s.id, book, chapter: i + 1, verseCount })),
    );
    for (const chunk of chunks(counts, 2000)) db.insert(schema.schemeVerseCount).values(chunk).run();
    const excluded = [...s.excluded].map((k) => {
      const m = /^(\S+) (\d+):(\d+)$/.exec(k)!;
      return { scheme: s.id, book: m[1], chapter: Number(m[2]), verse: Number(m[3]) };
    });
    for (const chunk of chunks(excluded, 2000)) db.insert(schema.schemeExcludedVerse).values(chunk).run();
    const segments = [...s.segments].flatMap(([k, segs]) => {
      const m = /^(\S+) (\d+):(\d+)$/.exec(k)!;
      return segs.map((segment, i) => ({
        scheme: s.id, book: m[1], chapter: Number(m[2]), verse: Number(m[3]), ordinal: i + 1, segment,
      }));
    });
    for (const chunk of chunks(segments, 2000)) db.insert(schema.schemeSegment).values(chunk).run();
    const titles = [...s.titles].map((k) => {
      const [book, chapter] = k.split(' ');
      return { scheme: s.id, book, chapter: Number(chapter) };
    });
    for (const chunk of chunks(titles, 2000)) db.insert(schema.schemeTitle).values(chunk).run();
  }
}

/** Tokens per multi-row INSERT: one call into SQLite per row was most of the insert time. */
const TOKENS_PER_INSERT = 100;
const TOKEN_INSERT = `INSERT INTO token (translation_id, book, chapter, verse, segment, word_index, seq, kind, text,
  block_id, verse_start, ow_id) VALUES `;
const TOKEN_VALUES = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

/** Prepared once per connection: drizzle's insert builder took about 6 s for a 51k-token book. */
const bookStatements = new WeakMap<
  Database.Database,
  {
    doc: Database.Statement;
    verse: Database.Statement;
    block: Database.Statement;
    token: Database.Statement;
    tokens: Database.Statement;
  }
>();

/**
 * Insert one book's chapter documents and the rows derived from them; maps
 * local block ordinals → rowids. Returns each chapter's stamp, in order. The statements follow the column order of
 * src/db/corpus-schema.ts, and roundtrip.test.ts reads the rows back through
 * that schema.
 */
export function insertBookRows(
  db: CorpusDb,
  ids: { translationId: number; book: string },
  rows: { docs: readonly ChapterDoc[]; verses: readonly VerseText[]; blocks: Block[]; tokens: Token[] },
): { chapter: number; stamp: string }[] {
  const sqlite = (db as unknown as { $client: Database.Database }).$client;
  let stmts = bookStatements.get(sqlite);
  if (!stmts) {
    stmts = {
      doc: sqlite.prepare('INSERT INTO chapter_doc (translation_id, book, chapter, usj, stamp) VALUES (?, ?, ?, ?, ?)'),
      verse: sqlite.prepare(
        'INSERT INTO verse_text (translation_id, book, chapter, verse, last_verse, segment, text) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ),
      block: sqlite.prepare(
        'INSERT INTO block (translation_id, book, chapter, genre, marker, seq) VALUES (?, ?, ?, ?, ?, ?)',
      ),
      token: sqlite.prepare(TOKEN_INSERT + TOKEN_VALUES),
      tokens: sqlite.prepare(TOKEN_INSERT + Array(TOKENS_PER_INSERT).fill(TOKEN_VALUES).join(', ')),
    };
    bookStatements.set(sqlite, stmts);
  }
  const { doc, verse, block, token, tokens } = stmts;
  const stamps = rows.docs.map((d) => {
    const usj = JSON.stringify(d.content);
    const stamp = chapterStamp(usj, rows.verses.filter((v) => v.chapter === d.chapter));
    doc.run(ids.translationId, ids.book, d.chapter, usj, stamp);
    return { chapter: d.chapter, stamp };
  });
  for (const v of rows.verses) verse.run(ids.translationId, ids.book, v.chapter, v.verse, v.lastVerse, v.segment, v.text);
  const blockRowId = new Map<number, number>();
  for (const b of rows.blocks) {
    const { lastInsertRowid } = block.run(ids.translationId, ids.book, b.chapter, b.genre, b.marker, b.seq);
    blockRowId.set(b.id, Number(lastInsertRowid));
  }
  const values = (t: Token) => {
    const blockId = blockRowId.get(t.blockId);
    if (blockId == null) throw new Error(`token ${t.id} references unknown block ${t.blockId}`);
    return [ids.translationId, ids.book, t.chapter, t.verse, t.segment, t.wordIndex, t.seq, t.kind, t.text, blockId,
      t.verseStart ? 1 : 0, t.owId];
  };
  // Rows go in token order either way, so the rowids match one insert per row.
  let i = 0;
  for (; i + TOKENS_PER_INSERT <= rows.tokens.length; i += TOKENS_PER_INSERT) {
    tokens.run(rows.tokens.slice(i, i + TOKENS_PER_INSERT).flatMap(values));
  }
  for (; i < rows.tokens.length; i++) token.run(values(rows.tokens[i]));
  return stamps;
}

/** Write an edition's readings (ADR-0007). run.ts checks them against the stored tokens first. */
export function insertReadings(db: CorpusDb, translationId: number, source: string, readings: readonly Reading[]): void {
  const sqlite = (db as unknown as { $client: Database.Database }).$client;
  const stmt = sqlite.prepare(
    `INSERT INTO reading (translation_id, book, chapter, verse, segment, word_index, word_count, kind, text, ow_ids, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of readings) {
    stmt.run(translationId, r.book, r.chapter, r.verse, r.segment ?? '', r.wordIndex, r.wordCount, r.kind, r.text,
      r.owIds.join(' '), source);
  }
}

/** Write one book's original words (plan step 11), with `source` naming whose ids they are. */
export function insertOriginalWords(db: CorpusDb, translationId: number, source: string, words: readonly OriginalWord[]): void {
  const sqlite = (db as unknown as { $client: Database.Database }).$client;
  const stmt = sqlite.prepare(
    `INSERT INTO original_word (source, ow_id, translation_id, book, chapter, verse, segment, seq, word_index, kind,
       text, lemma, strongs, morph, gloss) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const w of words) {
    stmt.run(source, w.owId, translationId, w.book, w.chapter, w.verse, w.segment, w.seq, w.wordIndex, w.kind, w.text,
      w.lemma, w.strongs.join(' '), w.morph, w.gloss);
  }
}

/** An edition's alignment rows (ADR-0003 step 12 amendment). */
export function insertWordAlignments(db: CorpusDb, translationId: number, alignedBy: string, rows: readonly WordAlignment[]): void {
  const sqlite = (db as unknown as { $client: Database.Database }).$client;
  const stmt = sqlite.prepare(
    `INSERT INTO word_alignment (translation_id, book, chapter, verse, segment, word_index, seq, source, ow_id, strongs,
       aligned_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of rows) {
    stmt.run(translationId, r.book, r.chapter, r.verse, r.segment, r.wordIndex, r.seq, r.source, r.owId, r.strongs.join(' '), alignedBy);
  }
}

/** Where seeded data came from, with attribution and a note of changes. */
export const DATA_SOURCES = [
  {
    id: 'usfm-spec',
    url: USFM_SPEC_URL,
    sha256: null,
    license: 'CC BY 4.0',
    attribution: 'Book codes and English names from the USFM-USX-USJ documentation, Book Identifiers (USFM 3.2), CC BY 4.0',
    changes: 'Peripherals and XX* codes left out; the one English name is used as both long and short name.',
  },
  {
    id: 'tvtms',
    url: TVTMS.url,
    sha256: TVTMS.sha256,
    license: 'CC BY 4.0',
    attribution: TVTMS.attribution,
    changes:
      'Compiled per scheme: each row kept when its =Exist, =NotExist and =Last tests hold for the scheme\'s ' +
      'verse counts and its word-count and TextBeforeV1 tests hold for every edition ingested under the ' +
      `scheme; a word test decides only when its two sides differ by at least ${WORD_TEST_MARGIN * 100}% of ` +
      'the larger; rows no test decides, or that disagree for one verse, are left out; Ade rows (no USFM ' +
      'code) are skipped; 4Es is read as 2ES; a test without a book uses the row\'s source book; identity ' +
      'rows are dropped.',
  },
  {
    id: 'oshb',
    url: OSHB.url,
    sha256: OSHB.sha256,
    license: 'CC BY 4.0',
    attribution: OSHB.attribution,
    changes:
      'Each word\'s id, lemma and morphology are kept in original_word, the qere words\' ids also in ' +
      'reading.ow_ids; the word text drops the / morpheme breaks; notes other than qere are dropped; the main ' +
      'Strong\'s number is the lemma\'s last number. The WLC text itself is public domain.',
  },
  {
    id: MACULA_HEBREW.id,
    url: MACULA_HEBREW.url,
    sha256: MACULA_HEBREW.sha256,
    license: MACULA_HEBREW.license,
    attribution: MACULA_HEBREW.attribution,
    changes:
      'Only the glosses are kept, in original_word.gloss for OSHB\'s words: each morpheme\'s gloss column, ' +
      'else its english column, with dots read as spaces, joined per word. The numbers MACULA gives OSHB\'s ' +
      'prefix letters b, i, k, l and m are the Strong\'s numbers of words whose lemma has no other number.',
  },
  {
    id: MACULA_GREEK.id,
    url: MACULA_GREEK.url,
    sha256: MACULA_GREEK.sha256,
    license: MACULA_GREEK.license,
    attribution: MACULA_GREEK.attribution,
    changes:
      'Only xml:id, lemma, strong, morph, gloss and english are kept, in original_word; the gloss is the gloss ' +
      'column, else the english column. Strong\'s numbers are written G plus the number; a compound\'s ' +
      '(5228+1537+4053) are kept as a list, and 0 (no Strong\'s entry) as none.',
  },
  {
    id: CLEAR_BSB.id,
    url: CLEAR_BSB.url,
    sha256: null,
    license: 'CC BY 4.0',
    attribution: CLEAR_BSB.attribution,
    changes:
      'The SBLGNT-BSB and WLCM-BSB manual alignments are kept in word_alignment, one row per BSB word and ' +
      'original word: a WLC morpheme is stored as the OSHB word that holds it, with the morpheme\'s Strong\'s ' +
      'number from MACULA Hebrew. Clear aligned the BSB of 2024-09-04; its words are joined to our newer BSB ' +
      'verse by verse on their longest common sequence of words; words outside it, lone words of it where the verses differ, and words whose Clear group did not join whole are left unaligned.',
  },
  {
    id: 'vrs',
    url: LIBPALASO_URL,
    sha256: null,
    license: 'MIT',
    attribution: 'Versification files from libpalaso, Copyright (c) 2007-2014 SIL International (MIT)',
    changes:
      'Mapping lines (scheme = org) composed to the pivot through org.vrs, eng.vrs read backwards and ' +
      'TVTMS\'s eng rows; used only for verses TVTMS cannot decide from verse counts.',
  },
] as const;

/** Write mapping rows to the pivot (ADR-0006), tagged with where they came from. */
export function insertMappings(db: CorpusDb, rows: readonly MappingRow[], source: 'tvtms' | 'vrs' = 'vrs'): void {
  const values = rows.map((r) => ({
    scheme: r.scheme,
    book: r.from.book,
    chapter: r.from.chapter,
    verse: r.from.verse,
    segment: r.from.segment,
    pivotBook: r.to?.book ?? null,
    pivotChapter: r.to?.chapter ?? null,
    pivotVerse: r.to?.verse ?? null,
    pivotSegment: r.to?.segment ?? null,
    kind: r.kind,
    source: r.source ?? source,
  }));
  // A prepared statement: drizzle's builder takes seconds for tens of thousands of rows.
  const sqlite = (db as unknown as { $client: Database.Database }).$client;
  const stmt = sqlite.prepare(
    `INSERT INTO scheme_mapping (scheme, book, chapter, verse, segment, pivot_book, pivot_chapter,
       pivot_verse, pivot_segment, kind, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  sqlite.transaction(() => {
    for (const v of values) {
      stmt.run(v.scheme, v.book, v.chapter, v.verse, v.segment, v.pivotBook, v.pivotChapter,
        v.pivotVerse, v.pivotSegment, v.kind, v.source);
    }
  })();
}

function* chunks<T>(arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}
