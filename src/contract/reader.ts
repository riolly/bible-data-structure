/**
 * The reads the contract makes (`CorpusReader`), and the reader over one DB,
 * the corpus or a pack, with the queries only it makes. Reads that other code
 * shares stay in src/db/corpus-read.ts.
 */

import { and, asc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';

import { loadMappings, readChapterDoc, readSchemes, readVerseText, type SyncSqliteDb } from '../db/corpus-read';
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

/**
 * The reads the contract makes. Each takes an edition's abbreviation. Only a
 * chapter read may wait (`ChapterRead`); the others are sync. A hub read
 * takes a verse unit's first verse and segment. An edition fetched a chapter
 * at a time has no edition stamp, words stamp or text stamp (ADR-0005,
 * 2026-11-11 amendment).
 */
export interface CorpusReader {
  edition(abbrev: string): { abbrev: string; scheme: string; edition: string | null; wordsStamp: string | null; textStamp: string | null } | null;
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
 * The reader over one DB: the corpus or a pack, which nothing writes while it
 * is read. It keeps the chapters it read last, so the verse lookups of one
 * chapter read its units once.
 */
export function dbReader(db: SyncSqliteDb): CorpusReader {
  const kept = new Map<string, ChapterUnits | null>();
  return {
    edition: (abbrev) => readEdition(db, abbrev),
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

/** One edition's scheme and stamps (ADR-0002, ADR-0005), or null when the corpus has no such edition. */
function readEdition(
  db: SyncSqliteDb,
  translationAbbrev: string,
): { abbrev: string; scheme: string; edition: string; wordsStamp: string | null; textStamp: string | null } | null {
  const t = schema.translation;
  const [row] = db
    .select({ abbrev: t.abbrev, scheme: t.scheme, edition: t.edition, wordsStamp: t.wordsStamp, textStamp: t.textStamp })
    .from(t)
    .where(eq(t.abbrev, translationAbbrev))
    .all();
  return row ?? null;
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
  const [row] = db
    .select({ stamp: d.stamp })
    .from(d)
    .innerJoin(schema.translation, eq(d.translationId, schema.translation.id))
    .where(and(eq(schema.translation.abbrev, translationAbbrev), eq(d.book, bookCode), eq(d.chapter, chapter)))
    .all();
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
  return db
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
        eq(schema.translation.abbrev, translationAbbrev),
        eq(w.book, bookCode),
        eq(w.chapter, chapter),
        eq(w.verse, verse),
        eq(w.segment, segment),
      ),
    )
    .orderBy(asc(w.seq))
    .all()
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
  return db
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
        eq(schema.translation.abbrev, translationAbbrev),
        eq(a.book, bookCode),
        eq(a.chapter, chapter),
        eq(a.verse, verse),
        eq(a.segment, segment),
      ),
    )
    .orderBy(asc(a.wordIndex), asc(a.seq))
    .all()
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
