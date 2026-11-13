import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readChapter, readChapterDoc, readReadings, readVerseText, readVerseUnit } from '../db/corpus-read';
import { nativeModuleLoads } from './native-probe';
import { normalizeChapters, splitChapters, type UsjDoc } from './normalize';

/**
 * DB round-trip across the old-repo ADR-0009 seam: normalized rows written through
 * drizzle(better-sqlite3) and read back through corpus-read.ts. Skipped where
 * the better-sqlite3 native module is unbuilt or built for a
 * different Node ABI — probed in a subprocess so a hard crash cannot take
 * down the vitest worker (see native-probe). The import alone succeeds even
 * when the binding is unbuilt; only construction touches the .node file.
 */

const native = nativeModuleLoads(
  "import('better-sqlite3').then(({ default: Database }) => { new Database(':memory:').close(); process.exit(0); }, () => process.exit(1));",
);

describe.skipIf(!native)('corpus DB round-trip (write seam ↔ read seam)', () => {
  it('a chapter read returns the exact Token+Block rows the normalizer produced', async () => {
    const { createCorpusDb, insertBookRows, insertTranslation, seedBooksAndCanons, seedSchemes } = await import(
      './write-db'
    );
    const usj = JSON.parse(
      readFileSync(join(__dirname, 'fixtures', 'adversarial.usj.json'), 'utf8'),
    ) as UsjDoc;
    const { docs, blocks, tokens, verses } = normalizeChapters(splitChapters(usj));

    const { db, sqlite } = createCorpusDb(':memory:');
    seedBooksAndCanons(db);
    seedSchemes(db, (await import('./schemes')).loadSchemes());
    const translationId = insertTranslation(db, {
      name: 'Fixture',
      abbrev: 'FIX',
      language: 'english',
      year: 2026,
      license: 'Public Domain',
      scheme: 'kjv',
      edition: 'sha256:0000000000000000',
    });
    const stamps = insertBookRows(db, { translationId, book: 'JHN' }, { docs, verses, blocks, tokens });

    // chapter 1 read includes chapter-0 front matter (\mt book title)
    const ch1 = readChapter(db, 'FIX', 'JHN', 1);
    const expectBlocks = blocks.filter((b) => b.chapter <= 1);
    const expectTokens = tokens.filter((t) => t.chapter <= 1);
    expect(ch1.blocks.length).toBe(expectBlocks.length);
    expect(ch1.tokens.length).toBe(expectTokens.length);
    // domain fields survive the round-trip exactly (storage ids differ)
    expect(
      ch1.blocks.map((b) => [b.chapter, b.genre, b.marker, b.seq]),
    ).toEqual(expectBlocks.map((b) => [b.chapter, b.genre, b.marker, b.seq]));
    expect(
      ch1.tokens.map((t) => [t.chapter, t.verse, t.wordIndex, t.seq, t.kind, t.text, t.verseStart, t.owId]),
    ).toEqual(
      expectTokens.map((t) => [t.chapter, t.verse, t.wordIndex, t.seq, t.kind, t.text, t.verseStart, t.owId]),
    );
    // block membership survives via the local-ordinal → rowid mapping
    const localToRow = new Map<number, number>();
    ch1.blocks.forEach((b, i) => localToRow.set(expectBlocks[i].id, b.id));
    ch1.tokens.forEach((t, i) => {
      expect(t.blockId).toBe(localToRow.get(expectTokens[i].blockId));
    });

    // a non-first chapter read does NOT include front matter
    const ch2 = readChapter(db, 'FIX', 'JHN', 2);
    expect(ch2.blocks.every((b) => b.chapter === 2)).toBe(true);
    expect(ch2.tokens.some((t) => t.verse === null)).toBe(true); // \d + \qa headings

    // the stored chapter documents come back unchanged, and derive the same rows
    const stored = docs.map((d) => readChapterDoc(db, 'FIX', 'JHN', d.chapter)!);
    expect(stored.map(({ stamp: _, ...d }) => d)).toEqual(docs);
    expect(stored.map((d) => ({ chapter: d.chapter, stamp: d.stamp }))).toEqual(stamps);
    const again = normalizeChapters(stored);
    expect(again.tokens).toEqual(tokens);
    expect(again.blocks).toEqual(blocks);
    expect(readChapterDoc(db, 'FIX', 'JHN', 3)).toBeNull();
    expect(readVerseText(db, 'FIX', 'JHN', 1)).toEqual(verses.filter((v) => v.chapter === 1));

    // a bridge resolves from each of its numbers (ADR-0004 v1.5)
    const bridge = verses.find((v) => v.chapter === 1 && v.verse === 5)!;
    expect(bridge.lastVerse).toBe(6);
    expect(readVerseUnit(db, 'FIX', 'JHN', 1, 5)).toEqual(bridge);
    expect(readVerseUnit(db, 'FIX', 'JHN', 1, 6)).toEqual(bridge);
    expect(readVerseUnit(db, 'FIX', 'JHN', 1, 4)).toMatchObject({ verse: 4, lastVerse: 4 });
    expect(readVerseUnit(db, 'FIX', 'JHN', 1, 7)).toBeNull();

    // unknown coordinate reads empty, not throwing
    expect(readChapter(db, 'KJV', 'JHN', 1)).toEqual({ blocks: [], tokens: [] });

    // readings (ADR-0007) come back with their ids split, in word order
    const { insertReadings } = await import('./write-db');
    const qere = { book: 'JHN', chapter: 1, verse: 1, segment: '', kind: 'qere' as const };
    insertReadings(db, translationId, 'oshb', [
      { ...qere, wordIndex: 3, wordCount: 0, text: 'פְּרָת', owIds: ['10dp9'] },
      { ...qere, wordIndex: 1, wordCount: 2, text: 'הִיא־וָהוּא', owIds: ['11k9N', '111M5'] },
      { ...qere, wordIndex: 3, wordCount: 1, text: '', owIds: [] },
    ]);
    expect(readReadings(db, 'FIX', 'JHN', 1).map((r) => [r.wordIndex, r.wordCount, r.text, r.owIds])).toEqual([
      [1, 2, 'הִיא־וָהוּא', ['11k9N', '111M5']],
      [3, 0, 'פְּרָת', ['10dp9']],
      [3, 1, '', []],
    ]);
    expect(readReadings(db, 'FIX', 'JHN', 2)).toEqual([]);

    sqlite.close();
  });
});

