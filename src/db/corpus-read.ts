import { and, asc, eq, inArray, isNull, max, or } from 'drizzle-orm';
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
type SyncSqliteDb = BaseSQLiteDatabase<'sync', any, any, any, any>;

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
 * The corpus edition stamp(s) currently bundled (ADR-0005). Recorded in the
 * backup envelope (#13) so an export names the edition its anchors were minted
 * against; P1 only records them (quote-witness reconciliation is P2). Usually a
 * single edition across the bundled translations, but returns all distinct
 * values so a mixed-edition bundle is faithfully recorded.
 */
export function listEditions(db: SyncSqliteDb): string[] {
  return db
    .selectDistinct({ edition: schema.translation.edition })
    .from(schema.translation)
    .orderBy(asc(schema.translation.edition))
    .all()
    .map((r) => r.edition);
}

/**
 * A book's highest chapter number in one translation. Chapter 0 front matter
 * never wins the MAX.
 */
export function chapterCount(
  db: SyncSqliteDb,
  translationAbbrev: string,
  bookCode: string,
): number {
  const rows = db
    .select({ max: max(schema.block.chapter) })
    .from(schema.block)
    .innerJoin(schema.translation, eq(schema.block.translationId, schema.translation.id))
    .where(and(eq(schema.translation.abbrev, translationAbbrev), eq(schema.block.book, bookCode)))
    .all();
  return rows[0]?.max ?? 1;
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
 * One chapter's stored document (ADR-0001 amendment, plan step 7), or null
 * when the edition has no such chapter. Chapter 0 is the front matter.
 */
export function readChapterDoc(
  db: SyncSqliteDb,
  translationAbbrev: string,
  bookCode: string,
  chapter: number,
): ChapterDoc | null {
  const d = schema.chapterDoc;
  const [row] = db
    .select({ usj: d.usj })
    .from(d)
    .innerJoin(schema.translation, eq(d.translationId, schema.translation.id))
    .where(and(eq(schema.translation.abbrev, translationAbbrev), eq(d.book, bookCode), eq(d.chapter, chapter)))
    .all();
  return row ? { chapter, content: JSON.parse(row.usj) } : null;
}

/** One chapter's verse text, in verse order. */
export function readVerseText(db: SyncSqliteDb, translationAbbrev: string, bookCode: string, chapter: number): VerseText[] {
  const v = schema.verseText;
  return db
    .select({ chapter: v.chapter, verse: v.verse, segment: v.segment, text: v.text })
    .from(v)
    .innerJoin(schema.translation, eq(v.translationId, schema.translation.id))
    .where(and(eq(schema.translation.abbrev, translationAbbrev), eq(v.book, bookCode), eq(v.chapter, chapter)))
    .orderBy(asc(v.verse), asc(v.segment))
    .all();
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
  const counts = db
    .select()
    .from(schema.schemeVerseCount)
    .orderBy(asc(schema.schemeVerseCount.scheme), asc(schema.schemeVerseCount.book), asc(schema.schemeVerseCount.chapter))
    .all();
  for (const c of counts) {
    const m = parts.get(c.scheme)!.verseCounts;
    const list = m.get(c.book) ?? m.set(c.book, []).get(c.book)!;
    list[c.chapter - 1] = c.verseCount;
  }
  for (const e of db.select().from(schema.schemeExcludedVerse).all()) {
    parts.get(e.scheme)!.excluded.add(`${e.book} ${e.chapter}:${e.verse}`);
  }
  const segs = db.select().from(schema.schemeSegment).orderBy(asc(schema.schemeSegment.ordinal)).all();
  for (const g of segs) {
    const m = parts.get(g.scheme)!.segments;
    const k = `${g.book} ${g.chapter}:${g.verse}`;
    (m.get(k) ?? m.set(k, []).get(k)!).push(g.segment);
  }
  for (const t of db.select().from(schema.schemeTitle).all()) parts.get(t.scheme)!.titles.add(`${t.book} ${t.chapter}`);
  return new Map<string, Scheme>(parts);
}

/** Every mapping row to the pivot (ADR-0006). */
export function readMappings(db: SyncSqliteDb): MappingRow[] {
  return db
    .select()
    .from(schema.schemeMapping)
    .all()
    .map((r) => ({
      scheme: r.scheme,
      from: { book: r.book, chapter: r.chapter, verse: r.verse, segment: r.segment },
      to:
        r.pivotBook === null
          ? null
          : { book: r.pivotBook, chapter: r.pivotChapter!, verse: r.pivotVerse!, segment: r.pivotSegment ?? '' },
      kind: r.kind,
      source: r.source === 'tvtms' ? 'tvtms' : 'vrs',
    }));
}

/** Load the schemes and mappings, ready to move addresses between schemes. */
export function loadMappings(db: SyncSqliteDb): Mappings {
  return new Mappings(readMappings(db), readSchemes(db));
}
