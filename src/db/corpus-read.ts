import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type { Block, ChapterDoc, Reading, Token, VerseText } from '../model/corpus';
import { Mappings, type MappingRow } from '../model/mapping';
import type { Scheme } from '../model/scheme';
import * as schema from './corpus-schema';

/**
 * Corpus reads across the old-repo ADR-0009 Drizzle seam. Driver-agnostic over
 * the SYNC sqlite drivers (better-sqlite3 at build time and in tests). Books are
 * addressed by USFM code, translations by abbrev, never by storage ids
 * (ADR-0002).
 */

/** Driver-agnostic bound satisfied by both sync drizzle drivers. */
export type SyncSqliteDb = BaseSQLiteDatabase<'sync', any, any, any, any>;

/** The values a prepared read takes: `.all({ abbrev, book, chapter })`. */
export const at = {
  abbrev: sql.placeholder('abbrev'),
  book: sql.placeholder('book'),
  chapter: sql.placeholder('chapter'),
  verse: sql.placeholder('verse'),
  segment: sql.placeholder('segment'),
};

const statements = new WeakMap<SyncSqliteDb, Map<string, unknown>>();

/**
 * The query `name` of one DB as a prepared statement, built on its first
 * use. Without it drizzle builds a query's SQL on every run, which was about
 * half of a warm contract call (README, step 13).
 */
export function prepared<Q>(db: SyncSqliteDb, name: string, build: () => Q): Q {
  let made = statements.get(db);
  if (!made) statements.set(db, (made = new Map()));
  let q = made.get(name) as Q | undefined;
  if (!q) made.set(name, (q = build()));
  return q;
}

/** Rows as arrays in select order. Drizzle's mapping of each row to an object was 85% of reading the schemes and mappings. */
const values = <Row extends unknown[]>(query: { values(): unknown }): Row[] => query.values() as Row[];

export interface Chapter {
  blocks: Block[];
  tokens: Token[];
}

/** One book in a canon, with its display name. */
export interface CanonBook {
  readonly code: string;
  readonly name: string;
  readonly section: string;
}

/**
 * A canon's books in canon order, each named in `lang`. A name row for this
 * canon wins over the default (`canon_id` NULL); with neither, the name is the
 * USFM code.
 */
export function canonBooks(db: SyncSqliteDb, canonId: string, lang: string): CanonBook[] {
  const rows = db
    .select({ code: schema.canonEntryBook.bookCode, section: schema.canonEntry.sectionId })
    .from(schema.canonEntry)
    .innerJoin(
      schema.canonEntryBook,
      and(
        eq(schema.canonEntryBook.canonId, schema.canonEntry.canonId),
        eq(schema.canonEntryBook.entryId, schema.canonEntry.entryId),
      ),
    )
    .where(eq(schema.canonEntry.canonId, canonId))
    .orderBy(asc(schema.canonEntry.ordinal), asc(schema.canonEntryBook.ordinal))
    .all();
  const names = new Map<string, { name: string; specific: boolean }>();
  for (const n of db
    .select({ code: schema.bookName.bookCode, name: schema.bookName.short, canonId: schema.bookName.canonId })
    .from(schema.bookName)
    .where(
      and(
        eq(schema.bookName.lang, lang),
        or(isNull(schema.bookName.canonId), eq(schema.bookName.canonId, canonId)),
      ),
    )
    .all()) {
    const specific = n.canonId !== null;
    if (specific || !names.get(n.code)?.specific) names.set(n.code, { name: n.name, specific });
  }
  return rows.map((r) => ({ code: r.code, name: names.get(r.code)?.name ?? r.code, section: r.section }));
}

/**
 * Read one chapter's Block + Token rows, in render order. Chapter 1 also
 * includes chapter 0 — the book's front matter (\mt book title), which the
 * ingest stores before \c 1 and the first Page renders above chapter 1.
 */
