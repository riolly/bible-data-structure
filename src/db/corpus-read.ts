import { and, asc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { alias, type BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { inflateSync, strFromU8 } from 'fflate';

import type { Block, ChapterDoc, OriginalWord, Reading, Token, VerseText } from '../model/corpus';
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

/** One edition's scheme and stamps (ADR-0002, ADR-0005), or null when the corpus has no such edition. */
export function readEdition(
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
  const [row] = db
    .select({ usj: d.usj, stamp: d.stamp })
    .from(d)
    .innerJoin(schema.translation, eq(d.translationId, schema.translation.id))
    .where(and(eq(schema.translation.abbrev, translationAbbrev), eq(d.book, bookCode), eq(d.chapter, chapter)))
    .all();
  if (!row) return null;
  // a pack stores the document deflated (src/pack/pack.ts)
  const usj: string | Uint8Array = row.usj;
  const json = typeof usj === 'string' ? usj : strFromU8(inflateSync(usj));
  return { chapter, content: JSON.parse(json), stamp: row.stamp };
}

/** One chapter's stamp, without its document, or null when the edition has no such chapter. */
export function readChapterStamp(db: SyncSqliteDb, translationAbbrev: string, bookCode: string, chapter: number): string | null {
  const d = schema.chapterDoc;
  const [row] = db
    .select({ stamp: d.stamp })
    .from(d)
    .innerJoin(schema.translation, eq(d.translationId, schema.translation.id))
    .where(and(eq(schema.translation.abbrev, translationAbbrev), eq(d.book, bookCode), eq(d.chapter, chapter)))
    .all();
  return row?.stamp ?? null;
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
  return db
    .select(verseUnitColumns)
    .from(v)
    .innerJoin(schema.translation, eq(v.translationId, schema.translation.id))
    .where(and(eq(schema.translation.abbrev, translationAbbrev), eq(v.book, bookCode), eq(v.chapter, chapter)))
    .orderBy(asc(v.verse), asc(v.segment))
    .all();
}

/**
 * The verse unit that holds `chapter:verse` in one edition, or null when the
 * edition has none. A bridge `\v 20-21` is found from 20 and from 21, and its
 * words are the tokens of verse 20 (ADR-0004 v1.5).
 */
export function readVerseUnit(
  db: SyncSqliteDb,
  translationAbbrev: string,
  bookCode: string,
  chapter: number,
  verse: number,
  segment = '',
): VerseText | null {
  const v = schema.verseText;
  const [row] = db
    .select(verseUnitColumns)
    .from(v)
    .innerJoin(schema.translation, eq(v.translationId, schema.translation.id))
    .where(
      and(
        eq(schema.translation.abbrev, translationAbbrev),
        eq(v.book, bookCode),
        eq(v.chapter, chapter),
        eq(v.segment, segment),
        lte(v.verse, verse),
        gte(v.lastVerse, verse),
      ),
    )
    .all();
  return row ?? null;
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

/** The original words of one verse unit of WLC or SBLGNT (plan step 11), in read order. Empty for other editions. */
export function readOriginalWords(
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
export function readWordAlignments(
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

/** Load the schemes and mappings, ready to move addresses between schemes. Pass `schemes` when they are already loaded. */
export function loadMappings(db: SyncSqliteDb, schemes = readSchemes(db)): Mappings {
  return new Mappings(readMappings(db), schemes);
}
