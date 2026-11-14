/**
 * The reads the contract makes (`CorpusReader`), and the reader over one DB
 * with the corpus tables, with the queries only it makes. Reads that other code
 * shares stay in src/db/corpus-read.ts.
 */

import { and, asc, eq, gt, isNull, max } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';

import { at, canonBooks, loadMappings, prepared, readChapterDoc, readSchemes, readVerseText, type SyncSqliteDb } from '../db/corpus-read';
import * as schema from '../db/corpus-schema';
import type { ChapterDoc, OriginalWord, VerseText } from '../model/corpus';
import type { Mappings } from '../model/mapping';
import type { Scheme } from '../model/scheme';
import type { Credit } from './contract';

/** One chapter of an edition as the contract reads it: its verse units, in verse and segment order, and its stamp. */
export interface ChapterUnits {
  readonly stamp: string;
  readonly verses: readonly VerseText[];
}

/**
 * A read of one chapter: the chapter, null when the edition has no such
 * chapter, or a promise when the reader doesn't hold it yet. The promise
 * settles once the reader holds the chapter, or rejects when it can't get it.
 * A chapter printed with no text is held, with no verse units.
 */
export type ChapterRead<T> = T | null | Promise<T | null>;

/** An edition as a reader gives it: its name, scheme and stamps (ADR-0002, ADR-0005). */
export interface EditionRow {
  readonly abbrev: string;
  readonly name: string;
  readonly language: string;
  readonly scheme: string;
  readonly edition: string | null;
  readonly wordsStamp: string | null;
  readonly textStamp: string | null;
}

/** A book in the order a book list shows it, with its English short name and its section of the Protestant canon. */
export interface ListedBook {
  readonly book: string;
  readonly name: string;
  readonly section: string | null;
}

/**
 * The reads the contract makes. Each takes an edition's abbreviation. Only a
 * chapter read may wait (`ChapterRead`); the others are sync. A hub read
 * takes a verse unit's first verse and segment. An edition fetched a chapter
 * at a time has no edition stamp, words stamp or text stamp (ADR-0005,
 * 2026-11-11 amendment).
 */
export interface CorpusReader {
  edition(abbrev: string): EditionRow | null;
  /** Every edition the reader reads. */
  editions(): EditionRow[];
  /** The books the edition holds, each with its last chapter number. It reads no chapter. */
  books(abbrev: string): Map<string, number>;
  /** Every book the reader knows: the Protestant canon's in canon order, then the others by USFM number. */
  bookList(): ListedBook[];
  chapter(abbrev: string, book: string, chapter: number): ChapterRead<ChapterUnits>;
  /**
   * The chapter's document, with the stamp of the copy it is from: a reader
   * that fetches can replace a chapter between this read and `chapter`.
   * Chapter 0 is the book's front matter.
   */
  chapterDoc(abbrev: string, book: string, chapter: number): ChapterRead<ChapterDoc & { readonly stamp: string }>;
  originalWords(abbrev: string, book: string, chapter: number, verse: number, segment: string): OriginalWord[];
  wordAlignments(abbrev: string, book: string, chapter: number, verse: number, segment: string): AlignedOriginal[];
  dataSources(): Credit[];
  schemes(): Map<string, Scheme>;
  mappings(schemes: Map<string, Scheme>): Mappings;
}

/** How many chapters `dbReader` keeps read. */
const KEPT_CHAPTERS = 16;

/**
 * The reader over one DB with the corpus tables, which nothing writes while
 * it is read. A pack reads through `packReader` (src/pack/format.ts), which
 * inflates its chapter documents. It keeps the chapters it read last, so the
 * verse lookups of one chapter read its units once.
 */
