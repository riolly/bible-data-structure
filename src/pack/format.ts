/**
 * How a pack stores what the corpus DB stores, in both directions: which
 * tables it drops, how it encodes a chapter document, and the reader that
 * reads it back. `buildPack` (pack.ts) writes this format. No Node-only
 * import here, so an app reads a pack through `packContract`, or through
 * `packReader` under a provider.
 */

import { and, eq, sql } from 'drizzle-orm';
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';

import type { BibleContract } from '../contract/contract';
import { readerContract } from '../contract/corpus-contract';
import { dbReader, type CorpusReader } from '../contract/reader';
import { at, prepared, type SyncSqliteDb } from '../db/corpus-read';
import * as schema from '../db/corpus-schema';
import type { ChapterDoc } from '../model/corpus';

/** Corpus tables a pack drops: the contract reads none of their rows (ADR-0004, step 13 amendment). */
export const DROPPED = ['token', 'block'] as const;

/** A chapter document's JSON as a pack stores it in `chapter_doc.usj`, a BLOB in a column declared TEXT. */
export const deflateDoc = (json: string): Uint8Array => deflateSync(strToU8(json), { level: 9 });

/** A stored chapter document's JSON back from a pack. */
export const inflateDoc = (stored: Uint8Array): string => strFromU8(inflateSync(stored));

/** The corpus DB's reader over a pack, with each chapter document inflated. */
export function packReader(db: SyncSqliteDb): CorpusReader {
  return { ...dbReader(db), chapterDoc: (abbrev, book, chapter) => readPackedDoc(db, abbrev, book, chapter) };
}

/** The app contract over a pack, on any sync drizzle SQLite driver. */
export function packContract(db: SyncSqliteDb): BibleContract {
  return readerContract(packReader(db));
}

/** One chapter's document from a pack and its stamp, or null when the edition has no such chapter. */
function readPackedDoc(db: SyncSqliteDb, abbrev: string, book: string, chapter: number): (ChapterDoc & { stamp: string }) | null {
  const d = schema.chapterDoc;
  // the schema types `usj` as the corpus DB's JSON text; a pack holds the deflated bytes
  const [row] = prepared(db, 'packedDoc', () =>
    db
      .select({ usj: sql<Uint8Array>`${d.usj}`, stamp: d.stamp })
      .from(d)
      .innerJoin(schema.translation, eq(d.translationId, schema.translation.id))
      .where(and(eq(schema.translation.abbrev, at.abbrev), eq(d.book, at.book), eq(d.chapter, at.chapter)))
      .prepare(),
  ).all({ abbrev, book, chapter });
  if (!row) return null;
  return { chapter, content: JSON.parse(inflateDoc(row.usj)), stamp: row.stamp };
}