export function readChapter(
  db: SyncSqliteDb,
  translationAbbrev: string,
  bookCode: string,
  chapter: number,
): Chapter {
  const chapters = chapter === 1 ? [0, 1] : [chapter];
  const scoped = <C extends typeof schema.block | typeof schema.token>(table: C) =>
    and(
      eq(schema.translation.abbrev, translationAbbrev),
      eq(table.book, bookCode),
      inArray(table.chapter, chapters),
    );

  const blocks: Block[] = db
    .select({
      id: schema.block.id,
      chapter: schema.block.chapter,
      genre: schema.block.genre,
      marker: schema.block.marker,
      seq: schema.block.seq,
    })
    .from(schema.block)
    .innerJoin(schema.translation, eq(schema.block.translationId, schema.translation.id))
    .where(scoped(schema.block))
    .orderBy(asc(schema.block.chapter), asc(schema.block.seq))
    .all();

  const tokens: Token[] = db
    .select({
      id: schema.token.id,
      blockId: schema.token.blockId,
      chapter: schema.token.chapter,
      verse: schema.token.verse,
      segment: schema.token.segment,
      wordIndex: schema.token.wordIndex,
      seq: schema.token.seq,
      kind: schema.token.kind,
      text: schema.token.text,
      verseStart: schema.token.verseStart,
      owId: schema.token.owId,
    })
    .from(schema.token)
    .innerJoin(schema.translation, eq(schema.token.translationId, schema.translation.id))
    .where(scoped(schema.token))
    .orderBy(asc(schema.token.chapter), asc(schema.token.seq))
    .all();

  return { blocks, tokens };
}

/**
 * One chapter's stored document (ADR-0001 amendment, plan step 7) and its
 * chapter stamp (ADR-0005 amendment, 2026-11-11), or null when the edition has
 * no such chapter. Chapter 0 is the front matter.
 */
export function readChapterDoc(
  db: SyncSqliteDb,
  translationAbbrev: string,
  bookCode: string,
  chapter: number,
): (ChapterDoc & { stamp: string }) | null {
  const d = schema.chapterDoc;
  const [row] = prepared(db, 'chapterDoc', () =>
    db
      .select({ usj: d.usj, stamp: d.stamp })
      .from(d)
      .innerJoin(schema.translation, eq(d.translationId, schema.translation.id))
      .where(and(eq(schema.translation.abbrev, at.abbrev), eq(d.book, at.book), eq(d.chapter, at.chapter)))
      .prepare(),
  ).all({ abbrev: translationAbbrev, book: bookCode, chapter });
  if (!row) return null;
  return { chapter, content: JSON.parse(row.usj), stamp: row.stamp };
}

const verseUnitColumns = {
  chapter: schema.verseText.chapter,
  verse: schema.verseText.verse,
  lastVerse: schema.verseText.lastVerse,
  segment: schema.verseText.segment,
  text: schema.verseText.text,
};

/** One chapter's verse units with their text, in verse order. */
export function readVerseText(db: SyncSqliteDb, translationAbbrev: string, bookCode: string, chapter: number): VerseText[] {
  const v = schema.verseText;
  return prepared(db, 'verseText', () =>
    db
      .select(verseUnitColumns)
      .from(v)
      .innerJoin(schema.translation, eq(v.translationId, schema.translation.id))
      .where(and(eq(schema.translation.abbrev, at.abbrev), eq(v.book, at.book), eq(v.chapter, at.chapter)))
      .orderBy(asc(v.verse), asc(v.segment))
      .prepare(),
  ).all({ abbrev: translationAbbrev, book: bookCode, chapter });
}

/** One chapter's readings (ADR-0007), in word order. The ketiv they cover are the chapter's tokens. */
export function readReadings(db: SyncSqliteDb, translationAbbrev: string, bookCode: string, chapter: number): Reading[] {
  const r = schema.reading;
  return db
    .select({
      book: r.book,
      chapter: r.chapter,
      verse: r.verse,
      segment: r.segment,
      wordIndex: r.wordIndex,
      wordCount: r.wordCount,
      kind: r.kind,
      text: r.text,
      owIds: r.owIds,
    })
    .from(r)
    .innerJoin(schema.translation, eq(r.translationId, schema.translation.id))
    .where(and(eq(schema.translation.abbrev, translationAbbrev), eq(r.book, bookCode), eq(r.chapter, chapter)))
    .orderBy(asc(r.verse), asc(r.segment), asc(r.wordIndex), asc(r.wordCount))
    .all()
    .map((row) => ({ ...row, owIds: row.owIds ? row.owIds.split(' ') : [] }));
}

