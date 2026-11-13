/**
 * A small corpus DB in memory, for tests that need the contract or the
 * provider without build/corpus.db: books, canons and every scheme, plus one
 * edition read from a USJ fixture when given. It needs better-sqlite3's
 * native build, so a test gates on `sqliteLoads()` and calls this in
 * `beforeAll`.
 */

import type { SyncSqliteDb } from '../db/corpus-read';

export interface FixtureEdition {
  readonly abbrev: string;
  readonly scheme: string;
  readonly book: string;
  /** A whole-book USJ document, as usfm-grammar gives it. */
  readonly usj: unknown;
}

export async function memoryCorpus(fixture?: FixtureEdition): Promise<SyncSqliteDb> {
  const w = await import('../ingest/write-db');
  const { writeEdition } = await import('../ingest/edition-writer');
  const { normalizeChapters, splitChapters } = await import('../ingest/normalize');
  const { loadSchemes } = await import('../ingest/schemes');
  const { db } = w.createCorpusDb(':memory:');
  w.seedBooksAndCanons(db);
  w.seedSchemes(db, loadSchemes());
  if (fixture) {
    const { docs, blocks, tokens, verses } = normalizeChapters(splitChapters(fixture.usj as Parameters<typeof splitChapters>[0]));
    const meta = {
      name: 'Fixture',
      abbrev: fixture.abbrev,
      language: 'english',
      year: null,
      license: null,
      scheme: fixture.scheme,
      edition: 'sha256:fixture',
    };
    await writeEdition(db, meta, [fixture.book], async (edition) => edition.addBook(fixture.book, { docs, verses, blocks, tokens }));
  }
  return db;
}