export function dbReader(db: SyncSqliteDb): CorpusReader {
  const kept = new Map<string, ChapterUnits | null>();
  return {
    edition: (abbrev) => readEditions(db).find((e) => e.abbrev === abbrev) ?? null,
    editions: () => readEditions(db),
    books: (abbrev) => readBooks(db, abbrev),
    bookList: () => readBookList(db),
    chapter(abbrev, book, chapter) {
      const key = `${abbrev} ${book} ${chapter}`;
      const got = kept.has(key) ? kept.get(key)! : readChapterUnits(db, abbrev, book, chapter);
      // the newest last, so the first key is the one read longest ago
      kept.delete(key);
      kept.set(key, got);
      if (kept.size > KEPT_CHAPTERS) kept.delete(kept.keys().next().value!);
      return got;
    },
    chapterDoc: (abbrev, book, chapter) => readChapterDoc(db, abbrev, book, chapter),
    originalWords: (abbrev, book, chapter, verse, segment) => readOriginalWords(db, abbrev, book, chapter, verse, segment),
    wordAlignments: (abbrev, book, chapter, verse, segment) => readWordAlignments(db, abbrev, book, chapter, verse, segment),
    dataSources: () => readDataSources(db),
    schemes: () => readSchemes(db),
    mappings: (schemes) => loadMappings(db, schemes),
  };
}

/** Every edition's name, scheme and stamps (ADR-0002, ADR-0005), in the order the file holds them. */
function readEditions(db: SyncSqliteDb): EditionRow[] {
  const t = schema.translation;
  return db
    .select({
      abbrev: t.abbrev,
      name: t.name,
      language: t.language,
      scheme: t.scheme,
      edition: t.edition,
      wordsStamp: t.wordsStamp,
      textStamp: t.textStamp,
    })
    .from(t)
    .orderBy(asc(t.id))
    .all();
}

/** The books one edition has a chapter document for, each with its last chapter number. */
function readBooks(db: SyncSqliteDb, abbrev: string): Map<string, number> {
  const d = schema.chapterDoc;
  const rows = db
    .select({ book: d.book, chapters: max(d.chapter) })
    .from(d)
    .innerJoin(schema.translation, eq(d.translationId, schema.translation.id))
    // chapter 0 is the front matter
    .where(and(eq(schema.translation.abbrev, abbrev), gt(d.chapter, 0)))
    .groupBy(d.book)
    .all();
  return new Map(rows.map((r) => [r.book, r.chapters!]));
}

/** The canon and the language of a book list (ADR-0008: the Protestant canon, in English). */
const LIST_CANON = 'protestant';
const LIST_LANG = 'en';

/** Every book: the Protestant canon's in canon order, then the others by USFM number, each with its English short name. */
function readBookList(db: SyncSqliteDb): ListedBook[] {
  const canon = canonBooks(db, LIST_CANON, LIST_LANG).map((b) => ({ book: b.code, name: b.name, section: b.section }));
  const listed = new Set(canon.map((b) => b.book));
  const n = schema.bookName;
  const names = new Map(
    db
      .select({ book: n.bookCode, name: n.short })
      .from(n)
      .where(and(eq(n.lang, LIST_LANG), isNull(n.canonId)))
      .all()
      .map((r) => [r.book, r.name]),
  );
  const others = db.select({ book: schema.book.code }).from(schema.book).orderBy(asc(schema.book.usfmNumber)).all();
  return [
    ...canon,
    ...others.filter((b) => !listed.has(b.book)).map((b) => ({ book: b.book, name: names.get(b.book) ?? b.book, section: null })),
  ];
}

/** One chapter's verse units and stamp, or null when the edition has neither. */
function readChapterUnits(db: SyncSqliteDb, abbrev: string, book: string, chapter: number): ChapterUnits | null {
  const stamp = readChapterStamp(db, abbrev, book, chapter);
  const verses = readVerseText(db, abbrev, book, chapter);
  if (stamp !== null) return { stamp, verses };
  if (verses.length > 0) throw new Error(`${abbrev} has verse text in ${book} ${chapter} but no chapter document`);
  return null;
}

/** One chapter's stamp, without its document, or null when the edition has no such chapter. */
function readChapterStamp(db: SyncSqliteDb, translationAbbrev: string, bookCode: string, chapter: number): string | null {
  const d = schema.chapterDoc;
  const [row] = prepared(db, 'chapterStamp', () =>
    db
      .select({ stamp: d.stamp })
      .from(d)
      .innerJoin(schema.translation, eq(d.translationId, schema.translation.id))
      .where(and(eq(schema.translation.abbrev, at.abbrev), eq(d.book, at.book), eq(d.chapter, at.chapter)))
      .prepare(),
  ).all({ abbrev: translationAbbrev, book: bookCode, chapter });
  return row?.stamp ?? null;
}

