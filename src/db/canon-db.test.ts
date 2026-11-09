import { describe, expect, it } from 'vitest';

import { nativeModuleLoads } from '../ingest/native-probe';

const native = nativeModuleLoads(
  "import('better-sqlite3').then(({ default: Database }) => { new Database(':memory:').close(); process.exit(0); }, () => process.exit(1));",
);

describe.skipIf(!native)('book and canon tables', () => {
  it('seeds books, the protestant canon and English names', async () => {
    const { createCorpusDb, seedBooksAndCanons } = await import('../ingest/write-db');
    const { canonBooks } = await import('./corpus-read');
    const { db, sqlite } = createCorpusDb(':memory:');
    seedBooksAndCanons(db);

    const count = (t: string) => (sqlite.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
    expect(count('canon')).toBe(1);
    expect(count('canon_section')).toBe(2);
    expect(count('canon_entry')).toBe(66);
    expect(count('canon_entry_book')).toBe(66);
    expect(count('book')).toBeGreaterThan(66);

    const books = canonBooks(db, 'protestant', 'en');
    expect(books).toHaveLength(66);
    expect(books[0]).toEqual({ code: 'GEN', name: 'Genesis', section: 'ot' });
    expect(books[65]).toEqual({ code: 'REV', name: 'Revelation', section: 'nt' });

    // The old display columns are gone.
    const cols = (sqlite.prepare('PRAGMA table_info(book)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(['code', 'usfm_number']);
    sqlite.close();
  }, 60_000); // the first import of write-db takes over 4 s while the corpus-wide tests run beside it

  it('prefers a canon-specific name over the default', async () => {
    const { createCorpusDb, seedBooksAndCanons } = await import('../ingest/write-db');
    const { canonBooks } = await import('./corpus-read');
    const { db, sqlite } = createCorpusDb(':memory:');
    seedBooksAndCanons(db);
    sqlite
      .prepare(
        "INSERT INTO book_name (book_code, lang, canon_id, long, short, abbr, source) VALUES ('SNG', 'en', 'protestant', 'Song of Solomon', 'Song of Solomon', NULL, 'usfm-spec')",
      )
      .run();
    expect(canonBooks(db, 'protestant', 'en').find((b) => b.code === 'SNG')?.name).toBe(
      'Song of Solomon',
    );
    sqlite.close();
  });
});