/**
 * The write-db.ts DDL string hand-mirrors src/db/corpus-schema.ts (no
 * generator connects them). This guard makes one-sided edits fail here
 * instead of writing a corpus that reads back with silent NULLs. Tables are discovered from the schema module,
 * so a table added there without DDL also fails.
 */
describe.skipIf(!native)('DDL ↔ drizzle schema parity (write-db.ts hand-mirrors corpus-schema.ts)', () => {
  it('the DDL creates exactly the tables, columns, defaults and indexes the schema declares', async () => {
    const { createCorpusDb } = await import('./write-db');
    const { getTableConfig, SQLiteTable } = await import('drizzle-orm/sqlite-core');
    const { is } = await import('drizzle-orm');
    const schema = await import('../db/corpus-schema');

    const { sqlite } = createCorpusDb(':memory:');
    const configs = Object.values(schema)
      .filter((v) => is(v, SQLiteTable))
      .map((t) => getTableConfig(t as InstanceType<typeof SQLiteTable>));

    // same set of tables
    const ddlTables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(ddlTables.sort()).toEqual(configs.map((c) => c.name).sort());

    for (const table of configs) {
      // same columns: name, NOT NULL, primary key, presence of a default
      const info = sqlite.prepare(`PRAGMA table_info(${table.name})`).all() as {
        name: string; notnull: number; pk: number; dflt_value: string | null;
      }[];
      const ddlCols = info
        .map((c) => ({
          name: c.name,
          // sqlite reports INTEGER PRIMARY KEY with notnull=0 though it is implicitly NOT NULL
          notNull: c.pk > 0 || c.notnull === 1,
          primary: c.pk > 0,
          hasDefault: c.dflt_value != null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const inCompositePk = (name: string) =>
        table.primaryKeys.some((pk) => pk.columns.some((c) => c.name === name));
      const schemaCols = table.columns
        .map((c) => ({
          name: c.name,
          notNull: c.primary || c.notNull,
          primary: c.primary || inCompositePk(c.name),
          hasDefault: c.default !== undefined,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      expect(ddlCols, `columns of ${table.name}`).toEqual(schemaCols);

      // same named indexes over the same column lists, unique or not (UNIQUE autoindexes excluded)
      const ddlIndexes = new Map<string, string[]>();
      const list = sqlite.prepare(`PRAGMA index_list(${table.name})`).all() as {
        name: string; origin: string; unique: number;
      }[];
      for (const idx of list) {
        if (idx.origin !== 'c') continue; // 'u'/'pk' autoindexes are column-level, checked below
        const cols = sqlite.prepare(`PRAGMA index_info(${idx.name})`).all() as { name: string }[];
        ddlIndexes.set(idx.name, [idx.unique ? 'UNIQUE' : 'INDEX', ...cols.map((c) => c.name)]);
      }
      const schemaIndexes = new Map<string, string[]>(
        table.indexes.map((idx) => [
          idx.config.name,
          [idx.config.unique ? 'UNIQUE' : 'INDEX', ...idx.config.columns.map((c) => (c as { name: string }).name)],
        ]),
      );
      expect(ddlIndexes, `indexes of ${table.name}`).toEqual(schemaIndexes);

      // same UNIQUE columns (origin 'u' autoindexes ↔ column-level .unique())
      const ddlUnique = list
        .filter((i) => i.origin === 'u')
        .flatMap((i) => (sqlite.prepare(`PRAGMA index_info(${i.name})`).all() as { name: string }[]).map((c) => c.name))
        .sort();
      const schemaUnique = table.columns.filter((c) => c.isUnique).map((c) => c.name).sort();
      expect(ddlUnique, `UNIQUE columns of ${table.name}`).toEqual(schemaUnique);
    }

    sqlite.close();
  });
});