/** The original words of one verse unit of WLC or SBLGNT (plan step 11), in read order. Empty for other editions. */
function readOriginalWords(
  db: SyncSqliteDb,
  translationAbbrev: string,
  bookCode: string,
  chapter: number,
  verse: number,
  segment: string,
): OriginalWord[] {
  const w = schema.originalWord;
  return prepared(db, 'originalWords', () =>
    db
      .select({
        owId: w.owId,
        book: w.book,
        chapter: w.chapter,
        verse: w.verse,
        segment: w.segment,
        wordIndex: w.wordIndex,
        seq: w.seq,
        kind: w.kind,
        text: w.text,
        lemma: w.lemma,
        strongs: w.strongs,
        morph: w.morph,
        gloss: w.gloss,
      })
      .from(w)
      .innerJoin(schema.translation, eq(w.translationId, schema.translation.id))
      .where(
        and(
          eq(schema.translation.abbrev, at.abbrev),
          eq(w.book, at.book),
          eq(w.chapter, at.chapter),
          eq(w.verse, at.verse),
          eq(w.segment, at.segment),
        ),
      )
      .orderBy(asc(w.seq))
      .prepare(),
  )
    .all({ abbrev: translationAbbrev, book: bookCode, chapter, verse, segment })
    .map((row) => ({ ...row, strongs: row.strongs ? row.strongs.split(' ') : [] }));
}

/** One alignment row of a word: the original word it translates and the Strong's numbers it carries (plan step 12). */
export interface AlignedOriginal {
  readonly wordIndex: number;
  readonly strongs: readonly string[];
  readonly owId: string;
  /** Where the original word is: its edition and scheme, and its word index (null for a qere). */
  readonly edition: string;
  readonly scheme: string;
  readonly book: string;
  readonly chapter: number;
  readonly verse: number;
  readonly segment: string;
  readonly owWordIndex: number | null;
}

/** The alignment rows of one verse unit's words, by word index and then `seq`. Empty for an edition with none. */
function readWordAlignments(
  db: SyncSqliteDb,
  translationAbbrev: string,
  bookCode: string,
  chapter: number,
  verse: number,
  segment: string,
): AlignedOriginal[] {
  const a = schema.wordAlignment;
  const o = schema.originalWord;
  const hub = alias(schema.translation, 'hub');
  return prepared(db, 'wordAlignments', () =>
    db
      .select({
        wordIndex: a.wordIndex,
        strongs: a.strongs,
        owId: a.owId,
        edition: hub.abbrev,
        scheme: hub.scheme,
        book: o.book,
        chapter: o.chapter,
        verse: o.verse,
        segment: o.segment,
        owWordIndex: o.wordIndex,
      })
      .from(a)
      .innerJoin(schema.translation, eq(a.translationId, schema.translation.id))
      .innerJoin(o, and(eq(o.source, a.source), eq(o.owId, a.owId)))
      .innerJoin(hub, eq(o.translationId, hub.id))
      .where(
        and(
          eq(schema.translation.abbrev, at.abbrev),
          eq(a.book, at.book),
          eq(a.chapter, at.chapter),
          eq(a.verse, at.verse),
          eq(a.segment, at.segment),
        ),
      )
      .orderBy(asc(a.wordIndex), asc(a.seq))
      .prepare(),
  )
    .all({ abbrev: translationAbbrev, book: bookCode, chapter, verse, segment })
    .map((row) => ({ ...row, strongs: row.strongs ? row.strongs.split(' ') : [] }));
}

/** Every data source and its credit, by id. */
function readDataSources(db: SyncSqliteDb): { id: string; url: string; license: string; attribution: string; changes: string }[] {
  const d = schema.dataSource;
  return db
    .select({ id: d.id, url: d.url, license: d.license, attribution: d.attribution, changes: d.changes })
    .from(d)
    .orderBy(asc(d.id))
    .all();
}