/** Every scheme in the corpus, the pivot included, rebuilt from its tables. */
export function readSchemes(db: SyncSqliteDb): Map<string, Scheme> {
  interface Parts {
    id: string;
    name: string;
    sourceUrl: string;
    note: string;
    verseCounts: Map<string, number[]>;
    excluded: Set<string>;
    segments: Map<string, string[]>;
    titles: Set<string>;
  }
  const parts = new Map<string, Parts>();
  for (const s of db.select().from(schema.scheme).all()) {
    parts.set(s.id, { ...s, verseCounts: new Map(), excluded: new Set(), segments: new Map(), titles: new Set() });
  }
  const c = schema.schemeVerseCount;
  const counts = db
    .select({ scheme: c.scheme, book: c.book, chapter: c.chapter, verseCount: c.verseCount })
    .from(c)
    .orderBy(asc(c.scheme), asc(c.book), asc(c.chapter));
  for (const [scheme, book, chapter, verseCount] of values<[string, string, number, number]>(counts)) {
    const m = parts.get(scheme)!.verseCounts;
    const list = m.get(book) ?? m.set(book, []).get(book)!;
    list[chapter - 1] = verseCount;
  }
  const e = schema.schemeExcludedVerse;
  const excluded = db.select({ scheme: e.scheme, book: e.book, chapter: e.chapter, verse: e.verse }).from(e);
  for (const [scheme, book, chapter, verse] of values<[string, string, number, number]>(excluded)) {
    parts.get(scheme)!.excluded.add(`${book} ${chapter}:${verse}`);
  }
  const g = schema.schemeSegment;
  const segs = db
    .select({ scheme: g.scheme, book: g.book, chapter: g.chapter, verse: g.verse, segment: g.segment })
    .from(g)
    .orderBy(asc(g.ordinal));
  for (const [scheme, book, chapter, verse, segment] of values<[string, string, number, number, string]>(segs)) {
    const m = parts.get(scheme)!.segments;
    const k = `${book} ${chapter}:${verse}`;
    (m.get(k) ?? m.set(k, []).get(k)!).push(segment);
  }
  const t = schema.schemeTitle;
  const titles = db.select({ scheme: t.scheme, book: t.book, chapter: t.chapter }).from(t);
  for (const [scheme, book, chapter] of values<[string, string, number]>(titles)) parts.get(scheme)!.titles.add(`${book} ${chapter}`);
  return new Map<string, Scheme>(parts);
}

/** Every mapping row to the pivot (ADR-0006). */
function readMappings(db: SyncSqliteDb): MappingRow[] {
  const m = schema.schemeMapping;
  type Row = [string, string, number, number, string, string | null, number | null, number | null, string | null, MappingRow['kind'], string];
  const rows = db.select({
    scheme: m.scheme,
    book: m.book,
    chapter: m.chapter,
    verse: m.verse,
    segment: m.segment,
    pivotBook: m.pivotBook,
    pivotChapter: m.pivotChapter,
    pivotVerse: m.pivotVerse,
    pivotSegment: m.pivotSegment,
    kind: m.kind,
    source: m.source,
  }).from(m);
  return values<Row>(rows).map(([scheme, book, chapter, verse, segment, pivotBook, pivotChapter, pivotVerse, pivotSegment, kind, source]) => ({
    scheme,
    from: { book, chapter, verse, segment },
    to: pivotBook === null ? null : { book: pivotBook, chapter: pivotChapter!, verse: pivotVerse!, segment: pivotSegment ?? '' },
    kind,
    source: source === 'tvtms' ? 'tvtms' : 'vrs',
  }));
}

/** Load the schemes and mappings, ready to move addresses between schemes. Pass `schemes` when they are already loaded. */
export function loadMappings(db: SyncSqliteDb, schemes = readSchemes(db)): Mappings {
  return new Mappings(readMappings(db), schemes);
}
